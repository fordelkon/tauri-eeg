#!/usr/bin/env python3
"""Train per-subject DEAP DGCNN calibration models.

This is the personal-calibration branch after strict cross-subject DEAP failed
to provide enough accuracy. Each subject is split by trials into train/val/test,
then a subject-specific valence or arousal DGCNN is trained and evaluated.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
from deap_baseline_common import SYSTEM_EMOTION, classify_deap_trial, load_subject, parse_subjects
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from train_deap_dgcnn_binary import (
    BINARY_CLASS_NAMES,
    DGCNN,
    binary_label,
    evaluate_windows,
    extract_de_windows,
)


def trial_split(
    labels: np.ndarray,
    seed: int,
    train_size: float,
    val_size: float,
    split_mode: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    indices = np.arange(len(labels))
    if split_mode == "fixed":
        rng = np.random.default_rng(seed)
        shuffled = indices.copy()
        rng.shuffle(shuffled)
        n_train = int(round(len(indices) * train_size))
        n_val = int(round(len(indices) * val_size))
        train_idx = shuffled[:n_train]
        val_idx = shuffled[n_train : n_train + n_val]
        test_idx = shuffled[n_train + n_val :]
        return np.sort(train_idx), np.sort(val_idx), np.sort(test_idx)

    stratify = labels if np.min(np.bincount(labels, minlength=2)) >= 3 else None
    train_idx, temp_idx, _train_y, temp_y = train_test_split(
        indices,
        labels,
        train_size=train_size,
        random_state=seed,
        stratify=stratify,
    )
    relative_val = val_size / (1.0 - train_size)
    temp_stratify = temp_y if np.min(np.bincount(temp_y, minlength=2)) >= 2 else None
    val_idx, test_idx = train_test_split(
        temp_idx,
        train_size=relative_val,
        random_state=seed + 1,
        stratify=temp_stratify,
    )
    return np.sort(train_idx), np.sort(val_idx), np.sort(test_idx)


def fit_standardizer(x_train: np.ndarray) -> StandardScaler:
    scaler = StandardScaler()
    scaler.fit(x_train.reshape(-1, x_train.shape[-1]))
    return scaler


def apply_standardizer(x: np.ndarray, scaler: StandardScaler) -> np.ndarray:
    flat = x.reshape(-1, x.shape[-1])
    return scaler.transform(flat).reshape(x.shape).astype(np.float32)


def aggregate_trials(
    y_window: np.ndarray,
    trial_ids: np.ndarray,
    probs: np.ndarray,
    rows: list[dict[str, Any]],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    true: list[int] = []
    pred: list[int] = []
    trial_probs: list[np.ndarray] = []
    for trial_id in sorted(set(int(v) for v in trial_ids)):
        mask = trial_ids == trial_id
        mean_prob = probs[mask].mean(axis=0)
        true.append(int(y_window[mask][0]))
        pred.append(int(np.argmax(mean_prob)))
        trial_probs.append(mean_prob)
    if len(true) != len(rows):
        raise RuntimeError(f"trial aggregation mismatch: {len(true)} predictions for {len(rows)} rows")
    return np.asarray(true), np.asarray(pred), np.vstack(trial_probs)


def metric_dict(y_true: np.ndarray, y_pred: np.ndarray, names: list[str]) -> dict[str, Any]:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "classification_report": classification_report(y_true, y_pred, target_names=names, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist(),
    }


def build_subject_windows(args: argparse.Namespace, subject: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict[str, Any]], np.ndarray]:
    obj = load_subject(args.source, subject)
    data = np.asarray(obj["data"], dtype=np.float64)
    labels = np.asarray(obj["labels"], dtype=np.float64)
    xs: list[np.ndarray] = []
    ys: list[int] = []
    trial_ids: list[int] = []
    rows: list[dict[str, Any]] = []
    trial_binary: list[int] = []
    for trial_idx in range(data.shape[0]):
        valence, arousal, dominance, liking = [float(v) for v in labels[trial_idx]]
        y = binary_label(labels[trial_idx], args.task, args.threshold)
        windows = extract_de_windows(data[trial_idx], args.sample_rate, args.window_sec, args.overlap_sec)
        xs.append(windows)
        ys.extend([y] * len(windows))
        trial_ids.extend([trial_idx] * len(windows))
        trial_binary.append(y)
        class_name = classify_deap_trial(valence, arousal, args.threshold)
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
                f"true_{args.task}_class": BINARY_CLASS_NAMES[args.task][y],
                f"true_{args.task}_id": y,
            }
        )
    return np.concatenate(xs).astype(np.float32), np.asarray(ys, dtype=np.int64), np.asarray(trial_ids, dtype=np.int64), rows, np.asarray(trial_binary)


def select_windows(
    x: np.ndarray,
    y: np.ndarray,
    trial_ids: np.ndarray,
    rows: list[dict[str, Any]],
    selected_trials: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict[str, Any]]]:
    selected = set(int(v) for v in selected_trials)
    mask = np.asarray([int(v) in selected for v in trial_ids])
    id_map = {old: new for new, old in enumerate(sorted(selected))}
    new_trial_ids = np.asarray([id_map[int(v)] for v in trial_ids[mask]], dtype=np.int64)
    split_rows = [rows[int(idx)] for idx in sorted(selected)]
    return x[mask], y[mask], new_trial_ids, split_rows


def make_loader(x: np.ndarray, y: np.ndarray, batch_size: int, shuffle: bool, device: torch.device) -> DataLoader:
    return DataLoader(
        TensorDataset(torch.from_numpy(x), torch.from_numpy(y)),
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=2,
        pin_memory=device.type == "cuda",
    )


def train_subject(args: argparse.Namespace, subject: int, device: torch.device) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    names = BINARY_CLASS_NAMES[args.task]
    x_all, y_all, trial_ids_all, rows_all, trial_binary = build_subject_windows(args, subject)
    train_trials, val_trials, test_trials = trial_split(trial_binary, args.seed + subject, args.train_size, args.val_size, args.split_mode)
    x_train, y_train, _train_trial_ids, _train_rows = select_windows(x_all, y_all, trial_ids_all, rows_all, train_trials)
    x_val, y_val, val_trial_ids, val_rows = select_windows(x_all, y_all, trial_ids_all, rows_all, val_trials)
    x_test, y_test, test_trial_ids, test_rows = select_windows(x_all, y_all, trial_ids_all, rows_all, test_trials)

    scaler = fit_standardizer(x_train)
    x_train = apply_standardizer(x_train, scaler)
    x_val = apply_standardizer(x_val, scaler)
    x_test = apply_standardizer(x_test, scaler)

    train_loader = make_loader(x_train, y_train, args.batch_size, True, device)
    val_loader = make_loader(x_val, y_val, args.batch_size, False, device)
    test_loader = make_loader(x_test, y_test, args.batch_size, False, device)

    counts = np.bincount(y_train, minlength=2).astype(np.float32)
    weights = counts.sum() / np.maximum(counts, 1.0)
    weights = weights / weights.mean()
    model = DGCNN(dropout=args.dropout).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay, eps=1e-4)
    criterion = nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device))

    best_state: dict[str, torch.Tensor] | None = None
    best_balanced = -1.0
    history: list[dict[str, float]] = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        losses: list[float] = []
        for xb, yb in train_loader:
            xb = xb.to(device, non_blocking=True)
            yb = yb.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            logits = model(xb)
            l2 = sum(torch.norm(param) for param in model.parameters()) * args.l2
            loss = criterion(logits, yb) + l2
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        _val_pred_window, val_prob_window = evaluate_windows(model, val_loader, device)
        val_true_trial, val_pred_trial, _val_prob_trial = aggregate_trials(y_val, val_trial_ids, val_prob_window, val_rows)
        val_bal = float(balanced_accuracy_score(val_true_trial, val_pred_trial))
        val_acc = float(accuracy_score(val_true_trial, val_pred_trial))
        history.append({"epoch": epoch, "loss": float(np.mean(losses)), "val_accuracy": val_acc, "val_balanced_accuracy": val_bal})
        if val_bal > best_balanced:
            best_balanced = val_bal
            best_state = {key: value.detach().cpu() for key, value in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    test_pred_window, test_prob_window = evaluate_windows(model, test_loader, device)
    test_true_trial, test_pred_trial, test_prob_trial = aggregate_trials(y_test, test_trial_ids, test_prob_window, test_rows)
    subject_metrics = metric_dict(test_true_trial, test_pred_trial, names)
    subject_report = {
        "subject": subject,
        "task": args.task,
        "train_trials": (train_trials + 1).tolist(),
        "val_trials": (val_trials + 1).tolist(),
        "test_trials": (test_trials + 1).tolist(),
        "best_val_balanced_accuracy": best_balanced,
        "test": subject_metrics,
        "history": history,
    }
    prediction_rows: list[dict[str, Any]] = []
    for row, true_id, pred_id, prob in zip(test_rows, test_true_trial, test_pred_trial, test_prob_trial):
        prediction_rows.append(
            {
                **row,
                f"true_{args.task}_class": names[int(true_id)],
                f"pred_{args.task}_class": names[int(pred_id)],
                f"{args.task}_probabilities": {names[i]: float(prob[i]) for i in range(2)},
            }
        )
    checkpoint = {
        "subject": subject,
        "state_dict": {key: value.cpu() for key, value in model.state_dict().items()},
        "scaler_mean": scaler.mean_,
        "scaler_scale": scaler.scale_,
        "task": args.task,
        "class_names": names,
    }
    return subject_report, prediction_rows, checkpoint


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--task", choices=["valence", "arousal"], required=True)
    parser.add_argument("--subjects", default="all")
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--sample-rate", type=int, default=128)
    parser.add_argument("--window-sec", type=float, default=1.0)
    parser.add_argument("--overlap-sec", type=float, default=0.0)
    parser.add_argument("--train-size", type=float, default=0.6)
    parser.add_argument("--val-size", type=float, default=0.2)
    parser.add_argument("--split-mode", choices=["task-stratified", "fixed"], default="task-stratified")
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.003)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--l2", type=float, default=0.0001)
    parser.add_argument("--dropout", type=float, default=0.35)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--seed", type=int, default=2024)
    parser.add_argument("--out-dir", type=Path, default=Path("runs/deap_dgcnn_subject_calibration"))
    parser.add_argument("--save-checkpoints", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu")
    subjects = parse_subjects(args.subjects)
    names = BINARY_CLASS_NAMES[args.task]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    reports: list[dict[str, Any]] = []
    predictions: list[dict[str, Any]] = []
    checkpoints: dict[int, dict[str, Any]] = {}
    for subject in subjects:
        report, rows, checkpoint = train_subject(args, subject, device)
        reports.append(report)
        predictions.extend(rows)
        if args.save_checkpoints:
            checkpoints[subject] = checkpoint
        test = report["test"]
        print(
            f"task={args.task} subject={subject:02d} "
            f"acc={test['accuracy']:.4f} bal={test['balanced_accuracy']:.4f} f1={test['macro_f1']:.4f}",
            flush=True,
        )

    y_true = [int(row[f"true_{args.task}_id"]) for row in predictions]
    y_pred = [names.index(str(row[f"pred_{args.task}_class"])) for row in predictions]
    summary = {
        "task": args.task,
        "source": str(args.source),
        "subjects": subjects,
        "threshold": args.threshold,
        "sample_rate": args.sample_rate,
        "window_sec": args.window_sec,
        "overlap_sec": args.overlap_sec,
        "train_size": args.train_size,
        "val_size": args.val_size,
        "split_mode": args.split_mode,
        "epochs": args.epochs,
        "device": str(device),
        "n_test_trials": len(predictions),
        "overall_test": metric_dict(np.asarray(y_true), np.asarray(y_pred), names),
        "mean_subject_balanced_accuracy": float(np.mean([item["test"]["balanced_accuracy"] for item in reports])),
        "std_subject_balanced_accuracy": float(np.std([item["test"]["balanced_accuracy"] for item in reports])),
        "subjects_report": reports,
    }

    report_path = args.out_dir / f"deap_dgcnn_subject_{args.task}_report.json"
    pred_path = args.out_dir / f"deap_dgcnn_subject_{args.task}_predictions.jsonl"
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    with pred_path.open("w", encoding="utf-8") as file:
        for row in predictions:
            file.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    if args.save_checkpoints:
        torch.save(checkpoints, args.out_dir / f"deap_dgcnn_subject_{args.task}_checkpoints.pt")

    print(json.dumps(summary["overall_test"], ensure_ascii=False, indent=2, sort_keys=True))
    print(f"mean_subject_balanced_accuracy={summary['mean_subject_balanced_accuracy']:.4f}")
    print(f"saved_report={report_path}")
    print(f"saved_predictions={pred_path}")


if __name__ == "__main__":
    main()
