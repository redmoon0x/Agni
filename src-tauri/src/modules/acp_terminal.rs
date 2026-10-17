use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use shared_child::SharedChild;

const DEFAULT_OUTPUT_LIMIT: usize = 1024 * 1024;
const MIN_OUTPUT_LIMIT: usize = 64 * 1024;
const MAX_OUTPUT_LIMIT: usize = 8 * 1024 * 1024;
const MAX_ARGUMENTS: usize = 256;
const MAX_ARGUMENT_BYTES: usize = 16 * 1024;
const MAX_ENV_VARS: usize = 128;
const MAX_ENV_NAME_BYTES: usize = 256;
const MAX_ENV_VALUE_BYTES: usize = 32 * 1024;
const WAIT_POLL: Duration = Duration::from_millis(100);
/// Upper bound on how long one `terminal/wait_for_exit` call blocks. A terminal
/// that outlives this keeps running; the agent can call again or read output.
const MAX_WAIT: Duration = Duration::from_secs(30 * 60);

#[derive(Deserialize)]
pub struct EnvVariable {
    name: String,
    value: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitStatus {
    exit_code: Option<i32>,
    signal: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    output: String,
    truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_status: Option<TerminalExitStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateResult {
    terminal_id: String,
}

#[derive(Default)]
struct SharedOutput {
    output: String,
    truncated: bool,
    exit: Option<TerminalExitStatus>,
}

struct TerminalEntry {
    #[cfg(windows)]
    _job: Option<crate::modules::pty::job::PtyJob>,
    child: Arc<SharedChild>,
    shared: Arc<Mutex<SharedOutput>>,
}

#[derive(Default)]
pub struct AcpTerminalState {
    terminals: Mutex<HashMap<String, Arc<TerminalEntry>>>,
    next_id: AtomicU64,
}

impl Drop for AcpTerminalState {
    fn drop(&mut self) {
        if let Ok(terminals) = self.terminals.lock() {
            for entry in terminals.values() {
                kill_entry(entry);
            }
        }
    }
}

#[tauri::command]
pub fn acp_terminal_create(
    state: tauri::State<'_, AcpTerminalState>,
    command: String,
    args: Option<Vec<String>>,
    env: Option<Vec<EnvVariable>>,
    cwd: Option<String>,
    output_byte_limit: Option<u64>,
) -> Result<TerminalCreateResult, String> {
    let args = validate_args(args.unwrap_or_default())?;
    let env = validate_env(env.unwrap_or_default())?;
    let cwd = validate_cwd(cwd)?;
    let limit = output_byte_limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_OUTPUT_LIMIT)
        .clamp(MIN_OUTPUT_LIMIT, MAX_OUTPUT_LIMIT);

    let entry = spawn_terminal(
        command.trim(),
        &args,
        &env,
        cwd.as_deref().map(Path::new),
        limit,
    )?;
    let id = format!(
        "term_{}",
        state.next_id.fetch_add(1, Ordering::Relaxed) + 1
    );
    state
        .terminals
        .lock()
        .map_err(|_| "ACP terminal state poisoned")?
        .insert(id.clone(), entry);
    Ok(TerminalCreateResult { terminal_id: id })
}

#[tauri::command]
pub fn acp_terminal_output(
    state: tauri::State<'_, AcpTerminalState>,
    terminal_id: String,
) -> Result<TerminalOutput, String> {
    let entry = lookup(&state, &terminal_id)?;
    let shared = entry
        .shared
        .lock()
        .map_err(|_| "ACP terminal buffer poisoned")?;
    Ok(TerminalOutput {
        output: shared.output.clone(),
        truncated: shared.truncated,
        exit_status: shared.exit.clone(),
    })
}

#[tauri::command]
pub async fn acp_terminal_wait_for_exit(
    state: tauri::State<'_, AcpTerminalState>,
    terminal_id: String,
) -> Result<TerminalExitStatus, String> {
    let entry = lookup(&state, &terminal_id)?;
    let deadline = tokio::time::Instant::now() + MAX_WAIT;
    loop {
        {
            let shared = entry
                .shared
                .lock()
                .map_err(|_| "ACP terminal buffer poisoned")?;
            if let Some(exit) = shared.exit.clone() {
                return Ok(exit);
            }
        }
        tokio::time::sleep(WAIT_POLL.min(deadline.saturating_duration_since(tokio::time::Instant::now()))).await;
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "The ACP terminal did not exit within {} minutes",
                MAX_WAIT.as_secs() / 60
            ));
        }
    }
}

#[tauri::command]
pub fn acp_terminal_kill(
    state: tauri::State<'_, AcpTerminalState>,
    terminal_id: String,
) -> Result<(), String> {
    let entry = lookup(&state, &terminal_id)?;
    kill_entry(&entry);
    Ok(())
}

#[tauri::command]
pub fn acp_terminal_release(
    state: tauri::State<'_, AcpTerminalState>,
    terminal_id: String,
) -> Result<(), String> {
    let entry = state
        .terminals
        .lock()
        .map_err(|_| "ACP terminal state poisoned")?
        .remove(&terminal_id);
    if let Some(entry) = entry {
        kill_entry(&entry);
    }
    Ok(())
}

#[tauri::command]
pub fn acp_terminal_close_all(state: tauri::State<'_, AcpTerminalState>) -> Result<(), String> {
    let entries: Vec<Arc<TerminalEntry>> = state
        .terminals
        .lock()
        .map_err(|_| "ACP terminal state poisoned")?
        .drain()
        .map(|(_, entry)| entry)
        .collect();
    for entry in entries {
        kill_entry(&entry);
    }
    Ok(())
}

fn lookup(
    state: &tauri::State<'_, AcpTerminalState>,
    terminal_id: &str,
) -> Result<Arc<TerminalEntry>, String> {
    state
        .terminals
        .lock()
        .map_err(|_| "ACP terminal state poisoned")?
        .get(terminal_id)
        .cloned()
        .ok_or_else(|| format!("Unknown ACP terminal: {terminal_id}"))
}

fn validate_args(args: Vec<String>) -> Result<Vec<String>, String> {
    if args.len() > MAX_ARGUMENTS {
        return Err("The command has too many arguments".into());
    }
    for argument in &args {
        if argument.len() > MAX_ARGUMENT_BYTES || argument.contains('\0') {
            return Err("The command has an invalid argument".into());
        }
    }
    Ok(args)
}

fn validate_env(env: Vec<EnvVariable>) -> Result<Vec<EnvVariable>, String> {
    if env.len() > MAX_ENV_VARS {
        return Err("The command has too many environment variables".into());
    }
    for variable in &env {
        let name = variable.name.trim();
        if name.is_empty()
            || name.len() > MAX_ENV_NAME_BYTES
            || name.contains('=')
            || name.contains('\0')
            || variable.value.len() > MAX_ENV_VALUE_BYTES
            || variable.value.contains('\0')
        {
            return Err("The command has an invalid environment variable".into());
        }
    }
    Ok(env)
}

fn validate_cwd(cwd: Option<String>) -> Result<Option<String>, String> {
    let Some(cwd) = cwd.map(|value| value.trim().to_string()).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let path = Path::new(&cwd);
    if !path.is_absolute() {
        return Err("The terminal working directory must be an absolute path".into());
    }
    if !path.is_dir() {
        return Err(format!("The terminal working directory does not exist: {cwd}"));
    }
    Ok(Some(cwd))
}

fn spawn_terminal(
    program: &str,
    args: &[String],
    env: &[EnvVariable],
    cwd: Option<&Path>,
    limit: usize,
) -> Result<Arc<TerminalEntry>, String> {
    if program.is_empty() || program.contains('\0') {
        return Err("The command is empty".into());
    }
    let mut command = Command::new(program);
    command.args(args);
    for variable in env {
        command.env(variable.name.trim(), &variable.value);
    }
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    crate::modules::proc::hide_console(&mut command);

    let child = Arc::new(SharedChild::spawn(&mut command).map_err(|error| {
        format!("Could not run `{program}`: {error}")
    })?);
    let stdout = child
        .take_stdout()
        .ok_or_else(|| cleanup(&child, "The command stdout was unavailable"))?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| cleanup(&child, "The command stderr was unavailable"))?;

    #[cfg(windows)]
    let job = match crate::modules::pty::job::PtyJob::create_for(child.id()) {
        Ok(job) => Some(job),
        Err(error) => {
            log::warn!(
                "ACP terminal job-object setup failed for pid={}: {error}",
                child.id()
            );
            None
        }
    };

    let shared = Arc::new(Mutex::new(SharedOutput::default()));
    spawn_output_reader(stdout, Arc::clone(&shared), limit, "agni-acp-term-out");
    spawn_output_reader(stderr, Arc::clone(&shared), limit, "agni-acp-term-err");

    let entry = Arc::new(TerminalEntry {
        #[cfg(windows)]
        _job: job,
        child: Arc::clone(&child),
        shared: Arc::clone(&shared),
    });
    spawn_exit_waiter(child, shared);
    Ok(entry)
}

fn spawn_output_reader<R: Read + Send + 'static>(
    mut reader: R,
    shared: Arc<Mutex<SharedOutput>>,
    limit: usize,
    name: &str,
) {
    thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let mut chunk = [0u8; 8192];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        let text = String::from_utf8_lossy(&chunk[..read]);
                        if let Ok(mut shared) = shared.lock() {
                            append_output(&mut shared, &text, limit);
                        }
                    }
                }
            }
        })
        .expect("spawn ACP terminal reader");
}

fn spawn_exit_waiter(child: Arc<SharedChild>, shared: Arc<Mutex<SharedOutput>>) {
    thread::Builder::new()
        .name("agni-acp-term-wait".into())
        .spawn(move || {
            let status = child.wait().ok();
            let exit = TerminalExitStatus {
                exit_code: status.as_ref().and_then(std::process::ExitStatus::code),
                signal: status.as_ref().and_then(exit_signal),
            };
            if let Ok(mut shared) = shared.lock() {
                shared.exit = Some(exit);
            }
        })
        .expect("spawn ACP terminal waiter");
}

fn append_output(shared: &mut SharedOutput, chunk: &str, limit: usize) {
    shared.output.push_str(chunk);
    if shared.output.len() <= limit {
        return;
    }
    shared.truncated = true;
    let excess = shared.output.len() - limit;
    let mut cut = excess;
    while cut < shared.output.len() && !shared.output.is_char_boundary(cut) {
        cut += 1;
    }
    shared.output.drain(..cut);
}

fn cleanup(child: &SharedChild, message: &str) -> String {
    let _ = child.kill();
    let _ = child.wait();
    message.to_string()
}

fn kill_entry(entry: &TerminalEntry) {
    #[cfg(unix)]
    {
        let pid = entry.child.id();
        if pid <= i32::MAX as u32 {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
    }
    let _ = entry.child.kill();
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(|signal| signal.to_string())
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_is_truncated_from_the_start_at_char_boundaries() {
        let mut shared = SharedOutput::default();
        append_output(&mut shared, "hello world", 5);
        assert_eq!(shared.output, "world");
        assert!(shared.truncated);

        let mut shared = SharedOutput::default();
        append_output(&mut shared, "aébc", 3);
        assert_eq!(shared.output, "bc");
        assert!(shared.truncated);

        let mut shared = SharedOutput::default();
        append_output(&mut shared, "short", 16);
        assert_eq!(shared.output, "short");
        assert!(!shared.truncated);
    }

    #[test]
    fn rejects_invalid_arguments_and_environment() {
        assert!(validate_args(vec!["ok".into()]).is_ok());
        assert!(validate_args(vec!["bad\0arg".into()]).is_err());
        assert!(validate_args(vec!["ok".into(); MAX_ARGUMENTS + 1]).is_err());
        assert!(validate_env(vec![EnvVariable {
            name: "TOKEN".into(),
            value: "secret".into()
        }])
        .is_ok());
        assert!(validate_env(vec![EnvVariable {
            name: "BAD=NAME".into(),
            value: String::new()
        }])
        .is_err());
    }

    #[test]
    fn rejects_relative_or_missing_working_directories() {
        assert!(validate_cwd(None).unwrap().is_none());
        assert!(validate_cwd(Some("relative/path".into())).is_err());
        assert!(validate_cwd(Some("/definitely/not/a/real/dir".into())).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn runs_a_command_and_reports_exit() {
        let entry = spawn_terminal(
            "cmd.exe",
            &["/C".into(), "echo hello".into()],
            &[],
            None,
            64 * 1024,
        )
        .expect("spawn cmd.exe");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let shared = entry.shared.lock().unwrap();
            if let Some(exit) = &shared.exit {
                assert_eq!(exit.exit_code, Some(0));
                break;
            }
            if std::time::Instant::now() >= deadline {
                panic!("command did not exit");
            }
            drop(shared);
            std::thread::sleep(Duration::from_millis(20));
        }
        let shared = entry.shared.lock().unwrap();
        assert!(shared.output.contains("hello"));
    }

    #[cfg(unix)]
    #[test]
    fn runs_a_command_and_reports_exit() {
        let entry = spawn_terminal("echo", &["hello".into()], &[], None, 64 * 1024)
            .expect("spawn echo");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let shared = entry.shared.lock().unwrap();
            if let Some(exit) = &shared.exit {
                assert_eq!(exit.exit_code, Some(0));
                break;
            }
            if std::time::Instant::now() >= deadline {
                panic!("command did not exit");
            }
            drop(shared);
            std::thread::sleep(Duration::from_millis(20));
        }
        let shared = entry.shared.lock().unwrap();
        assert!(shared.output.contains("hello"));
    }
}
