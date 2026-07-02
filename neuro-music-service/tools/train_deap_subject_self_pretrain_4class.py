#!/usr/bin/env python3
"""Single-subject self-supervised DGCNN pretraining plus four-class fine-tuning."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
from deap_baseline_common import CLASS_NAMES, SYSTEM_EMOTION, classify_deap_trial, load_subject, parse_subjects
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from train_deap_dgcnn_binary import DGCNN, extract_de_windows


class PretrainDGCNN(nn.Module):
    def __init__(self, embed_dim: int, dropout: float) -> None:
        super().__init__()
        self.encoder = DGCNN(num_classes=len(CLASS_NAMES), dropout=dropout)
        self.projector = nn.Sequential(
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, embed_dim),
        )

    def embedding(self, x: torch.Tensor) -> torch.Tensor:
        _logits, emb = self.encoder(x, return_embedding=True)
        return emb

    def projection(self, x: torch.Tensor) -> torch.Tensor:
        return torch.nn.functional.normalize(self.projector(self.embedding(x)), dim=1)


class FineTuneHead(nn.Module):
    def __init__(self, encoder: DGCNN, dropout: float) -> None:
        super().__init__()
        self.encoder = encoder
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(256, len(CLASS_NAMES))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        _old_logits, emb = self.encoder(x, return_embedding=True)
        return self.head(self.dropout(emb))


def trial_split(labels: np.ndarray, seed: int, train_size: float, val_size: float, split_mode: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    indices = np.arange(len(labels))
    if split_mode == "fixed":
        rng = np.random.default_rng(seed)
        shuffled = indices.copy()
        rng.shuffle(shuffled)
        n_train = int(round(len(indices) * train_size))
        n_val = int(round(len(indices) * val_size))
        return np.sort(shuffled[:n_train]), np.sort(shuffled[n_train : n_train + n_val]), np.sort(shuffled[n_train + n_val :])
    counts = np.bincount(labels, minlength=len(CLASS_NAMES))
    stratify = labels if np.min(counts[counts > 0]) >= 3 else None
    train_idx, temp_idx, _train_y, temp_y = train_test_split(indices, labels, train_size=train_size, random_state=seed, stratify=stratify)
    relative_val = val_size / (1.0 - train_size)
    temp_counts = np.bincount(temp_y, minlength=len(CLASS_NAMES))
    temp_stratify = temp_y if np.min(temp_counts[temp_counts > 0]) >= 2 else None
    val_idx, test_idx = train_test_split(temp_idx, train_size=relative_val, random_state=seed + 1, stratify=temp_stratify)
    return np.sort(train_idx), np.sort(val_idx), np.sort(test_idx)


def build_subject_windows(args: argparse.Namespace, subject: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict[str, Any]], np.ndarray]:
    obj = load_subject(args.source, subject)
    data = np.asarray(obj["data"], dtype=np.float64)
    labels = np.asarray(obj["labels"], dtype=np.float64)
    xs: list[np.ndarray] = []
    ys: list[int] = []
    trial_ids: list[int] = []
    rows: list[dict[str, Any]] = []
    trial_labels: list[int] = []
    class_to_id = {name: idx for idx, name in enumerate(CLASS_NAMES)}
    for trial_idx in range(data.shape[0]):
        valence, arousal, dominance, liking = [float(v) for v in labels[trial_idx]]
        class_name = classify_deap_trial(valence, arousal, args.threshold)
        class_id = class_to_id[class_name]
        windows = extract_de_windows(data[trial_idx], args.sample_rate, args.window_sec, args.overlap_sec)
        xs.append(windows)
        ys.extend([class_id] * len(windows))
        trial_ids.extend([trial_idx] * len(windows))
        trial_labels.append(class_id)
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
    return np.concatenate(xs).astype(np.float32), np.asarray(ys, dtype=np.int64), np.asarray(trial_ids, dtype=np.int64), rows, np.asarray(trial_labels, dtype=np.int64)


def select_windows(x: np.ndarray, y: np.ndarray, trial_ids: np.ndarray, rows: list[dict[str, Any]], selected_trials: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict[str, Any]]]:
    selected = set(int(v) for v in selected_trials)
    mask = np.asarray([int(v) in selected for v in trial_ids])
    id_map = {old: new for new, old in enumerate(sorted(selected))}
    new_trial_ids = np.asarray([id_map[int(v)] for v in trial_ids[mask]], dtype=np.int64)
    split_rows = [rows[int(idx)] for idx in sorted(selected)]
    return x[mask], y[mask], new_trial_ids, split_rows


def fit_standardizer(x_train: np.ndarray) -> StandardScaler:
    scaler = StandardScaler()
    scaler.fit(x_train.reshape(-1, x_train.shape[-1]))
    return scaler


def apply_standardizer(x: np.ndarray, scaler: StandardScaler) -> np.ndarray:
    flat = x.reshape(-1, x.shape[-1])
    return scaler.transform(flat).reshape(x.shape).astype(np.float32)


def make_loader(x: np.ndarray, y: np.ndarray, batch_size: int, shuffle: bool, device: torch.device) -> DataLoader:
    return DataLoader(
        TensorDataset(torch.from_numpy(x), torch.from_numpy(y)),
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=2,
        pin_memory=device.type == "cuda",
        drop_last=False,
    )


def augment(x: torch.Tensor, noise_std: float, drop_prob: float) -> torch.Tensor:
    out = x + torch.randn_like(x) * noise_std
    if drop_prob > 0:
        channel_mask = (torch.rand(out.shape[0], out.shape[1], 1, device=out.device) > drop_prob).float()
        band_mask = (torch.rand(out.shape[0], 1, out.shape[2], device=out.device) > drop_prob).float()
        out = out * channel_mask * band_mask
    return out


def nt_xent(z1: torch.Tensor, z2: torch.Tensor, temperature: float) -> torch.Tensor:
    batch = z1.shape[0]
    z = torch.cat([z1, z2], dim=0)
    logits = z @ z.t() / temperature
    logits = logits.masked_fill(torch.eye(2 * batch, device=z.device, dtype=torch.bool), -1e9)
    labels = torch.cat([torch.arange(batch, 2 * batch), torch.arange(0, batch)]).to(z.device)
    return nn.CrossEntropyLoss()(logits, labels)


def pretrain_subject(args: argparse.Namespace, model: PretrainDGCNN, x_all: np.ndarray, device: torch.device) -> list[dict[str, float]]:
    dummy = np.zeros(len(x_all), dtype=np.int64)
    data_loader = make_loader(x_all, dummy, args.batch_size, True, device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.pretrain_lr, weight_decay=args.weight_decay)
    history: list[dict[str, float]] = []
    for epoch in range(1, args.pretrain_epochs + 1):
        model.train()
        losses: list[float] = []
        for xb, _yb in data_loader:
            xb = xb.to(device, non_blocking=True)
            if xb.shape[0] < 2:
                continue
            optimizer.zero_grad(set_to_none=True)
            loss = nt_xent(model.projection(augment(xb, args.noise_std, args.drop_prob)), model.projection(augment(xb, args.noise_std, args.drop_prob)), args.temperature)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        history.append({"epoch": epoch, "loss": float(np.mean(losses)) if losses else 0.0})
        if epoch == 1 or epoch % 20 == 0 or epoch == args.pretrain_epochs:
            print(f"pretrain epoch={epoch} loss={history[-1]['loss']:.4f}", flush=True)
    return history


@torch.no_grad()
def predict(model: nn.Module, data_loader: DataLoader, device: torch.device) -> np.ndarray:
    model.eval()
    probs: list[np.ndarray] = []
    for xb, _yb in data_loader:
        probs.append(torch.softmax(model(xb.to(device, non_blocking=True)), dim=1).cpu().numpy())
    return np.vstack(probs)


def aggregate_trials(y_window: np.ndarray, trial_ids: np.ndarray, probs: np.ndarray, rows: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    y_true: list[int] = []
    y_pred: list[int] = []
    trial_probs: list[np.ndarray] = []
    for trial_id in sorted(set(int(v) for v in trial_ids)):
        mask = trial_ids == trial_id
        prob = probs[mask].mean(axis=0)
        y_true.append(int(y_window[mask][0]))
        y_pred.append(int(np.argmax(prob)))
        trial_probs.append(prob)
    if len(y_true) != len(rows):
        raise RuntimeError(f"trial aggregation mismatch: {len(y_true)} predictions for {len(rows)} rows")
    return np.asarray(y_true), np.asarray(y_pred), np.vstack(trial_probs)


def metric_dict(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "classification_report": classification_report(y_true, y_pred, target_names=CLASS_NAMES, labels=list(range(len(CLASS_NAMES))), output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=list(range(len(CLASS_NAMES)))).tolist(),
    }


def finetune_subject(
    args: argparse.Namespace,
    pretrained: PretrainDGCNN,
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    val_trial_ids: np.ndarray,
    val_rows: list[dict[str, Any]],
    x_test: np.ndarray,
    y_test: np.ndarray,
    test_trial_ids: np.ndarray,
    test_rows: list[dict[str, Any]],
    device: torch.device,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    model = FineTuneHead(pretrained.encoder, args.dropout).to(device)
    if args.freeze_encoder:
        for param in model.encoder.parameters():
            param.requires_grad = False
    train_loader = make_loader(x_train, y_train, args.batch_size, True, device)
    val_loader = make_loader(x_val, y_val, args.batch_size, False, device)
    test_loader = make_loader(x_test, y_test, args.batch_size, False, device)
    counts = np.bincount(y_train, minlength=len(CLASS_NAMES)).astype(np.float32)
    weights = counts.sum() / np.maximum(counts, 1.0)
    weights = weights / weights.mean()
    criterion = nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device))
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=args.weight_decay, eps=1e-4)
    best_state = None
    best_balanced = -1.0
    history: list[dict[str, float]] = []
    for epoch in range(1, args.finetune_epochs + 1):
        model.train()
        losses: list[float] = []
        for xb, yb in train_loader:
            xb = xb.to(device, non_blocking=True)
            yb = yb.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            l2 = sum(torch.norm(param) for param in model.parameters() if param.requires_grad) * args.l2
            loss = criterion(model(xb), yb) + l2
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        val_probs = predict(model, val_loader, device)
        val_true, val_pred, _ = aggregate_trials(y_val, val_trial_ids, val_probs, val_rows)
        val_bal = float(balanced_accuracy_score(val_true, val_pred))
        val_acc = float(accuracy_score(val_true, val_pred))
        history.append({"epoch": epoch, "loss": float(np.mean(losses)), "val_accuracy": val_acc, "val_balanced_accuracy": val_bal})
        if val_bal > best_balanced:
            best_balanced = val_bal
            best_state = {key: value.detach().cpu() for key, value in model.state_dict().items()}
    if best_state is not None:
        model.load_state_dict(best_state)
    test_probs = predict(model, test_loader, device)
    test_true, test_pred, test_trial_probs = aggregate_trials(y_test, test_trial_ids, test_probs, test_rows)
    predictions = []
    for row, true_id, pred_id, prob in zip(test_rows, test_true, test_pred, test_trial_probs):
        predictions.append(
            {
                **row,
                "true_class": CLASS_NAMES[int(true_id)],
                "pred_class": CLASS_NAMES[int(pred_id)],
                "probabilities": {CLASS_NAMES[i]: float(prob[i]) for i in range(len(CLASS_NAMES))},
            }
        )
    return {"best_val_balanced_accuracy": best_balanced, "test": metric_dict(test_true, test_pred), "history": history}, predictions


def run_subject(args: argparse.Namespace, subject: int, device: torch.device) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    x_all, y_all, trial_ids_all, rows_all, trial_labels = build_subject_windows(args, subject)
    train_trials, val_trials, test_trials = trial_split(trial_labels, args.seed + subject, args.train_size, args.val_size, args.split_mode)
    x_train, y_train, _train_trial_ids, _train_rows = select_windows(x_all, y_all, trial_ids_all, rows_all, train_trials)
    x_val, y_val, val_trial_ids, val_rows = select_windows(x_all, y_all, trial_ids_all, rows_all, val_trials)
    x_test, y_test, test_trial_ids, test_rows = select_windows(x_all, y_all, trial_ids_all, rows_all, test_trials)
    scaler = fit_standardizer(x_train if args.pretrain_scope == "train" else x_all)
    x_all = apply_standardizer(x_all, scaler)
    x_train = apply_standardizer(x_train, scaler)
    x_val = apply_standardizer(x_val, scaler)
    x_test = apply_standardizer(x_test, scaler)

    pretrain_x = x_train if args.pretrain_scope == "train" else x_all
    pretrained = PretrainDGCNN(args.embed_dim, args.dropout).to(device)
    pretrain_history = pretrain_subject(args, pretrained, pretrain_x, device)
    finetune_report, predictions = finetune_subject(args, pretrained, x_train, y_train, x_val, y_val, val_trial_ids, val_rows, x_test, y_test, test_trial_ids, test_rows, device)
    report = {
        "subject": subject,
        "split_mode": args.split_mode,
        "pretrain_scope": args.pretrain_scope,
        "train_trials": (train_trials + 1).tolist(),
        "val_trials": (val_trials + 1).tolist(),
        "test_trials": (test_trials + 1).tolist(),
        "pretrain_history": pretrain_history,
        "fine_tune": finetune_report,
    }
    return report, predictions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--subjects", default="5,10,22,24")
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--sample-rate", type=int, default=128)
    parser.add_argument("--window-sec", type=float, default=1.0)
    parser.add_argument("--overlap-sec", type=float, default=0.0)
    parser.add_argument("--train-size", type=float, default=0.6)
    parser.add_argument("--val-size", type=float, default=0.2)
    parser.add_argument("--split-mode", choices=["task-stratified", "fixed"], default="fixed")
    parser.add_argument("--pretrain-scope", choices=["train", "all"], default="all")
    parser.add_argument("--pretrain-epochs", type=int, default=120)
    parser.add_argument("--finetune-epochs", type=int, default=120)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--pretrain-lr", type=float, default=0.001)
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--l2", type=float, default=0.0001)
    parser.add_argument("--dropout", type=float, default=0.35)
    parser.add_argument("--embed-dim", type=int, default=128)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--noise-std", type=float, default=0.05)
    parser.add_argument("--drop-prob", type=float, default=0.08)
    parser.add_argument("--freeze-encoder", action="store_true")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--seed", type=int, default=2024)
    parser.add_argument("--out-dir", type=Path, default=Path("runs/deap_subject_self_pretrain_4class"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    reports: list[dict[str, Any]] = []
    predictions: list[dict[str, Any]] = []
    for subject in parse_subjects(args.subjects):
        report, rows = run_subject(args, subject, device)
        reports.append(report)
        predictions.extend(rows)
        test = report["fine_tune"]["test"]
        print(f"subject={subject:02d} selfpretrain4 acc={test['accuracy']:.4f} bal={test['balanced_accuracy']:.4f} f1={test['macro_f1']:.4f}", flush=True)

    y_true = [CLASS_NAMES.index(row["true_class"]) for row in predictions]
    y_pred = [CLASS_NAMES.index(row["pred_class"]) for row in predictions]
    summary = {
        "subjects": parse_subjects(args.subjects),
        "class_names": CLASS_NAMES,
        "split_mode": args.split_mode,
        "pretrain_scope": args.pretrain_scope,
        "overall_test": metric_dict(np.asarray(y_true), np.asarray(y_pred)),
        "mean_subject_balanced_accuracy": float(np.mean([item["fine_tune"]["test"]["balanced_accuracy"] for item in reports])),
        "std_subject_balanced_accuracy": float(np.std([item["fine_tune"]["test"]["balanced_accuracy"] for item in reports])),
        "subjects_report": reports,
    }
    report_path = args.out_dir / "deap_subject_self_pretrain_4class_report.json"
    pred_path = args.out_dir / "deap_subject_self_pretrain_4class_predictions.jsonl"
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    with pred_path.open("w", encoding="utf-8") as file:
        for row in predictions:
            file.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    print(json.dumps(summary["overall_test"], ensure_ascii=False, indent=2, sort_keys=True))
    print(f"mean_subject_balanced_accuracy={summary['mean_subject_balanced_accuracy']:.4f}")
    print(f"saved_report={report_path}")
    print(f"saved_predictions={pred_path}")


if __name__ == "__main__":
    main()
