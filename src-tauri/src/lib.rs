mod auth;
mod config;
mod db;
mod eeg;
mod music_history;
mod python_client;
mod python_service;

use auth::UserProfile;
use db::AppDb;
use eeg::{EegStreamInfo, EegStreamState};
use music_history::MusicHistoryItem;
use python_client::{GenerateRequest, HealthResponse, PythonClient};
use python_service::PythonServiceManager;
use serde::Deserialize;
use tauri::{Manager, State};
use uuid::Uuid;

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

#[tauri::command]
fn start_eeg_stream(
    app: tauri::AppHandle,
    state: State<'_, EegStreamState>,
) -> Result<EegStreamInfo, String> {
    eeg::start_stream(app, &state)
}

#[tauri::command]
fn stop_eeg_stream(state: State<'_, EegStreamState>) -> Result<(), String> {
    eeg::stop_stream(&state)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicGenerationInput {
    user_id: String,
    prompt: String,
    duration: u32,
}

#[tauri::command]
async fn generate_music(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    service: State<'_, PythonServiceManager>,
    input: MusicGenerationInput,
) -> Result<MusicHistoryItem, String> {
    let prompt = input.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Prompt is required.".to_string());
    }

    let duration = input.duration.clamp(5, 120);
    let job_id = Uuid::new_v4().to_string();
    let output_dir = music_output_dir(&app)?;

    service.ensure_running().await?;

    let client = PythonClient::new(service.base_url().to_string());
    let response = client
        .generate(&GenerateRequest {
            duration,
            job_id: job_id.clone(),
            negative_prompt: "vocals, singing, speech, lyrics".to_string(),
            output_dir: output_dir.to_string_lossy().to_string(),
            prompt: prompt.clone(),
        })
        .await?;

    if response.status != "completed" || response.progress < 100 {
        return Err(response
            .error
            .unwrap_or_else(|| "Music generation failed.".to_string()));
    }

    let output_path = response
        .output_path
        .ok_or_else(|| "Music generation did not return a WAV file.".to_string())?;

    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    music_history::save_music_history_item(
        &conn,
        &response.job_id,
        &input.user_id,
        &prompt,
        &output_path,
        Some(duration as f64),
    )
}

#[tauri::command]
async fn get_music_service_health(
    service: State<'_, PythonServiceManager>,
) -> Result<HealthResponse, String> {
    service.ensure_running().await?;

    PythonClient::new(service.base_url().to_string())
        .health()
        .await
}

#[tauri::command]
fn list_music_history(
    db: State<'_, AppDb>,
    user_id: String,
    limit: Option<u32>,
) -> Result<Vec<MusicHistoryItem>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    music_history::list_music_history_items(&conn, &user_id, limit.unwrap_or(50))
}

fn music_output_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve app data directory.".to_string())?;
    let music_dir = base.join("music");

    std::fs::create_dir_all(&music_dir)
        .map_err(|_| "Failed to create music output directory.".to_string())?;

    Ok(music_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_db = db::init_app_db().expect("failed to initialize app database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_db)
        .manage(EegStreamState::default())
        .manage(PythonServiceManager::new())
        .invoke_handler(tauri::generate_handler![
            register_user,
            login_user,
            reset_user_password,
            start_eeg_stream,
            stop_eeg_stream,
            generate_music,
            get_music_service_health,
            list_music_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
