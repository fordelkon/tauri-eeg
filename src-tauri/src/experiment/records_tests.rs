use super::{store, types::*, worker::Service};
use crate::scale_records::{self, SaveScaleRecordInput};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

fn setup() -> (Arc<Mutex<Connection>>, Service, Run) {
    let conn = Connection::open_in_memory().unwrap();
    store::init(&conn).unwrap();
    conn.execute_batch("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('operator'), ('other');").unwrap();
    scale_records::init_scale_records_schema(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));
    let service = Service::new(db.clone());
    let run: Run = service
        .call(Box::new(move |w| {
            w.start_formal_for_test(StartInput {
                user_id: "operator".into(),
                subject_id: "subject".into(),
                kind: "effect_evaluation".into(),
                emotion: Some("anxiety".into()),
                condition: Some("regulation".into()),
                method: Some("music".into()),
                duration_minutes: Some(5.0),
                mode: "formal".into(),
                external_recording_confirmed: true,
                expected_recording_name: None,
                materials: None,
            })
        }))
        .unwrap();
    (db, service, run)
}

fn detail(service: &Service, id: &str) -> Value {
    let id = id.to_owned();
    service
        .call(Box::new(move |w| w.record_detail(id)))
        .unwrap()
}

fn trial(service: &Service, run_id: &str, payload: Value) -> Result<Value, String> {
    let run_id = run_id.to_owned();
    service.call(Box::new(move |w| w.save_trial(run_id, payload)))
}

fn rating_input(run: &Run, phase: &str, intensity: u64) -> SaveScaleRecordInput {
    let mut items = BTreeMap::new();
    let mut dimension_scores = BTreeMap::new();
    for (dimension, keys) in scale_records::DEQ_ITEMS {
        dimension_scores.insert(dimension.into(), intensity as f64);
        for key in keys {
            items.insert(key, intensity);
        }
    }
    SaveScaleRecordInput {
        user_id: "operator".into(),
        subject_id: Some("subject".into()),
        scale_id: scale_records::DEQ_SCALE_ID.into(),
        phase: phase.into(),
        dimension_scores,
        raw_answers: json!({"deq":items, "timeframe":"now"}),
        emotion: Some("anxiety".into()),
        condition: Some("regulation".into()),
        duration_minutes: Some(5),
        regulation_skipped: false,
        measured_dimensions: None,
        experiment_run_id: Some(run.run_id.clone()),
    }
}

#[path = "deq_tests.rs"]
mod deq_tests;

fn associate(service: &Service, run_id: &str, files: Vec<&str>) -> Result<Run, String> {
    let run_id = run_id.to_owned();
    let files = files.into_iter().map(str::to_owned).collect();
    service.call(Box::new(move |w| {
        w.associate_bdf(run_id, "operator".into(), files)
    }))
}

fn other_run(db: &Arc<Mutex<Connection>>, run: &Run) -> Run {
    let mut other = run.clone();
    other.run_id = "other-run".into();
    other.status = "interrupted".into();
    store::save_run(&db.lock().unwrap(), &other).unwrap();
    other
}

#[test]
fn trial_updates_within_its_run_and_cross_run_rejection_preserves_original() {
    let (db, service, run) = setup();
    let other = other_run(&db, &run);
    trial(
        &service,
        &run.run_id,
        json!({"trialId": "trial-a", "score": 1}),
    )
    .unwrap();
    let updated = json!({"trialId": "trial-a", "score": 2});
    assert_eq!(
        trial(&service, &run.run_id, updated.clone()).unwrap(),
        updated
    );
    assert_eq!(
        trial(
            &service,
            &other.run_id,
            json!({"trialId": "trial-a", "score": 99})
        )
        .unwrap_err(),
        "Trial ID belongs to a different run."
    );
    assert_eq!(detail(&service, &run.run_id)["trials"], json!([updated]));
    assert_eq!(detail(&service, &other.run_id)["trials"], json!([]));
    trial(&service, &other.run_id, json!({"trialId": "recovered"})).unwrap();
    assert_eq!(
        detail(&service, &other.run_id)["trials"],
        json!([{"trialId": "recovered"}])
    );
}

#[test]
fn trial_missing_id_and_queued_close_reject_without_writing() {
    let (_, service, run) = setup();
    for payload in [json!({}), json!({"trialId": " "}), json!({"trialId": 3})] {
        assert_eq!(
            trial(&service, &run.run_id, payload).unwrap_err(),
            "Trial ID required."
        );
    }
    let id = run.run_id.clone();
    service
        .call::<Run>(Box::new(move |w| w.finish(id, Some("stop".into()))))
        .unwrap();
    assert_eq!(
        trial(&service, &run.run_id, json!({"trialId": "late"})).unwrap_err(),
        "Trial run is closed."
    );
    assert_eq!(detail(&service, &run.run_id)["trials"], json!([]));
}

fn start_rating(service: &Service, run: &Run) {
    let event = EventInput {
        run_id: run.run_id.clone(),
        event_id: "t0-start".into(),
        event: "pre_induction_scale_start".into(),
        phase_instance_id: "t0".into(),
        trial_id: None,
        media_id: None,
        software_time_ms: None,
        source: None,
        details: None,
    };
    service
        .call::<Event>(Box::new(move |w| w.emit(event)))
        .unwrap();
}

fn save_initial(db: &Arc<Mutex<Connection>>, service: &Service, run: &Run) -> String {
    start_rating(service, run);
    let input = rating_input(run, "pre_induction", 2);
    super::records::save_measurement(&db.lock().unwrap(), &input)
        .unwrap()
        .id
}

#[test]
fn rejects_mismatched_metadata_and_closed_runs_without_leaving_scale_records() {
    let (db, service, run) = setup();
    start_rating(&service, &run);
    let conn = db.lock().unwrap();
    let original = rating_input(&run, "pre_induction", 2);
    for field in ["user", "subject", "emotion", "condition"] {
        let mut input = original.clone();
        match field {
            "user" => input.user_id = "other".into(),
            "subject" => input.subject_id = Some("other".into()),
            "emotion" => input.emotion = Some("fear".into()),
            _ => input.condition = Some("natural_recovery".into()),
        }
        assert!(super::records::save_measurement(&conn, &input).is_err());
    }
    let mut different = run.clone();
    for (kind, status) in [
        ("personal_calibration", "running"),
        ("effect_evaluation", "interrupted"),
        ("effect_evaluation", "completed"),
    ] {
        different.input.kind = kind.into();
        different.status = status.into();
        store::save_run(&conn, &different).unwrap();
        assert!(super::records::save_measurement(&conn, &original).is_err());
    }
    assert!(scale_records::list_scale_records(&conn, None, None)
        .unwrap()
        .is_empty());
}

#[test]
fn bdf_association_validates_complete_data_and_preserves_previous_files_on_failure() {
    let (db, service, run) = setup();
    assert_eq!(
        associate(&service, &run.run_id, vec!["recording.bdf"]).unwrap_err(),
        "Associate BDF files after the experiment."
    );
    let mut closed = run.clone();
    closed.status = "completed".into();
    closed.input.mode = "formal".into();
    store::save_run(&db.lock().unwrap(), &closed).unwrap();

    crate::bdf_destination::init(&db.lock().unwrap()).unwrap();
    let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("formal.bdf");
    let text = path.to_str().unwrap();
    // One 24-bit sample, one channel, one record.
    let mut bdf = vec![b' '; 515];
    bdf[..8].copy_from_slice(b"\xffBIOSEMI");
    bdf[184..187].copy_from_slice(b"512");
    bdf[236] = b'1';
    bdf[252] = b'1';
    bdf[472] = b'1';
    std::fs::write(&path, &bdf).unwrap();
    assert_eq!(
        associate(&service, &closed.run_id, vec![text])
            .unwrap()
            .bdf_files,
        vec![text]
    );
    assert!(associate(&service, &closed.run_id, vec![text, text]).is_err());
    let triggercheck = dir.join("sub-01_task-effectbaseline_acq-triggercheck_run-01_eeg.bdf");
    std::fs::write(&triggercheck, &bdf).unwrap();
    assert!(associate(
        &service,
        &closed.run_id,
        vec![triggercheck.to_str().unwrap()]
    )
    .is_err());
    std::fs::remove_file(triggercheck).unwrap();
    let other = other_run(&db, &closed);
    assert!(associate(&service, &other.run_id, vec![text]).is_err());
    let id = closed.run_id.clone();
    let unauthorized = service.call::<Run>(Box::new(move |w| {
        w.associate_bdf(id, "other".into(), vec![])
    }));
    assert_eq!(unauthorized.unwrap_err(), "该实验不属于当前账号。");

    let reserved = dir.join("reserved.bdf");
    std::fs::write(&reserved, &bdf).unwrap();
    db.lock().unwrap().execute("INSERT INTO bdf_reservations(user_id,subject_id,session,task,run_index,path) VALUES ('other','subject',1,'effect',1,?1)", [reserved.to_str().unwrap()]).unwrap();
    assert!(associate(&service, &closed.run_id, vec![reserved.to_str().unwrap()]).is_err());
    std::fs::remove_file(reserved).unwrap();
    let unfinished = dir.join("unfinished.bdf");
    bdf[236..238].copy_from_slice(b"-1");
    std::fs::write(&unfinished, &bdf).unwrap();
    assert!(associate(&service, &closed.run_id, vec![unfinished.to_str().unwrap()]).is_err());
    bdf[236..238].copy_from_slice(b"2 ");
    std::fs::write(&unfinished, &bdf).unwrap();
    assert!(associate(&service, &closed.run_id, vec![unfinished.to_str().unwrap()]).is_err());
    assert_eq!(
        detail(&service, &closed.run_id)["run"]["bdfFiles"],
        json!([text])
    );
    std::fs::remove_file(path).unwrap();
    std::fs::remove_file(unfinished).unwrap();
    std::fs::remove_dir(dir).unwrap();
}

#[test]
fn list_filters_user_and_detail_retains_manifest_contract_and_event_order() {
    let (db, service, run) = setup();
    let mut other = other_run(&db, &run);
    other.input.user_id = "other".into();
    db.lock()
        .unwrap()
        .execute(
            "UPDATE experiment_runs SET user_id='other', data=?1 WHERE run_id=?2",
            rusqlite::params![store::json(&other).unwrap(), other.run_id],
        )
        .unwrap();
    let all: Vec<Run> = service.call(Box::new(|w| w.list_runs(None))).unwrap();
    assert_eq!(
        all.iter().map(|r| r.run_id.as_str()).collect::<Vec<_>>(),
        vec!["other-run", run.run_id.as_str()]
    );
    let mine: Vec<Run> = service
        .call(Box::new(|w| w.list_runs(Some("operator".into()))))
        .unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].run_id, run.run_id);
    let data = detail(&service, &run.run_id);
    assert_eq!(data["events"][0]["sequence"], 1);
    assert_eq!(data["events"][0]["event"], "run_start");
    assert_eq!(data["hardwareReceiptVerified"], false);
    assert_eq!(data["eventDefinitions"], json!(EVENT_CODES));
    assert!(data["eventDefinitions"]
        .as_array()
        .unwrap()
        .contains(&json!(["baseline_rest_end", 23])));
}

#[test]
fn deleting_scale_record_cascades_from_experiment_scales_so_detail_succeeds() {
    let (db, service, run) = setup();
    let id = save_initial(&db, &service, &run);
    assert_eq!(
        detail(&service, &run.run_id)["scales"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    scale_records::delete_scale_record(&db.lock().unwrap(), &id).unwrap();
    let detail_val = detail(&service, &run.run_id);
    assert_eq!(detail_val["scales"], json!([]));
}

#[test]
fn delete_experiment_run_cascades_and_removes_all_associated_data() {
    let (db, service, run) = setup();
    save_initial(&db, &service, &run);
    trial(
        &service,
        &run.run_id,
        json!({"trialId": format!("{}:trial:1", run.run_id), "status": "ok"}),
    )
    .unwrap();

    // Abort the run so it's not active/running
    let _: Run = service
        .call(Box::new({
            let run_id = run.run_id.clone();
            move |w| w.finish(run_id, Some("aborted for test".into()))
        }))
        .unwrap();

    let conn = db.lock().unwrap();
    let events_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM experiment_events WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(events_count > 0);

    let trials_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM experiment_trials WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(trials_count, 1);

    let scales_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM experiment_scales WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(scales_count, 1);
    drop(conn);

    // Delete with correct operator user_id
    let deleted: Run = service
        .call(Box::new({
            let run_id = run.run_id.clone();
            move |w| w.delete_run(run_id, Some("operator".into()))
        }))
        .unwrap();
    assert_eq!(deleted.run_id, run.run_id);

    let conn = db.lock().unwrap();
    let runs_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM experiment_runs WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(runs_count, 0);

    let events_count_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM experiment_events WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(events_count_after, 0);

    let trials_count_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM experiment_trials WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(trials_count_after, 0);

    let scales_count_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM experiment_scales WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(scales_count_after, 0);
}

#[test]
fn delete_experiment_run_rejects_running_and_unauthorized() {
    let (_db, service, run) = setup();

    // Rejection 1: cannot delete while still in running state
    let err_running: Result<Run, String> = service.call(Box::new({
        let run_id = run.run_id.clone();
        move |w| w.delete_run(run_id, Some("operator".into()))
    }));
    assert!(err_running.is_err());
    assert!(err_running.unwrap_err().contains("currently in progress"));

    // Finish/abort run
    let _: Run = service
        .call(Box::new({
            let run_id = run.run_id.clone();
            move |w| w.finish(run_id, Some("aborted for test".into()))
        }))
        .unwrap();

    // Rejection 2: unauthorized user
    let err_unauth: Result<Run, String> = service.call(Box::new({
        let run_id = run.run_id.clone();
        move |w| w.delete_run(run_id, Some("other".into()))
    }));
    assert!(err_unauth.is_err());
    assert!(err_unauth.unwrap_err().contains("not authorized"));
}
