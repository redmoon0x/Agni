//! Cross-window admission control for agent profiles.
//!
//! The main window and the Settings window are separate webviews, so an
//! in-memory lock in one is invisible to the other. Keeping the refcounts in
//! the Rust process gives both windows one source of truth (T3's `withAccess`
//! analogue): credentials cannot be edited or re-authenticated while a live
//! session holds the profile.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn locks() -> &'static Mutex<HashMap<String, u32>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn validate(profile_id: &str) -> Result<(), String> {
    if profile_id.is_empty()
        || profile_id.len() > 128
        || !profile_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-' | b'.'))
    {
        return Err("The profile id is invalid".into());
    }
    Ok(())
}

#[tauri::command]
pub fn profile_acquire(profile_id: String) -> Result<u32, String> {
    validate(&profile_id)?;
    let mut map = locks().lock().map_err(|_| "Profile lock is poisoned")?;
    let count = map.entry(profile_id).or_insert(0);
    *count += 1;
    Ok(*count)
}

#[tauri::command]
pub fn profile_release(profile_id: String) -> Result<u32, String> {
    validate(&profile_id)?;
    let mut map = locks().lock().map_err(|_| "Profile lock is poisoned")?;
    let next = map.get(&profile_id).copied().unwrap_or(0).saturating_sub(1);
    if next == 0 {
        map.remove(&profile_id);
    } else {
        map.insert(profile_id, next);
    }
    Ok(next)
}

#[tauri::command]
pub fn profile_locks() -> Result<HashMap<String, u32>, String> {
    let map = locks().lock().map_err(|_| "Profile lock is poisoned")?;
    Ok(map.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refcounts_and_ids_are_safe() {
        assert!(profile_acquire("profile-a".into()).is_ok());
        assert_eq!(profile_acquire("profile-a".into()).unwrap(), 2);
        assert_eq!(profile_release("profile-a".into()).unwrap(), 1);
        assert_eq!(profile_release("profile-a".into()).unwrap(), 0);
        assert_eq!(profile_release("profile-a".into()).unwrap(), 0);
        assert!(profile_acquire("bad id".into()).is_err());
    }
}
