mod auth;
mod config;
mod db;
mod eeg;
mod music_history;
mod neuro_music_client;
mod neuro_music_service;
mod python_client;
mod python_service;
mod storage_paths;
mod video_library;

use auth::UserProfile;
use db::AppDb;
use eeg::{
    EegRecordingSession, EegStatus, EegStreamConfig, EegStreamInfo, EegStreamState,
    StartEegRecordingInput,
};
use music_history::MusicHistoryItem;
use neuro_music_client::{
    EegEmotionPredictRequest, EegEmotionResponse, NeuroEmotionControlRequest, NeuroMusicClient,
    NeuroMusicHealthResponse, NeuroMusicSessionStatus, StartNeuroMusicSessionRequest,
};
use neuro_music_service::NeuroMusicServiceManager;
use python_client::{GenerateRequest, HealthResponse, PythonClient};
use python_client::{
    AgentPlannerRequest, AgentPlannerResponse, GenerateRequest, HealthResponse, PythonClient,
};
use python_service::PythonServiceManager;
use serde::Deserialize;
use tauri::State;
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
    username: String,
    prompt: String,
    duration: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteMusicHistoryInput {
    user_id: String,
    item_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartNeuroMusicInput {
    user_id: String,
    username: String,
    mode: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PredictEegEmotionInput {
    channel_ids: Vec<String>,
    sample_rate_hz: u32,
    started_at_ms: Option<i64>,
    samples: Vec<Vec<f32>>,
    trigger_class: Option<u8>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeuroEmotionControlInput {
    emotion: String,
    probabilities: std::collections::HashMap<String, f64>,
    valence: f64,
    arousal: f64,
    playback_pos: Option<f64>,
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
    let output_dir = storage_paths::music_user_dir(&app, &input.username)?;

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
async fn get_neuro_music_health(
    service: State<'_, NeuroMusicServiceManager>,
) -> Result<NeuroMusicHealthResponse, String> {
    service.ensure_running().await?;

    NeuroMusicClient::new(service.base_url().to_string())
        .health()
        .await
}

#[tauri::command]
async fn predict_eeg_emotion(
    service: State<'_, NeuroMusicServiceManager>,
    input: PredictEegEmotionInput,
) -> Result<EegEmotionResponse, String> {
    service.ensure_running().await?;

    NeuroMusicClient::new(service.base_url().to_string())
        .predict_eeg_emotion(&EegEmotionPredictRequest {
            channel_ids: input.channel_ids,
            sample_rate_hz: input.sample_rate_hz,
            started_at_ms: input.started_at_ms,
            samples: input.samples,
            trigger_class: input.trigger_class,
            source: input
                .source
                .unwrap_or_else(|| "tauri-eeg-live-32ch".to_string()),
        })
        .await
}

#[tauri::command]
async fn get_latest_eeg_emotion(
    service: State<'_, NeuroMusicServiceManager>,
) -> Result<EegEmotionResponse, String> {
    service.ensure_running().await?;

    NeuroMusicClient::new(service.base_url().to_string())
        .latest_eeg_emotion()
        .await
}

#[tauri::command]
async fn start_neuro_music_session(
    service: State<'_, NeuroMusicServiceManager>,
    input: StartNeuroMusicInput,
) -> Result<NeuroMusicSessionStatus, String> {
    service.ensure_running().await?;

    NeuroMusicClient::new(service.base_url().to_string())
        .start_session(&StartNeuroMusicSessionRequest {
            user_id: input.user_id,
            username: input.username,
            mode: input.mode,
            prompt: input.prompt,
        })
        .await
}

#[tauri::command]
async fn stop_neuro_music_session(
    service: State<'_, NeuroMusicServiceManager>,
) -> Result<NeuroMusicSessionStatus, String> {
    service.ensure_running().await?;

    NeuroMusicClient::new(service.base_url().to_string())
        .stop_session()
        .await
}

#[tauri::command]
async fn get_neuro_music_session_status(
    service: State<'_, NeuroMusicServiceManager>,
) -> Result<NeuroMusicSessionStatus, String> {
    service.ensure_running().await?;

    NeuroMusicClient::new(service.base_url().to_string())
        .session_status()
        .await
}

#[tauri::command]
async fn send_neuro_music_emotion_control(
    service: State<'_, NeuroMusicServiceManager>,
    input: NeuroEmotionControlInput,
) -> Result<NeuroMusicSessionStatus, String> {
    service.ensure_running().await?;

    NeuroMusicClient::new(service.base_url().to_string())
        .control_emotion(&NeuroEmotionControlRequest {
            emotion: input.emotion,
            probabilities: input.probabilities,
            valence: input.valence,
            arousal: input.arousal,
            playback_pos: input.playback_pos.unwrap_or(0.0),
        })
async fn plan_agent_action(
    service: State<'_, PythonServiceManager>,
    request: AgentPlannerRequest,
) -> Result<AgentPlannerResponse, String> {
    service.ensure_agent_running().await?;

    PythonClient::new(service.base_url().to_string())
        .plan_agent(&request)
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
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    let deleted = music_history::delete_music_history_item(&conn, &input.user_id, &input.item_id)?;

    delete_music_file_in_storage_root(&storage_paths::music_root(&app)?, &deleted.file_path)?;

    Ok(deleted)
}

#[tauri::command]
fn get_storage_location(app: tauri::AppHandle) -> Result<storage_paths::StorageLocation, String> {
    storage_paths::storage_location(&app)
}

#[tauri::command]
fn set_storage_root(
    app: tauri::AppHandle,
    custom_root: Option<String>,
) -> Result<storage_paths::StorageLocation, String> {
    storage_paths::save_storage_settings(
        &app,
        storage_paths::StorageSettings {
            custom_root: custom_root
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        },
    )
}

#[tauri::command]
fn load_video_library(folder_path: String) -> Result<video_library::VideoLibrary, String> {
    video_library::load_video_library(&folder_path)
}

fn delete_music_file_in_storage_root(
    storage_root: &std::path::Path,
    file_path: &str,
) -> Result<(), String> {
    let storage_root = storage_root
        .canonicalize()
        .map_err(|_| "Failed to resolve music output directory.".to_string())?;
    let file_path = std::path::PathBuf::from(file_path);

    if !file_path.exists() {
        return Ok(());
    }

    let file_path = file_path
        .canonicalize()
        .map_err(|_| "Failed to resolve music file path.".to_string())?;

    if !file_path.starts_with(&storage_root) {
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_db)
        .manage(EegStreamState::default())
        .manage(PythonServiceManager::new())
        .manage(NeuroMusicServiceManager::new())
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
            get_neuro_music_health,
            predict_eeg_emotion,
            get_latest_eeg_emotion,
            start_neuro_music_session,
            stop_neuro_music_session,
            get_neuro_music_session_status,
            send_neuro_music_emotion_control,
            plan_agent_action,
            list_music_history,
            delete_music_history,
            get_storage_location,
            set_storage_root,
            load_video_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
