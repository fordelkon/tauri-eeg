"""Individualized decoder: calibrated linear SVM over DE feature vectors.

Training and inference are deliberately simple: StandardScaler + LinearSVC
wrapped in sigmoid calibration gives usable P(target) for the closed loop
while staying well inside the service's real-time budget.
"""
from __future__ import annotations

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC

from core import features, preprocess as preprocessing

DEFAULT_WINDOW_SECONDS = 2.0
MIN_EPOCHS_PER_CLASS = 2


class OnlineDecoder:
    """Sliding-window decoder with a fixed channel count and sample rate."""

    def __init__(
        self,
        channels: int,
        sfreq: float,
        window_seconds: float = DEFAULT_WINDOW_SECONDS,
        *,
        roi: bool = False,
    ) -> None:
        if channels < 1:
            raise ValueError("channels must be >= 1")
        if sfreq <= 0:
            raise ValueError("sfreq must be positive")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        if roi and channels < 6:
            raise ValueError("roi features need at least 6 channels")
        self.channels = int(channels)
        self.sfreq = float(sfreq)
        self.window_seconds = float(window_seconds)
        self.roi = bool(roi)
        self.model: Pipeline | None = None
        self.classes: list[str] = []
        self.target_class: str | None = None
        self.cv_accuracy: float | None = None

    # ------------------------------------------------------------------ train

    def train(self, epochs: list[np.ndarray], labels: list[str]) -> dict[str, object]:
        """Fit on preprocessed-ready raw epochs; returns a training summary.

        Epochs must already be raw windows (n_samples, channels); all
        preprocessing happens inside the decoder so streaming inference and
        calibration see identical transforms.
        """
        if len(epochs) != len(labels):
            raise ValueError("epochs and labels must have the same length")
        if not epochs:
            raise ValueError("cannot train on an empty epoch set")

        unique = sorted(set(labels))
        if len(unique) < 2:
            raise ValueError("calibration needs at least 2 distinct states")
        counts = {name: labels.count(name) for name in unique}
        thin = {name: n for name, n in counts.items() if n < MIN_EPOCHS_PER_CLASS}
        if thin:
            raise ValueError(
                f"每个状态至少需要 {MIN_EPOCHS_PER_CLASS} 个 epoch，不足的状态: {thin}"
            )

        matrix = np.stack([self._features_of(epoch) for epoch in epochs])
        targets = np.asarray(labels)

        # Calibration folds cannot exceed the smallest class count.
        folds = int(max(2, min(5, min(counts.values()))))
        base = Pipeline([
            ("scaler", StandardScaler()),
            ("svm", LinearSVC(C=1.0, random_state=0)),
        ])
        cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=0)
        cv_scores = cross_val_score(base, matrix, targets, cv=cv)
        self.cv_accuracy = float(cv_scores.mean())

        self.model = CalibratedClassifierCV(estimator=base, cv=cv, method="sigmoid")
        self.model.fit(matrix, targets)
        self.classes = [str(c) for c in self.model.classes_]
        self.target_class = self._default_target(self.classes)

        return {
            "cvAccuracy": self.cv_accuracy,
            "classes": list(self.classes),
            "nEpochs": len(epochs),
        }

    @staticmethod
    def _default_target(classes: list[str]) -> str:
        # The closed loop maximizes P(desired state); positive/calm are the
        # desired classes by convention, else fall back to the last class.
        for candidate in ("positive", "calm"):
            if candidate in classes:
                return candidate
        return classes[-1]

    def _features_of(self, epoch: np.ndarray) -> np.ndarray:
        clean, _ = preprocessing.preprocess(np.asarray(epoch, dtype=np.float64), self.sfreq)
        return features.compute_feature_vector(clean, self.sfreq, roi=self.roi)

    # ---------------------------------------------------------------- predict

    def predict_proba_with_info(self, window: np.ndarray) -> tuple[dict[str, float], dict[str, int]]:
        """Class probabilities for one raw window plus preprocessing diagnostics."""
        if self.model is None:
            raise RuntimeError("decoder is not trained yet")
        window = np.asarray(window, dtype=np.float64)
        if window.ndim != 2 or window.shape[1] != self.channels:
            raise ValueError(f"window must be (n, {self.channels}), got {window.shape}")

        clean, bad = preprocessing.preprocess(window, self.sfreq)
        vector = features.compute_feature_vector(clean, self.sfreq, roi=self.roi)
        proba = self.model.predict_proba(vector.reshape(1, -1))[0]
        probs = {str(cls): float(p) for cls, p in zip(self.model.classes_, proba)}
        return probs, {"badChannels": int(bad.sum())}

    def predict_proba(self, window: np.ndarray) -> dict[str, float]:
        probs, _ = self.predict_proba_with_info(window)
        return probs

    def set_target(self, target_class: str) -> None:
        if self.model is None or target_class not in self.classes:
            raise ValueError(
                f"未知目标类 {target_class!r}，可用类别: {self.classes or '（尚未标定）'}"
            )
        self.target_class = target_class

    # ------------------------------------------------------------- persistence

    def save(self, path) -> None:
        import joblib

        joblib.dump(self, str(path))

    @classmethod
    def load(cls, path) -> "OnlineDecoder":
        import joblib

        decoder = joblib.load(str(path))
        if not isinstance(decoder, cls):
            raise ValueError(f"{path} does not contain an {cls.__name__}")
        return decoder
