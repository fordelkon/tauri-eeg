mod auth;
mod config;
mod db;

use auth::UserProfile;
use db::AppDb;
use tauri::State;

#[tauri::command]
fn register_user(
    state: State<'_, AppDb>,
    username: String,
    password: String,
) -> Result<UserProfile, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    auth::register_user_record(&conn, &username, &password)
}

#[tauri::command]
fn login_user(
    state: State<'_, AppDb>,
    username: String,
    password: String,
) -> Result<UserProfile, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    auth::login_user_record(&conn, &username, &password)
}

#[tauri::command]
fn reset_user_password(
    state: State<'_, AppDb>,
    username: String,
    reset_code: String,
    new_password: String,
) -> Result<UserProfile, String> {
    let expected_reset_code = config::admin_reset_code()?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    auth::reset_user_password_record(
        &conn,
        &username,
        &reset_code,
        &new_password,
        &expected_reset_code,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_db = db::init_app_db().expect("failed to initialize app database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_db)
        .invoke_handler(tauri::generate_handler![
            register_user,
            login_user,
            reset_user_password
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
