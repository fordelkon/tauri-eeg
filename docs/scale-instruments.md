# 标准化量表协议（Scale Instruments）

> 本文档登记范式与效果评价管线中全部主观量表的**出处、条目、计分、施测时点、维度映射与极性约定**。代码实现以 `src/mentalScale/instruments/` 为唯一事实源；本文档与其同步维护。
> 替换背景：此前的自编 3 题量表（"最近一周"+0-3 频率锚点，按调控手段分三套）存在**时间窗错配**（trait 式窗口用于分钟级前后测）与**无信效度数据**两个方法学问题，2026-09 起按文献惯例替换为下述四层组合。
> 标注约定：**[查证]** = 已联网核实原文/摘要；**[经典]** = 经典文献常识，引用前请核对原文；**[译本]** = 本项目研究用中文译本，正式发表前需核对官方中文修订版。

## 0. 方法学原则（为什么这样换）

1. **state / trait 区分**：干预前后测必须测"此刻"状态（state），筛查用"过去两周"频率（trait）且**只在基线施测一次**。查证依据：STAI 官方手册的 state（"right now, at this moment"）/trait（"generally"）指令区分（APA Psychometric Instruments）；Li X. et al. (2024, *Cognitive Neurodynamics* 18:2659) 中 PHQ-9/GAD-7 仅基线 rated once，前后测用 state-PANAS 短式。
2. **同一 session 内的前后测禁用"最近一周"窗口**：pre/post 的回溯窗口几乎完全重叠，变化分被系统性稀释。
3. **测量工具不随干预臂变化**：旧设计按调控手段（音乐/视频/游戏）用三套不同题目，导致跨手段对比失去同度量基础。
4. **manipulation check**：诱发是否有效用"当下"直接自评（SAM/单题效价）验证，不用周级回溯量表。

## 1. 四层量表组合总览

| 层次 | 量表 | scale_id | 时点 | 进入改善率引擎 |
|---|---|---|---|---|
| 入门筛查 | PHQ-4（4 题，"过去两周"） | `phq4_screen_v1` | 实验前 1 次（调控页门禁） | 否 |
| 每试次即时（操纵检验） | SAM（效价/唤醒/支配，1–9） | `sam_vad_v1` | 管线①情绪诱发完成后 | 否（描述性） |
| 会话前后测（主结局） | STAI-S（20 题，"此刻"）+ state-PANAS（20 题，"此刻"） | `stai_panas_battery_v1` | 管线②诱发后 / ④条件后 | **是**（焦虑/情绪/能量三维） |
| 音乐特异 | GEMS-9（9 维各 1 题，1–5） | `gems9_music_v1` | 音乐调控条件结束后 | 否（描述性） |

**改善率引擎兼容性**：引擎公式 `(baseline − post)/baseline`（lower=better）与"两腿同 scale_id"约束不变。新 battery 的维度分在**前端计分时已做极性归一**（见 §3.4），后端零改动。旧自编量表数据保留原 scale_id（legacy），跨 scale_id 不做改善率对比。

## 2. 各量表详情

### 2.1 PHQ-4（入门筛查）—— 公共领域 [查证]

- 出处：Kroenke K, Spitzer RL, Williams JB, Löwe B. (2009). An ultra-brief screening scale for anxiety and depression: the PHQ-4. *Psychosomatics*, 50(6):613–621.（Pfizer 官方公开免费使用）
- 施测：实验前 1 次；指令"**在过去两周里**，以下问题困扰你的频繁程度？"；0–3：完全不会 / 好几天 / 一半以上的天数 / 几乎每天。
- 条目（中文用官方通行译文）：
  1. 做事时提不起劲或没有兴趣
  2. 感到心情低落、沮丧或绝望
  3. 感觉紧张、焦虑或着急
  4. 不能停止或控制担忧
- 计分：抑郁 = 条目1+2（0–6）；焦虑 = 条目3+4（0–6）；总分 0–12。判读参考（文献惯例，非诊断）：总分 ≥3 提示进一步评估。
- 维度映射：焦虑 ← 焦虑子分；担忧 ← 焦虑子分（条目4 为核心担忧条目）；情绪 ← 抑郁子分。**仅作筛查与协变量，不进前后测改善率**（trait 窗口）。

### 2.2 STAI-S（状态焦虑，前后测主量表之一）—— [经典] 条目，[译本] 中文

- 出处：Spielberger CD. (1983). *State-Trait Anxiety Inventory (Form Y)*. Consulting Psychologists Press。state 版指令："**此时此刻**"。
- **授权注意**：STAI 由 Mind Garden 商业授权。实验室研究使用前请确认授权；中文条目请以李文利、钱铭怡 (1995)《中国大学生状态焦虑量表的修订》常模修订版核对——下列中文为**研究用译本**，逐字以官方修订版为准。
- 施测：管线②与④各一次；1–4：完全没有 / 有些 / 中等程度 / 非常明显。
- 条目（S1–S20，R=反向计分题）：
  | # | 英文 | 中文 | 计分 |
  |---|---|---|---|
  | 1 | I feel calm | 我感到镇静 | R |
  | 2 | I feel secure | 我感到安全 | R |
  | 3 | I am tense | 我感到紧张 | 正 |
  | 4 | I am regretful | 我感到懊悔 | 正 |
  | 5 | I feel at ease | 我感到轻松自在 | R |
  | 6 | I feel upset | 我感到心烦意乱 | 正 |
  | 7 | I am presently worrying over possible misfortunes | 我正为将来可能的不幸而担忧 | 正 |
  | 8 | I feel rested | 我感到休息得很好 | R |
  | 9 | I feel anxious | 我感到焦虑 | 正 |
  | 10 | I feel comfortable | 我感到舒适 | R |
  | 11 | I feel self-confident | 我充满自信 | R |
  | 12 | I feel nervous | 我感到紧张不安 | 正 |
  | 13 | I am jittery | 我感到坐立不安 | 正 |
  | 14 | I feel indecisive | 我感到犹豫不决 | 正 |
  | 15 | I am relaxed | 我是放松的 | R |
  | 16 | I feel content | 我感到满足 | R |
  | 17 | I am worried | 我感到担忧 | 正 |
  | 18 | I am confused | 我感到茫然困惑 | 正 |
  | 19 | I feel steady | 我感到平稳安定 | R |
  | 20 | I feel pleasant | 我感到愉快 | R |
- 计分：正题 1→1…4→4；反向题 1→4…4→1；总分 20–80（越高越焦虑）。**反向题号：1,2,5,8,10,11,15,16,19,20**——实现前请对照 STAI 手册计分键复核（[译本+计分键待核对] 标注适用于整表）。

### 2.3 state-PANAS（正负性情绪，前后测主量表之二）—— [经典] 条目，[译本] 中文

- 出处：Watson D, Clark LA, Tellegen A. (1988). Development and validation of brief measures of positive and negative affect: the PANAS scales. *Journal of Personality and Social Psychology*, 54(6):1063–1070。科研非商业使用免费；中文版参考邱林、郑雪、王雁飞 (2008). 《中国临床心理学杂志》。state 指令："**此时此刻**"。
- 施测：与 STAI-S 同步（②④各一次）；1–5：非常轻微或几乎没有 / 有一点 / 中等程度 / 相当多 / 非常多。指令："此刻你的感受有多符合下列词语"。
- 条目（P1–P20，PA=正性情绪分量表，NA=负性情绪分量表）：
  | # | 英文 | 中文 | 分量表 |
  |---|---|---|---|
  | 1 | Interested | 感兴趣的 | PA |
  | 2 | Distressed | 心烦的 | NA |
  | 3 | Excited | 兴奋的 | PA |
  | 4 | Upset | 心神不安的 | NA |
  | 5 | Strong | 强有力的 | PA |
  | 6 | Guilty | 内疚的 | NA |
  | 7 | Scared | 惊恐的 | NA |
  | 8 | Hostile | 敌对的 | NA |
  | 9 | Enthusiastic | 热情的 | PA |
  | 10 | Proud | 自豪的 | PA |
  | 11 | Irritable | 易怒的 | NA |
  | 12 | Alert | 警觉的 | PA |
  | 13 | Ashamed | 羞愧的 | NA |
  | 14 | Inspired | 受鼓舞的 | PA |
  | 15 | Nervous | 紧张的 | NA |
  | 16 | Determined | 坚定有决心的 | PA |
  | 17 | Attentive | 专注的 | PA |
  | 18 | Jittery | 坐立不安的 | NA |
  | 19 | Active | 活跃的 | PA |
  | 20 | Afraid | 害怕的 | NA |
- 计分：PA 均分 1–5、NA 均分 1–5（子量表均分制，避免缺项偏差）。

### 2.4 SAM（每试次操纵检验）—— [经典] 图形量表

- 出处：Bradley MM, Lang PJ. (1994). Measuring emotion: The Self-Assessment Manikin and the semantic differential. *J Behav Ther Exp Psychiatry*, 25(1):49–59。NIMH CSEA 提供，科研免费。
- 施测：管线①诱发视频播完即测（随 baseline battery 的第一节呈现）；效价/唤醒/支配三维各 1–9（1=非常不愉快/完全平静/完全受控，9=非常愉快/完全激动/完全主导）。
- 实现：管线用 `src/mentalScale/instruments/sam.ts` 的 1–9 数值版（独立实现，不直接复用范式 `SamRatingDialog`——后者绑定范式会话流程），视觉沿用 battery 对话框锚点行。
- 用途：manipulation check 与描述统计（如需进改善率引擎另立 scale_id，暂不）。

### 2.5 GEMS-9（音乐特异，音乐条件后）—— [经典] 条目，[译本] 中文

- 出处：Zentner M, Grandjean D, Scherer KR. (2008). Emotions evoked by the sound of music: characterization, classification, and measurement. *Emotion*, 8(4):494–521。GEMS-9 每维 1 题。
- 施测：音乐调控条件结束后 1 次；1–5：完全不同意 → 完全同意（"刚才的音乐让你感受到下列情绪的程度"）。
- 九维（中文译本，键名 snake_case）：惊叹 `wonder` / 超越 `transcendence` / 怀旧 `nostalgia` / 温柔 `tenderness` / 宁静 `peacefulness` / 欢快 `joyful_activation` / 力量 `power` / 紧张 `tension` / 悲伤 `sadness`。响应 1–5 五档：完全不同意 / 不同意 / 中立 / 同意 / 完全同意（中间三档为实现插值，Zentner 原版为 5 点同意度格式）。
- 用途：音乐调控的特异性描述结局；无标准中文版，使用自译需在论文中注明。

## 3. 维度映射与极性约定（改善率引擎接口）

### 3.1 维度映射

| 引擎维度 key | 中文 | 前后测来源 | 极性处理 |
|---|---|---|---|
| `anxiety` | 焦虑 | STAI-S 总分（20–80） | 原生 lower=better，直接使用 |
| `mood` | 情绪 | state-PANAS **NA** 均分（1–5） | 原生 lower=better，直接使用（操作化定义：负性情绪强度） |
| `energy` | 能量 | state-PANAS **PA** 均分取反：`6 − PA`（1–5） | PA 越高越好 → 取反对齐 lower=better |
| `worry` | 担忧 | 前后测不再测量（旧自编量表遗留维度） | 新 battery 不产出该维；引擎按两侧实测维度交集计算，自动缺席 |

### 3.2 极性约定（写入 `dimension_scores` 前完成）

所有维度分**一律 lower=better**：取反、反向计分都在前端计分函数内完成，后端 `compute_regulation_effect_summary` 的 `(baseline − post)/baseline` 公式零改动。

### 3.3 记录格式（按后端实际实现修订 2026-09-05）

- 每 phase（②④）**一条** `scale_records` 记录：`scale_id='stai_panas_battery_v1'`；`raw_answers = { stai: {S1..S20}, panas: {P1..P20}, timeframe: 'now', sam?: {valence,arousal,dominance}, gems?: {wonder..sadness} }`；`dimension_scores = { anxiety, mood, energy }`；`measured_dimensions = ['anxiety','mood','energy']`。
- **SAM/GEMS 不单独建记录**：SAM（①诱发后操纵检验）随 baseline 记录的 `raw_answers.sam` 落库；GEMS-9（音乐条件后）随 post 记录的 `raw_answers.gems` 落库（仅音乐条件）。理由：后端 `validate_phase` 只接受 `baseline|post`，且独立 post 记录（condition 非 NULL）会被 `build_effect_history` 的 `(subject, condition)` 配对逻辑误消费 baseline、产生幽灵改善行——随 battery 记录承载附属量表可零后端改动、零配对污染。
- PHQ-4（门禁）：`scale_id='phq4_screen_v1'`，条目键 `phq4_1..phq4_4`，`raw_answers.timeframe='past_2_weeks'`；**phase 落 `baseline`、condition 为 NULL**（后端 `validate_phase` 硬拒其他值；NULL-condition 行只可能被 NULL-condition 的 post 配对，而向导两腿恒带显式 condition，故不污染——该行为与旧门禁一致，非本次新增）。门禁的 `dimension_scores` 沿用既有 0-100 百分位刻度展示约定（phq4_1/2→mood、phq4_3→anxiety、phq4_4→worry），非 PHQ-4 原始子分。
- **scale_id 命名规范**：`{instrument}_{variant}_v{N}`；换条目/换指令 = 换 scale_id，禁止跨 scale_id 计算改善率（后端对比引擎已有同 scale_id 校验，保持）。
- 降级单量表版（pilot 负担过大时）：`stai_s_state_v1` 的计分函数已预置（`src/mentalScale/instruments/staiS.ts`），UI/配置开关未实现。

### 3.4 施测负担说明

②④两节点各 = STAI-S（20 题）+ PANAS（20 题）≈ 3–5 分钟/次。依据：Li X. 2024 在两次 regulation run 之间即插入 PANAS；STAI-S 是焦虑调控文献标准结局（Li J. 2025）。若 pilot 中负担过大，降级方案：仅保留 STAI-S（单量表版 scale_id=`stai_s_state_v1`，维度仅 anxiety）——实现时两套都预置，配置选择。

## 4. 迁移与遗留

1. 旧自编 3 题量表数据：保留原始 scale_id，历史面板照常展示；不与新 battery 混算。
2. [待办] 中文条目以官方修订版逐字核对（STAI：李文利/钱铭怡 1995；PANAS：邱林等 2008；PHQ-4 用官方中文版）；STAI 授权向 Mind Garden 确认。
3. [待办] 正式实验前预注册：量表版本、时点、10% 阈值、调控时长。
4. [文献] 依据综述见 docs/paradigm-protocol.md；state-trait 方法学：Spielberger (1983) 手册、Knowles & Olatunji (2020)。
