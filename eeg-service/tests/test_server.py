from __future__ import annotations

import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from core.ring_buffer import RingBuffer
from core.synth import synth_epoch
from runtime import ServiceState
from server import create_app

SFREQ = 250
CHANNELS = 32


@pytest.fixture()
def client():
    state = ServiceState()
    with TestClient(create_app(state)) as test_client:
        # Expose the state for direct buffer manipulation in tests.
        test_client.state_obj = state  # type: ignore[attr-defined]
        yield test_client
    state.stop_simulation()


def test_health_contract_shape(client):
    payload = client.get("/eeg/health").json()
    assert set(payload) == {"ok", "lsl", "modelLoaded", "simulating"}
    assert payload["ok"] is True
    assert payload["modelLoaded"] is False
    assert payload["simulating"] is False
    assert set(payload["lsl"]) == {"found", "name", "sfreq", "channels"}
    # Without pylsl and without the simulator, nothing is "found".
    assert payload["lsl"]["found"] is False
    assert payload["lsl"]["name"] is None


def test_sim_lifecycle_reports_in_health(client):
    response = client.post(
        "/eeg/sim/start", json={"profile": "negative", "channels": CHANNELS, "sfreq": SFREQ}
    )
    assert response.status_code == 200
    assert response.json() == {"started": True}

    time.sleep(0.8)
    health = client.get("/eeg/health").json()
    assert health["simulating"] is True
    # The running simulator counts as the LSL source for /eeg/health even on
    # machines without liblsl (ingestion is in-process).
    assert health["lsl"] == {
        "found": True,
        "name": "SimEEG",
        "sfreq": SFREQ,
        "channels": CHANNELS,
    }

    assert client.post("/eeg/sim/stop").json() == {"stopped": True}
    assert client.get("/eeg/health").json()["simulating"] is False


def test_sim_start_validation(client):
    bad_profile = client.post("/eeg/sim/start", json={"profile": "excited"})
    assert bad_profile.status_code == 422
    bad_channels = client.post("/eeg/sim/start", json={"channels": 4})
    assert bad_channels.status_code == 422
    bad_sfreq = client.post("/eeg/sim/start", json={"sfreq": 100})
    assert bad_sfreq.status_code == 422


def test_calibration_and_decode_contract(client):
    # A pre-configured buffer pins the calibration to 16 channels, matching
    # the windows decoded later in this test.
    state = client.state_obj
    state.buffer = RingBuffer(CHANNELS, SFREQ, capacity_seconds=60.0)

    calibration = client.post(
        "/eeg/calibrate",
        json={"states": ["negative", "calm"], "epochsPerState": 12, "epochSeconds": 3.0},
    )
    assert calibration.status_code == 200
    summary = calibration.json()
    assert summary["trained"] is True
    assert set(summary["classes"]) == {"negative", "calm"}
    assert summary["nEpochs"] == 24
    assert 0.0 < summary["cvAccuracy"] <= 1.0

    # Buffer still empty: pTarget stays null but the contract fields exist.
    empty = client.get("/eeg/decode").json()
    assert set(empty) == {"t", "pTarget", "targetClass", "features", "modelLoaded"}
    assert empty["modelLoaded"] is True
    assert empty["pTarget"] is None
    assert empty["targetClass"] == "calm"
    assert empty["features"] == {"badChannels": 0}

    # Single windows overlap by design (CV < 1.0), so the ordering claim is
    # made on class means over several pushed windows each.
    rng = np.random.default_rng(20)

    def decode_after(label: str) -> float:
        state.buffer.push(
            synth_epoch(label, 2.0, CHANNELS, SFREQ, rng),
            end_timestamp=state.buffer.last_timestamp + 3.0,
        )
        return client.get("/eeg/decode").json()["pTarget"]

    calm_scores = [decode_after("calm") for _ in range(4)]
    negative_scores = [decode_after("negative") for _ in range(4)]
    assert all(0.0 <= p <= 1.0 for p in calm_scores + negative_scores)
    assert np.mean(calm_scores) > np.mean(negative_scores) + 0.1


def test_decode_target_switch_and_reject(client):
    assert client.get("/eeg/decode").json()["targetClass"] == "calm"
    # Before any calibration there are no classes to switch between.
    assert client.post("/eeg/decode/target", json={"targetClass": "calm"}).status_code == 409

    state = client.state_obj
    state.buffer = RingBuffer(CHANNELS, SFREQ, capacity_seconds=60.0)
    assert client.post(
        "/eeg/calibrate",
        json={"states": ["negative", "calm"], "epochsPerState": 4, "epochSeconds": 1.0},
    ).status_code == 200

    switched = client.post("/eeg/decode/target", json={"targetClass": "negative"})
    assert switched.status_code == 200
    assert switched.json() == {"targetClass": "negative"}
    assert client.get("/eeg/decode").json()["targetClass"] == "negative"

    # "positive" was never calibrated, so it cannot become the target.
    assert client.post("/eeg/decode/target", json={"targetClass": "positive"}).status_code == 409


def test_decode_target_requires_model(client):
    response = client.post("/eeg/decode/target", json={"targetClass": "calm"})
    assert response.status_code == 409


def test_calibrate_from_stream_uses_labeled_segments(client):
    state = client.state_obj
    rng = np.random.default_rng(31)
    state.buffer = RingBuffer(CHANNELS, SFREQ, capacity_seconds=600.0)

    t0 = time.time()
    cursor = t0
    for label in ("negative", "calm"):
        state.on_marker(f"state:{label}", cursor)
        for _ in range(32):  # 8 s per state in 0.25 s chunks
            block = synth_epoch(label, 0.25, CHANNELS, SFREQ, rng)
            cursor += 0.25
            state.ingest_block(block, cursor)

    response = client.post(
        "/eeg/calibrate/from-stream",
        json={"states": ["negative", "calm"], "epochsPerState": 2, "epochSeconds": 3.0},
    )
    assert response.status_code == 200
    summary = response.json()
    assert summary["trained"] is True
    assert summary["nEpochs"] == 4
    assert set(summary["classes"]) == {"negative", "calm"}

    # With a buffer configured, decode now answers with a probability.
    state.buffer.push(
        synth_epoch("calm", 2.0, CHANNELS, SFREQ, rng), end_timestamp=time.time()
    )
    decode = client.get("/eeg/decode").json()
    assert decode["pTarget"] is not None


def test_calibrate_from_stream_reports_missing_state(client):
    state = client.state_obj
    rng = np.random.default_rng(32)
    state.buffer = RingBuffer(CHANNELS, SFREQ, capacity_seconds=600.0)
    state.on_marker("state:negative", time.time())
    cursor = time.time()
    for _ in range(24):
        cursor += 0.25
        state.ingest_block(synth_epoch("negative", 0.25, CHANNELS, SFREQ, rng), cursor)

    response = client.post(
        "/eeg/calibrate/from-stream",
        json={"states": ["negative", "calm"], "epochsPerState": 2, "epochSeconds": 3.0},
    )
    assert response.status_code == 409
    assert "calm" in response.json()["detail"]


def test_calibrate_rejects_duplicate_states(client):
    response = client.post(
        "/eeg/calibrate", json={"states": ["calm", "calm"]}
    )
    assert response.status_code == 422


def test_sim_profile_switch_requires_running_sim(client):
    assert client.post("/eeg/sim/profile", json={"profile": "calm"}).status_code == 409
