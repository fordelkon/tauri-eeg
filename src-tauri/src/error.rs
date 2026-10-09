//! App-wide error type for the Tauri command boundary.
//!
//! Every user-facing error in this app is a finished message string (Chinese
//! copy asserted verbatim by tests and shown directly in the UI), so the
//! envelope is a single `String`-based variant rather than per-domain enums.
//! Wrapping it in a newtype lets `?` propagate `String` errors from helpers
//! and gives the boundary a `Serialize` impl, while keeping the wire format
//! byte-identical to the previous `Result<T, String>` commands.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct AppError(pub String);

impl From<String> for AppError {
    fn from(message: String) -> Self {
        AppError(message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        AppError(message.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        // Database internals never reach the UI; log the detail, return the
        // generic message the commands already used.
        eprintln!("database error: {error}");
        AppError("Database is unavailable.".to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}
