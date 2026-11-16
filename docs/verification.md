# 实验验收

按改动要证明的事实选证据。涉及多层时分别记录结果和缺口。

| 要证明什么 | 完成证据 |
|---|---|
| 发行版只提供正式采集 | 对 `pnpm tauri build` 产物检查两个实验入口，核对已有排练偏好不能启用排练。未确认正式录制时无法开始，未完成的量表不能通过，刺激期间的排练快捷键无效。实验仍可中止。 |
| 开发版排练中的操作和反馈一致 | 从实际桌面入口复现。记录模式、操作前后的步骤、控件状态及可见回复。自动化可补查不同宽度、缩放和输入法。 |
| 实验状态机或日志正确 | 用可重复的时钟、媒体事件或 IPC 测试核对阶段、事件顺序及重复或中断后的结果。模块边界见[执行所有权](architecture-execution.md)。 |
| 流程标记到达设备 | 按[BioSemi 操作](biosemi-operation.md)和[触发码规范](biosemi-trigger-implementation.md)核对正式运行。排练不发送流程标记；显式发送测试码 254 是单独的设备测试。 |
| 标记确实写入某次采集 | 记录对应 run，回读 ActiView 保存的 BDF Status，与应用日志的码值、顺序和数量逐一对应。界面显示已连接、模拟 IPC 成功和另一种范式的历史结果都不能替代本次 BDF。 |

按问题查阅[正式实验流程](formal-session-protocol.md)、[三时点情绪自评](momentary-assessment.md)、[逐试次 SAM](scale-instruments.md)或[视频素材要求](video-library-requirements.md)。涉及真实采集时，使用已获授权的设备与测试数据。

为核对发布页面，可在构建后执行 `pnpm exec vite preview --port 1421`，并在另一终端运行 `node tests/biosemi-ui-smoke.cjs --release`。脚本使用 Edge 和模拟设备，检查旧排练偏好、正式录制前置条件及第一次 DEQ 填写。用 `cargo test --manifest-path src-tauri/Cargo.toml --lib --features tauri/custom-protocol` 核对发布协议的后端限制。
