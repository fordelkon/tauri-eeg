use rusqlite::Connection;

pub fn init_scale_records_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scale_records (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            subject_id TEXT,
            scale_id TEXT NOT NULL,
            phase TEXT NOT NULL,
            dimension_scores TEXT NOT NULL DEFAULT '{}',
            raw_answers TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scale_records_subject_phase
            ON scale_records(subject_id, phase);
        CREATE INDEX IF NOT EXISTS idx_scale_records_subject_created
            ON scale_records(subject_id, created_at);",
    )
    .map_err(|_| "Failed to initialize scale records schema.".to_string())?;

    ensure_scale_records_columns(conn)
}

/// Appends columns introduced after the table first shipped. `CREATE TABLE IF
/// NOT EXISTS` cannot extend an existing database, so each missing column is
/// added in place; existing rows take the column default (`NULL` / `0`).
fn ensure_scale_records_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(scale_records)")
        .map_err(|_| "Failed to inspect scale records schema.".to_string())?;

    let existing_columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|_| "Failed to inspect scale records schema.".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to inspect scale records schema.".to_string())?;

    const COLUMN_ADDITIONS: [(&str, &str); 5] = [
        (
            "emotion",
            "ALTER TABLE scale_records ADD COLUMN emotion TEXT",
        ),
        (
            "condition",
            "ALTER TABLE scale_records ADD COLUMN condition TEXT",
        ),
        (
            "duration_minutes",
            "ALTER TABLE scale_records ADD COLUMN duration_minutes INTEGER",
        ),
        (
            "regulation_skipped",
            "ALTER TABLE scale_records ADD COLUMN regulation_skipped INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "measured_dimensions",
            "ALTER TABLE scale_records ADD COLUMN measured_dimensions TEXT",
        ),
    ];

    for (column, alter_sql) in COLUMN_ADDITIONS {
        if !existing_columns.iter().any(|name| name == column) {
            conn.execute_batch(alter_sql)
                .map_err(|_| format!("Failed to add scale records column '{column}'."))?;
        }
    }

    Ok(())
}
