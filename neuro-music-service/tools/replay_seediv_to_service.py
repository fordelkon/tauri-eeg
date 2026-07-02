#!/usr/bin/env python3
"""Replay processed SEED-IV windows through neuro-music-service.

This is an integration smoke test for the system contract, not a model training
script. It uses SEED-IV labels as an oracle to verify:

SEED-IV label -> EEG emotion endpoint -> latest emotion -> music control params
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any


SEEDIV_LABELS = {
    0: {"seediv": "neutral", "paradigm": "calm", "trigger_class": 3},
    1: {"seediv": "sad", "paradigm": "depression", "trigger_class": 1},
    2: {"seediv": "fear", "paradigm": "anxiety", "trigger_class": 2},
    3: {"seediv": "happy", "paradigm": "happy", "trigger_class": 4},
}


def label_from_path(path: Path) -> int:
    return int(path.stem.split("_")[-1])


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


def select_balanced_files(data_root: Path, subject: int, session: int, per_class: int) -> list[Path]:
    session_root = data_root / f"subject_{subject}" / f"session_{session}"
    if not session_root.is_dir():
        raise FileNotFoundError(f"SEED-IV session folder not found: {session_root}")

    by_label: dict[int, list[Path]] = {label: [] for label in SEEDIV_LABELS}
    for path in sorted(session_root.glob("*.npy")):
        label = label_from_path(path)
        if label in by_label:
            by_label[label].append(path)

    missing = [SEEDIV_LABELS[label]["seediv"] for label, files in by_label.items() if len(files) < per_class]
    if missing:
        raise RuntimeError(f"not enough SEED-IV files for labels: {', '.join(missing)}")

    selected: list[Path] = []
    for label in sorted(by_label):
        selected.extend(by_label[label][:per_class])
    return selected


def write_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True, help="Processed EmotionCLIP SEED-IV data root.")
    parser.add_argument("--subject", type=int, default=1)
    parser.add_argument("--session", type=int, default=1)
    parser.add_argument("--per-class", type=int, default=2)
    parser.add_argument("--service-url", default="http://127.0.0.1:8010")
    parser.add_argument("--log", type=Path, default=Path("runs/seediv_service_replay.jsonl"))
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--sleep-sec", type=float, default=0.05)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    files = select_balanced_files(args.data, args.subject, args.session, args.per_class)
    health = get_json(args.service_url, "/health", args.timeout)
    session = post_json(
        args.service_url,
        "/session/start",
        {
            "user_id": f"seediv-subject-{args.subject}",
            "username": "seediv-replay",
            "mode": "mock",
            "prompt": "instrumental adaptive emotional regulation music",
        },
        args.timeout,
    )

    run_id = str(uuid.uuid4())
    print(f"Service health: {health['status']} model={health['model_version']}")
    print(f"Started mock neuro music session: {session['session_id']}")
    print(f"Writing replay log: {args.log}")

    for step, sample in enumerate(files):
        label = label_from_path(sample)
        mapping = SEEDIV_LABELS[label]
        predict_payload = {
            "channel_ids": ["seediv_feature"],
            "sample_rate_hz": 200,
            "samples": [[0.0]],
            "trigger_class": mapping["trigger_class"],
            "source": "seediv-offline-oracle",
        }
        prediction = post_json(args.service_url, "/eeg/emotion/predict", predict_payload, args.timeout)
        control = post_json(
            args.service_url,
            "/control/emotion",
            {
                "emotion": prediction["emotion"],
                "probabilities": prediction["probabilities"],
                "valence": prediction["valence"],
                "arousal": prediction["arousal"],
                "playback_pos": float(step),
            },
            args.timeout,
        )
        latest = get_json(args.service_url, "/eeg/emotion/latest", args.timeout)
        row = {
            "run_id": run_id,
            "step": step,
            "sample": str(sample),
            "seediv_label": label,
            "seediv_emotion": mapping["seediv"],
            "paradigm_emotion": mapping["paradigm"],
            "system_emotion": prediction["emotion"],
            "confidence": prediction["confidence"],
            "probabilities": prediction["probabilities"],
            "valence": prediction["valence"],
            "arousal": prediction["arousal"],
            "control": control["last_control"],
            "latest_updated_at": latest["updated_at"],
            "time": time.time(),
        }
        write_jsonl(args.log, row)
        print(
            f"{step:03d} {mapping['seediv']:7s} -> {prediction['emotion']:7s} "
            f"valence={prediction['valence']:+.3f} arousal={prediction['arousal']:+.3f} "
            f"shift={control['last_control']['shift']}"
        )
        if args.sleep_sec > 0:
            time.sleep(args.sleep_sec)

    post_json(args.service_url, "/session/stop", {}, args.timeout)


if __name__ == "__main__":
    main()
