#!/usr/bin/env python3
"""Combine DEAP valence/arousal binary predictions into four regulation classes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from deap_baseline_common import CLASS_NAMES, SYSTEM_EMOTION, classify_deap_trial
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score


def read_jsonl(path: Path) -> dict[tuple[int, int], dict[str, Any]]:
    rows: dict[tuple[int, int], dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            row = json.loads(line)
            rows[(int(row["subject"]), int(row["trial"]))] = row
    return rows


def four_class_from_binary(valence_id: int, arousal_id: int) -> str:
    if valence_id == 0 and arousal_id == 0:
        return "depression"
    if valence_id == 0 and arousal_id == 1:
        return "anxiety"
    if valence_id == 1 and arousal_id == 0:
        return "calm"
    return "happy"


def id_from_probabilities(row: dict[str, Any], task: str) -> tuple[int, float]:
    probs = row[f"{task}_probabilities"]
    low = float(probs[f"low_{task}"])
    high = float(probs[f"high_{task}"])
    pred = int(high >= low)
    return pred, high


def class_probabilities(p_high_valence: float, p_high_arousal: float) -> dict[str, float]:
    p_low_valence = 1.0 - p_high_valence
    p_low_arousal = 1.0 - p_high_arousal
    probs = {
        "depression": p_low_valence * p_low_arousal,
        "anxiety": p_low_valence * p_high_arousal,
        "calm": p_high_valence * p_low_arousal,
        "happy": p_high_valence * p_high_arousal,
    }
    total = sum(probs.values()) or 1.0
    return {key: float(value / total) for key, value in probs.items()}


def signed_from_four_class_probs(probs: dict[str, float]) -> tuple[float, float]:
    valence = probs["happy"] + 0.2 * probs["calm"] - probs["depression"] - 0.4 * probs["anxiety"]
    arousal = probs["anxiety"] + 0.6 * probs["happy"] - 0.7 * probs["calm"] - 0.2 * probs["depression"]
    return float(np.clip(valence, -1.0, 1.0)), float(np.clip(arousal, -1.0, 1.0))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--valence", type=Path, required=True)
    parser.add_argument("--arousal", type=Path, required=True)
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    valence_rows = read_jsonl(args.valence)
    arousal_rows = read_jsonl(args.arousal)
    keys = sorted(set(valence_rows) & set(arousal_rows))
    if not keys:
        raise RuntimeError("no overlapping subject/trial rows between valence and arousal predictions")

    true_ids: list[int] = []
    pred_ids: list[int] = []
    out_rows: list[dict[str, Any]] = []
    class_to_id = {name: idx for idx, name in enumerate(CLASS_NAMES)}
    for key in keys:
        vrow = valence_rows[key]
        arow = arousal_rows[key]
        valence_id, p_high_valence = id_from_probabilities(vrow, "valence")
        arousal_id, p_high_arousal = id_from_probabilities(arow, "arousal")
        pred_class = four_class_from_binary(valence_id, arousal_id)
        true_class = classify_deap_trial(float(vrow["deap_valence"]), float(vrow["deap_arousal"]), args.threshold)
        probs = class_probabilities(p_high_valence, p_high_arousal)
        signed_valence, signed_arousal = signed_from_four_class_probs(probs)
        true_ids.append(class_to_id[true_class])
        pred_ids.append(class_to_id[pred_class])
        out_rows.append(
            {
                "subject": key[0],
                "trial": key[1],
                "deap_valence": float(vrow["deap_valence"]),
                "deap_arousal": float(vrow["deap_arousal"]),
                "true_class": true_class,
                "pred_class": pred_class,
                "paradigm_emotion": true_class,
                "system_emotion": SYSTEM_EMOTION[pred_class],
                "probabilities": probs,
                "valence": signed_valence,
                "arousal": signed_arousal,
                "pred_valence_class": vrow["pred_valence_class"],
                "pred_arousal_class": arow["pred_arousal_class"],
                "valence_probabilities": vrow["valence_probabilities"],
                "arousal_probabilities": arow["arousal_probabilities"],
            }
        )

    report = {
        "n": len(out_rows),
        "source_valence": str(args.valence),
        "source_arousal": str(args.arousal),
        "class_names": CLASS_NAMES,
        "accuracy": float(accuracy_score(true_ids, pred_ids)),
        "balanced_accuracy": float(balanced_accuracy_score(true_ids, pred_ids)),
        "macro_f1": float(f1_score(true_ids, pred_ids, average="macro", zero_division=0)),
        "classification_report": classification_report(true_ids, pred_ids, target_names=CLASS_NAMES, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(true_ids, pred_ids).tolist(),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as file:
        for row in out_rows:
            file.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    print(f"saved_predictions={args.out}")
    print(f"saved_report={args.report}")


if __name__ == "__main__":
    main()
