# Music Generation Service

Local FastAPI service for pure instrumental WAV generation with `stabilityai/stable-audio-3-small-music`.

## Setup

```bash
uv sync
```

Install the Stable Audio 3 package using the official model instructions after accepting the Hugging Face model terms.
Use the CUDA 12.8 PyTorch wheels:

```bash
uv sync --extra cu128
```

Verify CUDA is available:

```bash
uv run python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

## First Run / Model Download

The Tauri app starts this service automatically when the Music page generates a track. On the
first run, Stable Audio must download and load the model, which can take longer than the app's
startup wait time. If the app shows `Music generation service did not become ready.`, start the
service manually once and let the model download finish.

PowerShell:

```powershell
cd D:\tauri-eeg\music-service

# Use the persistent Hugging Face cache location for this terminal session too.
$env:HF_HOME="D:\.hf-cache"

# NVIDIA CUDA 12.8 setup:
uv sync --extra cu128
```

RTX 50-series GPUs such as the RTX 5090 require CUDA wheels new enough to support the GPU's
`sm_120` architecture. Use the `cu128` extra for CUDA instead of the older `cu126` extra.

If this machine does not have NVIDIA CUDA, use the CPU/default dependency sync instead:

```powershell
uv sync
```

Then start the service:

```powershell
uv run python server.py
```

Keep this terminal open while using the app. The first startup downloads the model into:

```text
D:\.hf-cache\hub
```

In another PowerShell window, verify that the service is ready:

```powershell
curl http://127.0.0.1:8000/health
```

When the health endpoint returns `status: ready`, open the Music page and generate again. The
Tauri app will reuse the already-running service at `http://127.0.0.1:8000`.

If model access fails, accept the Hugging Face model terms first, then log in:

```powershell
uv run huggingface-cli login
uv run python server.py
```

## Run

```bash
uv run python server.py
```

The service listens on `http://127.0.0.1:8000`.

## Health

```bash
curl http://127.0.0.1:8000/health
```

## Persistent Hugging Face Cache

To set the Hugging Face cache directory permanently for the current Windows user:

```powershell
[Environment]::SetEnvironmentVariable("HF_HOME", "D:\.hf-cache", "User")
```

Close and reopen PowerShell, your IDE, and the Tauri app after changing the user environment.
Check the current terminal value with:

```powershell
$env:HF_HOME
```
