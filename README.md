# tauri-eeg

Desktop EEG and regulation workspace built with Tauri 2, React, TypeScript, Rust, and a local Python music generation service.

## Features

- Local multi-user login backed by SQLite.
- EEG acquisition workspace with realtime waveform display, channel controls, and animated page entry.
- Video, game, and music regulation pages.
- Music page with a compact player, layered prompt builder, generated WAV history, progress display, and file deletion.
- Local Stable Audio 3 Small Music generation through `music-service`.

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
