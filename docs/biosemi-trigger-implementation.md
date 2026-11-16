# BioSemi trigger 与离线 BDF 改造实现规格

自然恢复已有[硬件标记的实测 BDF 样例](formal-session-protocol.md#42-触发码时间线)。其他条件和物理刺激时序需分别取证。

以下区分已确认的设备边界、当时的方案与现行实现。建议方案不代表用户已经确认。第 9 节列出软件检查与需要实际采集的证据。

## 1. 目标与边界

已确认的需求：

- 设备使用 BioSemi USB Trigger Interface，在 Windows 中显示为 COM 串口。
- 采集软件使用 ActiView 8.14。
- 本应用呈现刺激并发送 trigger。ActiView 采集脑电并保存 BDF，之后离线分析。
- 旧设备的采集逻辑没有适配用户设备，需要移除或替换。
- 保留现有视频调控、音乐调控及实验评价能力。

本文不要求本应用读取实时 BioSemi 数据、生成 BDF、远程控制 ActiView，或实现在线脑电解码。软件实现后的操作步骤见 [BioSemi 实验操作说明](biosemi-operation.md)。

各方案的适用条件如下。

| 项目 | 本文建议 | 实施时处理 |
|---|---|---|
| 打标范围 | 诱发、调控和自然恢复均记录阶段边界 | 实验计划固定后冻结，不能运行中切换 |
| 时间精度 | 首期服务于整段离线分析 | ERP 使用前另做物理刺激时序验证 |
| 中途暂停 | 正式实验默认禁用任意暂停、跳播和切换素材 | 必须操作时记录异常，不当作完整实验 |
| 逐试次入口 | 将个人校准、独立诱发迁到实验范式页 | 保留其流程，不保留旧采集依赖 |
| 模拟反馈 | 从正式实验入口移除，演示功能单独隔离 | 不自动改写为另一种科研范式 |

用户已授权按本文实现。当前软件采用诱发与条件均打标、整段离线分析、运行中固定素材的方案。ERP 精度仍未验证。逐试次类型与旧记录中保留历史反馈定义，但新实验入口仅提供个人校准与独立诱发。

### 1.1 已实现位置

- `src/experiment/api.ts` 与 `settings.ts` 提供独立实验接口和每次运行的外部保存确认。
- `src/pages/home/ExperimentSettings.tsx` 提供串口连接、测试、素材库和模式设置。
- `src/experiment/ExperimentRunHistory.tsx` 提供 BDF 关联与日志导出。
- `src-tauri/src/experiment/` 提供单线程串口输出、实验持久化和事件校验。
- `src/pages/home/effectEvaluationExecution.ts` 接入效果评价；`src/ui/videoFrameOnset.ts` 在播放器首次 `playing` 时经 `requestVideoFrameCallback` 检测首次呈现帧，以首帧（`html_video_frame`）或标注后备（`html_video_playing`）打标并启动条件计时。
- `src/paradigm/paradigmExperiment.ts` 与 `useIndependentParadigmRun.ts` 接入逐试次流程。
- 旧采集页面与前后端设备通信运行代码已删除，旧 `/eeg-acquisition` 路由已移除。

以下第 2 节记录现行范式与实现契约。

## 2. 当前范式设计

### 2.1 效果评价流程

代码入口为 [EffectEvaluation.tsx](../src/pages/home/EffectEvaluation.tsx)，流程控制为 [useEffectEvaluationFlow.ts](../src/pages/home/useEffectEvaluationFlow.ts)，状态与参数为 [effectEvaluationFlow](../src/pages/home/effectEvaluationFlow/index.ts)。

| 步骤 | 当前行为 | 改造时保留的内容 |
|---|---|---|
| 选择被试 | 配置被试、目标情绪、条件、调控手段和时长 | 被试与实验参数 |
| 诱发前量表 | 影片播放前填写 12 个 DEQ 情绪词 | 记录起始状态，开始和提交仅写软件日志 |
| 情绪诱发 | 按焦虑、抑郁或恐惧选择诱发视频 | 素材与呈现流程 |
| 诱发后量表 | 再次填写相同的 12 个情绪词 | 题目、评分和原始答案 |
| 条件执行 | 自然恢复，或音乐调控，或视频调控 | 条件类型与时长 |
| 条件后量表 | 第三次填写相同的 12 个情绪词 | 同一运行的三时点评分 |
| 结果评价 | 报告三种情绪的三次均分，分别列出诱发与条件期间的变化 | 结果与导出能力 |

自然恢复默认 1 分钟，音乐和视频调控默认 5 分钟，可选时长为 1、3、5、10、15、30 分钟。一个 run 只执行一个条件。三时点评分与报告口径见[正式实验流程](formal-session-protocol.md)。

`baseline` 在该流程中表示“诱发后、干预前的量表”，不是逐试次范式中的静息脑电基线。报告与事件日志必须保留这个语义区别。

实验事件从实际刺激边界开始记录，外部 BDF 由 ActiView 保存。正式模式要求触发盒和 BDF 保存确认，排练模式不发送硬件事件。

### 2.2 视频与音乐的实际播放方式

改造前，准备按钮可早于实际播放启动计时，历史查询和选曲可能占用调控窗口。现在由[步骤面板](../src/pages/home/EffectStepPanels.tsx)把呈现回调交给活动 run：

- 诱发与调控视频在首个呈现帧打标；无法观察首帧时使用标明来源的 `playing` 后备。视频循环不重复打标。
- 音乐从[播放器](../src/pages/home/EffectRegulationPlayer.tsx)首次有效播放起打标、计时，预载、查历史和选曲不计入调控窗口。
- 普通素材试听不应自动产生正式实验 trigger。软件时点与设备物理呈现的验收区别见第 7、9 节。

### 2.3 逐试次范式

入口为 [ParadigmSessionPanel.tsx](../src/paradigm/ParadigmSessionPanel.tsx)。会话类型、队列和时序分别见 [paradigmSessionKinds.ts](../src/paradigm/paradigmSessionKinds.ts)、[domain.rs](../src-tauri/src/paradigm/domain.rs)、[paradigmTimeline.ts](../src/paradigm/paradigmTimeline.ts)。

| 类型 | 当前队列 | 当前定位 |
|---|---|---|
| `personal_calibration` | 平静类 5 个试次 | 个人校准材料采集 |
| `held_out_generation` | 焦虑、抑郁、恐惧依次成块，每类 5 个试次 | 独立情绪诱发 |

每个类别的视频池至少需要 5 个 MP4。块顺序固定，块内素材按实验编号产生的种子打乱并选取。当前类别为平静、焦虑、抑郁和恐惧。

普通试次时序为：静息基线 5 秒 → 提示 2 秒 → 视频 45–90 秒 → 试后静息 5 秒 → SAM → 质量确认。

视频时长越界会判为 `artifact_rejected`。SAM 与操作者标注产生 accepted、uncertain、rejected 等质量结果。这些结果表示呈现与自评规则，不能代替离线 EEG 伪迹检查。

当前流程没有在线脑电反馈。BDF 只在实验结束后离线分析。

### 2.4 现有采集与 trigger 的限制

| 代码 | 当前作用 | 与 BioSemi 方案的关系 |
|---|---|---|
| 旧 `protocol.rs`，已删除 | 固定 32 通道、自定义网络帧解析 | 不是 BioSemi 协议 |
| 旧 `server.rs`，已删除 | TCP 数据接收与 UDP 启动指令 | 不能用于 COM trigger 输出 |
| 旧 `paradigm_controller.rs`，已删除 | 在内部采集会话中记录试次、软件标记与样本范围 | 已替换为独立实验记录 |
| `src-tauri/src/experiment/` | 实验 run、事件、试次、量表关联和 BDF 导出 | 当前持久化实现 |

事件记录和串口连接状态由 `src-tauri/src/experiment/` 单独负责。

## 3. 改造后的运行方式

```mermaid
flowchart LR
    P[本应用呈现视频或音乐] --> E[实验事件]
    E --> T[独立串口发送线程]
    T --> U[BioSemi USB Trigger Interface]
    U --> R[BioSemi Receiver trigger 输入]
    R --> A[ActiView 8.14]
    A --> B[连续 BDF 与 Status 通道]
    E --> L[本地实验记录与事件日志]
    B --> O[离线切段与分析]
    L --> O
```

操作者先在 ActiView 启动 BDF 保存，再在本应用确认“外部录制已开始”。本应用只保存操作者确认时间，不推断 ActiView 正在保存。

建议一次完整效果评价流程对应一个 BDF。若连续记录多次实验，记录多对 run 开始与结束标记，并用日志中的编号、次序和条件匹配。BDF 文件分卷时允许一个实验关联多个文件。

实验结束后操作者停止 ActiView 保存，补充实际 BDF 文件名或文件列表。本应用不删除、覆盖或搬移原始 BDF。

## 4. 页面与模块边界

将旧“EEG 采集”入口替换为“实验设置”，包含素材库、Trigger 设置与外部记录信息。逐试次运行入口迁到独立的“实验范式”页。

Trigger 设置显示 COM 端口、刷新、连接、断开、测试与最近发送结果。状态文案使用“触发盒已连接”“发送失败”。不显示“BioSemi 已连接并录制”或“BDF 已保存”，除非明确标注为操作者确认。

排练仅在开发版开放。正式模式要求触发盒连接、素材就绪和外部保存确认。排练不发硬件 trigger，记录 `rehearsal`，不能在运行中静默降级。

实验接口与设置在 `src/experiment/`，队列、呈现、SAM 与质量标注在 `src/paradigm/`，素材工具在 `src/video/`。串口输出由 [Rust 实验 worker](../src-tauri/src/experiment/worker.rs) 持有，记录与导出在同一实验模块内。

原 `/eeg-acquisition` 路由、内部 EEG 写入、旧 TCP/UDP 接收、原 `eeg-service/` 及其代理动作已移除。素材管理、量表、试次和音乐生成仍通过各自模块使用。

## 5. Trigger 输出契约

官方接口使用 115200 波特率、8 数据位、1 停止位、无校验、无流控，接收一个二进制字节并默认维持 8 ms 后归零。接口输出 8 位事件值。详见文末官方资料。

Rust worker 使用 `serialport` 库，由专用线程保持 Windows COM 连接并执行阻塞读写。串口线程不在 UI 或呈现回调中等待。

接口职责为：列出端口、连接、查询状态、测试、断开、接收实验事件。生产入口根据已注册事件推导事件码，不接受任意网页传来的原始命令字节。正式实验中禁止测试和修改串口配置。

发送 `[code]` 一个字节，不发送十进制字符串、换行或 JSON。正常事件不额外发送 0，也不修改触发盒脉冲长度。

一个串口仅由一个线程持有。多个播放器不直接访问端口。后端根据活动 run、事件 ID、素材与阶段核对请求，避免旧页面和异步回调向新实验发送标记。

建议以 12 ms 的最小相邻发送间隔给默认 8 ms 脉冲留出低电平间隙。12 ms 是待硬件验证的工程初值，不是厂商保证。若设备脉冲设置被更改，该值必须重新校验。记录排队等待，不把延迟发送时间伪装为刺激开始时间。

开始 run 的标记发送后再允许启动刺激，避免初始化事件与刺激开始事件挤在同一脉冲窗口。使用有界队列，满队列或日志写入失败均显式报错，不能悄悄丢标。

`written` 只表示操作系统接受了串口写入，不表示 BioSemi 收到或 ActiView 已保存。此接口方案不提供端到端接收确认。

## 6. 建议事件编码表

表名为 `biosemi_events_v1`，属于待冻结的项目编码，不是 BioSemi 预定义事件协议。每个非零码代表一个事件，0 留作空闲。当前情绪码为抑郁 1、焦虑 2、平静 3、恐惧 5。

| 十进制码 | 事件 | 触发时点 |
|---|---|---|
| 1 | depression_video_start | 抑郁诱发首次播放 |
| 2 | anxiety_video_start | 焦虑诱发首次播放 |
| 3 | calm_video_start | 平静校准首次播放 |
| 5 | fear_video_start | 恐惧诱发首次播放 |
| 10 | induction_video_end | 诱发视频正常结束 |
| 20 | baseline_rest_start | 逐试次静息基线开始 |
| 21 | hint_start | 逐试次播放提示开始 |
| 22 | post_rest_start | 逐试次试后静息开始 |
| 23 | baseline_rest_end | 逐试次静息基线结束 |
| 24、25 | reappraisal_start、reappraisal_end | 重评窗口边界，保留码 |
| 31、32 | music_regulation_start、music_regulation_end | 音乐调控窗口边界 |
| 41、42 | video_regulation_start、video_regulation_end | 视频调控窗口边界 |
| 51、52 | natural_recovery_start、natural_recovery_end | 自然恢复窗口边界 |
| 60、61 | run_start、run_end | 正式实验开始与正常结束 |
| 70、71 | pre_scale_start、pre_scale_submit | 诱发后量表打开与保存成功 |
| 72、73 | post_scale_start、post_scale_submit | 条件后量表打开与保存成功 |
| 74、75 | sam_start、sam_submit | 独立试次 SAM 打开与保存成功 |
| 80、81 | media_pause、media_resume | 允许暂停的实验异常或恢复 |
| 82 | media_change | 允许更换素材时记录 |
| 90 | playback_error | 播放故障且串口仍可用 |
| 91 | run_abort | 操作者中止且串口仍可用 |
| 92 | trial_skip | 试次被跳过且串口仍可用 |
| 93、94 | trial_start、trial_end | 独立试次刺激阶段边界；94 在本试次 SAM 开始（74）之前 |
| 254 | trigger_test | 运行前单独手动发送，不能替代正式流程验证 |

量表标记可在最终实验计划中选择只写软件日志。事件码不承载被试、素材或试次编号；这些字段写入日志。该关联依赖事件次序及完整性，丢标或多标时必须报告匹配不确定，不能继续按次序强行配对。

逐试次由试前静息转入提示时发送 23；24、25 仅预留，当前正式流程不发送。模拟反馈正式入口已关闭。普通试听、播放器循环以及 React 重渲染不重复发送阶段开始码。若将来需要逐循环分析，新增独立事件与编码版本，不复用开始码。

## 7. 播放、计时与去重规则

### 7.1 视频

先加载素材并进入准备状态。首次有效播放事件报告 `software_video_onset`，发送对应 trigger，并启动同一阶段的计时。打标以首次呈现帧为目标：`playing` 时通过 `requestVideoFrameCallback` 注册首帧回调，检测到首帧后以 `html_video_frame` 来源发送，`details.onset` 记录 `source: video_frame` 与 `playing→首帧` 的 `deltaMs`；WebView2 不支持该回调或 500 ms 内未呈现首帧时降级为 `playing` 后备，来源标注 `html_video_playing`（`source: playing_fallback`）。同一次播放只发送一个开始事件，帧检测与后备不产生第二个码。

该检测是软件时点，不等于显示器真实亮起。不得承诺首帧与脉冲严格同时，日志保存呈现检测与串口写入两个时间。

诱发正常结束发送 10。调控视频在指定时间到达时停止并发送 42。调控视频循环不再次发送 41。未达到首次有效播放便失败的素材不写开始事件，只记录播放故障与未呈现状态。

### 7.2 音乐

在调控计时前选择曲目，完成文件可用性检查和预加载。首次有效播放报告 `software_audio_onset`，发送 31 并开始调控计时。音频生成、历史查询与选曲等待不计入调控窗口。

到时暂停音频并发送 32。短曲循环不重复发送 31。播放事件不等于耳机实际出声，ERP 精度验证与音频设备延迟另行测量。

正式流程默认固定素材并禁止自由切歌、跳播、倍速和任意暂停。若方案允许暂停，暂停不延长已启动的墙钟窗口，分别记录实际播放与中断时长；这种时长政策须在实验开始前固定。

### 7.3 自然恢复与结束

自然恢复无媒体准备，静息界面进入后发送 51 并计时，到时发送 52。计时使用单调时钟计算经过时长，显示刷新不决定阶段结束。

条件后评分保存并提交后发送 61，关闭 run。开发版排练可提前结束条件，记录跳过标记后进入条件后测量。发生中断时保留实际收到的事件。

### 7.4 去重与故障

每个事件带唯一 `eventId`，每个阶段带 `phaseInstanceId`。同一次阶段的首次播放只能产生一个开始事件。暂停后的播放是 resume；程序重新挂载不能产生第二个 start。

去重在后端以持久化事件 ID 执行。写串口前保存事件意图，写后更新结果。若程序在写入与结果保存之间崩溃，结果标为 `unknown`，不自动重发。串口与数据库之间无法实现原子提交，不能声称硬件 exactly-once。

正式运行遇到 trigger 故障时停止当前刺激并记录当前段异常，进入中断状态。操作者可在排除故障后开始新的 run。不能自动重连后补发旧开始码；补发会改变离线切段含义。

## 8. 实验记录与旧数据迁移

新增独立的 `experiment_runs`、`experiment_events` 与 `experiment_trials` 表。新试次不再外键关联内部 `eeg_sessions`，不在呈现软件中填写虚构的 EEG 样本索引。

| 记录 | 必需字段 |
|---|---|
| Run | 唯一 runId、userId、subjectId、流程类型、目标情绪、条件、手段、计划时长、素材清单、协议版本、编码版本、正式或排练模式、状态、起止时间 |
| 外部录制关联 | ActiView 版本、操作者保存确认时间、预期记录名、实际 BDF 文件列表、关联状态 |
| Event | eventId、runId、顺序号、trialId、phaseInstanceId、事件名、事件码、素材 ID、软件时点及来源、后端接收时间、串口写入起止时间、结果与错误原因 |
| Trial | 队列位置、情绪、素材、呈现状态、起止事件 ID、SAM、质量标注与原因 |
| 量表关联 | runId、量表记录 ID、测量时点与条件 |

时间日志同时记录 UTC 墙钟时间与相对当前 run 的单调时间。前端单调时钟和 Rust 时钟原点不同，保存各自来源，不直接相减。后端计算排队时间，前端计算播放窗时长。离线脑电时间轴以 BDF 样本为准。

事件结果区分仅软件记录、排练未发送、等待发送、串口写入成功、失败和未知。未知与失败影响 run 完整性。数据写入到应用管理目录，导出 `manifest.json`、`events.tsv` 与试次表，清单包含全部编码定义和实际 BDF 关联信息。

DEQ 量表记录保存时即关联当前实验 run 和测量时点。

效果报告按 run ID 关联诱发前、诱发后、条件后三份 DEQ 记录，展示三个分量表的均分及两段变化。

只依据软件日志可判断播放、计时和发送完整性。没有检查 BDF 时不能声称脑电完整或无伪迹。

## 9. 软件回归与硬件验收

| 软件行为 | 验收依据 |
|---|---|
| 素材与独立范式可在排练运行，保留原素材路径、队列与呈现时序 | [素材库加载](../tests/paradigm/materialLibraryLoader.test.ts)、[范式状态机](../tests/paradigm/paradigmExecution.test.ts)；正式运行与素材管理无需启动旧 EEG 服务。 |
| 串口故障与重复事件可观察；正式 run 中禁止发送测试码 | [实验 worker 测试](../src-tauri/src/experiment/tests.rs)断言实际写出的字节和错误状态。端口被占用、物理拔出与 BDF 入标还须设备验证。 |
| 音乐等待不计时；开始码只发一次，到时结束；中断、重挂载不补发 | [效果评价执行测试](../tests/effect/effectEvaluationExecution.test.ts)；实际声画与脉冲的延迟需现场测量。 |
| 同一 run 的三时点评分、试次与日志可追溯；缺失 BDF 有明确状态 | [记录与导出测试](../src-tauri/src/experiment/records_tests.rs)、[效果报告测试](../tests/effect/effectResultReports.test.ts)。增量数据库迁移必须可重复，不改写已有记录含义。 |

原 `beginEegTrial`、`markEegTrial`、`endEegTrial` 已由独立生命周期替代。移除旧采集依赖的边界是正式实验与素材管理可独立运行，音乐生成和既有量表计算保持可用。

硬件验收由实际设备完成：

1. 在 ActiView 开始保存短 BDF。应用内的连接测试只发送 254；逐位测试 1、2、4、8、16、32、64、128 需另用专用测试工具，不能在正式 run 中发送任意字节。
2. 检查 BDF Status 的低 8 位事件值和归零间隔。高位含其他触发及状态信息，不将整个 Status 值当作本项目事件码。
3. 在短测试序列中覆盖全部正式事件码，核对码值、数量、次序和日志，排除丢标、多标与相邻脉冲合并。
4. 完成一次视频调控和一次音乐调控；若保留自然恢复比较，再完成一次自然恢复。确认 BDF 切段与事件清单对应。
5. 测试拔掉触发盒、播放失败、提前结束和重启，确认异常结果不显示为正常完成，不重放旧 trigger。
6. 保存实际延迟测量、设备与音频配置、脉冲设置和验收结果。

软件测试不能代替硬件验收。应用核验 BDF 文件结构；Status 值、次序和脉冲归零须离线回读，保留本次核对记录。

ERP 使用前，以光电或音频检测测量刺激实际呈现与 trigger 的偏差及抖动，按最终科研方案定义可接受阈值。仅靠 `playing` 回调或串口写入成功不足以通过 ERP 验收。

## 10. 资料与证据

- [现有范式协议](paradigm-protocol.md)：流程、时长、量表与文献依据。它包含实时反馈规划，不能把规划当作已实现硬件能力。
- [离散情绪自评](momentary-assessment.md)与[逐试次 SAM](scale-instruments.md)。
- [BioSemi USB Trigger Interface 官方说明](https://www.biosemi.com/faq/USB%20Trigger%20interface%20cable.htm)：串口设置、二进制字节、8 位输出与默认脉冲。
- [BioSemi trigger 与 Status 官方说明](https://www.biosemi.com/faq/trigger_signals.htm)：Status 记录与物理刺激时序验证。
- [serialport-rs 官方仓库](https://github.com/serialport/serialport-rs)：Windows 串口与阻塞读写。已通过 Context7 核对配置；实施时固定实际采用版本。

本机实测的型号、采样率与 COM 端口见[设备操作记录](biosemi-operation.md)。下一次采集以本次 BDF 和实际连接为准，不套用历史实测值或旧后端的 32 通道、1000 Hz。
