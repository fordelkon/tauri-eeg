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
        .call(Box::new(|w| {
            w.start(StartInput {
                user_id: "operator".into(),
                subject_id: "subject".into(),
                kind: "effect_evaluation".into(),
                emotion: Some("anxiety".into()),
                condition: Some("regulation".into()),
                method: Some("music".into()),
                duration_minutes: Some(5.0),
                mode: "rehearsal".into(),
                external_recording_confirmed: false,
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

fn scale_input() -> SaveScaleRecordInput {
    SaveScaleRecordInput {
        user_id: "operator".into(),
        subject_id: Some("subject".into()),
        scale_id: "test".into(),
        phase: "baseline".into(),
        dimension_scores: BTreeMap::from([("anxiety".into(), 50.0)]),
        raw_answers: json!({"answer": 2}),
        emotion: Some("anxiety".into()),
        condition: Some("regulation".into()),
        duration_minutes: Some(5),
        regulation_skipped: false,
        measured_dimensions: None,
        experiment_run_id: None,
    }
}

fn save_scale(db: &Arc<Mutex<Connection>>, input: &SaveScaleRecordInput) -> String {
    scale_records::save_scale_record(&db.lock().unwrap(), input)
        .unwrap()
        .id
}

fn link(service: &Service, run_id: &str, record_id: &str, phase: &str) -> Result<(), String> {
    let (run_id, record_id, phase) = (run_id.to_owned(), record_id.to_owned(), phase.to_owned());
    service.call(Box::new(move |w| w.link_scale(run_id, record_id, phase)))
}

fn associate(service: &Service, run_id: &str, files: Vec<&str>) -> Result<Run, String> {
    let run_id = run_id.to_owned();
    let files = files.into_iter().map(str::to_owned).collect();
    service.call(Box::new(move |w| w.associate_bdf(run_id, files)))
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

#[test]
fn matching_scale_is_idempotent_and_owned_by_one_run() {
    let (db, service, run) = setup();
    let other = other_run(&db, &run);
    let record_id = save_scale(&db, &scale_input());
    link(&service, &run.run_id, &record_id, "baseline").unwrap();
    link(&service, &run.run_id, &record_id, "baseline").unwrap();
    assert_eq!(
        link(&service, &other.run_id, &record_id, "baseline").unwrap_err(),
        "Scale is already linked to a different run or phase."
    );
    let manifest = detail(&service, &run.run_id);
    assert_eq!(manifest["scales"].as_array().unwrap().len(), 1);
    assert_eq!(manifest["scales"][0]["recordId"], record_id);
    assert_eq!(manifest["scales"][0]["measurementTime"], "baseline");
    assert_eq!(
        manifest["scales"][0]["record"]["experimentRunId"],
        run.run_id
    );
    assert_eq!(
        manifest["scales"][0]["record"]["dimensionScores"],
        json!({"anxiety": 50.0})
    );
    assert_eq!(
        manifest["scales"][0]["record"]["rawAnswers"],
        json!({"answer": 2})
    );
    assert_eq!(detail(&service, &other.run_id)["scales"], json!([]));
}

#[test]
fn scale_rejects_each_frozen_metadata_mismatch_and_invalid_phase_without_links() {
    let (db, service, run) = setup();
    let baseline = scale_input();
    let mut variants = Vec::new();
    let mut different = baseline.clone();
    different.subject_id = Some("other-subject".into());
    variants.push(different);
    let mut different = baseline.clone();
    different.user_id = "other".into();
    variants.push(different);
    let mut different = baseline.clone();
    different.phase = "post".into();
    variants.push(different);
    let mut different = baseline.clone();
    different.emotion = Some("fear".into());
    variants.push(different);
    let mut different = baseline.clone();
    different.condition = Some("natural_recovery".into());
    variants.push(different);
    for input in variants {
        let id = save_scale(&db, &input);
        assert_eq!(
            link(&service, &run.run_id, &id, "baseline").unwrap_err(),
            "Scale metadata does not match the frozen experiment run."
        );
    }
    let id = save_scale(&db, &baseline);
    assert_eq!(
        link(&service, &run.run_id, &id, "invalid").unwrap_err(),
        "Invalid measurement time."
    );
    assert_eq!(detail(&service, &run.run_id)["scales"], json!([]));
}

#[test]
fn scale_rejects_closed_and_non_effect_runs_and_supports_interrupted_post_measure() {
    let (db, service, run) = setup();
    let id = save_scale(&db, &scale_input());
    for (kind, status) in [
        ("personal_calibration", "interrupted"),
        ("effect_evaluation", "completed"),
        ("effect_evaluation", "aborted"),
    ] {
        let mut other = other_run(&db, &run);
        other.input.kind = kind.into();
        other.status = status.into();
        store::save_run(&db.lock().unwrap(), &other).unwrap();
        assert_eq!(
            link(&service, &other.run_id, &id, "baseline").unwrap_err(),
            "Scale run is closed or does not support this measure."
        );
        assert_eq!(detail(&service, &other.run_id)["scales"], json!([]));
    }
    let other = other_run(&db, &run);
    let mut input = scale_input();
    input.phase = "post".into();
    let id = save_scale(&db, &input);
    link(&service, &other.run_id, &id, "post").unwrap();
    assert_eq!(
        detail(&service, &other.run_id)["scales"][0]["measurementTime"],
        "post"
    );
}

#[test]
fn bdf_association_requires_closed_run_and_valid_names_and_persists_replacements() {
    let (_, service, run) = setup();
    assert_eq!(
        associate(&service, &run.run_id, vec!["recording.bdf"]).unwrap_err(),
        "Associate BDF files after the experiment."
    );
    assert_eq!(detail(&service, &run.run_id)["run"]["bdfFiles"], json!([]));
    let id = run.run_id.clone();
    service
        .call::<Run>(Box::new(move |w| w.finish(id, Some("stop".into()))))
        .unwrap();
    let saved = associate(
        &service,
        &run.run_id,
        vec!["recording.BDF", "C:\\recordings\\segment.bdf"],
    )
    .unwrap();
    assert_eq!(
        saved.bdf_files,
        vec!["recording.BDF", "C:\\recordings\\segment.bdf"]
    );
    for invalid in ["", " ", "recording.txt", "recording.bdf.txt"] {
        assert_eq!(
            associate(&service, &run.run_id, vec![invalid]).unwrap_err(),
            "Provide BDF file names or absolute paths."
        );
        assert_eq!(
            detail(&service, &run.run_id)["run"]["bdfFiles"],
            json!(saved.bdf_files)
        );
    }
    associate(&service, &run.run_id, vec!["replacement.bdf"]).unwrap();
    assert_eq!(
        detail(&service, &run.run_id)["run"]["bdfFiles"],
        json!(["replacement.bdf"])
    );
    associate(&service, &run.run_id, vec![]).unwrap();
    assert_eq!(detail(&service, &run.run_id)["run"]["bdfFiles"], json!([]));
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
}
