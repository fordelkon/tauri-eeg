# EEG Decoding Service

Local FastAPI service (port `8010`) for the EEG closed-loop paradigm: LSL ingestion,
preprocessing, band differential-entropy (DE) features, an individualized calibrated
SVM, and online `P(target state)` output. The service ships with a synthetic EEG
simulator, so calibration and online decoding run end-to-end without an amplifier.

## Layout

```text
eeg-service/
├── server.py            # FastAPI endpoints (contract surface), port 8010
├── runtime.py           # Service state: buffer, labeled segments, decoder, simulator
├── core/                # Algorithm layer — never imports pylsl
│   ├── ring_buffer.py   # Fixed-capacity ring buffer for streaming blocks
│   ├── preprocess.py    # 1–45 Hz bandpass, 50 Hz notch, bad-channel repair, avg reference
│   ├── features.py      # Per-channel 5-band DE + optional 6-ROI compression
│   ├── synth.py         # Synthetic EEG generator (stateful stream + one-shot epochs)
│   └── decoder.py       # Calibrated linear SVM (sigmoid), joblib save/load
├── lsl_io/
│   └── simulator.py     # The only pylsl-aware module; lazy imports, Chinese error
│                        # when liblsl is missing
├── tests/
├── pyproject.toml       # uv dependency source
└── requirements-eeg.txt # pip fallback for environments without uv
```

Core design rules:

- `core/` is pylsl-free (numpy/scipy/scikit-learn only) so CI and machines without
  the native liblsl library can run calibration, features, and tests.
- `lsl_io/simulator.py` imports pylsl lazily inside functions. Without liblsl the
  simulator keeps running in-process (the service still ingests every sample); only
  the outward LSL publication is skipped, with a clear Chinese message logged once.
- The simulator feeds the ring buffer in-process, so `/eeg/calibrate/from-stream`
  and `/eeg/decode` behave identically for the simulated stream and a real device.

## Setup

```bash
cd eeg-service
uv sync
```

Without uv:

```bash
cd eeg-service
python -m venv .venv
.venv\Scripts\pip install -r requirements-eeg.txt   # PowerShell: .venv\Scripts\Activate.ps1
```

Optional: make pylsl available (only needed to publish the simulated stream to
other LSL consumers or to probe real device streams in `/eeg/health`):

```powershell
uv pip install pylsl   # requires the liblsl native library on this machine
```

## Run

```bash
uv run python server.py
```

The service listens on `http://127.0.0.1:8010`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/eeg/health` | `{ok, lsl:{found,name,sfreq,channels}, modelLoaded, simulating}` |
| POST | `/eeg/sim/start` | Start the simulated stream and ingestion `{profile, channels?, sfreq?}` |
| POST | `/eeg/sim/stop` | Stop stream and ingestion |
| POST | `/eeg/sim/profile` | Switch the simulated ground-truth state (demo/driver helper) |
| POST | `/eeg/calibrate` | No-device calibration from synthetic epochs |
| POST | `/eeg/calibrate/from-stream` | Calibration windows cut from the ingestion buffer |
| GET | `/eeg/decode` | `{t, pTarget, targetClass, features:{badChannels}, modelLoaded}` |
| POST | `/eeg/decode/target` | Switch the target class used for `pTarget` |

`profile` is one of `negative | calm | regulation_drift | positive`;
`sfreq` is one of `250 | 512 | 1024 | 2048` Hz (default 250, default 64 channels).
The decoder runs a 2 s sliding window; `regulation_drift` walks from the negative
profile to the calm profile over 24 s to mirror the paradigm's reappraisal phase.

Polling endpoints (`/eeg/health`, `/eeg/decode`) answer in a few milliseconds;
calibration runs on a worker thread so the event loop and the 800 ms polling
tolerance are never blocked by training.

## Smoke test (curl)

```bash
curl http://127.0.0.1:8010/eeg/health

curl -X POST http://127.0.0.1:8010/eeg/sim/start \
  -H "Content-Type: application/json" \
  -d '{"profile": "negative"}'

# No-device path: synthetic epochs with per-epoch individual gains.
curl -X POST http://127.0.0.1:8010/eeg/calibrate \
  -H "Content-Type: application/json" \
  -d '{"states": ["negative", "calm"], "epochsPerState": 20, "epochSeconds": 4.0}'

curl http://127.0.0.1:8010/eeg/decode

curl -X POST http://127.0.0.1:8010/eeg/decode/target \
  -H "Content-Type: application/json" \
  -d '{"targetClass": "calm"}'

curl -X POST http://127.0.0.1:8010/eeg/sim/stop
```

Stream-based calibration (works the same way with a real amplifier once an LSL
inlet feeds the buffer): let each state run for a while, switching with
`/eeg/sim/profile`, then calibrate from the labeled segments:

```bash
curl -X POST http://127.0.0.1:8010/eeg/sim/start -H "Content-Type: application/json" -d '{"profile": "negative"}'
# ... wait ~10 s ...
curl -X POST http://127.0.0.1:8010/eeg/sim/profile -H "Content-Type: application/json" -d '{"profile": "calm"}'
# ... wait ~10 s ...
curl -X POST http://127.0.0.1:8010/eeg/calibrate/from-stream \
  -H "Content-Type: application/json" \
  -d '{"states": ["negative", "calm"], "epochsPerState": 5, "epochSeconds": 4.0}'
```

If a state has too few windows in the buffer, the endpoint returns HTTP 409 with
a Chinese message telling which state needs more data.

## Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `EEG_SERVICE_BUFFER_SECONDS` | `600` | Ring buffer capacity for stream ingestion |
| `EEG_SERVICE_MODEL_PATH` | unset (memory only) | joblib path; calibration saves here, startup reloads |

## Tests

```bash
cd eeg-service
uv run python -m pytest -q
```

Tests cover the algorithm core (buffer, preprocessing, features, synthetic
separability, SVM calibration/inference) and the HTTP contract via FastAPI's
TestClient with the synthetic path monkeypatch-free — no real LSL required.
The pylsl outlet test is skipped automatically when pylsl/liblsl is absent.
