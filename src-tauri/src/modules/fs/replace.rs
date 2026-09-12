use std::path::Path;

use globset::{Glob, GlobSet, GlobSetBuilder};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::file::write_atomic;
use super::grep::display_path;
use super::to_canon;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const FILE_SIZE_CAP: u64 = 5 * 1024 * 1024;
const MAX_CHANGED_FILES: usize = 5000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceArgs {
    pub pattern: String,
    pub replacement: String,
    pub root: String,
    #[serde(default)]
    pub glob: Option<Vec<String>>,
    #[serde(default)]
    pub case_insensitive: Option<bool>,
    #[serde(default)]
    pub dry_run: Option<bool>,
    #[serde(default)]
    pub workspace: Option<WorkspaceEnv>,
}

#[derive(Serialize)]
pub struct ReplaceFile {
    pub path: String,
    pub rel: String,
    pub count: usize,
}

#[derive(Serialize)]
pub struct ReplaceResponse {
    pub files: Vec<ReplaceFile>,
    pub total: usize,
    pub truncated: bool,
}

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    source: &'static str,
}

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        let g = Glob::new(p).map_err(|e| format!("bad glob {p:?}: {e}"))?;
        b.add(g);
    }
    let set = b.build().map_err(|e| format!("globset build: {e}"))?;
    Ok(Some(set))
}

/// Core walk/replace, kept free of Tauri types so it stays unit-testable.
/// `replacement == None` is a dry run. The replacement string expands `$1`
/// capture groups, matching the usual editor replace-all behaviour, and
/// `on_written` fires once per changed file.
pub(crate) fn replace_in_tree(
    root_path: &Path,
    root_display: &str,
    workspace: &WorkspaceEnv,
    re: &Regex,
    replacement: Option<&str>,
    globs: Option<&GlobSet>,
    mut on_written: impl FnMut(&str),
) -> Result<ReplaceResponse, String> {
    let walker = ignore::WalkBuilder::new(root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build();

    let mut files: Vec<ReplaceFile> = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;

    for dent in walker.flatten() {
        if files.len() >= MAX_CHANGED_FILES {
            truncated = true;
            break;
        }
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = dent.path();
        let rel = match path.strip_prefix(root_path) {
            Ok(r) => to_canon(r),
            Err(_) => continue,
        };
        if let Some(set) = globs {
            if !set.is_match(&rel) {
                continue;
            }
        }
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.len() > FILE_SIZE_CAP {
                continue;
            }
        }
        // Invalid UTF-8 means binary; never rewrite those.
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let count = re.find_iter(&content).count();
        if count == 0 {
            continue;
        }

        let display = display_path(path, root_path, root_display, workspace);
        if let Some(repl) = replacement {
            let next = re.replace_all(&content, repl);
            write_atomic(path, next.as_bytes())
                .map_err(|e| format!("write {} failed: {e}", display))?;
            on_written(&display);
        }

        files.push(ReplaceFile {
            path: display,
            rel,
            count,
        });
        total += count;
    }

    Ok(ReplaceResponse {
        files,
        total,
        truncated,
    })
}

/// Regex replace across a workspace tree. `dryRun` reports matches without
/// touching disk. On apply, files are written atomically and announced through
/// `fs:file-written` so open editors reload with the new contents.
#[tauri::command]
pub fn fs_replace(args: ReplaceArgs, app: tauri::AppHandle) -> Result<ReplaceResponse, String> {
    if args.pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let workspace = WorkspaceEnv::from_option(args.workspace.clone());
    let root_path = resolve_path(&args.root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {}", args.root));
    }

    let re = RegexBuilder::new(&args.pattern)
        .case_insensitive(args.case_insensitive.unwrap_or(false))
        .build()
        .map_err(|e| format!("bad regex: {e}"))?;
    let globs = build_globset(args.glob.as_deref().unwrap_or(&[]))?;
    let replacement = if args.dry_run.unwrap_or(true) {
        None
    } else {
        Some(args.replacement.as_str())
    };

    replace_in_tree(
        &root_path,
        &args.root,
        &workspace,
        &re,
        replacement,
        globs.as_ref(),
        |path| {
            let _ = app.emit(
                "fs:file-written",
                FileWrittenEvent {
                    path: path.to_string(),
                    source: "replace-all",
                },
            );
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn re(pattern: &str) -> Regex {
        RegexBuilder::new(pattern).build().expect("regex")
    }

    #[test]
    fn dry_run_reports_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.txt");
        std::fs::write(&a, "foo foo\nbar\n").unwrap();

        let res = replace_in_tree(
            dir.path(),
            "root",
            &WorkspaceEnv::Local,
            &re("foo"),
            None,
            None,
            |_| panic!("dry_run must not write"),
        )
        .unwrap();

        assert_eq!(res.total, 2);
        assert_eq!(res.files.len(), 1);
        assert_eq!(res.files[0].count, 2);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "foo foo\nbar\n");
    }

    #[test]
    fn apply_rewrites_and_reports_each_changed_file() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        std::fs::write(&a, "foo\n").unwrap();
        std::fs::write(&b, "nothing\n").unwrap();

        let mut written = Vec::new();
        let res = replace_in_tree(
            dir.path(),
            "root",
            &WorkspaceEnv::Local,
            &re("foo"),
            Some("qux"),
            None,
            |p| written.push(p.to_string()),
        )
        .unwrap();

        assert_eq!(res.total, 1);
        assert_eq!(res.files.len(), 1);
        assert_eq!(written.len(), 1);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "qux\n");
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "nothing\n");
    }

    #[test]
    fn replacement_expands_capture_groups() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.txt");
        std::fs::write(&a, "id=42\n").unwrap();

        replace_in_tree(
            dir.path(),
            "root",
            &WorkspaceEnv::Local,
            &re(r"id=(\d+)"),
            Some("id:[$1]"),
            None,
            |_| {},
        )
        .unwrap();

        assert_eq!(std::fs::read_to_string(&a).unwrap(), "id:[42]\n");
    }

    #[test]
    fn glob_limits_which_files_are_touched() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.md");
        std::fs::write(&a, "foo\n").unwrap();
        std::fs::write(&b, "foo\n").unwrap();

        let mut gb = GlobSetBuilder::new();
        gb.add(Glob::new("*.md").unwrap());
        let globs = gb.build().unwrap();

        let res = replace_in_tree(
            dir.path(),
            "root",
            &WorkspaceEnv::Local,
            &re("foo"),
            Some("bar"),
            Some(&globs),
            |_| {},
        )
        .unwrap();

        assert_eq!(res.total, 1);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "foo\n");
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "bar\n");
    }
}
