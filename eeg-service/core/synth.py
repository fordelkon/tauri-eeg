"""Synthetic EEG generation.

One generator backs both the LSL simulator (chunked, stateful, real-time)
and the no-device calibration path (one-shot epochs), so calibration data and
stream data share the exact same ground-truth statistics. Class separability
is deliberately moderate: the contract requires CV accuracy in [0.75, 1.0),
i.e. never a trivially perfect 1.0, which keeps the calibrated SVM honest.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

from core.features import BANDS

STATE_NAMES = ("negative", "calm", "regulation_drift", "positive")

# Amplitude (sigma) of each band-limited component before state modulation,
# roughly matching uV-scale scalp EEG so preprocessing operates on realistic
# dynamic range.
BASE_AMPLITUDES: dict[str, float] = {
    "delta": 4.0,
    "theta": 2.8,
    "alpha": 2.4,
    "beta": 1.6,
    "gamma": 0.8,
}
PINK_AMPLITUDE = 2.6   # 1/f background floor
LINE_AMPLITUDE = 0.35  # 50 Hz mains, small on purpose (the notch must remove it)

# Per-state band multipliers. State effects are strongest frontally; the
# non-frontal share keeps whole-head features informative but noisier.
# Contrast is tuned so calibration CV accuracy lands mid-range (~0.75-0.95):
# strong enough to drive the closed loop, weak enough that the SVM never
# sees a trivially perfect separation.
FRONTAL_SHARE = 0.4
STATE_MULTIPLIERS: dict[str, dict[str, float]] = {
    "negative": {"delta": 1.0, "theta": 1.0, "alpha": 0.85, "beta": 1.30, "gamma": 1.15},
    "calm": {"delta": 1.0, "theta": 1.05, "alpha": 1.30, "beta": 0.95, "gamma": 0.88},
    "positive": {"delta": 1.0, "theta": 0.95, "alpha": 1.60, "beta": 0.80, "gamma": 1.0},
}
# regulation_drift walks from the negative profile to the calm profile over
# this many seconds, mirroring the paradigm's 24 s reappraisal phase.
DRIFT_DURATION_S = 24.0

GAIN_LOG_STD = 0.30        # per-channel anatomy gain, drawn once per epoch/stream
GLOBAL_GAIN_JITTER = 0.20  # per-epoch global amplitude jitter (uniform +/-)
FRONTAL_CHANNEL_FRACTION = 1.0 / 8.0

# Empirical RMS of the Kellet pink-noise filter output for unit-variance
# input (measured on a 4000-sample run); used to set the 1/f floor without
# per-chunk renormalization, which would cause amplitude jumps when streaming.
PINK_RMS = 2.923


def _clamp_progress(progress: float) -> float:
    return float(min(1.0, max(0.0, progress)))


def state_multipliers(state: str, progress: float = 0.0) -> dict[str, float]:
    """Resolve a state name into per-band amplitude multipliers.

    ``progress`` only applies to regulation_drift and interpolates linearly
    from the negative profile (0) to the calm profile (1).
    """
    if state not in STATE_NAMES:
        raise ValueError(f"unknown state {state!r}, expected one of {STATE_NAMES}")
    if state == "regulation_drift":
        start = STATE_MULTIPLIERS["negative"]
        end = STATE_MULTIPLIERS["calm"]
        p = _clamp_progress(progress)
        return {band: start[band] + (end[band] - start[band]) * p for band in start}
    return dict(STATE_MULTIPLIERS[state])


def _bandpass_sos(band: tuple[str, float, float], sfreq: float) -> np.ndarray:
    _, lo, hi = band
    return signal.butter(4, [lo, hi], btype="bandpass", fs=sfreq, output="sos")


def _band_scale(band: tuple[str, float, float], sfreq: float) -> float:
    """Scale that turns unit-variance white noise into the target band sigma.

    White noise power inside a band of width ``bw`` is bw/sfreq of its total,
    so dividing by sqrt(bw/sfreq) keeps band amplitudes independent of sfreq.
    """
    _, lo, hi = band
    return 1.0 / np.sqrt((hi - lo) / sfreq)


class SynthStream:
    """Stateful synthetic EEG generator for contiguous chunks.

    Filter states and the mains hum phase persist across chunks; restarting
    them per chunk would inject spectral transients at every block boundary.
    """

    def __init__(self, channels: int, sfreq: float, rng: np.random.Generator,
                 channel_gains: np.ndarray | None = None) -> None:
        if channels < 1:
            raise ValueError("channels must be >= 1")
        if sfreq < 2 * 50:  # mains hum must stay below Nyquist
            raise ValueError("sfreq must be >= 100 Hz to represent the 50 Hz component")
        self.channels = int(channels)
        self.sfreq = float(sfreq)
        self.rng = rng
        self.n_frontal = max(2, int(round(channels * FRONTAL_CHANNEL_FRACTION)))
        if channel_gains is None:
            channel_gains = rng.lognormal(0.0, GAIN_LOG_STD, channels)
        self.channel_gains = np.asarray(channel_gains, dtype=np.float64)

        self._sos = {band[0]: _bandpass_sos(band, sfreq) for band in BANDS}
        # scipy's sosfilt_zi yields the steady-state section state; tile it
        # across channels because we filter all channels in one call.
        self._zi = {
            name: np.tile(signal.sosfilt_zi(sos)[:, :, None], (1, 1, self.channels))
            for name, sos in self._sos.items()
        }
        self._pink_state = np.zeros((7, self.channels), dtype=np.float64)
        self._line_phase = float(rng.uniform(0.0, 2.0 * np.pi))

    def spatial_weights(self, multipliers: dict[str, float]) -> dict[str, np.ndarray]:
        """Full state contrast frontally, FRONTAL_SHARE everywhere else."""
        weights: dict[str, np.ndarray] = {}
        for band, value in multipliers.items():
            w = np.full(self.channels, 1.0 + (value - 1.0) * FRONTAL_SHARE)
            w[: self.n_frontal] = value
            weights[band] = w
        return weights

    def next_chunk(self, seconds: float, multipliers: dict[str, float]) -> np.ndarray:
        """Generate the next (n, channels) chunk continuing previous state."""
        n = max(1, int(round(seconds * self.sfreq)))
        weights = self.spatial_weights(multipliers)
        chunk = np.zeros((n, self.channels), dtype=np.float64)

        for band in BANDS:
            name = band[0]
            white = self.rng.standard_normal((n, self.channels))
            filtered, self._zi[name] = signal.sosfilt(
                self._sos[name], white, zi=self._zi[name], axis=0
            )
            scale = BASE_AMPLITUDES[name] * _band_scale(band, self.sfreq)
            chunk += filtered * scale * weights[name][None, :]

        chunk += self._pink_noise(n) * PINK_AMPLITUDE / PINK_RMS
        chunk += self._mains_hum(n)
        return chunk * (self.channel_gains[None, :])

    def _pink_noise(self, n: int) -> np.ndarray:
        """Paul Kellet's pink filter, vectorized across channels."""
        out = np.empty((n, self.channels), dtype=np.float64)
        b = self._pink_state
        for i in range(n):
            white = self.rng.standard_normal(self.channels)
            b[0] = 0.99886 * b[0] + 0.0555179 * white
            b[1] = 0.99332 * b[1] + 0.0750759 * white
            b[2] = 0.96900 * b[2] + 0.1538520 * white
            b[3] = 0.86650 * b[3] + 0.3104856 * white
            b[4] = 0.55000 * b[4] + 0.5329522 * white
            b[5] = -0.7616 * b[5] - 0.0168980 * white
            out[i] = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + 0.5362 * white
            b[6] = 0.115926 * white
        return out

    def _mains_hum(self, n: int) -> np.ndarray:
        t = (np.arange(n) + 0.5) / self.sfreq
        omega = 2.0 * np.pi * 50.0
        self._line_phase = (self._line_phase + omega * n / self.sfreq) % (2.0 * np.pi)
        # Uniform across channels: a real mains artifact is largely common-mode.
        return LINE_AMPLITUDE * np.sin(omega * t + self._line_phase)[:, None]


def synth_epoch(
    state: str,
    seconds: float,
    channels: int,
    sfreq: float,
    rng: np.random.Generator,
    progress: float = 0.0,
    *,
    with_individual_gains: bool = True,
) -> np.ndarray:
    """One-shot synthetic EEG epoch of shape (n_samples, channels).

    Stateless by design so tests and offline calibration get reproducible
    data from a seeded rng. ``with_individual_gains`` draws per-channel
    anatomy gains plus a per-epoch global jitter, matching the variability
    the streaming simulator receives at session level.
    """
    multipliers = state_multipliers(state, progress)
    stream = SynthStream(channels, sfreq, rng)
    chunk = stream.next_chunk(seconds, multipliers)
    if not with_individual_gains:
        return chunk
    global_gain = 1.0 + rng.uniform(-GLOBAL_GAIN_JITTER, GLOBAL_GAIN_JITTER)
    return chunk * global_gain
