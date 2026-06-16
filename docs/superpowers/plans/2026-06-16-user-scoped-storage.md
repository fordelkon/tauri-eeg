# User-Scoped Storage Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store EEG recordings and generated WAV files under a user-named folder, while allowing the operator to choose the storage root path.

**Architecture:** Add a shared storage settings module in the Tauri backend that resolves default roots, persists optional custom roots, validates paths, and always appends a sanitized username folder. Frontend pages expose the resolved path and optional path selection, then pass `userId` and `username` into EEG/music commands.

**Tech Stack:** React 18, TypeScript, Tauri v2 commands, Rust, rusqlite, Vitest, Rust unit tests.

---

## Current State

EEG:
- `src/eeg/EegSessionContext.tsx` passes both `currentUser.id` and `currentUser.username`.
- `src-tauri/src/eeg/storage.rs` validates the username but currently creates the directory with `safe_user_dir_segment(&user_id.user_id)`.
- Default root is resolved in `src-tauri/src/eeg/mod.rs` as `app_data_dir()/eeg-recordings`.
- Current shape is: `<app-data>/eeg-recordings/<userId>/session_YYYYMMDD_HHMMSS/...`.

Music:
- `src/pages/home/MusicRegulation.tsx` passes only `currentUser.id` to `generateMusic`.
- `src-tauri/src/lib.rs` resolves music output as `app_data_dir()/music`.
- The Python service writes WAV files directly into that single music folder.
- Current shape is: `<app-data>/music/<job-output>.wav`, with user separation only in `music_history.user_id`.

Target shape:
- EEG default: `<app-data>/eeg-recordings/<safe-username>/session_YYYYMMDD_HHMMSS/...`
- Music default: `<app-data>/music/<safe-username>/<job-output>.wav`
- Custom root example:
  - User selects `D:\ExperimentData`.
  - EEG writes to `D:\ExperimentData\eeg-recordings\<safe-username>\session_...`.
  - Music writes to `D:\ExperimentData\music\<safe-username>\...wav`.

## File Structure

- Modify `src-tauri/src/lib.rs`: add commands for storage settings, extend music generation input, and use user-scoped music directories.
- Modify `src-tauri/src/eeg/mod.rs`: resolve the EEG base root through storage settings instead of hardcoded app data only.
- Modify `src-tauri/src/eeg/storage.rs`: create the per-user folder from sanitized username, not user id.
- Create `src-tauri/src/storage_paths.rs`: shared path resolution, username sanitization, root settings persistence, and deletion boundary checks.
- Modify `src-tauri/capabilities/default.json`: add dialog permissions if using Tauri's dialog plugin, or skip this if the frontend passes typed paths.
- Modify `package.json` and `src-tauri/Cargo.toml`: add Tauri dialog plugin only if choosing native directory picker.
- Modify `src/music/musicGenerationApi.ts`: include `username` and storage settings APIs.
- Modify `src/eeg/types.ts`: add optional storage root to EEG recording request only if the design passes root per command; otherwise keep settings backend-owned.
- Modify `src/eeg/EegSessionContext.tsx`: no behavioral change except consuming backend-owned settings if exposed in UI.
- Modify `src/pages/home/EegAcquisition.tsx`: show active EEG path and provide storage root controls.
- Modify `src/pages/home/MusicRegulation.tsx`: pass username to music generation and show active music path/root controls.
- Add/modify tests in `src-tauri/src/storage_paths.rs`, `src-tauri/src/eeg/storage.rs`, `src-tauri/src/lib.rs`, `src/eeg/eegSessionState.test.ts`, and `src/music/musicGenerationApi.test.ts`.

## Design Decisions

- Use `username` for the visible folder name because that matches the user's requirement and is easier to inspect manually.
- Sanitize usernames before path creation. Keep the database identity as `userId`; only the directory label uses username.
- Always append username on the backend. The frontend must never send a full final user folder path as trusted truth.
- Persist one optional root for all experiment outputs first. Under it, keep fixed subfolders `eeg-recordings` and `music`.
- Store configured root in app data as JSON, not in a per-user row, unless later requirements need different roots per user.
- Keep old database records readable. New recordings use the new folder layout; existing paths in DB continue to point to old files.

## Task 1: Shared Storage Path Resolver

**Files:**
- Create: `src-tauri/src/storage_paths.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write Rust tests for username folder sanitization**

Add tests inside `src-tauri/src/storage_paths.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_username_keeps_human_readable_ascii_names() {
        assert_eq!(safe_username_dir_segment("alice").unwrap(), "alice");
        assert_eq!(safe_username_dir_segment("alice_01").unwrap(), "alice_01");
    }

    #[test]
    fn safe_username_replaces_path_separators_and_spaces() {
        assert_eq!(safe_username_dir_segment("Alice Smith").unwrap(), "Alice_Smith");
        assert_eq!(safe_username_dir_segment("../alice").unwrap(), "alice");
        assert_eq!(safe_username_dir_segment("a\\b/c").unwrap(), "a_b_c");
    }

    #[test]
    fn safe_username_rejects_empty_names_after_sanitization() {
        assert_eq!(
            safe_username_dir_segment("///").unwrap_err(),
            "Username cannot be used as a folder name."
        );
    }
}
```

- [ ] **Step 2: Run the test and verify it fails before implementation**

Run:

```bash
cargo test storage_paths --manifest-path src-tauri/Cargo.toml
```

Expected: fail because `storage_paths` does not exist yet.

- [ ] **Step 3: Implement the resolver module**

Create `src-tauri/src/storage_paths.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageSettings {
    pub custom_root: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocation {
    pub root: String,
    pub eeg_root: String,
    pub music_root: String,
}

pub fn safe_username_dir_segment(username: &str) -> Result<String, String> {
    let mut value = String::new();

    for ch in username.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            value.push(ch);
        } else if ch.is_whitespace() || ch == '.' || ch == '/' || ch == '\\' {
            if !value.ends_with('_') {
                value.push('_');
            }
        }
    }

    let value = value.trim_matches('_').to_string();
    if value.is_empty() {
        return Err("Username cannot be used as a folder name.".to_string());
    }

    Ok(value)
}

pub fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve app data directory.".to_string())?
        .join("storage-settings.json"))
}

pub fn load_storage_settings(app: &tauri::AppHandle) -> Result<StorageSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(StorageSettings::default());
    }

    let text = fs::read_to_string(path).map_err(|_| "Failed to read storage settings.".to_string())?;
    serde_json::from_str(&text).map_err(|_| "Storage settings are invalid.".to_string())
}

pub fn save_storage_settings(
    app: &tauri::AppHandle,
    settings: StorageSettings,
) -> Result<StorageLocation, String> {
    if let Some(root) = settings.custom_root.as_deref() {
        validate_custom_root(root)?;
    }

    let path = settings_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Failed to resolve storage settings directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "Failed to create storage settings directory.".to_string())?;

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|_| "Failed to serialize storage settings.".to_string())?;
    fs::write(path, json).map_err(|_| "Failed to save storage settings.".to_string())?;

    storage_location(app)
}

pub fn storage_location(app: &tauri::AppHandle) -> Result<StorageLocation, String> {
    let root = storage_root(app)?;
    Ok(StorageLocation {
        eeg_root: root.join("eeg-recordings").to_string_lossy().to_string(),
        music_root: root.join("music").to_string_lossy().to_string(),
        root: root.to_string_lossy().to_string(),
    })
}

pub fn storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let settings = load_storage_settings(app)?;
    if let Some(root) = settings.custom_root {
        validate_custom_root(&root)?;
        return Ok(PathBuf::from(root));
    }

    app.path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve app data directory.".to_string())
}

pub fn eeg_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(storage_root(app)?.join("eeg-recordings"))
}

pub fn music_user_dir(app: &tauri::AppHandle, username: &str) -> Result<PathBuf, String> {
    let dir = storage_root(app)?
        .join("music")
        .join(safe_username_dir_segment(username)?);
    fs::create_dir_all(&dir).map_err(|_| "Failed to create user music directory.".to_string())?;
    Ok(dir)
}

pub fn validate_custom_root(root: &str) -> Result<(), String> {
    let root = root.trim();
    if root.is_empty() {
        return Err("Storage path is required.".to_string());
    }

    let path = Path::new(root);
    if !path.is_absolute() {
        return Err("Storage path must be absolute.".to_string());
    }

    if path.components().any(|component| matches!(component, Component::ParentDir)) {
        return Err("Storage path cannot contain parent directory segments.".to_string());
    }

    Ok(())
}
```

- [ ] **Step 4: Register the module**

In `src-tauri/src/lib.rs`, add:

```rust
mod storage_paths;
```

- [ ] **Step 5: Run tests**

Run:

```bash
cargo test storage_paths --manifest-path src-tauri/Cargo.toml
```

Expected: pass.

## Task 2: EEG Uses Username Folder

**Files:**
- Modify: `src-tauri/src/eeg/storage.rs`
- Modify: `src-tauri/src/eeg/mod.rs`

- [ ] **Step 1: Update EEG storage test expectation**

In `src-tauri/src/eeg/storage.rs`, update `writes_sample_major_binaries_metadata_and_user_bound_row` with:

```rust
assert!(Path::new(&session.session_dir).ends_with(Path::new("alice").join(&session.id)));
```

- [ ] **Step 2: Run the EEG storage test and verify it fails**

Run:

```bash
cargo test writes_sample_major_binaries_metadata_and_user_bound_row --manifest-path src-tauri/Cargo.toml
```

Expected: fail because the current folder is `user-1`.

- [ ] **Step 3: Replace user id folder logic**

In `src-tauri/src/eeg/storage.rs`, replace:

```rust
let user_dir = safe_user_dir_segment(&user_id.user_id)?;
```

with:

```rust
let user_dir = crate::storage_paths::safe_username_dir_segment(&user_id.username)?;
```

Then delete the local `safe_user_dir_segment` function if it is unused.

- [ ] **Step 4: Route EEG root through shared settings**

In `src-tauri/src/eeg/mod.rs`, replace:

```rust
let base_dir = app
    .path()
    .app_data_dir()
    .map_err(|_| "Failed to resolve app data directory.".to_string())?
    .join("eeg-recordings");
```

with:

```rust
let base_dir = crate::storage_paths::eeg_root(app)?;
```

- [ ] **Step 5: Run EEG tests**

Run:

```bash
cargo test eeg --manifest-path src-tauri/Cargo.toml
```

Expected: pass.

## Task 3: Music Uses Username Folder

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/music/musicGenerationApi.ts`
- Modify: `src/pages/home/MusicRegulation.tsx`
- Modify: `src/music/musicGenerationApi.test.ts`

- [ ] **Step 1: Add username to frontend music input test**

In `src/music/musicGenerationApi.test.ts`, add:

```ts
import { generateMusic } from './musicGenerationApi';

it('generates music with user identity for user-scoped folders', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    createdAt: '2026-06-16T00:00:00Z',
    durationSeconds: 30,
    filePath: 'D:/ExperimentData/music/alice/gen_job.wav',
    id: 'job-1',
    modelVersion: 'stable-audio-3-small-music',
    prompt: 'calm piano',
    userId: 'user-1',
  });

  await generateMusic({
    duration: 30,
    prompt: 'calm piano',
    userId: 'user-1',
    username: 'alice',
  });

  expect(invoke).toHaveBeenCalledWith('generate_music', {
    input: {
      duration: 30,
      prompt: 'calm piano',
      userId: 'user-1',
      username: 'alice',
    },
  });
});
```

- [ ] **Step 2: Run frontend test and verify it fails**

Run:

```bash
npm test -- src/music/musicGenerationApi.test.ts
```

Expected: fail because `GenerateMusicInput` does not include `username`.

- [ ] **Step 3: Extend frontend API type**

In `src/music/musicGenerationApi.ts`, change:

```ts
export type GenerateMusicInput = {
  duration: number;
  prompt: string;
  userId: string;
};
```

to:

```ts
export type GenerateMusicInput = {
  duration: number;
  prompt: string;
  userId: string;
  username: string;
};
```

- [ ] **Step 4: Pass username from MusicRegulation**

In `src/pages/home/MusicRegulation.tsx`, replace:

```ts
const item = await generateMusic({
  duration: generationDuration,
  prompt: generatedPrompt,
  userId: currentUser.id,
});
```

with:

```ts
const item = await generateMusic({
  duration: generationDuration,
  prompt: generatedPrompt,
  userId: currentUser.id,
  username: currentUser.username,
});
```

- [ ] **Step 5: Extend Rust music input**

In `src-tauri/src/lib.rs`, change:

```rust
struct MusicGenerationInput {
    user_id: String,
    prompt: String,
    duration: u32,
}
```

to:

```rust
struct MusicGenerationInput {
    user_id: String,
    username: String,
    prompt: String,
    duration: u32,
}
```

- [ ] **Step 6: Use user music directory**

In `generate_music`, replace:

```rust
let output_dir = music_output_dir(&app)?;
```

with:

```rust
let output_dir = storage_paths::music_user_dir(&app, &input.username)?;
```

- [ ] **Step 7: Update deletion boundary**

Change `delete_music_history` to load the deleted item first, then validate deletion under the configured music root rather than a single output directory. Use this helper:

```rust
fn delete_music_file_in_music_root(
    music_root: &std::path::Path,
    file_path: &str,
) -> Result<(), String> {
    let music_root = music_root
        .canonicalize()
        .map_err(|_| "Failed to resolve music output directory.".to_string())?;
    let file_path = std::path::PathBuf::from(file_path);

    if !file_path.exists() {
        return Ok(());
    }

    let file_path = file_path
        .canonicalize()
        .map_err(|_| "Failed to resolve music file path.".to_string())?;

    if !file_path.starts_with(&music_root) {
        return Err("Refusing to delete a file outside the music output directory.".to_string());
    }

    if file_path.extension().and_then(|value| value.to_str()) != Some("wav") {
        return Err("Refusing to delete a non-WAV music file.".to_string());
    }

    std::fs::remove_file(&file_path).map_err(|_| "Failed to delete music file.".to_string())
}
```

Then call it with:

```rust
let music_root = storage_paths::storage_root(&app)?.join("music");
delete_music_file_in_music_root(&music_root, &deleted.file_path)?;
```

- [ ] **Step 8: Run tests**

Run:

```bash
npm test -- src/music/musicGenerationApi.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: pass.

## Task 4: Storage Settings Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/music/musicGenerationApi.ts` or create `src/storage/storageApi.ts`

- [ ] **Step 1: Add Rust commands**

In `src-tauri/src/lib.rs`, add:

```rust
#[tauri::command]
fn get_storage_location(app: tauri::AppHandle) -> Result<storage_paths::StorageLocation, String> {
    storage_paths::storage_location(&app)
}

#[tauri::command]
fn set_storage_root(
    app: tauri::AppHandle,
    custom_root: Option<String>,
) -> Result<storage_paths::StorageLocation, String> {
    storage_paths::save_storage_settings(
        &app,
        storage_paths::StorageSettings {
            custom_root: custom_root.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()),
        },
    )
}
```

Register both in `tauri::generate_handler!`.

- [ ] **Step 2: Add frontend API**

Create `src/storage/storageApi.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export type StorageLocation = {
  root: string;
  eegRoot: string;
  musicRoot: string;
};

export function getStorageLocation() {
  return invoke<StorageLocation>('get_storage_location');
}

export function setStorageRoot(customRoot: string | null) {
  return invoke<StorageLocation>('set_storage_root', { customRoot });
}
```

- [ ] **Step 3: Add tests for frontend API**

Create `src/storage/storageApi.test.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import { getStorageLocation, setStorageRoot } from './storageApi';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('storageApi', () => {
  it('loads resolved storage location', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      root: 'D:/ExperimentData',
      eegRoot: 'D:/ExperimentData/eeg-recordings',
      musicRoot: 'D:/ExperimentData/music',
    });

    await expect(getStorageLocation()).resolves.toMatchObject({
      root: 'D:/ExperimentData',
    });
    expect(invoke).toHaveBeenCalledWith('get_storage_location');
  });

  it('sets custom storage root', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      root: 'D:/ExperimentData',
      eegRoot: 'D:/ExperimentData/eeg-recordings',
      musicRoot: 'D:/ExperimentData/music',
    });

    await setStorageRoot('D:/ExperimentData');

    expect(invoke).toHaveBeenCalledWith('set_storage_root', {
      customRoot: 'D:/ExperimentData',
    });
  });
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/storage/storageApi.test.ts
cargo test storage_paths --manifest-path src-tauri/Cargo.toml
```

Expected: pass.

## Task 5: UI Controls on EEG and Music Pages

**Files:**
- Modify: `src/pages/home/EegAcquisition.tsx`
- Modify: `src/pages/home/MusicRegulation.tsx`
- Modify: corresponding CSS modules if necessary

- [ ] **Step 1: Add a compact storage control**

Use the same pattern on both pages:

```tsx
const [storageLocation, setStorageLocationState] = useState<StorageLocation | null>(null);
const [storageInput, setStorageInput] = useState('');
const [storageError, setStorageError] = useState<string | null>(null);

useEffect(() => {
  let isMounted = true;
  getStorageLocation()
    .then((location) => {
      if (isMounted) {
        setStorageLocationState(location);
        setStorageInput(location.root);
      }
    })
    .catch((reason: unknown) => {
      if (isMounted) {
        setStorageError(reason instanceof Error ? reason.message : String(reason));
      }
    });

  return () => {
    isMounted = false;
  };
}, []);
```

- [ ] **Step 2: Add save/reset handlers**

```tsx
const handleSaveStorageRoot = async () => {
  setStorageError(null);
  try {
    const location = await setStorageRoot(storageInput);
    setStorageLocationState(location);
    setStorageInput(location.root);
  } catch (reason) {
    setStorageError(reason instanceof Error ? reason.message : String(reason));
  }
};

const handleResetStorageRoot = async () => {
  setStorageError(null);
  try {
    const location = await setStorageRoot(null);
    setStorageLocationState(location);
    setStorageInput(location.root);
  } catch (reason) {
    setStorageError(reason instanceof Error ? reason.message : String(reason));
  }
};
```

- [ ] **Step 3: Render path state without blocking current workflows**

Add a compact field near each page's controls:

```tsx
<div className={styles.storagePanel}>
  <label>
    <span>Storage root</span>
    <input
      value={storageInput}
      onChange={(event) => setStorageInput(event.currentTarget.value)}
      placeholder="D:\ExperimentData"
    />
  </label>
  <button type="button" onClick={() => void handleSaveStorageRoot()}>
    Save
  </button>
  <button type="button" onClick={() => void handleResetStorageRoot()}>
    Default
  </button>
  <span>{storageLocation?.eegRoot ?? storageLocation?.musicRoot}</span>
  {storageError ? <strong>{storageError}</strong> : null}
</div>
```

For EEG display `storageLocation?.eegRoot`; for music display `storageLocation?.musicRoot`.

- [ ] **Step 4: Run UI tests/build**

Run:

```bash
npm test
npm run build
```

Expected: pass.

## Optional Task 6: Native Directory Picker

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: storage UI files

- [ ] **Step 1: Add Tauri dialog plugin**

Install:

```bash
npm install @tauri-apps/plugin-dialog
cargo add tauri-plugin-dialog --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Register plugin**

In `src-tauri/src/lib.rs`, add:

```rust
.plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 3: Add permissions**

In `src-tauri/capabilities/default.json`, add the dialog permission required by the generated schema, typically:

```json
"dialog:default"
```

- [ ] **Step 4: Add browse button**

In frontend storage control:

```tsx
import { open } from '@tauri-apps/plugin-dialog';

const handleBrowseStorageRoot = async () => {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Choose storage root',
  });

  if (typeof selected === 'string') {
    setStorageInput(selected);
  }
};
```

## Verification

- Run all frontend tests:

```bash
npm test
```

- Run TypeScript and Vite build:

```bash
npm run build
```

- Run Rust tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

- Manual verification:
  - Login as `alice`.
  - Set storage root to `D:\ExperimentData`.
  - Start EEG recording, stop it, and verify files are under `D:\ExperimentData\eeg-recordings\alice\session_*`.
  - Generate music and verify WAV is under `D:\ExperimentData\music\alice`.
  - Login as another user and verify that user's EEG/music files go under a different username folder.

## Risks

- Existing EEG folders named by `userId` will not be moved automatically. Keep old DB paths readable.
- Username changes are not currently modeled. If username rename is added later, decide whether old folders stay unchanged or are migrated.
- Unicode usernames need a product decision. This plan uses ASCII-safe folder names for predictable cross-platform behavior.
- Native directory picker needs an extra Tauri plugin and permissions. Text input is simpler; picker is better UX.

