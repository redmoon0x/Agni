use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use shared_child::SharedChild;
use tauri::Manager;

use crate::modules::git::utils::authorized_repo_root;
use crate::modules::proc::{find_program, hide_console};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

const GH_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_OUTPUT_BYTES: usize = 512 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAvailability {
    pub installed: bool,
    pub authenticated: bool,
    pub account: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GithubChecks {
    pub passed: u32,
    pub failed: u32,
    pub pending: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub is_draft: bool,
    pub review_decision: Option<String>,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    pub checks: GithubChecks,
}

struct GhOutput {
    stdout: String,
    stderr: String,
    success: bool,
}

fn read_capped<R: Read>(mut reader: R) -> String {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if buf.len() < MAX_OUTPUT_BYTES {
                    let take = (MAX_OUTPUT_BYTES - buf.len()).min(n);
                    buf.extend_from_slice(&chunk[..take]);
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

/// Runs `gh` with no shell, bounded output and a hard timeout. Arguments are
/// passed as separate values, never spliced into a command line.
fn run_gh(cwd: Option<&str>, args: &[String]) -> Result<GhOutput, String> {
    let program =
        find_program("gh").ok_or_else(|| "GitHub CLI (gh) is not installed".to_string())?;
    let mut cmd = Command::new(program);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_PAGER", "cat")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);

    let child =
        Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| format!("cannot start gh: {e}"))?);
    let mut stdout_pipe = child
        .take_stdout()
        .ok_or_else(|| "gh stdout pipe unavailable".to_string())?;
    let mut stderr_pipe = child
        .take_stderr()
        .ok_or_else(|| "gh stderr pipe unavailable".to_string())?;
    let stdout_handle = thread::spawn(move || read_capped(&mut stdout_pipe));
    let stderr_handle = thread::spawn(move || read_capped(&mut stderr_pipe));

    let (tx, rx) = mpsc::channel();
    let waiter = Arc::clone(&child);
    thread::spawn(move || {
        let _ = tx.send(waiter.wait());
    });

    let success = match rx.recv_timeout(GH_TIMEOUT) {
        Ok(Ok(status)) => status.success(),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("gh timed out".to_string());
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            return Err("gh wait failed".to_string());
        }
    };

    Ok(GhOutput {
        stdout: stdout_handle.join().unwrap_or_default(),
        stderr: stderr_handle.join().unwrap_or_default(),
        success,
    })
}

fn valid_branch(branch: &str) -> bool {
    !branch.is_empty()
        && branch.len() <= 255
        && !branch.starts_with('-')
        && !branch
            .chars()
            .any(|c| c.is_control() || c == ' ' || c == '\u{7f}')
}

fn checks_from_json(value: &serde_json::Value) -> GithubChecks {
    let mut checks = GithubChecks::default();
    let Some(items) = value.get("statusCheckRollup").and_then(|v| v.as_array()) else {
        return checks;
    };
    for item in items {
        let conclusion = item.get("conclusion").and_then(|v| v.as_str());
        let status = item.get("status").and_then(|v| v.as_str());
        let state = item.get("state").and_then(|v| v.as_str());
        let failed = matches!(
            conclusion,
            Some("FAILURE")
                | Some("TIMED_OUT")
                | Some("CANCELLED")
                | Some("ACTION_REQUIRED")
                | Some("STARTUP_FAILURE")
                | Some("STALE")
        ) || matches!(state, Some("FAILURE") | Some("ERROR"));
        let passed = matches!(
            conclusion,
            Some("SUCCESS") | Some("NEUTRAL") | Some("SKIPPED")
        ) || matches!(state, Some("SUCCESS"));
        let pending = matches!(
            status,
            Some("QUEUED")
                | Some("IN_PROGRESS")
                | Some("PENDING")
                | Some("WAITING")
                | Some("REQUESTED")
        ) || matches!(state, Some("PENDING") | Some("EXPECTED"));
        if failed {
            checks.failed += 1;
        } else if passed {
            checks.passed += 1;
        } else if pending {
            checks.pending += 1;
        }
    }
    checks
}

fn pull_request_from_json(value: &serde_json::Value) -> Option<GithubPullRequest> {
    let number = value.get("number").and_then(|v| v.as_u64())?;
    Some(GithubPullRequest {
        number,
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        url: value
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        state: value
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        is_draft: value
            .get("isDraft")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        review_decision: value
            .get("reviewDecision")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        head_ref: value
            .get("headRefName")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        base_ref: value
            .get("baseRefName")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        checks: checks_from_json(value),
    })
}

const PR_FIELDS: &str =
    "number,title,url,state,isDraft,reviewDecision,headRefName,baseRefName,statusCheckRollup";

fn view_pr(cwd: &str, selector: &str) -> Result<Option<GithubPullRequest>, String> {
    if selector.is_empty() || selector.starts_with('-') {
        return Ok(None);
    }
    let output = run_gh(
        Some(cwd),
        &[
            "pr".into(),
            "view".into(),
            selector.to_string(),
            "--json".into(),
            PR_FIELDS.into(),
        ],
    )?;
    if !output.success {
        let combined = format!("{}\n{}", output.stdout, output.stderr).to_lowercase();
        if combined.contains("no pull requests found")
            || combined.contains("no open pull request")
            || combined.contains("could not resolve to a pull request")
        {
            return Ok(None);
        }
        let message = output.stderr.trim();
        return Err(if message.is_empty() {
            "gh pr view failed".to_string()
        } else {
            message.to_string()
        });
    }
    let value: serde_json::Value =
        serde_json::from_str(&output.stdout).map_err(|e| format!("invalid gh output: {e}"))?;
    Ok(pull_request_from_json(&value))
}

#[tauri::command]
pub async fn github_available() -> Result<GithubAvailability, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if find_program("gh").is_none() {
            return Ok(GithubAvailability {
                installed: false,
                authenticated: false,
                account: None,
            });
        }
        let output = run_gh(None, &["auth".into(), "status".into()])?;
        let text = format!("{}\n{}", output.stdout, output.stderr);
        // `gh auth status` exits non-zero when any account has an issue, so
        // read the presence of a logged-in account instead of the exit code.
        let authenticated = text.contains("Logged in to");
        let account = text.lines().find_map(|line| {
            line.split("account ")
                .nth(1)
                .and_then(|rest| rest.split_whitespace().next())
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        });
        Ok(GithubAvailability {
            installed: true,
            authenticated,
            account,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_pr_status(
    app: tauri::AppHandle,
    repo_root: String,
    branch: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<Option<GithubPullRequest>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let resolved =
            authorized_repo_root(&registry, &repo_root, &workspace).map_err(|e| e.to_string())?;
        let Some(branch) = branch.filter(|b| valid_branch(b)) else {
            return Ok(None);
        };
        view_pr(&resolved.git_path, &branch)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_pr_create(
    app: tauri::AppHandle,
    repo_root: String,
    title: String,
    body: Option<String>,
    base: Option<String>,
    draft: Option<bool>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GithubPullRequest, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("A pull request title is required".into());
    }
    if title.len() > 256 {
        return Err("Pull request title is too long".into());
    }
    let body = body.unwrap_or_default();
    if body.len() > 60_000 {
        return Err("Pull request body is too long".into());
    }
    if let Some(base) = base.as_deref() {
        if !valid_branch(base) {
            return Err("Invalid base branch".into());
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let resolved =
            authorized_repo_root(&registry, &repo_root, &workspace).map_err(|e| e.to_string())?;
        let cwd = resolved.git_path.clone();

        let mut args: Vec<String> = vec![
            "pr".into(),
            "create".into(),
            "--title".into(),
            title,
            "--body".into(),
            body,
        ];
        if let Some(base) = base.filter(|b| !b.is_empty()) {
            args.push("--base".into());
            args.push(base);
        }
        if draft.unwrap_or(false) {
            args.push("--draft".into());
        }

        let output = run_gh(Some(&cwd), &args)?;
        if !output.success {
            let message = output.stderr.trim();
            return Err(if message.is_empty() {
                "gh pr create failed".to_string()
            } else {
                message.to_string()
            });
        }

        // `gh pr create` prints the new PR URL; read it back for full details.
        let url = output
            .stdout
            .lines()
            .rev()
            .map(str::trim)
            .find(|line| line.starts_with("http"));
        match url {
            Some(url) => view_pr(&cwd, url)?
                .ok_or_else(|| "Pull request was created but could not be read back".to_string()),
            None => Err("gh pr create returned no pull request URL".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn valid_branch_rejects_flags_and_garbage() {
        assert!(valid_branch("feat/github"));
        assert!(valid_branch("release-1.2"));
        assert!(!valid_branch(""));
        assert!(!valid_branch("-web"));
        assert!(!valid_branch("bad branch"));
        assert!(!valid_branch("bad\nbranch"));
    }

    #[test]
    fn checks_count_check_runs_and_status_contexts() {
        let value = json!({
            "statusCheckRollup": [
                { "__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS" },
                { "__typename": "CheckRun", "status": "COMPLETED", "conclusion": "FAILURE" },
                { "__typename": "CheckRun", "status": "IN_PROGRESS", "conclusion": null },
                { "__typename": "StatusContext", "state": "SUCCESS" },
                { "__typename": "StatusContext", "state": "FAILURE" },
                { "__typename": "StatusContext", "state": "PENDING" }
            ]
        });
        let checks = checks_from_json(&value);
        assert_eq!(checks.passed, 2);
        assert_eq!(checks.failed, 2);
        assert_eq!(checks.pending, 2);
    }

    #[test]
    fn checks_are_empty_without_rollup() {
        let checks = checks_from_json(&json!({}));
        assert_eq!(checks.passed, 0);
        assert_eq!(checks.failed, 0);
        assert_eq!(checks.pending, 0);
    }

    #[test]
    fn pull_request_maps_gh_json() {
        let value = json!({
            "number": 7,
            "title": "Add GitHub",
            "url": "https://github.com/o/r/pull/7",
            "state": "OPEN",
            "isDraft": true,
            "reviewDecision": "APPROVED",
            "headRefName": "feat/github",
            "baseRefName": "main",
            "statusCheckRollup": []
        });
        let pr = pull_request_from_json(&value).expect("parsed");
        assert_eq!(pr.number, 7);
        assert_eq!(pr.state, "OPEN");
        assert!(pr.is_draft);
        assert_eq!(pr.review_decision.as_deref(), Some("APPROVED"));
        assert_eq!(pr.head_ref.as_deref(), Some("feat/github"));
        assert_eq!(pr.base_ref.as_deref(), Some("main"));
        assert!(pull_request_from_json(&json!({ "title": "no number" })).is_none());
    }
}
