"""LSL adapter layer for the synthetic EEG source.

This module owns every pylsl import. Imports are lazy (inside functions) and
a missing native liblsl surfaces as a Chinese RuntimeError instead of a
crash, so the service can still run its in-process simulation path on
machines without LSL. Nothing here performs signal math — synthesis lives in
``core.synth``; this layer only transports samples and markers.
"""
from __future__ import annotations

import threading
import time
from typing import Callable

import numpy as np

from core.synth import DRIFT_DURATION_S, STATE_NAMES, SynthStream, state_multipliers

EEG_STREAM_NAME = "SimEEG"
MARKER_STREAM_NAME = "SimMarkers"
EEG_SOURCE_ID = "tauri-eeg-sim-eeg"
MARKER_SOURCE_ID = "tauri-eeg-sim-markers"
# Allowed rates follow the hardware profiles the amplifier can produce.
SUPPORTED_SFREQS = (250, 512, 1024, 2048)
HEARTBEAT_MARKER = "sim_beat"
HEARTBEAT_MIN_S = 4.0
HEARTBEAT_MAX_S = 9.0

# Sink receives (block, end_timestamp) per chunk; on_marker receives
# (label, timestamp) at every state switch and heartbeat.
Sink = Callable[[np.ndarray, float], None]
MarkerSink = Callable[[str, float], None]


def import_pylsl():
    """Lazy pylsl import with a clear Chinese error instead of a traceback."""
    try:
        import pylsl  # type: ignore
    except Exception as exc:  # ImportError plus liblsl load failures
        raise RuntimeError(
            "未检测到可用的 pylsl/liblsl 原生库，无法发布 LSL 流。"
            "请先安装 liblsl（https://github.com/sccn/liblsl/releases）后执行 "
            "`pip install pylsl`；不安装也可以继续使用服务内部的模拟摄入。"
        ) from exc
    return pylsl


def create_outlets(channels: int, sfreq: float) -> tuple[object, object]:
    """Create the SimEEG outlet plus the irregular SimMarkers outlet."""
    pylsl = import_pylsl()
    info = pylsl.StreamInfo(
        name=EEG_STREAM_NAME,
        type="EEG",
        channel_count=channels,
        nominal_srate=sfreq,
        channel_format="float32",
        source_id=EEG_SOURCE_ID,
    )
    marker_info = pylsl.StreamInfo(
        name=MARKER_STREAM_NAME,
        type="Markers",
        channel_count=1,
        nominal_srate=0,  # 0 marks an irregular stream: markers are event-driven
        channel_format="string",
        source_id=MARKER_SOURCE_ID,
    )
    return pylsl.StreamOutlet(info), pylsl.StreamOutlet(marker_info)


def probe_eeg_stream(timeout: float = 0.5) -> dict[str, object]:
    """Resolve one live EEG stream for /eeg/health; pylsl-free machines
    simply report not-found instead of failing."""
    try:
        pylsl = import_pylsl()
    except RuntimeError:
        return {"found": False, "name": None, "sfreq": None, "channels": None}
    streams = pylsl.resolve_byprop("type", "EEG", timeout=timeout)
    if not streams:
        return {"found": False, "name": None, "sfreq": None, "channels": None}
    info = streams[0].info()
    return {
        "found": True,
        "name": info.name(),
        "sfreq": info.nominal_srate(),
        "channels": info.channel_count(),
    }


class SimulatedStream:
    """Background thread that synthesizes EEG at real-time pace.

    Samples flow through two doors: the optional pylsl outlets (only when
    liblsl is present) and the in-process sink, which feeds the service's
    ring buffer so calibration/decode work identically with or without LSL.
    """

    def __init__(
        self,
        channels: int,
        sfreq: int,
        profile: str,
        *,
        sink: Sink,
        on_marker: MarkerSink,
        drift_seconds: float = DRIFT_DURATION_S,
        chunk_seconds: float = 0.2,
        seed: int | None = None,
        outlets: tuple[object, object] | None = None,
    ) -> None:
        if profile not in STATE_NAMES:
            raise ValueError(f"unknown profile {profile!r}, expected one of {STATE_NAMES}")
        self.channels = channels
        self.sfreq = sfreq
        self.chunk_seconds = chunk_seconds
        self.sink = sink
        self.on_marker = on_marker
        self.drift_seconds = drift_seconds
        self.outlets = outlets

        self._rng = np.random.default_rng(seed)
        self._synth = SynthStream(channels, sfreq, self._rng)
        self._lock = threading.Lock()
        self._profile = profile
        self._drift_anchor = time.monotonic()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def profile(self) -> str:
        with self._lock:
            return self._profile

    def set_profile(self, profile: str) -> None:
        if profile not in STATE_NAMES:
            raise ValueError(f"unknown profile {profile!r}, expected one of {STATE_NAMES}")
        with self._lock:
            self._profile = profile
            self._drift_anchor = time.monotonic()
        # Announce the switch so the service can label buffer segments; the
        # callback runs on the caller's thread and takes the service lock
        # itself, so it must happen outside our own lock.
        label = f"state:{profile}"
        self.on_marker(label, time.time())
        self.push_marker(label)

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("simulator thread already running")
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run, name="eeg-sim-stream", daemon=True
        )
        self._thread.start()

    def stop(self, join_timeout: float = 2.0) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(join_timeout)
            self._thread = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _drift_progress(self, multipliers_state: str) -> float:
        if multipliers_state != "regulation_drift":
            return 0.0
        with self._lock:
            elapsed = time.monotonic() - self._drift_anchor
        return min(1.0, elapsed / max(self.drift_seconds, 1e-6))

    def _run(self) -> None:
        next_tick = time.monotonic()
        next_heartbeat = next_tick + self._rng.uniform(HEARTBEAT_MIN_S, HEARTBEAT_MAX_S)
        while not self._stop_event.is_set():
            now = time.monotonic()
            with self._lock:
                profile = self._profile
            multipliers = state_multipliers(
                profile, self._drift_progress(profile)
            )
            chunk = self._synth.next_chunk(self.chunk_seconds, multipliers)
            end_ts = time.time()
            self.sink(chunk, end_ts)

            if self.outlets is not None:
                self._push_outlets(chunk)
            if now >= next_heartbeat:
                self.on_marker(HEARTBEAT_MARKER, end_ts)
                self.push_marker(HEARTBEAT_MARKER)
                next_heartbeat = now + self._rng.uniform(HEARTBEAT_MIN_S, HEARTBEAT_MAX_S)

            next_tick += self.chunk_seconds
            lag = next_tick - time.monotonic()
            if lag > 0:
                self._stop_event.wait(lag)
            else:
                # Fell behind the real-time schedule; restart it so the
                # backlog does not grow without bound.
                next_tick = time.monotonic()

    def push_marker(self, label: str) -> None:
        """Publish one event marker on the irregular SimMarkers outlet."""
        if self.outlets is None:
            return
        try:
            self.outlets[1].push_sample([label])
        except Exception:
            # A dead consumer must not break generation.
            pass

    def _push_outlets(self, chunk: np.ndarray) -> None:
        eeg_outlet, marker_outlet = self.outlets
        try:
            # push_chunk auto-stamps arrival time per sample, which matches
            # our real-time pacing closely enough for consumers.
            eeg_outlet.push_chunk(chunk.T.tolist())
        except Exception:
            # Outlet failures (consumer gone, liblsl hiccup) must never kill
            # the in-process simulation.
            pass


def start_sim_stream(
    channels: int = 64,
    sfreq: int = 250,
    profile: str = "negative",
    *,
    sink: Sink,
    on_marker: MarkerSink,
    drift_seconds: float = DRIFT_DURATION_S,
    chunk_seconds: float = 0.2,
    seed: int | None = None,
    require_outlet: bool = True,
) -> SimulatedStream:
    """Create outlets plus the real-time generation thread and start it.

    With ``require_outlet`` a missing pylsl/liblsl raises the Chinese
    RuntimeError from :func:`import_pylsl`; callers that only need the
    in-process sink can pass ``require_outlet=False``.
    """
    outlets = create_outlets(channels, sfreq) if require_outlet else None
    stream = SimulatedStream(
        channels,
        sfreq,
        profile,
        sink=sink,
        on_marker=on_marker,
        drift_seconds=drift_seconds,
        chunk_seconds=chunk_seconds,
        seed=seed,
        outlets=outlets,
    )
    stream.start()
    return stream
