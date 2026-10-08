use super::{store, types::*};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub fn list(conn: &Connection, user_id: Option<&str>) -> Result<Vec<Run>, String> {
    match user_id {
        Some(id) => store::all(
            conn,
            "SELECT data FROM experiment_runs WHERE user_id=?1 ORDER BY rowid DESC",
            Some(id),
        ),
        None => store::all(
            conn,
            "SELECT data FROM experiment_runs ORDER BY rowid DESC",
            None,
        ),
    }
}

pub fn detail(conn: &Connection, id: &str) -> Result<Value, String> {
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

pub fn associate_bdf(
    conn: &Connection,
    run_id: &str,
    bdf_files: Vec<String>,
) -> Result<Run, String> {
    if bdf_files
        .iter()
        .any(|p| p.trim().is_empty() || !p.to_lowercase().ends_with(".bdf"))
    {
        return Err("Provide BDF file names or absolute paths.".into());
    }
    let mut run = store::run(conn, run_id)?;
    if run.status == "running" {
        return Err("Associate BDF files after the experiment.".into());
    }
    run.bdf_files = bdf_files;
    store::save_run(conn, &run)?;
    Ok(run)
}

pub fn save_trial(conn: &Connection, run_id: &str, trial: Value) -> Result<Value, String> {
    let run = store::run(conn, run_id)?;
    if !["running", "interrupted"].contains(&run.status.as_str()) {
        return Err("Trial run is closed.".into());
    }
    let id = trial
        .get("trialId")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or("Trial ID required.")?;
    let changed = conn.execute(
        "INSERT INTO experiment_trials VALUES (?1,?2,?3) ON CONFLICT(trial_id) DO UPDATE SET data=excluded.data WHERE experiment_trials.run_id=excluded.run_id",
        params![id, run_id, store::json(&trial)?],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Trial ID belongs to a different run.".into());
    }
    Ok(trial)
}

pub fn link_scale(
    conn: &Connection,
    run_id: &str,
    record_id: &str,
    measurement_time: &str,
) -> Result<(), String> {
    if !["baseline", "post"].contains(&measurement_time) {
        return Err("Invalid measurement time.".into());
    }
    let run = store::run(conn, run_id)?;
    let record = crate::scale_records::get_scale_record(conn, record_id)?;
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
            [record_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((existing_run, existing_time)) = existing {
        if existing_run == run_id && existing_time == measurement_time {
            return Ok(());
        }
        return Err("Scale is already linked to a different run or phase.".into());
    }
    conn.execute(
        "INSERT INTO experiment_scales VALUES (?1,?2,?3)",
        params![record_id, run_id, measurement_time],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
