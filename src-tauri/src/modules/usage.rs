use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 8_000;
const MAX_EVENTS: usize = 250_000;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SCAN_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEvent {
    timestamp: String,
    source: &'static str,
    provider: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    events: Vec<UsageEvent>,
    files_scanned: usize,
    truncated: bool,
}

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn provider_label(provider: &str) -> Option<String> {
    if provider.is_empty() || provider.len() > 80 {
        return None;
    }
    Some(match provider.to_ascii_lowercase().as_str() {
        "anthropic" => "Anthropic".to_string(),
        "openai" => "OpenAI".to_string(),
        "google" => "Google".to_string(),
        "deepseek" => "DeepSeek".to_string(),
        "moonshotai" => "Moonshot AI".to_string(),
        "poolside" => "Poolside".to_string(),
        "unknown" => "Unknown".to_string(),
        other => other.to_string(),
    })
}

fn parse_event(value: &Value, source: &'static str) -> Option<UsageEvent> {
    let message = value.get("message")?;
    if message.get("role")?.as_str()? != "assistant" {
        return None;
    }
    let (input, output, cache_read, cache_write) = if source == "CommandCode" {
        let usage = value.get("usage")?;
        let cache_read = number(usage, "cacheReadTokens");
        let cache_write = number(usage, "cacheWriteTokens");
        (
            number(usage, "inputTokens").saturating_sub(cache_read.saturating_add(cache_write)),
            number(usage, "outputTokens"),
            cache_read,
            cache_write,
        )
    } else {
        let usage = message.get("usage")?;
        (
            number(usage, "input_tokens").max(number(usage, "input")),
            number(usage, "output_tokens").max(number(usage, "output")),
            number(usage, "cache_read_input_tokens").max(number(usage, "cacheRead")),
            number(usage, "cache_creation_input_tokens").max(number(usage, "cacheWrite")),
        )
    };
    if input
        .saturating_add(output)
        .saturating_add(cache_read)
        .saturating_add(cache_write)
        == 0
    {
        return None;
    }
    let timestamp = value
        .get("timestamp")
        .or_else(|| message.get("timestamp"))?
        .as_str()?;
    if timestamp.len() > 64 || !timestamp.contains('T') {
        return None;
    }
    let provider = if source == "Claude Code" {
        "anthropic"
    } else if source == "CommandCode" {
        value
            .get("model")
            .and_then(Value::as_str)
            .and_then(|model| model.split('/').next())
            .filter(|provider| !provider.is_empty())
            .unwrap_or("unknown")
    } else {
        message.get("provider")?.as_str()?
    };
    let provider = provider_label(provider)?;
    Some(UsageEvent {
        timestamp: timestamp.to_owned(),
        source,
        provider,
        input,
        output,
        cache_read,
        cache_write,
    })
}

fn scan_file(path: &Path, source: &'static str, report: &mut UsageReport) {
    let Ok(file) = File::open(path) else { return };
    if file
        .metadata()
        .is_ok_and(|metadata| metadata.len() > MAX_FILE_BYTES)
    {
        report.truncated = true;
    }
    let mut claude_messages: HashMap<String, UsageEvent> = HashMap::new();
    for line in BufReader::new(file).take(MAX_FILE_BYTES).lines() {
        let Ok(line) = line else { break };
        if line.len() > MAX_LINE_BYTES {
            report.truncated = true;
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(event) = parse_event(&value, source) else {
            continue;
        };
        if source == "Claude Code" {
            let Some(id) = value.pointer("/message/id").and_then(Value::as_str) else {
                continue;
            };
            let request = value.get("requestId").and_then(Value::as_str).unwrap_or("");
            let key = format!("{id}:{request}");
            // Streaming snapshots repeat an assistant message; keep its latest usage.
            claude_messages.insert(key, event);
        } else {
            report.events.push(event);
        }
        if report.events.len() + claude_messages.len() >= MAX_EVENTS {
            report.truncated = true;
            break;
        }
    }
    report.events.extend(claude_messages.into_values());
}

fn scan_dir(
    root: &Path,
    source: &'static str,
    report: &mut UsageReport,
    scanned_bytes: &mut u64,
) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|error| format!("Could not read {}: {error}", dir.display()))?;
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file() && path.extension().is_some_and(|ext| ext == "jsonl") {
                if report.files_scanned >= MAX_FILES || report.events.len() >= MAX_EVENTS {
                    report.truncated = true;
                    return Ok(());
                }
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                let bytes = metadata.len().min(MAX_FILE_BYTES);
                if scanned_bytes.saturating_add(bytes) > MAX_SCAN_BYTES {
                    report.truncated = true;
                    return Ok(());
                }
                *scanned_bytes += bytes;
                report.files_scanned += 1;
                scan_file(&path, source, report);
            }
        }
    }
    Ok(())
}

fn sqlite_timestamp(millis: i64) -> Option<String> {
    DateTime::<Utc>::from_timestamp_millis(millis).map(|date| date.to_rfc3339())
}

fn parse_opencode_event(value: &Value, millis: i64) -> Option<UsageEvent> {
    if value.get("role")?.as_str()? != "assistant" {
        return None;
    }
    let tokens = value.get("tokens")?;
    let cache = tokens.get("cache");
    let input = number(tokens, "input");
    let output = number(tokens, "output").saturating_add(number(tokens, "reasoning"));
    let cache_read = cache.map_or(0, |value| number(value, "read"));
    let cache_write = cache.map_or(0, |value| number(value, "write"));
    if input
        .saturating_add(output)
        .saturating_add(cache_read)
        .saturating_add(cache_write)
        == 0
    {
        return None;
    }
    Some(UsageEvent {
        timestamp: sqlite_timestamp(millis)?,
        source: "OpenCode",
        provider: provider_label(
            value
                .get("providerID")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
        )?,
        input,
        output,
        cache_read,
        cache_write,
    })
}

fn read_opencode_usage(path: &Path, report: &mut UsageReport) -> Result<(), String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let remaining = MAX_EVENTS.saturating_sub(report.events.len());
    if remaining == 0 {
        report.truncated = true;
        return Ok(());
    }
    let mut statement = conn
        .prepare("SELECT time_created, data FROM message WHERE json_valid(data) AND json_extract(data, '$.role') = 'assistant' LIMIT ?1")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([remaining.saturating_add(1) as i64], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut seen = 0;
    for row in rows {
        let (millis, raw) = row.map_err(|error| error.to_string())?;
        seen += 1;
        if seen > remaining {
            report.truncated = true;
            break;
        }
        if raw.len() > MAX_LINE_BYTES {
            report.truncated = true;
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            if let Some(event) = parse_opencode_event(&value, millis) {
                report.events.push(event);
            }
        }
    }
    report.files_scanned += 1;
    Ok(())
}

struct HermesUsageRow {
    model: String,
    provider: String,
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    reasoning: i64,
    last_seen: f64,
}

fn parse_hermes_event(row: &HermesUsageRow) -> Option<UsageEvent> {
    if !row.last_seen.is_finite() {
        return None;
    }
    let input = row.input.max(0) as u64;
    let output = (row.output.max(0) as u64).saturating_add(row.reasoning.max(0) as u64);
    let cache_read = row.cache_read.max(0) as u64;
    let cache_write = row.cache_write.max(0) as u64;
    if input
        .saturating_add(output)
        .saturating_add(cache_read)
        .saturating_add(cache_write)
        == 0
    {
        return None;
    }
    let provider = if row.provider.is_empty() {
        row.model.split('/').next().unwrap_or("unknown")
    } else {
        &row.provider
    };
    Some(UsageEvent {
        timestamp: sqlite_timestamp((row.last_seen * 1000.0) as i64)?,
        source: "Hermes",
        provider: provider_label(provider)?,
        input,
        output,
        cache_read,
        cache_write,
    })
}

fn read_hermes_usage(path: &Path, report: &mut UsageReport) -> Result<(), String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let remaining = MAX_EVENTS.saturating_sub(report.events.len());
    if remaining == 0 {
        report.truncated = true;
        return Ok(());
    }
    let mut statement = conn
        .prepare("SELECT model, billing_provider, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, last_seen FROM session_model_usage LIMIT ?1")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([remaining.saturating_add(1) as i64], |row| {
            Ok(HermesUsageRow {
                model: row.get(0)?,
                provider: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                input: row.get(2)?,
                output: row.get(3)?,
                cache_read: row.get(4)?,
                cache_write: row.get(5)?,
                reasoning: row.get(6)?,
                last_seen: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut seen = 0;
    for row in rows {
        let row = row.map_err(|error| error.to_string())?;
        seen += 1;
        if seen > remaining {
            report.truncated = true;
            break;
        }
        if let Some(event) = parse_hermes_event(&row) {
            report.events.push(event);
        }
    }
    report.files_scanned += 1;
    Ok(())
}

fn read_local_usage(home: PathBuf, local_data: PathBuf) -> Result<UsageReport, String> {
    let mut report = UsageReport {
        events: Vec::new(),
        files_scanned: 0,
        truncated: false,
    };
    let mut scanned_bytes = 0;
    scan_dir(
        &home.join(".claude/projects"),
        "Claude Code",
        &mut report,
        &mut scanned_bytes,
    )?;
    scan_dir(
        &home.join(".pi/agent/sessions"),
        "Pi",
        &mut report,
        &mut scanned_bytes,
    )?;
    scan_dir(
        &home.join(".commandcode/projects"),
        "CommandCode",
        &mut report,
        &mut scanned_bytes,
    )?;
    let opencode = Some(local_data.join("opencode/opencode.db"))
        .filter(|path| path.is_file())
        .or_else(|| {
            let path = home.join(".local/share/opencode/opencode.db");
            path.is_file().then_some(path)
        });
    if let Some(path) = opencode {
        if let Err(error) = read_opencode_usage(&path, &mut report) {
            report.truncated = true;
            log::warn!("OpenCode usage could not be read: {error}");
        }
    }
    let hermes = Some(local_data.join("hermes/state.db"))
        .filter(|path| path.is_file())
        .or_else(|| {
            let path = home.join(".hermes/state.db");
            path.is_file().then_some(path)
        });
    if let Some(path) = hermes {
        if let Err(error) = read_hermes_usage(&path, &mut report) {
            report.truncated = true;
            log::warn!("Hermes usage could not be read: {error}");
        }
    }
    Ok(report)
}

#[tauri::command]
pub async fn usage_local_report() -> Result<UsageReport, String> {
    let home = dirs::home_dir().ok_or("Home directory unavailable")?;
    let local_data = dirs::data_local_dir().unwrap_or_else(|| home.join(".local/share"));
    tauri::async_runtime::spawn_blocking(move || read_local_usage(home, local_data))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_usage_excludes_non_assistant_and_reads_cache() {
        let value = serde_json::json!({"timestamp":"2025-01-01T09:00:00Z", "message":{"role":"assistant","usage":{"input_tokens":5,"output_tokens":7,"cache_read_input_tokens":11,"cache_creation_input_tokens":3}}});
        let event = parse_event(&value, "Claude Code").unwrap();
        assert_eq!(
            (
                event.input,
                event.output,
                event.cache_read,
                event.cache_write
            ),
            (5, 7, 11, 3)
        );
        assert_eq!(event.provider, "Anthropic");
    }

    #[test]
    fn streaming_claude_snapshots_are_counted_once() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join(".claude/projects/test");
        fs::create_dir_all(&project).unwrap();
        let path = project.join("session.jsonl");
        fs::write(&path, [
            serde_json::json!({"timestamp":"2025-01-01T09:00:00Z","requestId":"r1","message":{"id":"m1","role":"assistant","usage":{"input_tokens":10}}}).to_string(),
            serde_json::json!({"timestamp":"2025-01-01T09:00:01Z","requestId":"r1","message":{"id":"m1","role":"assistant","usage":{"input_tokens":10,"output_tokens":5}}}).to_string(),
        ].join("\n")).unwrap();
        let report =
            read_local_usage(temp.path().to_path_buf(), temp.path().to_path_buf()).unwrap();
        assert_eq!(report.events.len(), 1);
        assert_eq!(report.events[0].output, 5);
    }

    #[test]
    fn commandcode_usage_reads_top_level_counts_without_double_counting_cache() {
        let value = serde_json::json!({
            "type": "message",
            "timestamp": "2026-10-30T09:00:00Z",
            "model": "deepseek/deepseek-v4.1-flash",
            "message": { "role": "assistant", "content": [] },
            "usage": { "inputTokens": 100_000, "outputTokens": 500, "cacheReadTokens": 90_000, "cacheWriteTokens": 2_000 }
        });
        let event = parse_event(&value, "CommandCode").unwrap();
        assert_eq!(event.provider, "DeepSeek");
        assert_eq!(
            (
                event.input,
                event.output,
                event.cache_read,
                event.cache_write
            ),
            (8_000, 500, 90_000, 2_000)
        );
        assert!(parse_event(
            &serde_json::json!({"message": {"role": "user"}, "usage": {"inputTokens": 100}}),
            "CommandCode"
        )
        .is_none());
    }

    #[test]
    fn commandcode_history_is_included_in_local_report() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join(".commandcode/projects/test");
        fs::create_dir_all(&project).unwrap();
        fs::write(
            project.join("session.jsonl"),
            serde_json::json!({
                "type": "message", "timestamp": "2026-10-30T09:00:00Z",
                "model": "moonshotai/Kimi-K3", "message": {"role": "assistant"},
                "usage": {"inputTokens": 20, "outputTokens": 3, "cacheReadTokens": 10}
            })
            .to_string(),
        )
        .unwrap();
        let report =
            read_local_usage(temp.path().to_path_buf(), temp.path().to_path_buf()).unwrap();
        assert_eq!(report.events.len(), 1);
        assert_eq!(report.events[0].source, "CommandCode");
        assert_eq!(report.events[0].provider, "Moonshot AI");
        assert_eq!(report.events[0].input, 10);
    }

    #[test]
    fn opencode_reads_assistant_usage_without_counting_user_messages() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE message (time_created INTEGER, data TEXT);")
            .unwrap();
        for (role, tokens) in [
            (
                "assistant",
                serde_json::json!({"input": 10, "output": 5, "reasoning": 2, "cache": {"read": 30, "write": 3}}),
            ),
            ("user", serde_json::json!({"input": 900})),
        ] {
            conn.execute(
                "INSERT INTO message VALUES (?1, ?2)",
                rusqlite::params![
                    1_782_809_200_000_i64,
                    serde_json::json!({"role": role, "providerID": "openai", "tokens": tokens})
                        .to_string()
                ],
            )
            .unwrap();
        }
        drop(conn);
        let mut report = UsageReport {
            events: Vec::new(),
            files_scanned: 0,
            truncated: false,
        };
        read_opencode_usage(&path, &mut report).unwrap();
        assert_eq!(report.events.len(), 1);
        assert_eq!(report.events[0].provider, "OpenAI");
        assert_eq!(
            (
                report.events[0].input,
                report.events[0].output,
                report.events[0].cache_read,
                report.events[0].cache_write
            ),
            (10, 7, 30, 3)
        );
        assert_eq!(report.files_scanned, 1);
    }

    #[test]
    fn hermes_reads_session_model_totals() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE session_model_usage (model TEXT, billing_provider TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, last_seen REAL);")
            .unwrap();
        conn.execute(
            "INSERT INTO session_model_usage VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                "deepseek/deepseek-v4",
                "",
                10,
                5,
                30,
                3,
                2,
                1_782_809_200.0_f64
            ],
        )
        .unwrap();
        drop(conn);
        let mut report = UsageReport {
            events: Vec::new(),
            files_scanned: 0,
            truncated: false,
        };
        read_hermes_usage(&path, &mut report).unwrap();
        assert_eq!(report.events.len(), 1);
        assert_eq!(report.events[0].provider, "DeepSeek");
        assert_eq!(
            (
                report.events[0].input,
                report.events[0].output,
                report.events[0].cache_read,
                report.events[0].cache_write
            ),
            (10, 7, 30, 3)
        );
        assert_eq!(report.files_scanned, 1);
    }

    #[test]
    fn local_report_includes_both_sqlite_sources() {
        let temp = tempfile::tempdir().unwrap();
        let opencode = temp.path().join("opencode");
        let hermes = temp.path().join("hermes");
        fs::create_dir_all(&opencode).unwrap();
        fs::create_dir_all(&hermes).unwrap();
        let conn = Connection::open(opencode.join("opencode.db")).unwrap();
        conn.execute_batch("CREATE TABLE message (time_created INTEGER, data TEXT);")
            .unwrap();
        conn.execute(
            "INSERT INTO message VALUES (?1, ?2)",
            rusqlite::params![
                1_782_809_200_000_i64,
                serde_json::json!({"role": "assistant", "providerID": "openai", "tokens": {"input": 4}}).to_string()
            ],
        )
        .unwrap();
        drop(conn);
        let conn = Connection::open(hermes.join("state.db")).unwrap();
        conn.execute_batch("CREATE TABLE session_model_usage (model TEXT, billing_provider TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, last_seen REAL);")
            .unwrap();
        conn.execute("INSERT INTO session_model_usage VALUES ('test/model', '', 5, 0, 0, 0, 0, 1782809200.0)", [])
            .unwrap();
        drop(conn);
        let report =
            read_local_usage(temp.path().to_path_buf(), temp.path().to_path_buf()).unwrap();
        assert_eq!(report.events.len(), 2);
        assert!(report.events.iter().any(|event| event.source == "OpenCode"));
        assert!(report.events.iter().any(|event| event.source == "Hermes"));
        assert!(!report.truncated);
    }

    #[test]
    fn pi_usage_uses_model_provider() {
        let value = serde_json::json!({"type":"message","timestamp":"2025-01-01T09:00:00Z", "message":{"role":"assistant","provider":"openai","usage":{"input":10,"output":4,"cacheRead":3}}});
        assert_eq!(parse_event(&value, "Pi").unwrap().provider, "OpenAI");
        assert!(parse_event(&value, "Claude Code").is_some());
    }
}
