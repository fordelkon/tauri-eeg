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

## Real EEG Emotion Adapter Options

### Option A - SEED-IV Feature Adapter

Use this if the goal is to reuse the existing EmotionCLIP checkpoint as soon as
possible.

Pipeline:

```text
live 32ch raw EEG
-> ring buffer
-> bandpass/notch filtering
-> 1-4 s emotion window
-> Welch PSD / differential entropy style features
-> channel/montage mapping
-> spatial map resize
-> EmotionCLIP inference
```

Pros:

- Reuses the existing EmotionCLIP checkpoint and reports.
- Keeps the output label space aligned to `neutral`, `sad`, `fear`, `happy`.

Risks:

- The live cap has 32 channels while SEED-IV uses a different processed feature
  layout.
- Exact SEED-IV preprocessing parity is hard without the same montage and
  feature extraction code.
- Needs user/session calibration.

Implementation note:

- Use MNE or scipy-style Welch PSD extraction for the first adapter prototype.
- Keep the adapter in `neuro-music-service` behind the same
  `/eeg/emotion/predict` contract.

### Option B - Train A Native 32-Channel Live-Cap Model

Use this if live reliability matters more than checkpoint reuse.

Pipeline:

```text
record labeled 32ch sessions
-> preprocess raw windows
-> train compact EEG model or fine-tune an EEG backbone
-> export local checkpoint
-> neuro-music-service inference
```

Pros:

- Matches the app's actual device, sample rate, and channel montage.
- Avoids brittle SEED-IV feature emulation.

Risks:

- Requires labeled calibration data.
- Needs a user study/data collection protocol.

Implementation note:

- Braindecode-style windowed raw EEG training is the natural baseline for this
  route.

### Option C - Riemannian / Covariance Calibration Baseline

Use this as a robust small-data baseline before deep training.

Pipeline:

```text
live 32ch raw EEG
-> band-specific covariance features
-> tangent-space or minimum-distance classifier
-> emotion label/probabilities
```

Pros:

- Often works with smaller calibration sets.
- Lightweight enough for CPU inference.
- Good sanity baseline for whether the live device signal carries usable class
  information.

Risks:

- May be less expressive than a deep model.
- Needs per-user calibration.

Implementation note:

- pyRiemann provides the common covariance/tangent-space classifier building
  blocks.

## Personal 32-Channel Emotion Calibration Paradigm

For real personal EEG collected from the 32-channel cap, the system should run
an emotion calibration paradigm before claiming reliable live emotion
recognition. The old `emotionBCI/emo_bci` design is a suitable starting point:

```text
Session 1 - Baseline / labeled induction
  -> 20 video trials across 7 emotions
  -> collect raw 32ch EEG with trigger start/end timestamps
  -> collect subject self-report after each trial
  -> train or adapt a personal emotion classifier

Session 2 - Regulation / feedback validation
  -> run the same 32ch EEG stream through the calibrated classifier
  -> feed latest emotion label to music control and video recommendation
  -> collect feedback and compare with Session 1 baseline
```

The referenced paradigm uses seven induced emotion labels:

```text
1 Anxiety
2 Depression
3 Fear
4 Happy
5 Joy
6 Neutral
7 Surprise
```

Each trial has four phases:

```text
starting hint -> video watching -> ending hint -> feedback
```

The legacy settings assume 32 EEG channels, 2000 Hz sampling, and a TCP EEG
source on port 9687. The current Tauri backend usually exposes 32 channels at
1000 Hz and emits 50 ms channel-major sample blocks. That difference is not a
blocking issue, but the calibration recorder must persist the actual sampling
rate, channel ids, trigger times, and device metadata for every trial.

### Label Mapping To The Current System

The realtime system contract currently uses the four SEED-IV-compatible labels:

```text
neutral, sad, fear, happy
```

Use this first mapping for integration:

```text
Anxiety    -> fear
Fear       -> fear
Depression -> sad
Happy      -> happy
Joy        -> happy
Neutral    -> neutral
Surprise   -> unknown/high-arousal until self-report resolves valence
```

If the product needs a richer video recommendation policy, keep the original
7-class label in metadata and expose both fields:

```text
raw_emotion_label: Anxiety | Depression | Fear | Happy | Joy | Neutral | Surprise
system_emotion: neutral | sad | fear | happy
valence: float
arousal: float
confidence: float
```

### Minimum Data Contract For Calibration

Each calibration trial should save:

```text
subject_id
session_id
trial_id
phase
raw_emotion_label
system_emotion
video_id / video_path
trigger_start_ts
trigger_end_ts
eeg_start_ts
eeg_end_ts
sample_rate_hz
channel_ids
samples or recorded file path
self_report_valence
self_report_arousal
self_report_dominance optional
artifact_flags optional
```

This gives the backend enough information to train a small personal classifier,
audit whether the label came from induction or inference, and reuse the same
emotion label for music and video modules.

### Minimum Implementation Order

1. Add a calibration recorder that writes session/trial metadata and raw 32ch
   EEG windows from the existing EEG backend.
2. Reuse the `emotionBCI` video-folder organization for induction stimuli:

```text
database/Anxiety
database/Depression
database/Fear
database/Happy
database/Joy
database/Neutral
database/Surprise
```

3. Train Option C first: bandpass/notch filtering, Hjorth or band covariance
   features, then LDA/SVM or pyRiemann tangent-space classification.
4. Export a personal model artifact and load it behind
   `POST /eeg/emotion/predict`.
5. Use `get_latest_eeg_emotion` as the system signal for both realtime music
   control and future video recommendation.

Deep EmotionCLIP or native 32-channel models should be added after this
calibration loop proves that the local cap, triggers, and labels are aligned.

## Recommended Next Implementation Order

1. Keep `mock` as the UI/system integration mode.
2. Add a live EEG ring buffer and persist 2-5 minute labeled calibration
   recordings from the app's 32-channel cap.
3. Implement Option C first as a lightweight calibration baseline.
4. Implement Option A only if the feature parity check is acceptable.
5. Implement Option B for the system-quality model.
6. Keep the output contract stable:

```text
emotion
probabilities
valence
arousal
confidence
source
updated_at
model_version
```

## References

- SEED-IV dataset/project description: https://bcmi.sjtu.edu.cn/home/seed/seed-iv.html
- MNE-Python PSD/Welch documentation: https://mne.tools/stable/generated/mne.io.Raw.html#mne.io.Raw.compute_psd
- Braindecode documentation for deep learning with raw EEG windows: https://braindecode.org/stable/
- pyRiemann documentation for covariance/Riemannian EEG pipelines: https://pyriemann.readthedocs.io/

## Next Engineering Steps

1. Replace mock `infer_mock_emotion` with a real adapter module.
2. Add a small ring buffer inside `neuro-music-service` for live 32-channel
   blocks.
3. Stream EEG sample blocks from React/Tauri into `predict_eeg_emotion`, or add
   a backend event bridge so Rust forwards blocks directly.
4. Let Music Regulation and Video Regulation both read `get_latest_eeg_emotion`.
5. Add DEMON process/session lifecycle management after the mock UI contract is
   stable.
