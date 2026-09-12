use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::modules::shell::run_program_with_stdin;
use crate::modules::workspace::WorkspaceEnv;

const FORMAT_TIMEOUT: Duration = Duration::from_secs(10);

/// Remembers binaries that are not installed so a formatter is not respawned on
/// every save. Purely a negative cache; a successful run is never cached.
#[derive(Default)]
pub struct FormatState {
    missing: Mutex<HashSet<String>>,
}

#[derive(Serialize)]
pub struct FormatResult {
    pub content: String,
    pub formatted: bool,
}

/// Ordered formatter candidates for a file extension. Every candidate reads
/// the buffer on stdin and writes the result to stdout, so the buffer never has
/// to touch disk. `{path}` is substituted with the real file path for tools
/// that need it (biome/prettier use it for language inference).
fn candidates_for(ext: &str) -> Vec<(&'static str, Vec<String>)> {
    let path_arg = "{path}".to_string();
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "json" | "jsonc" | "css" | "scss"
        | "less" | "md" | "mdx" | "html" | "vue" | "svelte" | "yaml" | "yml" => {
            vec![
                (
                    "biome",
                    vec![
                        "format".to_string(),
                        format!("--stdin-file-path={path_arg}"),
                    ],
                ),
                ("prettier", vec!["--stdin-filepath".to_string(), path_arg]),
            ]
        }
        "rs" => vec![(
            "rustfmt",
            vec![
                "--emit".to_string(),
                "stdout".to_string(),
                "--edition".to_string(),
                "2021".to_string(),
            ],
        )],
        "go" => vec![("gofmt", vec![])],
        "py" => vec![
            ("ruff", vec!["format".to_string(), "-".to_string()]),
            ("black", vec!["-q".to_string(), "-".to_string()]),
        ],
        _ => Vec::new(),
    }
}

/// Formats the in-memory buffer with a formatter already on the user's PATH.
/// Returns the original content unchanged when no formatter applies, none is
/// installed, or the tool fails or times out. Nothing is written to disk here;
/// the caller decides whether to save the result.
#[tauri::command]
pub fn format_text(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    state: State<'_, FormatState>,
) -> Result<FormatResult, String> {
    let unchanged = |content: String| FormatResult {
        content,
        formatted: false,
    };

    if content.trim().is_empty() {
        return Ok(unchanged(content));
    }
    // WSL buffers would need the formatter spawned inside the distro; the
    // native runner cannot reach those binaries, so skip rather than fail.
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_wsl() {
        return Ok(unchanged(content));
    }

    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let candidates = candidates_for(&ext);
    if candidates.is_empty() {
        return Ok(unchanged(content));
    }

    let cwd = Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned());
    let file_path = path.clone();

    for (program, args) in candidates {
        let known_missing = state
            .missing
            .lock()
            .map(|m| m.contains(program))
            .unwrap_or(false);
        if known_missing {
            continue;
        }

        let resolved: Vec<String> = args
            .iter()
            .map(|a| a.replace("{path}", &file_path))
            .collect();

        match run_program_with_stdin(
            program,
            &resolved,
            cwd.as_deref(),
            content.as_bytes(),
            FORMAT_TIMEOUT,
        ) {
            Ok(out) => {
                if out.exit_code == Some(0) && !out.timed_out && !out.stdout.trim().is_empty() {
                    return Ok(FormatResult {
                        content: out.stdout,
                        formatted: true,
                    });
                }
                // Non-zero exit or empty output: try the next candidate.
            }
            Err(e) => {
                if e.starts_with("not found:") {
                    if let Ok(mut m) = state.missing.lock() {
                        m.insert(program.to_string());
                    }
                }
            }
        }
    }

    Ok(unchanged(content))
}

#[cfg(test)]
mod tests {
    use super::candidates_for;

    #[test]
    fn rust_maps_to_rustfmt_reading_stdin() {
        let c = candidates_for("rs");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].0, "rustfmt");
        assert!(c[0].1.iter().any(|a| a == "stdout"));
    }

    #[test]
    fn ts_prefers_biome_then_prettier() {
        let c = candidates_for("ts");
        assert_eq!(c[0].0, "biome");
        assert_eq!(c[1].0, "prettier");
    }

    #[test]
    fn unknown_extension_has_no_formatter() {
        assert!(candidates_for("xyz").is_empty());
    }
}
