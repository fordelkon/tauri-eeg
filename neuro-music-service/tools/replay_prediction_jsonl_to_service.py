#!/usr/bin/env python3
"""Replay saved DEAP prediction JSONL rows through neuro-music-service."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import numpy as np
from deap_baseline_common import SYSTEM_EMOTION


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


def read_rows(path: Path, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            rows.append(json.loads(line))
            if len(rows) >= limit:
                break
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--service-url", default="http://127.0.0.1:8010")
    parser.add_argument("--log", type=Path, default=Path("runs/prediction_service_replay.jsonl"))
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--sleep-sec", type=float, default=0.05)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = read_rows(args.predictions, args.limit)
    health = get_json(args.service_url, "/health", args.timeout)
    session = post_json(
        args.service_url,
        "/session/start",
        {
            "user_id": "prediction-jsonl-replay",
            "username": "prediction-jsonl-replay",
            "mode": "mock",
            "prompt": "instrumental adaptive emotional regulation music",
        },
        args.timeout,
    )
    run_id = str(uuid.uuid4())
    print(f"Service health: {health['status']} model={health['model_version']}")
    print(f"Started mock neuro music session: {session['session_id']}")
    print(f"Writing replay log: {args.log}")

    for step, row in enumerate(rows):
        pred_class = str(row["pred_class"])
        probs = {str(k): float(v) for k, v in row["probabilities"].items()}
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
                "channel_ids": ["prediction_jsonl"],
                "sample_rate_hz": 128,
                "samples": [[0.0]],
                "trigger_class": TRIGGER_CLASS[pred_class],
                "source": "prediction-jsonl-replay",
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
        out = {
            "run_id": run_id,
            "step": step,
            "true_class": row.get("true_class"),
            "pred_class": pred_class,
            "system_emotion": SYSTEM_EMOTION[pred_class],
            "service_emotion": prediction["emotion"],
            "control": control["last_control"],
            "time": time.time(),
        }
        args.log.parent.mkdir(parents=True, exist_ok=True)
        with args.log.open("a", encoding="utf-8") as file:
            file.write(json.dumps(out, ensure_ascii=False, sort_keys=True) + "\n")
        print(f"{step:03d} true={row.get('true_class')} pred={pred_class:10s}/{SYSTEM_EMOTION[pred_class]:7s} shift={control['last_control']['shift']}")
        if args.sleep_sec > 0:
            time.sleep(args.sleep_sec)

    post_json(args.service_url, "/session/stop", {}, args.timeout)


if __name__ == "__main__":
    main()
