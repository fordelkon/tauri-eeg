"""Differential entropy (DE) features over the canonical 5 EEG bands.

DE for a Gaussian band equals 0.5 * log2(band power), so features live in
log space where SVMs behave well. Channel layout assumptions are documented
on ``roi_indices`` — the service never receives real electrode positions.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

# (name, low_hz, high_hz) — boundaries follow the standard clinical split.
BANDS: tuple[tuple[str, float, float], ...] = (
    ("delta", 1.0, 4.0),
    ("theta", 4.0, 8.0),
    ("alpha", 8.0, 13.0),
    ("beta", 13.0, 30.0),
    ("gamma", 30.0, 45.0),
)
N_BANDS = len(BANDS)
POWER_EPS = 1e-12  # guards log2 against silent bands

ROI_NAMES = (
    "left_frontal",
    "right_frontal",
    "left_temporal_central",
    "right_temporal_central",
    "left_parieto_occipital",
    "right_parieto_occipital",
)


def band_powers(data: np.ndarray, sfreq: float) -> np.ndarray:
    """Mean Welch power per channel and band -> (channels, n_bands)."""
    data = np.asarray(data, dtype=np.float64)
    if data.ndim != 2 or data.shape[0] < 2:
        raise ValueError("data must be (n_samples, channels) with at least 2 samples")
    # ~1 s segments give ~1 Hz resolution: enough to separate the bands
    # while still averaging a few Welch windows per 2 s decoding frame.
    nperseg = min(data.shape[0], max(16, int(round(sfreq))))
    freqs, psd = signal.welch(data, fs=sfreq, nperseg=nperseg, axis=0)

    powers = np.zeros((data.shape[1], N_BANDS), dtype=np.float64)
    for i, (_, lo, hi) in enumerate(BANDS):
        mask = (freqs >= lo) & (freqs < hi)
        if not mask.any():
            mask = (freqs >= lo) & (freqs <= hi)
        powers[:, i] = psd[mask].mean(axis=0)
    return powers


def de_features(data: np.ndarray, sfreq: float) -> np.ndarray:
    """Per-channel DE matrix -> (channels, n_bands)."""
    return 0.5 * np.log2(band_powers(data, sfreq) + POWER_EPS)


def roi_indices(channels: int) -> list[np.ndarray]:
    """Map channel indices onto 6 regions of interest.

    Real electrode positions are unavailable at this layer, so layout is
    inferred positionally: the list is split into left/right halves, and each
    half into anterior (frontal), middle (temporo-central) and posterior
    (parieto-occipital) thirds. This keeps the compression deterministic for
    any channel count >= 6.
    """
    if channels < 6:
        raise ValueError("ROI compression needs at least 6 channels")
    half = channels // 2
    regions: list[np.ndarray] = []
    for side in (np.arange(0, half), np.arange(half, channels)):
        third = max(1, len(side) // 3)
        regions.append(side[:third])
        regions.append(side[third:2 * third])
        regions.append(side[2 * third:])
    return regions


def roi_features(data: np.ndarray, sfreq: float) -> np.ndarray:
    """ROI-averaged DE -> (n_rois * n_bands,), band-major per region."""
    de = de_features(data, sfreq)
    regions = roi_indices(data.shape[1])
    compressed = np.stack([de[idx].mean(axis=0) for idx in regions])
    return compressed.reshape(-1)


def feature_vector_dim(channels: int, roi: bool) -> int:
    return (6 if roi else channels) * N_BANDS


def compute_feature_vector(data: np.ndarray, sfreq: float, roi: bool = False) -> np.ndarray:
    """Flattened feature vector used by the SVM (ROI-compressed on demand)."""
    return roi_features(data, sfreq) if roi else de_features(data, sfreq).reshape(-1)
