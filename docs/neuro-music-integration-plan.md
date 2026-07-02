# Realtime EEG Emotion Music Integration Plan

## Current System Baseline

The existing Music Regulation feature uses `music-service`, a FastAPI service
that generates offline WAV files with Stable Audio 3 Small Music. The flow is:

```text
React Music page -> Tauri command generate_music -> Rust PythonServiceManager
-> music-service/server.py -> Stable Audio -> WAV file -> music history
```

This should remain unchanged.

## Architecture Before And After

Before this integration:

```text
32ch EEG cap
  -> Rust EEG socket backend
  -> eeg://sample-block React event
  -> waveform display / recording

Music page prompt
  -> Tauri generate_music
  -> music-service
  -> Stable Audio 3 Small Music
  -> generated WAV history

Video recommendation
  -> static/user-selected regulation catalog
```

After this integration:

```text
32ch EEG cap
  -> Rust EEG socket backend
  -> eeg://sample-block React event
  -> waveform display / recording
  -> neuroMusic live bridge
  -> neuro-music-service /eeg/emotion/predict
  -> latest EEG emotion label
       -> Music realtime DEMON control
       -> Video recommendation input later

Music page prompt
  -> Tauri generate_music
  -> music-service
  -> Stable Audio 3 Small Music
  -> generated WAV history

Realtime music session
  -> Tauri start_neuro_music_session
  -> neuro-music-service
  -> optional DEMON control bus forwarding
```

The important architectural change is that EEG emotion labels become a shared
system signal. Music is the first consumer, but video recommendation should use
the same `get_latest_eeg_emotion` command.

## New Minimum Module

The realtime EEG emotion music feature is added as a separate bounded module:

```text
neuro-music-service/          Python FastAPI realtime control service
src-tauri/src/neuro_music_*   Rust service manager + HTTP client
src/neuroMusic/               React API + compact panel
```

The new module exposes two system-level capabilities:

1. EEG emotion labeling:

```text
predict_eeg_emotion
get_latest_eeg_emotion
```

2. Realtime music control:

```text
start_neuro_music_session
send_neuro_music_emotion_control
stop_neuro_music_session
get_neuro_music_session_status
```

Video recommendation should consume the EEG emotion label interface, not the
music-control interface.

## Minimal Backend Contract

`neuro-music-service` runs on `127.0.0.1:8010`:

- `GET /health`
- `POST /eeg/emotion/predict`
- `GET /eeg/emotion/latest`
- `POST /session/start`
- `POST /session/stop`
- `GET /session/status`
- `POST /control/emotion`

The first implementation is a scaffold:

- emotion inference is deterministic mock logic,
- DEMON forwarding is optional,
- real EmotionCLIP inference should replace `infer_mock_emotion`.

## 32-Channel System EEG vs SEED-IV Gap

The app's live EEG acquisition backend receives a 32-channel cap stream:

- Rust protocol expects 32 channels.
- Default sample rate is 1000 Hz.
- UI sample blocks are emitted every 50 ms.
- Payload shape is channel-major raw microvolt samples:

```text
samples: number[channel][time]
```

The current EmotionCLIP SEED-IV experiments used processed dataset windows:

- 15 subjects x 3 sessions.
- 4 emotion classes: `neutral`, `sad`, `fear`, `happy`.
- Processed `.npy` samples are not raw 32-channel time series.
- The model input after dataset conversion is roughly:

```text
[frames=4, channels=12, height=64, width=64]
```

Important mismatch:

- channel count differs: live 32-channel cap vs SEED-IV feature channel layout,
- feature type differs: raw microvolts vs processed DE/PSD-like spatial maps,
- sampling/windowing differs: live 50 ms blocks vs SEED-IV fixed processed windows,
- electrode montage likely differs,
- subject calibration matters; strict unseen-subject generalization was weak.

Therefore the live system must add an adapter before using the current
EmotionCLIP checkpoint:

```text
32ch raw EEG ring buffer
-> artifact filtering / normalization
-> windowing to model duration
-> channel montage mapping or retraining
-> DE/PSD feature extraction
-> spatial map construction
-> EmotionCLIP inference
-> emotion label/probabilities/valence/arousal
```

For the first integrated product milestone, use a calibrated/session-adapted
model or a mock/label-driven service mode. Do not claim strict zero-shot
emotion recognition from arbitrary live users.

## Next Engineering Steps

1. Replace mock `infer_mock_emotion` with a real adapter module.
2. Add a small ring buffer inside `neuro-music-service` for live 32-channel
   blocks.
3. Stream EEG sample blocks from React/Tauri into `predict_eeg_emotion`, or add
   a backend event bridge so Rust forwards blocks directly.
4. Let Music Regulation and Video Regulation both read `get_latest_eeg_emotion`.
5. Add DEMON process/session lifecycle management after the mock UI contract is
   stable.
