from __future__ import annotations

import json
import os
from typing import Any, Callable, Generic, TypeVar

from pydantic import BaseModel, ValidationError


T = TypeVar("T", bound=BaseModel)


class LmStudioSettings(BaseModel):
    base_url: str = "http://127.0.0.1:1234/v1"
    model: str = "google/gemma-4-e4b"
    timeout_seconds: float = 30.0


class LmStudioResult(BaseModel, Generic[T]):
    available: bool
    value: T | None = None
    error: str | None = None


def _extract_json_object(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


def load_lm_studio_settings() -> LmStudioSettings:
    return LmStudioSettings(
        base_url=os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:1234/v1"),
        model=os.getenv("LM_STUDIO_MODEL", "google/gemma-4-e4b"),
        timeout_seconds=float(os.getenv("LM_STUDIO_TIMEOUT_SECONDS", "30")),
    )


def complete_json_with_lm_studio(
    messages: list[dict[str, str]],
    response_model: type[T],
    *,
    settings: LmStudioSettings | None = None,
    post: Callable[..., Any] | None = None,
) -> LmStudioResult[T]:
    current_settings = settings or load_lm_studio_settings()
    if post is None:
        try:
            import httpx
        except ModuleNotFoundError as exc:
            return LmStudioResult(available=False, error=str(exc))

        post_fn = httpx.post
        http_error = httpx.HTTPError
    else:
        post_fn = post
        http_error = Exception

    try:
        response = post_fn(
            f"{current_settings.base_url.rstrip('/')}/chat/completions",
            json={
                "model": current_settings.model,
                "messages": messages,
                "temperature": 0.2,
                "response_format": {"type": "text"},
            },
            timeout=current_settings.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        message = payload["choices"][0]["message"]
        content = message.get("content") or message.get("reasoning_content") or ""
        parsed = _extract_json_object(content)
        return LmStudioResult(available=True, value=response_model.model_validate(parsed))
    except (http_error, KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as exc:
        return LmStudioResult(available=False, error=str(exc))
