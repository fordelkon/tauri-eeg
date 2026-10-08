# tauri-eeg

Desktop EEG and regulation workspace built with Tauri 2, React, TypeScript, Rust, and a local Python music generation service.

## Features

- Local multi-user login backed by SQLite.
- BioSemi USB Trigger Interface settings and independent experiment/event logs. ActiView saves BDF externally.
- Personal calibration and held-out emotion induction with stimulus presentation and SAM ratings.
- Video, game, and music regulation pages.
- Emotion regulation effect evaluation loop (`/effect-evaluation`): baseline/post scale pairing, improvement-rate verdicts, history review, and CSV/JSON report export.
- Music page with a compact player, layered prompt builder, generated WAV history, progress display, and file deletion.
- Local Stable Audio 3 Small Music generation through `music-service`.

## Effect Evaluation Loop

The `/effect-evaluation` page closes the emotion-regulation evaluation loop for a subject:

1. Pick a subject id, target emotion (焦虑 / 抑郁 / 恐惧), regulation method (music or video), and duration.
2. Preload and present the emotion-induction video, then fill SAM and the baseline STAI-S/PANAS battery (`phase=baseline`).
3. Execute natural recovery, music regulation, or video regulation in the wizard. Media playback starts the regulation timer and sends event codes. Track selection and loading do not count toward regulation time.
4. Complete the post battery (`phase=post`), with GEMS-9 for music regulation.
5. The backend pairs measurements from the same run and computes per-dimension improvement `(baseline - post) / baseline`. Formal condition comparisons exclude rehearsal and interrupted runs. The 10% threshold is a project setting, not a clinical efficacy criterion.

See [BioSemi operation guide](docs/biosemi-operation.md) and [implementation specification](docs/biosemi-trigger-implementation.md). The original EEG Python service, realtime waveform implementation, and old recording APIs have been removed. No old EEG-record compatibility is provided.

Every completed scale submission is persisted to the SQLite `scale_records` table (in addition to the in-memory status cache), so runs survive restarts. The history tab reviews all completed baseline/post runs, and the export buttons write one run's report (JSON or CSV) or an all-subjects batch summary (CSV) to a user-chosen path through the native save dialog. CSV fields are escaped by hand (RFC 4180, BOM included for Excel); no CSV dependency is used.

## Requirements

- Node.js and pnpm.
- Rust toolchain for Tauri.
- Tauri CLI through the project dependency: `pnpm tauri ...`.
- Python package manager `uv` for `music-service`.
- Hugging Face account with access accepted for `stabilityai/stable-audio-3-small-music`.
- NVIDIA CUDA is optional but recommended for music generation.

## Install

```powershell
cd D:\tauri-eeg
pnpm install
```

Set up the Python music service:

```powershell
cd D:\tauri-eeg\music-service
uv sync
```

For RTX 50-series / CUDA 12.8 systems, install the CUDA dependency extra:

```powershell
cd D:\tauri-eeg\music-service
uv sync --extra cu128
uv run python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

## Hugging Face Cache

The Stable Audio model is downloaded through Hugging Face. To keep the model cache in a stable location on Windows:

```powershell
[Environment]::SetEnvironmentVariable("HF_HOME", "D:\.hf-cache", "User")
```

Close and reopen PowerShell, your IDE, and the Tauri app after changing the user environment. For the current terminal session only:

```powershell
$env:HF_HOME="D:\.hf-cache"
```

Verify login:

```powershell
cd D:\tauri-eeg\music-service
uv run hf auth whoami
```

If needed:

```powershell
uv run huggingface-cli login
```

## Run The App

Development frontend only:

```powershell
cd D:\tauri-eeg
pnpm dev
```

Tauri desktop app:

```powershell
cd D:\tauri-eeg
pnpm tauri dev
```

## Music Generation Flow

The Music page tries to start `music-service` automatically when generating a track. On first use, the model download and load can take longer than the app startup wait. If the app reports:

```text
Music generation service did not become ready.
```

start the service manually once:

```powershell
cd D:\tauri-eeg\music-service
$env:HF_HOME="D:\.hf-cache"
uv run python server.py
```

Keep that terminal open. In another terminal, check readiness:

```powershell
curl http://127.0.0.1:8000/health
```

When the health response is ready, generate again from the Music page. The app reuses the running service at `http://127.0.0.1:8000`.

Notes:

- `flash_attn` warnings are expected when Flash Attention is not installed; the service falls back without it.
- `on_event is deprecated` is a FastAPI deprecation warning and does not block generation.
- `WinError 10048` means another service is already using port `8000`; stop the old process or reuse it.
- RTX 5090 / RTX 50-series GPUs need CUDA wheels that support `sm_120`, so use the `cu128` extra.

## Data Locations

Current Windows paths:

```text
User database:
C:\Users\<you>\AppData\Local\tauri-eeg\users.sqlite3

Generated music WAV files:
C:\Users\<you>\AppData\Roaming\com.tauri-eeg.app\music

Hugging Face model cache, if configured:
D:\.hf-cache\hub
```

Generated WAV history can be opened from the Music Player history button. Deleting a generated history item from the app also deletes its WAV file, limited to the app music output directory.

## Verification

Frontend build:

```powershell
pnpm build
```

Frontend tests:

```powershell
pnpm test
```

Rust formatting and tests:

```powershell
cd D:\tauri-eeg\src-tauri
cargo fmt --check
cargo test
```

Python music-service tests:

```powershell
cd D:\tauri-eeg\music-service
uv run pytest
```

## Project Structure

```text
src/                 React UI, auth, EEG, and music client code
src-tauri/           Tauri/Rust backend commands, SQLite, file handling
music-service/       FastAPI Stable Audio generation service
docs/superpowers/    Design specs and implementation plans
```
