#!/usr/bin/env python3
"""Train a minimal DEAP EEG-text EmotionCLIP and downstream classifiers.

The goal is to test the pipeline shape before adding large external text/audio
models:

DEAP EEG DE-band windows -> DGCNN EEG encoder -> EEG-text contrastive pretrain
-> zero-shot prompt classifier, frozen linear probe, and fine-tuned classifier.

The text side uses deterministic prompt-hash vectors so this experiment can run
on the remote server without internet or model downloads. It should later be
replaced by a real text/audio/video CLIP encoder.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import torch
from deap_baseline_common import CLASS_NAMES, SYSTEM_EMOTION, classify_deap_trial, load_subject, parse_subjects
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from train_deap_dgcnn_binary import DGCNN, extract_de_windows


PROMPTS = {
    "depression": "low valence low arousal sad depressive tired negative emotion",
    "anxiety": "low valence high arousal anxious fearful tense stressed emotion",
    "calm": "high valence low arousal calm neutral relaxed peaceful emotion",
    "happy": "high valence high arousal happy joyful positive excited emotion",
}


class EmotionCLIP(nn.Module):
    def __init__(self, text_features: torch.Tensor, embed_dim: int = 128, dropout: float = 0.35) -> None:
        super().__init__()
        self.eeg_encoder = DGCNN(num_classes=len(CLASS_NAMES), dropout=dropout)
        self.eeg_proj = nn.Linear(256, embed_dim)
        self.text_proj = nn.Linear(text_features.shape[1], embed_dim)
        self.logit_scale = nn.Parameter(torch.tensor(1.0))
        self.register_buffer("text_features", text_features)

    def eeg_embedding(self, x: torch.Tensor) -> torch.Tensor:
        _logits, emb = self.eeg_encoder(x, return_embedding=True)
        return torch.nn.functional.normalize(self.eeg_proj(emb), dim=1)

    def text_embedding(self) -> torch.Tensor:
        return torch.nn.functional.normalize(self.text_proj(self.text_features), dim=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.logit_scale.exp().clamp(max=100.0) * self.eeg_embedding(x) @ self.text_embedding().t()


def prompt_hash_features(dim: int) -> np.ndarray:
    features = np.zeros((len(CLASS_NAMES), dim), dtype=np.float32)
    for class_idx, class_name in enumerate(CLASS_NAMES):
        tokens = re.findall(r"[a-zA-Z]+", PROMPTS[class_name].lower())
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            idx = int.from_bytes(digest[:4], "little") % dim
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            features[class_idx, idx] += sign
    norms = np.linalg.norm(features, axis=1, keepdims=True)
    return features / np.maximum(norms, 1e-6)


def fixed_trials(subject: int, seed: int, train_size: float, val_size: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed + subject)
    indices = np.arange(40)
    rng.shuffle(indices)
    n_train = int(round(len(indices) * train_size))
    n_val = int(round(len(indices) * val_size))
    return np.sort(indices[:n_train]), np.sort(indices[n_train : n_train + n_val]), np.sort(indices[n_train + n_val :])


def add_trial(
    xs: list[np.ndarray],
    ys: list[int],
    trial_ids: list[int],
    rows: list[dict[str, Any]],
    subject: int,
    trial_idx: int,
    eeg: np.ndarray,
    label: np.ndarray,
    args: argparse.Namespace,
) -> None:
    valence, arousal, dominance, liking = [float(v) for v in label]
    class_name = classify_deap_trial(valence, arousal, args.threshold)
    class_id = CLASS_NAMES.index(class_name)
    windows = extract_de_windows(eeg, args.sample_rate, args.window_sec, args.overlap_sec)
    trial_id = len(rows)
    xs.append(windows)
    ys.extend([class_id] * len(windows))
    trial_ids.extend([trial_id] * len(windows))
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


def cache_path(args: argparse.Namespace) -> Path:
    key = (
        f"emotionclip_{args.split_mode}_thr{args.threshold:g}_sr{args.sample_rate}_"
        f"win{args.window_sec:g}_ov{args.overlap_sec:g}_seed{args.seed}.npz"
    )
    return args.cache_dir / key


def load_or_build_dataset(args: argparse.Namespace) -> tuple[dict[str, np.ndarray], dict[str, list[dict[str, Any]]]]:
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_path(args)
    if path.is_file() and not args.rebuild_cache:
        obj = np.load(path, allow_pickle=True)
        arrays = {name: obj[name] for name in obj.files if not name.endswith("_rows")}
        rows = {split: [dict(item) for item in obj[f"{split}_rows"].tolist()] for split in ["train", "val", "test"]}
        return arrays, rows

    split_xs: dict[str, list[np.ndarray]] = {"train": [], "val": [], "test": []}
    split_ys: dict[str, list[int]] = {"train": [], "val": [], "test": []}
    split_trial_ids: dict[str, list[int]] = {"train": [], "val": [], "test": []}
    split_rows: dict[str, list[dict[str, Any]]] = {"train": [], "val": [], "test": []}

    if args.split_mode == "cross-subject":
        split_subjects = {
            "train": parse_subjects(args.train_subjects),
            "val": parse_subjects(args.val_subjects),
            "test": parse_subjects(args.test_subjects),
        }
        for split, subjects in split_subjects.items():
            for subject in subjects:
                obj = load_subject(args.source, subject)
                data = np.asarray(obj["data"], dtype=np.float64)
                labels = np.asarray(obj["labels"], dtype=np.float64)
                for trial_idx in range(40):
                    add_trial(split_xs[split], split_ys[split], split_trial_ids[split], split_rows[split], subject, trial_idx, data[trial_idx], labels[trial_idx], args)
    else:
        for subject in parse_subjects(args.subjects):
            obj = load_subject(args.source, subject)
            data = np.asarray(obj["data"], dtype=np.float64)
            labels = np.asarray(obj["labels"], dtype=np.float64)
            train_trials, val_trials, test_trials = fixed_trials(subject, args.seed, args.train_size, args.val_size)
            for split, trials in [("train", train_trials), ("val", val_trials), ("test", test_trials)]:
                for trial_idx in trials:
                    add_trial(split_xs[split], split_ys[split], split_trial_ids[split], split_rows[split], subject, int(trial_idx), data[trial_idx], labels[trial_idx], args)

    arrays: dict[str, np.ndarray] = {}
    for split in ["train", "val", "test"]:
        arrays[f"{split}_x"] = np.concatenate(split_xs[split]).astype(np.float32)
        arrays[f"{split}_y"] = np.asarray(split_ys[split], dtype=np.int64)
        arrays[f"{split}_trial_ids"] = np.asarray(split_trial_ids[split], dtype=np.int64)
    np.savez_compressed(path, **arrays, train_rows=np.asarray(split_rows["train"], dtype=object), val_rows=np.asarray(split_rows["val"], dtype=object), test_rows=np.asarray(split_rows["test"], dtype=object))
    return arrays, split_rows


def fit_standardizer(x_train: np.ndarray) -> StandardScaler:
    scaler = StandardScaler()
    scaler.fit(x_train.reshape(-1, x_train.shape[-1]))
    return scaler


def apply_standardizer(x: np.ndarray, scaler: StandardScaler) -> np.ndarray:
    flat = x.reshape(-1, x.shape[-1])
    return scaler.transform(flat).reshape(x.shape).astype(np.float32)


def loader(x: np.ndarray, y: np.ndarray, batch_size: int, shuffle: bool, device: torch.device) -> DataLoader:
    return DataLoader(
        TensorDataset(torch.from_numpy(x), torch.from_numpy(y)),
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=2,
        pin_memory=device.type == "cuda",
    )


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


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "classification_report": classification_report(y_true, y_pred, target_names=CLASS_NAMES, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist(),
    }


@torch.no_grad()
def predict_clip(model: EmotionCLIP, data_loader: DataLoader, device: torch.device) -> np.ndarray:
    model.eval()
    probs: list[np.ndarray] = []
    for xb, _yb in data_loader:
        logits = model(xb.to(device, non_blocking=True))
        probs.append(torch.softmax(logits, dim=1).cpu().numpy())
    return np.vstack(probs)


def train_clip(args: argparse.Namespace, model: EmotionCLIP, train_loader: DataLoader, val_loader: DataLoader, y_val: np.ndarray, val_trials: np.ndarray, val_rows: list[dict[str, Any]], device: torch.device) -> dict[str, Any]:
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    criterion = nn.CrossEntropyLoss()
    best_state = None
    best_bal = -1.0
    history: list[dict[str, float]] = []
    for epoch in range(1, args.pretrain_epochs + 1):
        model.train()
        losses: list[float] = []
        for xb, yb in train_loader:
            xb = xb.to(device, non_blocking=True)
            yb = yb.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        val_probs = predict_clip(model, val_loader, device)
        val_true, val_pred, _ = aggregate_trials(y_val, val_trials, val_probs, val_rows)
        bal = float(balanced_accuracy_score(val_true, val_pred))
        acc = float(accuracy_score(val_true, val_pred))
        history.append({"epoch": epoch, "loss": float(np.mean(losses)), "val_accuracy": acc, "val_balanced_accuracy": bal})
        if bal > best_bal:
            best_bal = bal
            best_state = {key: value.detach().cpu() for key, value in model.state_dict().items()}
        if epoch == 1 or epoch % 10 == 0 or epoch == args.pretrain_epochs:
            print(f"pretrain epoch={epoch} loss={np.mean(losses):.4f} val_acc={acc:.4f} val_bal={bal:.4f}", flush=True)
    if best_state is not None:
        model.load_state_dict(best_state)
    return {"best_val_balanced_accuracy": best_bal, "history": history}


@torch.no_grad()
def embed_windows(model: EmotionCLIP, data_loader: DataLoader, device: torch.device) -> np.ndarray:
    model.eval()
    embs: list[np.ndarray] = []
    for xb, _yb in data_loader:
        embs.append(model.eeg_embedding(xb.to(device, non_blocking=True)).cpu().numpy())
    return np.vstack(embs).astype(np.float32)


def train_linear_classifier(
    train_emb: np.ndarray,
    y_train: np.ndarray,
    val_emb: np.ndarray,
    y_val: np.ndarray,
    val_trials: np.ndarray,
    val_rows: list[dict[str, Any]],
    test_emb: np.ndarray,
    y_test: np.ndarray,
    test_trials: np.ndarray,
    test_rows: list[dict[str, Any]],
    args: argparse.Namespace,
    device: torch.device,
) -> tuple[dict[str, Any], np.ndarray]:
    clf = nn.Linear(train_emb.shape[1], len(CLASS_NAMES)).to(device)
    optimizer = torch.optim.AdamW(clf.parameters(), lr=args.probe_lr, weight_decay=args.weight_decay)
    criterion = nn.CrossEntropyLoss()
    train_loader = loader(train_emb, y_train, args.batch_size, True, device)
    val_loader = loader(val_emb, y_val, args.batch_size, False, device)
    best_state = None
    best_bal = -1.0
    history: list[dict[str, float]] = []
    for epoch in range(1, args.probe_epochs + 1):
        clf.train()
        losses: list[float] = []
        for xb, yb in train_loader:
            xb = xb.to(device, non_blocking=True)
            yb = yb.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(clf(xb), yb)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        probs = predict_classifier(clf, val_loader, device)
        val_true, val_pred, _ = aggregate_trials(y_val, val_trials, probs, val_rows)
        bal = float(balanced_accuracy_score(val_true, val_pred))
        history.append({"epoch": epoch, "loss": float(np.mean(losses)), "val_balanced_accuracy": bal})
        if bal > best_bal:
            best_bal = bal
            best_state = {key: value.detach().cpu() for key, value in clf.state_dict().items()}
    if best_state is not None:
        clf.load_state_dict(best_state)
    test_loader = loader(test_emb, y_test, args.batch_size, False, device)
    test_probs = predict_classifier(clf, test_loader, device)
    y_true, y_pred, _ = aggregate_trials(y_test, test_trials, test_probs, test_rows)
    return {"best_val_balanced_accuracy": best_bal, "test": metrics(y_true, y_pred), "history": history}, test_probs


@torch.no_grad()
def predict_classifier(clf: nn.Module, data_loader: DataLoader, device: torch.device) -> np.ndarray:
    clf.eval()
    probs: list[np.ndarray] = []
    for xb, _yb in data_loader:
        probs.append(torch.softmax(clf(xb.to(device, non_blocking=True)), dim=1).cpu().numpy())
    return np.vstack(probs)


def train_finetune_classifier(
    model: EmotionCLIP,
    train_loader: DataLoader,
    val_loader: DataLoader,
    test_loader: DataLoader,
    y_val: np.ndarray,
    val_trials: np.ndarray,
    val_rows: list[dict[str, Any]],
    y_test: np.ndarray,
    test_trials: np.ndarray,
    test_rows: list[dict[str, Any]],
    args: argparse.Namespace,
    device: torch.device,
) -> tuple[dict[str, Any], np.ndarray]:
    clf = nn.Linear(args.embed_dim, len(CLASS_NAMES)).to(device)
    optimizer = torch.optim.AdamW(list(model.eeg_encoder.parameters()) + list(model.eeg_proj.parameters()) + list(clf.parameters()), lr=args.finetune_lr, weight_decay=args.weight_decay)
    criterion = nn.CrossEntropyLoss()
    best_model = None
    best_clf = None
    best_bal = -1.0
    history: list[dict[str, float]] = []
    for epoch in range(1, args.finetune_epochs + 1):
        model.train()
        clf.train()
        losses: list[float] = []
        for xb, yb in train_loader:
            xb = xb.to(device, non_blocking=True)
            yb = yb.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(clf(model.eeg_embedding(xb)), yb)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        probs = predict_finetune(model, clf, val_loader, device)
        val_true, val_pred, _ = aggregate_trials(y_val, val_trials, probs, val_rows)
        bal = float(balanced_accuracy_score(val_true, val_pred))
        history.append({"epoch": epoch, "loss": float(np.mean(losses)), "val_balanced_accuracy": bal})
        if bal > best_bal:
            best_bal = bal
            best_model = {key: value.detach().cpu() for key, value in model.state_dict().items()}
            best_clf = {key: value.detach().cpu() for key, value in clf.state_dict().items()}
    if best_model is not None and best_clf is not None:
        model.load_state_dict(best_model)
        clf.load_state_dict(best_clf)
    test_probs = predict_finetune(model, clf, test_loader, device)
    y_true, y_pred, _ = aggregate_trials(y_test, test_trials, test_probs, test_rows)
    return {"best_val_balanced_accuracy": best_bal, "test": metrics(y_true, y_pred), "history": history}, test_probs


@torch.no_grad()
def predict_finetune(model: EmotionCLIP, clf: nn.Module, data_loader: DataLoader, device: torch.device) -> np.ndarray:
    model.eval()
    clf.eval()
    probs: list[np.ndarray] = []
    for xb, _yb in data_loader:
        probs.append(torch.softmax(clf(model.eeg_embedding(xb.to(device, non_blocking=True))), dim=1).cpu().numpy())
    return np.vstack(probs)


def write_predictions(path: Path, rows: list[dict[str, Any]], y_test: np.ndarray, test_trials: np.ndarray, probs: np.ndarray) -> None:
    y_true, y_pred, trial_probs = aggregate_trials(y_test, test_trials, probs, rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for row, true_id, pred_id, prob in zip(rows, y_true, y_pred, trial_probs):
            item = {
                **row,
                "true_class": CLASS_NAMES[int(true_id)],
                "pred_class": CLASS_NAMES[int(pred_id)],
                "probabilities": {CLASS_NAMES[i]: float(prob[i]) for i in range(len(CLASS_NAMES))},
            }
            file.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--split-mode", choices=["cross-subject", "fixed-calibration"], default="fixed-calibration")
    parser.add_argument("--subjects", default="all")
    parser.add_argument("--train-subjects", default="1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20")
    parser.add_argument("--val-subjects", default="21,22,23,24")
    parser.add_argument("--test-subjects", default="25,26,27,28,29,30,31,32")
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--sample-rate", type=int, default=128)
    parser.add_argument("--window-sec", type=float, default=1.0)
    parser.add_argument("--overlap-sec", type=float, default=0.0)
    parser.add_argument("--train-size", type=float, default=0.6)
    parser.add_argument("--val-size", type=float, default=0.2)
    parser.add_argument("--pretrain-epochs", type=int, default=80)
    parser.add_argument("--probe-epochs", type=int, default=60)
    parser.add_argument("--finetune-epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--probe-lr", type=float, default=0.01)
    parser.add_argument("--finetune-lr", type=float, default=0.0005)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--embed-dim", type=int, default=128)
    parser.add_argument("--text-dim", type=int, default=512)
    parser.add_argument("--dropout", type=float, default=0.35)
    parser.add_argument("--seed", type=int, default=2024)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--cache-dir", type=Path, default=Path("runs/deap_emotionclip_cache"))
    parser.add_argument("--out-dir", type=Path, default=Path("runs/deap_emotionclip"))
    parser.add_argument("--rebuild-cache", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu")
    arrays, rows = load_or_build_dataset(args)
    scaler = fit_standardizer(arrays["train_x"])
    for split in ["train", "val", "test"]:
        arrays[f"{split}_x"] = apply_standardizer(arrays[f"{split}_x"], scaler)

    train_loader = loader(arrays["train_x"], arrays["train_y"], args.batch_size, True, device)
    val_loader = loader(arrays["val_x"], arrays["val_y"], args.batch_size, False, device)
    test_loader = loader(arrays["test_x"], arrays["test_y"], args.batch_size, False, device)
    text_features = torch.tensor(prompt_hash_features(args.text_dim), dtype=torch.float32, device=device)
    model = EmotionCLIP(text_features=text_features, embed_dim=args.embed_dim, dropout=args.dropout).to(device)

    pretrain = train_clip(args, model, train_loader, val_loader, arrays["val_y"], arrays["val_trial_ids"], rows["val"], device)
    zero_probs = predict_clip(model, test_loader, device)
    zero_true, zero_pred, _ = aggregate_trials(arrays["test_y"], arrays["test_trial_ids"], zero_probs, rows["test"])
    zero_shot = {"test": metrics(zero_true, zero_pred)}

    train_emb = embed_windows(model, train_loader, device)
    val_emb = embed_windows(model, val_loader, device)
    test_emb = embed_windows(model, test_loader, device)
    probe, probe_probs = train_linear_classifier(train_emb, arrays["train_y"], val_emb, arrays["val_y"], arrays["val_trial_ids"], rows["val"], test_emb, arrays["test_y"], arrays["test_trial_ids"], rows["test"], args, device)
    finetune, finetune_probs = train_finetune_classifier(model, train_loader, val_loader, test_loader, arrays["val_y"], arrays["val_trial_ids"], rows["val"], arrays["test_y"], arrays["test_trial_ids"], rows["test"], args, device)

    candidates = {
        "zero_shot": zero_shot["test"]["balanced_accuracy"],
        "frozen_probe": probe["test"]["balanced_accuracy"],
        "fine_tune": finetune["test"]["balanced_accuracy"],
    }
    best_name = max(candidates, key=candidates.get)
    best_probs = {"zero_shot": zero_probs, "frozen_probe": probe_probs, "fine_tune": finetune_probs}[best_name]
    report = {
        "split_mode": args.split_mode,
        "class_names": CLASS_NAMES,
        "prompts": PROMPTS,
        "pretrain": pretrain,
        "zero_shot": zero_shot,
        "frozen_probe": probe,
        "fine_tune": finetune,
        "best_classifier": best_name,
        "best_balanced_accuracy": candidates[best_name],
        "n_train_windows": int(len(arrays["train_y"])),
        "n_val_windows": int(len(arrays["val_y"])),
        "n_test_windows": int(len(arrays["test_y"])),
        "n_test_trials": int(len(rows["test"])),
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.out_dir / "deap_emotionclip_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    for name, probs in [("zero_shot", zero_probs), ("frozen_probe", probe_probs), ("fine_tune", finetune_probs), ("best", best_probs)]:
        write_predictions(args.out_dir / f"deap_emotionclip_{name}_predictions.jsonl", rows["test"], arrays["test_y"], arrays["test_trial_ids"], probs)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "class_names": CLASS_NAMES,
            "prompts": PROMPTS,
            "scaler_mean": scaler.mean_,
            "scaler_scale": scaler.scale_,
            "args": vars(args),
        },
        args.out_dir / "deap_emotionclip.pt",
    )
    print(json.dumps({k: report[k] for k in ["zero_shot", "frozen_probe", "fine_tune", "best_classifier", "best_balanced_accuracy"]}, ensure_ascii=False, indent=2, sort_keys=True))
    print(f"saved_report={report_path}")


if __name__ == "__main__":
    main()
