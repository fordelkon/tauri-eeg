mod records;
#[cfg(test)]
mod records_tests;
pub mod report;
mod store;
#[cfg(test)]
mod tests;
mod types;
mod validation;
mod worker;
use serde_json::{json, Value};
use tauri::State;
use types::*;

/// A unit of serialized worker work: takes the worker state and produces a
/// JSON reply delivered back to the awaiting command.
pub type WorkerJob = Box<dyn FnOnce(&mut worker::Worker) -> Result<Value, String> + Send>;

pub use worker::Service;
pub fn init(conn: &rusqlite::Connection) -> Result<(), String> {
    store::init(conn)
}

async fn call<T: serde::de::DeserializeOwned + Send + 'static>(
    service: State<'_, Service>,
    job: WorkerJob,
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
    // Probing serial devices blocks; keep it off the async runtime threads.
    let ports = tauri::async_runtime::spawn_blocking(serialport::available_ports)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    Ok(ports
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
        .collect())
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
    service: State<'_, Service>,
    user_id: Option<String>,
) -> Result<Vec<Run>, String> {
    call(service, Box::new(move |w| w.list_runs(user_id))).await
}
#[tauri::command]
pub async fn experiment_get(service: State<'_, Service>, run_id: String) -> Result<Value, String> {
    call(service, Box::new(move |w| w.record_detail(run_id))).await
}
#[tauri::command]
pub async fn experiment_delete(
    service: State<'_, Service>,
    run_id: String,
    user_id: Option<String>,
) -> Result<Run, String> {
    call(service, Box::new(move |w| w.delete_run(run_id, user_id))).await
}
#[tauri::command]
pub async fn experiment_associate_bdf(
    service: State<'_, Service>,
    run_id: String,
    bdf_files: Vec<String>,
) -> Result<Run, String> {
    call(
        service,
        Box::new(move |w| w.associate_bdf(run_id, bdf_files)),
    )
    .await
}
#[tauri::command]
pub async fn experiment_save_trial(
    service: State<'_, Service>,
    run_id: String,
    trial: Value,
) -> Result<Value, String> {
    call(service, Box::new(move |w| w.save_trial(run_id, trial))).await
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
        Box::new(move |w| w.link_scale(run_id, record_id, measurement_time)),
    )
    .await
}
#[tauri::command]
pub async fn experiment_export(
    service: State<'_, Service>,
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
    let data: Value = call(service, Box::new(move |w| w.record_detail(run_id))).await?;

    // The export writes several files; keep the blocking IO off the async
    // runtime threads.
    let write_export = move || -> Result<Value, String> {
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
    };

    tauri::async_runtime::spawn_blocking(write_export)
        .await
        .map_err(|e| e.to_string())?
}
