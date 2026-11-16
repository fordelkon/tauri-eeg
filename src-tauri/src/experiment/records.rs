use super::{store, types::*};
use crate::scale_records::{
    self, SaveScaleRecordInput, ScaleRecord, DEQ_SCALE_ID, PHASE_PRE_INDUCTION,
};
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
        json!({"run":run,"events":events,"trials":trials,"scales":scales,"eventDefinitions":EVENT_CODES,"softwareEvents":SOFTWARE_EVENTS,"hardwareReceiptVerified":false}),
    )
}

pub fn associate_bdf(
    conn: &Connection,
    run_id: &str,
    user_id: &str,
    bdf_files: Vec<String>,
) -> Result<Run, String> {
    let mut run = store::run(conn, run_id)?;
    if run.input.user_id != user_id {
        return Err("该实验不属于当前账号。".into());
    }
    if run.status == "running" || run.status == "active" {
        return Err("Associate BDF files after the experiment.".into());
    }
    if run.input.mode != "formal" || bdf_files.is_empty() {
        return Err("请选择已结束的正式实验及其 BDF。".into());
    }
    let mut seen = std::collections::HashSet::new();
    for file in &bdf_files {
        let path = std::path::Path::new(file);
        if path
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|name| {
                name.split('_').any(|part| {
                    ["task-triggercheck", "acq-triggercheck"]
                        .iter()
                        .any(|p| part.eq_ignore_ascii_case(p))
                })
            })
        {
            return Err("这是触发测试文件，请选择正式实验 BDF。".into());
        }
        super::bdf_verify::verify(path)?;
        let canonical = path.canonicalize().map_err(|_| "无法定位所选 BDF。")?;
        // Windows canonicalize returns a verbatim path; reservation names use
        // ordinary absolute paths. Match the resolved destination as well as
        // the supplied spelling (e.g. aliases, slash variants or a junction).
        let resolved = canonical.to_string_lossy();
        let ordinary = resolved.strip_prefix(r"\\?\").unwrap_or(&resolved);
        let reservation: Option<(String, String)> = conn
            .query_row(
                "SELECT user_id, subject_id FROM bdf_reservations
                 WHERE path=?1 COLLATE NOCASE OR path=?2 COLLATE NOCASE",
                params![file, ordinary],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((owner, subject)) = reservation {
            let expected = run
                .input
                .expected_recording_name
                .as_deref()
                .map(std::path::Path::new);
            if owner != user_id
                || subject != run.input.subject_id
                || !expected.is_some_and(|p| p.canonicalize().ok().as_ref() == Some(&canonical))
            {
                return Err("所选文件已预留给其他实验。".into());
            }
        }
        if !seen.insert(canonical) {
            return Err("请勿重复选择同一文件。".into());
        }
    }
    // A manual selection must not silently reassign another run's recording.
    for other in list(conn, None)? {
        if other.run_id != run.run_id
            && other.bdf_files.iter().any(|f| {
                std::path::Path::new(f)
                    .canonicalize()
                    .is_ok_and(|p| seen.contains(&p))
            })
        {
            return Err("所选 BDF 已关联其他实验。".into());
        }
    }
    run.bdf_files = bdf_files;
    store::save_run(conn, &run)?;
    Ok(run)
}

pub fn save_trial(conn: &Connection, run_id: &str, trial: Value) -> Result<Value, String> {
    let run = store::run(conn, run_id)?;
    if trial["presentationStatus"] == "skipped" && !super::is_development_rehearsal(&run.input.mode)
    {
        return Err("正式实验无法保存跳过的试次。".into());
    }
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

pub(crate) fn phase_record_id(
    conn: &Connection,
    run_id: &str,
    phase: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT record_id FROM experiment_scales WHERE run_id=?1 AND measurement_time=?2",
        params![run_id, phase],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn save_measurement(
    conn: &Connection,
    input: &SaveScaleRecordInput,
) -> Result<ScaleRecord, String> {
    if input.scale_id.trim() != DEQ_SCALE_ID {
        return Err("Unsupported measurement instrument.".into());
    }
    let run_id = input
        .experiment_run_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .ok_or("DEQ requires an experiment run.")?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let run = store::run(&tx, run_id)?;
    if input.regulation_skipped && !super::is_development_rehearsal(&run.input.mode) {
        return Err("正式实验无法保存跳过条件时长的评分。".into());
    }
    let phase = input.phase.trim();
    let mut record = if let Some(id) = phase_record_id(&tx, run_id, phase)? {
        let saved = scale_records::get_scale_record(&tx, &id)?;
        scale_records::validate_deq(input)?;
        if saved.scale_id != DEQ_SCALE_ID
            || saved.raw_answers.value()? != input.raw_answers
            || saved.user_id != input.user_id
            || saved.subject_id != input.subject_id
            || saved.emotion != input.emotion
            || saved.condition != input.condition
            || saved.duration_minutes != input.duration_minutes
            || saved.regulation_skipped != input.regulation_skipped
        {
            return Err("该时点已有不同的作答记录。".into());
        }
        saved
    } else {
        if run.input.kind != "effect_evaluation" || run.status != "running" {
            return Err("该实验未开放情绪评分。".into());
        }
        if input.subject_id.as_deref() != Some(run.input.subject_id.as_str())
            || input.user_id != run.input.user_id
            || input.emotion != run.input.emotion
            || input.condition != run.input.condition
        {
            return Err("Scale metadata does not match the frozen experiment run.".into());
        }
        let opening_event = match phase {
            PHASE_PRE_INDUCTION => "pre_induction_scale_start",
            "baseline" => "pre_scale_start",
            "post" => "post_scale_start",
            _ => return Err("Invalid measurement time.".into()),
        };
        let started: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM experiment_events WHERE run_id=?1 AND event=?2)",
                params![run_id, opening_event],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !started {
            return Err("该评分时点尚未开始。".into());
        }
        let record = scale_records::save_scale_record(&tx, input)?;
        tx.execute(
            "INSERT INTO experiment_scales (record_id,run_id,measurement_time) VALUES (?1,?2,?3)",
            params![record.id, run_id, phase],
        )
        .map_err(|e| e.to_string())?;
        record
    };
    record.experiment_run_id = Some(run_id.to_owned());
    tx.commit().map_err(|e| e.to_string())?;
    Ok(record)
}

pub fn delete(conn: &Connection, run_id: &str, user_id: Option<&str>) -> Result<Run, String> {
    let run = store::run(conn, run_id)?;
    if let Some(uid) = user_id {
        if run.input.user_id != uid {
            return Err("You are not authorized to delete this experiment run.".into());
        }
    }
    if run.status == "running" || run.status == "active" {
        return Err("Cannot delete an experiment run that is currently in progress.".into());
    }

    conn.execute(
        "DELETE FROM experiment_scales WHERE run_id = ?1",
        params![run_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM experiment_events WHERE run_id = ?1",
        params![run_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM experiment_trials WHERE run_id = ?1",
        params![run_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM experiment_runs WHERE run_id = ?1",
        params![run_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(run)
}
