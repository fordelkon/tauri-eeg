use super::types::{Event, Run};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS experiment_runs (run_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS experiment_events (event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, sequence INTEGER NOT NULL, phase_id TEXT NOT NULL, event TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(run_id,phase_id,event));
        CREATE TABLE IF NOT EXISTS experiment_trials (trial_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS experiment_scales (record_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, measurement_time TEXT NOT NULL);")
        .map_err(|e| e.to_string())?;
    // A pending write cannot be recovered by resending a pulse.
    for mut event in all::<Event>(conn, "SELECT data FROM experiment_events", None)? {
        if event.result == "pending" {
            event.result = "unknown".into();
            save_event(conn, &event)?;
        }
    }
    for mut run in all::<Run>(conn, "SELECT data FROM experiment_runs", None)? {
        if run.status == "running" {
            run.status = "interrupted".into();
            run.ended_at = Some(super::types::now());
            save_run(conn, &run)?;
        }
    }
    Ok(())
}
pub fn json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}
pub fn save_run(conn: &Connection, run: &Run) -> Result<(), String> {
    conn.execute("INSERT INTO experiment_runs VALUES (?1,?2,?3,?4) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status,data=excluded.data",params![run.run_id,run.input.user_id,run.status,json(run)?]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn run(conn: &Connection, id: &str) -> Result<Run, String> {
    conn.query_row(
        "SELECT data FROM experiment_runs WHERE run_id=?1",
        [id],
        |r| r.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())
    .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
}
pub fn event(conn: &Connection, id: &str) -> Result<Option<Event>, String> {
    conn.query_row(
        "SELECT data FROM experiment_events WHERE event_id=?1",
        [id],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
    .transpose()
}
pub fn save_event(conn: &Connection, event: &Event) -> Result<(), String> {
    conn.execute("INSERT INTO experiment_events VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data",params![event.input.event_id,event.input.run_id,event.sequence,event.input.phase_instance_id,event.input.event,json(event)?]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn all<T: DeserializeOwned>(
    conn: &Connection,
    sql: &str,
    arg: Option<&str>,
) -> Result<Vec<T>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut rows = if let Some(arg) = arg {
        stmt.query([arg])
    } else {
        stmt.query([])
    }
    .map_err(|e| e.to_string())?;
    let mut values = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let raw: String = row.get(0).map_err(|e| e.to_string())?;
        values.push(serde_json::from_str(&raw).map_err(|e| e.to_string())?);
    }
    Ok(values)
}
