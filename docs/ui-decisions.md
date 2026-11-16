# 实验工作台界面决策

维护动效、控件或实验设置时使用此表。时长、颜色和圆角取自[当前设计变量](../src/styles/tokens.css)；旧计划中的行号和数值对应当时版本。例如工作区进入时长曾为 300 ms，后续已调整。

回归动效时，分别在普通动态效果和系统“减少动态效果”下走过登录、首页、各调控页、效果评价和逐试次范式。核对交互能完成，且减少动态效果时反馈仍可见。

## 已完成的调整

001–015 的基线为 `4f567de`，实现提交 `a53d93f`。016–020 的基线为 `a09c7bf`，实现提交 `2f9fe40`。以下文件均曾记录为 DONE。查阅任一计划原文，可用 `git show 0aea445:plans/<原文件名>`；同一提交的 `plans/README.md` 是当时的完整索引。

| 原文件名 | 设计决定及验收要点 |
|---|---|
| `001-progress-disclosure-transition.md` | 进度面板展开到一半再收起应从当前位置折返。卸载折叠内容前保留收起过渡；自动播报、固定面板与计时各自保持原行为。 |
| `002-drawer-choreography.md` | 抽屉、背景遮罩和装饰层同刻收尾。快速反向操作时，遮罩提前隐藏会截断侧栏滑动。 |
| `003-mui-dialog-popover-motion.md` | 弹窗和菜单共用主题层的进入、退出过渡；MUI v9 的实现差异见下方原始记录。 |
| `004-workspace-enter-token.md` | 工作区进入时长由共享 token 管理；CSS Modules 的关键帧仍留在组件内。首次登录和 404 插画有独立节奏。 |
| `005-reduced-motion-hover-resets.md` | 减少动态效果时取消 hover/active 位移，同时保留背景色、文字色、阴影等交互反馈。 |
| `006-login-exit-reduced-motion-guard.md` | 登录退出选择器的优先级不得覆盖减少动态效果规则；退出计时也要同时归零。直接改为 scale 会改变原有画面。 |
| `007-ease-in-out-token.md` | 对呼吸、振荡类动效用相同的往返曲线；向外传播的单次脉冲使用出场减速曲线。 |
| `008-wizard-stage-swap.md` | 向导按步骤更新内部内容，外层保持挂载以保留焦点和滚动位置；倒计时刷新不能重播步骤动画。 |
| `009-paradigm-finished-celebration.md` | 完成页可交错呈现前八行结果；错误警告立即出现，减少动态效果时结果也立即可见。 |
| `010-hover-decoration-reduction.md` | 高频导航悬停保留颜色反馈，按钮在已有悬停状态上表现按压；当时保留了“下一页”的方向提示。 |
| `011-home-logo-rest.md` | 主页装饰播放一轮后静止，切换窗口回来也不重新播放；首次进入时的介绍层允许循环。 |
| `012-feedback-bar-scalex.md` | 试次反馈条从左端按 scaleX 显示进度，数值与轨道稳定，减少动态效果时直接显示终值。 |
| `013-matter-resize-coalesce.md` | 连续调整窗口大小，每帧最多重建一次物理场景；组件退出时取消尚未执行的帧。 |
| `015-curve-consolidation-press-feedback.md` | 共用的进入、按压曲线从全局 token 取值；登录错误反馈及首次动画的局部例外保留设计理由。 |
| `016-experiment-settings-button-tiers.md` | 连接等主要操作与刷新端口、选择文件夹、返回等次要操作分层；只在正在执行的按钮上标示忙碌状态。 |
| `017-experiment-settings-status-banners.md` | 错误、成功和提示在原位置显示，保留告警语义；提示条随内容排布，避免遮挡操作。 |
| `018-experiment-settings-calm-surface.md` | 表面、边线、字号和焦点环使用共享 token；可交互控件在键盘聚焦时有可见边界。 |
| `019-experiment-settings-stage-swap.md` | 设置与范式之间切换只更新阶段内容；范式内部状态变化不能导致会话组件重挂载。 |
| `020-experiment-settings-logic-tightening.md` | 设备刷新保留当前端口选择；异步操作结束前阻止重复切步。运行锁负责设备操作，操作者仍需能进入当前范式。偏好逐次落盘，失败提示注明具体动作。 |

## 需原样保留的记录

以下摘录描述当时的环境、批准范围和实现例外；其中的文件位置与测试数量对应当次提交。

**010、011 的产品偏好**

> - Plans 010 and 011 are product-taste decisions the user explicitly approved
>   ("全部"); if that approval is ever revoked, retire those two plans.

> Do NOT touch `.nextPageButton` hover — its `translateX(4px)` reads as
>   directional meaning (next module) and it is a once-per-step CTA.

> Do NOT add a fade-out "settle" animation — rest means rest.

**020 的运行门槛与崩溃恢复**

> Note: gate on `busy` only — NOT `locked`, because `status.activeRunId`
>    being set must not block going TO the paradigm stage where the run lives.

> Do NOT change persistence behavior (`savePreferences` writing on each
>   change is intentional — operator state must survive a crash).

**001 执行记录**

> Executed as written. One anticipated deviation: the contract test
> `EffectProgressDisclosure.contract.test.ts` asserted the old conditional
> render (`isOpen ? (<div id="effect-progress-panel"`); its expectation was
> updated per this plan's Mechanical section to pin the new invariant
> (`<Collapse in={isOpen}` + `unmountOnExit`). 485/485 tests green.

**003 执行记录**

> Executed with one API adaptation: MUI v9 removed `TransitionComponent`/
> `transitionDuration` from Dialog/Popover props (tsc rejected the plan's
> exact shape). Ported to the v9 slots system per the official v9 migration
> guide: `defaultProps: { slots: { transition: CalmGrow }, slotProps: { transition: { timeout: { enter: 220, exit: 180 } } } }`.
> `CalmGrow` (Grow + dialect easing) is unchanged in spirit — enter
> `cubic-bezier(0.16, 1, 0.3, 1)`, exit `cubic-bezier(0.7, 0, 0.84, 0)`.
> `tsc` clean, 485/485 tests green.

**004 执行记录**

> Executed as written. One VideoRegulation nuance vs. the audit excerpt: its
> `from` keyframe already carried `scale(0.99)` (only the `to` transform lacked
> `scale(1)`); aligned accordingly. The "Done when" grep's `520ms` term
> over-reached slightly: `Login.module.css:56` (`loginFormExit 520ms`) and
> `NotFound.module.css:80` remain by design — both are rare/first-run art that
> this plan's Boundaries explicitly exempt. `src/pages` workspace entrances
> are clean.
