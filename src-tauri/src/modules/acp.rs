use std::io::Write;
#[cfg(windows)]
use std::path::PathBuf;
use std::process::{ChildStderr, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use serde_json::Value;
use shared_child::SharedChild;
use tauri::ipc::Channel;

use crate::modules::jsonl::read_lf_records;
use crate::modules::workspace::{authorize_user_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

const MAX_RPC_LINE_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMMAND_BYTES: usize = 12 * 1024 * 1024;
const MAX_STDERR_LINE_BYTES: usize = 16 * 1024;

/// ACP-speaking agents Agni can launch. Adding an agent is one row here plus a
/// matching descriptor in the frontend registry.
const ACP_AGENTS: &[(&str, &str, &[&str])] = &[
    ("opencode", "opencode", &["acp"]),
    ("kilo", "kilo", &["acp"]),
];

fn resolve_acp_agent(agent: &str) -> Result<(&'static str, &'static [&'static str]), String> {
    ACP_AGENTS
        .iter()
        .find(|(id, _, _)| *id == agent)
        .map(|(_, program, args)| (*program, *args))
        .ok_or_else(|| format!("Unknown ACP agent: {agent}"))
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AcpEvent {
    Rpc { message: Value },
    Stderr { message: String },
    ProtocolError { message: String },
    Exit { code: Option<i32> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpStartResult {
    session_id: u64,
}

struct AcpSession {
    #[cfg(windows)]
    _job: Option<crate::modules::pty::job::PtyJob>,
    id: u64,
    child: Arc<SharedChild>,
    stdin: Mutex<std::process::ChildStdin>,
}

#[derive(Default)]
pub struct AcpState {
    session: Arc<Mutex<Option<Arc<AcpSession>>>>,
    next_id: AtomicU64,
}

impl Drop for AcpState {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.session.lock() {
            if let Some(session) = slot.take() {
                kill_process_tree(&session);
            }
        }
    }
}

#[tauri::command]
pub async fn acp_start(
    state: tauri::State<'_, AcpState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    agent: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_event: Channel<AcpEvent>,
) -> Result<AcpStartResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let authorized_cwd = authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let label = resolve_acp_agent(&agent)?.0;

    let mut slot = state.session.lock().map_err(|_| "OpenCode state poisoned")?;
    if let Some(existing) = slot.as_ref() {
        if existing
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Err("An ACP agent is already running".into());
        }
        slot.take();
    }

    let mut command = build_acp_command(&agent, cwd.as_deref(), &workspace)?;
    if let (WorkspaceEnv::Local, Some(path)) = (&workspace, authorized_cwd) {
        command.current_dir(path);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    crate::modules::proc::hide_console(&mut command);

    let child = Arc::new(SharedChild::spawn(&mut command).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("{label} was not found. Install it and make sure `{label}` is on PATH.")
        } else {
            format!("Could not start {label}: {e}")
        }
    })?);

    let stdin = child
        .take_stdin()
        .ok_or_else(|| cleanup_failed_start(&child, "OpenCode stdin was unavailable"))?;
    let stdout = child
        .take_stdout()
        .ok_or_else(|| cleanup_failed_start(&child, "OpenCode stdout was unavailable"))?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| cleanup_failed_start(&child, "OpenCode stderr was unavailable"))?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    #[cfg(windows)]
    let job = match crate::modules::pty::job::PtyJob::create_for(child.id()) {
        Ok(job) => Some(job),
        Err(error) => {
            log::warn!("OpenCode job-object setup failed for pid={}: {error}", child.id());
            None
        }
    };
    let session = Arc::new(AcpSession {
        #[cfg(windows)]
        _job: job,
        id,
        child: Arc::clone(&child),
        stdin: Mutex::new(stdin),
    });
    *slot = Some(Arc::clone(&session));
    drop(slot);

    spawn_stdout_reader(stdout, on_event.clone());
    spawn_stderr_reader(stderr, on_event.clone());
    spawn_waiter(id, child, Arc::clone(&state.session), on_event);

    log::info!("OpenCode ACP started id={id}");
    Ok(AcpStartResult { session_id: id })
}

#[tauri::command]
pub fn acp_send(
    state: tauri::State<'_, AcpState>,
    session_id: u64,
    message: Value,
) -> Result<(), String> {
    validate_message(&message)?;
    let encoded = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
    if encoded.len() > MAX_COMMAND_BYTES {
        return Err("OpenCode message is too large".into());
    }

    let session = state
        .session
        .lock()
        .map_err(|_| "OpenCode state poisoned")?
        .as_ref()
        .filter(|session| session.id == session_id)
        .cloned()
        .ok_or_else(|| "OpenCode session is not running".to_string())?;
    let mut stdin = session.stdin.lock().map_err(|_| "OpenCode stdin poisoned")?;
    stdin.write_all(&encoded).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn acp_stop(state: tauri::State<'_, AcpState>, session_id: u64) -> Result<(), String> {
    let session = {
        let mut slot = state.session.lock().map_err(|_| "OpenCode state poisoned")?;
        match slot.as_ref() {
            Some(session) if session.id == session_id => slot.take(),
            Some(_) => return Err("OpenCode session changed".into()),
            None => return Ok(()),
        }
    };
    if let Some(session) = session {
        kill_process_tree(&session);
        log::info!("OpenCode ACP stopped id={session_id}");
    }
    Ok(())
}

#[tauri::command]
pub fn acp_close_all(state: tauri::State<'_, AcpState>) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "OpenCode state poisoned")?
        .take();
    if let Some(session) = session {
        kill_process_tree(&session);
    }
    Ok(())
}

fn build_acp_command(
    agent: &str,
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Command, String> {
    let (program, args) = resolve_acp_agent(agent)?;
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = workspace {
        crate::modules::workspace::validate_wsl_distro_name(distro)?;
        let mut command = Command::new("wsl.exe");
        command.arg("-d").arg(distro);
        if let Some(cwd) = cwd.map(str::trim).filter(|cwd| !cwd.is_empty()) {
            command.arg("--cd").arg(cwd);
        }
        command.arg("--exec").arg(program);
        command.args(args.iter().copied());
        return Ok(command);
    }
    #[cfg(not(windows))]
    if workspace.is_wsl() {
        return Err("WSL ACP sessions are only available on Windows".into());
    }
    let mut command = Command::new(local_program(program));
    command.args(args.iter().copied());
    Ok(command)
}

#[cfg(windows)]
fn local_program(program: &'static str) -> PathBuf {
    let candidates = [
        format!("{program}.exe"),
        format!("{program}.cmd"),
        format!("{program}.bat"),
    ];
    if let Some(path) = std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .flat_map(|directory| {
                candidates
                    .iter()
                    .map(move |candidate| directory.join(candidate))
            })
            .find(|candidate| candidate.is_file())
    }) {
        return path;
    }
    PathBuf::from(format!("{program}.cmd"))
}

#[cfg(not(windows))]
fn local_program(program: &'static str) -> &'static str {
    program
}

fn validate_message(message: &Value) -> Result<(), String> {
    let object = message
        .as_object()
        .ok_or_else(|| "OpenCode message must be a JSON object".to_string())?;
    match object.get("jsonrpc").and_then(Value::as_str) {
        Some("2.0") => Ok(()),
        _ => Err("OpenCode message requires jsonrpc 2.0".into()),
    }
}

fn cleanup_failed_start(child: &SharedChild, message: &str) -> String {
    let _ = child.kill();
    let _ = child.wait();
    message.to_string()
}

fn spawn_stdout_reader(mut stdout: ChildStdout, channel: Channel<AcpEvent>) {
    thread::Builder::new()
        .name("agni-acp-stdout".into())
        .spawn(move || {
            read_lf_records(&mut stdout, MAX_RPC_LINE_BYTES, |line, overflowed| {
                if overflowed {
                    return channel
                        .send(AcpEvent::ProtocolError {
                            message: "OpenCode sent an ACP record larger than 2 MiB".into(),
                        })
                        .is_ok();
                }
                let line = line.strip_suffix(b"\r").unwrap_or(line);
                if line.is_empty() {
                    return true;
                }
                match serde_json::from_slice(line) {
                    Ok(message) => channel.send(AcpEvent::Rpc { message }).is_ok(),
                    Err(error) => channel
                        .send(AcpEvent::ProtocolError {
                            message: format!("Invalid OpenCode ACP message: {error}"),
                        })
                        .is_ok(),
                }
            });
        })
        .expect("spawn OpenCode stdout reader");
}

fn spawn_stderr_reader(mut stderr: ChildStderr, channel: Channel<AcpEvent>) {
    thread::Builder::new()
        .name("agni-acp-stderr".into())
        .spawn(move || {
            read_lf_records(&mut stderr, MAX_STDERR_LINE_BYTES, |line, overflowed| {
                let message = if overflowed {
                    "OpenCode diagnostic output was truncated".into()
                } else {
                    String::from_utf8_lossy(line).trim().to_string()
                };
                if message.is_empty() {
                    true
                } else {
                    channel.send(AcpEvent::Stderr { message }).is_ok()
                }
            });
        })
        .expect("spawn OpenCode stderr reader");
}

fn spawn_waiter(
    id: u64,
    child: Arc<SharedChild>,
    state: Arc<Mutex<Option<Arc<AcpSession>>>>,
    channel: Channel<AcpEvent>,
) {
    thread::Builder::new()
        .name("agni-acp-waiter".into())
        .spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            if let Ok(mut slot) = state.lock() {
                if slot.as_ref().is_some_and(|session| session.id == id) {
                    slot.take();
                }
            }
            let _ = channel.send(AcpEvent::Exit { code });
            log::info!("OpenCode ACP exited id={id} code={code:?}");
        })
        .expect("spawn OpenCode waiter");
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn kill_process_tree(session: &AcpSession) {
    let pid = session.child.id();
    if pid <= i32::MAX as u32 {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    let _ = session.child.kill();
}

#[cfg(windows)]
fn kill_process_tree(session: &AcpSession) {
    let _ = session.child.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_requires_jsonrpc_envelope() {
        assert!(validate_message(&serde_json::json!({"jsonrpc": "2.0", "method": "initialize"})).is_ok());
        assert!(validate_message(&serde_json::json!({"jsonrpc": "1.0"})).is_err());
        assert!(validate_message(&serde_json::json!({"method": "initialize"})).is_err());
        assert!(validate_message(&serde_json::json!(["initialize"])).is_err());
    }

    #[test]
    fn resolves_known_agents_only() {
        let (program, args) = resolve_acp_agent("opencode").unwrap();
        assert_eq!(program, "opencode");
        assert_eq!(args, ["acp"]);
        let (program, args) = resolve_acp_agent("kilo").unwrap();
        assert_eq!(program, "kilo");
        assert_eq!(args, ["acp"]);
        assert!(resolve_acp_agent("nope").is_err());
    }
}
