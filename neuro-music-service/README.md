# Neuro Music Service

FastAPI service boundary for realtime EEG emotion music regulation.

This service is intentionally separate from `music-service`, which generates
offline WAV files with Stable Audio 3 Small Music. `neuro-music-service`
controls a realtime DEMON session and exposes a small contract that the Tauri
app can call without importing model code into Rust or React.

## Minimal Contract

- `GET /health`
- `POST /session/start`
- `POST /session/stop`
- `GET /session/status`
- `POST /control/emotion`

The first implementation is a lightweight control-plane scaffold. It can run in
mock mode for UI integration and can optionally forward DEMON params to an
already-running DEMON HTTP control bus.

## Run

```bash
cd neuro-music-service
uv sync
uv run python server.py
```

Optional DEMON forwarding:

```bash
set NEURO_MUSIC_DEMON_CONTROL_URL=http://127.0.0.1:1319
uv run python server.py
```

## Runtime Modes

- `mock`: no models required; validates the Tauri UI, EEG emotion label contract,
  and music/video consumer contract.
- `demon`: forwards emotion-derived controls to an already-running DEMON
  control bus.
- `real-eeg-emotion`: reserved for a future calibrated EmotionCLIP or 32-channel
  live EEG model adapter.

See [MODELS.md](./MODELS.md) for environment variables, model paths, ports, and
verification commands.

## Why This Is Separate From `music-service`

`music-service` generates offline WAV files with Stable Audio 3 Small Music.
`neuro-music-service` is a realtime control-plane service. It publishes the
latest EEG emotion label as a shared system signal so Music Regulation and
future Video Recommendation can consume the same label.
