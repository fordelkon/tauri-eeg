use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use rand_core::OsRng;
use rusqlite::{params, Connection, Error as SqlError};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub username: String,
}

pub fn register_user_record(
    conn: &Connection,
    username: &str,
    password: &str,
) -> Result<UserProfile, String> {
    let username = normalize_username(username)?;
    validate_password(password)?;

    let existing = find_user_by_username(conn, &username)?;
    if existing.is_some() {
        return Err("Username is already registered.".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let password_hash = hash_password(password)?;

    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, username, password_hash, now, now],
    )
    .map_err(|_| "Failed to register user.".to_string())?;

    Ok(UserProfile { id, username })
}

pub fn login_user_record(
    conn: &Connection,
    username: &str,
    password: &str,
) -> Result<UserProfile, String> {
    let username = normalize_username(username)?;
    let Some(user) = find_user_by_username(conn, &username)? else {
        return Err("Account or password is incorrect.".to_string());
    };

    if verify_password(password, &user.password_hash)? {
        return Ok(UserProfile {
            id: user.id,
            username: user.username,
        });
    }

    Err("Account or password is incorrect.".to_string())
}

pub fn reset_user_password_record(
    conn: &Connection,
    username: &str,
    reset_code: &str,
    new_password: &str,
    expected_reset_code: &str,
) -> Result<UserProfile, String> {
    let username = normalize_username(username)?;
    validate_password(new_password)?;

    if expected_reset_code.trim().is_empty() {
        return Err("Password reset is not configured.".to_string());
    }

    if reset_code != expected_reset_code {
        return Err("Reset code is incorrect.".to_string());
    }

    let Some(user) = find_user_by_username(conn, &username)? else {
        return Err("Account or password is incorrect.".to_string());
    };

    let now = Utc::now().to_rfc3339();
    let password_hash = hash_password(new_password)?;

    conn.execute(
        "UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3",
        params![password_hash, now, user.id],
    )
    .map_err(|_| "Failed to reset password.".to_string())?;

    Ok(UserProfile {
        id: user.id,
        username: user.username,
    })
}

struct StoredUser {
    id: String,
    username: String,
    password_hash: String,
}

fn normalize_username(username: &str) -> Result<String, String> {
    let username = username.trim().to_string();

    if username.is_empty() {
        return Err("Username and password are required.".to_string());
    }

    Ok(username)
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.len() < 6 {
        return Err("Password must be at least 6 characters.".to_string());
    }

    Ok(())
}

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "Failed to secure password.".to_string())
}

fn verify_password(password: &str, password_hash: &str) -> Result<bool, String> {
    let parsed_hash =
        PasswordHash::new(password_hash).map_err(|_| "Failed to verify password.".to_string())?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

fn find_user_by_username(conn: &Connection, username: &str) -> Result<Option<StoredUser>, String> {
    let result = conn.query_row(
        "SELECT id, username, password_hash FROM users WHERE username = ?1",
        params![username],
        |row| {
            Ok(StoredUser {
                id: row.get(0)?,
                username: row.get(1)?,
                password_hash: row.get(2)?,
            })
        },
    );

    match result {
        Ok(user) => Ok(Some(user)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(_) => Err("Failed to load user.".to_string()),
    }
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
        conn
    }

    #[test]
    fn registers_multiple_users_with_unique_ids() {
        let conn = setup_conn();

        let alice = register_user_record(&conn, "alice", "123456").expect("register alice");
        let bob = register_user_record(&conn, "bob", "123456").expect("register bob");

        assert_eq!(alice.username, "alice");
        assert_eq!(bob.username, "bob");
        assert_ne!(alice.id, bob.id);
    }

    #[test]
    fn rejects_duplicate_usernames() {
        let conn = setup_conn();

        register_user_record(&conn, "alice", "123456").expect("register alice");
        let result = register_user_record(&conn, "alice", "123456");

        assert_eq!(result.unwrap_err(), "Username is already registered.");
    }

    #[test]
    fn logs_in_with_correct_password() {
        let conn = setup_conn();
        let created = register_user_record(&conn, "alice", "123456").expect("register alice");

        let logged_in = login_user_record(&conn, "alice", "123456").expect("login alice");

        assert_eq!(logged_in, created);
    }

    #[test]
    fn rejects_wrong_password() {
        let conn = setup_conn();
        register_user_record(&conn, "alice", "123456").expect("register alice");

        let result = login_user_record(&conn, "alice", "wrong-password");

        assert_eq!(result.unwrap_err(), "Account or password is incorrect.");
    }

    #[test]
    fn stores_password_hash_instead_of_plaintext() {
        let conn = setup_conn();
        register_user_record(&conn, "alice", "123456").expect("register alice");

        let stored: String = conn
            .query_row(
                "SELECT password_hash FROM users WHERE username = ?1",
                params!["alice"],
                |row| row.get(0),
            )
            .expect("load hash");

        assert_ne!(stored, "123456");
        assert!(stored.starts_with("$argon2"));
    }

    #[test]
    fn resets_password_with_admin_reset_code() {
        let conn = setup_conn();
        register_user_record(&conn, "alice", "123456").expect("register alice");

        reset_user_password_record(&conn, "alice", "reset-code", "654321", "reset-code")
            .expect("reset password");

        let logged_in = login_user_record(&conn, "alice", "654321").expect("login with new password");

        assert_eq!(logged_in.username, "alice");
        assert_eq!(
            login_user_record(&conn, "alice", "123456").unwrap_err(),
            "Account or password is incorrect."
        );
    }

    #[test]
    fn rejects_wrong_admin_reset_code() {
        let conn = setup_conn();
        register_user_record(&conn, "alice", "123456").expect("register alice");

        let result = reset_user_password_record(&conn, "alice", "wrong-code", "654321", "reset-code");

        assert_eq!(result.unwrap_err(), "Reset code is incorrect.");
        assert!(login_user_record(&conn, "alice", "123456").is_ok());
    }
}
