use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

/// Dot-prefix is the cross-platform convention; Windows also marks files
/// hidden via a filesystem attribute independent of the name (e.g.
/// `desktop.ini`, `NTUSER.DAT`), which a dot-prefix check alone misses.
#[cfg(windows)]
fn is_hidden_name(name: &str, meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    name.starts_with('.') || meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn is_hidden_name(name: &str, _meta: &std::fs::Metadata) -> bool {
    name.starts_with('.')
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Milliseconds since UNIX epoch; 0 if unavailable.
    pub mtime: u64,
}

/// Lists immediate children of `path`. Dirs first, then files, each sorted
/// case-insensitively. Hidden entries (dot-prefixed, or Windows-attribute
/// hidden) are excluded unless `show_hidden` is set.
#[tauri::command]
pub fn fs_read_dir(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DirEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root = resolve_path(&path, &workspace);
    let read = std::fs::read_dir(&root).map_err(|e| {
        log::debug!("fs_read_dir({}) failed: {e}", root.display());
        e.to_string()
    })?;

    let mut entries: Vec<DirEntry> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;

            // `metadata()` follows symlinks → it returns the target's stat in
            // one syscall (file_type + size + mtime all derived from it). We
            // fall back to `symlink_metadata` for broken symlinks so we don't
            // silently drop them from the listing.
            let (meta, was_symlink) = match std::fs::metadata(entry.path()) {
                Ok(m) => (Some(m), false),
                Err(_) => (entry.metadata().ok(), true),
            };
            let meta = meta?;

            let kind = if was_symlink {
                EntryKind::Symlink
            } else if meta.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            };

            if is_hidden_name(&name, &meta) && !show_hidden {
                return None;
            }

            let size = meta.len();
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            Some(DirEntry {
                name,
                kind,
                size,
                mtime,
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        let rank = |k: &EntryKind| match k {
            EntryKind::Dir => 0,
            EntryKind::Symlink => 1,
            EntryKind::File => 2,
        };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Lists immediate subdirectories of `path`. Kept for the CwdBreadcrumb.
///
/// Symlinks to directories are included (matches shell `cd` semantics).
#[tauri::command]
pub fn list_subdirs(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root = resolve_path(&path, &workspace);
    let read = std::fs::read_dir(&root).map_err(|e| {
        log::debug!("list_subdirs({}) read_dir failed: {e}", root.display());
        e.to_string()
    })?;

    let mut dirs: Vec<String> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let is_dir = match entry.file_type() {
                Ok(t) if t.is_dir() => true,
                Ok(t) if t.is_symlink() => std::fs::metadata(entry.path())
                    .map(|m| m.is_dir())
                    .unwrap_or(false),
                _ => false,
            };
            if !is_dir {
                return None;
            }
            let name = entry.file_name().into_string().ok()?;
            if !show_hidden {
                let meta = std::fs::metadata(entry.path()).ok()?;
                if is_hidden_name(&name, &meta) {
                    return None;
                }
            }
            Some(name)
        })
        .collect();

    dirs.sort_by_key(|a| a.to_lowercase());
    Ok(dirs)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn tempdir(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        p.push(format!("agni-tree-{label}-{nanos}-{}", std::process::id()));
        fs::create_dir_all(&p).expect("create tempdir");
        p
    }

    #[test]
    fn is_hidden_name_detects_windows_attribute_without_dot_prefix() {
        let dir = tempdir("attr-hidden");
        let file = dir.join("NTUSER.DAT");
        fs::write(&file, b"x").expect("write file");
        let status = std::process::Command::new("attrib")
            .args(["+h", file.to_str().expect("utf8 path")])
            .status()
            .expect("run attrib");
        assert!(status.success());
        let meta = fs::metadata(&file).expect("stat file");
        assert!(is_hidden_name("NTUSER.DAT", &meta));
    }

    #[test]
    fn is_hidden_name_detects_dot_prefix_without_attribute() {
        let dir = tempdir("dot-hidden");
        let file = dir.join(".gitignore");
        fs::write(&file, b"x").expect("write file");
        let meta = fs::metadata(&file).expect("stat file");
        assert!(is_hidden_name(".gitignore", &meta));
    }

    #[test]
    fn is_hidden_name_false_for_plain_visible_file() {
        let dir = tempdir("visible");
        let file = dir.join("readme.txt");
        fs::write(&file, b"x").expect("write file");
        let meta = fs::metadata(&file).expect("stat file");
        assert!(!is_hidden_name("readme.txt", &meta));
    }
}
