"""Server-side state: ingestion buffer, labeled segments, decoder, simulator.

One threading.Lock guards every mutation. uvicorn runs a single worker, so a
plain lock is enough to make calibration/decode/sim-control safe against the
simulator's ingestion thread.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone

import numpy as np

from core.decoder import OnlineDecoder
from core.ring_buffer import RingBuffer
from core.synth import STATE_NAMES
from lsl_io.simulator import SimulatedStream, probe_eeg_stream, start_sim_stream

DEFAULT_CHANNELS = 64
DEFAULT_SFREQ = 250
DEFAULT_BUFFER_SECONDS = 600.0
# Freshly opened segments start with filter/estimator warm-up; skip this much
# of a segment's head when cutting calibration windows.
SEGMENT_WARMUP_S = 0.75
_PROBE_CACHE_SECONDS = 10.0
# Target class until a calibration decides otherwise: the closed loop
# maximizes P(desired state), and "calm" is the desired state by convention.
DEFAULT_TARGET = "calm"
# Module-level so the probe cache survives ServiceState recreation in tests.
_probe_cache: tuple[dict[str, object] | None, float] = (None, 0.0)


def _buffer_seconds() -> float:
    raw = os.environ.get("EEG_SERVICE_BUFFER_SECONDS", "").strip()
    try:
        value = float(raw) if raw else DEFAULT_BUFFER_SECONDS
    except ValueError:
        value = DEFAULT_BUFFER_SECONDS
    return max(30.0, value)


class Segment:
    """A time range during which one ground-truth state was active."""

    __slots__ = ("state", "start", "end")

    def __init__(self, state: str, start: float) -> None:
        self.state = state
        self.start = start
        self.end = start  # extended when the segment closes

    def covers(self, end_ts: float, window_seconds: float) -> bool:
        return self.start + SEGMENT_WARMUP_S + window_seconds <= end_ts <= self.end


class ServiceState:
    """Owns every mutable piece of the service; endpoints go through it."""

    def __init__(self, model_path: str | None = None) -> None:
        self.lock = threading.Lock()
        self.buffer: RingBuffer | None = None
        self.segments: list[Segment] = []
        self.open_segment: Segment | None = None
        self.open_state: str | None = None
        self.decoder: OnlineDecoder | None = None
        self.sim: SimulatedStream | None = None
        self.sim_lsl_note: str | None = None
        self.model_path = model_path

    # ------------------------------------------------------------------ sim

    def start_simulation(
        self, profile: str, channels: int, sfreq: int
    ) -> None:
        # Never join the old simulator thread while holding self.lock: its
        # ingestion callback needs that lock, so joining under it stalls for
        # the full join timeout.
        with self.lock:
            old_sim = self.sim
            self.sim = None
        if old_sim is not None:
            old_sim.stop()

        with self.lock:
            # A new channel count invalidates any trained model and all
            # segments recorded against the previous stream.
            self.buffer = RingBuffer(channels, sfreq, _buffer_seconds())
            self.segments = []
            self.open_segment = None
            self.open_state = None
            self.decoder = None

        try:
            sim = start_sim_stream(
                channels=channels,
                sfreq=sfreq,
                profile=profile,
                sink=self.ingest_block,
                on_marker=self.on_marker,
            )
            note = None
        except RuntimeError as exc:
            # No liblsl on this machine: keep the demo alive in-process.
            sim = start_sim_stream(
                channels=channels,
                sfreq=sfreq,
                profile=profile,
                sink=self.ingest_block,
                on_marker=self.on_marker,
                require_outlet=False,
            )
            note = str(exc)

        with self.lock:
            self.sim = sim
            self.sim_lsl_note = note
            self._open_segment_locked(profile, time.time())
        if note:
            # One-line operator hint instead of a crash: ingestion continues
            # in-process, only the outward LSL publication is missing.
            print(note)

    def stop_simulation(self) -> None:
        with self.lock:
            sim = self.sim
            self.sim = None
        if sim is not None:
            sim.stop()
        with self.lock:
            self._close_segment_locked(time.time())

    def ingest_block(self, block: np.ndarray, end_timestamp: float) -> None:
        """Simulator thread callback; runs on the ingestion thread."""
        with self.lock:
            if self.buffer is None:
                return
            self.buffer.push(block, end_timestamp)
            # Keep the open segment's end at the newest sample so windows can
            # be cut from a state that is still being collected.
            if self.open_segment is not None:
                self.open_segment.end = end_timestamp
            horizon = self.buffer.last_timestamp - self.buffer.capacity / self.buffer.sfreq
            # Drop segments that aged out of the ring buffer.
            self.segments = [s for s in self.segments if s.end >= horizon]

    def on_marker(self, label: str, timestamp: float) -> None:
        """Marker callback for state switches and heartbeats."""
        if not label.startswith("state:"):
            return
        state = label.split(":", 1)[1]
        with self.lock:
            if state == self.open_state:
                return
            self._close_segment_locked(timestamp)
            self._open_segment_locked(state, timestamp)

    def _open_segment_locked(self, state: str, timestamp: float) -> None:
        if state not in STATE_NAMES:
            return
        self.open_state = state
        self.open_segment = Segment(state, timestamp)
        self.segments.append(self.open_segment)

    def _close_segment_locked(self, timestamp: float) -> None:
        if self.open_segment is None:
            return
        self.open_segment.end = timestamp
        self.open_segment = None
        self.open_state = None

    def set_sim_profile(self, profile: str) -> None:
        with self.lock:
            if self.sim is None:
                raise RuntimeError("模拟流未启动，请先调用 /eeg/sim/start")
            sim = self.sim
        # set_profile emits a state marker whose callback re-enters self.lock,
        # so the switch itself must happen outside the lock.
        sim.set_profile(profile)

    def lsl_status(self) -> dict[str, object]:
        """Health payload for the lsl block; prefers our own live simulator.

        Probing the network with pylsl costs up to its timeout, so probe
        results are cached briefly to keep /eeg/health fast enough for the
        frontend's 800 ms tolerance.
        """
        with self.lock:
            sim = self.sim
            buffer = self.buffer
            if sim is not None and buffer is not None:
                return {
                    "found": True,
                    "name": "SimEEG",
                    "sfreq": buffer.sfreq,
                    "channels": buffer.channels,
                }
        global _probe_cache
        now = time.monotonic()
        cached, cached_at = _probe_cache
        if cached is None or now - cached_at > _PROBE_CACHE_SECONDS:
            cached = probe_eeg_stream(timeout=0.5)
            _probe_cache = (cached, now)
        return cached

    # ------------------------------------------------------------ calibration

    def calibration_windows_from_stream(
        self, states: list[str], epochs_per_state: int, epoch_seconds: float
    ) -> tuple[list[np.ndarray], list[str]]:
        with self.lock:
            buffer = self.buffer
            if buffer is None or buffer.seconds_available() < epoch_seconds:
                raise RuntimeError("摄入缓冲中没有足够的流数据，请先启动模拟流或接入真实设备")
            windows: list[np.ndarray] = []
            labels: list[str] = []
            missing: dict[str, int] = {}
            for state in states:
                got = self._windows_for_state_locked(
                    buffer, state, epochs_per_state, epoch_seconds
                )
                if len(got) < epochs_per_state:
                    missing[state] = len(got)
                windows.extend(got)
                labels.extend([state] * len(got))
            if missing:
                raise RuntimeError(
                    "流中可用数据不足，无法完成标定: "
                    + ", ".join(f"{state} 只有 {n} 个窗口" for state, n in missing.items())
                    + f"（每个状态需要 {epochs_per_state} 个）。"
                    "请用 /eeg/sim/profile 切换状态并等待数据积累。"
                )
            return windows, labels

    def _windows_for_state_locked(
        self, buffer: RingBuffer, state: str, count: int, epoch_seconds: float
    ) -> list[np.ndarray]:
        found: list[np.ndarray] = []
        # Newest segments first: calibration should reflect the most recent
        # signal statistics of each state.
        for segment in reversed(self.segments):
            if segment.state != state or len(found) >= count:
                continue
            candidates = buffer.recent_windows(
                epoch_seconds,
                count - len(found),
                epoch_seconds,
                min_end_timestamp=segment.start + SEGMENT_WARMUP_S + epoch_seconds,
                max_end_timestamp=segment.end,
            )
            found.extend(window for window, _ in candidates)
        return found

    def train_decoder(
        self, epochs: list[np.ndarray], labels: list[str]
    ) -> dict[str, object]:
        with self.lock:
            channels = self.buffer.channels if self.buffer is not None else DEFAULT_CHANNELS
            sfreq = self.buffer.sfreq if self.buffer is not None else DEFAULT_SFREQ
            decoder = OnlineDecoder(channels, sfreq)
            summary = decoder.train(epochs, labels)
            self.decoder = decoder
            if self.model_path:
                try:
                    decoder.save(self.model_path)
                except OSError:
                    # Persistence is best-effort; the in-memory model stays.
                    pass
            return summary

    def load_saved_model(self) -> bool:
        if not self.model_path or not os.path.exists(self.model_path):
            return False
        try:
            decoder = OnlineDecoder.load(self.model_path)
        except Exception:
            return False
        with self.lock:
            self.decoder = decoder
        return True

    # ----------------------------------------------------------------- decode

    def decode_snapshot(self) -> dict[str, object]:
        """Build the GET /eeg/decode payload.

        The window copy and the target read happen under the lock; the SVM
        inference itself runs outside it so polling clients never queue
        behind each other's model calls.
        """
        with self.lock:
            decoder = self.decoder
            buffer = self.buffer
            target = decoder.target_class if decoder is not None else DEFAULT_TARGET
            usable = (
                decoder is not None
                and buffer is not None
                and buffer.channels == decoder.channels
            )
            window = buffer.latest(decoder.window_seconds) if usable else None

        p_target: float | None = None
        bad_channels = 0
        if decoder is not None and window is not None:
            probs, info = decoder.predict_proba_with_info(window)
            p_target = probs.get(target)
            bad_channels = info["badChannels"]

        return {
            "t": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "pTarget": p_target,
            "targetClass": target,
            "features": {"badChannels": bad_channels},
            "modelLoaded": decoder is not None,
        }

    def set_target(self, target_class: str) -> None:
        with self.lock:
            decoder = self.decoder
        if decoder is None:
            raise RuntimeError("尚未标定模型，请先调用 /eeg/calibrate")
        decoder.set_target(target_class)
