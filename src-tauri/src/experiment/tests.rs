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
        kind: "held_out_generation".into(),
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
fn formal_requires_trigger_test_since_last_connect() {
    let (_, service) = setup();
    let mut confirmed = input("formal");
    confirmed.external_recording_confirmed = true;
    service
        .call::<serde_json::Value>(Box::new(|w| {
            w.set_trigger_state_for_test(true, false);
            Ok(serde_json::Value::Null)
        }))
        .unwrap();
    // The call() closures are 'static, so each start gets its own owned input.
    let first = confirmed.clone();
    assert_eq!(
        service
            .call::<Run>(Box::new(move |w| w.start(first)))
            .unwrap_err(),
        "Trigger test has not passed since the last connection."
    );
    service
        .call::<serde_json::Value>(Box::new(|w| {
            w.set_trigger_state_for_test(true, true);
            Ok(serde_json::Value::Null)
        }))
        .unwrap();
    // The gate now passes: start proceeds to the run_start pulse, which fails
    // in tests only because no real serial port exists.
    assert_ne!(
        service
            .call::<Run>(Box::new(move |w| w.start(confirmed)))
            .unwrap_err(),
        "Trigger test has not passed since the last connection."
    );
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
    assert_eq!(first.code, Some(2));
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
    assert_eq!(rows[2].code, Some(91));
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
        code: Some(2),
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
    assert_eq!(code("baseline_rest_start").unwrap(), 20);
    assert_eq!(code("baseline_rest_end").unwrap(), 23);
    assert_eq!(code("video_regulation_end").unwrap(), 42);
}

#[test]
fn transport_writes_one_binary_byte_without_ascii_or_reset() {
    let mut bytes = Vec::new();
    super::worker::write_code(&mut bytes, 31).unwrap();
    assert_eq!(bytes, vec![0x1f]);
}

#[test]
fn transport_returns_after_write_without_waiting_for_driver_flush() {
    struct Driver {
        bytes: Vec<u8>,
    }
    impl std::io::Write for Driver {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "driver flush does not finish",
            ))
        }
    }
    let mut driver = Driver { bytes: Vec::new() };
    super::worker::write_code(&mut driver, 254).unwrap();
    assert_eq!(driver.bytes, vec![254]);
}

#[test]
fn transport_reports_failed_write_without_retrying() {
    struct Disconnected;
    impl std::io::Write for Disconnected {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::ErrorKind::BrokenPipe.into())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            unreachable!()
        }
    }
    let error = super::worker::write_code(&mut Disconnected, 254).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::BrokenPipe);
}
