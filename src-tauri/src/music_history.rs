use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;

pub const DEFAULT_MODEL_VERSION: &str = "stable-audio-3-small-music";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicHistoryItem {
    pub id: String,
    pub user_id: String,
    pub prompt: String,
    pub file_path: String,
    pub duration_seconds: Option<f64>,
    pub created_at: String,
    pub model_version: String,
}

pub fn init_music_history_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS music_history (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            prompt TEXT NOT NULL,
            file_path TEXT NOT NULL,
            duration_seconds REAL,
            created_at TEXT NOT NULL,
            model_version TEXT NOT NULL DEFAULT 'stable-audio-3-small-music',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )",
        [],
    )
    .map_err(|_| "Failed to initialize music history schema.".to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_music_history_user_created
            ON music_history(user_id, created_at DESC)",
        [],
    )
    .map_err(|_| "Failed to initialize music history index.".to_string())?;

    Ok(())
}

pub fn save_music_history_item(
    conn: &Connection,
    id: &str,
    user_id: &str,
    prompt: &str,
    file_path: &str,
    duration_seconds: Option<f64>,
) -> Result<MusicHistoryItem, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required.".to_string());
    }

    let created_at = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO music_history
            (id, user_id, prompt, file_path, duration_seconds, created_at, model_version)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            user_id,
            prompt,
            file_path,
            duration_seconds,
            created_at,
            DEFAULT_MODEL_VERSION
        ],
    )
    .map_err(|_| "Failed to save music history.".to_string())?;

    Ok(MusicHistoryItem {
        id: id.to_string(),
        user_id: user_id.to_string(),
        prompt: prompt.to_string(),
        file_path: file_path.to_string(),
        duration_seconds,
        created_at,
        model_version: DEFAULT_MODEL_VERSION.to_string(),
    })
}

pub fn list_music_history_items(
    conn: &Connection,
    user_id: &str,
    limit: u32,
) -> Result<Vec<MusicHistoryItem>, String> {
    let limit = limit.clamp(1, 100);
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, prompt, file_path, duration_seconds, created_at, model_version
                FROM music_history
                WHERE user_id = ?1
                ORDER BY created_at DESC
                LIMIT ?2",
        )
        .map_err(|_| "Failed to load music history.".to_string())?;

    let rows = stmt
        .query_map(params![user_id, limit], |row| {
            Ok(MusicHistoryItem {
                id: row.get(0)?,
                user_id: row.get(1)?,
                prompt: row.get(2)?,
                file_path: row.get(3)?,
                duration_seconds: row.get(4)?,
                created_at: row.get(5)?,
                model_version: row.get(6)?,
            })
        })
        .map_err(|_| "Failed to load music history.".to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to load music history.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .expect("create users table");
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at, updated_at)
                VALUES ('user-1', 'alice', 'hash', 'now', 'now')",
            [],
        )
        .expect("insert user");
        init_music_history_schema(&conn).expect("init music schema");
        conn
    }

    #[test]
    fn saves_and_lists_wav_generation_history_by_user() {
        let conn = setup_conn();

        save_music_history_item(
            &conn,
            "job-1",
            "user-1",
            " calm piano ",
            "C:/Users/name/AppData/Local/tauri-eeg/music/gen_job.wav",
            Some(30.0),
        )
        .expect("save history");

        let items = list_music_history_items(&conn, "user-1", 20).expect("list history");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "job-1");
        assert_eq!(items[0].prompt, "calm piano");
        assert!(items[0].file_path.ends_with("gen_job.wav"));
        assert_eq!(items[0].model_version, DEFAULT_MODEL_VERSION);
    }

    #[test]
    fn rejects_empty_prompt() {
        let conn = setup_conn();

        let result = save_music_history_item(&conn, "job-1", "user-1", " ", "out.wav", Some(30.0));

        assert_eq!(result.unwrap_err(), "Prompt is required.");
    }
}
