from __future__ import annotations

import ast
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path

import tomllib


SERVICE_ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = SERVICE_ROOT / "server.py"


class _FakeNoGrad:
    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class _FakeTorch(types.ModuleType):
    float32 = "float32"
    int16 = "int16"
    cuda_available = False

    class cuda:
        @staticmethod
        def is_available() -> bool:
            return _FakeTorch.cuda_available

    @staticmethod
    def inference_mode() -> _FakeNoGrad:
        return _FakeNoGrad()


class _FakeAudio:
    shape = (3,)

    def detach(self) -> "_FakeAudio":
        return self

    def cpu(self) -> "_FakeAudio":
        return self

    def numpy(self):
        return [0.0, 0.0, 0.0]


class _FakeTensorAudio:
    def __init__(self, shape: tuple[int, ...]) -> None:
        self.shape = shape

    def detach(self) -> "_FakeTensorAudio":
        return self

    def cpu(self) -> "_FakeTensorAudio":
        return self

    def unsqueeze(self, dim: int) -> "_FakeTensorAudio":
        shape = list(self.shape)
        shape.insert(dim, 1)
        return _FakeTensorAudio(tuple(shape))

    def squeeze(self, dim: int) -> "_FakeTensorAudio":
        shape = list(self.shape)
        if shape[dim] == 1:
            shape.pop(dim)
        return _FakeTensorAudio(tuple(shape))

    def transpose(self, dim0: int, dim1: int) -> "_FakeTensorAudio":
        shape = list(self.shape)
        shape[dim0], shape[dim1] = shape[dim1], shape[dim0]
        return _FakeTensorAudio(tuple(shape))


class _FakeModel:
    sample_rate = 44100

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeAudio()


class _FakeStableAudioModel:
    loaded_model = _FakeModel()

    @staticmethod
    def from_pretrained(model_name: str) -> _FakeModel:
        if model_name != "small-music":
            raise ValueError(model_name)
        return _FakeStableAudioModel.loaded_model


def _load_server_module(device_override: str | None = None, cuda_available: bool = False):
    original_torch = sys.modules.get("torch")
    original_device_override = os.environ.get("MUSIC_SERVICE_DEVICE")
    original_cuda_available = _FakeTorch.cuda_available
    _FakeTorch.cuda_available = cuda_available
    sys.modules["torch"] = _FakeTorch("torch")
    if device_override is None:
        os.environ.pop("MUSIC_SERVICE_DEVICE", None)
    else:
        os.environ["MUSIC_SERVICE_DEVICE"] = device_override
    try:
        spec = importlib.util.spec_from_file_location("music_service_server_test", SERVER_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError("Failed to load server.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if original_torch is None:
            sys.modules.pop("torch", None)
        else:
            sys.modules["torch"] = original_torch
        if original_device_override is None:
            os.environ.pop("MUSIC_SERVICE_DEVICE", None)
        else:
            os.environ["MUSIC_SERVICE_DEVICE"] = original_device_override
        _FakeTorch.cuda_available = original_cuda_available


class StableAudio3IntegrationTests(unittest.IsolatedAsyncioTestCase):
    def test_pyproject_installs_official_stable_audio3_library(self) -> None:
        pyproject = tomllib.loads((SERVICE_ROOT / "pyproject.toml").read_text(encoding="utf-8"))

        dependencies = pyproject["project"]["dependencies"]

        self.assertIn(
            "stable-audio-3 @ git+https://github.com/Stability-AI/stable-audio-3.git",
            dependencies,
        )

    def test_pyproject_uses_cuda_pytorch_wheels_on_windows_and_linux(self) -> None:
        pyproject = tomllib.loads((SERVICE_ROOT / "pyproject.toml").read_text(encoding="utf-8"))

        optional_dependencies = pyproject["project"]["optional-dependencies"]
        index_names = {index["name"]: index for index in pyproject["tool"]["uv"]["index"]}
        sources = pyproject["tool"]["uv"]["sources"]

        self.assertIn("torch==2.7.1", optional_dependencies["cu128"])
        self.assertIn("torchaudio==2.7.1", optional_dependencies["cu128"])
        self.assertEqual(index_names["pytorch-cu128"]["url"], "https://download.pytorch.org/whl/cu128")
        self.assertTrue(index_names["pytorch-cu128"]["explicit"])
        self.assertEqual(
            {(source["index"], source["extra"]) for source in sources["torch"]},
            {("pytorch-cu128", "cu128")},
        )
        self.assertEqual(
            {(source["index"], source["extra"]) for source in sources["torchaudio"]},
            {("pytorch-cu128", "cu128")},
        )

    def test_generate_uses_official_duration_parameter(self) -> None:
        tree = ast.parse(SERVER_PATH.read_text(encoding="utf-8"))
        generate_calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "generate"
        ]

        self.assertTrue(generate_calls)
        keyword_names = {keyword.arg for call in generate_calls for keyword in call.keywords}
        self.assertIn("duration", keyword_names)
        self.assertNotIn("seconds_total", keyword_names)

    async def test_generate_wav_passes_prompt_and_duration_to_model(self) -> None:
        server = _load_server_module()
        fake_model = _FakeModel()
        server.model = fake_model
        server.save_wav = lambda output_path, audio, sample_rate: None
        request = server.GenerateRequest(
            prompt="calm piano instrumental",
            duration=30,
            job_id="job-1",
            output_dir=str(SERVICE_ROOT),
        )

        await server.generate_wav(request, SERVICE_ROOT / "ignored.wav")

        self.assertEqual(
            fake_model.calls,
            [{"prompt": "calm piano instrumental", "duration": 30}],
        )

    def test_device_can_be_forced_to_cpu_with_environment_variable(self) -> None:
        server = _load_server_module(device_override="cpu", cuda_available=True)

        self.assertEqual(server.device, "cpu")

    def test_load_model_accepts_stable_audio3_model_without_to_method(self) -> None:
        server = _load_server_module(device_override="cuda", cuda_available=True)
        stable_audio_3 = types.ModuleType("stable_audio_3")
        stable_audio_3.StableAudioModel = _FakeStableAudioModel
        original_stable_audio_3 = sys.modules.get("stable_audio_3")
        sys.modules["stable_audio_3"] = stable_audio_3
        try:
            loaded_model = server.load_model()
        finally:
            if original_stable_audio_3 is None:
                sys.modules.pop("stable_audio_3", None)
            else:
                sys.modules["stable_audio_3"] = original_stable_audio_3

        self.assertIs(loaded_model, _FakeStableAudioModel.loaded_model)

    def test_save_wav_squeezes_single_batch_dimension_before_torchaudio_save(self) -> None:
        server = _load_server_module()
        saved_shapes: list[tuple[int, ...]] = []
        fake_torchaudio = types.ModuleType("torchaudio")

        def save(output_path, audio, sample_rate, format):
            saved_shapes.append(audio.shape)
            if len(audio.shape) != 2:
                raise ValueError(f"Expected 2D Tensor, got {len(audio.shape)}D.")

        fake_torchaudio.save = save
        original_torchaudio = sys.modules.get("torchaudio")
        sys.modules["torchaudio"] = fake_torchaudio
        try:
            server.save_wav(SERVICE_ROOT / "ignored.wav", _FakeTensorAudio((1, 2, 44100)), 44100)
        finally:
            if original_torchaudio is None:
                sys.modules.pop("torchaudio", None)
            else:
                sys.modules["torchaudio"] = original_torchaudio

        self.assertEqual(saved_shapes, [(2, 44100)])


if __name__ == "__main__":
    unittest.main()
