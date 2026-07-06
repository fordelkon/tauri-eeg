from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from agent_planner import (
    AGENT_PLANNER_CAPABILITIES,
    AGENT_PLANNER_VERSION,
    AgentPlannerRequest,
    AgentPlannerResponse,
    plan_agent_action,
)

MODEL_VERSION = "stable-audio-3-small-music"
NEGATIVE_PROMPT = "vocals, singing, speech, lyrics"

app = FastAPI(title="Tauri EEG Music Generation Service")
model: Any | None = None
model_error: str | None = None
model_load_task: asyncio.Task[None] | None = None


def resolve_device() -> str:
    requested_device = os.environ.get("MUSIC_SERVICE_DEVICE", "").strip().lower()
    if requested_device in {"cpu", "cuda"}:
        return requested_device

    return "cuda" if torch.cuda.is_available() else "cpu"


device = resolve_device()


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=500)
    negative_prompt: str = Field(default=NEGATIVE_PROMPT, max_length=500)
    duration: int = Field(default=30, ge=5, le=120)
    job_id: str = Field(..., min_length=1, max_length=128)
    output_dir: str = Field(..., min_length=1)


class JobResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    output_path: str | None = None
    error: str | None = None


def safe_output_path(output_dir: str, job_id: str) -> Path:
    base = Path(output_dir).expanduser().resolve()
    base.mkdir(parents=True, exist_ok=True)

    safe_job = "".join(character for character in job_id if character.isalnum() or character in "-_")
    if not safe_job:
        raise ValueError("Invalid job id")

    output_path = (base / f"gen_{safe_job[:12]}.wav").resolve()
    if base not in output_path.parents:
        raise ValueError("Invalid output path")

    return output_path


def load_model() -> Any:
    try:
        from stable_audio_3 import StableAudioModel  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "Stable Audio 3 is not installed. Run `uv sync` in music-service after accepting "
            "the stabilityai/stable-audio-3-small-music Hugging Face model terms."
        ) from exc

    try:
        loaded_model = StableAudioModel.from_pretrained("small-music")
        if hasattr(loaded_model, "to"):
            return loaded_model.to(device)
        return loaded_model
    except Exception as exc:
        raise RuntimeError(
            "Failed to load stabilityai/stable-audio-3-small-music. Confirm Hugging Face access "
            "and local model cache/authentication."
        ) from exc


def save_wav(output_path: Path, audio: Any, sample_rate: int) -> None:
    try:
        import torchaudio

        if not hasattr(audio, "detach"):
            audio = torch.as_tensor(np.asarray(audio), dtype=torch.float32)
        audio = audio.detach().cpu()

        if len(audio.shape) == 3 and audio.shape[0] == 1:
            audio = audio.squeeze(0)
        if len(audio.shape) == 1:
            audio = audio.unsqueeze(0)
        if audio.shape[0] > audio.shape[-1]:
            audio = audio.transpose(0, 1)

        torchaudio.save(str(output_path), audio, sample_rate, format="wav")
    except Exception as exc:
        raise RuntimeError(f"Failed to save generated WAV: {exc}") from exc


async def generate_wav(request: GenerateRequest, output_path: Path) -> None:
    if model is None:
        raise RuntimeError(model_error or "Stable Audio 3 Small Music is not loaded.")

    def run_generation() -> None:
        with torch.inference_mode():
            result = model.generate(
                prompt=request.prompt,
                duration=request.duration,
            )

        sample_rate = int(getattr(model, "sample_rate", 44100))
        save_wav(output_path, result, sample_rate)

    await asyncio.to_thread(run_generation)


async def load_model_in_background() -> None:
    global model, model_error

    try:
        loaded_model = await asyncio.to_thread(load_model)
        model = loaded_model
        model_error = None
    except Exception as exc:
        model = None
        model_error = str(exc)
        print(model_error)


@app.on_event("startup")
async def startup_load_model() -> None:
    global model_load_task

    model_load_task = asyncio.create_task(load_model_in_background())


@app.get("/health")
async def health_check() -> dict[str, Any]:
    if model is None:
        raise HTTPException(status_code=503, detail=model_error or "Model is not loaded.")

    return {
        "status": "ready",
        "modelLoaded": True,
        "modelVersion": MODEL_VERSION,
        "gpuAvailable": torch.cuda.is_available(),
        "device": device,
        "error": model_error,
    }


@app.get("/agent/health")
async def agent_health_check() -> dict[str, Any]:
    return {
        "status": "ready",
        "plannerVersion": AGENT_PLANNER_VERSION,
        "capabilities": AGENT_PLANNER_CAPABILITIES,
    }


@app.post("/generate", response_model=JobResponse)
async def generate_music(request: GenerateRequest) -> JobResponse:
    if model is None:
        raise HTTPException(status_code=503, detail=model_error or "Model is not loaded.")

    try:
        output_path = safe_output_path(request.output_dir, request.job_id)
        await generate_wav(request, output_path)

        return JobResponse(
            job_id=request.job_id,
            status="completed",
            progress=100,
            output_path=str(output_path),
        )
    except Exception as exc:
        return JobResponse(
            job_id=request.job_id,
            status="failed",
            progress=0,
            error=str(exc),
        )


@app.post("/agent/plan", response_model=AgentPlannerResponse)
async def plan_agent(request: AgentPlannerRequest) -> AgentPlannerResponse:
    return plan_agent_action(request)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
