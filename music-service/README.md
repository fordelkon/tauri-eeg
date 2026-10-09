# 本地音乐生成与智能助手服务

为 tauri-eeg 提供 WAV 音乐生成和智能助手规划接口。服务使用 FastAPI，音乐模型通过 `stable_audio_3.StableAudioModel.from_pretrained("small-music")` 加载，对应 `stabilityai/stable-audio-3-small-music`。

默认监听 `http://127.0.0.1:8000`。音乐生成使用本地模型，智能助手可连接 LM Studio 的本地语言模型服务。

桌面应用的整体操作流程见 [项目中文说明](../README.md)。

## 环境要求

- Python 3.11 或 3.12，项目要求为 `>=3.11,<3.13`。
- uv，用于管理依赖和运行服务。
- 可访问 Hugging Face 的网络环境，以及已取得该音乐模型访问权限的账号。
- 使用 CUDA 时需要兼容的 NVIDIA 驱动。CPU 也可运行，是否使用 GPU 以健康检查和实际环境为准。
- 使用语言模型规划时，需要另外运行 LM Studio；音乐生成不依赖 LM Studio。

除特别说明外，以下命令均在 `music-service` 目录执行。若当前位于项目根目录，先运行：

```powershell
Set-Location .\music-service
```

## 安装步骤

### 1. 配置模型缓存（可选）

建议在首次登录和模型下载前确定缓存位置。下面以 `D:\.hf-cache` 为例，按自己的磁盘位置修改。

```powershell
[Environment]::SetEnvironmentVariable("HF_HOME", "D:\.hf-cache", "User")
$env:HF_HOME = "D:\.hf-cache"
```

第一行保存当前 Windows 用户的配置，第二行设置当前终端。重新打开其他终端、IDE 和桌面应用后，它们才会使用新的配置。

检查当前终端的值：

```powershell
$env:HF_HOME
```

使用该示例配置时，模型仓库缓存通常位于 `D:\.hf-cache\hub`。Hugging Face 的登录信息也使用相应缓存配置；修改目录后需要检查登录状态。

### 2. 安装默认依赖

```powershell
uv sync
```

`pyproject.toml` 已声明 Stable Audio 3 的官方 Git 依赖，无需再单独安装其他同名包。依赖版本由项目配置和锁文件管理，不需要执行原文中的 `uv pip install -U huggingface_hub`。

### 3. 登录 Hugging Face

先按模型页面要求取得 `stabilityai/stable-audio-3-small-music` 的访问权限，再运行：

```powershell
uv run hf auth login
uv run hf auth whoami
```

第二条命令用于核对当前登录账号。CLI 用法见 [Hugging Face 官方说明](https://huggingface.co/docs/huggingface_hub/guides/cli)。

### 4. 安装 CUDA 12.8 依赖（可选）

项目的 `cu128` 可选依赖组为 Windows 配置 CUDA 12.8 的 PyTorch 软件源，并指定 `torch`、`torchaudio` 版本。

```powershell
uv sync --extra cu128
uv run --extra cu128 python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

检查输出中的 PyTorch 版本、CUDA 版本和可用状态。只安装依赖不等于 GPU 已可用。

后续运行 CUDA 服务时，在 `uv run` 中保留 `--extra cu128`。不使用该依赖组时采用默认命令。uv 的可选依赖行为见 [依赖同步说明](https://docs.astral.sh/uv/concepts/projects/sync/)。

## 启动与使用步骤

### 1. 启动服务

默认环境：

```powershell
uv run python server.py
```

使用 CUDA 12.8 可选依赖组：

```powershell
uv run --extra cu128 python server.py
```

选择其中一种启动方式，并保持终端打开。首次启动会在后台下载和加载模型，HTTP 服务开始监听时，音乐模型可能还未就绪。

服务默认自动选择设备：CUDA 可用时使用 `cuda`，否则使用 `cpu`。需要明确指定 CPU 时，在启动前设置：

```powershell
$env:MUSIC_SERVICE_DEVICE = "cpu"
uv run python server.py
```

`MUSIC_SERVICE_DEVICE` 也接受 `cuda`；强制选择 CUDA 时，服务不会因 GPU 不可用而自动改用 CPU。设置后需要重启服务。

### 2. 检查音乐模型就绪状态

在另一个 PowerShell 窗口执行：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

模型就绪时会返回类似以下内容：

```json
{
  "status": "ready",
  "modelLoaded": true,
  "modelVersion": "stable-audio-3-small-music",
  "gpuAvailable": false,
  "device": "cpu",
  "error": null
}
```

`gpuAvailable` 表示 PyTorch 检测到的 CUDA 可用状态，`device` 表示服务选择的运行设备。判断是否可以生成音乐时，检查 `status` 和 `modelLoaded`。

模型正在加载或加载失败时，`/health` 返回 HTTP 503；错误正文的 `detail` 会说明尚未加载或具体失败原因。

### 3. 从桌面应用生成音乐

1. 确认音乐模型已就绪，启动或返回 tauri-eeg 桌面应用。
2. 打开“音乐调控”，选择标签、填写描述并设置长度。
3. 点击“生成 WAV”，等待完成后选择曲目并播放。
4. 在“生成记录”中查看或删除历史曲目。

桌面应用会尝试通过 `uv run python server.py` 自动启动服务，也会复用端口 8000 上已就绪的服务。首次模型加载超过应用等待时间时，先手动启动并等待就绪，再从页面重试。

需要确保使用 `cu128` 依赖组或特定环境变量时，可按前文手动启动服务，让桌面应用复用它。

### 4. 停止服务

手动启动的服务可在其终端中按 `Ctrl+C` 停止。不要同时启动多个监听端口 8000 的服务实例。

## 可选：配置 LM Studio 智能助手

音乐模型和语言模型的作用不同。Stable Audio 负责生成音频，LM Studio 负责根据页面资源和上下文规划视频选择、音乐描述等操作。

1. 在 LM Studio 中准备要使用的模型，并启动 OpenAI 兼容的本地服务。
2. 检查模型列表：

```powershell
Invoke-RestMethod http://127.0.0.1:1234/v1/models
```

3. 将 `LM_STUDIO_MODEL` 设置为该响应或 LM Studio 中显示的实际模型 ID。
4. 在启动音乐服务的同一终端设置配置，然后启动或重启服务。

```powershell
$env:LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1"
$env:LM_STUDIO_TIMEOUT_SECONDS = "30"
```

模型 ID 因本机安装内容而异，不应照抄其他机器的名称。代码中的默认模型 ID 是 `google/gemma-4-e4b`，只有本地服务提供这个 ID 时才能直接使用默认值。

| 环境变量 | 默认值 | 作用 |
|---|---|---|
| `LM_STUDIO_BASE_URL` | `http://127.0.0.1:1234/v1` | OpenAI 兼容接口地址，包含 `/v1` |
| `LM_STUDIO_MODEL` | `google/gemma-4-e4b` | 发送给 LM Studio 的模型 ID |
| `LM_STUDIO_TIMEOUT_SECONDS` | `30` | 单次语言模型调用超时秒数 |

接口约定见 [LM Studio OpenAI 兼容接口](https://lmstudio.ai/docs/developer/openai-compat)。

LM Studio 未连接或返回无效结果时，部分视频与音乐规划会采用本地回退规则；部分助手操作会返回不可用。桌面页面的手动操作仍可使用。

## HTTP 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 检查音乐模型是否加载，以及设备状态 |
| POST | `/generate` | 等待音乐生成完成并返回结果 |
| GET | `/agent/health` | 返回助手规划版本与能力声明 |
| POST | `/agent/plan` | 返回一次助手规划结果 |
| POST | `/agent/plan/stream` | 通过 SSE 返回思考片段和最终规划结果 |

FastAPI 接口文档默认位于 `http://127.0.0.1:8000/docs`。

`/agent/health` 返回 `ready` 只说明规划接口能够响应，不会实际验证 LM Studio 连接，也不表示音乐模型已加载。生成音频前仍要检查 `/health`。

### 音乐生成参数

`POST /generate` 使用 JSON 请求体：

| 字段 | 要求 | 说明 |
|---|---|---|
| `prompt` | 必填，1–500 个字符 | 音乐生成描述 |
| `duration` | 5–120 秒，默认 30 | 请求的生成时长 |
| `job_id` | 必填，1–128 个字符 | 本次生成标识，应为每次请求分配新值 |
| `output_dir` | 必填，非空 | 输出目录，服务会创建目录并写入 WAV |
| `negative_prompt` | 可选，最多 500 个字符 | 当前接口接收此字段，但生成实现尚未将其传给模型 |

实际模型调用传入 `prompt` 和 `duration`。需要无歌词音乐时，应在描述中写清楚要求，而不能依赖当前未使用的 `negative_prompt` 字段。

生成请求会等待处理结束；模型访问通过同一个锁串行执行，并发请求需要排队。`progress` 在响应中表示最终状态，当前没有单独的生成进度查询接口。

### 手动验证一条 WAV

确认 `/health` 就绪后，在 `music-service` 目录的另一个 PowerShell 窗口执行：

```powershell
$musicTestPayload = @{
    prompt = "Gentle instrumental piano with a calm atmosphere, no vocals"
    duration = 15
    job_id = [guid]::NewGuid().ToString("N")
    output_dir = Join-Path (Get-Location) "generated-output"
} | ConvertTo-Json

$musicTestResult = Invoke-RestMethod `
    -Uri "http://127.0.0.1:8000/generate" `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($musicTestPayload)) `
    -TimeoutSec 600

$musicTestResult
```

成功响应中的 `status` 为 `completed`，`progress` 为 `100`，`output_path` 指向已保存的 WAV。输出文件命名为 `gen_<清理后的 job_id 前 12 个字符>.wav`。

生成失败可能返回 HTTP 200，但响应中的 `status` 为 `failed`，并附带 `error`。不能只按 HTTP 状态码判断生成成功。模型未加载时则返回 HTTP 503。

手动调用此接口生成的文件不会自动写入桌面应用的生成历史；需要由桌面生成流程保存相应数据库记录。

## 输出文件与日志

- 音乐文件写入请求指定的 `output_dir`。桌面调用会按应用存储设置选择当前用户的音乐目录。
- 通过桌面应用删除生成记录时，会同时删除对应 WAV；HTTP 服务没有单独的历史删除接口。
- 自动启动服务的日志位于 `%LOCALAPPDATA%\tauri-eeg\logs\python-service.out.log` 和 `python-service.err.log`。
- 手动启动时，模型加载与请求日志直接显示在当前终端。

## 常见问题

| 现象 | 检查与处理 |
|---|---|
| 应用提示音乐服务未就绪 | 手动启动服务，等待 `/health` 返回就绪，再从页面重试 |
| 模型访问失败或 Hugging Face 权限错误 | 确认模型访问权限、当前登录账号及 `HF_HOME`；修改环境后重启服务 |
| `/health` 返回 HTTP 503 | 检查是否仍在加载模型，并查看响应 `detail` 或终端中的错误 |
| `torch.cuda.is_available()` 为 `False` | 检查 CUDA 依赖组与驱动，使用 `uv run --extra cu128` 复核实际环境 |
| `WinError 10048` | 端口 8000 被占用，检查是否已有可复用服务；不要重复启动 |
| LM Studio 规划超时或不可用 | 检查端口 1234、实际模型 ID、接口地址和超时设置 |
| `flash_attn` 未安装或 FastAPI `on_event` 弃用提示 | 根据模型就绪状态判断是否影响使用，不要仅凭提示认定生成失败 |
| 请求返回了 JSON，但没有生成文件 | 检查响应中的 `status`、`error` 和 `output_path`，而非只看请求是否返回 |

## 测试

在 `music-service` 目录运行：

```powershell
uv run --with pytest pytest
```

使用 CUDA 可选依赖组时：

```powershell
uv run --extra cu128 --with pytest pytest
```

测试覆盖 LM Studio 响应解析、助手规划和 Stable Audio 接口集成。模型调用通过测试替身验证，不下载真实模型，也不代表已验证实际音频质量、生成时长或 GPU 性能。

## 文件说明

```text
server.py                           服务入口、模型加载、WAV 生成和 HTTP 接口
agent_planner.py                    助手规划及本地回退规则
lm_studio_client.py                 LM Studio 配置、响应解析和流式调用
pyproject.toml                     Python 版本、依赖与 CUDA 可选依赖组
uv.lock                            依赖锁文件
tests/test_stable_audio3_integration.py  模型调用与 WAV 保存约定测试
tests/test_agent_planner.py          助手行为与能力测试
tests/test_lm_studio_client.py       语言模型响应解析测试
```
