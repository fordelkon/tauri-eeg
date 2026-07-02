#!/usr/bin/env python3
"""Replay DEAP baseline model predictions through neuro-music-service."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from deap_baseline_common import CLASS_NAMES, SYSTEM_EMOTION, extract_trial_features, load_subject


TRIGGER_CLASS = {
    "depression": 1,
    "anxiety": 2,
    "calm": 3,
    "happy": 4,
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


def signed_from_probabilities(probs: dict[str, float]) -> tuple[float, float]:
    valence = probs.get("happy", 0.0) + 0.2 * probs.get("calm", 0.0) - probs.get("depression", 0.0) - 0.4 * probs.get("anxiety", 0.0)
    arousal = probs.get("anxiety", 0.0) + 0.6 * probs.get("happy", 0.0) - 0.7 * probs.get("calm", 0.0) - 0.2 * probs.get("depression", 0.0)
    return float(np.clip(valence, -1.0, 1.0)), float(np.clip(arousal, -1.0, 1.0))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="DGCNN-DEAP.zip path or extracted DGCNN-DEAP directory.")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--subject", type=int, default=25)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--service-url", default="http://127.0.0.1:8010")
    parser.add_argument("--log", type=Path, default=Path("runs/deap_model_service_replay.jsonl"))
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--sleep-sec", type=float, default=0.05)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    bundle = joblib.load(args.model)
    model = bundle["model"]
    class_names = list(bundle.get("class_names", CLASS_NAMES))
    obj = load_subject(args.source, args.subject)
    data = np.asarray(obj["data"], dtype=np.float64)

    health = get_json(args.service_url, "/health", args.timeout)
    session = post_json(
        args.service_url,
        "/session/start",
        {
            "user_id": f"deap-model-subject-{args.subject}",
            "username": "deap-model-replay",
            "mode": "mock",
            "prompt": "instrumental adaptive emotional regulation music",
        },
        args.timeout,
    )
    run_id = str(uuid.uuid4())
    print(f"Service health: {health['status']} model={health['model_version']}")
    print(f"Started mock neuro music session: {session['session_id']}")
    print(f"Writing replay log: {args.log}")

    n = min(args.limit, data.shape[0])
    for step in range(n):
        feature = extract_trial_features(data[step]).reshape(1, -1)
        prob_arr = model.predict_proba(feature)[0]
        pred_id = int(np.argmax(prob_arr))
        pred_class = class_names[pred_id]
        probs = {class_names[i]: float(prob_arr[i]) for i in range(len(class_names))}
        system_probs = {
            "sad": probs.get("depression", 0.0),
            "fear": probs.get("anxiety", 0.0),
            "neutral": probs.get("calm", 0.0),
            "happy": probs.get("happy", 0.0),
        }
        valence, arousal = signed_from_probabilities(probs)
        prediction = post_json(
            args.service_url,
            "/eeg/emotion/predict",
            {
                "channel_ids": ["deap_model_40ch"],
                "sample_rate_hz": 128,
                "samples": [[0.0]],
                "trigger_class": TRIGGER_CLASS[pred_class],
                "source": "deap-baseline-model",
            },
            args.timeout,
        )
        control = post_json(
            args.service_url,
            "/control/emotion",
            {
                "emotion": SYSTEM_EMOTION[pred_class],
                "probabilities": system_probs,
                "valence": valence,
                "arousal": arousal,
                "playback_pos": float(step),
            },
            args.timeout,
        )
        row = {
            "run_id": run_id,
            "step": step,
            "subject": args.subject,
            "trial": step + 1,
            "pred_class": pred_class,
            "system_emotion": SYSTEM_EMOTION[pred_class],
            "model_probabilities": probs,
            "service_emotion": prediction["emotion"],
            "control": control["last_control"],
            "time": time.time(),
        }
        args.log.parent.mkdir(parents=True, exist_ok=True)
        with args.log.open("a", encoding="utf-8") as file:
            file.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        print(f"{step:03d} trial={step + 1:02d} pred={pred_class:10s}/{SYSTEM_EMOTION[pred_class]:7s} shift={control['last_control']['shift']}")
        if args.sleep_sec > 0:
            time.sleep(args.sleep_sec)

    post_json(args.service_url, "/session/stop", {}, args.timeout)


if __name__ == "__main__":
    main()
