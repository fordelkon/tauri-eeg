# 实验验收

按改动要证明的事实选证据。涉及多层时分别记录结果和缺口。

| 要证明什么 | 完成证据 |
|---|---|
| 排练中的操作和反馈一致 | 从实际桌面入口复现。记录模式、操作前后的步骤、控件状态及可见回复。自动化可补查不同宽度、缩放和输入法。 |
| 实验状态机或日志正确 | 用可重复的时钟、媒体事件或 IPC 测试核对阶段、事件顺序及重复或中断后的结果。模块边界见[执行所有权](architecture-execution.md)。 |
| 流程标记到达设备 | 按[BioSemi 操作](biosemi-operation.md)和[触发码规范](biosemi-trigger-implementation.md)核对正式运行。排练不发送流程标记；显式发送测试码 254 是单独的设备测试。 |
| 标记确实写入某次采集 | 记录对应 run，回读 ActiView 保存的 BDF Status，与应用日志的码值、顺序和数量逐一对应。界面显示已连接、模拟 IPC 成功和另一种范式的历史结果都不能替代本次 BDF。 |

按问题查阅[正式实验流程](formal-session-protocol.md)、[三时点情绪自评](momentary-assessment.md)、[逐试次 SAM](scale-instruments.md)或[视频素材要求](video-library-requirements.md)。涉及真实采集时，使用已获授权的设备与测试数据。
