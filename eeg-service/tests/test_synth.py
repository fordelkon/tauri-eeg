from __future__ import annotations

import numpy as np
import pytest

from core.features import de_features
from core.synth import (
    DRIFT_DURATION_S,
    STATE_NAMES,
    STATE_MULTIPLIERS,
    SynthStream,
    state_multipliers,
    synth_epoch,
)

SFREQ = 250.0
CHANNELS = 16
FRONTAL = max(2, int(round(CHANNELS / 8)))


def frontal_alpha_de(state: str, seconds: float, seed: int, progress: float = 0.0) -> float:
    rng = np.random.default_rng(seed)
    epoch = synth_epoch(state, seconds, CHANNELS, SFREQ, rng, progress=progress)
    return float(de_features(epoch, SFREQ)[:FRONTAL, 2].mean())


def test_synth_epoch_shape_determinism_and_finiteness():
    rng_a1 = np.random.default_rng(11)
    rng_a2 = np.random.default_rng(11)
    rng_b = np.random.default_rng(12)
    e1 = synth_epoch("calm", 2.0, CHANNELS, SFREQ, rng_a1)
    e2 = synth_epoch("calm", 2.0, CHANNELS, SFREQ, rng_a2)
    e3 = synth_epoch("calm", 2.0, CHANNELS, SFREQ, rng_b)
    assert e1.shape == (500, CHANNELS)
    assert np.isfinite(e1).all()
    np.testing.assert_array_equal(e1, e2)  # seeded rng -> reproducible
    assert not np.array_equal(e1, e3)


def test_negative_vs_calm_band_ordering():
    # Ground truth of the generator: negative suppresses frontal alpha and
    # boosts beta relative to calm. Averaged over epochs the ordering must
    # be unambiguous even though single epochs are noisy.
    alpha_neg = [frontal_alpha_de("negative", 3.0, seed) for seed in (1, 2, 3)]
    alpha_calm = [frontal_alpha_de("calm", 3.0, seed) for seed in (1, 2, 3)]
    assert np.mean(alpha_calm) > np.mean(alpha_neg) + 0.25


def test_drift_progress_moves_from_negative_to_calm():
    start = frontal_alpha_de("regulation_drift", 3.0, 8, progress=0.0)
    mid = frontal_alpha_de("regulation_drift", 3.0, 8, progress=0.5)
    end = frontal_alpha_de("regulation_drift", 3.0, 8, progress=1.0)
    assert end > mid > start
    # progress 0/1 must match the pure profiles, not just be ordered.
    assert start == pytest.approx(frontal_alpha_de("negative", 3.0, 8), abs=0.05)
    assert end == pytest.approx(frontal_alpha_de("calm", 3.0, 8), abs=0.05)


def test_state_multipliers_interpolate_only_for_drift():
    calm = STATE_MULTIPLIERS["calm"]
    negative = STATE_MULTIPLIERS["negative"]
    drift_start = state_multipliers("regulation_drift", 0.0)
    drift_end = state_multipliers("regulation_drift", 1.0)
    assert drift_start == negative
    assert drift_end == calm
    assert state_multipliers("calm", 0.9) == calm  # progress ignored elsewhere
    with pytest.raises(ValueError):
        state_multipliers("excited")


def test_unknown_state_rejected():
    rng = np.random.default_rng(0)
    with pytest.raises(ValueError):
        synth_epoch("excited", 1.0, CHANNELS, SFREQ, rng)


def test_synth_stream_chunks_are_continuous():
    rng = np.random.default_rng(9)
    stream = SynthStream(CHANNELS, SFREQ, rng)
    multipliers = state_multipliers("calm")
    chunk_a = stream.next_chunk(1.0, multipliers)
    chunk_b = stream.next_chunk(1.0, multipliers)
    assert chunk_a.shape == chunk_b.shape == (250, CHANNELS)
    # A stateful generator must not restart filters at chunk boundaries:
    # the junction would otherwise show a spectral step. Compare a two-part
    # generation against a single longer generation statistically.
    joined_power = np.var(np.vstack([chunk_a, chunk_b]))
    single_power = np.var(stream.next_chunk(2.0, multipliers))
    assert joined_power == pytest.approx(single_power, rel=0.6)


def test_drift_duration_matches_paradigm():
    # The simulated reappraisal drift mirrors the paradigm's 24 s phase.
    assert DRIFT_DURATION_S == pytest.approx(24.0)
    assert set(STATE_NAMES) >= set(STATE_MULTIPLIERS)
