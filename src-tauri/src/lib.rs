mod auth;
mod config;
mod db;
mod eeg;
mod music_history;
mod python_client;
mod python_service;
mod scale_records;
mod storage_paths;
mod video_library;

use auth::UserProfile;
use db::AppDb;
use eeg::{
    BeginEegTrialInput, EegRecordingSession, EegStatus, EegStreamConfig, EegStreamInfo,
    EegStreamState, FinalizeEegTrialInput, MarkEegTrialInput, ParadigmQueueInput,
    ParadigmSessionSummary, ParadigmSummaryInput, ParadigmTrialPlanItem, ParadigmVideoLibrary,
    ParadigmVideoLibraryInput, StartEegRecordingInput, TrialRecord, TrialSnapshot,
};
use music_history::MusicHistoryItem;
use python_client::{
    AgentPlannerRequest, AgentPlannerResponse, GenerateRequest, HealthResponse, PythonClient,
};
use python_service::PythonServiceManager;
use scale_records::{RegulationEffectSummary, SaveScaleRecordInput, ScaleRecord};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[tauri::command]
async fn register_user(
    state: State<'_, AppDb>,
    username: String,
    password: String,
) -> Result<UserProfile, String> {
    let conn = state.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // Hash before acquiring the lock; Argon2 must not block other db users.
        let registration = auth::prepare_registration(&username, &password)?;
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        auth::insert_registration(&conn, registration)
    })
    .await
    .map_err(|_| "Registration task failed.".to_string())?
}

#[tauri::command]
async fn login_user(
    state: State<'_, AppDb>,
    username: String,
    password: String,
) -> Result<UserProfile, String> {
    let conn = state.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // Drop the lock before the Argon2 verification below runs.
        let stored_user = {
            let conn = conn
                .lock()
                .map_err(|_| "Database is unavailable.".to_string())?;

            auth::load_stored_user(&conn, &username)?
        };

        auth::verify_stored_user(stored_user, &password)
    })
    .await
    .map_err(|_| "Login task failed.".to_string())?
}

#[tauri::command]
async fn reset_user_password(
    state: State<'_, AppDb>,
    username: String,
    reset_code: String,
    new_password: String,
) -> Result<UserProfile, String> {
    let expected_reset_code = config::admin_reset_code()?;
    let conn = state.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        auth::reset_user_password_record(
            &conn,
            &username,
            &reset_code,
            &new_password,
            &expected_reset_code,
        )
    })
    .await
    .map_err(|_| "Password reset task failed.".to_string())?
}

#[tauri::command]
async fn start_eeg_stream(
    app: tauri::AppHandle,
    state: State<'_, EegStreamState>,
    config: Option<EegStreamConfig>,
    on_sample_block: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<EegStreamInfo, String> {
    eeg::start_stream(app, &state, config, on_sample_block)
}

#[tauri::command]
async fn stop_eeg_stream(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
) -> Result<(), String> {
    let conn = db.conn.clone();
    let state = state.inner().clone();

    // Joins the accept/client threads and flushes recording files; must not
    // block the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        eeg::stop_stream(&app, &state, &conn)
    })
    .await
    .map_err(|_| "Failed to stop EEG stream.".to_string())?
}

#[tauri::command]
async fn get_eeg_status(state: State<'_, EegStreamState>) -> Result<EegStatus, String> {
    eeg::get_status(&state)
}

#[tauri::command]
async fn start_eeg_recording(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
    input: StartEegRecordingInput,
) -> Result<EegRecordingSession, String> {
    let conn = db.conn.clone();
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        eeg::start_recording(&app, &conn, &state, input)
    })
    .await
    .map_err(|_| "Failed to start EEG recording.".to_string())?
}

#[tauri::command]
async fn stop_eeg_recording(
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
) -> Result<EegRecordingSession, String> {
    let conn = db.conn.clone();
    let state = state.inner().clone();

    // Joins the recording writer thread (flushing both binary files) and
    // persists the session row; must not block the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        eeg::stop_recording(&conn, &state)
    })
    .await
    .map_err(|_| "Failed to stop EEG recording.".to_string())?
}

#[tauri::command]
async fn list_eeg_sessions(
    db: State<'_, AppDb>,
    user_id: String,
) -> Result<Vec<EegRecordingSession>, String> {
    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        eeg::list_sessions(&conn, &user_id)
    })
    .await
    .map_err(|_| "Failed to load EEG sessions.".to_string())?
}

#[tauri::command]
async fn load_paradigm_video_library(
    input: ParadigmVideoLibraryInput,
) -> Result<ParadigmVideoLibrary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        eeg::paradigm_video::load_paradigm_video_library(&input.root_path)
    })
    .await
    .map_err(|_| "Failed to load paradigm video library.".to_string())?
}

#[tauri::command]
async fn build_paradigm_queue(
    input: ParadigmQueueInput,
) -> Result<Vec<ParadigmTrialPlanItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        eeg::paradigm_video::build_paradigm_queue_from_root(
            &input.root_path,
            &input.session_run_id,
            input.session_kind,
        )
    })
    .await
    .map_err(|_| "Failed to build paradigm queue.".to_string())?
}

#[tauri::command]
async fn begin_eeg_trial(
    state: State<'_, EegStreamState>,
    input: BeginEegTrialInput,
) -> Result<TrialSnapshot, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || eeg::paradigm_controller::begin_eeg_trial(&state, input))
        .await
        .map_err(|_| "Failed to begin EEG trial.".to_string())?
}

#[tauri::command]
async fn mark_eeg_trial(
    state: State<'_, EegStreamState>,
    input: MarkEegTrialInput,
) -> Result<TrialSnapshot, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || eeg::paradigm_controller::mark_eeg_trial(&state, input))
        .await
        .map_err(|_| "Failed to mark EEG trial.".to_string())?
}

#[tauri::command]
async fn end_eeg_trial(state: State<'_, EegStreamState>) -> Result<TrialSnapshot, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || eeg::paradigm_controller::end_eeg_trial(&state))
        .await
        .map_err(|_| "Failed to end EEG trial.".to_string())?
}

#[tauri::command]
async fn finalize_eeg_trial(
    state: State<'_, EegStreamState>,
    input: FinalizeEegTrialInput,
) -> Result<TrialRecord, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        eeg::paradigm_controller::finalize_eeg_trial(&state, input)
    })
    .await
    .map_err(|_| "Failed to finalize EEG trial.".to_string())?
}

#[tauri::command]
async fn get_active_paradigm_trial(
    state: State<'_, EegStreamState>,
) -> Result<Option<TrialSnapshot>, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        eeg::paradigm_controller::get_active_paradigm_trial(&state)
    })
    .await
    .map_err(|_| "Failed to load active paradigm trial.".to_string())?
}

#[tauri::command]
async fn get_paradigm_session_summary(
    db: State<'_, AppDb>,
    input: ParadigmSummaryInput,
) -> Result<ParadigmSessionSummary, String> {
    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        eeg::paradigm_db::get_paradigm_session_summary(&conn, &input.session_id)
    })
    .await
    .map_err(|_| "Failed to load paradigm session summary.".to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteScaleRecordInput {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComputeRegulationEffectInput {
    baseline_record_id: String,
    post_record_id: String,
}

/// Read-side envelope for the regulation-effect loop: the computed summary
/// plus the threshold verdict so the frontend never re-implements the rule.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegulationEffectResult {
    #[serde(flatten)]
    summary: RegulationEffectSummary,
    meets_threshold: bool,
}

#[tauri::command]
async fn save_scale_record(
    db: State<'_, AppDb>,
    input: SaveScaleRecordInput,
) -> Result<ScaleRecord, String> {
    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        scale_records::save_scale_record(&conn, &input)
    })
    .await
    .map_err(|_| "Failed to save scale record.".to_string())?
}

#[tauri::command]
async fn list_scale_records(
    db: State<'_, AppDb>,
    subject_id: Option<String>,
    phase: Option<String>,
) -> Result<Vec<ScaleRecord>, String> {
    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        scale_records::list_scale_records(&conn, subject_id.as_deref(), phase.as_deref())
    })
    .await
    .map_err(|_| "Failed to load scale records.".to_string())?
}

#[tauri::command]
async fn delete_scale_record(
    db: State<'_, AppDb>,
    input: DeleteScaleRecordInput,
) -> Result<ScaleRecord, String> {
    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        scale_records::delete_scale_record(&conn, &input.id)
    })
    .await
    .map_err(|_| "Failed to delete scale record.".to_string())?
}

#[tauri::command]
async fn compute_regulation_effect(
    db: State<'_, AppDb>,
    input: ComputeRegulationEffectInput,
) -> Result<RegulationEffectResult, String> {
    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        let baseline = scale_records::get_scale_record(&conn, input.baseline_record_id.trim())?;
        let post = scale_records::get_scale_record(&conn, input.post_record_id.trim())?;
        let summary = scale_records::compute_regulation_effect_summary(&baseline, &post)?;
        let meets_threshold = summary.meets_threshold();

        Ok(RegulationEffectResult {
            summary,
            meets_threshold,
        })
    })
    .await
    .map_err(|_| "Failed to compute regulation effect.".to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportEffectReportInput {
    /// `single` exports one baseline/post pair; `batch` writes every
    /// subject's most recent evaluation as CSV.
    kind: String,
    /// `json` or `csv`; single defaults to json and batch is always csv.
    format: Option<String>,
    /// Absolute destination chosen by the user through the save dialog.
    path: String,
    baseline_record_id: Option<String>,
    post_record_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportEffectReportResult {
    path: String,
    bytes: u64,
}

#[tauri::command]
async fn list_effect_history(
    db: State<'_, AppDb>,
) -> Result<Vec<scale_records::EffectHistoryEntry>, String> {
    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        let records = scale_records::list_scale_records(&conn, None, None)?;
        Ok(scale_records::build_effect_history(&records))
    })
    .await
    .map_err(|_| "Failed to load effect history.".to_string())?
}

#[tauri::command]
async fn export_effect_report(
    db: State<'_, AppDb>,
    input: ExportEffectReportInput,
) -> Result<ExportEffectReportResult, String> {
    let path = input.path.trim().to_string();
    if path.is_empty() {
        return Err("Export path is required.".to_string());
    }

    let kind = input.kind.trim().to_string();
    // Batch is CSV-only; an explicit csv on single switches its format.
    let format = if kind == "batch" {
        "csv".to_string()
    } else {
        input
            .format
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("json")
            .to_string()
    };

    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let content = match kind.as_str() {
            "single" => {
                let required_id = |label: &str, value: Option<&String>| -> Result<String, String> {
                    value
                        .map(String::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                        .ok_or_else(|| format!("{label} record id is required."))
                };
                let baseline_id = required_id("Baseline", input.baseline_record_id.as_ref())?;
                let post_id = required_id("Post", input.post_record_id.as_ref())?;

                let conn = conn
                    .lock()
                    .map_err(|_| "Database is unavailable.".to_string())?;
                let baseline = scale_records::get_scale_record(&conn, &baseline_id)?;
                let post = scale_records::get_scale_record(&conn, &post_id)?;
                let report = scale_records::build_single_effect_report(&baseline, &post)?;

                if format == "csv" {
                    scale_records::build_single_effect_report_csv(&report)
                } else {
                    serde_json::to_string_pretty(&report)
                        .map_err(|_| "Failed to serialize the report.".to_string())?
                }
            }
            "batch" => {
                let conn = conn
                    .lock()
                    .map_err(|_| "Database is unavailable.".to_string())?;
                let records = scale_records::list_scale_records(&conn, None, None)?;
                let history = scale_records::build_effect_history(&records);

                scale_records::build_batch_effect_report_csv(
                    &scale_records::latest_entry_per_subject(&history),
                )
            }
            other => return Err(format!("Unknown report kind '{other}'.")),
        };

        let bytes = content.len() as u64;
        std::fs::write(&path, content)
            .map_err(|_| "Failed to write the report file.".to_string())?;

        Ok(ExportEffectReportResult { path, bytes })
    })
    .await
    .map_err(|_| "Failed to export the report.".to_string())?
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
    let output_dir = {
        let username = input.username.clone();

        tauri::async_runtime::spawn_blocking(move || {
            storage_paths::music_user_dir(&app, &username)
        })
        .await
        .map_err(|_| "Failed to resolve music output directory.".to_string())??
    };

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

    let job_id = response.job_id;
    let conn = db.conn.clone();
    let user_id = input.user_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        music_history::save_music_history_item(
            &conn,
            &job_id,
            &user_id,
            &prompt,
            &output_path,
            Some(duration as f64),
        )
    })
    .await
    .map_err(|_| "Failed to save music history.".to_string())?
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
async fn get_agent_service_base_url(
    service: State<'_, PythonServiceManager>,
) -> Result<String, String> {
    service.ensure_agent_running().await?;

    Ok(service.base_url().to_string())
}

#[tauri::command]
async fn list_music_history(
    db: State<'_, AppDb>,
    user_id: String,
    limit: Option<u32>,
) -> Result<Vec<MusicHistoryItem>, String> {
    let conn = db.conn.clone();
    let limit = limit.unwrap_or(50);

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;

        music_history::list_music_history_items(&conn, &user_id, limit)
    })
    .await
    .map_err(|_| "Failed to load music history.".to_string())?
}

#[tauri::command]
async fn delete_music_history(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    input: DeleteMusicHistoryInput,
) -> Result<MusicHistoryItem, String> {
    let conn = db.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // Drop the lock before the file system work below.
        let deleted = {
            let conn = conn
                .lock()
                .map_err(|_| "Database is unavailable.".to_string())?;

            music_history::delete_music_history_item(&conn, &input.user_id, &input.item_id)?
        };

        delete_music_file_in_storage_root(&storage_paths::music_root(&app)?, &deleted.file_path)?;

        Ok(deleted)
    })
    .await
    .map_err(|_| "Failed to delete music history.".to_string())?
}

#[tauri::command]
async fn get_storage_location(app: tauri::AppHandle) -> Result<storage_paths::StorageLocation, String> {
    tauri::async_runtime::spawn_blocking(move || storage_paths::storage_location(&app))
        .await
        .map_err(|_| "Failed to load storage location.".to_string())?
}

#[tauri::command]
async fn set_storage_root(
    app: tauri::AppHandle,
    custom_root: Option<String>,
) -> Result<storage_paths::StorageLocation, String> {
    let settings = storage_paths::StorageSettings {
        custom_root: custom_root
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };

    tauri::async_runtime::spawn_blocking(move || storage_paths::save_storage_settings(&app, settings))
        .await
        .map_err(|_| "Failed to save storage settings.".to_string())?
}

#[tauri::command]
async fn load_video_library(folder_path: String) -> Result<video_library::VideoLibrary, String> {
    tauri::async_runtime::spawn_blocking(move || video_library::load_video_library(&folder_path))
        .await
        .map_err(|_| "Failed to load video library.".to_string())?
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
            load_paradigm_video_library,
            build_paradigm_queue,
            begin_eeg_trial,
            mark_eeg_trial,
            end_eeg_trial,
            finalize_eeg_trial,
            get_active_paradigm_trial,
            get_paradigm_session_summary,
            save_scale_record,
            list_scale_records,
            delete_scale_record,
            compute_regulation_effect,
            list_effect_history,
            export_effect_report,
            generate_music,
            get_music_service_health,
            plan_agent_action,
            get_agent_service_base_url,
            list_music_history,
            delete_music_history,
            get_storage_location,
            set_storage_root,
            load_video_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
