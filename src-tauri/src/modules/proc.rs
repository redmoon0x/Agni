use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
#[inline]
pub fn hide_console(_cmd: &mut Command) {}

/// File names a program can be spawned under on this platform. Windows needs
/// the extension because `Command::new("kilo")` never resolves `kilo.cmd`.
#[cfg(windows)]
fn candidate_names(program: &str) -> Vec<String> {
    ["exe", "cmd", "bat"]
        .iter()
        .map(|extension| format!("{program}.{extension}"))
        .collect()
}

#[cfg(not(windows))]
fn candidate_names(program: &str) -> Vec<String> {
    vec![program.to_string()]
}

/// A GUI launch inherits the PATH that was current when the shortcut was
/// created, so npm/bun/pnpm global bin directories are probed explicitly
/// instead of being trusted to be present.
#[cfg(windows)]
fn fallback_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut push = |value: Option<std::ffi::OsString>, tail: &str| {
        if let Some(value) = value {
            dirs.push(PathBuf::from(value).join(tail));
        }
    };
    push(std::env::var_os("APPDATA"), "npm");
    push(std::env::var_os("LOCALAPPDATA"), "pnpm");
    push(std::env::var_os("USERPROFILE"), ".bun\\bin");
    dirs
}

#[cfg(unix)]
fn fallback_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
    ];
    if let Some(home) = dirs::home_dir() {
        for tail in [".local/bin", ".bun/bin", ".npm-global/bin", ".volta/bin"] {
            dirs.push(home.join(tail));
        }
    }
    dirs
}

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    for dir in fallback_dirs() {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

#[cfg(windows)]
fn is_runnable(path: &std::path::Path) -> bool {
    path.is_file()
}

/// A file is only spawnable on unix when some execute bit is set, so a stray
/// directory or a non-executable download does not read as installed.
#[cfg(unix)]
fn is_runnable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// Resolves `program` using the same rules the spawn paths use, so a hit here
/// means the program would actually start.
pub fn find_program(program: &str) -> Option<PathBuf> {
    let candidates = candidate_names(program);
    search_dirs().into_iter().find_map(|dir| {
        candidates
            .iter()
            .map(|candidate| dir.join(candidate))
            .find(|path| is_runnable(path))
    })
}

pub fn program_exists(program: &str) -> bool {
    find_program(program).is_some()
}
