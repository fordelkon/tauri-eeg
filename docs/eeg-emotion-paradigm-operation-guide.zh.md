# 情绪脑电音乐调控范式执行操作指南

本文档是 32 通道脑电情绪校准范式的执行手册，面向实际采集人员和系统集成人员。目标是采集可用于个人情绪识别、实时音乐生成调控和视频推荐的高质量校准数据。

## 1. 核心原则

本系统采用 SEED-style 离散情绪诱发范式，不采用 DEAP-style 事后四象限硬切方式。

执行原则：

- 先用明确类别的视频诱发目标情绪。
- 每个 trial 后采集被试自评。
- 用自评确认样本是否进入训练集。
- 模糊样本保留但不进入第一版监督分类器。
- 每个用户单独校准，不默认跨用户泛化。

不要把所有 trial 按 `valence=5`、`arousal=5` 强行切成四类。DEAP 实验显示这会引入大量边界噪声。

## 2. 情绪类别

正式范式只保留 4 类：

```text
Depression -> sad
Anxiety    -> fear
Calm       -> neutral
Happy      -> happy
```

触发码：

```text
1 Depression
2 Anxiety
3 Calm
4 Happy
```

`Fear`、`Joy`、`Surprise` 不作为第一版正式训练类别。它们可以保留在候选素材池中，但不要进入最小系统模块的分类标签。

## 3. 视频素材准备

目录结构：

```text
database/Depression
database/Anxiety
database/Calm
database/Happy
```

最小可运行数量：

```text
每类 5 个视频
总计 20 个视频 trial / session
```

视频要求：

- 时长建议 45-90 秒。
- 每个视频只服务一个主要情绪目标。
- 避免同一视频同时强烈诱发多个目标情绪。
- 避免闪烁、强噪声、突然惊吓、过强负性内容。
- 每个视频需要稳定 `video_id`，不要只依赖文件名临时记录。

建议每类多准备 2-5 个备用视频，用于替换自评不稳定或容易混淆的素材。

## 4. 单个 Trial 流程

每个 trial 按以下顺序执行：

```text
baseline rest 5 s
-> starting hint 2 s
-> video watching 45-90 s
-> post-video rest 5 s
-> self-report <= 30 s
-> quality check
```

执行细节：

- `baseline rest`：黑屏或固定十字，要求被试放松、减少眨眼和头动。
- `starting hint`：提示即将观看视频，不显示目标情绪名称，避免暗示过强。
- `video watching`：播放视频并写入 trigger start/end 时间。
- `post-video rest`：视频结束后短暂静息，减少操作动作污染。
- `self-report`：采集 valence、arousal，dominance 可选。
- `quality check`：记录自评是否匹配目标情绪、是否有明显伪迹。

## 5. 自评量表

使用 1-9 分：

```text
valence: 1 非常负性, 5 中性, 9 非常正性
arousal: 1 非常平静/低唤醒, 5 中等, 9 非常激动/高唤醒
dominance: 可选
```

系统必须保存原始自评分数，不要只保存最终类别。

## 6. 样本接纳规则

只有 `accepted` 样本进入第一版监督训练。

接纳规则：

```text
Depression / sad:
  valence <= 4
  arousal <= 5

Anxiety / fear:
  valence <= 4
  arousal >= 6

Calm / neutral:
  valence >= 5
  arousal <= 4

Happy:
  valence >= 6
  5 <= arousal <= 8
```

质量标签：

```text
accepted
  自评与目标情绪一致，可进入训练集。

uncertain
  自评接近边界或情绪混合，保留数据但不进入第一版训练。

rejected
  自评明显不匹配目标情绪，排查视频素材。

artifact_rejected
  EEG 伪迹严重、触发时间缺失、通道异常或采集失败。
```

如果某一类 accepted trial 少于 3 个，本 session 不建议训练该类模型；应补采或替换视频。

## 7. Session 安排

Session 1：基线诱发和个人校准。

```text
目标：采集带自评确认的个人 EEG 标签数据。
反馈：关闭音乐/视频调控反馈。
输出：可训练的个人校准数据集。
```

Session 2：调控反馈验证。

```text
目标：验证模型在线识别和音乐/视频调控是否有效。
反馈：开启实时音乐调控，可接视频推荐。
输出：调控前后状态变化和系统延迟记录。
```

Session 1 和 Session 2 不要混为同一个评估集。Session 2 更接近真实使用，应作为泛化和调控效果验证。

## 8. 必须保存的数据字段

每个 trial 至少保存：

```text
subject_id
session_id
trial_id
phase
paradigm_emotion
system_emotion
trigger_class
video_id
video_path
trigger_start_ts
trigger_end_ts
eeg_start_ts
eeg_end_ts
sample_rate_hz
channel_ids
recording_path
self_report_valence
self_report_arousal
self_report_dominance
self_report_acceptance
label_source
artifact_flags
device_metadata
operator_notes
```

`label_source` 建议取值：

```text
induction_target
self_report_confirmed
model_prediction
```

训练集优先使用：

```text
label_source = self_report_confirmed
self_report_acceptance = accepted
```

## 9. 采集前检查清单

采集开始前确认：

- 32 通道 EEG 已连接，阻抗/信号质量可接受。
- 实际采样率已记录，通常为 1000 Hz。
- 50 ms block 流正常进入系统后端。
- 所有视频文件可播放，音量一致。
- trigger start/end 能写入日志。
- 系统时间戳稳定。
- 被试知情同意和退出机制已完成。
- 被试了解自评量表，但不知道每个视频的目标标签。

## 10. 采集中异常处理

出现以下情况应标记 `artifact_rejected`：

- EEG 数据缺失。
- trigger start/end 缺失。
- 大量通道掉线。
- 明显体动、说话、摘帽、操作中断。
- 视频播放失败或卡顿。

出现以下情况应标记 `uncertain`：

- 自评正好落在边界附近。
- 被试反馈同时有多种情绪。
- 视频目标情绪和自评部分一致但不够明确。

出现以下情况应标记 `rejected`：

- Depression 视频被评为高正性。
- Anxiety 视频被评为低唤醒平静。
- Calm 视频引发高唤醒或明显负性。
- Happy 视频引发负性或过高唤醒不适。

## 11. 训练前数据检查

训练前统计：

```text
每类 accepted trial 数量
每类 uncertain trial 数量
每类 rejected trial 数量
每类 artifact_rejected trial 数量
每个 trial 的通道完整性
每个 trial 的有效 EEG 时长
valence/arousal 分布
```

最低训练条件：

```text
每类 accepted >= 3 个 trial: 可以做最小系统验证
每类 accepted >= 5 个 trial: 符合当前最小范式
每类 accepted >= 10 个 trial: 更适合做稳定模型选择
```

如果某类 accepted 数量不足，优先补采该类，不要用 uncertain 样本凑数。

## 12. 推荐模型训练路线

每个用户都应比较多条路线：

```text
direct four-class classifier
valence binary + arousal binary classifier
valence/arousal regression with rule mapping
Riemannian tangent-space SVM/LDA baseline
```

选择标准：

```text
validation balanced accuracy
per-class confusion matrix
低置信度比例
跨 session 稳定性
```

如果 direct four-class 表现差，但 valence/arousal 二分类稳定，可以先上线维度模型，再映射到调控策略。

## 13. 实时系统接入要求

模型输出必须包含：

```text
emotion
probabilities
valence
arousal
confidence
source
updated_at
```

低置信度处理：

```text
confidence 高: 允许音乐参数逐步调整
confidence 中: 小幅平滑调整
confidence 低: 保持当前音乐状态或回到 neutral/calm 策略
```

不要让单个 EEG 窗口直接触发大幅音乐变化。至少应对多个窗口做平滑。

## 14. 音乐调控策略

检测为 `sad / depression`：

```text
目标：提升 valence，轻微提升 arousal
音乐：温暖、渐进、中等速度、正向和声
避免：过慢、过暗、稀疏、反刍感强
```

检测为 `fear / anxiety`：

```text
目标：先降低 arousal，再稳定 valence
音乐：低到中速、软起音、节律稳定、低不协和
避免：突然转场、高打击密度、尖锐高频、快速节奏
```

检测为 `neutral / calm`：

```text
目标：维持低唤醒稳定状态
音乐：环境、轻质感、低动态、低新奇度
避免：强情绪推动
```

检测为 `happy`：

```text
目标：保持正性，不推高到焦虑性高唤醒
音乐：明亮、旋律连续、中等能量、平滑变化
避免：过强刺激和过快节奏
```

## 15. 采集完成后的交付物

每个被试至少交付：

```text
raw EEG recordings
trial metadata json/csv
self-report table
artifact/quality table
accepted training manifest
uncertain/rejected audit manifest
model training report
validation confusion matrix
latency report if Session 2 was run
```

这些文件应能回答三个问题：

```text
这个 trial 诱发了什么？
被试实际报告了什么？
这段 EEG 是否应该进入训练？
```

只有这三个问题都可追溯，后续情绪识别、音乐生成和视频推荐才有可靠基础。
