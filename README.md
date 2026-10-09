# tauri-eeg

用于情绪诱发、音乐与视频调控、量表测量和实验记录的桌面应用。前端使用 React 与 TypeScript，桌面后端使用 Tauri 2、Rust 与 SQLite，音乐生成由本地 Python 服务提供。

应用通过 BioSemi USB Trigger Interface 发送事件码，保存实验、试次和量表记录。脑电采集与 BDF 文件保存由 ActiView 完成，应用不控制 ActiView，也不显示实时脑电波形。

## 功能概览

- 本地账号注册、登录和按用户保存数据。
- 五步实验准备、触发盒连接、测试码发送、排练与正式模式切换。
- 个人校准与独立诱发的逐试次范式，支持视频呈现和 SAM 评分。
- 从 `video_paradigm/Calm/` 读取真实视频，按文件夹分类、搜索和播放。
- 本地音乐生成、曲目播放、生成历史管理和 WAV 文件删除。
- 自然恢复、音乐调控和视频调控的效果评价，支持前后测量配对、跨条件比较和报告导出。
- 实验日志导出与外部 BDF 文件关联。

VR 与游戏调控页面目前展示入口，设备联动尚未接入。

## 安装与启动

### 1. 准备开发环境

Windows 开发需要以下工具：

| 工具 | 用途 |
|---|---|
| Node.js 与 pnpm | 安装前端依赖、启动页面和构建 |
| Rust 工具链 | 编译桌面后端 |
| Microsoft C++ Build Tools | Windows 原生编译，安装时选择“使用 C++ 的桌面开发” |
| Microsoft Edge WebView2 Runtime | 渲染桌面界面 |
| uv 与 Python 3.11 或 3.12 | 安装和运行音乐服务，使用音乐生成时需要 |

详细系统要求见 [Tauri 开发环境说明](https://v2.tauri.app/start/prerequisites/)。

除特别说明外，以下命令从项目根目录开始运行。先在终端进入你的 `tauri-eeg` 文件夹。

### 2. 安装前端依赖

```powershell
pnpm install
```

### 3. 设置模型缓存位置（可选）

可在首次下载模型和登录前配置 `HF_HOME`。下面以 `D:\.hf-cache` 为例，请替换成自己的缓存目录。

```powershell
[Environment]::SetEnvironmentVariable("HF_HOME", "D:\.hf-cache", "User")
$env:HF_HOME = "D:\.hf-cache"
```

第一行保存用户环境变量，第二行应用到当前终端。重新打开其他终端和桌面应用后，它们才会使用新的配置。

### 4. 配置音乐服务

只使用视频和实验流程时，可以暂不配置音乐生成。使用音乐生成前，先取得 Hugging Face 上 `stabilityai/stable-audio-3-small-music` 模型的访问权限。

在项目根目录运行：

```powershell
Set-Location .\music-service
uv sync
uv run hf auth login
uv run hf auth whoami
Set-Location ..
```

登录方式见 [Hugging Face CLI 使用说明](https://huggingface.co/docs/huggingface_hub/guides/cli)。

项目提供 Windows CUDA 12.8 的可选依赖组。需要使用该环境时，在项目根目录运行：

```powershell
Set-Location .\music-service
uv sync --extra cu128
uv run --extra cu128 python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
Set-Location ..
```

使用该依赖组手动启动服务时，也在 `uv run` 中保留 `--extra cu128`，见下方的音乐服务启动步骤。

### 5. 启动桌面应用

```powershell
pnpm tauri dev
```

本地视频读取、目录选择、Trigger 控制、数据库保存和文件导出需要使用桌面应用。

仅预览前端页面时，可以运行：

```powershell
pnpm dev
```

浏览器预览不提供桌面命令和本地文件读取。页面会显示相应提示，不会用虚构视频填充列表。

## 视频素材准备

项目默认从根目录下的 `video_paradigm` 读取素材：

```text
video_paradigm/
├── Anxiety/                   焦虑诱发视频
├── Depression/                抑郁诱发视频
├── Fear/                      恐惧诱发视频
└── Calm/                      平静与视频调控素材
    ├── healing_animation/     治愈动画
    ├── music/                 音乐视频
    ├── scenery/               风景
    ├── sound_relaxation/      声音放松
    └── vlog/                  日常影像
```

扫描支持嵌套目录和 `.mp4` 文件，不需要旧版视频标签 JSON 索引。同名视频位于不同分类时，会保留各自的路径和身份。

个人校准使用平静类 5 个试次；独立诱发使用焦虑、抑郁、恐惧三类，各 5 个试次。逐试次范式要求视频时长为 45–90 秒，越界视频会被标记为呈现质量异常。独立视频调控页只要求 `Calm/` 中存在可播放 MP4，不采用逐试次范式的数量和时长门槛。

效果评价与个人校准目前都使用 Calm 池。正式研究需要按实验方案划分素材，当前目录结构本身不保证标定与调控素材互不重复。

数量、编码和素材分配要求见 [范式视频库准备指南](docs/video-library-requirements.md)。

## 操作步骤

### 1. 登录与选择操作目的

1. 启动桌面应用。首次使用点击“还没有账号？立即注册”，创建本地账号。
2. 登录后进入首页，通过侧边栏选择“实验设置”“视频调控”“音乐调控”或“效果评价”。
3. 独立调控页面出现量表提示时，按页面说明完成测量；熟悉界面的排练操作可按提示选择“跳过本次”。
4. 需要保存正式实验事件时，从“实验设置”开始准备，不以独立播放器操作代替实验流程。

### 2. 按五步准备实验

打开“实验设置”，按“下一步”依次操作：

1. **选择实验**：选择“效果评价”或“逐试次范式”，再选择排练或正式模式。排练保存日志和量表，不发送流程 Trigger；正式模式发送硬件事件码。
2. **连接与测试**：正式模式点击“刷新端口”，选择 COM 端口并“连接触发盒”。首次使用先保存一份短测试 BDF，再点击“发送测试 Trigger”，在 BDF 中核对测试码 254。排练可以跳过连接，但测试按钮仍会向硬件发送测试码。
3. **准备素材**：点击“选择文件夹”，选择 `video_paradigm` 这一层，再点击“验证并保存素材库”。音乐实验需要提前准备曲目。
4. **保存脑电**：正式模式先在 ActiView 开始采集，通过 `Start File` 保存本次 BDF。确认绿色 `Saving` 和保存秒数增长，再回到应用填写“BDF 记录名”，勾选“我已在 ActiView 启动本次 BDF 保存”。
5. **核对并进入**：检查流程、模式、触发盒、素材和 BDF 保存状态，点击“进入效果评价”或“进入逐试次范式”。

只保留一个 tauri-eeg 窗口。正式运行会消耗本次 BDF 保存确认，下次运行需要重新确认。串口写入成功只能证明软件完成发送；BDF 中的标记才用于确认实际接收。

硬件连接、空载测试和 ActiView 操作细节见 [BioSemi 操作指南](docs/biosemi-operation.md)。

### 3. 运行逐试次范式

1. 从实验设置点击“进入逐试次范式”。
2. 选择“个人校准”或“独立诱发”，填写被试 ID 和本次运行标识。
3. 检查素材库、试次预览及模式开关。正式运行应显示“正式 · 发送 Trigger”。
4. 点击“开始实验”，按页面呈现完成静息、提示、视频、视频后静息和 SAM 评分。
5. 按提示继续后续试次或“开始下一阶段”。完成后查看试次汇总。
6. 需要提前停止时，使用页面的提前结束操作，确认后本次运行会记录为中止。应用不会替你结束 ActiView 保存。

视频首帧播放、阶段转换和评分提交由流程记录事件，不需要手动反复发送测试码。

### 4. 使用独立视频调控

1. 打开“视频调控”。页面先读取独立播放器已记住的目录；首次进入时采用实验设置已保存的目录，没有保存路径则使用项目的 `video_paradigm`。
2. 点击“全部”浏览所有平静视频，或选择“治愈动画”“音乐”“风景”“声音放松”“日常影像”等实际存在的分类。
3. 在“搜索视频”中输入文件名、分类名或相对路径。
4. 点击对应文件的“播放”。点击关闭按钮或按 `Esc` 结束播放。
5. 更换目录时点击“选择视频根目录”，选择包含 `Calm` 子目录的根目录，不要直接选择 `Calm`。有可用平静视频的目录会被记住，下次进入自动恢复。

该页面单独保存目录选择，不改变实验设置的素材库。智能助手也使用当前加载的真实文件清单。

### 5. 生成与播放音乐

1. 打开“音乐调控”，选择标签并填写音乐描述，设置长度。
2. 点击“生成 WAV”。页面会尝试自动启动本地音乐服务。
3. 等待生成完成，选择曲目并播放。首次下载和加载模型可能需要较长时间。
4. 打开播放器的“生成记录”管理历史曲目。删除生成记录也会删除对应的本地 WAV 文件。

若提示音乐服务未就绪，可在项目根目录手动启动：

```powershell
Set-Location .\music-service
uv run python server.py
```

使用 CUDA 12.8 可选依赖组时，改用：

```powershell
uv run --extra cu128 python server.py
```

保持服务终端打开。在另一个终端检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

返回 `status: ready` 且 `modelLoaded: true` 后，再回到页面生成。应用会复用 `http://127.0.0.1:8000` 上已就绪的服务。

### 6. 完成效果评价

1. 在实验设置准备完成后进入“效果评价”。填写被试 ID、目标情绪、条件、调控方式和时长。
2. 点击“确认配置，开始诱发”，等待诱发素材预载完成，再点击“开始播放诱发视频”。
3. 诱发结束后完成 SAM 和 STAI-S、PANAS 前测。这份诱发后的测量在记录中标为 `baseline`。
4. 自然恢复条件点击“开始静息”；音乐条件选择曲目并播放；视频条件先“进入全屏准备”，素材就绪后点击“开始播放调控视频”。音乐和视频实际开始播放时才启动条件计时，预载和选择时间不计入。
5. 到达设定时长后，点击“结束静息，进行复测”或“结束调控，进行复测”，完成条件后量表。音乐调控的后测还包含 GEMS-9。
6. 查看本次结果。若需要提前结束条件，使用页面的跳过操作；本次结果会保留跳过标记。
7. 对同一被试和目标情绪分别完成自然恢复与调控条件后，查看跨条件比较。
8. 在结果区域导出单次或跨条件报告，或使用“批量汇总导出（CSV）”。

前后测改善率按 `(前测 - 后测) / 前测` 计算。界面的 10% 阈值是项目设置，不代表临床疗效标准。正式跨条件比较排除排练和中断运行。

页面重载会中断未完成的实验；应重置并创建新运行，不能补发旧事件来续接。每次正式运行前都要重新确认 ActiView 的 BDF 保存。

### 7. 关联 BDF 并导出实验日志

1. 完成或正常中止应用内的实验，然后结束 ActiView 的文件保存。
2. 返回“实验设置”的“实验记录”，点击“刷新记录”。
3. 根据被试、时间和运行 ID 找到记录，展开并检查模式及状态。
4. 对已停止的正式运行点击“关联 BDF 文件”，选择实际保存的文件。ActiView 拆分文件时，选择本次运行的全部 BDF。
5. 点击“导出实验日志”，选择目录，保存实验清单、事件表和试次记录。
6. 使用 ActiRead 或离线工具回读 BDF，核对事件码值、顺序和数量是否与日志一致。

效果评价报告用于查看量表结果；实验日志用于核对事件与试次，两者分别导出。

## 数据保存位置

| 数据 | 默认位置或选择方式 |
|---|---|
| 用户、量表及实验数据库 | `%LOCALAPPDATA%\tauri-eeg\users.sqlite3` |
| 生成的音乐 WAV | 默认应用数据根目录下的 `<用户目录>\music` |
| Windows 默认应用数据根目录 | `%APPDATA%\com.tauri-eeg.desktop` |
| 存储设置 | 应用数据目录下的 `storage-settings.json` |
| 视频素材 | `video_paradigm`，或页面选择的外部目录 |
| 原始 BDF | ActiView 中选择的保存路径 |
| 评价报告及实验日志 | 导出时选择的路径 |
| 模型缓存 | `HF_HOME` 指定的目录，模型缓存通常位于其 `hub` 子目录 |

通过侧边栏的“存储路径设置”可修改输出根目录。生成音乐按用户目录保存；该设置不改变用户数据库或 ActiView 的 BDF 保存位置。

## 常见问题

| 现象 | 处理方式 |
|---|---|
| 浏览器中无法选择视频、保存记录或控制 Trigger | 使用 `pnpm tauri dev` 启动桌面应用 |
| 视频调控页没有素材 | 检查所选根目录下是否有 `Calm` 及 MP4，确认选的是根目录而非 `Calm` |
| 正式实验无法进入或开始 | 检查连接、素材库和本次 ActiView 保存确认，处理页面列出的阻塞原因 |
| COM 端口访问被拒绝 | 关闭其他占用端口的窗口或程序，只保留一个应用窗口；必要时重新插拔触发盒 |
| 音乐服务未就绪 | 手动启动服务，检查 Hugging Face 登录和模型权限，等待 `/health` 返回就绪 |
| `WinError 10048` | 端口 8000 已被占用，确认是否为可复用的音乐服务 |
| `flash_attn` 未安装或 FastAPI 弃用提示 | 检查服务是否实际就绪；这些提示本身不等同于模型加载失败 |

## 构建与验证

在项目根目录运行前端测试和构建：

```powershell
pnpm test
pnpm build
```

检查 Rust 格式并运行后端库测试：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

运行音乐服务测试，临时添加测试工具而不修改项目依赖：

```powershell
Set-Location .\music-service
uv run --with pytest pytest
Set-Location ..
```

音乐模型集成测试是否执行真实推理，以测试中的环境条件为准。

浏览器流程检查需要 Playwright 与运行中的前端预览。以下例子从项目根目录开始：

```powershell
pnpm preview --host 127.0.0.1 --port 1432
```

保持预览运行，在另一个位于项目根目录的终端执行：

```powershell
$env:BIOSEMI_SMOKE_URL = "http://127.0.0.1:1432"
$env:VIDEO_REGULATION_SMOKE_URL = "http://127.0.0.1:1432"
node tests/biosemi-ui-smoke.cjs
node tests/video-regulation-ui-smoke.cjs
node tests/verify-real-regulation-library.cjs
```

浏览器测试模拟桌面命令，不会发送硬件脉冲。真实视频检查会读取本地 Calm 文件并验证一条 MP4 的播放，不能替代硬件 Trigger 与 BDF 接收测试。

## 项目结构

```text
src/                  页面、实验执行、量表、素材选择与音乐客户端
src-tauri/            桌面命令、触发盒控制、SQLite 与文件操作
music-service/        本地音乐生成与智能助手服务
video_paradigm/       按情绪和分类组织的视频素材
public/               页面静态资源
src-tauri/icons/      桌面应用图标
tests/               行为测试与浏览器检查脚本
docs/                 操作说明、素材要求和架构文档
```

## 相关文档

- [BioSemi 操作指南](docs/biosemi-operation.md)
- [Trigger 实现说明](docs/biosemi-trigger-implementation.md)
- [逐试次范式协议](docs/paradigm-protocol.md)
- [视频素材准备与选择](docs/video-library-requirements.md)
- [实验执行、报告与记录模块的职责](docs/architecture-execution.md)
