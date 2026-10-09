use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use super::domain::{
    blocks_for_session_kind, is_scheduled_emotion, ParadigmEmotion, ParadigmSessionKind,
    ParadigmTrialPlanItem, ParadigmVideoEntry, ParadigmVideoLibrary, PARADIGM_EMOTIONS,
};

/// Minimum pool size per scheduled class. Outline S-04 ultimately requires 50
/// clips per class; 5 is the current implementation threshold.
const MIN_VIDEOS_PER_CLASS: usize = 5;
/// S-04 acceptance target for each contract-required negative emotion pool.
const CONTRACT_VIDEOS_PER_REQUIRED_EMOTION: usize = 50;
const TRIALS_PER_CLASS: usize = 5;
const VIDEO_EXTENSION: &str = "mp4";

const PARADIGM_LIBRARY_CACHE_TTL: Duration = Duration::from_secs(30);

// Scanning the library walks the whole directory tree, and the frontend runs
// the queue build debounced per keystroke plus once more at session start, so
// the last scan per root is reused briefly (same TTL pattern as
// video_library.rs; a 30 s staleness window is acceptable for queue building).
/// Last library scan per root, reused briefly (same TTL pattern as
/// video_library.rs; a 30 s staleness window is acceptable for queue building).
type ParadigmLibraryCache = Mutex<Option<HashMap<PathBuf, (Instant, Arc<ParadigmVideoLibrary>)>>>;
static PARADIGM_LIBRARY_CACHE: ParadigmLibraryCache = Mutex::new(None);

pub fn load_paradigm_video_library(root_path: &str) -> Result<ParadigmVideoLibrary, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() || !Path::new(trimmed).is_dir() {
        return Err("Video root directory does not exist.".to_string());
    }
    let root = PathBuf::from(trimmed);

    let mut problems = Vec::new();
    let mut readiness_warnings = Vec::new();
    let mut library = ParadigmVideoLibrary {
        root_path: root.to_string_lossy().to_string(),
        depression: Vec::new(),
        anxiety: Vec::new(),
        calm: Vec::new(),
        fear: Vec::new(),
        valid: false,
        problems: Vec::new(),
        readiness_warnings: Vec::new(),
    };

    for emotion in PARADIGM_EMOTIONS {
        // Only classes in the current experiment schedule are validated.
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
        if matches!(
            emotion,
            ParadigmEmotion::Anxiety | ParadigmEmotion::Depression | ParadigmEmotion::Fear
        ) && entries.len() < CONTRACT_VIDEOS_PER_REQUIRED_EMOTION
        {
            readiness_warnings.push(format!(
                "{} currently has {} MP4 files; S-04 acceptance requires at least {CONTRACT_VIDEOS_PER_REQUIRED_EMOTION} induction clips.",
                emotion.display_name(),
                entries.len()
            ));
        }
        match emotion {
            ParadigmEmotion::Depression => library.depression = entries,
            ParadigmEmotion::Anxiety => library.anxiety = entries,
            ParadigmEmotion::Calm => library.calm = entries,
            ParadigmEmotion::Fear => library.fear = entries,
        }
    }

    library.valid = problems.is_empty();
    library.problems = problems;
    library.readiness_warnings = readiness_warnings;
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
    // induces anxiety, depression, and fear in fixed blocks.
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
    let entries =
        fs::read_dir(root).map_err(|_| "Failed to read video root directory.".to_string())?;
    let expected = emotion.display_name().to_lowercase();

    for entry in entries {
        let entry = entry.map_err(|_| "Failed to read video root directory.".to_string())?;
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

fn collect_mp4_entries(
    directory: &Path,
    emotion: ParadigmEmotion,
) -> Result<Vec<ParadigmVideoEntry>, String> {
    let mut videos = Vec::new();
    collect_mp4_entries_recursively(directory, directory, emotion, &mut videos, 0)?;
    videos.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(videos)
}

/// Accept an emotion folder's nested material categories as one stable pool.
/// `file_name` and `video_id` use slash-delimited paths relative to that
/// emotion root, which preserves direct-file ids and prevents nested-name
/// collisions from making trial or playback records ambiguous.
/// Deepest directory nesting the scanner follows. Real emotion/class folders
/// nest one or two levels; the cap only exists so a junction loop in a
/// user-selected root cannot recurse until the stack overflows.
const MAX_LIBRARY_SCAN_DEPTH: usize = 8;

fn collect_mp4_entries_recursively(
    root: &Path,
    directory: &Path,
    emotion: ParadigmEmotion,
    videos: &mut Vec<ParadigmVideoEntry>,
    depth: usize,
) -> Result<(), String> {
    let entries = fs::read_dir(directory).map_err(|_| {
        format!(
            "Failed to read video subdirectory: {}.",
            emotion.display_name()
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|_| {
            format!(
                "Failed to read video subdirectory: {}.",
                emotion.display_name()
            )
        })?;
        let path = entry.path();
        if path.is_dir() {
            // Do not follow symlinks/junctions: a self-referencing link in a
            // user-selected root would otherwise loop regardless of the cap.
            let is_real_dir = path
                .symlink_metadata()
                .map(|meta| meta.is_dir())
                .unwrap_or(false);
            if !is_real_dir {
                continue;
            }
            if depth >= MAX_LIBRARY_SCAN_DEPTH {
                return Err(format!(
                    "Video library nesting exceeds {} levels: {}.",
                    MAX_LIBRARY_SCAN_DEPTH,
                    path.display()
                ));
            }
            collect_mp4_entries_recursively(root, &path, emotion, videos, depth + 1)?;
            continue;
        }
        let is_mp4 = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(VIDEO_EXTENSION));
        if !path.is_file() || !is_mp4 {
            continue;
        }
        let relative_path = path.strip_prefix(root).map_err(|_| {
            format!(
                "Failed to read video subdirectory: {}.",
                emotion.display_name()
            )
        })?;
        let file_name = relative_path.to_string_lossy().replace('\\', "/");
        let mut relative_id_path = relative_path.to_path_buf();
        relative_id_path.set_extension("");
        videos.push(ParadigmVideoEntry {
            video_id: relative_id_path.to_string_lossy().replace('\\', "/"),
            absolute_path: path.to_string_lossy().to_string(),
            file_name,
        });
    }
    Ok(())
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
#[path = "video_tests.rs"]
mod tests;
