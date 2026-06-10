use std::{env, fs, path::PathBuf};

const ADMIN_RESET_CODE_KEY: &str = "TAURI_EEG_ADMIN_RESET_CODE";

pub fn admin_reset_code() -> Result<String, String> {
    if let Some(value) = non_empty_env_var(ADMIN_RESET_CODE_KEY) {
        return Ok(value);
    }

    for path in dotenv_candidates() {
        let Ok(contents) = fs::read_to_string(path) else {
            continue;
        };

        if let Some(value) = parse_env_value(&contents, ADMIN_RESET_CODE_KEY) {
            return Ok(value);
        }
    }

    Err("Password reset is not configured.".to_string())
}

fn non_empty_env_var(key: &str) -> Option<String> {
    env::var(key).ok().and_then(non_empty_value)
}

fn non_empty_value(value: String) -> Option<String> {
    let trimmed = value.trim().to_string();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn dotenv_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = env::current_dir() {
        candidates.extend(
            current_dir
                .ancestors()
                .map(|path| path.join(".env"))
                .collect::<Vec<_>>(),
        );
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.extend(
                exe_dir
                    .ancestors()
                    .map(|path| path.join(".env"))
                    .collect::<Vec<_>>(),
            );
        }
    }

    candidates
}

fn parse_env_value(contents: &str, key: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let line = line.trim();

        if line.is_empty() || line.starts_with('#') {
            return None;
        }

        let (line_key, value) = line.split_once('=')?;

        if line_key.trim() != key {
            return None;
        }

        non_empty_value(unquote_env_value(value.trim()))
    })
}

fn unquote_env_value(value: &str) -> String {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];

        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }

    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_admin_reset_code_from_env_contents() {
        let contents = r#"
            # local development reset code
            TAURI_EEG_ADMIN_RESET_CODE="local-reset-code"
        "#;

        let reset_code = parse_env_value(contents, ADMIN_RESET_CODE_KEY);

        assert_eq!(reset_code.as_deref(), Some("local-reset-code"));
    }

    #[test]
    fn ignores_empty_admin_reset_code() {
        let contents = "TAURI_EEG_ADMIN_RESET_CODE=   ";

        let reset_code = parse_env_value(contents, ADMIN_RESET_CODE_KEY);

        assert!(reset_code.is_none());
    }
}
