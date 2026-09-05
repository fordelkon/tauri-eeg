# 范式协议与文献依据（Paradigm Protocol）

> 本文档是范式大流程中每个参数的科学依据登记表。代码中涉及这些参数的位置以注释指向本文档。
> 标注约定：**[文献]** = 有直接文献依据；**[适配]** = 文献模板 + 本项目对视频/临床场景的适配值；**[工程]** = 工程默认值，可配置，无文献约束；**[大纲]** = 项目实验大纲（S-04/R8）规定。

## 1. 范式大流程总览（效果评价管线）

```
配置(被试/情绪/手段/条件/时长) → 情绪诱发(视频) → 诱发后量表[baseline]
→ 条件执行(自然恢复 | 调控[音乐/视频]) → 条件后量表[post] → 结果评价(改善率)
```

该"诱发 → 前测 → 干预/调控 → 后测 → 量化改善"的骨架与两条文献路线同构：
- **认知重评训练范式**：Li X. et al. (2024). Decoded EEG neurofeedback-guided cognitive reappraisal training for emotion regulation. *Cognitive Neurodynamics*, 18(5):2659（42 人；passive view / self-regulation 成对 block + 个体化解码反馈）。
- **EEG+音乐焦虑调控闭环**：Li J. et al. (2025). An anxiety regulation framework with a positive emotion-guided strategy. *Biological Psychology*, 201:109132（随机交叉设计，NF 组 STAI 下降 d=1.05、SAM 效价提升 d=0.63）。

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
| 量表时点 | 诱发后（phase=baseline）、条件后（phase=post）两次 | [文献] 前测-后测设计是情绪干预效果评估的标准范式（Li J. 2025 同款时序）；baseline 语义 = "诱发后、条件前"，即干预的起点状态 |
| 量表内容 | 前后测：**STAI-S + state-PANAS**（"此刻"指令）；筛查：**PHQ-4**（"过去两周"，仅基线一次）；操纵检验：SAM；音乐条件后：GEMS-9。详见 **docs/scale-instruments.md** | [文献] state/trait 区分与前测-后测惯例：Spielberger (1983)；Li X. et al. 2024（PHQ-9/GAD-7 rated once，前后测用 state-PANAS）；Li J. 2025（STAI + SAM 效价）。旧自编 3 题"最近一周"量表已废弃（trait 窗口误用于分钟级前后测） |
| 改善率口径 | `(baseline − post) / baseline`，逐维度 + 均值 | [适配] 降分=改善的相对变化率；与跨条件对比口径 `(B_post − T_post)/B_post` 一致（scale_records.rs 实现） |
| 有效阈值 | 均值改善 ≥ 10% 判定有效 | [大纲] 项目自定义阈值（scale_records.rs `DEFAULT_IMPROVEMENT_THRESHOLD`）。**无直接文献依据**，属预注册前需明确的工程判定线 |

### 2.3 条件执行（调控/自然恢复）

| 参数 | 值 | 依据 |
|---|---|---|
| 条件类型 | natural_recovery（基线对照）/ regulation（音乐或视频调控） | [文献] 自然恢复作为对照条件：情绪的时间衰减基线（Delgado et al. 2008 一类 reactivity/recovery 研究）；音乐/视频作为调控手段：Li J. 2025（音乐, STAI d=1.05）；Ehrlich et al. (2019). A closed-loop, music-based BCI for emotion mediation. *PLOS ONE* 14(2):e0213516 |
| 调控时长 | 1–30 min 可配，默认 5 min | [工程] 无单一文献标准。参考：单次音乐治疗干预通常 20–60 min（Gold et al. 2009 综述），实验内单条件窗常用 3–10 min；默认值取实验室可行性，**正式实验前应在预注册中固定** |
| 调控素材 | 音乐：Stable Audio 预生成曲目；视频：调控素材库 | [文献] 音乐参数-情绪映射（tempo/响度→arousal，调式/音区→valence）：Gomez & Danuser (2007). *Biological Psychology*, 75(3):323–334；iso principle（先匹配后引导）：Heiderscheit & Madson (2015) 综述 |
| 跨条件对比 | 同被试同情绪、每条件最近一次完整 run，`(B_post − T_post)/B_post` | [适配] 被试内条件对比（Li J. 2025 随机交叉设计同思路） |

### 2.4 闭环调控反馈（ParadigmSessionKind::RegulationFeedback，试运行）

| 参数 | 值 | 依据 |
|---|---|---|
| 试次结构 | 提示 2 s → 重评窗 24 s（无反馈）→ 间歇反馈 2 s → SAM | [文献+适配] Li X. et al. 2024：cue 2 s、调控窗 4–5 s（图片范式）、反馈 2 s；本项目按视频范式将调控窗适配为 24 s |
| 间歇式反馈 | 每 trial 末 2 s，重评期间无反馈 | [文献] Hellrung et al. (2018). *NeuroImage*, 166:195–203（N=54，间歇式优于持续式）；Li X. et al. 2024 同设计 |
| 反馈形式 | 双横条：观看时接近度（灰）vs 调控后接近度（彩）+ Δ 徽章 | [文献] Li X. et al. 2024 的 dual-bar 设计；目标接近度 + 基线归一化源自 DecNef：Shibata et al. (2011). *Science*, 334:1413–1415 |
| 反馈分数 | R = p(目标\|调控段) − p(目标\|观看段)，学习指数 L1 = 均值 | [文献] Li X. et al. 2024 的学习指标定义 |
| 反馈值来源 | 无设备：模拟解码器（试运行）；有设备：EEG 服务（eeg-service, DE+SVM） | [适配] DE 特征+个体化 SVM：Zheng & Lu (2015). *IEEE TAC*（SEED 基准）；在线闭环同配置：Ehrlich 2019、Li X. 2024 |
| 对照（规划中） | yoked/回放假反馈 vs 真反馈 | [文献] Ros et al. (2020) CRED-NF 报告规范；《Rethinking control conditions in clinical neurofeedback trials》(2026) 推荐 yoked/replay 优先 |

## 3. 无设备模式（试运行）

大流程与闭环范式必须**在不连接任何 EEG 设备时端到端可运行**，用于流程排练与前端开发：

- 效果评价管线：EEG 关联显示「试运行·未记录 EEG」徽章，量表/条件/结果照常推进；`eeg_session_id` 为空的 post 记录仍可入库（该列为可空列）。
- 闭环调控范式：强制试运行模式，反馈值来自本地模拟解码器（`regulationFeedbackSim.ts`，统计口径与真实解码一致）。
- 模拟解码器的类别基线/漂移参数是**演示用工程参数**，不代表真实解码精度预期（真实在线二分类文献预期 58–70%，见 Ehrlich 2019 与 Li X. 2024）。

## 4. 已知局限（写论文前需处理）

1. 自编 3 题量表缺信效度证据 → 建议并行采集 PANAS/STAI。
2. 10% 改善率阈值与 5 min 默认调控窗为工程设定 → 预注册时固定。
3. 调控反馈的模拟反馈数据不可用于科学结论，仅用于流程验证。
