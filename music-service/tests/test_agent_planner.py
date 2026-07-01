from __future__ import annotations

import asyncio
import unittest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_planner import (
    AGENT_PLANNER_CAPABILITIES,
    AGENT_PLANNER_VERSION,
    AgentPlannerRequest,
    LmMusicPlannerOutput,
    LmVideoPlannerOutput,
    plan_agent_action,
)
from server import agent_health_check


def base_request(**overrides):
    data = {
        "phase": "music_regulation",
        "currentRoute": "/music-regulation",
        "userInput": "generate relaxing music",
        "scaleStatus": {
            "dimensions": [
                {"key": "anxiety", "label": "Anxiety", "description": "Tension", "value": 85},
                {"key": "worry", "label": "Worry", "description": "Worry", "value": 70},
                {"key": "mood", "label": "Mood", "description": "Mood", "value": 45},
                {"key": "energy", "label": "Energy", "description": "Energy", "value": 50},
            ],
            "lastScaleTitle": "Music Regulation Scale",
            "updatedAt": 1782748800000,
        },
        "availableResources": {
            "videos": [
                {"id": "9_seg016", "title": "鏆壊娴峰哺", "tags": ["娴峰哺", "榛勬槒", "娓╂煍"]},
            ],
            "musicGeneration": True,
            "gameAvailable": False,
        },
        "personalizedContext": {"answers": [], "timeline": []},
    }
    data.update(overrides)
    return AgentPlannerRequest.model_validate(data)


class AgentPlannerTests(unittest.TestCase):
    def test_exposes_planner_version_and_lm_capabilities(self):
        self.assertEqual(AGENT_PLANNER_VERSION, "lm-video-music-v1")
        self.assertIn("lm_video_selection", AGENT_PLANNER_CAPABILITIES)
        self.assertIn("lm_music_generation_prompt", AGENT_PLANNER_CAPABILITIES)

    def test_agent_health_reports_versioned_capabilities(self):
        response = asyncio.run(agent_health_check())

        self.assertEqual(response["status"], "ready")
        self.assertEqual(response["plannerVersion"], AGENT_PLANNER_VERSION)
        self.assertEqual(response["capabilities"], AGENT_PLANNER_CAPABILITIES)

    def test_recommends_music_for_high_anxiety_music_phase(self) -> None:
        with patch("agent_planner.complete_json_with_lm_studio") as complete_json:
            complete_json.return_value.available = False
            complete_json.return_value.value = None

            response = plan_agent_action(base_request())

        self.assertEqual(response.action, "recommend_music")
        self.assertEqual(response.params["style"], "ambient instrumental")
        self.assertEqual(response.params["duration"], 30)
        self.assertIn("high anxiety", response.reason.lower())
        self.assertEqual(response.status, "available")
        self.assertGreaterEqual(len(response.thinking), 3)
        self.assertTrue(any("phase" in step.lower() for step in response.thinking))

    def test_music_recommendation_varies_by_state_and_recent_history(self) -> None:
        with patch("agent_planner.complete_json_with_lm_studio") as complete_json:
            complete_json.return_value.available = False
            complete_json.return_value.value = None

            high_anxiety = plan_agent_action(base_request())
            low_energy = plan_agent_action(base_request(
                scaleStatus={
                    "dimensions": [
                        {"key": "anxiety", "label": "Anxiety", "description": "Tension", "value": 35},
                        {"key": "worry", "label": "Worry", "description": "Worry", "value": 30},
                        {"key": "mood", "label": "Mood", "description": "Mood", "value": 55},
                        {"key": "energy", "label": "Energy", "description": "Energy", "value": 20},
                    ],
                    "lastScaleTitle": "Music Regulation Scale",
                    "updatedAt": 1782748800000,
                },
                personalizedContext={
                    "answers": [],
                    "timeline": [
                        {"at": 1, "phase": "music_regulation", "type": "planner", "text": "recommend_music:ambient instrumental|slow tempo, warm tone, soft rhythm"},
                    ],
                },
            ))

        self.assertEqual(high_anxiety.action, "recommend_music")
        self.assertEqual(low_energy.action, "recommend_music")
        self.assertNotEqual(high_anxiety.params["style"], low_energy.params["style"])
        self.assertNotEqual(high_anxiety.params["details"], low_energy.params["details"])
        self.assertIn("low energy", low_energy.reason.lower())

    def test_music_prompt_uses_lm_studio_planner(self) -> None:
        with patch("agent_planner.complete_json_with_lm_studio") as complete_json:
            complete_json.return_value.available = False
            complete_json.return_value.value = None

            response = plan_agent_action(base_request(
                userInput="generate regulation music from my tags",
                personalizedContext={
                    "answers": [
                        {"phase": "music_regulation", "answer": "I prefer piano and soft rain.", "normalizedTags": ["piano", "soft-rain"]},
                    ],
                    "timeline": [],
                },
            ))

        self.assertEqual(response.action, "recommend_music")
        complete_json.assert_called_once()
        user_message = complete_json.call_args.args[0][1]["content"]
        self.assertIn("piano", user_message)
        self.assertIn("soft-rain", user_message)

    def test_music_planner_uses_lm_studio_generated_tags_when_valid(self) -> None:
        class LmResult:
            available = True

            class Value:
                style = "ambient piano"
                details = "soft rain texture, slow breathing pulse"
                duration = 42
                prompt = "ambient piano, soft rain texture, slow breathing pulse, no vocals"
                reason = "Piano and rain match the user's existing tags while keeping stimulation low."
                thinking = ["Read user tags.", "Composed a low-stimulation music prompt."]

            value = Value()

        with patch("agent_planner.complete_json_with_lm_studio", return_value=LmResult()):
            response = plan_agent_action(base_request(
                userInput="generate regulation music from my tags",
                personalizedContext={
                    "answers": [
                        {"phase": "music_regulation", "answer": "I prefer piano and soft rain.", "normalizedTags": ["piano", "soft-rain"]},
                    ],
                    "timeline": [],
                },
            ))

        self.assertEqual(response.action, "recommend_music")
        self.assertEqual(response.params["style"], "ambient piano")
        self.assertEqual(response.params["details"], "soft rain texture, slow breathing pulse")
        self.assertEqual(response.params["duration"], 42)
        self.assertEqual(response.params["prompt"], "ambient piano, soft rain texture, slow breathing pulse, no vocals")
        self.assertIn("existing tags", response.reason)
        self.assertIn("Read user tags.", response.thinking)

    def test_music_planner_accepts_string_thinking_from_lm_studio(self) -> None:
        output = LmMusicPlannerOutput.model_validate({
            "style": "ambient piano",
            "details": "soft texture",
            "duration": 30,
            "prompt": "ambient piano, soft texture, no vocals",
            "reason": "Uses a soft tag.",
            "thinking": "Converted user tags into a music prompt.",
        })

        self.assertEqual(output.thinking, ["Converted user tags into a music prompt."])


    def test_recommends_video_from_finite_resources(self) -> None:
        with patch("agent_planner.complete_json_with_lm_studio") as complete_json:
            complete_json.return_value.available = False
            complete_json.return_value.value = None

            response = plan_agent_action(base_request(
                phase="video_regulation",
                currentRoute="/video-regulation",
                userInput="recommend a relaxing video",
            ))

        self.assertEqual(response.action, "play_video")
        self.assertEqual(response.params["videoId"], "9_seg016")
        self.assertTrue(response.requiresConfirmation)

    def test_play_relaxing_video_prompt_uses_video_planner(self) -> None:
        with patch("agent_planner.complete_json_with_lm_studio") as complete_json:
            complete_json.return_value.available = False
            complete_json.return_value.value = None

            response = plan_agent_action(base_request(
                phase="video_regulation",
                currentRoute="/video-regulation",
                userInput="play relaxing video",
            ))

        self.assertEqual(response.action, "play_video")
        self.assertEqual(response.params["videoId"], "9_seg016")
        self.assertGreaterEqual(len(response.thinking), 3)
        complete_json.assert_called_once()

    def test_clicked_video_prompt_calls_lm_studio_and_keeps_video_id(self) -> None:
        class LmResult:
            available = True

            class Value:
                videoId = "9_seg016"
                reason = "The clicked coast video is suitable for a soft regulation segment."
                thinking = ["Detected requested video id.", "Validated it against the catalog."]

            value = Value()

        with patch("agent_planner.complete_json_with_lm_studio", return_value=LmResult()) as complete_json:
            response = plan_agent_action(base_request(
                phase="video_regulation",
                currentRoute="/video-regulation",
                userInput="play_video:9_seg016",
            ))

        self.assertEqual(response.action, "play_video")
        self.assertEqual(response.params["videoId"], "9_seg016")
        self.assertIn("clicked", response.reason)
        self.assertIn("Detected requested video id.", response.thinking)
        complete_json.assert_called_once()

    def test_video_planner_uses_lm_studio_selected_video_when_valid(self) -> None:
        class LmResult:
            available = True

            class Value:
                videoId = "14_seg000"
                reason = "The forest clip has the lowest stimulation."
                thinking = ["Reviewed scale scores.", "Selected quiet forest material."]

            value = Value()

        with patch("agent_planner.complete_json_with_lm_studio", return_value=LmResult()):
            response = plan_agent_action(base_request(
                phase="video_regulation",
                currentRoute="/video-regulation",
                userInput="play relaxing video",
                availableResources={
                    "videos": [
                        {"id": "9_seg016", "title": "dusk coast", "tags": ["coast", "dusk", "soft"]},
                        {"id": "14_seg000", "title": "deep forest", "tags": ["forest", "green", "quiet"]},
                    ],
                    "musicGeneration": False,
                    "gameAvailable": False,
                },
            ))

        self.assertEqual(response.action, "play_video")
        self.assertEqual(response.params["videoId"], "14_seg000")
        self.assertIn("forest", response.reason.lower())
        self.assertIn("Reviewed scale scores.", response.thinking)

    def test_video_planner_accepts_string_thinking_from_lm_studio(self) -> None:
        output = LmVideoPlannerOutput.model_validate({
            "videoId": "9_seg016",
            "reason": "Coast video is soft.",
            "thinking": "Compared available videos against scale state.",
        })

        self.assertEqual(output.videoId, "9_seg016")
        self.assertEqual(output.thinking, ["Compared available videos against scale state."])

    def test_video_phase_next_step_is_navigation_not_video_recommendation(self) -> None:
        response = plan_agent_action(base_request(
            phase="video_regulation",
            currentRoute="/video-regulation",
            userInput="next",
        ))

        self.assertEqual(response.action, "go_next_page")
        self.assertFalse(response.requiresConfirmation)

    def test_video_recommendation_avoids_recently_recommended_video(self) -> None:
        with patch("agent_planner.complete_json_with_lm_studio") as complete_json:
            complete_json.return_value.available = False
            complete_json.return_value.value = None

            response = plan_agent_action(base_request(
                phase="video_regulation",
                currentRoute="/video-regulation",
                userInput="recommend video",
                availableResources={
                    "videos": [
                        {"id": "9_seg016", "title": "dusk coast", "tags": ["coast", "dusk", "soft"]},
                        {"id": "14_seg000", "title": "deep forest", "tags": ["forest", "green", "quiet"]},
                    ],
                    "musicGeneration": False,
                    "gameAvailable": False,
                },
                personalizedContext={
                    "answers": [],
                    "timeline": [
                        {"at": 1, "phase": "video_regulation", "type": "planner", "text": "recommend_video:9_seg016"},
                    ],
                },
            ))

        self.assertEqual(response.action, "play_video")
        self.assertEqual(response.params["videoId"], "14_seg000")

    def test_skips_unavailable_game(self) -> None:
        response = plan_agent_action(base_request(
            phase="game_regulation",
            currentRoute="/game-regulation",
            userInput="缁х画瀹為獙",
        ))

        self.assertEqual(response.action, "skip_game")
        self.assertFalse(response.requiresConfirmation)

    def test_summary_does_not_claim_eeg_analysis(self) -> None:
        response = plan_agent_action(base_request(
            phase="finish",
            currentRoute="/home",
            userInput="summary",
        ))

        self.assertEqual(response.action, "generate_summary")
        self.assertNotIn("EEG", response.reason)

    def test_returns_unavailable_when_lm_studio_is_down_for_open_query(self) -> None:
        response = plan_agent_action(base_request(userInput="personalized recommendation"))

        self.assertEqual(response.status, "unavailable")
        self.assertEqual(response.action, "no_op")


if __name__ == "__main__":
    unittest.main()
