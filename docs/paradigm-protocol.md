# 范式协议与文献依据（Paradigm Protocol）

> 本文档是范式大流程中每个参数的科学依据登记表。代码中涉及这些参数的位置以注释指向本文档。
> 标注约定：**[文献]** = 有直接文献依据；**[适配]** = 文献模板 + 本项目对视频/临床场景的适配值；**[工程]** = 工程默认值，可配置，无文献约束；**[大纲]** = 项目实验大纲（S-04/R8）规定。

## 1. 范式大流程总览（效果评价管线）

```
配置(被试/情绪/手段/条件/时长) → 诱发前量表[pre_induction] → 情绪诱发(视频) → 诱发后量表[baseline]
→ 条件执行(自然恢复 | 调控[音乐/视频]) → 条件后量表[post] → 各情绪诱发期间变化与条件期间变化
```

以下研究提供情绪诱发与调控的实验设计参考。
- **认知重评训练范式**：Li X. et al. (2024). Decoded EEG neurofeedback-guided cognitive reappraisal training for emotion regulation. *Cognitive Neurodynamics*, 18(5):2659（42 人；passive view / self-regulation 成对 block + 个体化解码反馈）。
- **EEG+音乐焦虑调控闭环**：Li J. et al. (2025). An anxiety regulation framework with a positive emotion-guided strategy. *Biological Psychology*, 201:109132（随机交叉设计）。

## 2. 参数对照表

### 2.1 情绪诱发环节

| 参数 | 值 | 依据 |
|---|---|---|
| 诱发素材 | 标准化视频库（Anxiety/Depression/Calm/Fear，各 ≥5 个，终态 50/类） | [文献] 视频是情绪诱发的标准载体：Gross & Levenson (1995). Emotion elicitation using films. *Cognition & Emotion*, 9(1):87–108；素材库常模化：Somarathna et al. (2024). EmoStim. *IEEE TAC*；Duan et al. (2023). 中国标准化情绪短视频库. *PLOS ONE* 18(3):e0283573。数量梯度见 docs/video-library-requirements.md **[大纲]** |
| 单段视频时长 | 45–90 s（越界自动判 artifact_rejected） | [适配] Gross & Levenson 建议片段足够长以诱发并稳定情绪；EmoStim 片段 40–100 s 区间。本项目按 45–90 s 强制 |
| 试次内时序（范式采集） | 静息基线 5 s → 提示 2 s → 视频 → 试后静息 5 s → SAM | [适配] 基线/试后静息为 ERP 与频谱分析的标准化窗口；Li et al. 2024 试次含 ISI 抖动防期望 |
| SAM 自评 | 效价/唤醒/支配 1–9 | [文献] Bradley & Lang (1994). Self-Assessment Manikin. NIMH 技术报告；SAM 与国际情感图片系统( IAPS )配套效度 |

### 2.2 量表与测量时点

| 参数 | 值 | 依据 |
|---|---|---|
| 量表时点 | 诱发前、诱发后、条件后各一次 | [适配] T1 同时作为诱发终点及条件起点。 |
| [效果评价量表](momentary-assessment.md) | 三次均填写 DEQ 焦虑、悲伤、恐惧三个分量表，各 4 项，1–7 分 | [文献] 原作者支持按研究问题选取完整分量表。中文词表及「此刻」指导语为研究适配。 |
| 主要结果 | 三个分量表分别取平均，报告 T1 − T0 与 T2 − T1 | [适配] 对应素材类别的目标情绪预先指定；分差描述单次自报强度变化。 |

### 2.3 条件执行（调控/自然恢复）

| 参数 | 值 | 依据 |
|---|---|---|
| 条件类型 | natural_recovery（基线对照）/ regulation（音乐或视频调控） | [文献] 自然恢复作为对照条件：情绪的时间衰减基线（Delgado et al. 2008 一类 reactivity/recovery 研究）；音乐/视频作为调控手段：Li J. 2025（音乐调控）；Ehrlich et al. (2019). A closed-loop, music-based BCI for emotion mediation. *PLOS ONE* 14(2):e0213516 |
| 调控时长 | 可选 1、3、5、10、15 或 30 min；自然恢复默认 1 min，调控默认 5 min | [工程] 无单一文献标准。参考：单次音乐治疗干预通常 20–60 min（Gold et al. 2009 综述），实验内单条件窗常用 3–10 min；默认值取实验室可行性，**正式实验前应在预注册中固定** |
| 调控素材 | 音乐：Stable Audio 预生成曲目；视频：调控素材库 | [文献] 音乐参数-情绪映射（tempo/响度→arousal，调式/音区→valence）：Gomez & Danuser (2007). *Biological Psychology*, 75(3):323–334；iso principle（先匹配后引导）：Heiderscheit & Madson (2015) 综述 |
| 比较调控与自然恢复 | 匹配条件时长，比较每个条件的 T2 − T1 | [设计建议] 各条件单独运行，各自保留三次评分。 |

### 2.4 旧闭环调控反馈设计，已退出当前实现

| 参数 | 值 | 依据 |
|---|---|---|
| 试次结构 | 提示 2 s → 重评窗 24 s（无反馈）→ 间歇反馈 2 s → SAM | [文献+适配] Li X. et al. 2024：cue 2 s、调控窗 4–5 s（图片范式）、反馈 2 s；本项目按视频范式将调控窗适配为 24 s |
| 间歇式反馈 | 每 trial 末 2 s，重评期间无反馈 | [文献] Hellrung et al. (2018). *NeuroImage*, 166:195–203（N=54，间歇式优于持续式）；Li X. et al. 2024 同设计 |
| 反馈形式 | 双横条：观看时接近度（灰）vs 调控后接近度（彩）+ Δ 徽章 | [文献] Li X. et al. 2024 的 dual-bar 设计；目标接近度 + 基线归一化源自 DecNef：Shibata et al. (2011). *Science*, 334:1413–1415 |
| 反馈分数 | R = p(目标\|调控段) − p(目标\|观看段)，学习指数 L1 = 均值 | [文献] Li X. et al. 2024 的学习指标定义 |
| 反馈值来源 | 旧模拟解码器与旧 EEG 服务已删除；当前仅发送 BioSemi trigger 并离线分析 BDF | 该表仅保留原研究设计背景，不描述现有功能 |
| 对照（规划中） | yoked/回放假反馈 vs 真反馈 | [文献] Ros et al. (2020) CRED-NF 报告规范；《Rethinking control conditions in clinical neurofeedback trials》(2026) 推荐 yoked/replay 优先 |

## 3. 无设备模式（试运行）

开发版的效果评价与逐试次范式在排练模式下不连接触发盒、不发送硬件事件，但保存实验日志与量表：

- 效果评价保留诱发前自评、诱发、诱发后自评、条件执行、条件后自评和结果。
- 逐试次入口只提供个人校准与独立誘发，保留静息、提示、视频、SAM 和质量标注。
- 正式模式要求连接 BioSemi Trigger Interface，并由操作者确认 ActiView 已开始保存 BDF。排练记录带有模式标记，正式数据分析时按模式筛选。

## 4. 已知局限（写论文前需处理）

1. DEQ 中文词表与「此刻」指导语需在目标人群中验证，包括可理解性、区分不同情绪的表现和对变化的敏感度。
2. 自然恢复与调控的默认时长不同，正式比较条件时需在设计中固定相同的观察时间。
3. 调控反馈的模拟反馈数据不可用于科学结论，仅用于流程验证。
