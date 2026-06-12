mod auth;
mod config;
mod db;
mod eeg;
mod music_history;
mod python_client;
mod python_service;

use auth::UserProfile;
use db::AppDb;
use eeg::{
    EegRecordingSession, EegStatus, EegStreamConfig, EegStreamInfo, EegStreamState,
    StartEegRecordingInput,
};
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
    config: Option<EegStreamConfig>,
) -> Result<EegStreamInfo, String> {
    eeg::start_stream(app, &state, config)
}

#[tauri::command]
fn stop_eeg_stream(db: State<'_, AppDb>, state: State<'_, EegStreamState>) -> Result<(), String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    eeg::stop_stream(&state, &conn)
}

#[tauri::command]
fn get_eeg_status(state: State<'_, EegStreamState>) -> Result<EegStatus, String> {
    eeg::get_status(&state)
}

#[tauri::command]
fn start_eeg_recording(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
    input: StartEegRecordingInput,
) -> Result<EegRecordingSession, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    eeg::start_recording(&app, &conn, &state, input)
}

#[tauri::command]
fn stop_eeg_recording(
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
) -> Result<EegRecordingSession, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    eeg::stop_recording(&conn, &state)
}

#[tauri::command]
fn list_eeg_sessions(
    db: State<'_, AppDb>,
    user_id: String,
) -> Result<Vec<EegRecordingSession>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    eeg::list_sessions(&conn, &user_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicGenerationInput {
    user_id: String,
    prompt: String,
    duration: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteMusicHistoryInput {
    user_id: String,
    item_id: String,
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

#[tauri::command]
fn delete_music_history(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    input: DeleteMusicHistoryInput,
) -> Result<MusicHistoryItem, String> {
    let output_dir = music_output_dir(&app)?;
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    let deleted = music_history::delete_music_history_item(&conn, &input.user_id, &input.item_id)?;

    delete_music_file_in_output_dir(&output_dir, &deleted.file_path)?;

    Ok(deleted)
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

fn delete_music_file_in_output_dir(
    output_dir: &std::path::Path,
    file_path: &str,
) -> Result<(), String> {
    let output_dir = output_dir
        .canonicalize()
        .map_err(|_| "Failed to resolve music output directory.".to_string())?;
    let file_path = std::path::PathBuf::from(file_path);

    if !file_path.exists() {
        return Ok(());
    }

    let file_path = file_path
        .canonicalize()
        .map_err(|_| "Failed to resolve music file path.".to_string())?;

    if file_path.parent() != Some(output_dir.as_path()) {
        return Err("Refusing to delete a file outside the music output directory.".to_string());
    }

    if file_path.extension().and_then(|value| value.to_str()) != Some("wav") {
        return Err("Refusing to delete a non-WAV music file.".to_string());
    }

    std::fs::remove_file(&file_path).map_err(|_| "Failed to delete music file.".to_string())
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
            get_eeg_status,
            start_eeg_recording,
            stop_eeg_recording,
            list_eeg_sessions,
            generate_music,
            get_music_service_health,
            list_music_history,
            delete_music_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
