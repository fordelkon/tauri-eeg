from __future__ import annotations

import numpy as np
import pytest

from core.decoder import OnlineDecoder
from core.synth import synth_epoch

SFREQ = 250.0
CHANNELS = 32


def build_calibration(rng: np.random.Generator, epochs_per_state: int = 10,
                      seconds: float = 3.0) -> tuple[list[np.ndarray], list[str]]:
    epochs: list[np.ndarray] = []
    labels: list[str] = []
    for state in ("negative", "calm"):
        for _ in range(epochs_per_state):
            epochs.append(synth_epoch(state, seconds, CHANNELS, SFREQ, rng))
            labels.append(state)
    return epochs, labels


def test_train_cv_accuracy_lands_in_required_band():
    rng = np.random.default_rng(7)
    epochs, labels = build_calibration(rng)
    decoder = OnlineDecoder(CHANNELS, SFREQ)
    summary = decoder.train(epochs, labels)

    # Contract: separable but never a trivially perfect 1.0.
    assert 0.75 <= summary["cvAccuracy"] < 1.0
    assert summary["classes"] == ["calm", "negative"]
    assert summary["nEpochs"] == 20


def test_predict_proba_orders_states_correctly():
    rng = np.random.default_rng(7)
    epochs, labels = build_calibration(rng)
    decoder = OnlineDecoder(CHANNELS, SFREQ)
    decoder.train(epochs, labels)

    eval_rng = np.random.default_rng(101)
    calm_scores = [
        decoder.predict_proba(synth_epoch("calm", 2.0, CHANNELS, SFREQ, eval_rng))["calm"]
        for _ in range(6)
    ]
    negative_scores = [
        decoder.predict_proba(synth_epoch("negative", 2.0, CHANNELS, SFREQ, eval_rng))["calm"]
        for _ in range(6)
    ]
    # Single windows overlap by design (CV < 1.0), so compare the means.
    assert np.mean(calm_scores) > np.mean(negative_scores) + 0.2
    for probs in decoder.predict_proba(
        synth_epoch("calm", 2.0, CHANNELS, SFREQ, eval_rng),
    ),:
        assert pytest.approx(sum(probs.values()), abs=1e-6) == 1.0


def test_target_defaults_to_positive_calm_class():
    rng = np.random.default_rng(7)
    epochs, labels = build_calibration(rng)
    decoder = OnlineDecoder(CHANNELS, SFREQ)
    decoder.train(epochs, labels)
    assert decoder.target_class == "calm"

    decoder.set_target("negative")
    assert decoder.target_class == "negative"
    with pytest.raises(ValueError):
        decoder.set_target("positive")  # not among calibrated classes


def test_joblib_roundtrip_preserves_predictions():
    import tempfile
    from pathlib import Path

    rng = np.random.default_rng(7)
    epochs, labels = build_calibration(rng)
    decoder = OnlineDecoder(CHANNELS, SFREQ)
    decoder.train(epochs, labels)

    window = synth_epoch("calm", 2.0, CHANNELS, SFREQ, np.random.default_rng(55))
    before = decoder.predict_proba(window)

    with tempfile.TemporaryDirectory() as tmp:
        model_path = Path(tmp) / "decoder.joblib"
        decoder.save(model_path)
        restored = OnlineDecoder.load(model_path)
    after = restored.predict_proba(window)
    assert before == after
    assert restored.target_class == decoder.target_class


def test_train_rejects_degenerate_inputs():
    decoder = OnlineDecoder(CHANNELS, SFREQ)
    with pytest.raises(ValueError):
        decoder.train([], [])
    rng = np.random.default_rng(3)
    epochs = [synth_epoch("calm", 1.0, CHANNELS, SFREQ, rng) for _ in range(3)]
    with pytest.raises(ValueError):
        decoder.train(epochs, ["calm"] * 3)  # only one class
    with pytest.raises(ValueError):
        # Two classes but only one epoch of the second one.
        decoder.train(
            epochs + [synth_epoch("negative", 1.0, CHANNELS, SFREQ, rng)],
            ["calm"] * 3 + ["negative"],
        )


def test_predict_requires_matching_channel_count():
    rng = np.random.default_rng(7)
    epochs, labels = build_calibration(rng)
    decoder = OnlineDecoder(CHANNELS, SFREQ)
    decoder.train(epochs, labels)
    with pytest.raises(ValueError):
        decoder.predict_proba(synth_epoch("calm", 2.0, CHANNELS + 1, SFREQ, rng))
