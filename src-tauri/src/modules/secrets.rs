//! OS-keychain storage for per-profile credentials.
//!
//! Profile settings keep a secret *reference* (an account name); the value
//! lives in the platform credential store. Secrets are only handed back to the
//! webview for terminal-based sign-in, where the CLI needs the value in its
//! environment.

const SERVICE: &str = "agni.agent-profile";
const MAX_ACCOUNT_LEN: usize = 200;

fn validate_account(account: &str) -> Result<(), String> {
    if account.is_empty()
        || account.len() > MAX_ACCOUNT_LEN
        || !account
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-' | b'.'))
    {
        return Err("The secret account name is invalid".into());
    }
    Ok(())
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    validate_account(account)?;
    keyring::Entry::new(SERVICE, account)
        .map_err(|error| format!("Could not open the OS keychain: {error}"))
}

/// Read a stored secret. Used by the Rust spawn paths and by terminal sign-in.
pub fn read_secret(account: &str) -> Result<String, String> {
    entry(account)?
        .get_password()
        .map_err(|error| format!("Could not read the stored credential: {error}"))
}

#[tauri::command]
pub fn secret_set(account: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        return Err("A credential cannot be empty".into());
    }
    entry(&account)?
        .set_password(&value)
        .map_err(|error| format!("Could not save the credential: {error}"))
}

#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete the credential: {error}")),
    }
}

#[tauri::command]
pub fn secret_has(account: String) -> Result<bool, String> {
    match entry(&account)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("Could not read the stored credential: {error}")),
    }
}

/// Only for terminal-based sign-in: the CLI needs the value in its environment.
#[tauri::command]
pub fn secret_get(account: String) -> Result<String, String> {
    read_secret(&account)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_names_are_sanitized() {
        assert!(validate_account("profile-abc:OPENAI_API_KEY").is_ok());
        assert!(validate_account("").is_err());
        assert!(validate_account("bad account").is_err());
        assert!(validate_account(&"x".repeat(MAX_ACCOUNT_LEN + 1)).is_err());
    }
}
