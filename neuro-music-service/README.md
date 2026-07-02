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

## SEED-IV Offline Replay Smoke Test

Use local processed SEED-IV data to test the system contract before live EEG is
available:

```bash
uv run python server.py
```

In another terminal:

```bash
uv run python tools/replay_seediv_to_service.py \
  --data /home/bbbwa01/workspace/piplineegmus/data/processed/emotionclip_seediv_full_fixed \
  --subject 1 \
  --session 1 \
  --per-class 2 \
  --log runs/seediv_service_replay.jsonl
```

This uses SEED-IV labels as an oracle:

```text
neutral -> calm       -> neutral
sad     -> depression -> sad
fear    -> anxiety    -> fear
happy   -> happy      -> happy
```

The purpose is to verify EEG emotion labels, latest-emotion state, and music
control parameters. It does not validate a real live EEG classifier.

## DEAP Offline Replay Smoke Test

Use DEAP valence/arousal ratings to test the same contract with 32-channel
music-video emotion data. The script reads the zipped DEAP `.dat` file directly
and does not require extracting the full 27 GB archive.

```bash
uv run python server.py
```

In another terminal:

```bash
uv run python tools/replay_deap_to_service.py \
  --source /home/bbbwa01/workspace/piplineegmus/data/raw/DGCNN-DEAP.zip \
  --subject 1 \
  --per-class 2 \
  --log runs/deap_service_replay.jsonl
```

After full extraction, use the extracted directory instead:

```bash
uv run python tools/replay_deap_to_service.py \
  --source /home/bbbwa01/workspace/piplineegmus/data/raw/DGCNN-DEAP \
  --subject 1 \
  --per-class 2 \
  --log runs/deap_service_replay_extracted.jsonl
```

DEAP labels are mapped with a 5.0 threshold on the 1-9 rating scale:

```text
low valence + low arousal  -> depression -> sad
low valence + high arousal -> anxiety    -> fear
high valence + low arousal -> calm       -> neutral
high valence + high arousal -> happy     -> happy
```

This validates the valence/arousal-to-regulation strategy. It is still an
oracle-label replay, not a trained DEAP EEG classifier.

Build a full 32-subject manifest for later model training:

```bash
uv run python tools/build_deap_manifest.py \
  --source /home/bbbwa01/workspace/piplineegmus/data/raw/DGCNN-DEAP \
  --subjects all \
  --out runs/deap_4class_manifest.csv \
  --summary runs/deap_4class_summary.json
```

## Why This Is Separate From `music-service`

`music-service` generates offline WAV files with Stable Audio 3 Small Music.
`neuro-music-service` is a realtime control-plane service. It publishes the
latest EEG emotion label as a shared system signal so Music Regulation and
future Video Recommendation can consume the same label.
