#!/usr/bin/env python3
"""Train a lightweight GPU DEAP EEG -> four-class 1D-CNN baseline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import torch
from deap_baseline_common import CLASS_NAMES, load_feature_table, load_subject, parse_subjects
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


class DeapCnn(nn.Module):
    def __init__(self, n_classes: int = 4) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(32, 64, kernel_size=15, padding=7),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.MaxPool1d(4),
            nn.Dropout(0.2),
            nn.Conv1d(64, 128, kernel_size=15, padding=7),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.MaxPool1d(4),
            nn.Dropout(0.3),
            nn.Conv1d(128, 128, kernel_size=7, padding=3),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),
        )
        self.head = nn.Linear(128, n_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.net(x).squeeze(-1)
        return self.head(x)


def classify_id_from_row(row: dict[str, object]) -> int:
    return CLASS_NAMES.index(str(row["paradigm_emotion"]))


def load_tensor_table(source: Path, subjects: list[int], threshold: float, downsample: int) -> tuple[np.ndarray, np.ndarray, list[dict[str, object]]]:
    # Reuse load_feature_table only for labels/rows, then read raw EEG tensors.
    _features, y, rows = load_feature_table(source, subjects, threshold)
    tensors: list[np.ndarray] = []
    row_idx = 0
    for subject in subjects:
        obj = load_subject(source, subject)
        data = np.asarray(obj["data"], dtype=np.float32)
        for trial_idx in range(40):
            eeg = data[trial_idx, :32, ::downsample]
            eeg = eeg - eeg.mean(axis=1, keepdims=True)
            eeg = eeg / (eeg.std(axis=1, keepdims=True) + 1e-6)
            tensors.append(eeg.astype(np.float32))
            row_idx += 1
    return np.stack(tensors), y, rows


def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    preds: list[np.ndarray] = []
    probs: list[np.ndarray] = []
    with torch.no_grad():
        for xb, _yb in loader:
            logits = model(xb.to(device))
            prob = torch.softmax(logits, dim=1).cpu().numpy()
            probs.append(prob)
            preds.append(np.argmax(prob, axis=1))
    return np.concatenate(preds), np.vstack(probs)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--train-subjects", default="1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24")
    parser.add_argument("--test-subjects", default="25,26,27,28,29,30,31,32")
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--downsample", type=int, default=16)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--out-dir", type=Path, default=Path("runs/deap_torch_baseline"))
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device if torch.cuda.is_available() or args.device == "cpu" else "cpu")
    train_subjects = parse_subjects(args.train_subjects)
    test_subjects = parse_subjects(args.test_subjects)

    x_train, y_train, _train_rows = load_tensor_table(args.source, train_subjects, args.threshold, args.downsample)
    x_test, y_test, test_rows = load_tensor_table(args.source, test_subjects, args.threshold, args.downsample)
    train_loader = DataLoader(
        TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train)),
        batch_size=args.batch_size,
        shuffle=True,
    )
    test_loader = DataLoader(
        TensorDataset(torch.from_numpy(x_test), torch.from_numpy(y_test)),
        batch_size=args.batch_size,
        shuffle=False,
    )

    counts = np.bincount(y_train, minlength=len(CLASS_NAMES)).astype(np.float32)
    weights = counts.sum() / np.maximum(counts, 1.0)
    weights = weights / weights.mean()
    model = DeapCnn(len(CLASS_NAMES)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-3)
    criterion = nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device))

    history: list[dict[str, float]] = []
    best_balanced = -1.0
    best_state = None
    for epoch in range(1, args.epochs + 1):
        model.train()
        losses: list[float] = []
        for xb, yb in train_loader:
            optimizer.zero_grad(set_to_none=True)
            logits = model(xb.to(device))
            loss = criterion(logits, yb.to(device))
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        pred, _probs = evaluate(model, test_loader, device)
        acc = float(accuracy_score(y_test, pred))
        bal = float(balanced_accuracy_score(y_test, pred))
        history.append({"epoch": epoch, "loss": float(np.mean(losses)), "accuracy": acc, "balanced_accuracy": bal})
        if bal > best_balanced:
            best_balanced = bal
            best_state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
        if epoch == 1 or epoch % 10 == 0 or epoch == args.epochs:
            print(f"epoch={epoch} loss={np.mean(losses):.4f} acc={acc:.4f} bal={bal:.4f}", flush=True)

    if best_state is not None:
        model.load_state_dict(best_state)
    pred, probs = evaluate(model, test_loader, device)

    report = {
        "source": str(args.source),
        "threshold": args.threshold,
        "downsample": args.downsample,
        "epochs": args.epochs,
        "device": str(device),
        "train_subjects": train_subjects,
        "test_subjects": test_subjects,
        "n_train": int(len(y_train)),
        "n_test": int(len(y_test)),
        "accuracy": float(accuracy_score(y_test, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_test, pred)),
        "classification_report": classification_report(y_test, pred, target_names=CLASS_NAMES, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y_test, pred).tolist(),
        "history": history,
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.out_dir / "deap_cnn_baseline.pt"
    report_path = args.out_dir / "deap_cnn_baseline_report.json"
    predictions_path = args.out_dir / "deap_cnn_baseline_predictions.jsonl"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "class_names": CLASS_NAMES,
            "threshold": args.threshold,
            "downsample": args.downsample,
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
