use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageSettings {
    pub custom_root: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocation {
    pub root: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserStorageRoots {
    pub user_dir: PathBuf,
    pub eeg_recordings_dir: PathBuf,
    pub music_dir: PathBuf,
}

const SETTINGS_FILE_NAME: &str = "storage-settings.json";

pub fn safe_username_dir_segment(username: &str) -> Result<String, String> {
    let mut value = String::new();

    for ch in username.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            value.push(ch);
        } else if ch.is_whitespace() || ch == '.' || ch == '/' || ch == '\\' {
            if !value.ends_with('_') {
                value.push('_');
            }
        }
    }

    let value = value.trim_matches('_').to_string();
    if value.is_empty() {
        return Err("Username cannot be used as a folder name.".to_string());
    }

    Ok(value)
}

pub fn user_storage_roots(root: &Path, username: &str) -> Result<UserStorageRoots, String> {
    let user_dir = root.join(safe_username_dir_segment(username)?);

    Ok(UserStorageRoots {
        eeg_recordings_dir: user_dir.join("eeg_recordings"),
        music_dir: user_dir.join("music"),
        user_dir,
    })
}

pub fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve app data directory.".to_string())?
        .join(SETTINGS_FILE_NAME))
}

pub fn load_storage_settings(app: &tauri::AppHandle) -> Result<StorageSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(StorageSettings::default());
    }

    let text =
        fs::read_to_string(path).map_err(|_| "Failed to read storage settings.".to_string())?;
    serde_json::from_str(&text).map_err(|_| "Storage settings are invalid.".to_string())
}

pub fn save_storage_settings(
    app: &tauri::AppHandle,
    settings: StorageSettings,
) -> Result<StorageLocation, String> {
    if let Some(root) = settings.custom_root.as_deref() {
        validate_custom_root(root)?;
    }

    let path = settings_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Failed to resolve storage settings directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|_| "Failed to create storage settings directory.".to_string())?;

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|_| "Failed to serialize storage settings.".to_string())?;
    fs::write(path, json).map_err(|_| "Failed to save storage settings.".to_string())?;

    storage_location(app)
}

pub fn storage_location(app: &tauri::AppHandle) -> Result<StorageLocation, String> {
    Ok(StorageLocation {
        root: storage_root(app)?.to_string_lossy().to_string(),
    })
}

pub fn storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let settings = load_storage_settings(app)?;
    if let Some(root) = settings.custom_root {
        validate_custom_root(&root)?;
        return Ok(PathBuf::from(root));
    }

    app.path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve app data directory.".to_string())
}

pub fn eeg_recordings_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    storage_root(app)
}

pub fn music_user_dir(app: &tauri::AppHandle, username: &str) -> Result<PathBuf, String> {
    let roots = user_storage_roots(&storage_root(app)?, username)?;
    fs::create_dir_all(&roots.music_dir)
        .map_err(|_| "Failed to create user music directory.".to_string())?;
    Ok(roots.music_dir)
}

pub fn music_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    storage_root(app)
}

pub fn validate_custom_root(root: &str) -> Result<(), String> {
    let root = root.trim();
    if root.is_empty() {
        return Err("Storage path is required.".to_string());
    }

    let path = Path::new(root);
    if !path.is_absolute() {
        return Err("Storage path must be absolute.".to_string());
    }

    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Storage path cannot contain parent directory segments.".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_username_keeps_human_readable_ascii_names() {
        assert_eq!(safe_username_dir_segment("ikun").unwrap(), "ikun");
        assert_eq!(safe_username_dir_segment("ikun_01").unwrap(), "ikun_01");
    }

    #[test]
    fn safe_username_replaces_path_separators_and_spaces() {
        assert_eq!(safe_username_dir_segment("I Kun").unwrap(), "I_Kun");
        assert_eq!(safe_username_dir_segment("../ikun").unwrap(), "ikun");
        assert_eq!(safe_username_dir_segment("a\\b/c").unwrap(), "a_b_c");
    }

    #[test]
    fn safe_username_rejects_empty_names_after_sanitization() {
        assert_eq!(
            safe_username_dir_segment("///").unwrap_err(),
            "Username cannot be used as a folder name."
        );
    }

    #[test]
    fn user_scoped_roots_put_username_before_data_kind() {
        let root = std::path::Path::new("D:/ExperimentData");
        let roots = user_storage_roots(root, "ikun").expect("resolve roots");

        assert_eq!(
            roots.eeg_recordings_dir,
            std::path::Path::new("D:/ExperimentData")
                .join("ikun")
                .join("eeg_recordings")
        );
        assert_eq!(
            roots.music_dir,
            std::path::Path::new("D:/ExperimentData")
                .join("ikun")
                .join("music")
        );
    }
}
