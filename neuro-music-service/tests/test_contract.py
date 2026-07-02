import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import (
    EegEmotionRequest,
    EmotionControlRequest,
    emotion_to_demon_controls,
    infer_mock_emotion,
)


def test_trigger_class_maps_to_eeg_emotion_label() -> None:
    response = infer_mock_emotion(
        EegEmotionRequest(
            channel_ids=["ch01", "ch02"],
            sample_rate_hz=1000,
            samples=[[1.0, 2.0], [3.0, 4.0]],
            trigger_class=2,
            source="test",
        )
    )

    assert response.emotion == "fear"
    assert response.probabilities["fear"] == response.confidence
    assert response.source == "test"


def test_four_class_paradigm_contract_is_minimum_runnable() -> None:
    config_path = Path(__file__).resolve().parents[1] / "config" / "eeg_emotion_paradigm.json"
    paradigm = json.loads(config_path.read_text(encoding="utf-8"))

    classes = paradigm["classes"]
    assert paradigm["minimum_videos_per_class"] == 5
    assert paradigm["trials_per_class_per_session"] == 5
    assert {item["paradigm_emotion"] for item in classes} == {
        "depression",
        "anxiety",
        "calm",
        "happy",
    }
    assert {item["system_emotion"] for item in classes} == {"sad", "fear", "neutral", "happy"}
    assert {item["trigger_class"] for item in classes} == {1, 2, 3, 4}


def test_emotion_control_maps_to_safe_demon_knobs() -> None:
    raw = emotion_to_demon_controls(
        EmotionControlRequest(
            emotion="fear",
            probabilities={"fear": 0.74, "sad": 0.1, "neutral": 0.08, "happy": 0.08},
            valence=-0.02,
            arousal=0.4,
            playback_pos=0.0,
        )
    )

    assert 0.0 <= raw["denoise"] <= 1.0
    assert 1.0 <= raw["shift"] <= 6.0
    assert 1 <= raw["steps_override"] <= 16
    assert 1.0 <= raw["guidance_scale"] <= 15.0
    assert raw["rcfg_mode"] == "off"
