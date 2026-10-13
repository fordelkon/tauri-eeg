use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub id: String,
    pub user_id: String,
    pub subject_code: String,
    pub name_alias: Option<String>,
    pub gender: Option<String>,
    pub birth_year: Option<i64>,
    pub handedness: Option<String>,
    pub cap_size: Option<String>,
    pub clinical_group: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSubjectInput {
    #[serde(default)]
    pub id: Option<String>,
    pub user_id: String,
    pub subject_code: String,
    #[serde(default)]
    pub name_alias: Option<String>,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default)]
    pub birth_year: Option<i64>,
    #[serde(default)]
    pub handedness: Option<String>,
    #[serde(default)]
    pub cap_size: Option<String>,
    #[serde(default)]
    pub clinical_group: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn clean_optional_string(val: Option<String>) -> Option<String> {
    val.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn map_subject_row(row: &rusqlite::Row) -> rusqlite::Result<Subject> {
    Ok(Subject {
        id: row.get(0)?,
        user_id: row.get(1)?,
        subject_code: row.get(2)?,
        name_alias: row.get(3)?,
        gender: row.get(4)?,
        birth_year: row.get(5)?,
        handedness: row.get(6)?,
        cap_size: row.get(7)?,
        clinical_group: row.get(8)?,
        notes: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

pub fn list_subjects(conn: &Connection, user_id: &str) -> Result<Vec<Subject>, String> {
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Err("User ID cannot be empty.".to_string());
    }

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, user_id, subject_code, name_alias, gender, birth_year,
                    handedness, cap_size, clinical_group, notes, created_at, updated_at
             FROM subjects
             WHERE user_id = ?1
             ORDER BY created_at DESC, subject_code ASC",
        )
        .map_err(|e| format!("Database error: {}", e))?;

    let rows = stmt
        .query_map(params![user_id], |row| map_subject_row(row))
        .map_err(|e| format!("Database error: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read subject row: {}", e))
}

pub fn get_subject(conn: &Connection, id: &str, user_id: &str) -> Result<Option<Subject>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, user_id, subject_code, name_alias, gender, birth_year,
                    handedness, cap_size, clinical_group, notes, created_at, updated_at
             FROM subjects
             WHERE id = ?1 AND user_id = ?2",
        )
        .map_err(|e| format!("Database error: {}", e))?;

    stmt.query_row(params![id, user_id], |row| map_subject_row(row))
        .optional()
        .map_err(|e| format!("Database error: {}", e))
}

#[allow(dead_code)]
pub fn get_subject_by_code(
    conn: &Connection,
    user_id: &str,
    subject_code: &str,
) -> Result<Option<Subject>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, user_id, subject_code, name_alias, gender, birth_year,
                    handedness, cap_size, clinical_group, notes, created_at, updated_at
             FROM subjects
             WHERE user_id = ?1 AND subject_code = ?2",
        )
        .map_err(|e| format!("Database error: {}", e))?;

    stmt.query_row(params![user_id, subject_code], |row| map_subject_row(row))
        .optional()
        .map_err(|e| format!("Database error: {}", e))
}

fn find_id_by_code(
    conn: &Connection,
    user_id: &str,
    subject_code: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM subjects WHERE user_id = ?1 AND subject_code = ?2",
        params![user_id, subject_code],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Database error: {}", e))
}

pub fn save_subject(conn: &Connection, input: &SaveSubjectInput) -> Result<Subject, String> {
    let user_id = input.user_id.trim();
    if user_id.is_empty() {
        return Err("User ID cannot be empty.".to_string());
    }

    let subject_code = input.subject_code.trim();
    if subject_code.is_empty() {
        return Err("Subject code cannot be empty.".to_string());
    }

    if let Some(year) = input.birth_year {
        if year < 1900 || year > 2100 {
            return Err("Birth year must be between 1900 and 2100.".to_string());
        }
    }

    let name_alias = clean_optional_string(input.name_alias.clone());
    let gender = clean_optional_string(input.gender.clone());
    let birth_year = input.birth_year;
    let handedness = clean_optional_string(input.handedness.clone());
    let cap_size = clean_optional_string(input.cap_size.clone());
    let clinical_group = clean_optional_string(input.clinical_group.clone());
    let notes = clean_optional_string(input.notes.clone());
    let now = Utc::now().to_rfc3339();

    // Verify foreign key: user must exist in users table
    let user_exists: bool = conn
        .query_row(
            "SELECT 1 FROM users WHERE id = ?1",
            params![user_id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| format!("Database error checking user: {}", e))?
        .unwrap_or(false);

    if !user_exists {
        return Err(format!("User '{}' does not exist.", user_id));
    }

    let provided_id = clean_optional_string(input.id.clone());

    // Determine whether an existing subject is being updated
    let existing_subject = if let Some(ref id) = provided_id {
        let by_id: Option<(String, String)> = conn
            .query_row(
                "SELECT id, user_id FROM subjects WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Database error: {}", e))?;

        if let Some((found_id, found_user_id)) = by_id {
            // Multi-tenant check: user must own this subject
            if found_user_id != user_id {
                return Err("Permission denied: cannot modify subject belonging to another user.".to_string());
            }
            Some(found_id)
        } else {
            // Not found by id: check if (user_id, subject_code) already exists
            find_id_by_code(conn, user_id, subject_code)?
        }
    } else {
        // No id supplied; check if (user_id, subject_code) exists
        find_id_by_code(conn, user_id, subject_code)?
    };

    if let Some(target_id) = existing_subject {
        // UPDATE existing record
        // Verify subject_code does not conflict with another subject belonging to the same user
        let code_conflict: Option<String> = conn
            .query_row(
                "SELECT id FROM subjects WHERE user_id = ?1 AND subject_code = ?2 AND id != ?3",
                params![user_id, subject_code, target_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Database error: {}", e))?;

        if code_conflict.is_some() {
            return Err(format!(
                "A subject with code '{}' already exists for this user.",
                subject_code
            ));
        }

        conn.execute(
            "UPDATE subjects SET
                subject_code = ?1,
                name_alias = ?2,
                gender = ?3,
                birth_year = ?4,
                handedness = ?5,
                cap_size = ?6,
                clinical_group = ?7,
                notes = ?8,
                updated_at = ?9
             WHERE id = ?10 AND user_id = ?11",
            params![
                subject_code,
                name_alias,
                gender,
                birth_year,
                handedness,
                cap_size,
                clinical_group,
                notes,
                now,
                target_id,
                user_id
            ],
        )
        .map_err(|e| format!("Failed to update subject: {}", e))?;

        get_subject(conn, &target_id, user_id)?
            .ok_or_else(|| "Failed to retrieve updated subject.".to_string())
    } else {
        // INSERT new record
        let target_id = provided_id.unwrap_or_else(|| Uuid::new_v4().to_string());

        // Check if subject_code already exists for this user
        if find_id_by_code(conn, user_id, subject_code)?.is_some() {
            return Err(format!(
                "A subject with code '{}' already exists for this user.",
                subject_code
            ));
        }

        conn.execute(
            "INSERT INTO subjects (
                id, user_id, subject_code, name_alias, gender, birth_year,
                handedness, cap_size, clinical_group, notes, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                target_id,
                user_id,
                subject_code,
                name_alias,
                gender,
                birth_year,
                handedness,
                cap_size,
                clinical_group,
                notes,
                now,
                now
            ],
        )
        .map_err(|e| format!("Failed to insert subject: {}", e))?;

        get_subject(conn, &target_id, user_id)?
            .ok_or_else(|| "Failed to retrieve inserted subject.".to_string())
    }
}

pub fn delete_subject(conn: &Connection, id: &str, user_id: &str) -> Result<Subject, String> {
    let id = id.trim();
    let user_id = user_id.trim();

    if id.is_empty() {
        return Err("Subject ID cannot be empty.".to_string());
    }
    if user_id.is_empty() {
        return Err("User ID cannot be empty.".to_string());
    }

    let subject = get_subject(conn, id, user_id)?;
    match subject {
        Some(s) => {
            conn.execute(
                "DELETE FROM subjects WHERE id = ?1 AND user_id = ?2",
                params![id, user_id],
            )
            .map_err(|e| format!("Failed to delete subject: {}", e))?;
            Ok(s)
        }
        None => {
            // Check if it exists for another user to report multi-tenant permission violation
            let exists_for_other: bool = conn
                .query_row(
                    "SELECT 1 FROM subjects WHERE id = ?1",
                    params![id],
                    |_| Ok(true),
                )
                .optional()
                .map_err(|e| format!("Database error: {}", e))?
                .unwrap_or(false);

            if exists_for_other {
                Err("Permission denied: cannot delete subject belonging to another user.".to_string())
            } else {
                Err("Subject not found.".to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open sqlite in memory");
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE users (
                 id TEXT PRIMARY KEY,
                 username TEXT NOT NULL UNIQUE,
                 password_hash TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE subjects (
                 id TEXT PRIMARY KEY,
                 user_id TEXT NOT NULL,
                 subject_code TEXT NOT NULL,
                 name_alias TEXT,
                 gender TEXT,
                 birth_year INTEGER,
                 handedness TEXT,
                 cap_size TEXT,
                 clinical_group TEXT,
                 notes TEXT,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL,
                 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                 UNIQUE(user_id, subject_code)
             );
             CREATE INDEX idx_subjects_user_code ON subjects(user_id, subject_code);",
        )
        .expect("init schema");

        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at, updated_at)
             VALUES ('user-alice', 'alice', 'hash-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                    ('user-bob', 'bob', 'hash-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("insert test users");

        conn
    }

    #[test]
    fn creates_and_lists_subjects_by_user() {
        let conn = setup_conn();

        let input = SaveSubjectInput {
            id: None,
            user_id: "user-alice".to_string(),
            subject_code: "SUBJ-001".to_string(),
            name_alias: Some("AliceSubject".to_string()),
            gender: Some("female".to_string()),
            birth_year: Some(1998),
            handedness: Some("right".to_string()),
            cap_size: Some("M".to_string()),
            clinical_group: Some("control".to_string()),
            notes: Some("Healthy volunteer".to_string()),
        };

        let saved = save_subject(&conn, &input).expect("save subject");
        assert_eq!(saved.subject_code, "SUBJ-001");
        assert_eq!(saved.user_id, "user-alice");
        assert_eq!(saved.name_alias.as_deref(), Some("AliceSubject"));
        assert_eq!(saved.birth_year, Some(1998));
        assert_eq!(saved.cap_size.as_deref(), Some("M"));

        let list = list_subjects(&conn, "user-alice").expect("list subjects");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, saved.id);
        assert_eq!(list[0].subject_code, "SUBJ-001");

        let fetched_by_id = get_subject(&conn, &saved.id, "user-alice")
            .expect("get by id")
            .expect("subject exists");
        assert_eq!(fetched_by_id.id, saved.id);

        let fetched_by_code = get_subject_by_code(&conn, "user-alice", "SUBJ-001")
            .expect("get by code")
            .expect("subject exists");
        assert_eq!(fetched_by_code.id, saved.id);
    }

    #[test]
    fn multi_tenant_isolation_prevents_leakage() {
        let conn = setup_conn();

        save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "SUBJ-ALICE".to_string(),
                name_alias: None,
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("save alice subject");

        save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-bob".to_string(),
                subject_code: "SUBJ-BOB".to_string(),
                name_alias: None,
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("save bob subject");

        let alice_list = list_subjects(&conn, "user-alice").expect("list alice");
        let bob_list = list_subjects(&conn, "user-bob").expect("list bob");

        assert_eq!(alice_list.len(), 1);
        assert_eq!(alice_list[0].subject_code, "SUBJ-ALICE");

        assert_eq!(bob_list.len(), 1);
        assert_eq!(bob_list[0].subject_code, "SUBJ-BOB");
    }

    #[test]
    fn multi_tenant_allows_same_subject_code_for_different_users() {
        let conn = setup_conn();

        let s1 = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "SUBJ-01".to_string(),
                name_alias: Some("Alice Copy".to_string()),
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("save alice subject");

        let s2 = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-bob".to_string(),
                subject_code: "SUBJ-01".to_string(),
                name_alias: Some("Bob Copy".to_string()),
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("save bob subject");

        assert_ne!(s1.id, s2.id);
        assert_eq!(s1.subject_code, s2.subject_code);
        assert_eq!(s1.name_alias.as_deref(), Some("Alice Copy"));
        assert_eq!(s2.name_alias.as_deref(), Some("Bob Copy"));
    }

    #[test]
    fn updates_existing_subject_by_id() {
        let conn = setup_conn();

        let created = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "SUBJ-ORIGINAL".to_string(),
                name_alias: Some("Initial Alias".to_string()),
                gender: Some("female".to_string()),
                birth_year: Some(1995),
                handedness: Some("right".to_string()),
                cap_size: Some("S".to_string()),
                clinical_group: None,
                notes: None,
            },
        )
        .expect("create subject");

        let updated = save_subject(
            &conn,
            &SaveSubjectInput {
                id: Some(created.id.clone()),
                user_id: "user-alice".to_string(),
                subject_code: "SUBJ-RENAMED".to_string(),
                name_alias: Some("Updated Alias".to_string()),
                gender: Some("female".to_string()),
                birth_year: Some(1995),
                handedness: Some("ambidextrous".to_string()),
                cap_size: Some("M".to_string()),
                clinical_group: Some("study".to_string()),
                notes: Some("Follow up note".to_string()),
            },
        )
        .expect("update subject");

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.subject_code, "SUBJ-RENAMED");
        assert_eq!(updated.name_alias.as_deref(), Some("Updated Alias"));
        assert_eq!(updated.handedness.as_deref(), Some("ambidextrous"));
        assert_eq!(updated.cap_size.as_deref(), Some("M"));
        assert_eq!(updated.notes.as_deref(), Some("Follow up note"));

        let list = list_subjects(&conn, "user-alice").expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].subject_code, "SUBJ-RENAMED");
    }

    #[test]
    fn upserts_matching_user_and_code_when_id_is_omitted() {
        let conn = setup_conn();

        let s1 = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "SUBJ-SAME".to_string(),
                name_alias: Some("Alias 1".to_string()),
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("save 1");

        let s2 = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "SUBJ-SAME".to_string(),
                name_alias: Some("Alias 2".to_string()),
                gender: Some("male".to_string()),
                birth_year: Some(2000),
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("save 2");

        assert_eq!(s1.id, s2.id);
        assert_eq!(s2.name_alias.as_deref(), Some("Alias 2"));
        assert_eq!(s2.gender.as_deref(), Some("male"));

        let list = list_subjects(&conn, "user-alice").expect("list");
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn rejects_modifying_other_users_subject() {
        let conn = setup_conn();

        let alice_sub = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "ALICE-01".to_string(),
                name_alias: None,
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("alice save");

        let bob_attack = save_subject(
            &conn,
            &SaveSubjectInput {
                id: Some(alice_sub.id.clone()),
                user_id: "user-bob".to_string(),
                subject_code: "BOB-HIJACK".to_string(),
                name_alias: None,
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        );

        assert!(bob_attack.is_err());
        assert!(bob_attack.unwrap_err().contains("Permission denied"));
    }

    #[test]
    fn deletes_subject_safely_and_denies_cross_user_deletion() {
        let conn = setup_conn();

        let alice_sub = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "ALICE-DEL".to_string(),
                name_alias: None,
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("alice save");

        // Bob tries to delete Alice's subject
        let bob_del = delete_subject(&conn, &alice_sub.id, "user-bob");
        assert!(bob_del.is_err());
        assert!(bob_del.unwrap_err().contains("Permission denied"));

        // Alice deletes non-existent subject
        let missing_del = delete_subject(&conn, "non-existent-id", "user-alice");
        assert_eq!(missing_del.unwrap_err(), "Subject not found.");

        // Alice deletes her own subject
        let deleted = delete_subject(&conn, &alice_sub.id, "user-alice").expect("delete ok");
        assert_eq!(deleted.id, alice_sub.id);

        let list = list_subjects(&conn, "user-alice").expect("list");
        assert!(list.is_empty());
    }

    #[test]
    fn rejects_blank_subject_code_and_invalid_birth_year() {
        let conn = setup_conn();

        let blank_res = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "   ".to_string(),
                name_alias: None,
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        );
        assert_eq!(blank_res.unwrap_err(), "Subject code cannot be empty.");

        let year_res = save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "SUBJ-VALID".to_string(),
                name_alias: None,
                gender: None,
                birth_year: Some(1850),
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        );
        assert!(year_res.unwrap_err().contains("Birth year must be between"));
    }

    #[test]
    fn cascades_deletion_when_user_is_deleted() {
        let conn = setup_conn();

        save_subject(
            &conn,
            &SaveSubjectInput {
                id: None,
                user_id: "user-alice".to_string(),
                subject_code: "ALICE-CASCADE".to_string(),
                name_alias: None,
                gender: None,
                birth_year: None,
                handedness: None,
                cap_size: None,
                clinical_group: None,
                notes: None,
            },
        )
        .expect("save subject");

        conn.execute("DELETE FROM users WHERE id = 'user-alice'", [])
            .expect("delete user alice");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM subjects WHERE user_id = 'user-alice'", [], |row| {
                row.get(0)
            })
            .expect("count subjects");

        assert_eq!(count, 0);
    }
}
