use crate::modules::fs;
use std::path::PathBuf;

/// Opens a native folder picker dialog and returns the canonical path of the
/// selected folder, or `null` if the user cancelled.
#[tauri::command]
pub async fn pick_folder(
    title: Option<String>,
    start_dir: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title(&title.unwrap_or_else(|| "Open Folder".into()));

    if let Some(dir) = start_dir {
        if let Ok(path) = PathBuf::from(&dir).canonicalize() {
            if path.is_dir() {
                dialog = dialog.set_directory(&path);
            }
        }
    }

    let handle = dialog.pick_folder().await;
    Ok(handle.map(|h| {
        let p = h.path().to_path_buf();
        fs::to_canon(&p)
    }))
}
