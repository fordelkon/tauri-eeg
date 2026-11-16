use super::*;

#[test]
fn formal_pre_induction_event_is_logged_without_a_serial_device() {
    let (_, service, run) = setup();
    let event = EventInput {
        run_id: run.run_id,
        event_id: "t0-start".into(),
        event: "pre_induction_scale_start".into(),
        phase_instance_id: "t0".into(),
        trial_id: None,
        media_id: None,
        software_time_ms: None,
        source: None,
        details: None,
    };
    let logged: Event = service
        .call(Box::new(move |worker| {
            worker.lose_port_for_test();
            worker.emit(event)
        }))
        .unwrap();
    assert_eq!(logged.result, "logged");
    assert!(logged.code.is_none());
    assert!(logged.write_started_at.is_none() && logged.write_finished_at.is_none());
}

#[test]
fn deq_saves_and_exports_three_ratings_from_one_run() {
    let (db, service, run) = setup();
    let emit = |name: &str, phase: &str| {
        let event = EventInput {
            run_id: run.run_id.clone(),
            event_id: name.into(),
            event: name.into(),
            phase_instance_id: phase.into(),
            trial_id: None,
            media_id: Some("example".into()),
            software_time_ms: None,
            source: None,
            details: None,
        };
        service.call::<Event>(Box::new(move |w| w.emit(event)))
    };
    let save = |phase: &str, intensity: u64| {
        let input = rating_input(&run, phase, intensity);
        crate::experiment::records::save_measurement(&db.lock().unwrap(), &input)
    };
    assert!(emit("anxiety_video_start", "video").is_err());
    let first_event = emit("pre_induction_scale_start", "t0").unwrap();
    assert_eq!(
        (first_event.code, first_event.result.as_str()),
        (None, "logged")
    );
    assert!(first_event.write_started_at.is_none());
    assert!(emit("pre_induction_scale_submit", "t0").is_err());
    assert!(save("pre_induction", 8).is_err());
    assert!(save("baseline", 5).is_err());
    let mut skipped = rating_input(&run, "pre_induction", 2);
    skipped.regulation_skipped = true;
    assert!(crate::experiment::records::save_measurement(&db.lock().unwrap(), &skipped).is_err());
    let first = save("pre_induction", 2).unwrap();
    assert_eq!(save("pre_induction", 2).unwrap().id, first.id);
    assert!(save("pre_induction", 3).is_err());
    emit("pre_induction_scale_submit", "t0").unwrap();
    emit("anxiety_video_start", "video").unwrap();
    emit("induction_video_end", "video").unwrap();
    emit("pre_scale_start", "t1").unwrap();
    let baseline = save("baseline", 6).unwrap();
    emit("pre_scale_submit", "t1").unwrap();
    emit("music_regulation_start", "condition").unwrap();
    emit("music_regulation_end", "condition").unwrap();
    emit("post_scale_start", "t2").unwrap();
    let post = save("post", 3).unwrap();
    emit("post_scale_submit", "t2").unwrap();
    assert_eq!(
        detail(&service, &run.run_id)["scales"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let conn = db.lock().unwrap();
    for format in ["json", "csv"] {
        let request =
            serde_json::from_value(json!({"kind":"single","format":format,"path":"unused",
            "baselineRecordId":baseline.id,"postRecordId":post.id}))
            .unwrap();
        let result = crate::effect_reports::build_report_content(&conn, request).unwrap();
        if format == "json" {
            let json: Value = serde_json::from_str(&result).unwrap();
            assert_eq!(json["preInductionRecordId"], first.id);
            assert_eq!(json["emotionChanges"][0]["inductionChange"], 4.0);
            assert_eq!(json["emotionChanges"][0]["conditionChange"], -3.0);
            assert!(json.get("meetsThreshold").is_none());
        } else {
            assert!(result.contains("anxiety,2,6,3,4,-3,"));
        }
    }
    assert!(scale_records::completed_effect_records(&conn)
        .unwrap()
        .is_empty());
    let mut finished = run.clone();
    finished.status = "completed".into();
    finished.input.mode = "rehearsal".into();
    store::save_run(&conn, &finished).unwrap();
    assert!(scale_records::completed_effect_records(&conn)
        .unwrap()
        .is_empty());
    finished.input.mode = "formal".into();
    store::save_run(&conn, &finished).unwrap();
    let history = scale_records::build_effect_history(
        &scale_records::completed_effect_records(&conn).unwrap(),
    );
    assert_eq!(history[0].emotion_changes.len(), 3);
    assert!(scale_records::build_batch_effect_report_csv(&history).ends_with(",4,-3,4,-3,4,-3"));
    scale_records::delete_scale_record(&conn, &post.id).unwrap();
    assert!(scale_records::list_scale_records(&conn, None, None)
        .unwrap()
        .is_empty());
}
