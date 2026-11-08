use std::io::Write;
#[cfg(windows)]
use std::path::PathBuf;
use std::process::{ChildStderr, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use shared_child::SharedChild;
use tauri::ipc::Channel;

use crate::modules::jsonl::{
    read_lf_records, MAX_OUTBOUND_PROTOCOL_RECORD_BYTES, MAX_PROTOCOL_RECORD_BYTES,
};
use crate::modules::workspace::{authorize_user_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

const MAX_STDERR_LINE_BYTES: usize = 16 * 1024;
const ACP_REGISTRY_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const ACP_REGISTRY_MAX_BYTES: usize = 2 * 1024 * 1024;
const ACP_REGISTRY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

#[derive(Deserialize)]
struct RawAcpRegistry {
    version: String,
    agents: Vec<RawAcpRegistryAgent>,
}

#[derive(Deserialize)]
struct RawAcpRegistryAgent {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    website: Option<String>,
    #[serde(default)]
    authors: Vec<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    distribution: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpRegistry {
    version: String,
    agents: Vec<AcpRegistryAgent>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpRegistryAgent {
    id: String,
    name: String,
    version: String,
    description: String,
    repository: Option<String>,
    website: Option<String>,
    authors: Vec<String>,
    license: Option<String>,
    distribution: AcpRegistryDistribution,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpInstallSpec {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpDownloadSpec {
    pub url: String,
    pub sha256: String,
    /// `zip` | `tar.gz` | `raw`
    pub archive: String,
    pub binary_target: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpRegistryDistribution {
    /// `npx` | `binary` | `uvx` | `other`
    pub kind: String,
    pub install: Option<AcpInstallSpec>,
    pub download: Option<AcpDownloadSpec>,
    /// Legacy display-only command; kept while older UI builds render it.
    pub install_command: Option<String>,
}

/// ACP-speaking agents Agni can launch. One row per agent keeps launch data,
/// display label, availability probe and per-agent env quirks together, so
/// orchestration never needs a per-agent branch. `agent.rs` reads the probe
/// program from here; the frontend mirrors the catalog via `acp_agents`.
pub struct AcpAgentDescriptor {
    pub id: &'static str,
    pub label: &'static str,
    pub program: &'static str,
    pub args: &'static [&'static str],
    /// Program probed for PATH availability, which can differ from `program`
    /// (Claude launches Zed's npx adapter but is offered when `claude` exists).
    pub probe_program: &'static str,
    pub extra_env: &'static [(&'static str, &'static str)],
}

const ACP_AGENTS: &[AcpAgentDescriptor] = &[
    AcpAgentDescriptor {
        id: "opencode",
        label: "OpenCode",
        program: "opencode",
        args: &["acp"],
        probe_program: "opencode",
        extra_env: &[],
    },
    AcpAgentDescriptor {
        id: "kilo",
        label: "Kilo Code",
        program: "kilo",
        args: &["acp"],
        probe_program: "kilo",
        extra_env: &[],
    },
    AcpAgentDescriptor {
        id: "commandcode",
        label: "CommandCode",
        program: "commandcode",
        args: &["acp"],
        probe_program: "commandcode",
        extra_env: &[],
    },
    AcpAgentDescriptor {
        id: "claude",
        label: "Claude Code",
        program: "npx",
        args: &["-y", "@zed-industries/claude-code-acp"],
        probe_program: "claude",
        extra_env: &[],
    },
    AcpAgentDescriptor {
        id: "hermes",
        label: "Hermes",
        program: "hermes",
        args: &["acp"],
        probe_program: "hermes",
        extra_env: &[],
    },
    AcpAgentDescriptor {
        id: "omp",
        label: "OMP",
        program: "omp",
        args: &["acp"],
        probe_program: "omp",
        extra_env: &[],
    },
];

/// `(id, probe_program)` for every ACP agent, used by availability probing.
pub fn agent_probes() -> Vec<(&'static str, &'static str)> {
    ACP_AGENTS
        .iter()
        .map(|agent| (agent.id, agent.probe_program))
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpAgentCatalogEntry {
    id: String,
    label: String,
    program: String,
    args: Vec<String>,
    probe_program: String,
}

#[tauri::command]
pub fn acp_agents() -> Vec<AcpAgentCatalogEntry> {
    ACP_AGENTS
        .iter()
        .map(|agent| AcpAgentCatalogEntry {
            id: agent.id.to_string(),
            label: agent.label.to_string(),
            program: agent.program.to_string(),
            args: agent.args.iter().map(|arg| (*arg).to_string()).collect(),
            probe_program: agent.probe_program.to_string(),
        })
        .collect()
}

fn resolve_acp_agent(agent: &str) -> Result<&'static AcpAgentDescriptor, String> {
    ACP_AGENTS
        .iter()
        .find(|descriptor| descriptor.id == agent)
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
    agent: String,
    child: Arc<SharedChild>,
    stdin: Mutex<std::process::ChildStdin>,
}

/// Hard cap on concurrent agent processes. Each session owns a process tree, so
/// this is a safety valve, not a product limit.
const ACP_MAX_SESSIONS: usize = 8;

type SessionTable = Arc<Mutex<std::collections::HashMap<u64, Arc<AcpSession>>>>;

#[derive(Default)]
pub struct AcpState {
    sessions: SessionTable,
    next_id: AtomicU64,
}

impl Drop for AcpState {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                kill_process_tree(&session);
            }
        }
    }
}

#[tauri::command]
pub async fn acp_registry_list() -> Result<AcpRegistry, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(ACP_REGISTRY_TIMEOUT)
        .timeout(ACP_REGISTRY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Agni ACP discovery")
        .build()
        .map_err(|error| format!("Could not create registry client: {error}"))?;
    let response = client
        .get(ACP_REGISTRY_URL)
        .send()
        .await
        .map_err(|error| format!("Could not load the ACP Registry: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The ACP Registry returned an error: {error}"))?;

    if response
        .content_length()
        .is_some_and(|length| length > ACP_REGISTRY_MAX_BYTES as u64)
    {
        return Err("The ACP Registry response is too large".into());
    }

    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Could not read the ACP Registry: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > ACP_REGISTRY_MAX_BYTES {
            return Err("The ACP Registry response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }

    let registry: RawAcpRegistry = serde_json::from_slice(&bytes)
        .map_err(|error| format!("The ACP Registry data is invalid: {error}"))?;
    if registry.version.is_empty() || registry.version.len() > 32 {
        return Err("The ACP Registry version is invalid".into());
    }

    Ok(AcpRegistry {
        version: registry.version,
        agents: registry
            .agents
            .into_iter()
            .filter_map(sanitize_registry_agent)
            .take(250)
            .collect(),
    })
}

fn sanitize_registry_agent(agent: RawAcpRegistryAgent) -> Option<AcpRegistryAgent> {
    if !is_registry_id(&agent.id)
        || !is_registry_text(&agent.name, 120)
        || !is_registry_text(&agent.version, 64)
        || agent.description.len() > 2_000
    {
        return None;
    }

    Some(AcpRegistryAgent {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        description: agent.description.trim().to_string(),
        repository: agent.repository.and_then(sanitize_registry_url),
        website: agent.website.and_then(sanitize_registry_url),
        authors: agent
            .authors
            .into_iter()
            .filter(|author| is_registry_text(author, 160))
            .take(10)
            .collect(),
        license: agent
            .license
            .filter(|license| is_registry_text(license, 160)),
        distribution: registry_distribution(&agent.distribution),
    })
}

pub(crate) fn is_registry_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn is_registry_text(value: &str, max_len: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max_len && !value.chars().any(char::is_control)
}

fn sanitize_registry_url(value: String) -> Option<String> {
    let parsed = reqwest::Url::parse(&value).ok()?;
    (parsed.scheme() == "https" && parsed.host_str().is_some()).then_some(value)
}

fn registry_distribution(distribution: &Value) -> AcpRegistryDistribution {
    let npx = distribution
        .get("npx")
        .and_then(|value| package_install(value, "npx"));
    let uvx = distribution
        .get("uvx")
        .and_then(|value| package_install(value, "uvx"));
    let download = distribution.get("binary").and_then(binary_download);

    let (kind, install) = if download.is_some() {
        ("binary", None)
    } else if let Some(spec) = npx {
        ("npx", Some(spec))
    } else if let Some(spec) = uvx {
        ("uvx", Some(spec))
    } else if distribution.get("binary").is_some() {
        ("binary", None)
    } else {
        ("other", None)
    };

    AcpRegistryDistribution {
        kind: kind.into(),
        install_command: install.as_ref().map(|spec| {
            std::iter::once(spec.program.clone())
                .chain(std::iter::once("--yes".to_string()))
                .chain(spec.args.iter().cloned())
                .collect::<Vec<_>>()
                .join(" ")
        }),
        install,
        download,
    }
}

fn package_install(value: &Value, program: &str) -> Option<AcpInstallSpec> {
    let object = value.as_object()?;
    let package = object.get("package").and_then(Value::as_str)?;
    let args = safe_args(object.get("args"))?;
    if !is_shell_token(package) {
        return None;
    }
    let mut resolved = vec![package.to_string()];
    resolved.extend(args);
    Some(AcpInstallSpec {
        program: program.to_string(),
        args: resolved,
    })
}

fn safe_args(value: Option<&Value>) -> Option<Vec<String>> {
    let values = match value {
        Some(Value::Array(values)) => values,
        Some(_) => return None,
        None => return Some(Vec::new()),
    };
    if values.len() > 20 {
        return None;
    }
    let mut args = Vec::with_capacity(values.len());
    for value in values {
        let argument = value.as_str()?;
        if !is_shell_token(argument) {
            return None;
        }
        args.push(argument.to_string());
    }
    Some(args)
}

/// Parse a `binary` distribution. The registry lists per-platform entries; we
/// pick the one matching this OS/arch and require a checksum and https URL.
fn binary_download(value: &Value) -> Option<AcpDownloadSpec> {
    let object = value.as_object()?;
    let entry = if object.contains_key("url") {
        Some(object)
    } else {
        let keys = platform_keys();
        object
            .iter()
            .filter_map(|(key, entry)| {
                let lowered = key.to_ascii_lowercase();
                entry
                    .as_object()
                    .filter(|_| platform_matches(&lowered, &keys))
            })
            .next()
    }?;

    let url = entry.get("url").and_then(Value::as_str)?;
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return None;
    }
    let sha256 = entry
        .get("sha256")
        .or_else(|| entry.get("checksum"))
        .and_then(Value::as_str)?
        .trim()
        .trim_start_matches("sha256:")
        .to_ascii_lowercase();
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let archive = archive_kind(entry, url)?;
    let binary_target = entry
        .get("binaryTarget")
        .or_else(|| entry.get("cmd"))
        .or_else(|| entry.get("path"))
        .or_else(|| entry.get("executable"))
        .and_then(Value::as_str)
        .and_then(sanitize_relative_path);

    Some(AcpDownloadSpec {
        url: url.to_string(),
        sha256,
        archive,
        binary_target,
    })
}

fn archive_kind(entry: &serde_json::Map<String, Value>, url: &str) -> Option<String> {
    let explicit = entry
        .get("archive")
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase());
    if let Some(explicit) = explicit {
        return match explicit.as_str() {
            "zip" => Some("zip".into()),
            "tar.gz" | "tgz" => Some("tar.gz".into()),
            "raw" => Some("raw".into()),
            _ => None,
        };
    }
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".zip") {
        Some("zip".into())
    } else if path.ends_with(".tar.gz") || path.ends_with(".tgz") {
        Some("tar.gz".into())
    } else {
        Some("raw".into())
    }
}

fn sanitize_relative_path(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_start_matches("./");
    if trimmed.is_empty() || trimmed.len() > 256 {
        return None;
    }
    if trimmed.starts_with('/') || trimmed.contains("..") || trimmed.contains(':') {
        return None;
    }
    Some(trimmed.to_string())
}

fn platform_keys() -> Vec<String> {
    let os = std::env::consts::OS.to_ascii_lowercase();
    let arch = std::env::consts::ARCH.to_ascii_lowercase();
    let os_names: &[&str] = match os.as_str() {
        "macos" => &["darwin", "macos", "mac"],
        "windows" => &["windows", "win32", "win"],
        _ => &["linux"],
    };
    let arch_names: &[&str] = match arch.as_str() {
        "x86_64" => &["x86_64", "x64", "amd64"],
        "aarch64" => &["aarch64", "arm64"],
        other => return vec![other.to_string()],
    };
    let mut keys = Vec::new();
    for os_name in os_names {
        for arch_name in arch_names {
            keys.push(format!("{os_name}-{arch_name}"));
            keys.push(format!("{arch_name}-{os_name}"));
        }
    }
    keys
}

fn platform_matches(key: &str, keys: &[String]) -> bool {
    keys.iter().any(|candidate| key.contains(candidate))
        || matches!(key, "all" | "universal" | "any" | "*")
}

fn is_shell_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'@' | b'%' | b'_' | b'+' | b'.' | b',' | b'/' | b':' | b'=' | b'-'
                )
        })
}

#[tauri::command]
pub async fn acp_start(
    state: tauri::State<'_, AcpState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    agent: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    profile_env: Option<Vec<AcpEnvVar>>,
    extra_args: Option<Vec<String>>,
    on_event: Channel<AcpEvent>,
) -> Result<AcpStartResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let authorized_cwd = authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let descriptor = resolve_acp_agent(&agent)?;

    let mut command = build_acp_command(&agent, cwd.as_deref(), &workspace)?;
    if let Some(extra) = extra_args.as_deref() {
        validate_managed_args(extra)?;
        command.args(extra);
    }
    if let Some(env) = profile_env.as_deref() {
        validate_managed_env(env)?;
        for (name, value) in resolve_env(env)? {
            command.env(name, value);
        }
    }
    if let (WorkspaceEnv::Local, Some(path)) = (&workspace, authorized_cwd) {
        command.current_dir(path);
    }
    spawn_session(
        state.inner(),
        descriptor.label.to_string(),
        agent,
        command,
        on_event,
    )
}

/// Shared spawn path for built-in and registry-installed agents. Each session
/// owns its own `Channel`, so reader threads never need to tag events.
fn spawn_session(
    state: &AcpState,
    label: String,
    agent: String,
    mut command: Command,
    on_event: Channel<AcpEvent>,
) -> Result<AcpStartResult, String> {
    {
        let sessions = state.sessions.lock().map_err(|_| "ACP state poisoned")?;
        if sessions.len() >= ACP_MAX_SESSIONS {
            return Err(format!(
                "Too many ACP agents are running ({ACP_MAX_SESSIONS} maximum)"
            ));
        }
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
        .ok_or_else(|| cleanup_failed_start(&child, "ACP stdin was unavailable"))?;
    let stdout = child
        .take_stdout()
        .ok_or_else(|| cleanup_failed_start(&child, "ACP stdout was unavailable"))?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| cleanup_failed_start(&child, "ACP stderr was unavailable"))?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    #[cfg(windows)]
    let job = match crate::modules::pty::job::PtyJob::create_for(child.id()) {
        Ok(job) => Some(job),
        Err(error) => {
            log::warn!("ACP job-object setup failed for pid={}: {error}", child.id());
            None
        }
    };
    let session = Arc::new(AcpSession {
        #[cfg(windows)]
        _job: job,
        id,
        agent: agent.clone(),
        child: Arc::clone(&child),
        stdin: Mutex::new(stdin),
    });
    state
        .sessions
        .lock()
        .map_err(|_| "ACP state poisoned")?
        .insert(id, Arc::clone(&session));

    spawn_stdout_reader(stdout, Arc::clone(&session), label, on_event.clone());
    spawn_stderr_reader(stderr, on_event.clone());
    spawn_waiter(id, child, Arc::clone(&state.sessions), on_event);

    log::info!("ACP session started id={id} agent={agent}");
    Ok(AcpStartResult { session_id: id })
}

#[derive(Deserialize)]
pub struct AcpEnvVar {
    pub name: String,
    #[serde(default)]
    pub value: Option<String>,
    /// Keychain account name; resolved in Rust so the value never crosses IPC
    /// except for terminal sign-in.
    #[serde(default)]
    pub secret: Option<String>,
}

/// Resolve env entries, reading secret references through `read`. Split out so
/// the mapping logic is testable without a keychain.
#[cfg(test)]
pub(crate) fn resolve_env_with(
    env: &[AcpEnvVar],
    read: &dyn Fn(&str) -> Result<String, String>,
) -> Result<Vec<(String, String)>, String> {
    let mut resolved = Vec::with_capacity(env.len());
    for variable in env {
        let value = match (&variable.value, &variable.secret) {
            (Some(value), _) => value.clone(),
            (None, Some(account)) => read(account)?,
            _ => {
                return Err(format!(
                    "Environment variable {} has no value",
                    variable.name
                ))
            }
        };
        resolved.push((variable.name.clone(), value));
    }
    Ok(resolved)
}

pub(crate) fn resolve_env(env: &[AcpEnvVar]) -> Result<Vec<(String, String)>, String> {
    let mut resolved = Vec::with_capacity(env.len());
    for variable in env {
        let value = match (&variable.value, &variable.secret) {
            (Some(value), _) => expand_tilde(value),
            (None, Some(account)) => crate::modules::secrets::read_secret(account)?,
            _ => {
                return Err(format!(
                    "Environment variable {} has no value",
                    variable.name
                ))
            }
        };
        resolved.push((variable.name.clone(), value));
    }
    Ok(resolved)
}

/// Expand a leading `~` so profile config directories can be written like T3's.
fn expand_tilde(value: &str) -> String {
    let Some(home) = dirs::home_dir() else {
        return value.to_string();
    };
    if value == "~" {
        return home.to_string_lossy().to_string();
    }
    if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return home.join(rest).to_string_lossy().to_string();
    }
    value.to_string()
}

fn managed_agents_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("acp").join("agents"))
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))
}

/// A managed agent runs either an absolute executable inside Agni's install
/// directory or one of the package runners. Anything else is rejected so a
/// compromised registry entry cannot launch arbitrary host binaries.
fn resolve_managed_program(app: &tauri::AppHandle, program: &str) -> Result<PathBuf, String> {
    if program == "npx" || program == "uvx" {
        return Ok(local_program(program));
    }
    // Dev-only replay agent runs `node scripts/dev-replay-agent.mjs`.
    #[cfg(debug_assertions)]
    if program == "node" {
        return Ok(local_program(program));
    }
    let candidate = std::path::Path::new(program);
    if !candidate.is_absolute() {
        return Err("A managed agent program must be an absolute path".into());
    }
    let root = managed_agents_root(app)?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("Agni's agent directory is unavailable: {error}"))?;
    let resolved = candidate
        .canonicalize()
        .map_err(|error| format!("The managed agent program is missing: {error}"))?;
    if !resolved.starts_with(&root) {
        return Err("The managed agent program is outside Agni's install directory".into());
    }
    Ok(resolved)
}

fn validate_managed_args(args: &[String]) -> Result<(), String> {
    if args.len() > 20 {
        return Err("The agent has too many arguments".into());
    }
    if !args.iter().all(|arg| is_shell_token(arg)) {
        return Err("The agent has an invalid argument".into());
    }
    Ok(())
}

/// A user-supplied ACP executable. It is launched directly (never through a
/// shell), so spaces in a path are fine; control characters are not.
fn validate_custom_program(program: &str) -> Result<String, String> {
    let trimmed = program.trim();
    if trimmed.is_empty()
        || trimmed.len() > 512
        || trimmed.contains('\0')
        || trimmed.contains('\n')
        || trimmed.contains('\r')
    {
        return Err("The ACP command is invalid".into());
    }
    Ok(trimmed.to_string())
}

/// Literal arguments are passed straight to the process (no shell), so they may
/// contain spaces or path separators; only control characters are rejected.
pub(crate) fn validate_custom_args(args: &[String]) -> Result<(), String> {
    if args.len() > 32 {
        return Err("The ACP command has too many arguments".into());
    }
    if args.iter().any(|arg| {
        arg.len() > 512
            || arg.contains('\0')
            || arg.contains('\n')
            || arg.contains('\r')
    }) {
        return Err("The ACP command has an invalid argument".into());
    }
    Ok(())
}

pub(crate) fn validate_managed_env(env: &[AcpEnvVar]) -> Result<(), String> {
    if env.len() > 32 {
        return Err("The agent has too many environment variables".into());
    }
    for variable in env {
        let name_ok = !variable.name.is_empty()
            && variable.name.len() <= 128
            && variable
                .name
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
            && variable
                .name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
        let value_ok = match (&variable.value, &variable.secret) {
            (Some(value), _) => value.len() <= 4096 && !value.contains('\0'),
            (None, Some(account)) => {
                !account.is_empty()
                    && account.len() <= 200
                    && account
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-' | b'.'))
            }
            (None, None) => false,
        };
        if !name_ok || !value_ok {
            return Err("The agent has an invalid environment variable".into());
        }
    }
    Ok(())
}

/// Start an ACP agent installed from the registry (npx/uvx runner or a managed
/// binary). Built-in agents go through `acp_start` instead.
#[tauri::command]
pub async fn acp_start_managed(
    app: tauri::AppHandle,
    state: tauri::State<'_, AcpState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    agent: String,
    label: Option<String>,
    program: String,
    args: Option<Vec<String>>,
    env: Option<Vec<AcpEnvVar>>,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_event: Channel<AcpEvent>,
) -> Result<AcpStartResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_wsl() {
        return Err("Registry agents run on the host; pick a local workspace".into());
    }
    if agent.is_empty() || agent.len() > 100 || !is_registry_id(&agent) {
        return Err("The agent id is invalid".into());
    }
    let authorized_cwd = authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let args = args.unwrap_or_default();
    validate_managed_args(&args)?;
    let env = env.unwrap_or_default();
    validate_managed_env(&env)?;
    let env_values = resolve_env(&env)?;
    let program_path = resolve_managed_program(&app, &program)?;

    let mut command = Command::new(program_path);
    command.args(args);
    for (name, value) in &env_values {
        command.env(name, value);
    }
    if let Some(path) = authorized_cwd {
        command.current_dir(path);
    }
    let label = label
        .filter(|value| !value.trim().is_empty() && value.len() <= 80)
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| agent.clone());
    spawn_session(state.inner(), label, agent, command, on_event)
}

/// Run any ACP-compatible command the user configured (a local harness). The
/// command is explicit configuration, launched without a shell; registry and
/// built-in agents keep their stricter allowlists.
#[tauri::command]
pub async fn acp_start_custom(
    state: tauri::State<'_, AcpState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    agent: String,
    label: Option<String>,
    program: String,
    args: Option<Vec<String>>,
    env: Option<Vec<AcpEnvVar>>,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_event: Channel<AcpEvent>,
) -> Result<AcpStartResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_wsl() {
        return Err("Custom ACP commands run on the host; pick a local workspace".into());
    }
    if agent.is_empty() || agent.len() > 100 {
        return Err("The agent id is invalid".into());
    }
    let authorized_cwd = authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let program = validate_custom_program(&program)?;
    let args = args.unwrap_or_default();
    validate_custom_args(&args)?;
    let env = env.unwrap_or_default();
    validate_managed_env(&env)?;
    let env_values = resolve_env(&env)?;

    // Bare names go through the platform shim lookup (npx.cmd on Windows);
    // paths are used exactly as configured.
    let program_path = if program.contains('/') || program.contains('\\') {
        PathBuf::from(&program)
    } else {
        local_program(&program)
    };
    let mut command = Command::new(program_path);
    command.args(&args);
    for (name, value) in &env_values {
        command.env(name, value);
    }
    if let Some(path) = authorized_cwd {
        command.current_dir(path);
    }
    let label = label
        .filter(|value| !value.trim().is_empty() && value.len() <= 80)
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| program.clone());
    spawn_session(state.inner(), label, agent, command, on_event)
}

#[tauri::command]
pub fn acp_send(
    state: tauri::State<'_, AcpState>,
    session_id: u64,
    message: Value,
) -> Result<(), String> {
    validate_message(&message)?;
    let encoded = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
    if encoded.len() > MAX_OUTBOUND_PROTOCOL_RECORD_BYTES {
        return Err("ACP message is too large (12 MiB maximum)".into());
    }

    let session = state
        .sessions
        .lock()
        .map_err(|_| "ACP state poisoned")?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "ACP session is not running".to_string())?;
    let mut stdin = session.stdin.lock().map_err(|_| "ACP stdin poisoned")?;
    stdin.write_all(&encoded).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn acp_stop(state: tauri::State<'_, AcpState>, session_id: u64) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "ACP state poisoned")?
        .remove(&session_id);
    if let Some(session) = session {
        kill_process_tree(&session);
        log::info!("ACP session stopped id={session_id}");
    }
    Ok(())
}

#[tauri::command]
pub fn acp_close_all(state: tauri::State<'_, AcpState>) -> Result<(), String> {
    let sessions = {
        let mut table = state.sessions.lock().map_err(|_| "ACP state poisoned")?;
        table.drain().map(|(_, session)| session).collect::<Vec<_>>()
    };
    for session in sessions {
        kill_process_tree(&session);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpRunningSession {
    session_id: u64,
    agent: String,
}

/// Live process ids, for diagnostics and for reaping after a webview reload.
#[tauri::command]
pub fn acp_sessions(state: tauri::State<'_, AcpState>) -> Result<Vec<AcpRunningSession>, String> {
    let table = state.sessions.lock().map_err(|_| "ACP state poisoned")?;
    Ok(table
        .values()
        .map(|session| AcpRunningSession {
            session_id: session.id,
            agent: session.agent.clone(),
        })
        .collect())
}

fn build_acp_command(
    agent: &str,
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Command, String> {
    let descriptor = resolve_acp_agent(agent)?;
    let mut command = build_program_command(descriptor, cwd, workspace)?;
    for (name, value) in descriptor.extra_env {
        command.env(name, value);
    }
    Ok(command)
}

/// Launch `descriptor` in the workspace. WSL goes through `wsl.exe -d <distro>`;
/// every other platform runs the program directly and rejects WSL workspaces.
fn build_program_command(
    descriptor: &AcpAgentDescriptor,
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Command, String> {
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = workspace {
        crate::modules::workspace::validate_wsl_distro_name(distro)?;
        let mut command = Command::new("wsl.exe");
        command.arg("-d").arg(distro);
        if let Some(cwd) = cwd.map(str::trim).filter(|cwd| !cwd.is_empty()) {
            command.arg("--cd").arg(cwd);
        }
        command.arg("--exec").arg(descriptor.program);
        command.args(descriptor.args.iter().copied());
        return Ok(command);
    }
    #[cfg(not(windows))]
    if workspace.is_wsl() {
        return Err("WSL ACP sessions are only available on Windows".into());
    }
    let mut command = Command::new(local_program(descriptor.program));
    command.args(descriptor.args.iter().copied());
    Ok(command)
}

#[cfg(windows)]
pub(crate) fn local_program(program: &str) -> PathBuf {
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
pub(crate) fn local_program(program: &str) -> PathBuf {
    PathBuf::from(program)
}

fn validate_message(message: &Value) -> Result<(), String> {
    let object = message
        .as_object()
        .ok_or_else(|| "ACP message must be a JSON object".to_string())?;
    match object.get("jsonrpc").and_then(Value::as_str) {
        Some("2.0") => Ok(()),
        _ => Err("ACP message requires jsonrpc 2.0".into()),
    }
}

fn cleanup_failed_start(child: &SharedChild, message: &str) -> String {
    let _ = child.kill();
    let _ = child.wait();
    message.to_string()
}

fn spawn_stdout_reader(
    mut stdout: ChildStdout,
    session: Arc<AcpSession>,
    label: String,
    channel: Channel<AcpEvent>,
) {
    thread::Builder::new()
        .name("agni-acp-stdout".into())
        .spawn(move || {
            read_lf_records(&mut stdout, MAX_PROTOCOL_RECORD_BYTES, |line, overflowed| {
                if overflowed {
                    let _ = channel.send(AcpEvent::ProtocolError {
                        message: format!(
                            "{label} sent an ACP record larger than 16 MiB. The session was stopped to keep the protocol synchronized."
                        ),
                    });
                    kill_process_tree(&session);
                    return false;
                }
                let line = line.strip_suffix(b"\r").unwrap_or(line);
                if line.is_empty() {
                    return true;
                }
                match serde_json::from_slice(line) {
                    Ok(message) => channel.send(AcpEvent::Rpc { message }).is_ok(),
                    Err(error) => channel
                        .send(AcpEvent::ProtocolError {
                            message: format!("Invalid ACP message: {error}"),
                        })
                        .is_ok(),
                }
            });
        })
        .expect("spawn ACP stdout reader");
}

fn spawn_stderr_reader(mut stderr: ChildStderr, channel: Channel<AcpEvent>) {
    thread::Builder::new()
        .name("agni-acp-stderr".into())
        .spawn(move || {
            read_lf_records(&mut stderr, MAX_STDERR_LINE_BYTES, |line, overflowed| {
                let message = if overflowed {
                    "ACP diagnostic output was truncated".into()
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
        .expect("spawn ACP stderr reader");
}

fn spawn_waiter(
    id: u64,
    child: Arc<SharedChild>,
    sessions: SessionTable,
    channel: Channel<AcpEvent>,
) {
    thread::Builder::new()
        .name("agni-acp-waiter".into())
        .spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            if let Ok(mut table) = sessions.lock() {
                table.remove(&id);
            }
            let _ = channel.send(AcpEvent::Exit { code });
            log::info!("ACP session exited id={id} code={code:?}");
        })
        .expect("spawn ACP waiter");
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
        let descriptor = resolve_acp_agent("opencode").unwrap();
        assert_eq!(descriptor.program, "opencode");
        assert_eq!(descriptor.args, ["acp"]);
        assert_eq!(descriptor.label, "OpenCode");
        let descriptor = resolve_acp_agent("kilo").unwrap();
        assert_eq!(descriptor.program, "kilo");
        assert_eq!(descriptor.args, ["acp"]);
        assert_eq!(descriptor.label, "Kilo Code");
        let descriptor = resolve_acp_agent("commandcode").unwrap();
        assert_eq!(descriptor.program, "commandcode");
        assert_eq!(descriptor.args, ["acp"]);
        let descriptor = resolve_acp_agent("claude").unwrap();
        assert_eq!(descriptor.program, "npx");
        assert_eq!(descriptor.args, ["-y", "@zed-industries/claude-code-acp"]);
        assert_eq!(descriptor.probe_program, "claude");
        let descriptor = resolve_acp_agent("hermes").unwrap();
        assert_eq!(descriptor.program, "hermes");
        assert_eq!(descriptor.args, ["acp"]);
        let descriptor = resolve_acp_agent("omp").unwrap();
        assert_eq!(descriptor.program, "omp");
        assert_eq!(descriptor.args, ["acp"]);
        assert_eq!(descriptor.probe_program, "omp");
        assert!(resolve_acp_agent("nope").is_err());
    }

    #[test]
    fn env_resolution_reads_secret_references() {
        let env = vec![
            AcpEnvVar {
                name: "PLAIN".into(),
                value: Some("x".into()),
                secret: None,
            },
            AcpEnvVar {
                name: "SECRET".into(),
                value: None,
                secret: Some("profile:KEY".into()),
            },
        ];
        let resolved = resolve_env_with(&env, &|account| Ok(format!("secret:{account}")))
            .expect("resolves");
        assert_eq!(
            resolved,
            vec![
                ("PLAIN".to_string(), "x".to_string()),
                ("SECRET".to_string(), "secret:profile:KEY".to_string()),
            ]
        );
    }

    #[test]
    fn env_resolution_rejects_empty_entries() {
        let env = vec![AcpEnvVar {
            name: "EMPTY".into(),
            value: None,
            secret: None,
        }];
        assert!(resolve_env_with(&env, &|_| Ok("x".into())).is_err());
        assert!(validate_managed_env(&env).is_err());
    }

    #[test]
    fn tilde_expansion_leaves_non_paths_alone() {
        assert_eq!(expand_tilde("relative/path"), "relative/path");
        assert_eq!(expand_tilde("C:\\abs"), "C:\\abs");
    }

    #[test]
    fn custom_programs_are_sanitized() {
        assert_eq!(validate_custom_program("  npx  ").unwrap(), "npx");
        assert!(validate_custom_program("C:\\Program Files\\agent.exe").is_ok());
        assert!(validate_custom_program("").is_err());
        assert!(validate_custom_program("agent\n--evil").is_err());
        assert!(validate_custom_program(&"x".repeat(513)).is_err());
    }

    #[test]
    fn custom_args_allow_paths_but_reject_control_characters() {
        assert!(validate_custom_args(&[
            "--profile".into(),
            "C:\\Users\\me\\profile.json".into(),
            "with space".into(),
        ])
        .is_ok());
        assert!(validate_custom_args(&["bad\narg".into()]).is_err());
        assert!(validate_custom_args(&["x".repeat(513)]).is_err());
    }

    #[test]
    fn catalog_matches_descriptors() {
        let catalog = acp_agents();
        assert_eq!(catalog.len(), ACP_AGENTS.len());
        for entry in catalog {
            let descriptor = resolve_acp_agent(&entry.id).expect("catalog id resolves");
            assert_eq!(entry.label, descriptor.label);
            assert_eq!(entry.program, descriptor.program);
            assert_eq!(entry.probe_program, descriptor.probe_program);
            assert_eq!(entry.args, descriptor.args);
        }
    }

    #[test]
    fn registry_npx_command_requires_safe_tokens() {
        let valid = registry_distribution(&serde_json::json!({
            "npx": { "package": "@example/agent", "args": ["--acp"] }
        }));
        assert_eq!(valid.kind, "npx");
        assert_eq!(
            valid.install_command.as_deref(),
            Some("npx --yes @example/agent --acp")
        );

        let unsafe_value = registry_distribution(&serde_json::json!({
            "npx": { "package": "agent;not-safe" }
        }));
        assert_eq!(unsafe_value.install_command, None);
    }

    #[test]
    fn registry_agents_reject_invalid_ids_and_urls() {
        let invalid = RawAcpRegistryAgent {
            id: "Not valid".into(),
            name: "Example".into(),
            version: "1.0.0".into(),
            description: String::new(),
            repository: None,
            website: None,
            authors: vec![],
            license: None,
            distribution: serde_json::json!({}),
        };
        assert!(sanitize_registry_agent(invalid).is_none());
        assert!(sanitize_registry_url("http://example.com".into()).is_none());
        assert_eq!(
            sanitize_registry_url("https://example.com".into()).as_deref(),
            Some("https://example.com")
        );
    }
}
