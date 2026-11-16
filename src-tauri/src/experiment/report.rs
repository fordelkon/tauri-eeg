use crate::scale_records::{self, ScaleRecord, PHASE_PRE_INDUCTION};
use rusqlite::{params, Connection};

/// Resolve T0 from the same experiment as both supplied T1/T2 records.
pub fn pre_induction_for_pair(
    conn: &Connection,
    baseline: &ScaleRecord,
    post: &ScaleRecord,
) -> Result<ScaleRecord, String> {
    let first_id:String = conn.query_row(
        "SELECT first.record_id FROM experiment_scales first
         JOIN experiment_scales baseline ON baseline.run_id = first.run_id
         JOIN experiment_scales post ON post.run_id = first.run_id
         WHERE first.measurement_time=?1 AND baseline.record_id=?2 AND baseline.measurement_time='baseline'
           AND post.record_id=?3 AND post.measurement_time='post'",
        params![PHASE_PRE_INDUCTION, baseline.id, post.id], |row| row.get(0),
    ).map_err(|_| "需要同一次实验内的诱发前、诱发后和条件后三份评分。".to_owned())?;
    scale_records::get_scale_record(conn, &first_id)
}
