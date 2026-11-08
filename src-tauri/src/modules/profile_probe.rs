//! Read-only account/status probes for known harnesses.
//!
//! The commands are a fixed allowlist keyed by agent id; the frontend cannot
//! pass an arbitrary program or arguments. That keeps this from becoming a
//! general command-execution surface while still letting Settings show the
//! signed-in account (T3's provider status).

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use crate::modules::acp::{local_program, resolve_env, validate_managed_env, AcpEnvVar};

const MAX_OUTPUT_CHARS: usize = 4_000;
const PROBE_TIMEOUT: Duration = Duration::from_secs(12);

fn probe_command(agent: &str) -> Option<(&'static str, &'static [&'static str])> {
    match agent {
        "claude" => Some(("claude", &["auth", "status"])),
        "opencode" => Some(("opencode", &["auth", "list"])),
        "kilo" => Some(("kilo", &["auth", "list"])),
        "commandcode" => Some(("commandcode", &["whoami"])),
        "hermes" => Some(("hermes", &["auth", "list"])),
        _ => None,
    }
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

#[tauri::command]
pub async fn profile_account_probe(
    agent: String,
    env: Option<Vec<AcpEnvVar>>,
    cwd: Option<String>,
    args: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let Some((program, fixed_args)) = probe_command(&agent) else {
        return Ok(None);
    };
    let env = env.unwrap_or_default();
    validate_managed_env(&env)?;
    let env_values = resolve_env(&env)?;
    let extra_args = args.unwrap_or_default();
    crate::modules::acp::validate_custom_args(&extra_args)?;

    let program_path = local_program(program);
    let mut command = tokio::process::Command::new(program_path);
    command
        .args(fixed_args)
        .args(&extra_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (name, value) in &env_values {
        command.env(name, value);
    }
    if let Some(dir) = cwd
        .as_deref()
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    {
        if Path::new(dir).is_dir() {
            command.current_dir(dir);
        }
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = tokio::time::timeout(PROBE_TIMEOUT, command.output())
        .await
        .map_err(|_| "The account check timed out.".to_string())?
        .map_err(|error| format!("Could not run the account check: {error}"))?;

    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&output.stderr).to_string();
    }
    let text = text.trim();
    if text.is_empty() {
        return Ok(Some("No account information reported.".into()));
    }
    Ok(Some(truncate_chars(text, MAX_OUTPUT_CHARS)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_agents_are_probed() {
        assert!(probe_command("claude").is_some());
        assert!(probe_command("opencode").is_some());
        assert!(probe_command("commandcode").is_some());
        assert!(probe_command("custom").is_none());
        assert!(probe_command("pi").is_none());
    }

    #[test]
    fn output_is_capped_at_char_boundaries() {
        let value = "é".repeat(MAX_OUTPUT_CHARS + 10);
        assert_eq!(truncate_chars(&value, MAX_OUTPUT_CHARS).chars().count(), MAX_OUTPUT_CHARS);
    }
}
