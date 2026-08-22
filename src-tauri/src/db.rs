use rusqlite::Connection;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub struct AppDb {
    // Arc so async commands can clone the handle into spawn_blocking closures.
    pub conn: Arc<Mutex<Connection>>,
}

pub fn init_app_db() -> Result<AppDb, String> {
    let db_path = app_db_path()?;
    let parent = db_path
        .parent()
        .ok_or_else(|| "Failed to resolve database directory.".to_string())?;

    fs::create_dir_all(parent).map_err(|_| "Failed to create database directory.".to_string())?;

    let conn = Connection::open(db_path).map_err(|_| "Failed to open database.".to_string())?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 1000;",
    )
    .map_err(|_| "Failed to configure database.".to_string())?;

    init_schema(&conn)?;

    Ok(AppDb {
        conn: Arc::new(Mutex::new(conn)),
    })
}

fn app_db_path() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| "Failed to resolve local app data directory.".to_string())?;

    Ok(base.join("tauri-eeg").join("users.sqlite3"))
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )
    .map_err(|_| "Failed to initialize database schema.".to_string())?;

    crate::music_history::init_music_history_schema(conn)?;
    crate::eeg::storage::init_eeg_session_schema(conn)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn creates_users_table() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");

        init_schema(&conn).expect("init schema");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'users'",
                [],
                |row| row.get(0),
            )
            .expect("query sqlite schema");

        assert_eq!(count, 1);
    }

    #[test]
    fn creates_music_history_table() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");

        init_schema(&conn).expect("init schema");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'music_history'",
                [],
                |row| row.get(0),
            )
            .expect("query sqlite schema");

        assert_eq!(count, 1);
    }

    #[test]
    fn creates_eeg_sessions_table() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");

        init_schema(&conn).expect("init schema");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'eeg_sessions'",
                [],
                |row| row.get(0),
            )
            .expect("query sqlite schema");

        assert_eq!(count, 1);
    }

    #[test]
    fn app_db_path_uses_local_app_directory() {
        let path = app_db_path().expect("resolve db path");

        assert!(path.ends_with(Path::new("tauri-eeg").join("users.sqlite3")));
    }
}
