use rusqlite::OptionalExtension;
pub mod report;
mod store;
#[cfg(test)]
mod tests;
mod types;
mod validation;
mod worker;
use crate::db::AppDb;
use serde_json::{json, Value};
use tauri::State;
use types::*;
pub use worker::Service;
pub fn init(conn: &rusqlite::Connection) -> Result<(), String> {
    store::init(conn)
}

async fn call<T: serde::de::DeserializeOwned + Send + 'static>(
    service: State<'_, Service>,
    job: Box<dyn FnOnce(&mut worker::Worker) -> Result<Value, String> + Send>,
) -> Result<T, String> {
    // The worker serializes all commands; the caller yields the UI runtime while it waits.
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.call(job))
        .await
        .map_err(|e| e.to_string())?
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Port {
    port_name: String,
    description: String,
}
#[tauri::command]
pub async fn trigger_list_ports() -> Result<Vec<Port>, String> {
    serialport::available_ports()
        .map_err(|e| e.to_string())
        .map(|ports| {
            ports
                .into_iter()
                .map(|p| Port {
                    description: match p.port_type {
                        serialport::SerialPortType::UsbPort(info) => info
                            .product
                            .unwrap_or_else(|| "USB serial interface".into()),
                        _ => "Serial port".into(),
                    },
                    port_name: p.port_name,
                })
                .collect()
        })
}
#[tauri::command]
pub async fn trigger_connect(
    service: State<'_, Service>,
    port_name: String,
) -> Result<Status, String> {
    call(service, Box::new(move |w| w.connect(port_name))).await
}
#[tauri::command]
pub async fn trigger_disconnect(service: State<'_, Service>) -> Result<Status, String> {
    call(service, Box::new(|w| w.disconnect())).await
}
#[tauri::command]
pub async fn trigger_status(service: State<'_, Service>) -> Result<Status, String> {
    call(service, Box::new(|w| worker::value(w.status.clone()))).await
}
#[tauri::command]
pub async fn trigger_test(service: State<'_, Service>) -> Result<Status, String> {
    call(service, Box::new(|w| w.test())).await
}
#[tauri::command]
pub async fn experiment_start(
    service: State<'_, Service>,
    input: StartInput,
) -> Result<Run, String> {
    call(service, Box::new(move |w| w.start(input))).await
}
#[tauri::command]
pub async fn experiment_event(
    service: State<'_, Service>,
    input: EventInput,
) -> Result<Event, String> {
    if ["run_start", "run_end", "run_abort"].contains(&input.event.as_str()) {
        return Err("Lifecycle events are backend owned.".into());
    }
    call(service, Box::new(move |w| w.emit(input))).await
}
#[tauri::command]
pub async fn experiment_finish(service: State<'_, Service>, run_id: String) -> Result<Run, String> {
    call(service, Box::new(move |w| w.finish(run_id, None))).await
}
#[tauri::command]
pub async fn experiment_abort(
    service: State<'_, Service>,
    run_id: String,
    reason: String,
) -> Result<Run, String> {
    call(service, Box::new(move |w| w.finish(run_id, Some(reason)))).await
}
#[tauri::command]
pub async fn experiment_list(
    db: State<'_, AppDb>,
    user_id: Option<String>,
) -> Result<Vec<Run>, String> {
    let conn = db.conn.lock().map_err(|_| "Database unavailable")?;
    if let Some(id) = user_id {
        store::all(
            &conn,
            "SELECT data FROM experiment_runs WHERE user_id=?1 ORDER BY rowid DESC",
            Some(&id),
        )
    } else {
        store::all(
            &conn,
            "SELECT data FROM experiment_runs ORDER BY rowid DESC",
            None,
        )
    }
}
pub fn detail(conn: &rusqlite::Connection, id: &str) -> Result<Value, String> {
    let run = store::run(conn, id)?;
    let events: Vec<Event> = store::all(
        conn,
        "SELECT data FROM experiment_events WHERE run_id=?1 ORDER BY sequence",
        Some(id),
    )?;
    let trials: Vec<Value> = store::all(
        conn,
        "SELECT data FROM experiment_trials WHERE run_id=?1 ORDER BY rowid",
        Some(id),
    )?;
    let mut stmt = conn
        .prepare("SELECT record_id,measurement_time FROM experiment_scales WHERE run_id=?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(json!({"recordId":r.get::<_,String>(0)?,"measurementTime":r.get::<_,String>(1)?}))
        })
        .map_err(|e| e.to_string())?;
    let mut scales = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for link in &mut scales {
        let record_id = link["recordId"]
            .as_str()
            .ok_or("Scale record ID is missing.")?;
        let mut record = crate::scale_records::get_scale_record(conn, record_id)?;
        record.experiment_run_id = Some(id.to_string());
        link["record"] = serde_json::to_value(record).map_err(|e| e.to_string())?;
    }
    Ok(
        json!({"run":run,"events":events,"trials":trials,"scales":scales,"eventDefinitions":EVENT_CODES,"hardwareReceiptVerified":false}),
    )
}
#[tauri::command]
pub async fn experiment_get(db: State<'_, AppDb>, run_id: String) -> Result<Value, String> {
    detail(
        &*db.conn.lock().map_err(|_| "Database unavailable")?,
        &run_id,
    )
}
#[tauri::command]
pub async fn experiment_associate_bdf(
    service: State<'_, Service>,
    run_id: String,
    bdf_files: Vec<String>,
) -> Result<Run, String> {
    call(
        service,
        Box::new(move |w| {
            if bdf_files
                .iter()
                .any(|p| p.trim().is_empty() || !p.to_lowercase().ends_with(".bdf"))
            {
                return Err("Provide BDF file names or absolute paths.".into());
            }
            let conn = w.db.lock().map_err(|_| "Database unavailable")?;
            let mut run = store::run(&conn, &run_id)?;
            if run.status == "running" {
                return Err("Associate BDF files after the experiment.".into());
            }
            run.bdf_files = bdf_files;
            store::save_run(&conn, &run)?;
            worker::value(run)
        }),
    )
    .await
}
#[tauri::command]
pub async fn experiment_save_trial(
    service: State<'_, Service>,
    run_id: String,
    trial: Value,
) -> Result<Value, String> {
    call(service,Box::new(move|w|{
        let conn=w.db.lock().map_err(|_|"Database unavailable")?;let run=store::run(&conn,&run_id)?;
        if !["running","interrupted"].contains(&run.status.as_str()){return Err("Trial run is closed.".into())}
        let id=trial.get("trialId").and_then(Value::as_str).filter(|v|!v.trim().is_empty()).ok_or("Trial ID required.")?;
        let changed=conn.execute("INSERT INTO experiment_trials VALUES (?1,?2,?3) ON CONFLICT(trial_id) DO UPDATE SET data=excluded.data WHERE experiment_trials.run_id=excluded.run_id",rusqlite::params![id,run_id,store::json(&trial)?]).map_err(|e|e.to_string())?;
        if changed==0{return Err("Trial ID belongs to a different run.".into())}Ok(trial)
    })).await
}
#[tauri::command]
pub async fn experiment_link_scale(
    service: State<'_, Service>,
    run_id: String,
    record_id: String,
    measurement_time: String,
) -> Result<(), String> {
    call(
        service,
        Box::new(move |w| {
            if !["baseline", "post"].contains(&measurement_time.as_str()) {
                return Err("Invalid measurement time.".into());
            }
            let conn = w.db.lock().map_err(|_| "Database unavailable")?;
            let run = store::run(&conn, &run_id)?;
            let record = crate::scale_records::get_scale_record(&conn, &record_id)?;
            if run.input.kind != "effect_evaluation"
                || !["running", "interrupted"].contains(&run.status.as_str())
            {
                return Err("Scale run is closed or does not support this measure.".into());
            }
            if record.subject_id.as_deref() != Some(run.input.subject_id.as_str())
                || record.user_id != run.input.user_id
                || record.phase != measurement_time
                || record.emotion != run.input.emotion
                || record.condition != run.input.condition
            {
                return Err("Scale metadata does not match the frozen experiment run.".into());
            }
            let existing: Option<(String, String)> = conn
                .query_row(
                    "SELECT run_id,measurement_time FROM experiment_scales WHERE record_id=?1",
                    [&record_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(existing) = existing {
                if existing == (run_id.clone(), measurement_time.clone()) {
                    return Ok(Value::Null);
                }
                return Err("Scale is already linked to a different run or phase.".into());
            }
            conn.execute(
                "INSERT INTO experiment_scales VALUES (?1,?2,?3)",
                rusqlite::params![record_id, run_id, measurement_time],
            )
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }),
    )
    .await
}
#[tauri::command]
pub async fn experiment_export(
    db: State<'_, AppDb>,
    run_id: String,
    path: String,
) -> Result<Value, String> {
    let parent = std::path::PathBuf::from(&path);
    let dest = parent.join(format!("experiment-{}-{}", run_id, uuid::Uuid::new_v4()));
    if !dest.is_absolute()
        || dest
            .components()
            .any(|p| p == std::path::Component::ParentDir)
    {
        return Err("Export directory must be absolute without parent traversal.".into());
    }
    let data = detail(
        &*db.conn.lock().map_err(|_| "Database unavailable")?,
        &run_id,
    )?;
    // A new directory avoids overwriting prior exports or raw BDF data.
    std::fs::create_dir(&dest).map_err(|e| e.to_string())?;
    std::fs::write(
        dest.join("manifest.json"),
        serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let fields = [
        "sequence",
        "eventId",
        "runId",
        "trialId",
        "phaseInstanceId",
        "event",
        "code",
        "mediaId",
        "softwareTimeMs",
        "source",
        "receivedAt",
        "backendElapsedMs",
        "writeStartedAt",
        "writeFinishedAt",
        "queueWaitMs",
        "result",
        "error",
    ];
    let mut tsv = format!("{}\n", fields.join("\t"));
    for row in data["events"].as_array().ok_or("Invalid event data")? {
        tsv.push_str(
            &fields
                .iter()
                .map(|key| match &row[*key] {
                    Value::Null => String::new(),
                    Value::String(v) => v.replace(['\t', '\n', '\r'], " "),
                    v => v.to_string(),
                })
                .collect::<Vec<_>>()
                .join("\t"),
        );
        tsv.push('\n');
    }
    std::fs::write(dest.join("events.tsv"), tsv).map_err(|e| e.to_string())?;
    std::fs::write(
        dest.join("trials.json"),
        serde_json::to_vec_pretty(&data["trials"]).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({"path":dest.to_string_lossy()}))
}
