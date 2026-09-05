from __future__ import annotations

import numpy as np
import pytest
from scipy import signal

from core.preprocess import (
    detect_bad_channels,
    interpolate_bad_channels,
    notch_sos,
    preprocess,
)


def _tone(freq: float, seconds: float, sfreq: float, amplitude: float = 1.0,
          phase: float = 0.0) -> np.ndarray:
    t = np.arange(int(seconds * sfreq)) / sfreq
    return amplitude * np.sin(2 * np.pi * freq * t + phase)


def _band_amplitude(data: np.ndarray, freq: float, sfreq: float) -> float:
    spectrum = np.abs(np.fft.rfft(data, axis=0))
    freqs = np.fft.rfftfreq(len(data), d=1.0 / sfreq)
    bin_index = int(np.argmin(np.abs(freqs - freq)))
    return float(spectrum[bin_index].max())


def test_notch_attenuates_50hz_component():
    sfreq = 250.0
    data = _tone(50.0, 4.0, sfreq)[:, None]
    filtered = signal.sosfilt(notch_sos(sfreq), data, axis=0)
    # The notch must remove most of the line component without needing an
    # exact frequency bin match.
    assert _band_amplitude(filtered, 50.0, sfreq) < 0.05 * _band_amplitude(data, 50.0, sfreq)


def test_bandpass_keeps_signal_band_cuts_drift_and_highline():
    sfreq = 250.0
    rng = np.random.default_rng(6)
    # Three channels with phase-shifted tones: identical channels would be
    # common-mode and vanish under the average reference.
    mixed = np.column_stack([
        (1.0 + 0.3 * ch) * _tone(10.0, 4.0, sfreq, phase=0.7 * ch)
        + 5.0 * _tone(0.05, 4.0, sfreq)
        + 2.0 * _tone(90.0, 4.0, sfreq)
        + 0.1 * rng.standard_normal(1000)
        for ch in range(3)
    ])
    clean, bad = preprocess(mixed, sfreq)
    assert not bad.any()
    kept = _band_amplitude(clean, 10.0, sfreq)
    assert kept > 0.5 * _band_amplitude(mixed, 10.0, sfreq)
    assert _band_amplitude(clean, 0.05, sfreq) < 0.1 * kept
    assert _band_amplitude(clean, 90.0, sfreq) < 0.05 * kept


def test_bad_channels_detected_and_interpolated():
    sfreq = 250.0
    rng = np.random.default_rng(3)
    good = rng.standard_normal((500, 4)) * 2.0
    dead = np.zeros((500, 1))
    saturated = rng.standard_normal((500, 1)) * 200.0
    data = np.hstack([good, dead, saturated])

    bad = detect_bad_channels(data)
    np.testing.assert_array_equal(bad, [False, False, False, False, True, True])

    repaired = interpolate_bad_channels(data, bad)
    assert not (repaired[:, 4] == 0).all()  # dead channel now carries signal
    assert np.var(repaired[:, 5]) < np.var(data[:, 5]) * 0.1


def test_preprocess_removes_average_reference():
    sfreq = 250.0
    rng = np.random.default_rng(4)
    data = rng.standard_normal((600, 8)) + 7.0  # common offset over channels
    clean, _ = preprocess(data, sfreq)
    # After average referencing each sample's spatial mean is ~0.
    assert np.abs(clean.mean(axis=1)).max() < 1e-9


def test_preprocess_flags_all_flat_without_crash():
    data = np.zeros((100, 4))
    clean, bad = preprocess(data, 250.0)
    assert bad.all()
    assert clean.shape == data.shape
    assert np.isfinite(clean).all()
