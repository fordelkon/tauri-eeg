use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_library_root(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("tauri-eeg-paradigm-{name}-{suffix}"));
    fs::create_dir_all(&path).expect("create temp dir");
    path
}

fn seed_library(root: &Path, files_per_class: usize) {
    for emotion in PARADIGM_EMOTIONS {
        let dir = root.join(emotion.display_name());
        fs::create_dir_all(&dir).expect("create class dir");
        for index in 0..files_per_class {
            fs::write(
                dir.join(format!("{}_vid{:02}.mp4", emotion.wire_str(), index)),
                b"",
            )
            .expect("create mp4");
        }
        fs::write(dir.join("notes.txt"), b"").expect("create non-video file");
    }
}

#[test]
fn fnv1a_matches_reference_vectors() {
    assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
    assert_ne!(fnv1a(b"run-1"), fnv1a(b"run-2"));
}

#[test]
fn splitmix_is_deterministic_per_seed_and_seeds_diverge() {
    let mut first = SplitMix64::new(42);
    let mut second = SplitMix64::new(42);
    let mut other = SplitMix64::new(43);

    for _ in 0..8 {
        let value = first.next();
        assert_eq!(value, second.next());
        assert_ne!(value, other.next());
    }
    for bound in [2_usize, 5, 20] {
        assert!(first.next_below(bound) < bound);
    }
}

#[test]
fn library_scan_reports_sorted_entries_and_problems() {
    let root = temp_library_root("scan");
    seed_library(&root, 6);

    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");

    assert!(library.valid);
    assert!(library.problems.is_empty());
    for emotion in PARADIGM_EMOTIONS {
        let entries = library.entries_for(emotion);
        assert_eq!(entries.len(), 6);
        assert_eq!(entries[0].video_id, format!("{}_vid00", emotion.wire_str()));
        assert!(entries[0].absolute_path.ends_with(".mp4"));
    }
    let mut sorted = library.depression.clone();
    sorted.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    assert_eq!(library.depression, sorted);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn library_scan_includes_nested_material_categories_with_unique_relative_ids() {
    let root = temp_library_root("nested-calm");
    seed_library(&root, MIN_VIDEOS_PER_CLASS);
    let calm_root = root.join("Calm");
    fs::write(calm_root.join("shared-name.mp4"), b"").expect("create direct calm video");
    let nested = calm_root.join("scenery");
    fs::create_dir_all(&nested).expect("create nested category");
    fs::write(nested.join("shared-name.mp4"), b"").expect("create nested calm video");

    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");

    assert!(library.valid);
    assert_eq!(library.calm.len(), MIN_VIDEOS_PER_CLASS + 2);
    assert!(library
        .calm
        .iter()
        .any(|entry| entry.video_id == "shared-name"));
    assert!(library
        .calm
        .iter()
        .any(|entry| entry.video_id == "scenery/shared-name"));
    assert!(library
        .calm
        .iter()
        .any(|entry| entry.file_name == "scenery/shared-name.mp4"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn library_scan_reports_contract_readiness_without_blocking_a_valid_shakedown() {
    let root = temp_library_root("readiness");
    seed_library(&root, MIN_VIDEOS_PER_CLASS);

    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");

    assert!(library.valid);
    assert_eq!(library.readiness_warnings.len(), 3);
    assert!(library
        .readiness_warnings
        .iter()
        .any(|warning| warning.starts_with("Fear currently has 5 MP4 files")));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn library_scan_rejects_missing_root_and_reports_problems() {
    assert_eq!(
        load_paradigm_video_library("Z:/definitely-missing").unwrap_err(),
        "Video root directory does not exist."
    );

    let root = temp_library_root("problems");
    seed_library(&root, 6);
    fs::remove_dir_all(root.join("Calm")).expect("remove calm dir");
    for index in 0..2 {
        fs::remove_file(
            root.join("Anxiety")
                .join(format!("anxiety_vid0{index}.mp4")),
        )
        .expect("remove mp4");
    }

    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");

    assert!(!library.valid);
    assert_eq!(
        library.problems,
        vec![
            "Anxiety requires at least 5 MP4 files (found 4).".to_string(),
            "Missing video subdirectory: Calm.".to_string(),
        ]
    );
    assert_eq!(
        build_paradigm_queue(&library, "run-1", ParadigmSessionKind::PersonalCalibration)
            .unwrap_err(),
        "Anxiety requires at least 5 MP4 files (found 4).; Missing video subdirectory: Calm."
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn queue_is_deterministic_and_covers_all_classes() {
    let root = temp_library_root("queue");
    seed_library(&root, 6);
    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");

    for kind in [
        ParadigmSessionKind::PersonalCalibration,
        ParadigmSessionKind::HeldOutGeneration,
    ] {
        let expected_len = blocks_for_session_kind(kind).len() * TRIALS_PER_CLASS;
        let first = build_paradigm_queue(&library, "run-2026-08-23-a", kind).expect("queue");
        let second = build_paradigm_queue(&library, "run-2026-08-23-a", kind).expect("queue");
        let other = build_paradigm_queue(&library, "run-2026-08-23-b", kind).expect("queue");

        assert_eq!(first, second);
        assert_ne!(first, other);
        assert_eq!(first.len(), expected_len);
        for (index, item) in first.iter().enumerate() {
            assert_eq!(item.trial_index, index as u32);
            assert_eq!(item.trigger_class, item.emotion.trigger_code());
        }
        for emotion in blocks_for_session_kind(kind) {
            let count = first.iter().filter(|item| item.emotion == *emotion).count();
            assert_eq!(
                count, TRIALS_PER_CLASS,
                "{emotion:?} trial count for {kind:?}"
            );
        }
        let unique_videos = first
            .iter()
            .map(|item| item.video_id.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(unique_videos.len(), expected_len);
    }

    let _ = fs::remove_dir_all(root);
}

#[test]
fn queue_from_root_reuses_the_cached_scan_within_ttl() {
    let root = temp_library_root("queue-cache");
    seed_library(&root, MIN_VIDEOS_PER_CLASS);
    let path = root.to_str().expect("utf8 path").to_string();

    let first = build_paradigm_queue_from_root(
        &path,
        "cache-run-1",
        ParadigmSessionKind::HeldOutGeneration,
    )
    .expect("queue");
    // Second call hits the 30 s TTL cache and must feed the same scan into
    // the queue builder, so the result stays identical for the same run id.
    let second = build_paradigm_queue_from_root(
        &path,
        "cache-run-1",
        ParadigmSessionKind::HeldOutGeneration,
    )
    .expect("queue");
    assert_eq!(first, second);
    assert_eq!(
        first.len(),
        blocks_for_session_kind(ParadigmSessionKind::HeldOutGeneration).len() * TRIALS_PER_CLASS
    );

    // A missing root is never cached: the error re-checks the filesystem.
    assert_eq!(
        build_paradigm_queue_from_root(
            "Z:/definitely-missing-queue",
            "cache-run-1",
            ParadigmSessionKind::HeldOutGeneration
        )
        .unwrap_err(),
        "Video root directory does not exist."
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn queue_follows_the_blocked_emotion_schedule() {
    let root = temp_library_root("blocked");
    seed_library(&root, 6);
    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");

    let long_run_id = "r".repeat(96);
    let run_ids = [
        "",
        "a",
        "run-2026-08-23-a",
        "run-2026-08-23-b",
        "6f0e-cafe",
        long_run_id.as_str(),
    ];

    for kind in [
        ParadigmSessionKind::PersonalCalibration,
        ParadigmSessionKind::HeldOutGeneration,
    ] {
        let blocks = blocks_for_session_kind(kind);
        let queues: Vec<_> = run_ids
            .iter()
            .map(|run_id| build_paradigm_queue(&library, run_id, kind).expect("queue"))
            .collect();

        for (run_id, queue) in run_ids.iter().zip(&queues) {
            assert_eq!(
                queue.len(),
                blocks.len() * TRIALS_PER_CLASS,
                "queue length for run id {run_id:?}"
            );
            for (block_index, emotion) in blocks.iter().enumerate() {
                let block =
                    &queue[block_index * TRIALS_PER_CLASS..(block_index + 1) * TRIALS_PER_CLASS];
                assert!(
                    block.iter().all(|item| item.emotion == *emotion),
                    "block {block_index} must stay {emotion:?} for run id {run_id:?}"
                );
            }
        }
        // Distinct run ids still shuffle different videos into the blocks.
        assert!(
            queues.iter().any(|queue| queue != &queues[0]),
            "queues for distinct run ids must not all collapse to one order"
        );
    }

    let _ = fs::remove_dir_all(root);
}

#[test]
fn queue_handles_imbalanced_library_with_blocked_schedule() {
    let root = temp_library_root("imbalanced");
    seed_library(&root, MIN_VIDEOS_PER_CLASS);
    for emotion in [
        ParadigmEmotion::Anxiety,
        ParadigmEmotion::Calm,
        ParadigmEmotion::Fear,
    ] {
        let dir = root.join(emotion.display_name());
        for index in MIN_VIDEOS_PER_CLASS..8 {
            fs::write(
                dir.join(format!("{}_vid{:02}.mp4", emotion.wire_str(), index)),
                b"",
            )
            .expect("create mp4");
        }
    }

    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");
    assert!(library.valid);
    assert_eq!(library.depression.len(), MIN_VIDEOS_PER_CLASS);

    let kind = ParadigmSessionKind::HeldOutGeneration;
    let first = build_paradigm_queue(&library, "imb-run-1", kind).expect("queue");
    let second = build_paradigm_queue(&library, "imb-run-1", kind).expect("queue");
    assert_eq!(first, second);
    assert_eq!(
        first.len(),
        blocks_for_session_kind(kind).len() * TRIALS_PER_CLASS
    );
    for emotion in blocks_for_session_kind(kind) {
        let count = first.iter().filter(|item| item.emotion == *emotion).count();
        assert_eq!(count, TRIALS_PER_CLASS, "{emotion:?} trial count");
    }
    let blocks: Vec<Vec<ParadigmEmotion>> = first
        .chunks(TRIALS_PER_CLASS)
        .map(|chunk| chunk.iter().map(|item| item.emotion).collect())
        .collect();
    assert_eq!(
        blocks,
        blocks_for_session_kind(kind)
            .iter()
            .map(|emotion| vec![*emotion; TRIALS_PER_CLASS])
            .collect::<Vec<_>>()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn requires_fear_pool_for_induction() {
    // The current library has no unused emotion directory.
    let root = temp_library_root("fear-pool");
    for emotion in PARADIGM_EMOTIONS {
        let dir = root.join(emotion.display_name());
        fs::create_dir_all(&dir).expect("create class dir");
        for index in 0..MIN_VIDEOS_PER_CLASS {
            fs::write(
                dir.join(format!("{}_vid{:02}.mp4", emotion.wire_str(), index)),
                b"",
            )
            .expect("create mp4");
        }
    }

    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");
    assert!(library.valid);
    assert!(library.problems.is_empty());
    assert_eq!(library.fear.len(), MIN_VIDEOS_PER_CLASS);
    assert_eq!(
        library.fear[0].video_id, "fear_vid00",
        "fear entries come from the Fear directory"
    );

    // A missing Fear directory is a hard problem: fear is scheduled.
    fs::remove_dir_all(root.join("Fear")).expect("remove fear dir");
    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("reload library");
    assert!(!library.valid);
    assert_eq!(
        library.problems,
        vec!["Missing video subdirectory: Fear.".to_string()]
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn fear_block_feeds_the_induction_queue_with_trigger_5() {
    let root = temp_library_root("fear-queue");
    seed_library(&root, MIN_VIDEOS_PER_CLASS);
    let library =
        load_paradigm_video_library(root.to_str().expect("utf8 path")).expect("load library");

    let queue = build_paradigm_queue(
        &library,
        "fear-run-1",
        ParadigmSessionKind::HeldOutGeneration,
    )
    .expect("queue");
    let fear_trials: Vec<_> = queue
        .iter()
        .filter(|item| item.emotion == ParadigmEmotion::Fear)
        .collect();
    assert_eq!(fear_trials.len(), TRIALS_PER_CLASS);
    assert!(fear_trials.iter().all(|item| item.trigger_class == 5));

    let _ = fs::remove_dir_all(root);
}
