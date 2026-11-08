use std::io::{Cursor, Write};
use std::path::{Component, Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::modules::acp::is_registry_id;

const INSTALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const INSTALL_MAX_BYTES: usize = 256 * 1024 * 1024;
const MANIFEST: &str = "manifest.json";

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallSpecWire {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSpecWire {
    pub url: String,
    pub sha256: String,
    pub archive: String,
    pub binary_target: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDistributionWire {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub install: Option<InstallSpecWire>,
    #[serde(default)]
    pub download: Option<DownloadSpecWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAgentWire {
    pub id: String,
    pub name: String,
    pub version: String,
    pub distribution: RegistryDistributionWire,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvWire {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAcpAgent {
    pub id: String,
    pub label: String,
    pub version: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<EnvWire>,
    pub managed: bool,
}

fn agents_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("acp").join("agents"))
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))
}

fn safe_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn agent_dir(app: &tauri::AppHandle, agent: &RegistryAgentWire) -> Result<PathBuf, String> {
    if !is_registry_id(&agent.id) {
        return Err("The agent id is invalid".into());
    }
    if !safe_component(&agent.version) {
        return Err("The agent version is invalid".into());
    }
    Ok(agents_root(app)?.join(&agent.id).join(&agent.version))
}

fn write_manifest(dir: &Path, agent: &InstalledAcpAgent) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    let json = serde_json::to_vec_pretty(agent).map_err(|error| error.to_string())?;
    let tmp = dir.join("manifest.json.agni-tmp");
    std::fs::write(&tmp, json)
        .map_err(|error| format!("Could not write {}: {error}", tmp.display()))?;
    std::fs::rename(&tmp, dir.join(MANIFEST))
        .map_err(|error| format!("Could not finalize {}: {error}", dir.display()))
}

#[tauri::command]
pub async fn acp_registry_install(
    app: tauri::AppHandle,
    agent: RegistryAgentWire,
) -> Result<InstalledAcpAgent, String> {
    let dir = agent_dir(&app, &agent)?;
    let label = if agent.name.trim().is_empty() {
        agent.id.clone()
    } else {
        agent.name.clone()
    };

    if let Some(download) = agent.distribution.download.clone() {
        install_binary(&dir, &download).await?;
        let program = locate_program(&dir, download.binary_target.as_deref())?;
        let installed = InstalledAcpAgent {
            id: agent.id.clone(),
            label,
            version: agent.version.clone(),
            program: program.to_string_lossy().to_string(),
            args: Vec::new(),
            env: Vec::new(),
            managed: true,
        };
        write_manifest(&dir, &installed)?;
        return Ok(installed);
    }

    if let Some(install) = agent.distribution.install.clone() {
        if install.program != "npx" && install.program != "uvx" {
            return Err("Unsupported install runner".into());
        }
        let installed = InstalledAcpAgent {
            id: agent.id.clone(),
            label,
            version: agent.version.clone(),
            program: install.program,
            args: install.args,
            env: Vec::new(),
            managed: false,
        };
        write_manifest(&dir, &installed)?;
        return Ok(installed);
    }

    Err("This agent has no installable distribution".into())
}

#[tauri::command]
pub fn acp_registry_uninstall(app: tauri::AppHandle, agent_id: String) -> Result<(), String> {
    if !is_registry_id(&agent_id) {
        return Err("The agent id is invalid".into());
    }
    let dir = agents_root(&app)?.join(&agent_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|error| format!("Could not remove {}: {error}", dir.display()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn acp_registry_installed(
    app: tauri::AppHandle,
) -> Result<Vec<InstalledAcpAgent>, String> {
    let root = agents_root(&app)?;
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(Vec::new());
    };
    let mut installed = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Ok(versions) = std::fs::read_dir(entry.path()) else {
            continue;
        };
        let mut best: Option<InstalledAcpAgent> = None;
        for version in versions.flatten() {
            let manifest = version.path().join(MANIFEST);
            let Ok(contents) = std::fs::read_to_string(&manifest) else {
                continue;
            };
            let Ok(parsed) = serde_json::from_str::<InstalledAcpAgent>(&contents) else {
                continue;
            };
            if best
                .as_ref()
                .is_none_or(|current| parsed.version.as_str() > current.version.as_str())
            {
                best = Some(parsed);
            }
        }
        if let Some(agent) = best {
            installed.push(agent);
        }
    }
    installed.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(installed)
}

async fn install_binary(dir: &Path, download: &DownloadSpecWire) -> Result<(), String> {
    let bytes = download_bytes(&download.url).await?;
    verify_sha256(&bytes, &download.sha256)?;
    if dir.exists() {
        std::fs::remove_dir_all(dir)
            .map_err(|error| format!("Could not replace {}: {error}", dir.display()))?;
    }
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    match download.archive.as_str() {
        "zip" => extract_zip(&bytes, dir),
        "tar.gz" => extract_tar_gz(&bytes, dir),
        "raw" => extract_raw(&bytes, dir, download.binary_target.as_deref()),
        other => Err(format!("Unsupported archive type: {other}")),
    }
}

async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err("The download URL must be https".into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(INSTALL_TIMEOUT)
        .timeout(INSTALL_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Agni ACP installer")
        .build()
        .map_err(|error| format!("Could not create the download client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not download the agent: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The agent download failed: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > INSTALL_MAX_BYTES as u64)
    {
        return Err("The agent download is too large".into());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Could not read the download: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > INSTALL_MAX_BYTES {
            return Err("The agent download is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let actual = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual != expected.to_ascii_lowercase() {
        return Err("Checksum mismatch for the downloaded agent".into());
    }
    Ok(())
}

fn safe_zip_entry(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.is_absolute() {
        return None;
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return None;
    }
    Some(path.to_path_buf())
}

fn extract_zip(bytes: &[u8], dir: &Path) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|error| format!("Invalid zip: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Invalid zip entry: {error}"))?;
        let Some(relative) = safe_zip_entry(entry.name()) else {
            return Err("The agent archive contains an unsafe path".into());
        };
        let target = dir.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|error| format!("Could not create {}: {error}", target.display()))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        }
        let mut output = std::fs::File::create(&target)
            .map_err(|error| format!("Could not write {}: {error}", target.display()))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Could not extract {}: {error}", target.display()))?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode));
        }
    }
    Ok(())
}

fn extract_tar_gz(bytes: &[u8], dir: &Path) -> Result<(), String> {
    let decoder = flate2::read::GzDecoder::new(Cursor::new(bytes));
    let mut archive = tar::Archive::new(decoder);
    for entry in archive
        .entries()
        .map_err(|error| format!("Invalid tar: {error}"))?
    {
        let mut entry = entry.map_err(|error| format!("Invalid tar entry: {error}"))?;
        let path = entry
            .path()
            .map_err(|error| format!("Invalid tar path: {error}"))?
            .to_path_buf();
        if path
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
        {
            return Err("The agent archive contains an unsafe path".into());
        }
        let target = dir.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        }
        entry
            .unpack(&target)
            .map_err(|error| format!("Could not extract {}: {error}", target.display()))?;
    }
    Ok(())
}

fn extract_raw(bytes: &[u8], dir: &Path, binary_target: Option<&str>) -> Result<(), String> {
    let name = binary_target
        .and_then(|value| {
            let path = Path::new(value);
            path.file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            if cfg!(windows) {
                "agent.exe".to_string()
            } else {
                "agent".to_string()
            }
        });
    if !safe_component(&name) {
        return Err("The agent executable name is invalid".into());
    }
    let target = dir.join(name);
    let mut file = std::fs::File::create(&target)
        .map_err(|error| format!("Could not write {}: {error}", target.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("Could not extract {}: {error}", target.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

fn locate_program(dir: &Path, binary_target: Option<&str>) -> Result<PathBuf, String> {
    if let Some(target) = binary_target {
        let path = Path::new(target);
        if path
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
        {
            return Err("The agent executable path is invalid".into());
        }
        let resolved = dir.join(path);
        if resolved.is_file() {
            return Ok(resolved);
        }
    }
    find_executable(dir).ok_or_else(|| "The agent archive did not contain an executable".into())
}

fn find_executable(dir: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    collect_files(dir, &mut candidates, 0);
    candidates.sort();
    candidates
        .into_iter()
        .find(|path| is_executable_candidate(path))
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, out, depth + 1);
        } else if path.is_file() {
            out.push(path);
        }
    }
}

fn is_executable_candidate(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    #[cfg(windows)]
    {
        name.ends_with(".exe")
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .map(|meta| meta.permissions().mode())
            .unwrap_or(0);
        mode & 0o111 != 0 && !name.ends_with(".txt") && !name.ends_with(".md")
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = name;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_archive_paths() {
        assert!(safe_zip_entry("../escape").is_none());
        assert!(safe_zip_entry("/abs/path").is_none());
        assert!(safe_zip_entry("bin/agent").is_some());
        assert!(safe_zip_entry("./bin/agent").is_some());
    }

    #[test]
    fn checksum_must_match() {
        let bytes = b"hello";
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(verify_sha256(bytes, expected).is_ok());
        assert!(verify_sha256(bytes, &"0".repeat(64)).is_err());
        assert!(verify_sha256(bytes, "not-hex").is_err());
    }

    #[test]
    fn ids_and_versions_are_sanitized() {
        let ok = RegistryAgentWire {
            id: "example-agent".into(),
            name: "Example".into(),
            version: "1.2.3".into(),
            distribution: RegistryDistributionWire {
                kind: "npx".into(),
                install: None,
                download: None,
            },
        };
        assert!(is_registry_id(&ok.id));
        assert!(safe_component(&ok.version));
        assert!(!safe_component("../1.0"));
        assert!(!safe_component("a/b"));
    }
}
