"""FastAPI surface of the EEG decoding service (port 8010).

Endpoint contracts are fixed by the frontend: field names in responses are
part of the API and must not be renamed. Every handler stays off heavy work
on the event loop (asyncio.to_thread) so the polling endpoints /eeg/health
and /eeg/decode keep answering well inside the frontend's 800 ms tolerance.
"""
from __future__ import annotations

import asyncio
import os
from typing import Any, Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from core.synth import synth_epoch
from runtime import DEFAULT_CHANNELS, DEFAULT_SFREQ, ServiceState

PROFILES = ("negative", "calm", "regulation_drift", "positive")
Profile = Literal["negative", "calm", "regulation_drift", "positive"]
SfreqProfile = Literal[250, 512, 1024, 2048]


class SimStartRequest(BaseModel):
    profile: Profile = "negative"
    channels: int = Field(default=64, ge=8, le=128)
    sfreq: SfreqProfile = 250


class ProfileRequest(BaseModel):
    profile: Profile


class CalibrateRequest(BaseModel):
    states: list[Profile] = Field(min_length=2, max_length=4)
    epochsPerState: int = Field(default=20, ge=2, le=200)
    epochSeconds: float = Field(default=4.0, ge=1.0, le=10.0)

    @field_validator("states")
    @classmethod
    def states_must_be_distinct(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("states must not contain duplicates")
        return value


class TargetRequest(BaseModel):
    targetClass: str = Field(min_length=1, max_length=64)


def create_app(state: ServiceState | None = None) -> FastAPI:
    service = state or ServiceState()
    if service.model_path is None:
        service.model_path = os.environ.get("EEG_SERVICE_MODEL_PATH") or None
    # Restore a previous calibration so /eeg/decode works right after a
    # restart; failures simply leave the service uncalibrated.
    service.load_saved_model()

    app = FastAPI(title="Tauri EEG Decoding Service")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _stream_config() -> tuple[int, float]:
        # Calibration must produce epochs in the shape the ingestion buffer
        # will deliver at decode time; fall back to service defaults when no
        # stream has ever been configured.
        buffer = service.buffer
        if buffer is not None:
            return buffer.channels, buffer.sfreq
        return DEFAULT_CHANNELS, float(DEFAULT_SFREQ)

    async def _calibrate_response(
        epochs: list[np.ndarray], labels: list[str]
    ) -> dict[str, Any]:
        summary = await asyncio.to_thread(service.train_decoder, epochs, labels)
        return {
            "trained": True,
            "cvAccuracy": summary["cvAccuracy"],
            "classes": summary["classes"],
            "nEpochs": summary["nEpochs"],
        }

    @app.get("/eeg/health")
    async def health() -> dict[str, Any]:
        lsl = service.lsl_status()
        with service.lock:
            model_loaded = service.decoder is not None
            simulating = service.sim is not None and service.sim.running
        return {
            "ok": True,
            "lsl": lsl,
            "modelLoaded": model_loaded,
            "simulating": simulating,
        }

    @app.post("/eeg/sim/start")
    async def sim_start(request: SimStartRequest) -> dict[str, bool]:
        await asyncio.to_thread(
            service.start_simulation, request.profile, request.channels, request.sfreq
        )
        return {"started": True}

    @app.post("/eeg/sim/stop")
    async def sim_stop() -> dict[str, bool]:
        await asyncio.to_thread(service.stop_simulation)
        return {"stopped": True}

    @app.post("/eeg/sim/profile")
    async def sim_profile(request: ProfileRequest) -> dict[str, str]:
        try:
            await asyncio.to_thread(service.set_sim_profile, request.profile)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"profile": request.profile}

    @app.post("/eeg/calibrate")
    async def calibrate(request: CalibrateRequest) -> dict[str, Any]:
        channels, sfreq = _stream_config()
        rng = np.random.default_rng()

        def build_epochs() -> tuple[list[np.ndarray], list[str]]:
            epochs: list[np.ndarray] = []
            labels: list[str] = []
            for state_name in request.states:
                for _ in range(request.epochsPerState):
                    epochs.append(
                        synth_epoch(state_name, request.epochSeconds, channels, sfreq, rng)
                    )
                    labels.append(state_name)
            return epochs, labels

        epochs, labels = await asyncio.to_thread(build_epochs)
        return await _calibrate_response(epochs, labels)

    @app.post("/eeg/calibrate/from-stream")
    async def calibrate_from_stream(request: CalibrateRequest) -> dict[str, Any]:
        def collect() -> tuple[list[np.ndarray], list[str]]:
            return service.calibration_windows_from_stream(
                request.states, request.epochsPerState, request.epochSeconds
            )

        try:
            epochs, labels = await asyncio.to_thread(collect)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return await _calibrate_response(epochs, labels)

    @app.get("/eeg/decode")
    async def decode() -> dict[str, Any]:
        # predict_proba is a few milliseconds at 64ch/250Hz; keeping it off
        # the event loop as well means a calibration can never delay polling.
        return await asyncio.to_thread(service.decode_snapshot)

    @app.post("/eeg/decode/target")
    async def set_decode_target(request: TargetRequest) -> dict[str, str]:
        try:
            await asyncio.to_thread(service.set_target, request.targetClass)
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"targetClass": request.targetClass}

    return app


state = ServiceState()
app = create_app(state)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8010)
