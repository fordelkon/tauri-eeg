use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use super::paradigm::{
    ParadigmEmotion, ParadigmSessionKind, ParadigmTrialPlanItem, ParadigmVideoEntry,
    ParadigmVideoLibrary, blocks_for_session_kind, is_scheduled_emotion, PARADIGM_EMOTIONS,
};

/// Minimum pool size per scheduled class. Outline S-04 ultimately requires 50
/// clips per class; 5 is the transitional threshold for the R8 pipeline
/// shakedown (the repurposed happy clips are placeholders anyway - see the
/// r8 summary).
const MIN_VIDEOS_PER_CLASS: usize = 5;
const TRIALS_PER_CLASS: usize = 5;
const VIDEO_EXTENSION: &str = "mp4";

const PARADIGM_LIBRARY_CACHE_TTL: Duration = Duration::from_secs(30);

// Scanning the library walks the whole directory tree, and the frontend runs
// the queue build debounced per keystroke plus once more at session start, so
// the last scan per root is reused briefly (same TTL pattern as
// video_library.rs; a 30 s staleness window is acceptable for queue building).
static PARADIGM_LIBRARY_CACHE: Mutex<
    Option<HashMap<PathBuf, (Instant, Arc<ParadigmVideoLibrary>)>>,
> = Mutex::new(None);

pub fn load_paradigm_video_library(root_path: &str) -> Result<ParadigmVideoLibrary, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() || !Path::new(trimmed).is_dir() {
        return Err("Video root directory does not exist.".to_string());
    }
    let root = PathBuf::from(trimmed);

    let mut problems = Vec::new();
    let mut library = ParadigmVideoLibrary {
        root_path: root.to_string_lossy().to_string(),
        depression: Vec::new(),
        anxiety: Vec::new(),
        calm: Vec::new(),
        fear: Vec::new(),
        happy: Vec::new(),
        valid: false,
        problems: Vec::new(),
    };

    for emotion in PARADIGM_EMOTIONS {
        // Only classes in some acquisition schedule are validated (R8: Happy
        // retired - its directory is typically gone and an empty/missing
        // legacy pool must not fail the library). A leftover Happy directory
        // is still scanned so old libraries keep reporting their contents.
        let required = is_scheduled_emotion(emotion);
        let Some(directory) = find_emotion_subdirectory(&root, emotion)? else {
            if required {
                problems.push(format!(
                    "Missing video subdirectory: {}.",
                    emotion.display_name()
                ));
            }
            continue;
        };
        let entries = collect_mp4_entries(&directory, emotion)?;
        if required && entries.len() < MIN_VIDEOS_PER_CLASS {
            problems.push(format!(
                "{} requires at least {MIN_VIDEOS_PER_CLASS} MP4 files (found {}).",
                emotion.display_name(),
                entries.len()
            ));
        }
        match emotion {
            ParadigmEmotion::Depression => library.depression = entries,
            ParadigmEmotion::Anxiety => library.anxiety = entries,
            ParadigmEmotion::Calm => library.calm = entries,
            ParadigmEmotion::Fear => library.fear = entries,
            ParadigmEmotion::Happy => library.happy = entries,
        }
    }

    library.valid = problems.is_empty();
    library.problems = problems;
    Ok(library)
}

/// Scans the library and derives the deterministic trial queue for a run.
pub fn build_paradigm_queue_from_root(
    root_path: &str,
    session_run_id: &str,
    session_kind: ParadigmSessionKind,
) -> Result<Vec<ParadigmTrialPlanItem>, String> {
    let library = cached_paradigm_library(root_path)?;
    build_paradigm_queue(&library, session_run_id, session_kind)
}

fn cached_paradigm_library(root_path: &str) -> Result<Arc<ParadigmVideoLibrary>, String> {
    let root = PathBuf::from(root_path.trim());
    if let Some(library) = cached_queue_library(&root) {
        return Ok(library);
    }

    let library = Arc::new(load_paradigm_video_library(root_path)?);
    // Only valid scans are cached: an invalid library must re-check the
    // directories on the next call so fixing the folder takes effect at once.
    if library.valid {
        if let Ok(mut cache) = PARADIGM_LIBRARY_CACHE.lock() {
            let entries = cache.get_or_insert_with(HashMap::new);
            let now = Instant::now();

            entries.retain(|_, (cached_at, _)| {
                now.duration_since(*cached_at) < PARADIGM_LIBRARY_CACHE_TTL
            });
            entries.insert(root, (now, Arc::clone(&library)));
        }
    }

    Ok(library)
}

fn cached_queue_library(root: &Path) -> Option<Arc<ParadigmVideoLibrary>> {
    let cache = PARADIGM_LIBRARY_CACHE.lock().ok()?;
    let entries = cache.as_ref()?;
    let (cached_at, library) = entries.get(root)?;

    (cached_at.elapsed() < PARADIGM_LIBRARY_CACHE_TTL).then(|| Arc::clone(library))
}

pub fn build_paradigm_queue(
    library: &ParadigmVideoLibrary,
    session_run_id: &str,
    session_kind: ParadigmSessionKind,
) -> Result<Vec<ParadigmTrialPlanItem>, String> {
    if !library.valid {
        return Err(library.problems.join("; "));
    }

    let mut rng = SplitMix64::new(fnv1a(session_run_id.as_bytes()));

    // Blocked schedule driven by the session kind: personal calibration
    // collects only the calm baseline block; the held-out generation run
    // induces anxiety, depression, and fear (R8, 大纲 6.1; happy retired).
    // Each block shuffles its class
    // pool with the run-seeded rng and plays its five videos back to back;
    // distinct run ids vary the videos inside a block but never the order or
    // composition of the blocks.
    let mut selected: Vec<(ParadigmEmotion, ParadigmVideoEntry)> = Vec::new();
    for emotion in blocks_for_session_kind(session_kind) {
        let mut entries = library.entries_for(*emotion).to_vec();
        shuffle(&mut entries, &mut rng);
        selected.extend(
            entries
                .into_iter()
                .take(TRIALS_PER_CLASS)
                .map(|entry| (*emotion, entry)),
        );
    }

    Ok(selected
        .into_iter()
        .enumerate()
        .map(|(index, (emotion, entry))| ParadigmTrialPlanItem {
            trial_index: index as u32,
            emotion,
            trigger_class: emotion.trigger_code(),
            video_id: entry.video_id,
            video_path: entry.absolute_path,
        })
        .collect())
}

fn find_emotion_subdirectory(
    root: &Path,
    emotion: ParadigmEmotion,
) -> Result<Option<PathBuf>, String> {
    let entries = fs::read_dir(root)
        .map_err(|_| "Failed to read video root directory.".to_string())?;
    let expected = emotion.display_name().to_lowercase();

    for entry in entries {
        let entry = entry
            .map_err(|_| "Failed to read video root directory.".to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name == expected {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

fn collect_mp4_entries(directory: &Path, emotion: ParadigmEmotion) -> Result<Vec<ParadigmVideoEntry>, String> {
    let entries = fs::read_dir(directory).map_err(|_| {
        format!("Failed to read video subdirectory: {}.", emotion.display_name())
    })?;

    let mut videos = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| {
            format!("Failed to read video subdirectory: {}.", emotion.display_name())
        })?;
        let path = entry.path();
        let is_mp4 = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(VIDEO_EXTENSION));
        if !path.is_file() || !is_mp4 {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        videos.push(ParadigmVideoEntry {
            video_id: Path::new(&file_name)
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or(file_name.clone()),
            absolute_path: path.to_string_lossy().to_string(),
            file_name,
        });
    }

    videos.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(videos)
}

/// FNV-1a 64-bit hash; seeds the queue shuffler from the session run id.
fn fnv1a(data: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET_BASIS;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// Minimal deterministic PRNG (no external dependencies).
struct SplitMix64(u64);

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn next_below(&mut self, bound: usize) -> usize {
        (self.next() % bound as u64) as usize
    }
}

/// Descending Fisher-Yates shuffle driven by one shared rng.
fn shuffle<T>(items: &mut [T], rng: &mut SplitMix64) {
    for index in (1..items.len()).rev() {
        let target = rng.next_below(index + 1);
        items.swap(index, target);
    }
}

#[cfg(test)]
mod tests {
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

        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("load library");

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
    fn library_scan_rejects_missing_root_and_reports_problems() {
        assert_eq!(
            load_paradigm_video_library("Z:/definitely-missing").unwrap_err(),
            "Video root directory does not exist."
        );

        let root = temp_library_root("problems");
        seed_library(&root, 6);
        fs::remove_dir_all(root.join("Calm")).expect("remove calm dir");
        for index in 0..2 {
            fs::remove_file(root.join("Anxiety").join(format!("anxiety_vid0{index}.mp4")))
                .expect("remove mp4");
        }

        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("load library");

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
        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("load library");

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
                let count = first
                    .iter()
                    .filter(|item| item.emotion == *emotion)
                    .count();
                assert_eq!(count, TRIALS_PER_CLASS, "{emotion:?} trial count for {kind:?}");
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
        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("load library");

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
                    let block = &queue[block_index * TRIALS_PER_CLASS..(block_index + 1) * TRIALS_PER_CLASS];
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

        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("load library");
        assert!(library.valid);
        assert_eq!(library.depression.len(), MIN_VIDEOS_PER_CLASS);

        let kind = ParadigmSessionKind::HeldOutGeneration;
        let first = build_paradigm_queue(&library, "imb-run-1", kind).expect("queue");
        let second = build_paradigm_queue(&library, "imb-run-1", kind).expect("queue");
        assert_eq!(first, second);
        assert_eq!(first.len(), blocks_for_session_kind(kind).len() * TRIALS_PER_CLASS);
        for emotion in blocks_for_session_kind(kind) {
            let count = first
                .iter()
                .filter(|item| item.emotion == *emotion)
                .count();
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
    fn retired_happy_pool_is_never_required_but_fear_is() {
        // R8 shape: the on-disk library has no Happy directory at all (assets
        // were repurposed into Fear) - validation must stay green.
        let root = temp_library_root("fear-pool");
        for emotion in PARADIGM_EMOTIONS {
            if emotion == ParadigmEmotion::Happy {
                continue;
            }
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

        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("load library");
        assert!(library.valid);
        assert!(library.problems.is_empty());
        assert_eq!(library.fear.len(), MIN_VIDEOS_PER_CLASS);
        assert_eq!(
            library.fear[0].video_id, "fear_vid00",
            "fear entries come from the Fear directory"
        );
        assert!(library.happy.is_empty(), "no Happy directory -> empty legacy pool");

        // An empty-but-present Happy directory is equally tolerated.
        fs::create_dir_all(root.join("Happy")).expect("create empty happy dir");
        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("reload library");
        assert!(library.valid);
        assert!(library.happy.is_empty());

        // A missing Fear directory is a hard problem: fear is scheduled.
        fs::remove_dir_all(root.join("Fear")).expect("remove fear dir");
        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("reload library");
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
        let library = load_paradigm_video_library(root.to_str().expect("utf8 path"))
            .expect("load library");

        let queue =
            build_paradigm_queue(&library, "fear-run-1", ParadigmSessionKind::HeldOutGeneration)
                .expect("queue");
        let fear_trials: Vec<_> = queue
            .iter()
            .filter(|item| item.emotion == ParadigmEmotion::Fear)
            .collect();
        assert_eq!(fear_trials.len(), TRIALS_PER_CLASS);
        assert!(fear_trials.iter().all(|item| item.trigger_class == 5));
        assert!(
            queue
                .iter()
                .all(|item| item.emotion != ParadigmEmotion::Happy),
            "happy never appears in an R8 queue"
        );

        let _ = fs::remove_dir_all(root);
    }
}
