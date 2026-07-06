from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lm_studio_client import (
    LmStudioSettings,
    complete_json_with_lm_studio,
    load_lm_studio_settings,
)


class _PlannerOutput(BaseModel):
    action: str


class LmStudioClientTests(unittest.TestCase):
    def test_reads_lm_studio_settings_from_environment(self) -> None:
        original_base = os.environ.get("LM_STUDIO_BASE_URL")
        original_model = os.environ.get("LM_STUDIO_MODEL")
        os.environ["LM_STUDIO_BASE_URL"] = "http://127.0.0.1:9999/v1"
        os.environ["LM_STUDIO_MODEL"] = "local-test"
        try:
            settings = load_lm_studio_settings()
        finally:
            if original_base is None:
                os.environ.pop("LM_STUDIO_BASE_URL", None)
            else:
                os.environ["LM_STUDIO_BASE_URL"] = original_base
            if original_model is None:
                os.environ.pop("LM_STUDIO_MODEL", None)
            else:
                os.environ["LM_STUDIO_MODEL"] = original_model

        self.assertEqual(settings.base_url, "http://127.0.0.1:9999/v1")
        self.assertEqual(settings.model, "local-test")

    def test_uses_local_defaults(self) -> None:
        self.assertEqual(load_lm_studio_settings().base_url, "http://127.0.0.1:1234/v1")

    def test_returns_unavailable_when_lm_studio_is_not_reachable(self) -> None:
        result = complete_json_with_lm_studio(
            [{"role": "user", "content": "hello"}],
            _PlannerOutput,
            settings=LmStudioSettings(base_url="http://127.0.0.1:9/v1", model="missing"),
        )

        self.assertFalse(result.available)
        self.assertIsNone(result.value)

    def test_rejects_invalid_model_json(self) -> None:
        def fake_post(*args, **kwargs):
            class Response:
                def raise_for_status(self) -> None:
                    return None

                def json(self):
                    return {"choices": [{"message": {"content": "not json"}}]}

            return Response()

        result = complete_json_with_lm_studio(
            [{"role": "user", "content": "hello"}],
            _PlannerOutput,
            settings=LmStudioSettings(),
            post=fake_post,
        )

        self.assertFalse(result.available)
        self.assertIsNone(result.value)

    def test_uses_lm_studio_supported_text_response_format(self) -> None:
        captured_body = {}

        def fake_post(*args, **kwargs):
            captured_body.update(kwargs["json"])

            class Response:
                def raise_for_status(self) -> None:
                    return None

                def json(self):
                    return {
                        "choices": [
                            {
                                "message": {
                                    "content": "{\"action\":\"no_op\"}",
                                },
                            },
                        ],
                    }

            return Response()

        result = complete_json_with_lm_studio(
            [{"role": "user", "content": "hello"}],
            _PlannerOutput,
            settings=LmStudioSettings(),
            post=fake_post,
        )

        self.assertTrue(result.available)
        self.assertEqual(captured_body["response_format"], {"type": "text"})

    def test_uses_longer_default_timeout_for_reasoning_models(self) -> None:
        captured_timeout = None

        def fake_post(*args, **kwargs):
            nonlocal captured_timeout
            captured_timeout = kwargs["timeout"]

            class Response:
                def raise_for_status(self) -> None:
                    return None

                def json(self):
                    return {
                        "choices": [
                            {
                                "message": {
                                    "content": "{\"action\":\"no_op\"}",
                                },
                            },
                        ],
                    }

            return Response()

        complete_json_with_lm_studio(
            [{"role": "user", "content": "hello"}],
            _PlannerOutput,
            settings=LmStudioSettings(),
            post=fake_post,
        )

        self.assertEqual(captured_timeout, 30.0)

    def test_reads_json_from_reasoning_content_when_message_content_is_empty(self) -> None:
        def fake_post(*args, **kwargs):
            class Response:
                def raise_for_status(self) -> None:
                    return None

                def json(self):
                    return {
                        "choices": [
                            {
                                "message": {
                                    "content": "",
                                    "reasoning_content": "Thinking...\n{\"action\":\"no_op\"}",
                                },
                            },
                        ],
                    }

            return Response()

        result = complete_json_with_lm_studio(
            [{"role": "user", "content": "hello"}],
            _PlannerOutput,
            settings=LmStudioSettings(),
            post=fake_post,
        )

        self.assertTrue(result.available)
        self.assertEqual(result.value.action if result.value else None, "no_op")

    def test_streams_lm_studio_deltas_before_parsing_final_json(self) -> None:
        captured_body = {}
        deltas: list[str] = []

        class FakeStreamResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

            def raise_for_status(self) -> None:
                return None

            def iter_lines(self):
                yield 'data: {"choices":[{"delta":{"reasoning_content":"Reading scale status. "}}]}'
                yield 'data: {"choices":[{"delta":{"content":"{\\"action\\":"}}]}'
                yield 'data: {"choices":[{"delta":{"content":"\\"no_op\\"}"}}]}'
                yield "data: [DONE]"

        def fake_stream(method, url, **kwargs):
            captured_body.update(kwargs["json"])
            return FakeStreamResponse()

        result = complete_json_with_lm_studio(
            [{"role": "user", "content": "hello"}],
            _PlannerOutput,
            settings=LmStudioSettings(),
            stream=fake_stream,
            on_delta=deltas.append,
        )

        self.assertTrue(result.available)
        self.assertEqual(result.value.action if result.value else None, "no_op")
        self.assertTrue(captured_body["stream"])
        self.assertEqual(deltas, ["Reading scale status. "])


if __name__ == "__main__":
    unittest.main()
