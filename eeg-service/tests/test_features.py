from __future__ import annotations

import numpy as np
import pytest

from core.features import (
    N_BANDS,
    ROI_NAMES,
    band_powers,
    compute_feature_vector,
    de_features,
    roi_features,
    roi_indices,
)


def test_de_vector_shapes():
    sfreq = 250.0
    rng = np.random.default_rng(1)
    data = rng.standard_normal((500, 16))
    de = de_features(data, sfreq)
    assert de.shape == (16, N_BANDS)
    np.testing.assert_array_equal(
        compute_feature_vector(data, sfreq), de.reshape(-1)
    )
    assert compute_feature_vector(data, sfreq, roi=True).shape == (len(ROI_NAMES) * N_BANDS,)


def test_alpha_increase_raises_alpha_de_only():
    sfreq = 250.0
    t = np.arange(1000) / sfreq
    quiet = 0.1 * rng_noise(1000, 3)
    alpha_rich = quiet + np.sin(2 * np.pi * 10.0 * t)[:, None]
    de_quiet = de_features(quiet, sfreq)
    de_alpha = de_features(alpha_rich, sfreq)
    assert (de_alpha[:, 2] > de_quiet[:, 2] + 1.0).all()  # band index 2 = alpha
    # Neighboring bands must stay roughly unchanged so the feature is
    # frequency-selective rather than just a loudness measure.
    assert np.abs(de_alpha[:, 1] - de_quiet[:, 1]).max() < 1.0
    assert np.abs(de_alpha[:, 4] - de_quiet[:, 4]).max() < 1.0


def rng_noise(n: int, channels: int, seed: int = 5) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal((n, channels))


def test_roi_indices_partition_all_channels():
    indices = roi_indices(64)
    assert len(indices) == 6
    flat = np.concatenate(indices)
    assert len(flat) == 64
    assert len(set(flat.tolist())) == 64  # disjoint and complete
    with pytest.raises(ValueError):
        roi_indices(4)


def test_roi_features_equal_per_region_de_mean():
    sfreq = 250.0
    rng = np.random.default_rng(2)
    data = rng.standard_normal((500, 12))
    de = de_features(data, sfreq)
    regions = roi_indices(12)
    expected = np.stack([de[idx].mean(axis=0) for idx in regions]).reshape(-1)
    np.testing.assert_allclose(roi_features(data, sfreq), expected)


def test_band_powers_use_defined_bands():
    sfreq = 250.0
    t = np.arange(1000) / sfreq
    data = np.sin(2 * np.pi * 10.0 * t)[:, None]
    powers = band_powers(data, sfreq)
    assert powers.shape == (1, N_BANDS)
    assert powers[0, 2] == pytest.approx(powers.max())  # alpha band dominates
