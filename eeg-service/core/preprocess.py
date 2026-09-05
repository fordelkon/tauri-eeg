"""Signal preprocessing: bandpass, notch, bad-channel repair, average reference.

All functions operate on (n_samples, channels) float arrays along axis 0 and
are intentionally pylsl-free so they can run offline on synthetic epochs.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

BANDPASS_LO = 1.0    # Hz; kills DC drift and sweat artifacts
BANDPASS_HI = 45.0   # Hz; EEG analysis band, keeps gamma inside
BANDPASS_ORDER = 4
NOTCH_FREQ = 50.0    # Hz mains interference (EU/China mains)
NOTCH_Q = 30.0
BAD_CHANNEL_MAD_FACTOR = 5.0


def bandpass_sos(sfreq: float) -> np.ndarray:
    return signal.butter(
        BANDPASS_ORDER,
        [BANDPASS_LO, BANDPASS_HI],
        btype="bandpass",
        fs=sfreq,
        output="sos",
    )


def notch_sos(sfreq: float) -> np.ndarray:
    b, a = signal.iirnotch(NOTCH_FREQ / (sfreq / 2.0), NOTCH_Q)
    return signal.tf2sos(b, a)


def detect_bad_channels(data: np.ndarray) -> np.ndarray:
    """Boolean mask of dead (zero-variance) or far-out channels.

    A channel is bad when its variance is 0 or exceeds the median variance
    by more than BAD_CHANNEL_MAD_FACTOR median absolute deviations, which
    catches both flat electrodes and saturating ones.
    """
    variances = np.var(data, axis=0)
    median = np.median(variances)
    mad = np.median(np.abs(variances - median))
    threshold = median + BAD_CHANNEL_MAD_FACTOR * mad
    dead = variances <= 0.0
    # A dead median (all channels flat) would flag everything; keep the
    # variance test meaningful by only applying the outlier rule when the
    # median carries signal.
    outlier = (variances > threshold) if median > 0 else np.zeros_like(dead)
    return dead | outlier


def interpolate_bad_channels(data: np.ndarray, bad: np.ndarray) -> np.ndarray:
    """Replace bad channels by a linear blend of their nearest good neighbors.

    Linear interpolation keeps the repair local and cheap; splines would add
    nothing on EEG-scale channel counts. With no good channel left, data is
    returned untouched (decoding will simply see garbage, as it would live).
    """
    repaired = data.copy()
    channels = data.shape[1]
    good = np.flatnonzero(~bad)
    if good.size == 0:
        return repaired
    for ch in np.flatnonzero(bad):
        left = good[good < ch]
        right = good[good > ch]
        if left.size and right.size:
            lo, hi = left[-1], right[0]
            weight = (ch - lo) / (hi - lo)
            repaired[:, ch] = (1.0 - weight) * data[:, lo] + weight * data[:, hi]
        elif left.size or right.size:
            neighbor = int(left[-1] if left.size else right[0])
            repaired[:, ch] = data[:, neighbor]
    return repaired


def preprocess(data: np.ndarray, sfreq: float) -> tuple[np.ndarray, np.ndarray]:
    """Filter, repair bad channels and re-reference.

    Returns (clean_data, bad_channel_mask). Order matters: bad channels are
    detected on the filtered signal (a flat electrode stays flat after the
    bandpass, and outliers remain outliers) but re-referencing happens last
    so the average is computed over repaired channels only.
    """
    data = np.asarray(data, dtype=np.float64)
    if data.ndim != 2:
        raise ValueError("data must be (n_samples, channels)")
    if data.shape[0] < 2:
        return data.copy(), np.zeros(data.shape[1], dtype=bool)

    clean = signal.sosfilt(bandpass_sos(sfreq), data, axis=0)
    clean = signal.sosfilt(notch_sos(sfreq), clean, axis=0)
    bad = detect_bad_channels(clean)
    clean = interpolate_bad_channels(clean, bad)
    # Average reference: subtract the spatial mean per sample. With a single
    # channel the mean IS the signal, so referencing is skipped there.
    if clean.shape[1] > 1:
        clean = clean - clean.mean(axis=1, keepdims=True)
    return clean, bad
