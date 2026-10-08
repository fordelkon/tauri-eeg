use super::{store, types::Run};
use crate::scale_records::ScaleRecord;
use rusqlite::{Connection, OptionalExtension};
use std::collections::HashMap;

pub fn linked_run(conn: &Connection, id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT run_id FROM experiment_scales WHERE record_id=?1",
        [id],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
pub fn require_same_run(conn: &Connection, baseline: &str, post: &str) -> Result<(), String> {
    let a = linked_run(conn, baseline)?;
    let b = linked_run(conn, post)?;
    if a != b {
        return Err("Pre and post measurements must belong to the same experiment run.".into());
    }
    Ok(())
}
pub fn eligible_records(
    conn: &Connection,
    records: Vec<ScaleRecord>,
) -> Result<Vec<ScaleRecord>, String> {
    let runs: Vec<Run> = store::all(conn, "SELECT data FROM experiment_runs", None)?;
    let runs: HashMap<_, _> = runs.into_iter().map(|r| (r.run_id.clone(), r)).collect();
    let mut output = Vec::new();
    for mut record in records {
        if let Some(id) = linked_run(conn, &record.id)? {
            let Some(run) = runs.get(&id) else { continue };
            if run.status != "completed" || run.input.mode != "formal" {
                continue;
            }
            record.experiment_run_id = Some(id);
        }
        output.push(record);
    }
    Ok(output)
}
