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
    stream: Callable[..., Any] | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> LmStudioResult[T]:
    current_settings = settings or load_lm_studio_settings()
    if post is None and stream is None:
        try:
            import httpx
        except ModuleNotFoundError as exc:
            return LmStudioResult(available=False, error=str(exc))

        post_fn = httpx.post
        stream_fn = httpx.stream
        http_error = httpx.HTTPError
    else:
        post_fn = post
        stream_fn = stream
        http_error = Exception

    body = {
        "model": current_settings.model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "text"},
    }

    try:
        if stream_fn is not None:
            return _stream_json_with_lm_studio(
                stream_fn,
                current_settings,
                body,
                response_model,
                on_delta,
            )

        response = post_fn(
            f"{current_settings.base_url.rstrip('/')}/chat/completions",
            json=body,
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


def _stream_json_with_lm_studio(
    stream_fn: Callable[..., Any],
    settings: LmStudioSettings,
    body: dict[str, Any],
    response_model: type[T],
    on_delta: Callable[[str], None] | None,
) -> LmStudioResult[T]:
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    stream_body = {**body, "stream": True}

    with stream_fn(
        "POST",
        f"{settings.base_url.rstrip('/')}/chat/completions",
        json=stream_body,
        timeout=settings.timeout_seconds,
    ) as response:
        response.raise_for_status()
        for raw_line in response.iter_lines():
            line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
            line = line.strip()
            if not line or not line.startswith("data:"):
                continue

            data = line[len("data:"):].strip()
            if data == "[DONE]":
                break

            chunk = json.loads(data)
            delta = chunk["choices"][0].get("delta", {})
            reasoning_delta = delta.get("reasoning_content") or ""
            content_delta = delta.get("content") or ""
            if reasoning_delta:
                reasoning_parts.append(reasoning_delta)
                if on_delta is not None:
                    on_delta(reasoning_delta)
            if content_delta:
                content_parts.append(content_delta)

    content = "".join(content_parts) or "".join(reasoning_parts)
    parsed = _extract_json_object(content)
    return LmStudioResult(available=True, value=response_model.model_validate(parsed))
