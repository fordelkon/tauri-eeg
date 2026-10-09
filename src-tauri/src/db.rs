use rusqlite::Connection;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

#[derive(Clone)]
pub struct AppDb {
    // Arc so async commands can clone the handle into spawn_blocking closures.
    pub conn: Arc<Mutex<Connection>>,
}

impl AppDb {
    /// Locks the connection, mapping lock poison to the standard user-facing
    /// message. Prefer `with_conn` for plain read/write work.
    pub fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())
    }

    /// Runs `f` with the connection under the lock — the standard read/write
    /// path. Long-running work (Argon2, filesystem IO) must run *outside* this
    /// scope; see the login/reset commands for the drop-then-hash pattern.
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        f(&*self.lock()?)
    }
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
    crate::scale_records::init_scale_records_schema(conn)?;
    crate::experiment::init(conn)?;

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
    fn creates_experiment_runs_table() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");

        init_schema(&conn).expect("init schema");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'experiment_runs'",
                [],
                |row| row.get(0),
            )
            .expect("query sqlite schema");

        assert_eq!(count, 1);
    }

    #[test]
    fn creates_scale_records_table() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");

        init_schema(&conn).expect("init schema");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'scale_records'",
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
