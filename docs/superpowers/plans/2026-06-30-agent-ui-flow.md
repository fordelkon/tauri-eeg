# Agent UI Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a constrained subject-facing experiment assistant that guides the existing Tauri EEG UI through the fixed paradigm, uses mental scale state for LangGraph-backed recommendations, and confirms sensitive actions before execution.

**Architecture:** Add a pure `src/agent` domain module for phase, intent, action, and safety policy. Add a React execution layer that connects typed actions to existing route navigation and EEG controls, then add a Tauri command that calls a Python LangGraph planner inside `music-service` using mental scale and resource state only.

**Tech Stack:** TypeScript, React 18, React Router, CSS modules, Vitest, Tauri Rust commands, FastAPI, Pydantic, LangGraph.

---

## Confirmed Design Decisions

- The agent is a subject-facing paradigm flow controller, not a free UI automation agent.
- All execution must go through the fixed `src/agent/agentActions.ts` action registry.
- LangGraph and LM Studio only produce planner/recommender proposals. They cannot directly execute UI actions or Tauri sensitive commands.
- `src` validates every planner proposal against action id, current phase, resource availability, risk, and confirmation policy before execution.
- `music-service` calls local LM Studio through environment variables and validates raw model output with Pydantic before returning structured responses.
- If LM Studio is unavailable, the assistant panel remains visible and reports that intelligent assistance is unavailable; the manual experiment flow remains fully usable.
- Core scale scores remain the experiment state. Personalized follow-up questions add module context, but do not replace core scale scores.
- Video recommendation must choose the nearest available video from the finite catalog when no exact match exists.
- Music generation may be triggered by the agent only after a preview and subject confirmation.
- The first summary is displayed in the UI only; it is not automatically written to file or database.

## File Structure

- Create `src/agent/agentFlow.ts`: phase model, route mapping, prompt examples, next-phase logic.
- Create `src/agent/agentIntent.ts`: deterministic Chinese/English phrase normalization and intent classification.
- Create `src/agent/agentActions.ts`: typed action definitions, risk policy, phase validation, confirmation labels.
- Create `src/agent/agentContext.ts`: module context, personalized answers, and in-memory timeline types.
- Create `src/agent/agentVideo.ts`: finite video catalog nearest-match helper for assistant requests.
- Create `src/agent/agentMusic.ts`: constrained music parameter proposal and custom-description filtering helper.
- Create `src/agent/agentPlannerApi.ts`: frontend Tauri invoke wrapper and shared planner request/response types.
- Create `src/agent/useExperimentAgent.ts`: React hook that executes validated actions through existing navigation and EEG context.
- Create `src/agent/ExperimentAgentPanel.tsx`: visible assistant panel component.
- Create `src/agent/ExperimentAgentPanel.module.css`: panel styles.
- Create tests beside modules: `src/agent/agentFlow.test.ts`, `src/agent/agentIntent.test.ts`, `src/agent/agentActions.test.ts`, `src/agent/agentContext.test.ts`, `src/agent/agentVideo.test.ts`, `src/agent/agentMusic.test.ts`.
- Create `music-service/lm_studio_client.py`: OpenAI-compatible local LM Studio client and availability checks.
- Create `music-service/agent_planner.py`: LangGraph state graph for scale-state recommendations, personalized prompts, and summaries.
- Create `music-service/tests/test_agent_planner.py`: planner schema and recommendation tests.
- Create `music-service/tests/test_lm_studio_client.py`: LM Studio unavailable and invalid-output handling tests.
- Modify `music-service/server.py`: expose `POST /agent/plan`.
- Modify `music-service/pyproject.toml`: add `langgraph`.
- Modify `src-tauri/src/python_client.rs`: add agent planner request/response client types.
- Modify `src-tauri/src/lib.rs`: expose `plan_agent_action` Tauri command.
- Modify `src/pages/Home.tsx`: mount the assistant panel and pass navigation dependencies.
- Modify `src/pages/Home.module.css`: reserve layout space for the assistant panel on desktop and mobile.
- Modify `src/pages/home/VideoRegulation.tsx`: add stable `data-agent-action` markers to video play buttons.
- Modify `src/pages/home/MusicRegulation.tsx`: add stable `data-agent-action` markers to generate and play buttons.
- Modify `src/eeg/EegControls.tsx`: add stable `data-agent-action` markers to EEG control buttons.

## Task 1: Pure Flow Model

**Files:**
- Create: `src/agent/agentFlow.ts`
- Test: `src/agent/agentFlow.test.ts`

- [ ] **Step 1: Write the failing flow tests**

Create `src/agent/agentFlow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  agentPromptExamples,
  getAgentPhaseForRoute,
  getNextAgentPhase,
  getRecommendedPrompt,
  getRouteForAgentPhase,
  isAgentPhase,
} from './agentFlow';

describe('agentFlow', () => {
  it('maps current routes to assistant phases without adding new EEG routes', () => {
    expect(getAgentPhaseForRoute('/home')).toBe('intro');
    expect(getAgentPhaseForRoute('/eeg-acquisition')).toBe('baseline');
    expect(getAgentPhaseForRoute('/video-regulation')).toBe('video_regulation');
    expect(getAgentPhaseForRoute('/game-regulation')).toBe('game_regulation');
    expect(getAgentPhaseForRoute('/music-regulation')).toBe('music_regulation');
    expect(getAgentPhaseForRoute('/eeg-acquisition', 'music_regulation')).toBe('recovery');
  });

  it('maps baseline and recovery to the existing EEG route', () => {
    expect(getRouteForAgentPhase('baseline')).toBe('/eeg-acquisition');
    expect(getRouteForAgentPhase('recovery')).toBe('/eeg-acquisition');
  });

  it('advances through the fixed paradigm and skips unavailable game to music', () => {
    expect(getNextAgentPhase('intro')).toBe('baseline');
    expect(getNextAgentPhase('baseline')).toBe('video_regulation');
    expect(getNextAgentPhase('video_regulation')).toBe('game_regulation');
    expect(getNextAgentPhase('game_regulation')).toBe('music_regulation');
    expect(getNextAgentPhase('music_regulation')).toBe('recovery');
    expect(getNextAgentPhase('recovery')).toBe('finish');
    expect(getNextAgentPhase('finish')).toBe('finish');
  });

  it('exposes subject-friendly prompt examples and recommended prompts', () => {
    expect(agentPromptExamples).toContain('开始实验');
    expect(agentPromptExamples).toContain('结束并保存数据');
    expect(getRecommendedPrompt('baseline')).toBe('开始基线采集');
    expect(getRecommendedPrompt('game_regulation')).toBe('跳过当前不可用环节');
  });

  it('validates phase strings at boundaries', () => {
    expect(isAgentPhase('baseline')).toBe(true);
    expect(isAgentPhase('unknown')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the flow tests to verify they fail**

Run:

```bash
pnpm test -- src/agent/agentFlow.test.ts
```

Expected: FAIL because `src/agent/agentFlow.ts` does not exist.

- [ ] **Step 3: Implement the flow model**

Create `src/agent/agentFlow.ts`:

```ts
export type AgentPhase =
  | 'intro'
  | 'baseline'
  | 'video_regulation'
  | 'game_regulation'
  | 'music_regulation'
  | 'recovery'
  | 'finish';

export type AgentRoute =
  | '/home'
  | '/eeg-acquisition'
  | '/video-regulation'
  | '/game-regulation'
  | '/music-regulation';

export const agentPhases = [
  'intro',
  'baseline',
  'video_regulation',
  'game_regulation',
  'music_regulation',
  'recovery',
  'finish',
] as const satisfies readonly AgentPhase[];

export const agentPromptExamples = [
  '开始实验',
  '下一步',
  '开始基线采集',
  '播放放松视频',
  '生成舒缓音乐',
  '结束并保存数据',
  '跳过当前不可用环节',
] as const;

const phaseRoutes = {
  intro: '/home',
  baseline: '/eeg-acquisition',
  video_regulation: '/video-regulation',
  game_regulation: '/game-regulation',
  music_regulation: '/music-regulation',
  recovery: '/eeg-acquisition',
  finish: '/home',
} as const satisfies Record<AgentPhase, AgentRoute>;

const nextPhases = {
  intro: 'baseline',
  baseline: 'video_regulation',
  video_regulation: 'game_regulation',
  game_regulation: 'music_regulation',
  music_regulation: 'recovery',
  recovery: 'finish',
  finish: 'finish',
} as const satisfies Record<AgentPhase, AgentPhase>;

const recommendedPrompts = {
  intro: '开始实验',
  baseline: '开始基线采集',
  video_regulation: '播放放松视频',
  game_regulation: '跳过当前不可用环节',
  music_regulation: '生成舒缓音乐',
  recovery: '结束并保存数据',
  finish: '实验已完成',
} as const satisfies Record<AgentPhase, string>;

export function isAgentPhase(value: string): value is AgentPhase {
  return agentPhases.includes(value as AgentPhase);
}

export function getRouteForAgentPhase(phase: AgentPhase): AgentRoute {
  return phaseRoutes[phase];
}

export function getNextAgentPhase(phase: AgentPhase): AgentPhase {
  return nextPhases[phase];
}

export function getRecommendedPrompt(phase: AgentPhase): string {
  return recommendedPrompts[phase];
}

export function getAgentPhaseForRoute(pathname: string, previousPhase: AgentPhase = 'intro'): AgentPhase {
  if (pathname === '/home') {
    return previousPhase === 'finish' ? 'finish' : 'intro';
  }

  if (pathname === '/eeg-acquisition') {
    return previousPhase === 'music_regulation' || previousPhase === 'recovery' ? 'recovery' : 'baseline';
  }

  if (pathname === '/video-regulation') {
    return 'video_regulation';
  }

  if (pathname === '/game-regulation') {
    return 'game_regulation';
  }

  if (pathname === '/music-regulation') {
    return 'music_regulation';
  }

  return previousPhase;
}
```

- [ ] **Step 4: Run the flow tests to verify they pass**

Run:

```bash
pnpm test -- src/agent/agentFlow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/agentFlow.ts src/agent/agentFlow.test.ts
git commit -m "feat(agent): add experiment flow model"
```

## Task 2: Intent and Action Policy

**Files:**
- Create: `src/agent/agentIntent.ts`
- Create: `src/agent/agentActions.ts`
- Test: `src/agent/agentIntent.test.ts`
- Test: `src/agent/agentActions.test.ts`

- [ ] **Step 1: Write failing intent tests**

Create `src/agent/agentIntent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyAgentIntent, normalizeAgentInput } from './agentIntent';

describe('agentIntent', () => {
  it('normalizes whitespace and common punctuation', () => {
    expect(normalizeAgentInput('  开始，基线采集！')).toBe('开始基线采集');
  });

  it('classifies subject prompts into constrained intents', () => {
    expect(classifyAgentIntent('开始实验')).toBe('go_next_page');
    expect(classifyAgentIntent('下一步')).toBe('go_next_page');
    expect(classifyAgentIntent('开始基线采集')).toBe('start_eeg_device_and_record');
    expect(classifyAgentIntent('停止并保存')).toBe('stop_and_save_eeg_recording');
    expect(classifyAgentIntent('播放放松视频')).toBe('play_video');
    expect(classifyAgentIntent('生成舒缓音乐')).toBe('generate_music');
    expect(classifyAgentIntent('跳过游戏')).toBe('skip_game');
  });

  it('returns unknown for unsupported free-form operations', () => {
    expect(classifyAgentIntent('删除所有数据')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Write failing action policy tests**

Create `src/agent/agentActions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  agentActions,
  getAgentAction,
  getAgentActionValidation,
  requiresAgentConfirmation,
} from './agentActions';

describe('agentActions', () => {
  it('marks navigation as safe and EEG operations as data sensitive', () => {
    expect(getAgentAction('go_next_page')?.risk).toBe('safe');
    expect(getAgentAction('start_eeg_device_and_record')?.risk).toBe('data_sensitive');
    expect(getAgentAction('stop_and_save_eeg_recording')?.risk).toBe('data_sensitive');
    expect(getAgentAction('generate_music')?.risk).toBe('resource_sensitive');
  });

  it('requires confirmation for EEG and stimulus actions', () => {
    expect(requiresAgentConfirmation('go_next_page')).toBe(false);
    expect(requiresAgentConfirmation('play_video')).toBe(true);
    expect(requiresAgentConfirmation('start_eeg_device_and_record')).toBe(true);
    expect(requiresAgentConfirmation('generate_music')).toBe(true);
  });

  it('validates actions by experiment phase', () => {
    expect(getAgentActionValidation('start_eeg_recording', 'baseline')).toEqual({ ok: true });
    expect(getAgentActionValidation('start_eeg_recording', 'video_regulation')).toEqual({
      ok: false,
      reason: '当前阶段不能执行该操作。',
    });
    expect(getAgentActionValidation('skip_game', 'game_regulation')).toEqual({ ok: true });
  });

  it('keeps the action list small and explicit', () => {
    expect(agentActions.map((action) => action.id)).toEqual([
      'go_next_page',
      'go_to_phase',
      'start_eeg_device',
      'stop_eeg_device',
      'start_eeg_recording',
      'pause_eeg_recording',
      'resume_eeg_recording',
      'stop_and_save_eeg_recording',
      'start_eeg_device_and_record',
      'stop_save_eeg_and_go_next',
      'select_video',
      'play_video',
      'generate_music',
      'skip_game',
      'finish_experiment',
      'cancel',
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm test -- src/agent/agentIntent.test.ts src/agent/agentActions.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement deterministic intent matching**

Create `src/agent/agentIntent.ts`:

```ts
import type { AgentActionId } from './agentActions';

export type AgentIntent = AgentActionId | 'unknown';

const punctuationPattern = /[\s,，。、？！；：]+/g;

export function normalizeAgentInput(input: string): string {
  return input.trim().replace(punctuationPattern, '');
}

export function classifyAgentIntent(input: string): AgentIntent {
  const normalized = normalizeAgentInput(input).toLowerCase();

  if (!normalized) {
    return 'unknown';
  }

  if (/(下一步|继续|开始实验|start|next)/i.test(normalized)) {
    return 'go_next_page';
  }

  if (/(启动设备|连接设备|开始设备|startdevice)/i.test(normalized)) {
    return 'start_eeg_device';
  }

  if (/(停止设备|关闭设备|stopdevice)/i.test(normalized)) {
    return 'stop_eeg_device';
  }

  if (/(开始基线采集|开始恢复采集|开始采集|开始记录|开始录制|startrecord)/i.test(normalized)) {
    return 'start_eeg_device_and_record';
  }

  if (/(暂停采集|暂停记录|pauserecord)/i.test(normalized)) {
    return 'pause_eeg_recording';
  }

  if (/(继续采集|恢复采集|继续记录|resumerecord)/i.test(normalized)) {
    return 'resume_eeg_recording';
  }

  if (/(结束并保存|停止并保存|保存数据|结束采集|停止记录|stoprecord)/i.test(normalized)) {
    return 'stop_and_save_eeg_recording';
  }

  if (/(选择视频|匹配视频|selectvideo)/i.test(normalized)) {
    return 'select_video';
  }

  if (/(播放.*视频|放松视频|playvideo)/i.test(normalized)) {
    return 'play_video';
  }

  if (/(生成.*音乐|舒缓音乐|音乐生成|generatemusic)/i.test(normalized)) {
    return 'generate_music';
  }

  if (/(跳过.*游戏|跳过当前不可用环节|skipgame)/i.test(normalized)) {
    return 'skip_game';
  }

  if (/(完成实验|结束实验|finish)/i.test(normalized)) {
    return 'finish_experiment';
  }

  if (/(取消|cancel)/i.test(normalized)) {
    return 'cancel';
  }

  return 'unknown';
}
```

- [ ] **Step 5: Implement action policy**

Create `src/agent/agentActions.ts`:

```ts
import type { AgentPhase } from './agentFlow';

export type AgentActionRisk = 'safe' | 'stimulus' | 'resource_sensitive' | 'data_sensitive';

export type AgentActionId =
  | 'go_next_page'
  | 'go_to_phase'
  | 'start_eeg_device'
  | 'stop_eeg_device'
  | 'start_eeg_recording'
  | 'pause_eeg_recording'
  | 'resume_eeg_recording'
  | 'stop_and_save_eeg_recording'
  | 'start_eeg_device_and_record'
  | 'stop_save_eeg_and_go_next'
  | 'select_video'
  | 'play_video'
  | 'generate_music'
  | 'skip_game'
  | 'finish_experiment'
  | 'cancel';

export type AgentActionDefinition = {
  id: AgentActionId;
  label: string;
  risk: AgentActionRisk;
  requiresConfirmation: boolean;
  allowedPhases: readonly AgentPhase[];
  confirmationLabel?: string;
};

const eegPhases = ['baseline', 'recovery'] as const;
const allPhases = ['intro', 'baseline', 'video_regulation', 'game_regulation', 'music_regulation', 'recovery', 'finish'] as const;

export const agentActions = [
  { id: 'go_next_page', label: '下一步', risk: 'safe', requiresConfirmation: false, allowedPhases: allPhases },
  { id: 'go_to_phase', label: '进入阶段', risk: 'safe', requiresConfirmation: false, allowedPhases: allPhases },
  { id: 'start_eeg_device', label: '启动 EEG 设备', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '启动 EEG 设备？' },
  { id: 'stop_eeg_device', label: '停止 EEG 设备', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '停止 EEG 设备？' },
  { id: 'start_eeg_recording', label: '开始 EEG 采集', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '开始当前阶段 EEG 采集？' },
  { id: 'pause_eeg_recording', label: '暂停 EEG 采集', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '暂停 EEG 采集？' },
  { id: 'resume_eeg_recording', label: '继续 EEG 采集', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '继续 EEG 采集？' },
  { id: 'stop_and_save_eeg_recording', label: '停止并保存 EEG 数据', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '停止并保存 EEG 数据？' },
  { id: 'start_eeg_device_and_record', label: '启动设备并开始 EEG 采集', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '将启动 EEG 设备并开始当前阶段 EEG 采集。是否确认？' },
  { id: 'stop_save_eeg_and_go_next', label: '停止保存并进入下一阶段', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '将停止并保存当前 EEG 数据，并进入下一阶段。是否确认？' },
  { id: 'select_video', label: '选择视频', risk: 'safe', requiresConfirmation: false, allowedPhases: ['video_regulation'] },
  { id: 'play_video', label: '播放视频', risk: 'stimulus', requiresConfirmation: true, allowedPhases: ['video_regulation'], confirmationLabel: '播放调控视频？' },
  { id: 'generate_music', label: '生成音乐', risk: 'resource_sensitive', requiresConfirmation: true, allowedPhases: ['music_regulation'], confirmationLabel: '将生成调控音乐并写入音乐历史。是否确认？' },
  { id: 'skip_game', label: '跳过游戏', risk: 'safe', requiresConfirmation: false, allowedPhases: ['game_regulation'] },
  { id: 'finish_experiment', label: '完成实验', risk: 'safe', requiresConfirmation: false, allowedPhases: ['finish', 'recovery'] },
  { id: 'cancel', label: '取消', risk: 'safe', requiresConfirmation: false, allowedPhases: allPhases },
] as const satisfies readonly AgentActionDefinition[];

export type AgentActionValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function getAgentAction(id: AgentActionId): AgentActionDefinition | undefined {
  return agentActions.find((action) => action.id === id);
}

export function requiresAgentConfirmation(id: AgentActionId): boolean {
  return getAgentAction(id)?.requiresConfirmation ?? false;
}

export function getAgentActionValidation(id: AgentActionId, phase: AgentPhase): AgentActionValidation {
  const action = getAgentAction(id);

  if (!action) {
    return { ok: false, reason: '无法识别该操作。' };
  }

  if (!action.allowedPhases.includes(phase)) {
    return { ok: false, reason: '当前阶段不能执行该操作。' };
  }

  return { ok: true };
}
```

- [ ] **Step 6: Run action and intent tests**

Run:

```bash
pnpm test -- src/agent/agentIntent.test.ts src/agent/agentActions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/agentIntent.ts src/agent/agentIntent.test.ts src/agent/agentActions.ts src/agent/agentActions.test.ts
git commit -m "feat(agent): add constrained intent policy"
```

## Task 3: Video Catalog Assistant Helper

**Files:**
- Create: `src/agent/agentVideo.ts`
- Modify: `src/video/videoRegulationCatalog.ts`
- Test: `src/agent/agentVideo.test.ts`
- Test: `src/video/videoRegulationCatalog.test.ts`

- [ ] **Step 1: Write failing video helper tests**

Create `src/agent/agentVideo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findAgentVideoMatch } from './agentVideo';

describe('agentVideo', () => {
  it('finds an existing video by indexed Chinese catalog text', () => {
    const result = findAgentVideoMatch('播放暮色海岸视频');

    expect(result.status).toBe('matched');
    expect(result.confidence).toBe('exact');
    expect(result.video?.id).toBe('9_seg016');
  });

  it('returns the nearest finite catalog video when no exact material exists', () => {
    const result = findAgentVideoMatch('播放火山城市视频');

    expect(result.status).toBe('matched');
    expect(result.confidence).toBe('nearest');
    expect(result.video).toBeDefined();
  });

  it('only reports unavailable when the finite catalog is empty', () => {
    const result = findAgentVideoMatch('播放火山城市视频', []);

    expect(result).toEqual({
      status: 'unavailable',
      message: '当前没有可用视频素材。',
    });
  });
});
```

- [ ] **Step 2: Run the video helper test to verify it fails**

Run:

```bash
pnpm test -- src/agent/agentVideo.test.ts
```

Expected: FAIL because `agentVideo.ts` does not exist.

- [ ] **Step 3: Export all finite catalog assets**

Modify `src/video/videoRegulationCatalog.ts` after `getDefaultVideoSelections`:

```ts
export function getAllVideoRegulationAssets(
  libraryAssets: readonly VideoRegulationAsset[] = assets,
): VideoRegulationAsset[] {
  return [...libraryAssets];
}
```

Add this assertion to `src/video/videoRegulationCatalog.test.ts`:

```ts
import {
  getAllVideoRegulationAssets,
  getDefaultVideoSelections,
  getNextVideoSelectionStep,
  getVideoRegulationCatalog,
  getVideoSelectionOptions,
  selectFirstMatchedVideo,
  toPlayableVideoUrl,
  videoLibraryPath,
  videoSelectionSteps,
} from './videoRegulationCatalog';
```

Then add this test in the `describe('videoRegulationCatalog', () => { ... })` block:

```ts
  it('exposes all finite assets for assistant lookup without requiring a partial selection', () => {
    expect(getAllVideoRegulationAssets().map((video) => video.id)).toContain('9_seg016');
  });
```

- [ ] **Step 4: Implement finite catalog lookup**

Create `src/agent/agentVideo.ts`:

```ts
import {
  getAllVideoRegulationAssets,
  type VideoRegulationAsset,
} from '../video/videoRegulationCatalog';
import { normalizeAgentInput } from './agentIntent';

export type AgentVideoMatch =
  | { status: 'matched'; video: VideoRegulationAsset; confidence: 'exact' | 'nearest'; message: string }
  | { status: 'unavailable'; message: string };

export function findAgentVideoMatch(
  input: string,
  catalog: readonly VideoRegulationAsset[] = getAllVideoRegulationAssets(),
): AgentVideoMatch {
  if (catalog.length === 0) {
    return {
      status: 'unavailable',
      message: '当前没有可用视频素材。',
    };
  }

  const query = normalizeAgentInput(input).replace(/播放|视频|放松/g, '');
  const matched = catalog.find((video) => {
    const searchable = [
      video.title,
      video.summary,
      video.segment.scene,
      video.segment.atmosphere,
      ...video.tags,
      ...video.indexedTags,
    ].join('');

    return query.length > 0 && searchable.includes(query);
  });

  if (matched) {
    return {
      status: 'matched',
      video: matched,
      confidence: 'exact',
      message: `已找到视频：${matched.title}`,
    };
  }

  const nearest = catalog[0];
  return {
    status: 'matched',
    video: nearest,
    confidence: 'nearest',
    message: `没有找到精确匹配视频，已选择最接近素材：${nearest.title}`,
  };
}
```

- [ ] **Step 5: Run video tests**

Run:

```bash
pnpm test -- src/video/videoRegulationCatalog.test.ts src/agent/agentVideo.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/agentVideo.ts src/agent/agentVideo.test.ts src/video/videoRegulationCatalog.ts src/video/videoRegulationCatalog.test.ts
git commit -m "feat(agent): add finite video matching"
```

## Task 4: Agent Context and Music Parameter Policy

**Files:**
- Create: `src/agent/agentContext.ts`
- Create: `src/agent/agentContext.test.ts`
- Create: `src/agent/agentMusic.ts`
- Create: `src/agent/agentMusic.test.ts`

- [ ] **Step 1: Add module context tests**

Create tests that assert:

- Core scale scores are kept separate from personalized follow-up answers.
- Personalized answers include `phase`, `question`, `answer`, `normalizedTags`, and `createdAt`.
- The visible interaction list is capped to the most recent 3-5 entries while the internal timeline keeps the full in-memory history.
- Unclear personalized answers can be marked for one clarification, then skipped without blocking the module.

- [ ] **Step 2: Implement `agentContext.ts`**

Implement these public types and helpers:

```ts
export type AgentCoreScores = {
  anxiety: number;
  worry: number;
  mood: number;
  energy: number;
};

export type AgentPersonalizedAnswer = {
  phase: 'video_regulation' | 'game_regulation' | 'music_regulation';
  question: string;
  answer: string;
  normalizedTags: string[];
  createdAt: number;
};

export type AgentTimelineEntry = {
  id: string;
  phase: string;
  role: 'subject' | 'assistant' | 'system';
  text: string;
  createdAt: number;
};
```

- [ ] **Step 3: Add music policy tests**

Create tests that assert:

- Music duration is clamped to the frontend-allowed set, for example `15 | 30 | 45 | 60`.
- Style is selected from the existing frontend style options.
- `customDescription` is retained as an optional prompt supplement.
- Custom descriptions requesting vocals, lyrics, speech, harsh noise, frightening material, or violent content are rejected or sanitized.
- The negative prompt remains fixed and cannot be overridden by the planner.

- [ ] **Step 4: Implement `agentMusic.ts`**

Implement a small policy helper that converts planner output plus personalized answers into a constrained preview:

```ts
export type AgentMusicPreview = {
  style: string;
  duration: 15 | 30 | 45 | 60;
  promptSupplement?: string;
  negativePrompt: 'vocals, singing, speech, lyrics';
};
```

This helper does not call Tauri. It only prepares safe parameters for the React execution layer.

- [ ] **Step 5: Run context and music tests**

Run:

```bash
pnpm test -- src/agent/agentContext.test.ts src/agent/agentMusic.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/agentContext.ts src/agent/agentContext.test.ts src/agent/agentMusic.ts src/agent/agentMusic.test.ts
git commit -m "feat(agent): add context and music policy"
```

## Task 5: React Agent Execution Hook

**Files:**
- Create: `src/agent/useExperimentAgent.ts`
- Modify: `src/pages/Home.tsx`

- [ ] **Step 1: Implement the hook with explicit dependencies**

Create `src/agent/useExperimentAgent.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import { useEegSession } from '../eeg/EegSessionContext';
import {
  getAgentAction,
  getAgentActionValidation,
  type AgentActionId,
} from './agentActions';
import {
  getAgentPhaseForRoute,
  getNextAgentPhase,
  getRecommendedPrompt,
  getRouteForAgentPhase,
  type AgentPhase,
} from './agentFlow';
import { classifyAgentIntent } from './agentIntent';
import { findAgentVideoMatch } from './agentVideo';

export type PendingAgentConfirmation = {
  actionId: AgentActionId;
  label: string;
};

export type UseExperimentAgentOptions = {
  pathname: string;
  navigateTo: (path: string) => void;
};

export function useExperimentAgent({ pathname, navigateTo }: UseExperimentAgentOptions) {
  const eeg = useEegSession();
  const [phase, setPhase] = useState<AgentPhase>(() => getAgentPhaseForRoute(pathname));
  const [message, setMessage] = useState('可以输入“开始实验”或点击推荐操作。');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAgentConfirmation | null>(null);

  useEffect(() => {
    setPhase((currentPhase) => getAgentPhaseForRoute(pathname, currentPhase));
  }, [pathname]);

  const recommendedPrompt = useMemo(() => getRecommendedPrompt(phase), [phase]);

  const executeAction = async (actionId: AgentActionId) => {
    const validation = getAgentActionValidation(actionId, phase);
    if (!validation.ok) {
      setMessage(validation.reason);
      return;
    }

    switch (actionId) {
      case 'go_next_page': {
        const nextPhase = getNextAgentPhase(phase);
        setPhase(nextPhase);
        navigateTo(getRouteForAgentPhase(nextPhase));
        setMessage(`已进入：${getRecommendedPrompt(nextPhase)}`);
        return;
      }
      case 'start_eeg_device':
        await eeg.startDevice();
        setMessage('已请求启动 EEG 设备。');
        return;
      case 'stop_eeg_device':
        await eeg.stopDevice();
        setMessage('已请求停止 EEG 设备。');
        return;
      case 'start_eeg_recording':
        await eeg.startRecord();
        setMessage(phase === 'recovery' ? '已请求开始恢复采集。' : '已请求开始基线采集。');
        return;
      case 'pause_eeg_recording':
        eeg.pauseRecord();
        setMessage('已暂停 EEG 采集。');
        return;
      case 'resume_eeg_recording':
        eeg.resumeRecord();
        setMessage('已继续 EEG 采集。');
        return;
      case 'stop_and_save_eeg_recording':
        await eeg.stopRecord();
        setMessage('已请求停止并保存 EEG 数据。');
        return;
      case 'start_eeg_device_and_record':
        await eeg.startDevice();
        await eeg.startRecord();
        setMessage(phase === 'recovery' ? '已启动设备并开始恢复采集。' : '已启动设备并开始基线采集。');
        return;
      case 'stop_save_eeg_and_go_next': {
        await eeg.stopRecord();
        const nextPhase = getNextAgentPhase(phase);
        setPhase(nextPhase);
        navigateTo(getRouteForAgentPhase(nextPhase));
        setMessage(`Stopped and saved EEG data. Entered: ${getRecommendedPrompt(nextPhase)}`);
        return;
      }
      case 'play_video':
        setMessage('请在视频页面选择素材后播放。');
        return;
      case 'select_video': {
        const match = findAgentVideoMatch('放松视频');
        setMessage(match.message);
        return;
      }
      case 'generate_music':
        setMessage('请确认音乐预览参数，确认后由助手调用现有生成接口。');
        return;
      case 'skip_game':
        setPhase('music_regulation');
        navigateTo('/music-regulation');
        setMessage('游戏调控暂不可用，已进入音乐调控。');
        return;
      case 'finish_experiment':
        setPhase('finish');
        navigateTo('/home');
        setMessage('实验流程已完成。');
        return;
      case 'go_to_phase':
      case 'cancel':
        setMessage('已取消当前操作。');
        return;
      default:
        setMessage('无法执行该操作。');
    }
  };

  const submitPrompt = async (input: string) => {
    const intent = classifyAgentIntent(input);
    if (intent === 'unknown') {
      setMessage('没有识别该请求，请使用面板中的示例表达。');
      return;
    }

    const action = getAgentAction(intent);
    if (!action) {
      setMessage('没有找到可执行的安全操作。');
      return;
    }

    const validation = getAgentActionValidation(action.id, phase);
    if (!validation.ok) {
      setMessage(validation.reason);
      return;
    }

    if (action.requiresConfirmation) {
      setPendingConfirmation({
        actionId: action.id,
        label: action.confirmationLabel ?? action.label,
      });
      return;
    }

    await executeAction(action.id);
  };

  const confirmPendingAction = async () => {
    if (!pendingConfirmation) {
      return;
    }

    const actionId = pendingConfirmation.actionId;
    setPendingConfirmation(null);
    await executeAction(actionId);
  };

  const rejectPendingAction = () => {
    setPendingConfirmation(null);
    setMessage('已取消敏感操作。');
  };

  return {
    message,
    pendingConfirmation,
    phase,
    recommendedPrompt,
    confirmPendingAction,
    rejectPendingAction,
    submitPrompt,
  };
}
```

- [ ] **Step 2: Check types for hook integration**

Run:

```bash
pnpm run build
```

Expected: FAIL if the hook has unused imports or type issues; PASS if isolated code compiles.

- [ ] **Step 3: Fix compile errors in `src/agent/useExperimentAgent.ts`**

Keep the public return object exactly as used by the panel in Task 6:

```ts
return {
  message,
  pendingConfirmation,
  phase,
  recommendedPrompt,
  confirmPendingAction,
  rejectPendingAction,
  submitPrompt,
};
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/useExperimentAgent.ts
git commit -m "feat(agent): connect assistant actions to experiment state"
```

## Task 6: Assistant Panel UI and Home Shell Integration

**Files:**
- Create: `src/agent/ExperimentAgentPanel.tsx`
- Create: `src/agent/ExperimentAgentPanel.module.css`
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Home.module.css`

- [ ] **Step 1: Create the assistant panel component**

Create `src/agent/ExperimentAgentPanel.tsx`:

```tsx
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { useState } from 'react';
import { agentPromptExamples } from './agentFlow';
import type { PendingAgentConfirmation } from './useExperimentAgent';
import styles from './ExperimentAgentPanel.module.css';

type ExperimentAgentPanelProps = {
  message: string;
  pendingConfirmation: PendingAgentConfirmation | null;
  phase: string;
  recommendedPrompt: string;
  onConfirm: () => void;
  onReject: () => void;
  onSubmitPrompt: (input: string) => void;
};

export default function ExperimentAgentPanel({
  message,
  pendingConfirmation,
  phase,
  recommendedPrompt,
  onConfirm,
  onReject,
  onSubmitPrompt,
}: ExperimentAgentPanelProps) {
  const [input, setInput] = useState('');

  const submit = (value: string) => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }

    onSubmitPrompt(nextValue);
    setInput('');
  };

  return (
    <aside className={styles.panel} aria-label="Experiment assistant">
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          <SmartToyRoundedIcon fontSize="small" />
        </span>
        <div>
          <span>实验助手</span>
          <strong>{phase}</strong>
        </div>
      </div>

      <button className={styles.recommended} type="button" onClick={() => submit(recommendedPrompt)}>
        {recommendedPrompt}
      </button>

      <div className={styles.examples} aria-label="Prompt examples">
        {agentPromptExamples.map((example) => (
          <button key={example} type="button" onClick={() => submit(example)}>
            {example}
          </button>
        ))}
      </div>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <input
          value={input}
          maxLength={80}
          placeholder="输入：下一步"
          onChange={(event) => setInput(event.currentTarget.value)}
        />
        <button type="submit" aria-label="Send assistant prompt">
          <SendRoundedIcon fontSize="small" />
        </button>
      </form>

      <p className={styles.message} aria-live="polite">{message}</p>

      {pendingConfirmation ? (
        <div className={styles.confirmation} role="alertdialog" aria-label={pendingConfirmation.label}>
          <strong>{pendingConfirmation.label}</strong>
          <div className={styles.confirmationActions}>
            <button type="button" onClick={onReject}>取消</button>
            <button type="button" onClick={onConfirm}>确认</button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
```

- [ ] **Step 2: Create compact panel styles**

Create `src/agent/ExperimentAgentPanel.module.css`:

```css
.panel {
  background: rgba(245, 240, 235, 0.94);
  border: 1px solid rgba(44, 34, 24, 0.12);
  border-radius: 8px;
  bottom: 18px;
  box-shadow: 0 18px 46px rgba(44, 34, 24, 0.18);
  color: #2c2218;
  display: grid;
  gap: 10px;
  max-width: min(360px, calc(100vw - 36px));
  padding: 12px;
  position: fixed;
  right: 18px;
  width: 360px;
  z-index: 6;
}

.header {
  align-items: center;
  display: flex;
  gap: 10px;
  min-width: 0;
}

.header div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.header span {
  color: rgba(44, 34, 24, 0.58);
  font-size: 11px;
  font-weight: 760;
}

.header strong {
  color: #2c2218;
  font-size: 14px;
  font-weight: 760;
}

.icon {
  align-items: center;
  background: #2c2218;
  border-radius: 8px;
  color: #f5f0eb !important;
  display: inline-flex;
  height: 34px;
  justify-content: center;
  width: 34px;
}

.recommended,
.examples button,
.form button,
.confirmationActions button {
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 720;
  min-height: 34px;
}

.recommended {
  background: #2c2218;
  border: 1px solid #2c2218;
  color: #f5f0eb;
}

.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.examples button {
  background: rgba(44, 34, 24, 0.06);
  border: 1px solid rgba(44, 34, 24, 0.1);
  color: #2c2218;
  padding: 0 9px;
}

.form {
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) 38px;
}

.form input {
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(44, 34, 24, 0.14);
  border-radius: 8px;
  box-sizing: border-box;
  color: #2c2218;
  font: inherit;
  font-size: 13px;
  min-width: 0;
  padding: 0 10px;
}

.form button {
  align-items: center;
  background: #df0203;
  border: 1px solid #df0203;
  color: #fff;
  display: inline-flex;
  justify-content: center;
}

.message {
  color: rgba(44, 34, 24, 0.7);
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
}

.confirmation {
  background: rgba(223, 2, 3, 0.08);
  border: 1px solid rgba(223, 2, 3, 0.18);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  padding: 10px;
}

.confirmation strong {
  font-size: 13px;
}

.confirmationActions {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.confirmationActions button {
  background: rgba(44, 34, 24, 0.08);
  border: 1px solid rgba(44, 34, 24, 0.1);
  color: #2c2218;
}

.confirmationActions button:last-child {
  background: #2c2218;
  border-color: #2c2218;
  color: #f5f0eb;
}

@media (max-width: 640px) {
  .panel {
    bottom: 68px;
    left: 18px;
    right: 18px;
    width: auto;
  }
}
```

- [ ] **Step 3: Mount the hook and panel in `Home.tsx`**

Modify imports in `src/pages/Home.tsx`:

```tsx
import ExperimentAgentPanel from '../agent/ExperimentAgentPanel';
import { useExperimentAgent } from '../agent/useExperimentAgent';
```

Inside `Home`, insert the hook call after `requestNavigation` is declared and before `handleNavClick`:

```tsx
  const experimentAgent = useExperimentAgent({
    pathname: location.pathname,
    navigateTo: requestNavigation,
  });
```

Render before `GlobalMentalScalePanel`:

```tsx
        <ExperimentAgentPanel
          message={experimentAgent.message}
          pendingConfirmation={experimentAgent.pendingConfirmation}
          phase={experimentAgent.phase}
          recommendedPrompt={experimentAgent.recommendedPrompt}
          onConfirm={() => void experimentAgent.confirmPendingAction()}
          onReject={experimentAgent.rejectPendingAction}
          onSubmitPrompt={(input) => void experimentAgent.submitPrompt(input)}
        />
```

- [ ] **Step 4: Reserve layout space in `Home.module.css`**

Modify `.nextPageButton` in `src/pages/Home.module.css`:

```css
.nextPageButton {
  right: clamp(392px, 32vw, 430px);
}
```

Then add this override under the existing `@media (max-width: 980px)` block:

```css
  .nextPageButton {
    right: 18px;
  }
```

- [ ] **Step 5: Build to catch integration errors**

Run:

```bash
pnpm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/ExperimentAgentPanel.tsx src/agent/ExperimentAgentPanel.module.css src/pages/Home.tsx src/pages/Home.module.css
git commit -m "feat(agent): add subject assistant panel"
```

## Task 7: LangGraph Planner Contract

**Files:**
- Create: `src/agent/agentPlannerApi.ts`
- Modify: `src/agent/useExperimentAgent.ts`
- Test: `src/agent/agentActions.test.ts`

- [ ] **Step 1: Add frontend planner contract**

Create `src/agent/agentPlannerApi.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { MentalScaleStatus } from '../mentalScale/mentalScaleStatus';
import type { AgentActionId } from './agentActions';
import type { AgentPhase } from './agentFlow';
import type { AgentPersonalizedAnswer } from './agentContext';

export type AgentResourceVideoSummary = {
  id: string;
  title: string;
  tags: string[];
};

export type AgentPlannerRequest = {
  phase: AgentPhase;
  currentRoute: string;
  userInput: string;
  scaleStatus: MentalScaleStatus;
  personalizedContext: {
    answers: AgentPersonalizedAnswer[];
  };
  availableResources: {
    videos: AgentResourceVideoSummary[];
    musicGeneration: boolean;
    gameAvailable: boolean;
  };
};

export type AgentPlannerResponse = {
  status: 'available' | 'unavailable';
  action: AgentActionId | 'recommend_video' | 'recommend_music' | 'ask_personalized_question' | 'generate_summary' | 'no_op';
  params: Record<string, string | number | boolean | string[]>;
  reason: string;
  requiresConfirmation: boolean;
};

export function planAgentAction(input: AgentPlannerRequest): Promise<AgentPlannerResponse> {
  return invoke<AgentPlannerResponse>('plan_agent_action', { input });
}
```

- [ ] **Step 2: Add model-proposed action validation coverage**

Append this test to `src/agent/agentActions.test.ts`:

```ts
  it('does not treat recommendation-only planner actions as directly executable UI actions', () => {
    expect(getAgentAction('recommend_music' as never)).toBeUndefined();
    expect(getAgentAction('ask_personalized_question' as never)).toBeUndefined();
    expect(getAgentAction('generate_summary' as never)).toBeUndefined();
  });
```

- [ ] **Step 3: Update `useExperimentAgent` to accept planner responses conservatively**

Modify `src/agent/useExperimentAgent.ts` imports:

```ts
import { getMentalScaleStatusSnapshot } from '../mentalScale/mentalScaleStatus';
import { planAgentAction } from './agentPlannerApi';
```

Add this helper inside `useExperimentAgent` before `submitPrompt`:

```ts
  const requestPlannerRecommendation = async (input: string) => {
    try {
      const response = await planAgentAction({
        phase,
        currentRoute: pathname,
        userInput: input,
        scaleStatus: getMentalScaleStatusSnapshot(),
        personalizedContext: {
          answers: [],
        },
        availableResources: {
          videos: [],
          musicGeneration: true,
          gameAvailable: false,
        },
      });

      if (response.status === 'unavailable') {
        setMessage('智能助手暂不可用，请使用页面手动操作。');
        return true;
      }

      if (response.action === 'recommend_music') {
        setMessage(response.reason);
        return true;
      }

      if (response.action === 'recommend_video') {
        setMessage(response.reason);
        return true;
      }

      if (response.action === 'generate_summary') {
        setMessage(response.reason);
        return true;
      }

      if (response.action === 'ask_personalized_question') {
        setMessage(response.reason);
        return true;
      }

      if (response.action === 'no_op') {
        setMessage(response.reason);
        return true;
      }

      const action = getAgentAction(response.action);
      if (!action) {
        setMessage('智能助手返回了不可执行操作，已拒绝。');
        return true;
      }

      const validation = getAgentActionValidation(action.id, phase);
      if (!validation.ok) {
        setMessage(validation.reason);
        return true;
      }

      if (action.requiresConfirmation || response.requiresConfirmation) {
        setPendingConfirmation({
          actionId: action.id,
          label: action.confirmationLabel ?? action.label,
        });
        return true;
      }

      await executeAction(action.id);
      return true;
    } catch {
      return false;
    }
  };
```

Then change the first lines of `submitPrompt`:

```ts
  const submitPrompt = async (input: string) => {
    const plannerHandled = await requestPlannerRecommendation(input);
    if (plannerHandled) {
      return;
    }

    const intent = classifyAgentIntent(input);
```

- [ ] **Step 4: Run frontend agent tests**

Run:

```bash
pnpm test -- src/agent/agentActions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/agentPlannerApi.ts src/agent/useExperimentAgent.ts src/agent/agentActions.test.ts
git commit -m "feat(agent): add planner action contract"
```

## Task 8: Python LangGraph Scale-State Planner

**Files:**
- Create: `music-service/lm_studio_client.py`
- Create: `music-service/agent_planner.py`
- Create: `music-service/tests/test_lm_studio_client.py`
- Create: `music-service/tests/test_agent_planner.py`
- Modify: `music-service/server.py`
- Modify: `music-service/pyproject.toml`

- [ ] **Step 1: Add LangGraph dependency**

Modify `music-service/pyproject.toml` dependencies:

```toml
dependencies = [
    "fastapi==0.115.0",
    "uvicorn[standard]==0.30.0",
    "stable-audio-3 @ git+https://github.com/Stability-AI/stable-audio-3.git",
    "pydantic==2.9.0",
    "httpx==0.27.2",
    "langgraph==0.2.74",
]
```

- [ ] **Step 2: Add LM Studio client tests**

Create `music-service/tests/test_lm_studio_client.py` with coverage for:

- Reads `LM_STUDIO_BASE_URL` and `LM_STUDIO_MODEL` from environment variables.
- Uses default base URL `http://127.0.0.1:1234/v1` when unset.
- Returns unavailable when LM Studio is not reachable.
- Rejects invalid model JSON instead of passing raw text through.

- [ ] **Step 3: Implement LM Studio client**

Create `music-service/lm_studio_client.py`:

```py
import os
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError


class LmStudioSettings(BaseModel):
    base_url: str = "http://127.0.0.1:1234/v1"
    model: str = "local-model"


def load_lm_studio_settings() -> LmStudioSettings:
    return LmStudioSettings(
        base_url=os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:1234/v1"),
        model=os.getenv("LM_STUDIO_MODEL", "local-model"),
    )
```

Add a small completion helper that returns parsed JSON or a typed unavailable result. Do not expose raw LM Studio text to `server.py` or the frontend.

- [ ] **Step 4: Write planner tests**

Create `music-service/tests/test_agent_planner.py`:

```py
from agent_planner import AgentPlannerRequest, plan_agent_action


def base_request(**overrides):
    data = {
        "phase": "music_regulation",
        "currentRoute": "/music-regulation",
        "userInput": "我现在有点紧张，生成舒缓音乐",
        "scaleStatus": {
            "dimensions": [
                {"key": "anxiety", "label": "Anxiety", "description": "Tension", "value": 85},
                {"key": "worry", "label": "Worry", "description": "Worry", "value": 70},
                {"key": "mood", "label": "Mood", "description": "Mood", "value": 45},
                {"key": "energy", "label": "Energy", "description": "Energy", "value": 50},
            ],
            "lastScaleTitle": "Music Regulation Scale",
            "updatedAt": 1782748800000,
        },
        "availableResources": {
            "videos": [
                {"id": "9_seg016", "title": "暮色海岸", "tags": ["海岸", "黄昏", "温柔"]},
            ],
            "musicGeneration": True,
            "gameAvailable": False,
        },
        "personalizedContext": {
            "answers": [
                {
                    "phase": "music_regulation",
                    "question": "Preferred sound?",
                    "answer": "soft piano, avoid vocals",
                    "normalizedTags": ["piano", "avoid_vocals"],
                    "createdAt": 1782748800000,
                }
            ],
        },
    }
    data.update(overrides)
    return AgentPlannerRequest.model_validate(data)


def test_recommends_music_for_high_anxiety_music_phase():
    response = plan_agent_action(base_request())

    assert response.action == "recommend_music"
    assert response.params["style"] == "ambient instrumental"
    assert response.params["duration"] == 30
    assert "焦虑" in response.reason
    assert response.status == "available"


def test_recommends_video_from_finite_resources():
    response = plan_agent_action(base_request(
        phase="video_regulation",
        currentRoute="/video-regulation",
        userInput="推荐一个放松视频",
    ))

    assert response.action == "recommend_video"
    assert response.params["videoId"] == "9_seg016"
    assert response.requiresConfirmation is True


def test_skips_unavailable_game():
    response = plan_agent_action(base_request(
        phase="game_regulation",
        currentRoute="/game-regulation",
        userInput="继续实验",
    ))

    assert response.action == "skip_game"
    assert response.requiresConfirmation is False


def test_summary_does_not_claim_eeg_analysis():
    response = plan_agent_action(base_request(
        phase="finish",
        currentRoute="/home",
        userInput="生成总结",
    ))

    assert response.action == "generate_summary"
    assert "EEG" not in response.reason


def test_returns_unavailable_when_lm_studio_is_down(monkeypatch):
    monkeypatch.setenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:9/v1")
    response = plan_agent_action(base_request(userInput="请个性化推荐"))

    assert response.status == "unavailable"
    assert response.action == "no_op"
```

- [ ] **Step 5: Implement LangGraph planner**

Create `music-service/agent_planner.py`:

```py
from typing import Any, Literal, TypedDict

from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field


class ScaleDimension(BaseModel):
    key: str
    label: str
    description: str
    value: int = Field(ge=0, le=100)


class ScaleStatus(BaseModel):
    dimensions: list[ScaleDimension]
    lastScaleTitle: str
    updatedAt: int | None


class VideoSummary(BaseModel):
    id: str
    title: str
    tags: list[str]


class AvailableResources(BaseModel):
    videos: list[VideoSummary]
    musicGeneration: bool
    gameAvailable: bool


class AgentPlannerRequest(BaseModel):
    phase: Literal[
        "intro",
        "baseline",
        "video_regulation",
        "game_regulation",
        "music_regulation",
        "recovery",
        "finish",
    ]
    currentRoute: str
    userInput: str
    scaleStatus: ScaleStatus
    availableResources: AvailableResources


class AgentPlannerResponse(BaseModel):
    status: Literal["available", "unavailable"] = "available"
    action: str
    params: dict[str, str | int | bool | list[str]]
    reason: str
    requiresConfirmation: bool


class PlannerState(TypedDict):
    request: AgentPlannerRequest
    response: AgentPlannerResponse | None


ALLOWED_PLANNER_ACTIONS = {
    "recommend_video",
    "recommend_music",
    "ask_personalized_question",
    "generate_summary",
    "skip_game",
    "go_next_page",
    "no_op",
}


def _dimension_value(request: AgentPlannerRequest, key: str) -> int:
    for dimension in request.scaleStatus.dimensions:
        if dimension.key == key:
            return dimension.value
    return 50


def _plan_by_phase(state: PlannerState) -> PlannerState:
    request = state["request"]
    anxiety = _dimension_value(request, "anxiety")
    mood = _dimension_value(request, "mood")

    if request.phase == "game_regulation" and not request.availableResources.gameAvailable:
        state["response"] = AgentPlannerResponse(
            action="skip_game",
            params={},
            reason="游戏调控暂不可用，建议跳过该环节并进入音乐调控。",
            requiresConfirmation=False,
        )
        return state

    if request.phase == "video_regulation" and request.availableResources.videos:
        video = request.availableResources.videos[0]
        state["response"] = AgentPlannerResponse(
            action="recommend_video",
            params={"videoId": video.id, "title": video.title},
            reason=f"根据当前量表状态，推荐使用低刺激视频素材：{video.title}。",
            requiresConfirmation=True,
        )
        return state

    if request.phase == "music_regulation" and request.availableResources.musicGeneration:
        details = "slow tempo, warm tone, soft rhythm" if anxiety >= 70 else "gentle dynamics, calm texture"
        style = "ambient instrumental" if anxiety >= mood else "meditation music"
        state["response"] = AgentPlannerResponse(
            action="recommend_music",
            params={"style": style, "details": details, "duration": 30},
            reason="当前量表显示焦虑较高，优先选择低刺激、稳定节律的音乐。",
            requiresConfirmation=False,
        )
        return state

    if request.phase == "finish" or "总结" in request.userInput:
        state["response"] = AgentPlannerResponse(
            action="generate_summary",
            params={"source": "scale_and_resource_history"},
            reason="可基于量表结果和调控资源选择生成实验总结；当前版本不包含脑电分析结论。",
            requiresConfirmation=False,
        )
        return state

    state["response"] = AgentPlannerResponse(
        status="available",
        action="go_next_page",
        params={},
        reason="当前阶段没有额外推荐，建议继续下一步。",
        requiresConfirmation=False,
    )
    return state


def build_agent_graph():
    graph = StateGraph(PlannerState)
    graph.add_node("plan_by_phase", _plan_by_phase)
    graph.set_entry_point("plan_by_phase")
    graph.add_edge("plan_by_phase", END)
    return graph.compile()


_GRAPH = build_agent_graph()


def plan_agent_action(request: AgentPlannerRequest) -> AgentPlannerResponse:
    result: dict[str, Any] = _GRAPH.invoke({"request": request, "response": None})
    response = result.get("response")
    if not isinstance(response, AgentPlannerResponse):
        raise ValueError("Agent planner did not return a response.")
    if response.action not in ALLOWED_PLANNER_ACTIONS:
        return AgentPlannerResponse(
            status="available",
            action="no_op",
            params={},
            reason="Planner returned an unsupported action and it was rejected.",
            requiresConfirmation=False,
        )
    return response
```

- [ ] **Step 6: Expose FastAPI endpoint**

Modify `music-service/server.py` imports:

```py
from agent_planner import AgentPlannerRequest, AgentPlannerResponse, plan_agent_action
```

Add this endpoint after the existing health endpoint:

```py
@app.post("/agent/plan", response_model=AgentPlannerResponse)
async def plan_agent(input: AgentPlannerRequest) -> AgentPlannerResponse:
    return plan_agent_action(input)
```

- [ ] **Step 7: Run Python planner tests**

Run:

```bash
cd music-service
uv run pytest tests/test_lm_studio_client.py tests/test_agent_planner.py
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add music-service/pyproject.toml music-service/lm_studio_client.py music-service/agent_planner.py music-service/server.py music-service/tests/test_lm_studio_client.py music-service/tests/test_agent_planner.py
git commit -m "feat(agent): add scale-state LangGraph planner"
```

## Task 9: Tauri Agent Planner Bridge

**Files:**
- Modify: `src-tauri/src/python_client.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Rust planner client types**

Modify `src-tauri/src/python_client.rs` imports:

```rust
use serde::{Deserialize, Serialize};
```

Add these structs after `HealthResponse`:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlannerRequest {
    pub phase: String,
    pub current_route: String,
    pub user_input: String,
    pub scale_status: serde_json::Value,
    pub personalized_context: serde_json::Value,
    pub available_resources: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlannerResponse {
    pub status: String,
    pub action: String,
    pub params: serde_json::Value,
    pub reason: String,
    pub requires_confirmation: bool,
}
```

Add this method inside `impl PythonClient`:

```rust
    pub async fn plan_agent_action(
        &self,
        request: &AgentPlannerRequest,
    ) -> Result<AgentPlannerResponse, String> {
        let url = format!("{}/agent/plan", self.base_url);
        let response = self
            .client
            .post(url)
            .json(request)
            .send()
            .await
            .map_err(|_| "Failed to reach agent planner service.".to_string())?;

        if !response.status().is_success() {
            return Err("Agent planner service returned an error.".to_string());
        }

        response
            .json::<AgentPlannerResponse>()
            .await
            .map_err(|_| "Failed to parse agent planner response.".to_string())
    }
```

- [ ] **Step 2: Add Tauri command**

Modify `src-tauri/src/lib.rs` imports:

```rust
use python_client::{
    AgentPlannerRequest, AgentPlannerResponse, GenerateRequest, HealthResponse, PythonClient,
};
use serde::{Deserialize, Serialize};
```

Add command near the music service commands:

```rust
#[tauri::command]
async fn plan_agent_action(
    service: State<'_, PythonServiceManager>,
    input: AgentPlannerRequest,
) -> Result<AgentPlannerResponse, String> {
    service.ensure_running().await?;

    PythonClient::new(service.base_url().to_string())
        .plan_agent_action(&input)
        .await
}
```

Add `plan_agent_action` to `tauri::generate_handler![...]`.

- [ ] **Step 3: Run Rust check**

Run:

```bash
cd src-tauri
cargo check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/python_client.rs src-tauri/src/lib.rs
git commit -m "feat(agent): bridge planner through tauri"
```

## Task 10: Agent Markers, Final Tests, and Verification

**Files:**
- Modify: `src/eeg/EegControls.tsx`
- Modify: `src/pages/home/VideoRegulation.tsx`
- Modify: `src/pages/home/MusicRegulation.tsx`
- Modify: `src/agent/useExperimentAgent.ts`

- [ ] **Step 1: Add stable EEG markers**

In `src/eeg/EegControls.tsx`, add markers to the existing control buttons:

```tsx
data-agent-action="start-eeg-device"
data-agent-action="stop-eeg-device"
data-agent-action="start-eeg-recording"
data-agent-action="pause-eeg-recording"
data-agent-action="resume-eeg-recording"
data-agent-action="stop-and-save-eeg-recording"
```

Keep existing disabled logic and handlers unchanged.

- [ ] **Step 2: Add video markers**

In `src/pages/home/VideoRegulation.tsx`, add this marker to each play button:

```tsx
data-agent-action="play-video"
```

Do not change `setActiveVideo(video)` behavior in this task.

- [ ] **Step 3: Add music markers**

In `src/pages/home/MusicRegulation.tsx`, add this marker to the generate submit button:

```tsx
data-agent-action="generate-music"
```

Add this marker to the primary audio play/pause button:

```tsx
data-agent-action="play-music"
```

- [ ] **Step 4: Keep automatic execution conservative**

Confirm `src/agent/useExperimentAgent.ts` does not programmatically click arbitrary DOM nodes. The only allowed execution paths are:

```ts
navigateTo(path);
await eeg.startDevice();
await eeg.stopDevice();
await eeg.startRecord();
eeg.pauseRecord();
eeg.resumeRecord();
await eeg.stopRecord();
await generateMusicFromAgentPreview();
```

For video, the MVP may recommend the nearest finite catalog item and require confirmation before playback. For music, the agent may call the existing generation path only after a constrained preview and explicit confirmation. No action may be implemented as arbitrary DOM clicking.

- [ ] **Step 5: Run all agent and affected domain tests**

Run:

```bash
pnpm test -- src/agent/agentFlow.test.ts src/agent/agentIntent.test.ts src/agent/agentActions.test.ts src/agent/agentContext.test.ts src/agent/agentVideo.test.ts src/agent/agentMusic.test.ts src/eeg/eegSessionState.test.ts src/video/videoRegulationCatalog.test.ts src/music/musicPrompt.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full build**

Run:

```bash
pnpm run build
```

Expected: PASS.

- [ ] **Step 7: Manual smoke test in dev server**

Run:

```bash
pnpm run dev
```

Expected: Vite prints a local URL, usually `http://localhost:5173/`.

Open the app and verify:

- The assistant panel is visible in the Home shell.
- Typing `下一步` navigates to EEG acquisition.
- Typing `开始基线采集` opens a confirmation for starting the EEG device and recording.
- Rejecting confirmation leaves state unchanged and shows cancellation text.
- Confirming the stop-save-next action stops and saves EEG before navigation; failed save does not navigate.
- Typing `跳过游戏` on the game page navigates to music regulation.
- A no-exact-match video request recommends the nearest available finite catalog video.
- Music generation shows a constrained preview and requires confirmation before calling the existing generation path.
- With LM Studio unavailable, the panel stays visible, reports unavailable intelligence, and the manual flow still works.
- Typing unsupported text shows the unknown request message.
- The next-page button remains visible and not covered by the assistant panel on desktop and mobile widths.

- [ ] **Step 8: Commit**

```bash
git add src/eeg/EegControls.tsx src/pages/home/VideoRegulation.tsx src/pages/home/MusicRegulation.tsx src/agent/useExperimentAgent.ts
git commit -m "feat(agent): add assistant action markers"
```

## Self-Review

Spec coverage:

- Subject-facing assistant panel: Task 6.
- Manual input first and STT-compatible text boundary: Tasks 2 and 6.
- Fixed experiment flow with baseline and recovery: Task 1.
- Safe navigation and confirmation policy: Tasks 2 and 5.
- EEG sensitive operations through existing guards: Task 5.
- EEG compound action behavior: Tasks 2 and 5.
- Video finite catalog behavior: Task 3.
- Personalized follow-up context and in-memory timeline: Task 4.
- Music generation preview and constrained parameters: Task 4.
- Music generation through existing frontend/backend path after confirmation: Tasks 4, 5, and 7.
- Game unavailable skip behavior: Tasks 1, 2, and 5.
- LangGraph planner behind typed action boundary: Tasks 7, 8, and 9.
- LM Studio availability and validated model output: Task 8.
- Mental-scale-state recommendation without EEG inputs: Task 8.
- Tauri bridge to Python planner service: Task 9.
- Rejection of recommendation-only or invalid model actions before execution: Task 7.
- Stable UI action markers: Task 10.

Placeholder scan:

- No `TBD`, `TODO`, or undefined feature placeholders are present.
- The plan keeps execution conservative: video playback and music generation require confirmation, and the exact allowed execution paths are stated.
- The planner has exact request and response schemas and does not require EEG state.

Type consistency:

- `AgentPhase`, `AgentActionId`, and `PendingAgentConfirmation` are defined before use.
- Tests and implementation use the same action ids.
- The hook return shape matches the panel props.
- `AgentPlannerRequest` and `AgentPlannerResponse` are represented in TypeScript, Rust, and Python with camelCase JSON boundaries.
