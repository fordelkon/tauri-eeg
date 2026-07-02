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

## DEAP DGCNN Binary Encoder Experiment

The stronger DEAP route should first train two binary EEG encoders instead of a
direct four-class DGCNN:

```text
DEAP EEG -> DE band windows -> DGCNN valence binary head
DEAP EEG -> DE band windows -> DGCNN arousal binary head
```

Then combine the two binary predictions into the four regulation classes:

```text
low valence + low arousal   -> depression -> sad
low valence + high arousal  -> anxiety    -> fear
high valence + low arousal  -> calm       -> neutral
high valence + high arousal -> happy      -> happy
```

Remote training example:

```bash
CUDA_VISIBLE_DEVICES=4 python tools/train_deap_dgcnn_binary.py \
  --source /root/piplineegmus/data/raw/DGCNN-DEAP \
  --task valence \
  --epochs 150 \
  --batch-size 512 \
  --lr 0.01 \
  --out-dir runs/deap_dgcnn_binary_20260702 \
  --cache-dir runs/deap_dgcnn_binary_20260702/cache

CUDA_VISIBLE_DEVICES=5 python tools/train_deap_dgcnn_binary.py \
  --source /root/piplineegmus/data/raw/DGCNN-DEAP \
  --task arousal \
  --epochs 150 \
  --batch-size 512 \
  --lr 0.01 \
  --out-dir runs/deap_dgcnn_binary_20260702 \
  --cache-dir runs/deap_dgcnn_binary_20260702/cache
```

After both runs finish:

```bash
python tools/combine_deap_binary_predictions.py \
  --valence runs/deap_dgcnn_binary_20260702/deap_dgcnn_valence_predictions.jsonl \
  --arousal runs/deap_dgcnn_binary_20260702/deap_dgcnn_arousal_predictions.jsonl \
  --out runs/deap_dgcnn_binary_20260702/deap_dgcnn_combined_4class_predictions.jsonl \
  --report runs/deap_dgcnn_binary_20260702/deap_dgcnn_combined_4class_report.json
```

The combined JSONL uses the same `pred_class` and `probabilities` fields as the
existing service replay script:

```bash
python tools/replay_prediction_jsonl_to_service.py \
  --predictions runs/deap_dgcnn_binary_20260702/deap_dgcnn_combined_4class_predictions.jsonl \
  --log runs/deap_dgcnn_binary_20260702/deap_dgcnn_service_replay.jsonl
```

This experiment belongs to the EEG encoder/pretraining stage. A useful encoder
can then be aligned to emotion text/audio/video CLIP embeddings before driving
DEMON realtime controls.

Current remote DEAP held-out-subject result on 2026-07-02:

```text
run: runs/deap_dgcnn_binary_20260702
valence binary trial balanced accuracy: 0.4587
arousal binary trial balanced accuracy: 0.5199
combined four-class balanced accuracy: 0.2084
service replay: runs/deap_dgcnn_binary_20260702/deap_dgcnn_service_replay.jsonl

run: runs/deap_dgcnn_binary_20260702_lowreg
valence binary trial balanced accuracy: 0.4678
arousal binary trial balanced accuracy: 0.5337
combined four-class balanced accuracy: 0.2301
service replay: runs/deap_dgcnn_binary_20260702_lowreg/deap_dgcnn_service_replay.jsonl
```

Interpretation: the service workflow is now validated end to end, but these
strict held-out-subject DEAP models are not accurate enough for real emotion
recognition. The next accuracy step should use subject-dependent or few-shot
personal calibration, then use the best encoder for EmotionCLIP alignment.

## DEAP Subject Calibration Experiment

When strict cross-subject generalization is weak, the next practical route is a
personal calibration model. The calibration script trains one small DGCNN per
subject:

```bash
CUDA_VISIBLE_DEVICES=4 python tools/train_deap_dgcnn_subject_calibration.py \
  --source /root/piplineegmus/data/raw/DGCNN-DEAP \
  --task valence \
  --subjects all \
  --split-mode fixed \
  --epochs 80 \
  --batch-size 256 \
  --lr 0.003 \
  --l2 0.0001 \
  --dropout 0.35 \
  --out-dir runs/deap_dgcnn_subject_fixed_20260702

CUDA_VISIBLE_DEVICES=5 python tools/train_deap_dgcnn_subject_calibration.py \
  --source /root/piplineegmus/data/raw/DGCNN-DEAP \
  --task arousal \
  --subjects all \
  --split-mode fixed \
  --epochs 80 \
  --batch-size 256 \
  --lr 0.003 \
  --l2 0.0001 \
  --dropout 0.35 \
  --out-dir runs/deap_dgcnn_subject_fixed_20260702
```

`--split-mode fixed` is important when combining valence and arousal into four
classes because both binary heads must predict the same held-out trials.

Remote fixed-split result on 2026-07-02:

```text
run: runs/deap_dgcnn_subject_fixed_20260702
valence binary overall balanced accuracy: 0.5683
valence mean subject balanced accuracy: 0.6015
arousal binary overall balanced accuracy: 0.5683
arousal mean subject balanced accuracy: 0.5635
combined four-class balanced accuracy: 0.3668
combined four-class accuracy: 0.3711
service replay: runs/deap_dgcnn_subject_fixed_20260702/deap_dgcnn_subject_service_replay.jsonl
```

This is better than strict cross-subject DEAP, but still not enough for a final
live product model. It supports the next system plan: collect real 32-channel
calibration EEG with the four-class paradigm, train/fine-tune a personal
encoder, then align that encoder with EmotionCLIP and multimodal emotion CLIP.

## DEAP Minimal EmotionCLIP Experiment

`tools/train_deap_emotionclip.py` tests the next-stage route:

```text
DEAP EEG DE-band windows
-> DGCNN EEG encoder
-> EEG-text contrastive pretraining with emotion prompts
-> zero-shot prompt classifier
-> frozen linear probe
-> fine-tuned classifier
```

This first version intentionally uses deterministic prompt-hash text features
so it can run on the remote server without downloading external language
models. It validates the training and service workflow, but it is not the final
text/audio/video CLIP model.

Remote result on 2026-07-02:

```text
run: runs/deap_emotionclip_fixed_20260702
zero-shot balanced accuracy: 0.3395
frozen-probe balanced accuracy: 0.2500
fine-tune balanced accuracy: 0.3521
best classifier: fine_tune
service replay: runs/deap_emotionclip_fixed_20260702/deap_emotionclip_service_replay.jsonl

run: runs/deap_emotionclip_cross_20260702
zero-shot balanced accuracy: 0.2719
frozen-probe balanced accuracy: 0.2500
fine-tune balanced accuracy: 0.2717
best classifier: zero_shot
```

Interpretation:

```text
fixed-calibration EmotionCLIP fine-tune: 0.3521 balanced accuracy
fixed-calibration direct DGCNN:          0.3668 balanced accuracy
cross-subject EmotionCLIP zero-shot:     0.2719 balanced accuracy
cross-subject direct DGCNN:              0.2301 balanced accuracy
```

The minimal EmotionCLIP improves strict cross-subject behavior but does not beat
the calibrated DGCNN. The likely bottleneck is the placeholder hash text side
and limited DEAP supervision. The next EmotionCLIP iteration should replace the
hash prompts with a real frozen text encoder and then extend the alignment to
audio/video emotion embeddings.

## DEAP Single-Subject Diagnostic

To check whether the low four-class accuracy is caused by the task itself or by
cross-subject/domain shift, four representative subjects were tested without
cross-subject training:

```text
subjects: 5, 10, 22, 24
split: fixed trial split, 60% train / 20% val / 20% test
test size: 8 trials per subject, 32 trials total
```

Remote result on 2026-07-02:

```text
run: runs/deap_single_subject_20260702
valence binary overall balanced accuracy: 0.7698
arousal binary overall balanced accuracy: 0.6926
binary-combined four-class balanced accuracy: 0.5972
direct four-class balanced accuracy: 0.6306
direct four-class service replay: runs/deap_single_subject_20260702/direct_4class_service_replay.jsonl
```

Per-subject balanced accuracy:

```text
subject 5:  valence 0.7500, arousal 0.5000, direct four-class 0.6000
subject 10: valence 0.7500, arousal 0.9286, direct four-class 0.8667
subject 22: valence 0.8333, arousal 0.5667, direct four-class 0.3750
subject 24: valence 0.5333, arousal 0.7500, direct four-class 0.5625
```

Interpretation: the four regulation classes are not impossible for a single
subject. The main degradation comes from cross-subject/domain shift and the
small number of held-out trials per subject. Different subjects prefer
different heads, so the live system should train both direct four-class and
valence/arousal binary heads during calibration, then select the better one on
the user's validation trials.

## Why This Is Separate From `music-service`

`music-service` generates offline WAV files with Stable Audio 3 Small Music.
`neuro-music-service` is a realtime control-plane service. It publishes the
latest EEG emotion label as a shared system signal so Music Regulation and
future Video Recommendation can consume the same label.
