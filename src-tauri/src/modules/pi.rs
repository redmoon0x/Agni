use std::io::{BufRead, Read, Write};
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

use crate::modules::workspace::{authorize_user_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

const MAX_RPC_LINE_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMMAND_BYTES: usize = 12 * 1024 * 1024;
const MAX_STDERR_LINE_BYTES: usize = 16 * 1024;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PiEvent {
    Rpc { message: Value },
    Stderr { message: String },
    ProtocolError { message: String },
    Exit { code: Option<i32> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiStartResult {
    session_id: u64,
}

struct PiSession {
    #[cfg(windows)]
    _job: Option<crate::modules::pty::job::PtyJob>,
    id: u64,
    child: Arc<SharedChild>,
    stdin: Mutex<std::process::ChildStdin>,
}

#[derive(Default)]
pub struct PiState {
    session: Arc<Mutex<Option<Arc<PiSession>>>>,
    next_id: AtomicU64,
}

impl Drop for PiState {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.session.lock() {
            if let Some(session) = slot.take() {
                kill_process_tree(&session);
            }
        }
    }
}

#[tauri::command]
pub async fn pi_start(
    state: tauri::State<'_, PiState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_event: Channel<PiEvent>,
) -> Result<PiStartResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let authorized_cwd = authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;

    let mut slot = state.session.lock().map_err(|_| "Pi state poisoned")?;
    if let Some(existing) = slot.as_ref() {
        if existing
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Err("Pi is already running".into());
        }
        slot.take();
    }

    let mut command = build_pi_command(cwd.as_deref(), &workspace)?;
    if let (WorkspaceEnv::Local, Some(path)) = (&workspace, authorized_cwd) {
        command.current_dir(path);
    }
    command
        .arg("--mode")
        .arg("rpc")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    crate::modules::proc::hide_console(&mut command);

    let child = Arc::new(SharedChild::spawn(&mut command).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Pi was not found. Install Pi and make sure `pi` is on PATH.".to_string()
        } else {
            format!("Could not start Pi: {e}")
        }
    })?);

    let stdin = child
        .take_stdin()
        .ok_or_else(|| cleanup_failed_start(&child, "Pi stdin was unavailable"))?;
    let stdout = child
        .take_stdout()
        .ok_or_else(|| cleanup_failed_start(&child, "Pi stdout was unavailable"))?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| cleanup_failed_start(&child, "Pi stderr was unavailable"))?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    #[cfg(windows)]
    let job = match crate::modules::pty::job::PtyJob::create_for(child.id()) {
        Ok(job) => Some(job),
        Err(error) => {
            log::warn!("Pi job-object setup failed for pid={}: {error}", child.id());
            None
        }
    };
    let session = Arc::new(PiSession {
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

    log::info!("Pi RPC started id={id}");
    Ok(PiStartResult { session_id: id })
}

#[tauri::command]
pub fn pi_send(
    state: tauri::State<'_, PiState>,
    session_id: u64,
    message: Value,
) -> Result<(), String> {
    validate_command(&message)?;
    let encoded = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
    if encoded.len() > MAX_COMMAND_BYTES {
        return Err("Pi command is too large".into());
    }

    let session = state
        .session
        .lock()
        .map_err(|_| "Pi state poisoned")?
        .as_ref()
        .filter(|session| session.id == session_id)
        .cloned()
        .ok_or_else(|| "Pi session is not running".to_string())?;
    let mut stdin = session.stdin.lock().map_err(|_| "Pi stdin poisoned")?;
    stdin.write_all(&encoded).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pi_stop(state: tauri::State<'_, PiState>, session_id: u64) -> Result<(), String> {
    let session = {
        let mut slot = state.session.lock().map_err(|_| "Pi state poisoned")?;
        match slot.as_ref() {
            Some(session) if session.id == session_id => slot.take(),
            Some(_) => return Err("Pi session changed".into()),
            None => return Ok(()),
        }
    };
    if let Some(session) = session {
        kill_process_tree(&session);
        log::info!("Pi RPC stopped id={session_id}");
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionEntry {
    path: String,
    name: Option<String>,
    timestamp: Option<String>,
}

const SESSION_SCAN_LINES: usize = 40;
const SESSION_TITLE_MAX_CHARS: usize = 60;

// pi only writes a `session_info.name` when an extension explicitly names the
// session (e.g. a Telegram bot). Most sessions have none, so fall back to the
// first user message as a title, same as chat apps title-by-first-message.
fn first_user_message_text(value: &Value) -> Option<String> {
    let message = value.get("message")?;
    if message.get("role")?.as_str()? != "user" {
        return None;
    }
    match message.get("content")? {
        Value::String(text) => Some(text.clone()),
        Value::Array(blocks) => blocks.iter().find_map(|block| {
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                block
                    .get("text")
                    .and_then(|t| t.as_str())
                    .map(str::to_string)
            } else {
                None
            }
        }),
        _ => None,
    }
}

fn truncate_title(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > SESSION_TITLE_MAX_CHARS {
        let truncated: String = collapsed.chars().take(SESSION_TITLE_MAX_CHARS).collect();
        format!("{truncated}…")
    } else {
        collapsed
    }
}

fn read_session_entry(path: &std::path::Path) -> Option<PiSessionEntry> {
    let file = std::fs::File::open(path).ok()?;
    let mut timestamp = None;
    let mut name: Option<String> = None;
    let mut explicit_name = false;

    for line in std::io::BufReader::new(file)
        .lines()
        .take(SESSION_SCAN_LINES)
    {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match value.get("type").and_then(|v| v.as_str()) {
            Some("session") if timestamp.is_none() => {
                timestamp = value
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
            Some("session_info") => {
                if let Some(explicit) = value.get("name").and_then(|v| v.as_str()) {
                    name = Some(explicit.to_string());
                    explicit_name = true;
                }
            }
            Some("message") if name.is_none() => {
                name = first_user_message_text(&value).map(|text| truncate_title(&text));
            }
            _ => {}
        }
        if timestamp.is_some() && (explicit_name || name.is_some()) {
            break;
        }
    }

    Some(PiSessionEntry {
        path: path.to_string_lossy().into_owned(),
        name,
        timestamp,
    })
}

#[tauri::command]
pub fn pi_list_sessions(session_file: String) -> Result<Vec<PiSessionEntry>, String> {
    let dir = std::path::Path::new(&session_file)
        .parent()
        .ok_or_else(|| "Invalid session file path".to_string())?;
    let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if let Some(session_entry) = read_session_entry(&path) {
            entries.push(session_entry);
        }
    }
    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(entries)
}

#[tauri::command]
pub fn pi_close_all(state: tauri::State<'_, PiState>) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "Pi state poisoned")?
        .take();
    if let Some(session) = session {
        kill_process_tree(&session);
    }
    Ok(())
}

fn build_pi_command(cwd: Option<&str>, workspace: &WorkspaceEnv) -> Result<Command, String> {
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = workspace {
        crate::modules::workspace::validate_wsl_distro_name(distro)?;
        let mut command = Command::new("wsl.exe");
        command.arg("-d").arg(distro);
        if let Some(cwd) = cwd.map(str::trim).filter(|cwd| !cwd.is_empty()) {
            command.arg("--cd").arg(cwd);
        }
        command.arg("--exec").arg("pi");
        return Ok(command);
    }
    #[cfg(not(windows))]
    if workspace.is_wsl() {
        return Err("WSL Pi sessions are only available on Windows".into());
    }
    Ok(Command::new(local_pi_program()))
}

#[cfg(windows)]
fn local_pi_program() -> PathBuf {
    const CANDIDATES: [&str; 3] = ["pi.exe", "pi.cmd", "pi.bat"];
    if let Some(path) = std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .flat_map(|directory| {
                CANDIDATES
                    .iter()
                    .map(move |candidate| directory.join(candidate))
            })
            .find(|candidate| candidate.is_file())
    }) {
        return path;
    }
    PathBuf::from("pi.exe")
}

#[cfg(not(windows))]
fn local_pi_program() -> &'static str {
    "pi"
}

fn validate_command(message: &Value) -> Result<(), String> {
    let object = message
        .as_object()
        .ok_or_else(|| "Pi command must be a JSON object".to_string())?;
    let command_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "Pi command requires a string type".to_string())?;
    if command_type.len() > 64
        || !command_type
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
    {
        return Err("Invalid Pi command type".into());
    }
    Ok(())
}

fn cleanup_failed_start(child: &SharedChild, message: &str) -> String {
    let _ = child.kill();
    let _ = child.wait();
    message.to_string()
}

fn spawn_stdout_reader(mut stdout: ChildStdout, channel: Channel<PiEvent>) {
    thread::Builder::new()
        .name("agni-pi-stdout".into())
        .spawn(move || {
            read_lf_records(&mut stdout, MAX_RPC_LINE_BYTES, |line, overflowed| {
                if overflowed {
                    return channel
                        .send(PiEvent::ProtocolError {
                            message: "Pi sent an RPC record larger than 2 MiB".into(),
                        })
                        .is_ok();
                }
                let line = line.strip_suffix(b"\r").unwrap_or(line);
                if line.is_empty() {
                    return true;
                }
                match serde_json::from_slice(line) {
                    Ok(message) => channel.send(PiEvent::Rpc { message }).is_ok(),
                    Err(error) => channel
                        .send(PiEvent::ProtocolError {
                            message: format!("Invalid Pi RPC response: {error}"),
                        })
                        .is_ok(),
                }
            });
        })
        .expect("spawn Pi stdout reader");
}

fn spawn_stderr_reader(mut stderr: ChildStderr, channel: Channel<PiEvent>) {
    thread::Builder::new()
        .name("agni-pi-stderr".into())
        .spawn(move || {
            read_lf_records(&mut stderr, MAX_STDERR_LINE_BYTES, |line, overflowed| {
                let message = if overflowed {
                    "Pi diagnostic output was truncated".into()
                } else {
                    String::from_utf8_lossy(line).trim().to_string()
                };
                if message.is_empty() {
                    true
                } else {
                    channel.send(PiEvent::Stderr { message }).is_ok()
                }
            });
        })
        .expect("spawn Pi stderr reader");
}

fn spawn_waiter(
    id: u64,
    child: Arc<SharedChild>,
    state: Arc<Mutex<Option<Arc<PiSession>>>>,
    channel: Channel<PiEvent>,
) {
    thread::Builder::new()
        .name("agni-pi-waiter".into())
        .spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            if let Ok(mut slot) = state.lock() {
                if slot.as_ref().is_some_and(|session| session.id == id) {
                    slot.take();
                }
            }
            let _ = channel.send(PiEvent::Exit { code });
            log::info!("Pi RPC exited id={id} code={code:?}");
        })
        .expect("spawn Pi waiter");
}

fn read_lf_records<R, F>(reader: &mut R, limit: usize, mut on_record: F)
where
    R: Read,
    F: FnMut(&[u8], bool) -> bool,
{
    let mut read_buffer = [0u8; 8192];
    let mut record = Vec::with_capacity(8192);
    let mut overflowed = false;
    loop {
        let count = match reader.read(&mut read_buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        for &byte in &read_buffer[..count] {
            if byte == b'\n' {
                if !on_record(&record, overflowed) {
                    return;
                }
                record.clear();
                overflowed = false;
            } else if !overflowed {
                if record.len() < limit {
                    record.push(byte);
                } else {
                    record.clear();
                    overflowed = true;
                }
            }
        }
    }
    if !record.is_empty() || overflowed {
        on_record(&record, overflowed);
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn kill_process_tree(session: &PiSession) {
    let pid = session.child.id();
    if pid <= i32::MAX as u32 {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    let _ = session.child.kill();
}

#[cfg(windows)]
fn kill_process_tree(session: &PiSession) {
    let _ = session.child.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_requires_safe_type() {
        assert!(validate_command(&serde_json::json!({"type": "get_state"})).is_ok());
        assert!(validate_command(&serde_json::json!({"type": "set-model"})).is_err());
        assert!(validate_command(&serde_json::json!({"message": "hello"})).is_err());
        assert!(validate_command(&serde_json::json!([])).is_err());
    }

    #[test]
    fn lf_records_preserve_unicode_separators() {
        let source = b"{\"message\":\"a\xE2\x80\xA8b\"}\n{\"type\":\"done\"}\r\n";
        let mut records = Vec::new();
        read_lf_records(&mut &source[..], 1024, |line, overflowed| {
            records.push((line.to_vec(), overflowed));
            true
        });
        assert_eq!(records.len(), 2);
        assert!(records[0]
            .0
            .windows(3)
            .any(|part| part == [0xE2, 0x80, 0xA8]));
        assert!(!records[0].1);
    }

    #[test]
    fn oversized_record_is_discarded_without_losing_next_record() {
        let source = b"123456789\nok\n";
        let mut records = Vec::new();
        read_lf_records(&mut &source[..], 4, |line, overflowed| {
            records.push((line.to_vec(), overflowed));
            true
        });
        assert_eq!(records, vec![(Vec::new(), true), (b"ok".to_vec(), false)]);
    }

    #[cfg(windows)]
    #[test]
    fn discovered_pi_shim_is_spawnable_when_installed() {
        let program = local_pi_program();
        if !program.is_file() {
            return;
        }
        let output = Command::new(program)
            .arg("--version")
            .output()
            .expect("spawn discovered Pi executable");
        assert!(output.status.success());
    }
}
