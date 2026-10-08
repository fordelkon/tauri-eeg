use super::{store, types::*, worker::Service};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
fn setup() -> (Arc<Mutex<Connection>>, Service) {
    let conn = Connection::open_in_memory().unwrap();
    store::init(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));
    let service = Service::new(db.clone());
    (db, service)
}
fn input(mode: &str) -> StartInput {
    StartInput {
        user_id: "operator".into(),
        subject_id: "subject".into(),
        kind: "effect_evaluation".into(),
        emotion: Some("anxiety".into()),
        condition: Some("regulation".into()),
        method: Some("music".into()),
        duration_minutes: Some(5.0),
        mode: mode.into(),
        external_recording_confirmed: false,
        expected_recording_name: None,
        materials: None,
    }
}
fn event(run: &Run, id: &str) -> EventInput {
    EventInput {
        run_id: run.run_id.clone(),
        event_id: id.into(),
        event: "anxiety_video_start".into(),
        phase_instance_id: "induction".into(),
        trial_id: None,
        media_id: Some("video-a".into()),
        software_time_ms: Some(123.0),
        source: Some("video-frame".into()),
        details: None,
    }
}
#[test]
fn formal_requires_confirmation_and_connection() {
    let (_, service) = setup();
    assert!(service
        .call::<Run>(Box::new(|w| w.start(input("formal"))))
        .is_err());
}

#[test]
fn stale_run_and_end_before_onset_never_create_send_intentions() {
    let (db, service) = setup();
    let run: Run = service
        .call(Box::new(|w| w.start(input("rehearsal"))))
        .unwrap();
    let mut wrong = event(&run, "stale");
    wrong.run_id = "previous-run".into();
    assert!(service
        .call::<Event>(Box::new(move |w| w.emit(wrong)))
        .is_err());
    let mut end = event(&run, "early-end");
    end.event = "induction_video_end".into();
    assert!(service
        .call::<Event>(Box::new(move |w| w.emit(end)))
        .is_err());
    assert_eq!(
        store::all::<Event>(
            &db.lock().unwrap(),
            "SELECT data FROM experiment_events",
            None
        )
        .unwrap()
        .len(),
        1
    );
}
#[test]
fn rehearsal_is_persistent_without_serial_and_deduplicates_onset() {
    let (db, service) = setup();
    let run: Run = service
        .call(Box::new(|w| w.start(input("rehearsal"))))
        .unwrap();
    let onset = event(&run, "onset");
    let original = onset.clone();
    let first: Event = service.call(Box::new(move |w| w.emit(onset))).unwrap();
    assert_eq!(first.result, "rehearsal");
    assert_eq!(first.code, 2);
    assert_eq!(first.sequence, 2);
    let second: Event = service.call(Box::new(move |w| w.emit(original))).unwrap();
    assert_eq!(second.sequence, 2);
    let duplicate = event(&run, "another-onset");
    assert!(service
        .call::<Event>(Box::new(move |w| w.emit(duplicate)))
        .is_err());
    let id = run.run_id.clone();
    let finished: Run = service
        .call(Box::new(move |w| w.finish(id, Some("test end".into()))))
        .unwrap();
    assert_eq!(finished.status, "aborted");
    let rows: Vec<Event> = store::all(
        &db.lock().unwrap(),
        "SELECT data FROM experiment_events ORDER BY sequence",
        None,
    )
    .unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[2].code, 91);
}
#[test]
fn failed_serial_send_interrupts_and_is_never_replayed() {
    let (db, service) = setup();
    let run: Run = service
        .call(Box::new(|w| w.start(input("rehearsal"))))
        .unwrap();
    let onset = event(&run, "lost-cable");
    let copy = onset.clone();
    service
        .call::<serde_json::Value>(Box::new(move |w| {
            w.set_active_mode_for_test();
            Ok(serde_json::Value::Null)
        }))
        .unwrap();
    assert!(service
        .call::<Event>(Box::new(move |w| w.emit(onset)))
        .is_err());
    assert!(service
        .call::<Event>(Box::new(move |w| w.emit(copy)))
        .is_err());
    let stored = store::event(&db.lock().unwrap(), "lost-cable")
        .unwrap()
        .unwrap();
    assert_eq!(stored.result, "failed");
    assert_eq!(
        store::run(&db.lock().unwrap(), &run.run_id).unwrap().status,
        "interrupted"
    );
}
#[test]
fn restart_converts_unresolved_write_to_unknown() {
    let (db, service) = setup();
    let run: Run = service
        .call(Box::new(|w| w.start(input("rehearsal"))))
        .unwrap();
    let conn = db.lock().unwrap();
    let onset = Event {
        input: event(&run, "pending"),
        sequence: 2,
        code: 2,
        received_at: now(),
        backend_elapsed_ms: 1.0,
        write_started_at: None,
        write_finished_at: None,
        queue_wait_ms: None,
        result: "pending".into(),
        error: None,
    };
    store::save_event(&conn, &onset).unwrap();
    store::init(&conn).unwrap();
    assert_eq!(
        store::event(&conn, "pending").unwrap().unwrap().result,
        "unknown"
    );
    assert_eq!(
        store::run(&conn, &run.run_id).unwrap().status,
        "interrupted"
    );
}
#[test]
fn mapping_has_unique_codes_and_excludes_feedback() {
    let codes: std::collections::HashSet<_> = EVENT_CODES.iter().map(|(_, code)| *code).collect();
    assert_eq!(codes.len(), EVENT_CODES.len());
    assert!(!codes.contains(&0));
    assert!(code("reappraisal_start").is_err());
    assert_eq!(code("video_regulation_end").unwrap(), 42);
}

#[test]
fn transport_writes_one_binary_byte_without_ascii_or_reset() {
    let mut bytes = Vec::new();
    super::worker::write_code(&mut bytes, 31).unwrap();
    assert_eq!(bytes, vec![0x1f]);
}

#[test]
fn comparison_excludes_rehearsal_and_aborted_and_preserves_legacy() {
    use crate::scale_records::{self, SaveScaleRecordInput};
    let (db, service) = setup();
    let run: Run = service
        .call(Box::new(|w| w.start(input("rehearsal"))))
        .unwrap();
    let conn = db.lock().unwrap();
    conn.execute_batch(
        "CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES ('operator');",
    )
    .unwrap();
    scale_records::init_scale_records_schema(&conn).unwrap();
    let record = scale_records::save_scale_record(
        &conn,
        &SaveScaleRecordInput {
            user_id: "operator".into(),
            subject_id: Some("subject".into()),
            scale_id: "test".into(),
            phase: "baseline".into(),
            dimension_scores: std::collections::BTreeMap::from([("anxiety".into(), 50.0)]),
            raw_answers: serde_json::json!({}),
            emotion: Some("anxiety".into()),
            condition: Some("regulation".into()),
            duration_minutes: Some(5),
            regulation_skipped: false,
            measured_dimensions: None,
            experiment_run_id: None,
        },
    )
    .unwrap();
    assert_eq!(
        super::report::eligible_records(&conn, vec![record.clone()])
            .unwrap()
            .len(),
        1
    );
    conn.execute(
        "INSERT INTO experiment_scales VALUES (?1,?2,'baseline')",
        rusqlite::params![record.id, run.run_id],
    )
    .unwrap();
    assert!(super::report::eligible_records(&conn, vec![record.clone()])
        .unwrap()
        .is_empty());
    let mut formal = run.clone();
    formal.input.mode = "formal".into();
    formal.status = "aborted".into();
    store::save_run(&conn, &formal).unwrap();
    assert!(super::report::eligible_records(&conn, vec![record.clone()])
        .unwrap()
        .is_empty());
    formal.status = "completed".into();
    store::save_run(&conn, &formal).unwrap();
    assert_eq!(
        super::report::eligible_records(&conn, vec![record.clone()]).unwrap()[0].experiment_run_id,
        Some(run.run_id)
    );
    let manifest = super::detail(&conn, &formal.run_id).unwrap();
    assert_eq!(
        manifest["scales"][0]["record"]["dimensionScores"]["anxiety"],
        50.0
    );
    assert_eq!(
        manifest["scales"][0]["record"]["rawAnswers"],
        serde_json::json!({})
    );
    assert_eq!(manifest["scales"][0]["record"]["subjectId"], "subject");
    assert!(super::report::require_same_run(&conn, &record.id, "other-record").is_err());

    let mut regulation_pre = record.clone();
    regulation_pre.experiment_run_id = Some("regulation-run".into());
    let mut regulation_post = regulation_pre.clone();
    regulation_post.id = "regulation-post".into();
    regulation_post.phase = "post".into();
    regulation_post.dimension_scores = serde_json::json!({"anxiety":20.0});
    let mut natural_pre = record.clone();
    natural_pre.id = "natural-pre".into();
    natural_pre.experiment_run_id = Some("natural-run".into());
    natural_pre.condition = Some("natural_recovery".into());
    let mut natural_post = natural_pre.clone();
    natural_post.id = "natural-post".into();
    natural_post.phase = "post".into();
    natural_post.dimension_scores = serde_json::json!({"anxiety":40.0});
    let comparison = scale_records::compute_condition_effect_comparison(
        &[natural_pre, regulation_pre, natural_post, regulation_post],
        "subject",
        "anxiety",
    )
    .unwrap();
    assert_eq!(
        comparison.natural_recovery_leg.experiment_run_id,
        Some("natural-run".into())
    );
    assert_eq!(
        comparison.regulation_leg.experiment_run_id,
        Some("regulation-run".into())
    );
}

