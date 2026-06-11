# AI Music Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Stable Audio 3 Small Music as the default local AI music generation model for pure instrumental text prompts, including history management and compact player UI.

**Architecture:** Python FastAPI service runs Stable Audio 3 Small Music on GPU. Tauri backend manages generation jobs and history via SQLite. React provides compact player UI with generation panel and history drawer.

**Tech Stack:** Python (FastAPI, PyTorch, Stable Audio 3 inference libraries), Rust (Tauri, reqwest, rusqlite), TypeScript, React.

**Model decision:** Use only `stabilityai/stable-audio-3-small-music` for this implementation. Do not add multi-model selection, fallback models, lyrics models, or preview models in V1; they would complicate the implementation without serving the current pure-instrumental requirement.

---

## Task 1: Python Generation Service Setup

**Files:**
- Create: `music-service/` (new directory at project root)
- Create: `music-service/pyproject.toml`
- Create: `music-service/server.py`
- Create: `music-service/README.md`

- [ ] **Step 1: Create Python service directory structure**

```bash
mkdir -p music-service
cd music-service
```

- [ ] **Step 2: Create uv project file**

Create `music-service/pyproject.toml`:

```toml
[project]
name = "tauri-eeg-music-service"
version = "0.1.0"
requires-python = ">=3.11,<3.13"
dependencies = [
    "fastapi==0.115.0",
    "uvicorn[standard]==0.30.0",
    "stable-audio-3 @ git+https://github.com/Stability-AI/stable-audio-3.git",
    "pydantic==2.9.0",
]

[tool.uv]
package = false
```

- [ ] **Step 3: Create minimal FastAPI server**

Create `music-service/server.py`:

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import torch
import os
from pathlib import Path
from stable_audio_3 import StableAudioModel

app = FastAPI(title="Music Generation Service")

model = None
device = "cuda" if torch.cuda.is_available() else "cpu"

def safe_output_path(output_dir: str, job_id: str) -> str:
    base = Path(output_dir).resolve()
    base.mkdir(parents=True, exist_ok=True)
    output_path = (base / f"gen_{job_id[:8]}.wav").resolve()
    if not str(output_path).startswith(str(base)):
        raise ValueError("Invalid output path")
    return str(output_path)

def load_model(device: str):
    return StableAudioModel.from_pretrained("small-music").to(device)

class GenerateRequest(BaseModel):
    prompt: str = Field(..., max_length=500)
    duration: int = Field(default=30, ge=5, le=120)
    job_id: str
    output_dir: str

class JobResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    output_path: str | None = None
    error: str | None = None

@app.on_event("startup")
async def startup_load_model():
    global model
    print("Loading Stable Audio 3 Small Music model...")
    model = load_model(device=device)
    print(f"Model loaded on {device}")

@app.get("/health")
async def health_check():
    return {
        "status": "ready" if model is not None else "loading",
        "model_loaded": model is not None,
        "gpu_available": torch.cuda.is_available(),
        "device": device
    }

@app.post("/generate", response_model=JobResponse)
async def generate_music(request: GenerateRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Stable Audio 3 Small Music is not loaded")
    
    try:
        output_path = safe_output_path(request.output_dir, request.job_id)
        audio = model.generate(
            prompt=request.prompt,
            duration=request.duration,
        )
        save_wav(output_path, audio, model.sample_rate)

        return JobResponse(
            job_id=request.job_id,
            status="completed",
            progress=100,
            output_path=output_path
        )
    
    except Exception as e:
        return JobResponse(
            job_id=request.job_id,
            status="failed",
            progress=0,
            error=str(e)
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

- [ ] **Step 4: Create service README**

Create `music-service/README.md`:

```markdown
# Music Generation Service

Python service for pure instrumental AI music generation using Stable Audio 3 Small Music by default.

## Setup

```bash
uv sync
```

This installs the official Stable Audio 3 library directly from `https://github.com/Stability-AI/stable-audio-3`. Accept the Hugging Face terms for `stabilityai/stable-audio-3-small-music` before first run.

## Run

```bash
uv run python server.py
```

Service runs on http://127.0.0.1:8000

## Test

```bash
curl http://127.0.0.1:8000/health
```
```

- [ ] **Step 5: Test Python service locally**

```bash
cd music-service
uv sync
uv run python server.py
```

Verify http://127.0.0.1:8000/health returns `{"status": "ready"}`.

**Note:** Model download happens on first run. The exact cache size depends on Hugging Face cache settings. Use uv for all Python dependency changes; do not add `requirements.txt`.

- [ ] **Step 6: Commit**

```bash
git add music-service/
git commit -m "feat(music): add python generation service

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 2: Database Schema for History

**Files:**
- Create: `src-tauri/migrations/20260611_music_history.sql`
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Create migration file**

Create `src-tauri/migrations/20260611_music_history.sql`:

```sql
CREATE TABLE IF NOT EXISTS music_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  duration_seconds REAL,
  created_at INTEGER NOT NULL,
  is_favorite INTEGER DEFAULT 0,
  generation_time_ms INTEGER,
  model_version TEXT DEFAULT 'stable-audio-3-small-music',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_history_user_created 
ON music_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_music_history_user_favorite 
ON music_history(user_id, is_favorite, created_at DESC);
```

- [ ] **Step 2: Apply migration in db.rs**

Modify `src-tauri/src/db.rs` to include new migration:

```rust
pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(include_str!("../migrations/20260611_music_history.sql"))?;
    Ok(())
}
```

- [ ] **Step 3: Run Rust tests**

```bash
cd src-tauri
cargo test
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/ src-tauri/src/db.rs
git commit -m "feat(music): add history database schema

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 3: Rust Backend - HTTP Client and Job Management

**Files:**
- Create: `src-tauri/src/python_client.rs`
- Create: `src-tauri/src/music_generation.rs`
- Create: `src-tauri/src/python_service.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add dependencies**

Modify `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
reqwest = { version = "0.12", features = ["json"] }
uuid = { version = "1.0", features = ["v4"] }
tokio = { version = "1", features = ["time"] }
```

- [ ] **Step 2: Create Python service manager**

Create `src-tauri/src/python_service.rs`:

```rust
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

pub struct PythonServiceManager {
    process: Arc<Mutex<Option<Child>>>,
    base_url: String,
}

impl PythonServiceManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            base_url: "http://127.0.0.1:8000".to_string(),
        }
    }

    pub async fn ensure_running(&self) -> Result<(), String> {
        if self.is_healthy().await {
            return Ok(());
        }

        self.start_service().await?;
        self.wait_for_ready().await?;

        Ok(())
    }

    async fn start_service(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock()
            .map_err(|e| format!("Failed to lock process: {}", e))?;

        if process_guard.is_some() {
            return Ok(());
        }

        let child = Command::new("uv")
            .current_dir("music-service")
            .args(&["run", "python", "server.py"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start Python service with uv: {}. Ensure uv is installed.", e))?;

        *process_guard = Some(child);

        Ok(())
    }

    async fn is_healthy(&self) -> bool {
        let client = reqwest::Client::new();
        let url = format!("{}/health", self.base_url);

        match client.get(&url).timeout(Duration::from_secs(2)).send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    async fn wait_for_ready(&self) -> Result<(), String> {
        for _ in 0..30 {
            if self.is_healthy().await {
                return Ok(());
            }
            sleep(Duration::from_secs(1)).await;
        }

        Err("Python service failed to start within 30 seconds".to_string())
    }

    pub fn shutdown(&self) {
        if let Ok(mut process_guard) = self.process.lock() {
            if let Some(mut child) = process_guard.take() {
                let _ = child.kill();
            }
        }
    }
}
```

- [ ] **Step 3: Create Python service client**

Create `src-tauri/src/python_client.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct GenerateRequest {
    pub prompt: String,
    pub duration: i32,
    pub job_id: String,
    pub output_dir: String,
}

#[derive(Debug, Deserialize)]
pub struct JobResponse {
    pub job_id: String,
    pub status: String,
    pub progress: i32,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

pub struct PythonClient {
    base_url: String,
    client: reqwest::Client,
}

impl PythonClient {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url,
            client: reqwest::Client::new(),
        }
    }

    pub async fn generate(&self, request: GenerateRequest) -> Result<JobResponse, String> {
        let url = format!("{}/generate", self.base_url);
        let response = self.client.post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Generate request failed: {}", e))?;
        
        response.json::<JobResponse>()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))
    }
}
```

- [ ] **Step 4: Create job management module**

Create `src-tauri/src/music_generation.rs`:

```rust
use crate::python_client::{GenerateRequest, PythonClient};
use crate::python_service::PythonServiceManager;
use serde::Serialize;
use std::sync::Arc;
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenerationJob {
    pub id: String,
    pub prompt: String,
    pub status: String,
    pub progress: i32,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

pub async fn start_generation(
    app: AppHandle,
    service_manager: Arc<PythonServiceManager>,
    prompt: String,
    duration: i32,
) -> Result<GenerationJob, String> {
    service_manager.ensure_running().await?;

    let job_id = Uuid::new_v4().to_string();
    
    let app_data_dir = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    let music_dir = app_data_dir.join("music");
    std::fs::create_dir_all(&music_dir)
        .map_err(|e| format!("Failed to create music dir: {}", e))?;
    
    let client = PythonClient::new("http://127.0.0.1:8000".to_string());
    
    let request = GenerateRequest {
        prompt: prompt.clone(),
        duration,
        job_id: job_id.clone(),
        output_dir: music_dir.to_string_lossy().to_string(),
    };
    
    let response = client.generate(request).await?;
    
    Ok(GenerationJob {
        id: response.job_id,
        prompt,
        status: response.status,
        progress: response.progress,
        output_path: response.output_path,
        error: response.error,
    })
}
```

- [ ] **Step 5: Register modules and commands**

Modify `src-tauri/src/lib.rs`:

```rust
mod python_client;
mod python_service;
mod music_generation;

use music_generation::GenerationJob;
use python_service::PythonServiceManager;
use std::sync::Arc;

pub struct MusicServiceState(Arc<PythonServiceManager>);

#[tauri::command]
async fn generate_music(
    app: tauri::AppHandle,
    service: tauri::State<'_, MusicServiceState>,
    prompt: String,
    duration: i32,
) -> Result<GenerationJob, String> {
    music_generation::start_generation(
        app,
        service.0.clone(),
        prompt,
        duration
    ).await
}
```

In `main()` function:

```rust
fn main() {
    let service_manager = Arc::new(PythonServiceManager::new());
    let service_clone = service_manager.clone();

    tauri::Builder::default()
        .manage(MusicServiceState(service_manager))
        .setup(move |app| {
            let service = service_clone.clone();
            app.on_exit(move |_| {
                service.shutdown();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // existing commands...
            generate_music
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Run Rust tests**

```bash
cd src-tauri
cargo test
cargo build
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/
git commit -m "feat(music): add auto-starting python service

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 4: Rust Backend - History CRUD Operations

**Files:**
- Create: `src-tauri/src/music_history.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create history module**

Create `src-tauri/src/music_history.rs`:

```rust
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MusicHistory {
    pub id: String,
    pub user_id: String,
    pub prompt: String,
    pub asset_id: String,
    pub file_path: String,
    pub duration_seconds: Option<f64>,
    pub created_at: i64,
    pub is_favorite: bool,
    pub generation_time_ms: Option<i64>,
    pub model_version: Option<String>,
}

pub fn save_history(
    conn: &Connection,
    id: String,
    user_id: String,
    prompt: String,
    asset_id: String,
    file_path: String,
    duration_seconds: Option<f64>,
    generation_time_ms: Option<i64>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO music_history 
         (id, user_id, prompt, asset_id, file_path, duration_seconds, created_at, generation_time_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            user_id,
            prompt,
            asset_id,
            file_path,
            duration_seconds,
            chrono::Utc::now().timestamp_millis(),
            generation_time_ms
        ],
    )?;
    Ok(())
}

pub fn get_history(
    conn: &Connection,
    user_id: String,
    limit: usize
) -> Result<Vec<MusicHistory>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, prompt, asset_id, file_path, duration_seconds, created_at, 
                is_favorite, generation_time_ms, model_version
         FROM music_history
         WHERE user_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2"
    )?;
    
    let history = stmt.query_map(params![user_id, limit], |row| {
        Ok(MusicHistory {
            id: row.get(0)?,
            user_id: row.get(1)?,
            prompt: row.get(2)?,
            asset_id: row.get(3)?,
            file_path: row.get(4)?,
            duration_seconds: row.get(5)?,
            created_at: row.get(6)?,
            is_favorite: row.get::<_, i32>(7)? == 1,
            generation_time_ms: row.get(8)?,
            model_version: row.get(9)?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()?;
    
    Ok(history)
}

pub fn delete_history(
    conn: &Connection,
    id: String,
    user_id: String
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM music_history WHERE id = ?1 AND user_id = ?2",
        params![id, user_id]
    )?;
    Ok(())
}

pub fn toggle_favorite(
    conn: &Connection,
    id: String,
    user_id: String
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE music_history SET is_favorite = NOT is_favorite 
         WHERE id = ?1 AND user_id = ?2",
        params![id, user_id]
    )?;
    Ok(())
}
```

- [ ] **Step 2: Register history commands**

Modify `src-tauri/src/lib.rs`:

```rust
mod music_history;

use music_history::MusicHistory;
use tauri::State;

#[tauri::command]
fn get_music_history(
    db: State<AppDb>,
    user_id: String,
    limit: usize
) -> Result<Vec<MusicHistory>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    music_history::get_history(&conn, user_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_music_history(
    db: State<AppDb>,
    id: String,
    user_id: String
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    music_history::delete_history(&conn, id, user_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_music_favorite(
    db: State<AppDb>,
    id: String,
    user_id: String
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    music_history::toggle_favorite(&conn, id, user_id).map_err(|e| e.to_string())
}
```

Register commands:

```rust
.invoke_handler(tauri::generate_handler![
    // existing commands...
    get_music_history,
    delete_music_history,
    toggle_music_favorite
])
```

- [ ] **Step 3: Run Rust tests**

```bash
cd src-tauri
cargo test
cargo build
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat(music): add history CRUD operations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 5: Frontend - Types and API Client

**Files:**
- Create: `src/music/generationTypes.ts`
- Create: `src/music/generationApi.ts`

- [ ] **Step 1: Create generation types**

Create `src/music/generationTypes.ts`:

```typescript
export type GenerationJob = {
  id: string;
  prompt: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  outputPath: string | null;
  error: string | null;
};

export type MusicHistory = {
  id: string;
  prompt: string;
  assetId: string;
  filePath: string;
  durationSeconds: number | null;
  createdAt: number;
  isFavorite: boolean;
  generationTimeMs: number | null;
  modelVersion: string | null;
};
```

- [ ] **Step 2: Create API client**

Create `src/music/generationApi.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { GenerationJob, MusicHistory } from './generationTypes';

export async function generateMusic(
  prompt: string,
  duration: number = 10
): Promise<GenerationJob> {
  return invoke<GenerationJob>('generate_music', { prompt, duration });
}

export async function getMusicHistory(
  userId: string,
  limit: number = 50
): Promise<MusicHistory[]> {
  return invoke<MusicHistory[]>('get_music_history', { userId, limit });
}

export async function deleteMusicHistory(
  id: string,
  userId: string
): Promise<void> {
  return invoke<void>('delete_music_history', { id, userId });
}

export async function toggleMusicFavorite(
  id: string,
  userId: string
): Promise<void> {
  return invoke<void>('toggle_music_favorite', { id, userId });
}
```

- [ ] **Step 3: Run frontend build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/music/
git commit -m "feat(music): add generation api client

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 6: Frontend - Compact Player UI

**Files:**
- Modify: `src/pages/home/MusicRegulation.tsx`
- Modify: `src/pages/home/MusicRegulation.module.css`

- [ ] **Step 1: Replace with compact player UI**

Modify `src/pages/home/MusicRegulation.tsx`:

```tsx
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import HistoryIcon from '@mui/icons-material/History';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { Button, IconButton, LinearProgress, TextField } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { generateMusic, getMusicHistory } from '../../music/generationApi';
import type { GenerationJob, MusicHistory } from '../../music/generationTypes';
import styles from './MusicRegulation.module.css';

export default function MusicRegulation() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [prompt, setPrompt] = useState('');
  const [currentJob, setCurrentJob] = useState<GenerationJob | null>(null);
  const [history, setHistory] = useState<MusicHistory[]>([]);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const data = await getMusicHistory(50);
      setHistory(data);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    try {
      const job = await generateMusic(prompt, 10);
      setCurrentJob(job);

      if (job.status === 'completed' && job.outputPath) {
        setCurrentTrack(job.outputPath);
        await loadHistory();
      }
    } catch (error) {
      console.error('Generation failed:', error);
    }
  };

  const handlePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  return (
    <section className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>AI Generation</span>
          <h1 className={styles.title}>Music Regulation</h1>
        </div>
        <div className={styles.statusBar}>
          <span>{history.length} generated tracks</span>
          <IconButton size="small" onClick={() => setShowHistory(!showHistory)}>
            <HistoryIcon />
          </IconButton>
        </div>
      </header>

      <div className={styles.mainPanel}>
        <div className={styles.promptRow}>
          <TextField
            label="Enter music prompt"
            placeholder="calm piano with soft strings"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            size="small"
            fullWidth
            disabled={currentJob?.status === 'processing'}
          />
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={!prompt.trim() || currentJob?.status === 'processing'}
          >
            Generate
          </Button>
        </div>

        {currentJob?.status === 'processing' && (
          <div className={styles.progressBar}>
            <LinearProgress variant="determinate" value={currentJob.progress} />
            <span>Generating... {currentJob.progress}%</span>
          </div>
        )}

        {currentTrack && (
          <div className={styles.compactPlayer}>
            <IconButton onClick={handlePlay} color="primary">
              {isPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
            </IconButton>
            <GraphicEqRoundedIcon />
            <span>Now playing</span>
          </div>
        )}
      </div>

      {currentTrack && (
        <audio
          ref={audioRef}
          src={`asset://localhost/${currentTrack}`}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 2: Update styles**

Modify `src/pages/home/MusicRegulation.module.css`:

```css
.workspace {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 900px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(23, 32, 38, 0.6);
  font-weight: 700;
}

.title {
  font-size: 28px;
  font-weight: 720;
  margin: 4px 0 0;
  color: #172026;
}

.statusBar {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 13px;
  color: rgba(23, 32, 38, 0.64);
}

.mainPanel {
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(23, 32, 38, 0.1);
  border-radius: 10px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.promptRow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
}

.progressBar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progressBar span {
  font-size: 12px;
  color: rgba(23, 32, 38, 0.64);
}

.compactPlayer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(223, 2, 3, 0.04);
  border-radius: 8px;
}

.compactPlayer span {
  font-size: 13px;
  font-weight: 650;
  color: #172026;
}
```

- [ ] **Step 3: Run frontend build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/home/MusicRegulation.*
git commit -m "feat(music): add compact player ui

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 7: End-to-End Integration Test

**Files:**
- No new files.

- [ ] **Step 1: Start Python service**

```bash
cd music-service
uv run python server.py
```

Verify service is running at http://127.0.0.1:8000/health.

- [ ] **Step 2: Run Tauri dev build**

```bash
npm run tauri dev
```

- [ ] **Step 3: Test generation flow**

1. Navigate to Music Regulation page
2. Enter prompt: "calm piano music"
3. Click Generate
4. Verify progress shows
5. Verify audio plays after completion
6. Check app data directory for WAV file

- [ ] **Step 4: Verify database**

Check SQLite database contains history record:

```bash
sqlite3 path/to/app/data/db.sqlite "SELECT * FROM music_history;"
```

- [ ] **Step 5: Run all tests**

```bash
npm test
cd src-tauri && cargo test
```

## Notes

**Python service lifecycle:**
- For development: Start manually before running Tauri app
- For production: Consider bundling with PyInstaller or using system service

**Storage management:**
- Implement cleanup policy in future iteration
- Monitor app data directory size
- Add user settings for retention policy
- Store WAV directly to avoid ffmpeg/transcoding latency. Do not add MP3 export or compression to this workflow.

**Model caching:**
- First run downloads the selected Stable Audio model files
- Model cached in `~/.cache/huggingface/`
- Subsequent runs load from cache

**Performance:**
- Expect <20 seconds generation time for 30s audio after warmup on RTX 5090 Laptop 24GB
- UI remains responsive during generation
- Consider adding cancel functionality in future
