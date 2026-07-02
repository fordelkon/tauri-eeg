#!/usr/bin/env python3
"""Train a small DEAP EEG -> four-class baseline classifier."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
from deap_baseline_common import CLASS_NAMES, load_feature_table, parse_subjects
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="DGCNN-DEAP.zip path or extracted DGCNN-DEAP directory.")
    parser.add_argument("--train-subjects", default="1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24")
    parser.add_argument("--test-subjects", default="25,26,27,28,29,30,31,32")
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--model", choices=["logreg", "rf"], default="logreg")
    parser.add_argument("--out-dir", type=Path, default=Path("runs/deap_baseline"))
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def make_model(kind: str, seed: int) -> Pipeline:
    if kind == "rf":
        return Pipeline(
            [
                ("scale", StandardScaler()),
                (
                    "clf",
                    RandomForestClassifier(
                        n_estimators=300,
                        class_weight="balanced",
                        random_state=seed,
                        n_jobs=-1,
                    ),
                ),
            ]
        )
    return Pipeline(
        [
            ("scale", StandardScaler()),
            (
                "clf",
                LogisticRegression(
                    max_iter=2000,
                    class_weight="balanced",
                    random_state=seed,
                ),
            ),
        ]
    )


def main() -> None:
    args = parse_args()
    train_subjects = parse_subjects(args.train_subjects)
    test_subjects = parse_subjects(args.test_subjects)

    x_train, y_train, train_rows = load_feature_table(args.source, train_subjects, args.threshold)
    x_test, y_test, test_rows = load_feature_table(args.source, test_subjects, args.threshold)

    model = make_model(args.model, args.seed)
    model.fit(x_train, y_train)
    probs = model.predict_proba(x_test)
    pred = np.argmax(probs, axis=1)

    report = {
        "source": str(args.source),
        "threshold": args.threshold,
        "model": args.model,
        "train_subjects": train_subjects,
        "test_subjects": test_subjects,
        "n_train": int(len(y_train)),
        "n_test": int(len(y_test)),
        "train_class_counts": {CLASS_NAMES[k]: int(v) for k, v in Counter(y_train).items()},
        "test_class_counts": {CLASS_NAMES[k]: int(v) for k, v in Counter(y_test).items()},
        "accuracy": float(accuracy_score(y_test, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_test, pred)),
        "classification_report": classification_report(y_test, pred, target_names=CLASS_NAMES, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y_test, pred).tolist(),
        "feature_dim": int(x_train.shape[1]),
    }

    args.out_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.out_dir / f"deap_{args.model}_baseline.joblib"
    report_path = args.out_dir / f"deap_{args.model}_baseline_report.json"
    predictions_path = args.out_dir / f"deap_{args.model}_baseline_predictions.jsonl"
    joblib.dump(
        {
            "model": model,
            "class_names": CLASS_NAMES,
            "threshold": args.threshold,
            "feature": "channel_stats_v1",
            "train_subjects": train_subjects,
            "test_subjects": test_subjects,
        },
        model_path,
    )
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    with predictions_path.open("w", encoding="utf-8") as file:
        for row, true_id, pred_id, prob in zip(test_rows, y_test, pred, probs):
            item = {
                **row,
                "true_class": CLASS_NAMES[int(true_id)],
                "pred_class": CLASS_NAMES[int(pred_id)],
                "probabilities": {CLASS_NAMES[i]: float(prob[i]) for i in range(len(CLASS_NAMES))},
            }
            file.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")

    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    print(f"saved_model={model_path}")
    print(f"saved_report={report_path}")
    print(f"saved_predictions={predictions_path}")


if __name__ == "__main__":
    main()
