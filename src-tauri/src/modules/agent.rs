use std::collections::BTreeSet;
#[cfg(windows)]
use std::process::{Command, Stdio};

use serde_json::{json, Value};

use crate::modules::workspace::WorkspaceEnv;

/// Agents Agni can launch, paired with the executable each one needs. Kept in
/// step with `ACP_AGENTS` in `acp.rs` plus Pi, which has no ACP descriptor.
const AGENT_PROGRAMS: &[(&str, &str)] =
    &[("opencode", "opencode"), ("kilo", "kilo"), ("pi", "pi")];

const HOOK_EVENTS: [(&str, &str); 3] = [
    ("UserPromptSubmit", "working"),
    ("Notification", "attention"),
    ("Stop", "finished"),
];

const OWNED_MARKERS: [&str; 2] = ["notify;Agni;", "agni;notify"];

fn hook_cmd(event: &str) -> String {
    format!(
        r#"[ -n "$AGNI_TERMINAL" ] && printf '{{"terminalSequence":"\\u001b]777;notify;Agni;{event}\\u0007"}}' || true"#
    )
}

fn is_ours(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| {
            hs.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|c| OWNED_MARKERS.iter().any(|m| c.contains(m)))
            })
        })
}

fn is_empty_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_none_or(|hs| hs.is_empty())
}

fn merge_hooks(mut root: Value) -> Value {
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();
    for (event, marker) in HOOK_EVENTS {
        let arr = hooks.entry(event).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        let arr = arr.as_array_mut().unwrap();
        arr.retain(|group| !is_ours(group) && !is_empty_group(group));
        arr.push(json!({ "hooks": [ { "type": "command", "command": hook_cmd(marker) } ] }));
    }
    root
}

fn existing_config(contents: Option<&str>, path: &std::path::Path) -> Result<Value, String> {
    match contents {
        Some(s) if !s.trim().is_empty() => serde_json::from_str::<Value>(s).map_err(|e| {
            format!(
                "{} is not valid JSON ({e}); refusing to overwrite",
                path.display()
            )
        }),
        _ => Ok(json!({})),
    }
}

fn settings_path() -> Result<std::path::PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join(".claude")
        .join("settings.json"))
}

#[tauri::command]
pub fn agent_enable_claude_hooks() -> Result<(), String> {
    let path = settings_path()?;
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => existing_config(Some(&s), &path)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(format!("read {}: {e}", path.display())),
    };
    let merged = merge_hooks(existing);
    let out = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.agni-tmp");
    std::fs::write(&tmp, out).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename into {}: {e}", path.display())
    })?;
    Ok(())
}

#[tauri::command]
pub fn agent_claude_hooks_status() -> bool {
    let Some(content) = settings_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
    else {
        return false;
    };
    HOOK_EVENTS
        .iter()
        .all(|(_, m)| content.contains(&format!("notify;Agni;{m}")))
}

/// Which agent programs exist for this workspace, in panel order. The panel
/// only offers what is installed, so a machine without an agent never sees a
/// tab that fails to start.
#[tauri::command]
pub fn agents_installed(workspace: Option<WorkspaceEnv>) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    Ok(agent_ids(&installed_programs(&workspace)))
}

fn agent_ids(found: &BTreeSet<&'static str>) -> Vec<String> {
    AGENT_PROGRAMS
        .iter()
        .filter_map(|(id, program)| found.contains(program).then(|| (*id).to_string()))
        .collect()
}

fn installed_programs(workspace: &WorkspaceEnv) -> BTreeSet<&'static str> {
    match workspace {
        WorkspaceEnv::Local => installed_locally(),
        WorkspaceEnv::Wsl { distro } => installed_programs_in_wsl(distro),
    }
}

fn installed_locally() -> BTreeSet<&'static str> {
    AGENT_PROGRAMS
        .iter()
        .filter(|(_, program)| crate::modules::proc::program_exists(program))
        .map(|(_, program)| *program)
        .collect()
}

/// `command -v` output, one absolute path per line, mapped back to agent ids.
/// Anything unrecognised (and any shell noise) is ignored.
#[cfg(any(windows, test))]
fn parse_probe_output(stdout: &str) -> BTreeSet<&'static str> {
    stdout
        .lines()
        .filter_map(|line| {
            let name = line.trim().rsplit(['/', '\\']).next().unwrap_or("").trim();
            AGENT_PROGRAMS
                .iter()
                .find(|(_, program)| *program == name)
                .map(|(_, program)| *program)
        })
        .collect()
}

fn all_programs() -> BTreeSet<&'static str> {
    AGENT_PROGRAMS.iter().map(|(_, program)| *program).collect()
}

/// WSL has its own PATH, so the probe runs one shell inside the distro. Any
/// failure (unsafe name, distro down, `sh` missing) falls open: every agent
/// stays offered rather than the panel emptying itself on a broken probe.
#[cfg(windows)]
fn installed_programs_in_wsl(distro: &str) -> BTreeSet<&'static str> {
    if crate::modules::workspace::validate_wsl_distro_name(distro).is_err() {
        return all_programs();
    }
    let names = AGENT_PROGRAMS
        .iter()
        .map(|(_, program)| *program)
        .collect::<Vec<_>>()
        .join(" ");
    let script = format!("for p in {names}; do command -v \"$p\"; done");
    let mut command = Command::new("wsl.exe");
    command
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg("sh")
        .arg("-lc")
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::modules::proc::hide_console(&mut command);
    match command.output() {
        Ok(output) if output.status.success() => {
            parse_probe_output(&String::from_utf8_lossy(&output.stdout))
        }
        _ => all_programs(),
    }
}

/// WSL sessions cannot be started off Windows, so there is nothing to probe.
#[cfg(not(windows))]
fn installed_programs_in_wsl(_distro: &str) -> BTreeSet<&'static str> {
    all_programs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_output_keeps_only_known_programs() {
        let stdout = "/usr/bin/pi\n/home/me/.bun/bin/kilo\n/usr/bin/node\n";
        let found = parse_probe_output(stdout);
        assert!(found.contains("pi"));
        assert!(found.contains("kilo"));
        assert!(!found.contains("opencode"));
    }

    #[test]
    fn probe_output_of_a_bare_distro_is_empty() {
        assert!(parse_probe_output("").is_empty());
        assert!(parse_probe_output("bash: pi: command not found\n").is_empty());
    }

    #[test]
    fn reports_only_installed_agents_in_panel_order() {
        assert_eq!(
            agent_ids(&BTreeSet::from(["kilo", "opencode"])),
            vec!["opencode", "kilo"]
        );
        assert_eq!(agent_ids(&BTreeSet::from(["pi"])), vec!["pi"]);
        assert!(agent_ids(&BTreeSet::new()).is_empty());
    }

    #[cfg(not(windows))]
    #[test]
    fn a_wsl_workspace_off_windows_offers_every_agent() {
        let workspace = WorkspaceEnv::Wsl {
            distro: "Ubuntu".into(),
        };
        assert_eq!(
            agent_ids(&installed_programs(&workspace)),
            agent_ids(&all_programs())
        );
    }
}
