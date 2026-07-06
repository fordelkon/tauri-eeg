# Agent UI Flow Design

## Goal

Build a constrained experiment assistant for the existing Tauri EEG regulation UI. The assistant should help a subject move through the fixed paradigm, trigger safe actions, and ask for confirmation before any action that can affect EEG data, stimulus exposure, or saved results.

This feature is for subjects, not domain experts. The assistant should present simple examples and guide users through the current task without requiring EEG or ecological regulation knowledge.

## Current Frontend Context

The current frontend already follows a simple route order:

```text
home -> eeg-acquisition -> video-regulation -> game-regulation -> music-regulation
```

The route structure is defined in `src/App.tsx` and the visible navigation flow is managed from `src/pages/Home.tsx`. The main page has a next-page action that calls the same navigation request path as the sidebar. Navigation into video, game, and music pages can open mental-scale gates.

EEG acquisition is controlled separately through `src/eeg/EegSessionContext.tsx`, `src/eeg/eegSessionState.ts`, and `src/eeg/EegControls.tsx`. Device and recording operations already have explicit guards such as `canStartDevice`, `canStartRecord`, `canStopDevice`, `canPauseRecord`, `canResumeRecord`, and `canStopRecord`.

Video regulation uses local selection state in `src/pages/home/VideoRegulation.tsx` and a finite catalog from `src/video/videoRegulationCatalog.ts`. Music regulation uses user selections and backend music generation in `src/pages/home/MusicRegulation.tsx`. Game regulation currently has no launchable implementation and exposes a disabled action in `src/pages/home/GameRegulation.tsx`.

## Product Scope

The MVP should add a visible assistant panel and a constrained action layer. It should not introduce a fully autonomous browser agent or allow a large model to directly click arbitrary UI elements.

In scope:

- A subject-facing assistant panel in the app shell.
- A quick-prompt area for subjects, with fixed phase prompts plus optional dynamic prompts.
- Manual text input as the first input source.
- A future-compatible input boundary for STT text.
- A typed intent-to-action mapping.
- A backend LangGraph orchestration path, backed by local LM Studio when available, for scale-state-based recommendation, personalized follow-up questions, and summary.
- A fixed experiment flow model.
- Safe page navigation through the existing route flow.
- Confirm-before-execute behavior for sensitive actions.
- Finite-catalog nearest-match video recommendation.
- Direct music generation after confirmation through the existing Tauri command path.
- Clear handling when LM Studio is unavailable or game regulation is not implemented.

Out of scope for the first implementation:

- Full STT capture and transcription UI.
- Free-form LLM planning that can execute arbitrary UI operations.
- Game regulation implementation.
- Backend changes for new music models.
- New EEG acquisition protocol logic beyond guiding the existing controls.
- EEG-derived agent decisions, including realtime EEG state, signal quality, band power, or recorded EEG analysis.
- Persistent agent event logging or automatic report file/database writes.

## Resolved Design Decisions

The agent is a subject-facing paradigm flow controller. It is not a free UI automation agent. Its execution capability must be limited to a fixed action registry in `src`.

The three implementation boundaries are:

- `src`: owns the visible assistant panel, flow phase, quick prompts, action registry, policy gate, confirmation gate, module context, and all actual UI/Tauri action execution.
- `src-tauri`: owns trusted command bridging and service startup. It forwards structured planner requests to Python and exposes only explicit Tauri commands.
- `music-service`: owns LangGraph planner logic and local LM Studio calls. It returns validated structured proposals only. It must not directly execute UI actions or sensitive Tauri commands.

LangGraph and LM Studio are planner/recommender components. Their output is a proposal, not authority. The proposal is validated in Python, then validated again by `src` against the local action registry and current phase before any action runs.

If LM Studio is unavailable, the assistant panel remains visible and explains that intelligent assistance is unavailable. The existing manual flow must remain usable through the normal Next button, mental-scale modal, EEG controls, video page, and music page. The app should not block the experiment because the local model is down.

Core scale scores remain the experiment state. Personalized follow-up answers are additional regulation context. Each regulation module can ask one or two lightweight personalized questions after core scale collection; unclear answers may be clarified once, then skipped without blocking the module.

## Recommended Architecture

Use a constrained flow orchestration agent as the primary frontend design, plus a backend LangGraph orchestration layer for recommendation and post-experiment summary.

The assistant should convert user text into one of a small set of typed actions. Those actions are validated against the current route, current experiment phase, and local UI capabilities before execution. UI clicking can be used as an adapter for simple page-level actions, but it should not be the source of truth for experiment control.

The large model should only classify intent, recommend resources, choose scale-aware regulation parameters, or produce a proposed action plan. It must not directly mutate state, call EEG APIs, or click arbitrary controls. The frontend agent layer remains the policy boundary.

## LangGraph Orchestration

The backend agent should use LangGraph only for decisions that benefit from model reasoning:

- Select a video from the finite video catalog.
- Recommend music generation parameters.
- Choose whether a current phase should request or wait for a mental scale.
- Generate one or two personalized follow-up questions for the current regulation module.
- Explain why a regulation resource is recommended.
- Generate an end-of-experiment summary based on scale results and selected resources.

The first version should not pass EEG status or EEG signal features into LangGraph. EEG remains a controlled acquisition surface in Tauri and the frontend. This keeps the intelligent recommendation layer independent from data acquisition safety.

LangGraph should call local LM Studio through the Python service when model reasoning is needed. The first implementation should read configuration from environment variables:

```text
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_MODEL=local-model
```

The frontend must not call LM Studio directly. LM Studio raw output must not be passed through to the frontend. `music-service` must parse and validate model output with Pydantic before returning `AgentPlannerResponse`.

The orchestration input should be structured:

```json
{
  "phase": "video_regulation",
  "currentRoute": "/video-regulation",
  "userInput": "我想放松一点",
  "scaleStatus": {
    "dimensions": [
      { "key": "anxiety", "value": 80 },
      { "key": "worry", "value": 65 },
      { "key": "mood", "value": 40 },
      { "key": "energy", "value": 50 }
    ],
    "lastScaleTitle": "Video Regulation Scale",
    "updatedAt": 1782748800000
  },
  "availableResources": {
    "videos": [
      { "id": "9_seg016", "title": "暮色海岸", "tags": ["海岸", "黄昏", "温柔"] }
    ],
    "musicGeneration": true,
    "gameAvailable": false
  },
  "personalizedContext": {
    "answers": [
      {
        "phase": "video_regulation",
        "question": "Preferred visual material?",
        "answer": "Natural scenery, avoid dark scenes",
        "normalizedTags": ["nature", "avoid_dark"]
      }
    ]
  }
}
```

The orchestration output should also be structured:

```json
{
  "action": "recommend_music",
  "params": {
    "style": "ambient instrumental",
    "details": "slow tempo, warm tone, soft rhythm",
    "duration": 30
  },
  "reason": "当前量表显示焦虑较高，优先选择低刺激、稳定节律的音乐。",
  "requiresConfirmation": true
}
```

The Python planner must validate the model output against allowed planner actions and current phase. The frontend must then validate this output again against the local action registry before execution. If either layer sees an unknown action, a missing resource id, or an action invalid for the current phase, the request is rejected and the subject sees a safe explanation.

## Experiment Flow Model

The assistant should maintain a flow state separate from the current route:

```text
intro
baseline
video_regulation
game_regulation
music_regulation
recovery
finish
```

This flow state maps onto the current route structure:

| Flow State | Current Route | Notes |
| --- | --- | --- |
| `intro` | `/home` | Subject can start or move to EEG. |
| `baseline` | `/eeg-acquisition` | Pre-regulation EEG baseline guidance. |
| `video_regulation` | `/video-regulation` | Uses finite local video catalog. |
| `game_regulation` | `/game-regulation` | Currently unavailable; assistant can explain and skip. |
| `music_regulation` | `/music-regulation` | Uses backend music generation. |
| `recovery` | `/eeg-acquisition` | Post-regulation EEG recovery guidance. |
| `finish` | `/home` or summary state | Experiment complete. |

`baseline` and `recovery` are not new routes in the MVP. They are assistant-level phases that both use the existing EEG acquisition page.

## Action Model

Define a typed action set for the assistant:

```text
go_next_page
go_to_phase
start_eeg_device
stop_eeg_device
start_eeg_recording
pause_eeg_recording
resume_eeg_recording
stop_and_save_eeg_recording
start_eeg_device_and_record
stop_save_eeg_and_go_next
select_video
play_video
generate_music
skip_game
finish_experiment
cancel
```

Each action should include:

- `id`: stable action identifier.
- `label`: short user-facing label.
- `risk`: `safe`, `stimulus`, `resource_sensitive`, or `data_sensitive`.
- `requiresConfirmation`: boolean.
- `allowedPhases`: flow states where the action is valid.
- `execute`: local frontend handler or route/navigation adapter.

Safe navigation actions can run immediately. Stimulus and data-sensitive actions must show a confirmation dialog before execution.

The two EEG compound actions are allowed only in `baseline` and `recovery`. They must execute in order and stop on first failure:

```text
start_eeg_device_and_record:
  await eeg.startDevice()
  await eeg.startRecord()

stop_save_eeg_and_go_next:
  await eeg.stopRecord()
  navigate next
```

If the first step succeeds and a later step fails, the assistant should report the exact partial state and not automatically roll back.

## Safety Policy

The assistant should follow these rules:

- Page navigation through the known safe route sequence can execute without confirmation.
- EEG device start/stop requires confirmation.
- EEG recording start, pause, resume, stop, save, or abandon requires confirmation.
- EEG compound actions require confirmation with all consequences listed.
- Video playback requires confirmation because it starts a regulation stimulus.
- Music generation requires confirmation because it consumes local generation resources and writes generated music history.
- Game launch is unavailable in the MVP, so the assistant must not fabricate a playable game action.
- If the current page state does not support an action, the assistant should explain the needed prerequisite.

Sensitive confirmations should be explicit and action-specific. Example: "Start baseline EEG recording?" is better than a generic "Are you sure?"

## Subject Prompt Design

The assistant panel should provide quick prompt options before the subject begins and at every phase:

```text
开始实验
下一步
开始基线采集
播放放松视频
生成舒缓音乐
结束并保存数据
跳过当前不可用环节
```

The examples should be treated as suggestions, not instructions requiring domain knowledge. The panel should show the current phase, the agent availability state, fixed quick prompts, and one or two dynamic prompts when the planner is available.

Quick prompt behavior depends on risk:

- Safe action prompts can submit immediately.
- Sensitive or resource-consuming prompts open a confirmation or preview before execution.
- Open expression prompts can fill the text input or start a module-specific preview instead of executing immediately.

## Input Strategy

The first implementation should accept manual text input and quick prompts. STT is not implemented in the first version. It can be added later by passing transcribed text into the same intent parser.

The input pipeline should be:

```text
manual text or quick prompt text
-> normalize user phrase
-> call local deterministic classifier or backend LangGraph planner
-> map intent to typed action
-> validate phase and UI capability
-> confirm if required
-> execute
-> report result
```

This keeps STT separate from experiment policy and prevents future speech features from bypassing safety checks.

## Core Scale and Personalized Follow-Up

Core scale scores remain fixed enough to compare experiment state across modules:

```text
anxiety
worry
mood
energy
```

After core scale collection, the assistant may ask one or two personalized follow-up questions for the current module. These answers are used for module recommendation and final summary, but they do not replace core scale scores.

Each personalized answer should carry phase metadata:

```ts
type AgentPersonalizedAnswer = {
  phase: "video_regulation" | "game_regulation" | "music_regulation";
  question: string;
  answer: string;
  normalizedTags: string[];
  createdAt: number;
};
```

If an answer is too long or unclear, the assistant may ask one clarifying question. If the second response is still unclear, it skips that personalized question and continues the manual experiment flow.

## Video and Music Behavior

Video is finite. The assistant must choose from the local video catalog. It must not generate, invent, or reference missing video material.

If an exact match does not exist, the assistant should choose the nearest available video from the catalog. The selection priority is:

1. Filter personalized avoidances first.
2. Match preferred tags.
3. Use core scale scores to prefer lower-stimulation material when anxiety or worry is high.
4. Use catalog default order as a stable tiebreaker.

Only an empty catalog, missing playable files, or resource loading failure should produce an unavailable video result.

Music is generative. The assistant can build music parameters from core scale scores and personalized answers, show a preview, and after subject confirmation call the existing `generate_music` Tauri command path. It should not hide generation errors. If backend generation fails, the assistant should report failure and leave the subject on the music page.

Structured music parameters must be constrained by the frontend. Custom description text is allowed as an "other" prompt supplement, but it must not override duration limits, allowed style options, or the fixed negative prompt that prevents vocals, singing, speech, and lyrics. Custom description should receive lightweight filtering for content that conflicts with the regulation goal, such as frightening, violent, harsh-noise, or vocal/lyrics requests.

## Report and Summary Behavior

The first summary feature should use scale results, personalized follow-up answers, selected video, selected or generated music metadata, unavailable game status, and phase history. It should not claim EEG-based findings until an explicit EEG analysis module is added later.

The summary should clearly separate:

- Observed scale-state facts.
- Subject-provided personalized preferences and avoidances.
- Regulation resources selected during the experiment.
- Model-generated interpretation.
- Suggested follow-up, if any.

The first implementation displays the summary in the UI only. It must not automatically write a report file or database record.

## UI Integration

Add an assistant panel to the existing `Home` app shell so it remains visible across the experiment pages. The panel should be compact and operational, not a landing page. It should show:

- Current phase.
- Agent availability state.
- Recommended next action.
- Fixed and dynamic quick prompts.
- Text input.
- Recent assistant interaction history, capped to the last 3-5 visible messages.
- Confirmation state when required.

The assistant panel should be persistent in the Home shell. Desktop can use a right-side panel; small screens should use a compact collapsible surface. The panel must not cover the existing Next button or EEG controls.

Existing buttons that the assistant may trigger should receive stable action markers where useful, for example:

```text
data-agent-action="next-page"
data-agent-action="start-recording"
data-agent-action="play-video"
data-agent-action="generate-music"
```

These markers are for adapter reliability and tests. Business rules remain in the assistant action model.

## Error Handling

The assistant should distinguish between:

- Unknown request: ask the subject to use one of the visible examples.
- Invalid phase: explain where the requested action is allowed.
- Missing prerequisite: explain the next needed step, such as selecting a video or starting the EEG device.
- Confirmation rejected: leave state unchanged and report cancellation.
- Backend failure: show the existing error detail when available.
- Agent service or LM Studio failure: keep the panel visible, show that intelligent assistance is unavailable, and preserve the existing manual UI flow.

The assistant should not silently skip data-sensitive steps.

## Testing Strategy

Unit tests should cover:

- Intent classification for common Chinese subject prompts.
- Phase-to-route mapping.
- Action validation by phase.
- Confirmation requirements by risk level.
- Game unavailable behavior.
- Video nearest-match fallback.
- LangGraph action plan schema validation.
- LM Studio unavailable behavior.
- Personalized follow-up answer parsing and one-clarification limit.
- Scale-state-based recommendation mapping without EEG inputs.

Integration-oriented frontend tests should cover:

- Assistant panel rendering inside the app shell.
- Safe next-page navigation.
- Confirmation before EEG recording actions.
- Confirmation before stimulus playback.
- Music generation action routing to the existing handler.
- Rejection of invalid model-proposed actions before execution.

## Acceptance Criteria

- A subject can use the assistant to move through the known route sequence.
- The assistant distinguishes baseline and recovery as separate experiment phases while reusing the existing EEG page.
- Safe page navigation can be automated.
- EEG recording and save-related operations require user confirmation.
- Stimulus playback requires user confirmation.
- Music generation requires user confirmation.
- Game regulation is reported as unavailable and can be skipped.
- Video requests use nearest available finite catalog material and do not pretend missing material exists.
- Music generation uses the existing frontend/backend path after confirmation.
- STT can be added later without changing the action safety policy.
- LangGraph recommendations use mental scale status and resource state, not EEG state.
- LM Studio unavailability does not block manual experiment operation.
- Experiment summaries do not claim EEG analysis results in the first version.

## Open Decisions

No open product decisions are required for the MVP. The implementation plan should choose conservative defaults:

- Manual text input first.
- LM Studio-backed planner through `music-service`, with unavailable-state fallback to the manual UI flow.
- LangGraph planner behind the typed action boundary.
- LangGraph first reads mental scale status and resource state only.
- No arbitrary UI automation.
