# Neuro Music Runtime Requirements

## Modes

### Mode 1: `mock`

Purpose:

- UI integration.
- Tauri command validation.
- Video/music consumers reading a shared EEG emotion label.

Model requirements:

- No model files.
- No CUDA.
- No DEMON process.

Commands:

```bash
cd neuro-music-service
uv sync
uv run python server.py
```

### Mode 2: `demon`

Purpose:

- Forward an already inferred EEG emotion label to a live DEMON session.
- Validate realtime music control without embedding DEMON lifecycle into Tauri.

Model/runtime requirements:

- DEMON backend already running.
- One active DEMON primary session, from browser UI or headless client.
- DEMON control bus reachable, normally `http://127.0.0.1:1319`.
- DEMON model files are external to this repo:
  - ACE-Step checkpoint.
  - VAE checkpoint.
  - TensorRT engines, if using TensorRT.
  - Optional LoRA and steering vectors.

Environment:

```bash
export NEURO_MUSIC_DEMON_CONTROL_URL=http://127.0.0.1:1319
uv run python server.py
```

This repo does not vendor DEMON weights. Keep them in an external model cache,
for example:

```text
<models_root>/demon/checkpoints
<models_root>/demon/trt_engines
<models_root>/demon/loras
<models_root>/demon/steering_vectors
```

### Mode 3: `real-eeg-emotion`

Purpose:

- Infer a live EEG emotion label from the system's 32-channel raw EEG cap stream.
- Feed that label to music control and video recommendation.

Current status:

- Not implemented.
- The public contract already exists:
  - `POST /eeg/emotion/predict`
  - `GET /eeg/emotion/latest`
- Requires a personal 32-channel calibration paradigm before live use.

Required model inputs:

- Live app payload is channel-major raw microvolt data:

```text
samples[channel][time]
channel_ids: ch01..ch32
sample_rate_hz: usually 1000
block interval: usually 50 ms
```

- Current EmotionCLIP/SEED-IV checkpoint expects processed features, not raw
  32-channel samples. The known local model path from NeuroSonics experiments is
  external to this repo:

```text
repos/EmotionCLIP/SEED_IV_repro/self_pretrain_ablation/full_lr1e5_e10/cross_subject/cross_subject_subject1_session1/2026-07-01-19-47-38/model_best.pt
```

Recommended environment variables for the future real adapter:

```bash
export NEURO_MUSIC_EMOTION_BACKEND=emotionclip
export NEURO_MUSIC_EMOTIONCLIP_ROOT=/path/to/EmotionCLIP
export NEURO_MUSIC_EMOTIONCLIP_CHECKPOINT=/path/to/model_best.pt
export NEURO_MUSIC_EEG_ADAPTER=seediv_de_psd
```

Real adapter requirements:

- Ring buffer over live raw EEG.
- Filtering and artifact handling.
- Window extraction long enough for emotion features.
- Montage/channel mapping from the app's 32-channel cap to the training setup.
- DE/PSD feature extraction or retraining for raw 32-channel input.
- Per-user calibration or domain adaptation.

Minimum calibration paradigm:

- Session 1 records labeled video-induced EEG and self-report feedback.
- Train a personal baseline model from the recorded 32-channel windows.
- Session 2 runs live regulation and validates whether music/video feedback
  changes the user's EEG emotion state.
- Use the four formal regulation classes from
  `config/eeg_emotion_paradigm.json`.
- Each class needs at least five induction videos for the minimum runnable
  paradigm.
- Keep both the paradigm label and the system label:

```text
Depression -> sad
Anxiety -> fear
Calm -> neutral
Happy -> happy
```

Required saved metadata:

```text
subject_id, session_id, trial_id, paradigm_emotion, system_emotion,
video_id, trigger_start_ts, trigger_end_ts, sample_rate_hz, channel_ids,
recording_path, self_report_valence, self_report_arousal
```

Music regulation policy:

```text
sad / depression
  goal: raise valence, gently raise arousal
  music: warm, gradual, moderate tempo, positive progression

fear / anxiety
  goal: lower arousal, stabilize valence
  music: steady, soft, predictable, low dissonance, no abrupt transitions

neutral / calm
  goal: maintain stable low arousal
  music: ambient, light texture, low novelty, conservative changes

happy
  goal: maintain positive valence without overstimulation
  music: bright, melodic, moderate energy, smooth transitions
```

Do not claim strict unseen-subject zero-shot emotion recognition until this path
is validated on live users. Existing experiments showed strong calibrated/full
data performance but weak strict unseen-subject generalization.

## Ports

```text
8010  neuro-music-service
1319  optional DEMON control HTTP bus
1318  optional DEMON backend HTTP/WebSocket
8000  existing Stable Audio music-service
```

## Minimum Verification

```bash
cd neuro-music-service
uv sync
uv run pytest
uv run python server.py
```

In another terminal:

```bash
curl http://127.0.0.1:8010/health
curl -X POST http://127.0.0.1:8010/eeg/emotion/predict \
  -H "Content-Type: application/json" \
  -d '{"channel_ids":["ch01","ch02"],"sample_rate_hz":1000,"samples":[[1,2],[3,4]],"trigger_class":2,"source":"smoke"}'
curl -X POST http://127.0.0.1:8010/session/start \
  -H "Content-Type: application/json" \
  -d '{"user_id":"u1","username":"tester","mode":"mock","prompt":"instrumental emotional music"}'
curl -X POST http://127.0.0.1:8010/control/emotion \
  -H "Content-Type: application/json" \
  -d '{"emotion":"fear","probabilities":{"fear":0.74,"sad":0.1,"neutral":0.08,"happy":0.08},"valence":-0.02,"arousal":0.4,"playback_pos":0}'
```
