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

## Corrected Experiment Route

The current model-improvement route is:

```text
DEAP/SEED-IV EEG encoder pretraining
-> EmotionCLIP EEG-text emotion alignment
-> emotion text/audio/video CLIP alignment
-> DEMON realtime music control
```

DGCNN is useful in this route as an EEG encoder baseline for DEAP, especially
because DEAP provides valence and arousal ratings. It should not be treated as
the final four-class application model by itself.

The corrected DEAP experiment is:

```text
DEAP 32ch raw EEG
-> differential entropy band windows
-> DGCNN valence binary classifier
-> DGCNN arousal binary classifier
-> combine binary outputs into depression/anxiety/calm/happy
-> replay through neuro-music-service
```

This preserves the regulation label contract while avoiding the known weakness
of direct four-quadrant classification on DEAP. The two binary DGCNN encoders
are candidates for the later EmotionCLIP alignment stage.

If held-out-subject accuracy remains weak, the next accuracy-focused branch is
not to force the four-class model. Instead:

```text
lower-regularization / multi-seed binary DGCNN
-> subject-dependent or few-shot personal calibration
-> optional SEED-IV/DEAP contrastive pretraining
-> EmotionCLIP alignment
```

The 2026-07-02 DEAP runs confirm this direction:

```text
strict cross-subject binary DGCNN:
  valence balanced accuracy: 0.4678
  arousal balanced accuracy: 0.5337
  combined four-class balanced accuracy: 0.2301

subject calibration DGCNN with fixed held-out trials:
  valence balanced accuracy: 0.5683
  arousal balanced accuracy: 0.5683
  combined four-class balanced accuracy: 0.3668
```

Subject calibration improves the signal enough to justify continuing, but it is
not yet production-grade. The next experimental stage should therefore use the
real 32-channel cap paradigm rather than relying on DEAP alone:

```text
record 5+ videos/class per user
-> train/fine-tune personal EEG encoder
-> evaluate same-session held-out trials and next-session transfer
-> use accepted encoder embeddings for EmotionCLIP alignment
-> expose only the stable emotion-label API to music/video consumers
```

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
recognition. The old `emotionBCI/emo_bci` design is a useful starting point,
but the production regulation system should use a smaller four-class paradigm
that matches the actual intervention targets:

```text
Session 1 - Baseline / labeled induction
  -> 20 video trials across 4 emotions
  -> collect raw 32ch EEG with trigger start/end timestamps
  -> collect subject self-report after each trial
  -> train or adapt a personal emotion classifier

Session 2 - Regulation / feedback validation
  -> run the same 32ch EEG stream through the calibrated classifier
  -> feed latest emotion label to music control and video recommendation
  -> collect feedback and compare with Session 1 baseline
```

The formal labels are:

```text
1 Depression -> system emotion sad
2 Anxiety    -> system emotion fear
3 Calm       -> system emotion neutral
4 Happy      -> system emotion happy
```

Each class needs at least five induction videos for the minimum runnable
paradigm. That gives 20 baseline trials per session:

```text
Depression 5 trials
Anxiety    5 trials
Calm       5 trials
Happy      5 trials
Total     20 trials / session
```

This is the minimum for system integration and first personal calibration, not
the recommended final research sample size. If model stability is weak, increase
the number of trials per class before adding more emotion categories.

Each trial has four phases:

```text
starting hint -> video watching -> ending hint -> feedback
```

The legacy settings assume 32 EEG channels, 2000 Hz sampling, and a TCP EEG
source on port 9687. The current Tauri backend usually exposes 32 channels at
1000 Hz and emits 50 ms channel-major sample blocks. That difference is not a
blocking issue, but the calibration recorder must persist the actual sampling
rate, channel ids, trigger times, and device metadata for every trial.

### Label Space

The realtime system contract uses the four SEED-IV-compatible labels:

```text
neutral, sad, fear, happy
```

The four-class paradigm maps directly to that contract:

```text
Depression -> sad
Anxiety    -> fear
Calm       -> neutral
Happy      -> happy
```

Do not train `Fear`, `Joy`, or `Surprise` as formal classes for the minimum
system module. They can remain in an exploratory stimulus pool, but adding them
to the classifier increases confusion without adding a direct regulation action:

```text
Fear     overlaps operationally with Anxiety / high-arousal negative
Joy      overlaps operationally with Happy / positive
Surprise has unstable valence and should be resolved by self-report first
```

Expose both the paradigm label and the system label so later modules can choose
the level they need:

```text
paradigm_emotion: Depression | Anxiety | Calm | Happy
system_emotion: neutral | sad | fear | happy
valence: float
arousal: float
confidence: float
```

### Music Regulation Strategy

The realtime music module should not simply mirror the detected emotion. It
should generate or steer music toward the desired regulation direction:

```text
Detected depression / sad
  -> goal: raise valence and gently raise arousal
  -> music: warm major/minor-to-major harmony, moderate tempo, gradual energy
  -> avoid: very slow, sparse, dark, or rumination-heavy textures
  -> DEMON control: increase positive timbre channels, moderate guidance,
     slowly reduce sad-channel emphasis after the first adaptation window

Detected anxiety / fear
  -> goal: lower arousal first, then stabilize valence
  -> music: steady low-to-mid tempo, soft attack, predictable rhythm,
     low dissonance, breathing-like phrasing
  -> avoid: abrupt transitions, high percussion density, sharp transients,
     fast tempo, high-frequency tension
  -> DEMON control: reduce arousal/shift intensity, keep denoise moderate,
     favor calm/neutral texture and smooth changes

Detected calm / neutral
  -> goal: maintain stable low arousal and prevent drift to negative state
  -> music: ambient, light acoustic/electronic texture, stable tempo,
     low novelty, low dynamic range
  -> avoid: strong emotional pushes unless the user asks for activation
  -> DEMON control: conservative parameter changes, low feedback depth,
     neutral channel emphasis

Detected happy
  -> goal: maintain positive valence without overstimulation
  -> music: bright harmony, moderate rhythmic motion, melodic continuity,
     controlled energy
  -> avoid: excessive intensity that could push anxious arousal
  -> DEMON control: maintain positive timbre channels, cap arousal-related
     shift/guidance, keep transitions smooth
```

The same emotion label can also drive video recommendation, but the target is
the same regulation intent rather than a music-specific control:

```text
sad        -> positive activation content
fear       -> calming / grounding content
neutral    -> maintenance content
happy      -> positive maintenance content
```

For safety, changes should be gradual. A detected label should be smoothed over
multiple EEG windows before large music-control changes, and user override must
take priority over automatic steering.

### Minimum Data Contract For Calibration

Each calibration trial should save:

```text
subject_id
session_id
trial_id
phase
paradigm_emotion
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
2. Use the four-class video-folder organization for induction stimuli:

```text
database/Depression
database/Anxiety
database/Calm
database/Happy
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
