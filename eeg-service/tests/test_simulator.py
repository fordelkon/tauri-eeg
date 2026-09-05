from __future__ import annotations

import time

import numpy as np
import pytest

import lsl_io.simulator as simulator
from core.ring_buffer import RingBuffer
from lsl_io.simulator import (
    EEG_STREAM_NAME,
    MARKER_STREAM_NAME,
    SimulatedStream,
    create_outlets,
    start_sim_stream,
)


def test_missing_pylsl_reports_clear_chinese_error(monkeypatch):
    def fake_import():
        raise RuntimeError(
            "未检测到可用的 pylsl/liblsl 原生库，无法发布 LSL 流。"
        )

    monkeypatch.setattr(simulator, "import_pylsl", fake_import)
    with pytest.raises(RuntimeError, match="pylsl"):
        create_outlets(64, 250)


def test_sim_thread_feeds_buffer_and_markers_without_pylsl():
    buffer = RingBuffer(channels=16, sfreq=250.0, capacity_seconds=60.0)
    markers: list[str] = []

    stream = start_sim_stream(
        channels=16,
        sfreq=250,
        profile="negative",
        sink=lambda block, ts: buffer.push(block, ts),
        on_marker=lambda label, ts: markers.append(label),
        chunk_seconds=0.05,
        require_outlet=False,
    )
    try:
        assert stream.running
        time.sleep(0.7)
        available = buffer.seconds_available()
        # Real-time pacing: roughly the waited time, with scheduler slack.
        assert 0.4 <= available <= 2.0
        window = buffer.latest(0.2)
        assert window is not None and np.isfinite(window).all()
    finally:
        stream.stop()

    assert not stream.running
    # set_profile must announce the switch through the marker callback even
    # without outlets, because the service records buffer segments from it.
    stream.set_profile("calm")
    assert "state:calm" in markers


def test_set_profile_announces_state_marker():
    stream = SimulatedStream(
        16, 250, "negative", sink=lambda *_: None, on_marker=lambda *_: None
    )
    seen: list[str] = []
    stream.on_marker = lambda label, ts: seen.append(label)
    stream.set_profile("regulation_drift")
    assert seen == ["state:regulation_drift"]


def test_drift_progress_advances_with_time():
    stream = SimulatedStream(
        16,
        250,
        "regulation_drift",
        sink=lambda *_: None,
        on_marker=lambda *_: None,
        drift_seconds=0.2,
    )
    assert stream._drift_progress("regulation_drift") == 0.0
    time.sleep(0.35)
    assert stream._drift_progress("regulation_drift") == pytest.approx(1.0)
    # Progress only exists for the drift profile.
    assert stream._drift_progress("calm") == 0.0


def test_outlets_created_with_contract_names_and_rates():
    pylsl = pytest.importorskip("pylsl")
    eeg_outlet, marker_outlet = create_outlets(16, 250)
    eeg_info = eeg_outlet.info()
    assert eeg_info.name() == EEG_STREAM_NAME
    assert eeg_info.type() == "EEG"
    assert eeg_info.nominal_srate() == pytest.approx(250.0)
    assert eeg_info.channel_count() == 16
    marker_info = marker_outlet.info()
    assert marker_info.name() == MARKER_STREAM_NAME
    assert marker_info.nominal_srate() == pytest.approx(0.0)  # irregular
    # Touch pylsl explicitly so the importorskip stays meaningful.
    assert hasattr(pylsl, "StreamOutlet")
