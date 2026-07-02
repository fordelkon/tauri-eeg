#!/usr/bin/env python3
"""Train DEAP valence/arousal binary DGCNN encoders.

This script is the stronger EEG encoder stage for the regulation pipeline:
DEAP raw EEG -> differential entropy band features -> DGCNN binary heads.
The two binary heads can later be combined into the four system regulation
classes and reused as candidates for EEG-text EmotionCLIP alignment.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import torch
from deap_baseline_common import CLASS_NAMES, SYSTEM_EMOTION, classify_deap_trial, load_subject, parse_subjects
from scipy import signal
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


BANDS = ((0.5, 4.0), (4.0, 8.0), (8.0, 14.0), (14.0, 30.0), (30.0, 50.0))
BINARY_CLASS_NAMES = {
    "valence": ["low_valence", "high_valence"],
    "arousal": ["low_arousal", "high_arousal"],
}


class GraphConv(nn.Module):
    def __init__(self, k: int, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.k = k
        self.weight = nn.Parameter(torch.empty(k * in_channels, out_channels))
        nn.init.xavier_uniform_(self.weight)

    def forward(self, x: torch.Tensor, lap: torch.Tensor) -> torch.Tensor:
        terms = [x]
        if self.k >= 2:
            terms.append(torch.matmul(lap, x))
        for _ in range(2, self.k):
            terms.append(2 * torch.matmul(lap, terms[-1]) - terms[-2])
        cp = torch.stack(terms, dim=1).permute(0, 2, 3, 1).flatten(start_dim=2)
        return torch.matmul(cp, self.weight)


class DGCNN(nn.Module):
    def __init__(
        self,
        num_electrodes: int = 32,
        in_channels: int = 5,
        hidden: int = 128,
        num_classes: int = 2,
        k: int = 2,
        dropout: float = 0.5,
    ) -> None:
        super().__init__()
        self.adj = nn.Parameter(torch.empty(num_electrodes, num_electrodes))
        self.adj_bias = nn.Parameter(torch.empty(1))
        self.graph = GraphConv(k, in_channels, hidden)
        self.bias_relu = nn.Sequential()
        self.bias = nn.Parameter(torch.zeros(1, 1, hidden))
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(num_electrodes * hidden, 256)
        self.head = nn.Linear(256, num_classes)
        nn.init.xavier_uniform_(self.adj)
        nn.init.trunc_normal_(self.adj_bias, mean=0.0, std=0.1)
        nn.init.xavier_normal_(self.fc.weight)
        nn.init.zeros_(self.fc.bias)
        nn.init.xavier_normal_(self.head.weight)
        nn.init.zeros_(self.head.bias)

    def forward(self, x: torch.Tensor, return_embedding: bool = False) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
        adj = self.relu(self.adj + self.adj_bias)
        degree = torch.sum(adj, dim=1)
        inv_sqrt = torch.rsqrt(degree + 1e-5)
        dmat = torch.diag_embed(inv_sqrt)
        lap = torch.eye(adj.shape[0], device=adj.device) - dmat @ adj @ dmat
        x = self.graph(x, lap)
        x = self.dropout(self.relu(x + self.bias))
        x = x.reshape(x.shape[0], -1)
        emb = self.dropout(self.relu(self.fc(self.dropout(x))))
        logits = self.head(self.dropout(emb))
        if return_embedding:
            return logits, emb
        return logits


def binary_label(labels: np.ndarray, task: str, threshold: float) -> int:
    col = 0 if task == "valence" else 1
    return int(float(labels[col]) >= threshold)


def extract_de_windows(
    eeg: np.ndarray,
    sample_rate: int,
    window_sec: float,
    overlap_sec: float,
    bands: tuple[tuple[float, float], ...] = BANDS,
) -> np.ndarray:
    """Return windows x 32 channels x 5 DE-band features."""
    x = np.asarray(eeg[:32], dtype=np.float64)
    window = int(round(window_sec * sample_rate))
    step = max(1, window - int(round(overlap_sec * sample_rate)))
    n_windows = max(1, 1 + (x.shape[1] - window) // step)
    out = np.zeros((n_windows, x.shape[0], len(bands)), dtype=np.float32)
    nyq = 0.5 * sample_rate
    for band_idx, (low, high) in enumerate(bands):
        b, a = signal.butter(3, [low / nyq, high / nyq], btype="bandpass")
        band_data = signal.filtfilt(b, a, x, axis=1)
        start = 0
        for win_idx in range(n_windows):
            segment = band_data[:, start : start + window]
            var = np.var(segment, axis=1, ddof=1)
            out[win_idx, :, band_idx] = 0.5 * np.log2(2 * math.pi * math.e * np.maximum(var, 1e-12))
            start += step
    return out


def cache_name(args: argparse.Namespace, subjects: list[int], split: str) -> str:
    subject_key = "-".join(str(v) for v in subjects)
    return (
        f"deap_{split}_{args.task}_thr{args.threshold:g}_sr{args.sample_rate}_"
        f"win{args.window_sec:g}_ov{args.overlap_sec:g}_s{subject_key}.npz"
    )


def load_or_build_windows(
    args: argparse.Namespace,
    subjects: list[int],
    split: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict[str, Any]]]:
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = args.cache_dir / cache_name(args, subjects, split)
    if cache_path.is_file() and not args.rebuild_cache:
        cached = np.load(cache_path, allow_pickle=True)
        rows = [dict(item) for item in cached["rows"].tolist()]
        return cached["x"], cached["y_window"], cached["trial_ids"], rows

    xs: list[np.ndarray] = []
    ys: list[int] = []
    trial_ids: list[int] = []
    rows: list[dict[str, Any]] = []
    global_trial_id = 0
    for subject in subjects:
        obj = load_subject(args.source, subject)
        data = np.asarray(obj["data"], dtype=np.float64)
        labels = np.asarray(obj["labels"], dtype=np.float64)
        for trial_idx in range(data.shape[0]):
            valence, arousal, dominance, liking = [float(v) for v in labels[trial_idx]]
            y = binary_label(labels[trial_idx], args.task, args.threshold)
            windows = extract_de_windows(data[trial_idx], args.sample_rate, args.window_sec, args.overlap_sec)
            xs.append(windows)
            ys.extend([y] * len(windows))
            trial_ids.extend([global_trial_id] * len(windows))
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
            global_trial_id += 1

    x = np.concatenate(xs, axis=0).astype(np.float32)
    y_window = np.asarray(ys, dtype=np.int64)
    trial_ids_array = np.asarray(trial_ids, dtype=np.int64)
    np.savez_compressed(cache_path, x=x, y_window=y_window, trial_ids=trial_ids_array, rows=np.asarray(rows, dtype=object))
    return x, y_window, trial_ids_array, rows


def fit_standardizer(x_train: np.ndarray) -> StandardScaler:
    scaler = StandardScaler()
    scaler.fit(x_train.reshape(-1, x_train.shape[-1]))
    return scaler


def apply_standardizer(x: np.ndarray, scaler: StandardScaler) -> np.ndarray:
    flat = x.reshape(-1, x.shape[-1])
    return scaler.transform(flat).reshape(x.shape).astype(np.float32)


def evaluate_windows(model: nn.Module, loader: DataLoader, device: torch.device) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    probs: list[np.ndarray] = []
    preds: list[np.ndarray] = []
    with torch.no_grad():
        for xb, _yb in loader:
            logits = model(xb.to(device))
            prob = torch.softmax(logits, dim=1).cpu().numpy()
            probs.append(prob)
            preds.append(np.argmax(prob, axis=1))
    return np.concatenate(preds), np.vstack(probs)


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--task", choices=["valence", "arousal"], required=True)
    parser.add_argument("--train-subjects", default="1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20")
    parser.add_argument("--val-subjects", default="21,22,23,24")
    parser.add_argument("--test-subjects", default="25,26,27,28,29,30,31,32")
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--sample-rate", type=int, default=128)
    parser.add_argument("--window-sec", type=float, default=1.0)
    parser.add_argument("--overlap-sec", type=float, default=0.0)
    parser.add_argument("--epochs", type=int, default=150)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=0.01)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--l2-adj", type=float, default=0.01)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--seed", type=int, default=2024)
    parser.add_argument("--cache-dir", type=Path, default=Path("runs/deap_dgcnn_cache"))
    parser.add_argument("--out-dir", type=Path, default=Path("runs/deap_dgcnn_binary"))
    parser.add_argument("--rebuild-cache", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu")
    names = BINARY_CLASS_NAMES[args.task]
    train_subjects = parse_subjects(args.train_subjects)
    val_subjects = parse_subjects(args.val_subjects)
    test_subjects = parse_subjects(args.test_subjects)

    x_train, y_train, _train_trials, _train_rows = load_or_build_windows(args, train_subjects, "train")
    x_val, y_val, val_trials, val_rows = load_or_build_windows(args, val_subjects, "val")
    x_test, y_test, test_trials, test_rows = load_or_build_windows(args, test_subjects, "test")

    scaler = fit_standardizer(x_train)
    x_train = apply_standardizer(x_train, scaler)
    x_val = apply_standardizer(x_val, scaler)
    x_test = apply_standardizer(x_test, scaler)

    train_loader = DataLoader(
        TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train)),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=2,
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(
        TensorDataset(torch.from_numpy(x_val), torch.from_numpy(y_val)),
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=2,
        pin_memory=device.type == "cuda",
    )
    test_loader = DataLoader(
        TensorDataset(torch.from_numpy(x_test), torch.from_numpy(y_test)),
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=2,
        pin_memory=device.type == "cuda",
    )

    counts = np.bincount(y_train, minlength=2).astype(np.float32)
    weights = counts.sum() / np.maximum(counts, 1.0)
    weights = weights / weights.mean()
    model = DGCNN().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay, eps=1e-4)
    criterion = nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device))

    history: list[dict[str, float]] = []
    best_state: dict[str, torch.Tensor] | None = None
    best_balanced = -1.0
    for epoch in range(1, args.epochs + 1):
        model.train()
        losses: list[float] = []
        for xb, yb in train_loader:
            xb = xb.to(device, non_blocking=True)
            yb = yb.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            logits = model(xb)
            l2 = sum(torch.norm(param) for param in model.parameters()) * args.l2_adj
            loss = criterion(logits, yb) + l2
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))

        val_pred_window, val_prob_window = evaluate_windows(model, val_loader, device)
        val_true_trial, val_pred_trial, _val_prob_trial = aggregate_trials(y_val, val_trials, val_prob_window, val_rows)
        val_balanced = float(balanced_accuracy_score(val_true_trial, val_pred_trial))
        val_acc = float(accuracy_score(val_true_trial, val_pred_trial))
        history.append({"epoch": epoch, "loss": float(np.mean(losses)), "val_accuracy": val_acc, "val_balanced_accuracy": val_balanced})
        if val_balanced > best_balanced:
            best_balanced = val_balanced
            best_state = {key: value.detach().cpu() for key, value in model.state_dict().items()}
        if epoch == 1 or epoch % 10 == 0 or epoch == args.epochs:
            window_acc = accuracy_score(y_val, val_pred_window)
            print(
                f"task={args.task} epoch={epoch} loss={np.mean(losses):.4f} "
                f"val_trial_acc={val_acc:.4f} val_trial_bal={val_balanced:.4f} val_window_acc={window_acc:.4f}",
                flush=True,
            )

    if best_state is not None:
        model.load_state_dict(best_state)
    val_pred_window, val_prob_window = evaluate_windows(model, val_loader, device)
    test_pred_window, test_prob_window = evaluate_windows(model, test_loader, device)
    val_true_trial, val_pred_trial, val_prob_trial = aggregate_trials(y_val, val_trials, val_prob_window, val_rows)
    test_true_trial, test_pred_trial, test_prob_trial = aggregate_trials(y_test, test_trials, test_prob_window, test_rows)

    report = {
        "task": args.task,
        "class_names": names,
        "source": str(args.source),
        "threshold": args.threshold,
        "train_subjects": train_subjects,
        "val_subjects": val_subjects,
        "test_subjects": test_subjects,
        "sample_rate": args.sample_rate,
        "window_sec": args.window_sec,
        "overlap_sec": args.overlap_sec,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "lr": args.lr,
        "device": str(device),
        "n_train_windows": int(len(y_train)),
        "n_val_windows": int(len(y_val)),
        "n_test_windows": int(len(y_test)),
        "window_metrics": {
            "val": metric_dict(y_val, val_pred_window, names),
            "test": metric_dict(y_test, test_pred_window, names),
        },
        "trial_metrics": {
            "val": metric_dict(val_true_trial, val_pred_trial, names),
            "test": metric_dict(test_true_trial, test_pred_trial, names),
        },
        "history": history,
    }

    args.out_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.out_dir / f"deap_dgcnn_{args.task}.pt"
    report_path = args.out_dir / f"deap_dgcnn_{args.task}_report.json"
    pred_path = args.out_dir / f"deap_dgcnn_{args.task}_predictions.jsonl"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "task": args.task,
            "class_names": names,
            "threshold": args.threshold,
            "bands": BANDS,
            "sample_rate": args.sample_rate,
            "window_sec": args.window_sec,
            "overlap_sec": args.overlap_sec,
            "scaler_mean": scaler.mean_,
            "scaler_scale": scaler.scale_,
        },
        model_path,
    )
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    with pred_path.open("w", encoding="utf-8") as file:
        for row, true_id, pred_id, prob in zip(test_rows, test_true_trial, test_pred_trial, test_prob_trial):
            item = {
                **row,
                f"true_{args.task}_class": names[int(true_id)],
                f"pred_{args.task}_class": names[int(pred_id)],
                f"{args.task}_probabilities": {names[i]: float(prob[i]) for i in range(2)},
            }
            file.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")

    print(json.dumps(report["trial_metrics"]["test"], ensure_ascii=False, indent=2, sort_keys=True))
    print(f"saved_model={model_path}")
    print(f"saved_report={report_path}")
    print(f"saved_predictions={pred_path}")


if __name__ == "__main__":
    main()
