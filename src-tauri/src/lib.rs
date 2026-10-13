mod auth;
mod config;
mod db;
mod effect_reports;
mod error;
mod experiment;
mod music_history;
mod paradigm;
mod python_client;
mod python_service;
mod scale_records;
mod storage_paths;
mod subjects;
mod video_library;

use auth::UserProfile;
use db::AppDb;
use effect_reports::{ExportEffectReportInput, ExportEffectReportResult};
use error::AppError;
use music_history::MusicHistoryItem;
use paradigm::{
    ParadigmQueueInput, ParadigmTrialPlanItem, ParadigmVideoLibrary, ParadigmVideoLibraryInput,
};
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
) -> Result<UserProfile, AppError> {
    let db = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        // Hash before acquiring the lock; Argon2 must not block other db users.
        let registration = auth::prepare_registration(&username, &password)?;
        db.with_conn(|conn| auth::insert_registration(conn, registration))
    })
    .await
    .map_err(|_| "Registration task failed.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn login_user(
    state: State<'_, AppDb>,
    username: String,
    password: String,
) -> Result<UserProfile, AppError> {
    let db = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        // Load under the lock, then drop it before the Argon2 verification.
        let stored_user = db.with_conn(|conn| auth::load_stored_user(conn, &username))?;
        auth::verify_stored_user(stored_user, &password)
    })
    .await
    .map_err(|_| "Login task failed.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn reset_user_password(
    state: State<'_, AppDb>,
    username: String,
    reset_code: String,
    new_password: String,
) -> Result<UserProfile, AppError> {
    let expected_reset_code = config::admin_reset_code()?;
    let db = state.inner().clone();

    let (user, password_hash) = tauri::async_runtime::spawn_blocking(move || {
        // Verify the reset code and load the account under the lock, then
        // drop the lock before Argon2 hashing runs.
        let user = db.with_conn(|conn| {
            auth::prepare_password_reset(conn, &username, &reset_code, &expected_reset_code)
        })?;

        auth::prepare_password_hash(&new_password).map(|password_hash| (user, password_hash))
    })
    .await
    .map_err(|_| "Password reset task failed.".to_string())??;

    let db = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| auth::apply_password_reset(conn, &user.id, &password_hash))
    })
    .await
    .map_err(|_| "Password reset task failed.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn load_paradigm_video_library(
    input: ParadigmVideoLibraryInput,
) -> Result<ParadigmVideoLibrary, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        paradigm::video::load_paradigm_video_library(&input.root_path)
    })
    .await
    .map_err(|_| "Failed to load paradigm video library.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn build_paradigm_queue(
    input: ParadigmQueueInput,
) -> Result<Vec<ParadigmTrialPlanItem>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        paradigm::video::build_paradigm_queue_from_root(
            &input.root_path,
            &input.session_run_id,
            input.session_kind,
        )
    })
    .await
    .map_err(|_| "Failed to build paradigm queue.".to_string())?
    .map_err(AppError)
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
) -> Result<ScaleRecord, AppError> {
    let db = db.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| scale_records::save_scale_record(conn, &input))
    })
    .await
    .map_err(|_| "Failed to save scale record.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn list_scale_records(
    db: State<'_, AppDb>,
    subject_id: Option<String>,
    phase: Option<String>,
) -> Result<Vec<ScaleRecord>, AppError> {
    let db = db.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| {
            scale_records::list_scale_records(conn, subject_id.as_deref(), phase.as_deref())
        })
    })
    .await
    .map_err(|_| "Failed to load scale records.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn delete_scale_record(
    db: State<'_, AppDb>,
    input: DeleteScaleRecordInput,
) -> Result<ScaleRecord, AppError> {
    let db = db.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| scale_records::delete_scale_record(conn, &input.id))
    })
    .await
    .map_err(|_| "Failed to delete scale record.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn compute_regulation_effect(
    db: State<'_, AppDb>,
    input: ComputeRegulationEffectInput,
) -> Result<RegulationEffectResult, AppError> {
    let db = db.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| {
            let baseline = scale_records::get_scale_record(conn, input.baseline_record_id.trim())?;
            let post = scale_records::get_scale_record(conn, input.post_record_id.trim())?;
            experiment::report::require_same_run(conn, &baseline.id, &post.id)?;
            let summary = scale_records::compute_regulation_effect_summary(&baseline, &post)?;
            let meets_threshold = summary.meets_threshold();

            Ok(RegulationEffectResult {
                summary,
                meets_threshold,
            })
        })
    })
    .await
    .map_err(|_| "Failed to compute regulation effect.".to_string())?
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComputeConditionEffectInput {
    subject_id: String,
    emotion: String,
}

#[tauri::command]
async fn compute_condition_effect(
    db: State<'_, AppDb>,
    input: ComputeConditionEffectInput,
) -> Result<scale_records::ConditionEffectComparison, AppError> {
    let db = db.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| {
            // Subject pushdown: compute_condition_effect_comparison rejects
            // every entry whose subject differs from the target (NULL-subject
            // rows group under ""), so unbound rows can never contribute and
            // filtering them in SQL keeps the result identical while the
            // planner uses the subject+created_at index.
            let records =
                scale_records::list_scale_records(conn, Some(input.subject_id.trim()), None)?;
            let records = experiment::report::eligible_records(conn, records)?;
            // 大纲 6.2: 调控条件相对基线条件（自然恢复）的改善，按 subject+emotion
            // 取两条件各自最新完整 run 配对计算。
            scale_records::compute_condition_effect_comparison(
                &records,
                input.subject_id.trim(),
                input.emotion.trim(),
            )
        })
    })
    .await
    .map_err(|_| "Failed to compute condition effect.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn list_effect_history(
    db: State<'_, AppDb>,
) -> Result<Vec<scale_records::EffectHistoryEntry>, AppError> {
    let db = db.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| {
            let records = scale_records::list_scale_records(conn, None, None)?;
            let records = experiment::report::eligible_records(conn, records)?;
            Ok(scale_records::build_effect_history(&records))
        })
    })
    .await
    .map_err(|_| "Failed to load effect history.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn export_effect_report(
    db: State<'_, AppDb>,
    input: ExportEffectReportInput,
) -> Result<ExportEffectReportResult, AppError> {
    let path = effect_reports::resolve_export_path(&input.path)?;
    let db = db.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let content = db.with_conn(|conn| effect_reports::build_report_content(conn, input))?;

        let bytes = content.len() as u64;
        std::fs::write(&path, content)
            .map_err(|_| "Failed to write the report file.".to_string())?;

        Ok(ExportEffectReportResult {
            path: path.to_string_lossy().to_string(),
            bytes,
        })
    })
    .await
    .map_err(|_| "Failed to export the report.".to_string())?
    .map_err(AppError)
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
) -> Result<MusicHistoryItem, AppError> {
    let prompt = input.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Prompt is required.".to_string().into());
    }

    let duration = input.duration.clamp(5, 120);
    let job_id = Uuid::new_v4().to_string();
    let output_dir = {
        let username = input.username.clone();

        tauri::async_runtime::spawn_blocking(move || storage_paths::music_user_dir(&app, &username))
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
            .unwrap_or_else(|| "Music generation failed.".to_string())
            .into());
    }

    let output_path = response
        .output_path
        .ok_or_else(|| "Music generation did not return a WAV file.".to_string())?;

    let job_id = response.job_id;
    let db = db.inner().clone();
    let user_id = input.user_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| {
            music_history::save_music_history_item(
                conn,
                &job_id,
                &user_id,
                &prompt,
                &output_path,
                Some(duration as f64),
            )
        })
    })
    .await
    .map_err(|_| "Failed to save music history.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn get_music_service_health(
    service: State<'_, PythonServiceManager>,
) -> Result<HealthResponse, AppError> {
    service.ensure_running().await?;

    PythonClient::new(service.base_url().to_string())
        .health()
        .await
        .map_err(AppError)
}

#[tauri::command]
async fn plan_agent_action(
    service: State<'_, PythonServiceManager>,
    request: AgentPlannerRequest,
) -> Result<AgentPlannerResponse, AppError> {
    service.ensure_agent_running().await?;

    PythonClient::new(service.base_url().to_string())
        .plan_agent(&request)
        .await
        .map_err(AppError)
}

#[tauri::command]
async fn get_agent_service_base_url(
    service: State<'_, PythonServiceManager>,
) -> Result<String, AppError> {
    service.ensure_agent_running().await?;

    Ok(service.base_url().to_string())
}

#[tauri::command]
async fn list_music_history(
    db: State<'_, AppDb>,
    user_id: String,
    limit: Option<u32>,
) -> Result<Vec<MusicHistoryItem>, AppError> {
    let db = db.inner().clone();
    let limit = limit.unwrap_or(50);

    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| music_history::list_music_history_items(conn, &user_id, limit))
    })
    .await
    .map_err(|_| "Failed to load music history.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn delete_music_history(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    input: DeleteMusicHistoryInput,
) -> Result<MusicHistoryItem, AppError> {
    let db = db.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        // Drop the lock before the file system work below.
        let deleted = db.with_conn(|conn| {
            music_history::delete_music_history_item(conn, &input.user_id, &input.item_id)
        })?;

        delete_music_file_in_storage_root(&storage_paths::music_root(&app)?, &deleted.file_path)?;

        Ok(deleted)
    })
    .await
    .map_err(|_| "Failed to delete music history.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn get_storage_location(
    app: tauri::AppHandle,
) -> Result<storage_paths::StorageLocation, AppError> {
    tauri::async_runtime::spawn_blocking(move || storage_paths::storage_location(&app))
        .await
        .map_err(|_| "Failed to load storage location.".to_string())?
        .map_err(AppError)
}

#[tauri::command]
async fn set_storage_root(
    app: tauri::AppHandle,
    custom_root: Option<String>,
) -> Result<storage_paths::StorageLocation, AppError> {
    let settings = storage_paths::StorageSettings {
        custom_root: custom_root
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };

    tauri::async_runtime::spawn_blocking(move || {
        storage_paths::save_storage_settings(&app, settings)
    })
    .await
    .map_err(|_| "Failed to save storage settings.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn load_video_library(
    folder_path: String,
) -> Result<video_library::SharedVideoLibrary, AppError> {
    tauri::async_runtime::spawn_blocking(move || video_library::load_video_library(&folder_path))
        .await
        .map_err(|_| "Failed to load video library.".to_string())?
        .map_err(AppError)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListSubjectsInput {
    user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteSubjectInput {
    id: String,
    user_id: String,
}

#[tauri::command]
async fn list_subjects(
    db: State<'_, AppDb>,
    user_id: Option<String>,
    input: Option<ListSubjectsInput>,
) -> Result<Vec<subjects::Subject>, AppError> {
    let uid = match (user_id, input) {
        (Some(u), _) if !u.trim().is_empty() => u,
        (_, Some(inp)) if !inp.user_id.trim().is_empty() => inp.user_id,
        _ => return Err("User ID is required.".to_string().into()),
    };

    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| subjects::list_subjects(conn, &uid))
    })
    .await
    .map_err(|_| "Failed to list subjects.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn save_subject(
    db: State<'_, AppDb>,
    input: subjects::SaveSubjectInput,
) -> Result<subjects::Subject, AppError> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| subjects::save_subject(conn, &input))
    })
    .await
    .map_err(|_| "Failed to save subject.".to_string())?
    .map_err(AppError)
}

#[tauri::command]
async fn delete_subject(
    db: State<'_, AppDb>,
    id: Option<String>,
    user_id: Option<String>,
    input: Option<DeleteSubjectInput>,
) -> Result<subjects::Subject, AppError> {
    let (target_id, target_user_id) = match (id, user_id, input) {
        (_, _, Some(inp)) => (inp.id, inp.user_id),
        (Some(i), Some(u), _) => (i, u),
        _ => return Err("Both subject ID and user ID are required.".to_string().into()),
    };

    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| subjects::delete_subject(conn, &target_id, &target_user_id))
    })
    .await
    .map_err(|_| "Failed to delete subject.".to_string())?
    .map_err(AppError)
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
    let experiment_service = experiment::Service::new(app_db.conn.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_db)
        .manage(experiment_service)
        .manage(PythonServiceManager::new())
        .invoke_handler(tauri::generate_handler![
            register_user,
            login_user,
            reset_user_password,
            load_paradigm_video_library,
            build_paradigm_queue,
            experiment::trigger_list_ports,
            experiment::trigger_connect,
            experiment::trigger_disconnect,
            experiment::trigger_status,
            experiment::trigger_test,
            experiment::experiment_start,
            experiment::experiment_event,
            experiment::experiment_finish,
            experiment::experiment_abort,
            experiment::experiment_list,
            experiment::experiment_get,
            experiment::experiment_associate_bdf,
            experiment::experiment_save_trial,
            experiment::experiment_link_scale,
            experiment::experiment_export,
            save_scale_record,
            list_scale_records,
            delete_scale_record,
            compute_regulation_effect,
            compute_condition_effect,
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
            load_video_library,
            list_subjects,
            save_subject,
            delete_subject
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
