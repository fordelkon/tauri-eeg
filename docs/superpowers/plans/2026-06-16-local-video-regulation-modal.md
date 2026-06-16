# Local Video Regulation Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Video Regulation experience where all tag selections can start a large modal playback window for `C:\mp4_videos\14.mp4`, while preserving a catalog/filter interface for future multi-video support.

**Architecture:** Add a small video catalog module that owns tag options, the seeded local video asset, filtering, and playable URL conversion. Replace the placeholder Video Regulation page with a tag-driven video selection workspace and a large regulation playback modal. Keep future scan/database integration behind the catalog shape rather than hardcoding UI behavior.

**Tech Stack:** React, TypeScript, Vitest, CSS Modules, UnoCSS utilities, Tauri asset URL conversion.

---

### Task 1: Video Catalog

**Files:**
- Create: `src/video/videoRegulationCatalog.ts`
- Create: `src/video/videoRegulationCatalog.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/video/videoRegulationCatalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getDefaultVideoSelections,
  getVideoRegulationCatalog,
  toPlayableVideoUrl,
} from './videoRegulationCatalog';

describe('videoRegulationCatalog', () => {
  it('seeds the local regulation video for every default tag selection', () => {
    const selections = getDefaultVideoSelections();
    const videos = getVideoRegulationCatalog(selections);

    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      id: 'seed-local-14',
      title: 'Local Regulation Video 14',
      sourcePath: 'C:\\mp4_videos\\14.mp4',
    });
    expect(videos[0].tags.emotionTargets).toContain(selections.emotionTargets[0]);
    expect(videos[0].tags.videoTypes).toContain(selections.videoTypes[0]);
    expect(videos[0].tags.stimulusLevels).toContain(selections.stimulusLevels[0]);
  });

  it('keeps the seed video available for non-default tag combinations during the placeholder phase', () => {
    const videos = getVideoRegulationCatalog({
      emotionTargets: ['reduce-anxiety'],
      stimulusLevels: ['high-stimulus'],
      videoTypes: ['abstract-visual'],
    });

    expect(videos).toHaveLength(1);
    expect(videos[0].sourcePath).toBe('C:\\mp4_videos\\14.mp4');
  });

  it('converts a Windows path into a playable local video URL', () => {
    expect(toPlayableVideoUrl('C:\\mp4_videos\\14.mp4')).toBe('file:///C:/mp4_videos/14.mp4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/video/videoRegulationCatalog.test.ts`

Expected: FAIL because `src/video/videoRegulationCatalog.ts` does not exist.

- [ ] **Step 3: Implement catalog**

Create `src/video/videoRegulationCatalog.ts` with typed tag options, a seeded video object for `C:\mp4_videos\14.mp4`, `getDefaultVideoSelections`, `getVideoRegulationCatalog`, and `toPlayableVideoUrl`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/video/videoRegulationCatalog.test.ts`

Expected: PASS.

### Task 2: Video Regulation UI

**Files:**
- Modify: `src/pages/home/VideoRegulation.tsx`
- Create: `src/pages/home/VideoRegulation.module.css`

- [ ] **Step 1: Replace placeholder page**

Use the catalog module to render:
- Header with current readiness state.
- Three tag groups: emotion target, video type, stimulus intensity.
- A filtered video list. For now all selections show one card for `Local Regulation Video 14`.
- `Start Regulation` button that opens a modal.

- [ ] **Step 2: Add large modal playback**

The modal should:
- Cover the page with a dark overlay.
- Use a large dialog around `min(92vw, 1280px)` wide and `min(86vh, 820px)` tall.
- Render `<video controls autoPlay src={toPlayableVideoUrl(activeVideo.sourcePath)} />`.
- Provide `End Session` and close controls.
- Close on overlay click and `Escape`.

- [ ] **Step 3: Add focused CSS**

Use CSS Module for visual styling and UnoCSS for simple layout utilities in TSX. Avoid a small embedded player; video playback belongs in the large modal.

### Task 3: Verification

**Files:**
- Verify: `src/video/videoRegulationCatalog.test.ts`
- Verify: full frontend test/build

- [ ] **Step 1: Run focused test**

Run: `pnpm test src/video/videoRegulationCatalog.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `pnpm run build`

Expected: PASS. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-16-local-video-regulation-modal.md src/video/videoRegulationCatalog.ts src/video/videoRegulationCatalog.test.ts src/pages/home/VideoRegulation.tsx src/pages/home/VideoRegulation.module.css
git commit -m "feat(video): add local regulation playback modal"
```
