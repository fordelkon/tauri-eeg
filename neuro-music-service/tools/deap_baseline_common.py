"""Shared helpers for DEAP four-class baseline experiments."""

from __future__ import annotations

import pickle
import zipfile
from pathlib import Path
from typing import Any

import numpy as np


DEAP_ZIP_PREFIX = "DGCNN-DEAP/dataset/DEAP/data_preprocessed_python"
DEAP_DIR_RELATIVE = Path("dataset/DEAP/data_preprocessed_python")
CLASS_NAMES = ["depression", "anxiety", "calm", "happy"]
SYSTEM_EMOTION = {
    "depression": "sad",
    "anxiety": "fear",
    "calm": "neutral",
    "happy": "happy",
}


def load_subject(source: Path, subject: int) -> dict[str, Any]:
    if source.is_file():
        member = f"{DEAP_ZIP_PREFIX}/s{subject:02d}.dat"
        with zipfile.ZipFile(source) as archive:
            with archive.open(member) as file:
                return pickle.load(file, encoding="latin1")

    dat_path = source / DEAP_DIR_RELATIVE / f"s{subject:02d}.dat"
    if not dat_path.is_file():
        raise FileNotFoundError(f"DEAP subject file not found: {dat_path}")
    with dat_path.open("rb") as file:
        return pickle.load(file, encoding="latin1")


def classify_deap_trial(valence: float, arousal: float, threshold: float) -> str:
    if valence < threshold and arousal < threshold:
        return "depression"
    if valence < threshold and arousal >= threshold:
        return "anxiety"
    if valence >= threshold and arousal < threshold:
        return "calm"
    return "happy"


def parse_subjects(value: str) -> list[int]:
    if value == "all":
        return list(range(1, 33))
    subjects: list[int] = []
    for item in value.split(","):
        item = item.strip()
        if item:
            subjects.append(int(item))
    return subjects


def extract_trial_features(trial: np.ndarray) -> np.ndarray:
    """Extract compact channel-wise statistics from one DEAP trial.

    DEAP preprocessed Python trials are shaped like channels x time. The feature
    set is intentionally simple so it can serve as a CPU baseline and integration
    sanity check before adding PSD/DGCNN models.
    """
    x = np.asarray(trial, dtype=np.float64)
    eeg = x[:32] if x.shape[0] >= 32 else x
    diff = np.diff(eeg, axis=1)
    features = [
        eeg.mean(axis=1),
        eeg.std(axis=1),
        np.mean(np.abs(eeg), axis=1),
        np.sqrt(np.mean(eeg * eeg, axis=1)),
        np.percentile(eeg, 25, axis=1),
        np.percentile(eeg, 75, axis=1),
        diff.std(axis=1),
        np.mean(np.abs(diff), axis=1),
    ]
    return np.concatenate(features).astype(np.float32)


def load_feature_table(source: Path, subjects: list[int], threshold: float) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    xs: list[np.ndarray] = []
    ys: list[int] = []
    class_to_id = {name: idx for idx, name in enumerate(CLASS_NAMES)}

    for subject in subjects:
        obj = load_subject(source, subject)
        labels = np.asarray(obj["labels"], dtype=np.float64)
        data = np.asarray(obj["data"], dtype=np.float64)
        if labels.shape != (40, 4):
            raise RuntimeError(f"unexpected label shape for subject {subject}: {labels.shape}")
        if data.shape[0] != 40:
            raise RuntimeError(f"unexpected data shape for subject {subject}: {data.shape}")

        for trial_idx in range(40):
            valence, arousal, dominance, liking = [float(v) for v in labels[trial_idx]]
            class_name = classify_deap_trial(valence, arousal, threshold)
            xs.append(extract_trial_features(data[trial_idx]))
            ys.append(class_to_id[class_name])
            rows.append(
                {
                    "subject": subject,
                    "trial": trial_idx + 1,
                    "deap_valence": valence,
                    "deap_arousal": arousal,
                    "deap_dominance": dominance,
                    "deap_liking": liking,
                    "paradigm_emotion": class_name,
                    "system_emotion": SYSTEM_EMOTION[class_name],
                }
            )

    return np.vstack(xs), np.asarray(ys, dtype=np.int64), rows
