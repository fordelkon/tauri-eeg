use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoLibrary {
    pub assets: Vec<VideoAsset>,
    pub index_path: String,
    pub root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAsset {
    pub id: String,
    pub duration_label: String,
    pub has_water: bool,
    pub indexed_tags: Vec<String>,
    pub segment: VideoSegment,
    pub source_path: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSegment {
    pub atmosphere: String,
    pub color_tone: String,
    pub has_water: bool,
    pub scene: String,
    pub tags: Vec<String>,
    pub weather: String,
}

#[derive(Debug, Deserialize)]
struct LibrarySource {
    source: String,
    segments: Vec<LibrarySegment>,
}

#[derive(Debug, Deserialize)]
struct LibrarySegment {
    atmosphere: String,
    #[serde(default, rename = "color_tone")]
    color_tone: String,
    file: String,
    #[serde(default)]
    has_water: bool,
    scene: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    weather: String,
}

pub fn load_video_library(folder_path: &str) -> Result<VideoLibrary, String> {
    let root = PathBuf::from(folder_path.trim());
    if folder_path.trim().is_empty() || !root.is_dir() {
        return Err("请选择一个有效的视频库文件夹。".to_string());
    }

    let mp4_files = collect_mp4_files(&root)?;
    if mp4_files.is_empty() {
        return Err("视频库文件夹中没有 mp4 文件。".to_string());
    }

    let index_path = find_index_path(&root)?;
    let text = fs::read_to_string(&index_path).map_err(|_| "无法读取视频库 JSON 索引。".to_string())?;
    let index: std::collections::BTreeMap<String, LibrarySource> =
        serde_json::from_str(&text).map_err(|_| "视频库 JSON 索引格式无效。".to_string())?;

    let mut assets = Vec::new();
    for source in index.values() {
        for segment in &source.segments {
            if !mp4_files.contains(&segment.file.to_lowercase()) {
                return Err(format!("JSON 索引引用的视频不存在：{}", segment.file));
            }

            assets.push(to_video_asset(&root, &source.source, segment));
        }
    }

    if assets.is_empty() {
        return Err("视频库 JSON 索引中没有视频片段。".to_string());
    }

    Ok(VideoLibrary {
        assets,
        index_path: index_path.to_string_lossy().to_string(),
        root: root.to_string_lossy().to_string(),
    })
}

fn collect_mp4_files(root: &Path) -> Result<HashSet<String>, String> {
    let entries = fs::read_dir(root).map_err(|_| "无法读取视频库文件夹。".to_string())?;
    let mut files = HashSet::new();

    for entry in entries {
        let entry = entry.map_err(|_| "无法读取视频库文件夹。".to_string())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()).map(str::to_lowercase) == Some("mp4".to_string()) {
            if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
                files.insert(name.to_lowercase());
            }
        }
    }

    Ok(files)
}

fn find_index_path(root: &Path) -> Result<PathBuf, String> {
    let preferred = root.join("video_library_tags.json");
    if preferred.is_file() {
        return Ok(preferred);
    }

    let json_files: Vec<PathBuf> = fs::read_dir(root)
        .map_err(|_| "无法读取视频库文件夹。".to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()).map(str::to_lowercase) == Some("json".to_string()))
        .collect();

    match json_files.as_slice() {
        [path] => Ok(path.clone()),
        [] => Err("视频库文件夹中缺少 JSON 索引文件。".to_string()),
        _ => Err("视频库文件夹中存在多个 JSON，请保留 video_library_tags.json 或仅保留一个索引。".to_string()),
    }
}

fn to_video_asset(root: &Path, source: &str, segment: &LibrarySegment) -> VideoAsset {
    let id = segment.file.trim_end_matches(".mp4").to_string();
    let mut indexed_tags = vec![
        segment.atmosphere.clone(),
        segment.color_tone.clone(),
        segment.file.clone(),
        segment.scene.clone(),
        source.to_string(),
        segment.weather.clone(),
    ];
    indexed_tags.extend(segment.tags.clone());
    indexed_tags.sort();
    indexed_tags.dedup();

    let source_path = root.join(&segment.file).to_string_lossy().to_string();
    let summary = format!(
        "{}，{}，{}，{}",
        segment.scene, segment.weather, segment.atmosphere, segment.color_tone
    );

    VideoAsset {
        duration_label: format!("{} / {}", source, id),
        has_water: segment.has_water,
        id,
        indexed_tags,
        segment: VideoSegment {
            atmosphere: segment.atmosphere.clone(),
            color_tone: segment.color_tone.clone(),
            has_water: segment.has_water,
            scene: segment.scene.clone(),
            tags: segment.tags.clone(),
            weather: segment.weather.clone(),
        },
        source_path,
        summary,
        tags: segment.tags.clone(),
        title: segment.scene.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::{self, File},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_video_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("tauri-eeg-video-{name}-{suffix}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write_valid_index(root: &Path, file: &str) {
        fs::write(
            root.join("video_library_tags.json"),
            format!(
                r#"{{
  "custom": {{
    "source": "custom.mp4",
    "segments": [
      {{
        "file": "{file}",
        "scene": "自定义场景",
        "weather": "自定义天气",
        "atmosphere": "自定义氛围",
        "color_tone": "自定义色调",
        "has_water": false,
        "tags": ["自定义标签"]
      }}
    ]
  }}
}}"#
            ),
        )
        .expect("write index");
    }

    #[test]
    fn loads_assets_from_a_valid_video_library_folder() {
        let root = temp_video_dir("valid");
        File::create(root.join("custom_seg000.mp4")).expect("create mp4");
        write_valid_index(&root, "custom_seg000.mp4");

        let library = load_video_library(root.to_str().expect("utf8 path")).expect("load library");

        assert_eq!(library.assets.len(), 1);
        assert_eq!(library.assets[0].title, "自定义场景");
        assert!(library.assets[0].source_path.ends_with("custom_seg000.mp4"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_folders_without_mp4_files() {
        let root = temp_video_dir("no-mp4");
        write_valid_index(&root, "missing.mp4");

        let error = load_video_library(root.to_str().expect("utf8 path")).expect_err("reject folder");

        assert_eq!(error, "视频库文件夹中没有 mp4 文件。");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_folders_without_json_index() {
        let root = temp_video_dir("no-json");
        File::create(root.join("custom_seg000.mp4")).expect("create mp4");

        let error = load_video_library(root.to_str().expect("utf8 path")).expect_err("reject folder");

        assert_eq!(error, "视频库文件夹中缺少 JSON 索引文件。");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_indexes_that_reference_missing_mp4_files() {
        let root = temp_video_dir("missing-indexed-mp4");
        File::create(root.join("other.mp4")).expect("create mp4");
        write_valid_index(&root, "missing.mp4");

        let error = load_video_library(root.to_str().expect("utf8 path")).expect_err("reject folder");

        assert_eq!(error, "JSON 索引引用的视频不存在：missing.mp4");

        let _ = fs::remove_dir_all(root);
    }
}
