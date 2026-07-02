#!/usr/bin/env python3
"""Replay DEAP valence/arousal labels through neuro-music-service.

The DEAP dataset does not provide the project's four intervention labels
directly. This tool maps DEAP's 1-9 valence/arousal ratings into the current
four-class regulation paradigm and uses the mapped label as an oracle smoke
test for the service contract.
"""

from __future__ import annotations

import argparse
import json
import pickle
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any

import numpy as np


DEAP_ZIP_PREFIX = "DGCNN-DEAP/dataset/DEAP/data_preprocessed_python"

PARADIGM = {
    "depression": {"system_emotion": "sad", "trigger_class": 1},
    "anxiety": {"system_emotion": "fear", "trigger_class": 2},
    "calm": {"system_emotion": "neutral", "trigger_class": 3},
    "happy": {"system_emotion": "happy", "trigger_class": 4},
}


def post_json(base_url: str, path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {path} failed: HTTP {exc.code}: {detail}") from exc


def get_json(base_url: str, path: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(base_url.rstrip("/") + path, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def load_deap_labels(zip_path: Path, subject: int) -> np.ndarray:
    member = f"{DEAP_ZIP_PREFIX}/s{subject:02d}.dat"
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open(member) as file:
            obj = pickle.load(file, encoding="latin1")
    labels = np.asarray(obj["labels"], dtype=np.float64)
    if labels.shape != (40, 4):
        raise RuntimeError(f"unexpected DEAP label shape for {member}: {labels.shape}")
    return labels


def classify_deap_trial(valence: float, arousal: float, threshold: float) -> str:
    if valence < threshold and arousal < threshold:
        return "depression"
    if valence < threshold and arousal >= threshold:
        return "anxiety"
    if valence >= threshold and arousal < threshold:
        return "calm"
    return "happy"


def scale_rating_to_signed(value: float) -> float:
    # DEAP ratings are 1-9. Convert to the service's -1..1 control scale.
    return float(np.clip((value - 5.0) / 4.0, -1.0, 1.0))


def select_trials(labels: np.ndarray, per_class: int, threshold: float) -> list[int]:
    by_class: dict[str, list[int]] = {name: [] for name in PARADIGM}
    for idx, row in enumerate(labels):
        valence, arousal = float(row[0]), float(row[1])
        by_class[classify_deap_trial(valence, arousal, threshold)].append(idx)

    missing = [name for name, indices in by_class.items() if len(indices) < per_class]
    if missing:
        counts = {name: len(indices) for name, indices in by_class.items()}
        raise RuntimeError(f"not enough DEAP trials for {missing}; counts={counts}")

    selected: list[int] = []
    for name in ["depression", "anxiety", "calm", "happy"]:
        selected.extend(by_class[name][:per_class])
    return selected


def write_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=Path, required=True, help="DGCNN-DEAP.zip path.")
    parser.add_argument("--subject", type=int, default=1)
    parser.add_argument("--per-class", type=int, default=2)
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--service-url", default="http://127.0.0.1:8010")
    parser.add_argument("--log", type=Path, default=Path("runs/deap_service_replay.jsonl"))
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--sleep-sec", type=float, default=0.05)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    labels = load_deap_labels(args.zip, args.subject)
    trial_indices = select_trials(labels, args.per_class, args.threshold)
    health = get_json(args.service_url, "/health", args.timeout)
    session = post_json(
        args.service_url,
        "/session/start",
        {
            "user_id": f"deap-subject-{args.subject}",
            "username": "deap-replay",
            "mode": "mock",
            "prompt": "instrumental adaptive emotional regulation music",
        },
        args.timeout,
    )

    run_id = str(uuid.uuid4())
    print(f"Service health: {health['status']} model={health['model_version']}")
    print(f"Started mock neuro music session: {session['session_id']}")
    print(f"Writing replay log: {args.log}")

    for step, trial_idx in enumerate(trial_indices):
        valence, arousal, dominance, liking = [float(x) for x in labels[trial_idx]]
        paradigm_emotion = classify_deap_trial(valence, arousal, args.threshold)
        mapping = PARADIGM[paradigm_emotion]
        prediction = post_json(
            args.service_url,
            "/eeg/emotion/predict",
            {
                "channel_ids": ["deap_preprocessed_40ch"],
                "sample_rate_hz": 128,
                "samples": [[0.0]],
                "trigger_class": mapping["trigger_class"],
                "source": "deap-valence-arousal-oracle",
            },
            args.timeout,
        )
        control = post_json(
            args.service_url,
            "/control/emotion",
            {
                "emotion": prediction["emotion"],
                "probabilities": prediction["probabilities"],
                "valence": scale_rating_to_signed(valence),
                "arousal": scale_rating_to_signed(arousal),
                "playback_pos": float(step),
            },
            args.timeout,
        )
        latest = get_json(args.service_url, "/eeg/emotion/latest", args.timeout)
        row = {
            "run_id": run_id,
            "step": step,
            "subject": args.subject,
            "trial": trial_idx + 1,
            "deap_valence": valence,
            "deap_arousal": arousal,
            "deap_dominance": dominance,
            "deap_liking": liking,
            "paradigm_emotion": paradigm_emotion,
            "system_emotion": prediction["emotion"],
            "confidence": prediction["confidence"],
            "probabilities": prediction["probabilities"],
            "control_valence": scale_rating_to_signed(valence),
            "control_arousal": scale_rating_to_signed(arousal),
            "control": control["last_control"],
            "latest_updated_at": latest["updated_at"],
            "time": time.time(),
        }
        write_jsonl(args.log, row)
        print(
            f"{step:03d} trial={trial_idx + 1:02d} v={valence:.2f} a={arousal:.2f} "
            f"-> {paradigm_emotion:10s}/{prediction['emotion']:7s} "
            f"shift={control['last_control']['shift']}"
        )
        if args.sleep_sec > 0:
            time.sleep(args.sleep_sec)

    post_json(args.service_url, "/session/stop", {}, args.timeout)


if __name__ == "__main__":
    main()
