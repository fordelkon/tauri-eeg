#!/usr/bin/env python3
"""Build a DEAP four-class manifest for downstream model training.

The manifest records one row per subject/trial and maps DEAP's valence/arousal
ratings into the system's four intervention labels:

depression, anxiety, calm, happy.
"""

from __future__ import annotations

import argparse
import csv
import json
import pickle
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np


DEAP_ZIP_PREFIX = "DGCNN-DEAP/dataset/DEAP/data_preprocessed_python"
DEAP_DIR_RELATIVE = Path("dataset/DEAP/data_preprocessed_python")

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


def build_rows(source: Path, subjects: list[int], threshold: float) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for subject in subjects:
        obj = load_subject(source, subject)
        labels = np.asarray(obj["labels"], dtype=np.float64)
        data = np.asarray(obj["data"])
        if labels.shape != (40, 4):
            raise RuntimeError(f"unexpected label shape for subject {subject}: {labels.shape}")
        if data.shape[0] != 40:
            raise RuntimeError(f"unexpected data shape for subject {subject}: {data.shape}")

        for trial_idx, values in enumerate(labels):
            valence, arousal, dominance, liking = [float(x) for x in values]
            paradigm = classify_deap_trial(valence, arousal, threshold)
            rows.append(
                {
                    "subject": subject,
                    "trial": trial_idx + 1,
                    "source_subject_file": f"s{subject:02d}.dat",
                    "data_shape": "x".join(str(x) for x in data[trial_idx].shape),
                    "deap_valence": f"{valence:.6f}",
                    "deap_arousal": f"{arousal:.6f}",
                    "deap_dominance": f"{dominance:.6f}",
                    "deap_liking": f"{liking:.6f}",
                    "paradigm_emotion": paradigm,
                    "system_emotion": SYSTEM_EMOTION[paradigm],
                }
            )
    return rows


def parse_subjects(value: str) -> list[int]:
    if value == "all":
        return list(range(1, 33))
    subjects: list[int] = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        subjects.append(int(item))
    return subjects


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="DGCNN-DEAP.zip path or extracted DGCNN-DEAP directory.")
    parser.add_argument("--subjects", default="all", help="Comma-separated subject ids or 'all'.")
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--out", type=Path, default=Path("runs/deap_4class_manifest.csv"))
    parser.add_argument("--summary", type=Path, default=Path("runs/deap_4class_summary.json"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    subjects = parse_subjects(args.subjects)
    rows = build_rows(args.source, subjects, args.threshold)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    class_counts = Counter(row["paradigm_emotion"] for row in rows)
    subject_counts: dict[str, dict[str, int]] = {}
    for row in rows:
        key = f"s{int(row['subject']):02d}"
        subject_counts.setdefault(key, {name: 0 for name in SYSTEM_EMOTION})
        subject_counts[key][row["paradigm_emotion"]] += 1

    summary = {
        "source": str(args.source),
        "threshold": args.threshold,
        "subjects": subjects,
        "n_trials": len(rows),
        "class_counts": dict(class_counts),
        "subject_counts": subject_counts,
    }
    args.summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
