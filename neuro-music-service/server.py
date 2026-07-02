from __future__ import annotations

import json
import os
import struct
import time
import urllib.request
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_VERSION = "eeg-emotion-demon-control-v0"

app = FastAPI(title="Tauri EEG Realtime Neuro Music Service")


class StartSessionRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    username: str = Field(..., min_length=1, max_length=128)
    mode: str = Field(default="mock", pattern="^(mock|demon)$")
    prompt: str = Field(default="instrumental emotional music, evolving, no vocals", max_length=500)


class SessionStatus(BaseModel):
    active: bool
    session_id: str | None = None
    mode: str = "mock"
    prompt: str = ""
    started_at: float | None = None
    last_emotion: str | None = None
    last_control: dict[str, Any] | None = None
    demon_session_id: str | None = None
    error: str | None = None


class EegEmotionRequest(BaseModel):
    channel_ids: list[str] = Field(default_factory=list)
    sample_rate_hz: int = Field(default=1000, ge=1)
    started_at_ms: int | None = None
    samples: list[list[float]] = Field(default_factory=list)
    trigger_class: int | None = None
    source: str = Field(default="live-32ch-cap", max_length=64)


class EegEmotionResponse(BaseModel):
    emotion: str
    probabilities: dict[str, float]
    valence: float
    arousal: float
    confidence: float
    source: str
    updated_at: float
    model_version: str
    note: str | None = None


class EmotionControlRequest(BaseModel):
    emotion: str = Field(..., min_length=1, max_length=64)
    probabilities: dict[str, float] = Field(default_factory=dict)
    valence: float = Field(default=0.0, ge=-1.0, le=1.0)
    arousal: float = Field(default=0.0, ge=-1.0, le=1.0)
    playback_pos: float = Field(default=0.0, ge=0.0)


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_version: str
    demon_control_available: bool
    active_session: bool
    error: str | None = None


# Process-local state is enough for the minimum desktop service. The Tauri
# process owns this child service, so a restart naturally clears the realtime
# session and latest emotion label.
state: SessionStatus = SessionStatus(active=False)
latest_emotion: EegEmotionResponse | None = None


def demon_control_url() -> str | None:
    value = os.environ.get("NEURO_MUSIC_DEMON_CONTROL_URL", "").strip()
    return value or None


def list_demon_sessions(base_url: str) -> list[dict[str, Any]]:
    with urllib.request.urlopen(f"{base_url.rstrip('/')}/sessions", timeout=1.5) as response:
        return json.loads(response.read().decode("utf-8"))


def first_demon_session_id(base_url: str) -> str | None:
    try:
        sessions = list_demon_sessions(base_url)
    except Exception:
        return None
    if not sessions:
        return None
    return str(sessions[0].get("id") or "")


def send_demon_params(base_url: str, session_id: str, raw: dict[str, Any], playback_pos: float) -> None:
    command = {"type": "params", "raw": raw, "playback_pos": playback_pos}
    payload = json.dumps(command, ensure_ascii=False).encode("utf-8")
    body = struct.pack("<I", len(payload)) + payload
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/sessions/{session_id}/cmd",
        data=body,
        method="POST",
        headers={"Content-Type": "application/octet-stream"},
    )
    with urllib.request.urlopen(request, timeout=1.5) as response:
        if response.status >= 400:
            raise RuntimeError(f"DEMON control returned HTTP {response.status}")


def emotion_to_demon_controls(request: EmotionControlRequest) -> dict[str, Any]:
    valence01 = max(0.0, min(1.0, (request.valence + 1.0) / 2.0))
    arousal01 = max(0.0, min(1.0, (request.arousal + 1.0) / 2.0))
    sad = max(0.0, min(1.0, request.probabilities.get("sad", 0.0)))
    fear = max(0.0, min(1.0, request.probabilities.get("fear", 0.0)))
    happy = max(0.0, min(1.0, request.probabilities.get("happy", 0.0)))

    return {
        "denoise": round(0.18 + 0.22 * arousal01, 4),
        "feedback": round(0.05 + 0.25 * (1.0 - valence01), 4),
        "feedback_depth": 1,
        "shift": round(2.7 + 1.2 * arousal01, 4),
        "steps_override": 8,
        "guidance_scale": round(1.0 + 1.2 * max(happy, fear), 4),
        "cfg_rescale": 0.0,
        "rcfg_mode": "off",
        "dcw_enabled": True,
        "ch_g0": round(1.0 + 1.1 * arousal01, 4),
        "ch13": round(1.0 + 0.8 * happy, 4),
        "ch23": round(1.0 + 0.8 * fear, 4),
        "ch56": round(1.0 + 0.6 * sad, 4),
    }


def infer_mock_emotion(request: EegEmotionRequest) -> EegEmotionResponse:
    """Small deterministic placeholder until the EmotionCLIP runtime is embedded.

    The real model path must convert the system's live 32-channel cap stream into
    the trained SEED-IV feature format or use a newly trained 32-channel model.
    """
    # Trigger labels are used first because the current EEG acquisition stack
    # already carries trigger_class through the sample-block event. Real live
    # inference should replace this branch with an EmotionCLIP/adapter call.
    if request.trigger_class == 1:
        emotion = "sad"
    elif request.trigger_class == 2:
        emotion = "fear"
    elif request.trigger_class == 255:
        emotion = "happy"
    else:
        # Use block energy only as a stable mock signal for integration tests.
        flat = [abs(value) for channel in request.samples for value in channel]
        mean_abs = sum(flat) / len(flat) if flat else 0.0
        emotion = "neutral" if mean_abs < 20.0 else "fear"

    template = {
        "neutral": {"neutral": 0.72, "sad": 0.08, "fear": 0.10, "happy": 0.10},
        "sad": {"neutral": 0.08, "sad": 0.74, "fear": 0.10, "happy": 0.08},
        "fear": {"neutral": 0.08, "sad": 0.10, "fear": 0.74, "happy": 0.08},
        "happy": {"neutral": 0.08, "sad": 0.08, "fear": 0.10, "happy": 0.74},
    }[emotion]
    valence = template["happy"] - template["sad"]
    arousal = 0.55 * template["fear"] + 0.35 * template["happy"] - 0.25 * template["neutral"] - 0.15 * template["sad"]

    return EegEmotionResponse(
        emotion=emotion,
        probabilities=template,
        valence=round(valence, 6),
        arousal=round(arousal, 6),
        confidence=max(template.values()),
        source=request.source,
        updated_at=time.time(),
        model_version=MODEL_VERSION,
        note="mock EEG emotion inference; replace with calibrated EmotionCLIP adapter",
    )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    base_url = demon_control_url()
    demon_available = bool(base_url and first_demon_session_id(base_url))
    return HealthResponse(
        status="ready",
        model_loaded=True,
        model_version=MODEL_VERSION,
        demon_control_available=demon_available,
        active_session=state.active,
        error=state.error,
    )


@app.get("/eeg/emotion/latest", response_model=EegEmotionResponse)
async def get_latest_eeg_emotion() -> EegEmotionResponse:
    if latest_emotion is None:
        raise HTTPException(status_code=404, detail="No EEG emotion has been inferred yet.")
    return latest_emotion


@app.post("/eeg/emotion/predict", response_model=EegEmotionResponse)
async def predict_eeg_emotion(request: EegEmotionRequest) -> EegEmotionResponse:
    global latest_emotion
    latest_emotion = infer_mock_emotion(request)
    return latest_emotion


@app.post("/session/start", response_model=SessionStatus)
async def start_session(request: StartSessionRequest) -> SessionStatus:
    global state

    demon_session_id = None
    if request.mode == "demon":
        base_url = demon_control_url()
        if not base_url:
            raise HTTPException(status_code=400, detail="NEURO_MUSIC_DEMON_CONTROL_URL is not configured.")
        demon_session_id = first_demon_session_id(base_url)
        if not demon_session_id:
            raise HTTPException(status_code=503, detail="No active DEMON session is available.")

    state = SessionStatus(
        active=True,
        session_id=str(uuid.uuid4()),
        mode=request.mode,
        prompt=request.prompt,
        started_at=time.time(),
        demon_session_id=demon_session_id,
    )
    return state


@app.post("/session/stop", response_model=SessionStatus)
async def stop_session() -> SessionStatus:
    global state
    state.active = False
    return state


@app.get("/session/status", response_model=SessionStatus)
async def session_status() -> SessionStatus:
    return state


@app.post("/control/emotion", response_model=SessionStatus)
async def control_emotion(request: EmotionControlRequest) -> SessionStatus:
    if not state.active:
        raise HTTPException(status_code=409, detail="No active neuro music session.")

    raw = emotion_to_demon_controls(request)
    state.last_emotion = request.emotion
    state.last_control = raw
    state.error = None

    if state.mode == "demon":
        base_url = demon_control_url()
        if not base_url or not state.demon_session_id:
            raise HTTPException(status_code=503, detail="DEMON control is not available.")
        try:
            send_demon_params(base_url, state.demon_session_id, raw, request.playback_pos)
        except Exception as exc:
            state.error = str(exc)
            raise HTTPException(status_code=502, detail=state.error) from exc

    return state


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8010)
