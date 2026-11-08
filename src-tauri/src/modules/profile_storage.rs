//! Agni-managed per-profile storage.
//!
//! New profiles default to `~/.agni/profiles/<profile-id>/{config,data}` so a
//! user never has to invent or reuse a directory (which would merge two
//! accounts). The user can still opt out and pick custom paths.

use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStorage {
    pub root: String,
    pub config_dir: String,
    pub data_dir: String,
}

fn validate_profile_id(profile_id: &str) -> Result<(), String> {
    if profile_id.is_empty()
        || profile_id.len() > 64
        || !profile_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("The profile id is invalid".into());
    }
    Ok(())
}

fn storage_paths(home: &Path, profile_id: &str) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    validate_profile_id(profile_id)?;
    let root = home.join(".agni").join("profiles").join(profile_id);
    let config = root.join("config");
    let data = root.join("data");
    Ok((root, config, data))
}

#[tauri::command]
pub fn ensure_profile_storage(profile_id: String) -> Result<ProfileStorage, String> {
    let home = dirs::home_dir().ok_or("Could not resolve the home directory")?;
    let (root, config, data) = storage_paths(&home, &profile_id)?;
    std::fs::create_dir_all(&config)
        .map_err(|error| format!("Could not create the profile config folder: {error}"))?;
    std::fs::create_dir_all(&data)
        .map_err(|error| format!("Could not create the profile data folder: {error}"))?;
    Ok(ProfileStorage {
        root: root.to_string_lossy().to_string(),
        config_dir: config.to_string_lossy().to_string(),
        data_dir: data.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_ids_cannot_escape_the_agni_root() {
        assert!(validate_profile_id("profile-abc_123").is_ok());
        assert!(validate_profile_id("").is_err());
        assert!(validate_profile_id("../secrets").is_err());
        assert!(validate_profile_id("a/b").is_err());
    }

    #[test]
    fn storage_paths_live_under_agni() {
        let home = Path::new("/home/test");
        let (root, config, data) = storage_paths(home, "profile-work").unwrap();
        assert!(root.ends_with(".agni/profiles/profile-work"));
        assert!(config.ends_with("profile-work/config"));
        assert!(data.ends_with("profile-work/data"));
    }

    #[test]
    fn serializes_camel_case_keys_for_the_webview() {
        let storage = ProfileStorage {
            root: "/home/test/.agni/profiles/profile-work".into(),
            config_dir: "/home/test/.agni/profiles/profile-work/config".into(),
            data_dir: "/home/test/.agni/profiles/profile-work/data".into(),
        };
        let json = serde_json::to_value(&storage).unwrap();
        assert_eq!(json["configDir"], storage.config_dir);
        assert_eq!(json["dataDir"], storage.data_dir);
        assert!(json.get("config_dir").is_none());
    }
}
