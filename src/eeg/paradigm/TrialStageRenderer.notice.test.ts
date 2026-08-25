// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Normalize CRLF so multi-line needles match regardless of checkout settings.
const readText = (url: URL) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');

/**
 * The fullscreen stage portals mount at document.body above .content's
 * stacking context, so panel-level error banner retry buttons are unreachable
 * whenever a stage covers the screen. These contracts pin the mirror path:
 * command failures must reach every stage as a notice carrying clickable
 * retry actions.
 */
describe('fullscreen stage error notices stay actionable', () => {
  const rendererTsx = readText(new URL('./TrialStageRenderer.tsx', import.meta.url));
  const runnerTsx = readText(new URL('./ParadigmRunner.tsx', import.meta.url));
  const css = readText(new URL('./ParadigmSession.module.css', import.meta.url));

  test('StageNoticeBar renders message plus one button per action', () => {
    expect(rendererTsx).toContain('actions?: readonly TrialStageNoticeAction[];');
    expect(rendererTsx).toContain('export function StageNoticeBar');
    expect(rendererTsx).toContain('(notice.actions ?? []).map((action)');
    expect(rendererTsx).toContain('className={styles.stageActionButton}');
    expect(rendererTsx).toContain('onClick={action.onClick}');
    // Both renderer branches (video + countdown stages) surface the notice.
    expect(rendererTsx.match(/{stageNotice \? <StageNoticeBar notice=\{stageNotice\} \/>\ : null}/g)?.length).toBe(2);
  });

  test('runner mirrors command failures into the trial stage renderer and its own portals', () => {
    expect(runnerTsx).toContain('stageNotice={stageNotice}');
    // The runner's own fullscreen portals (interTrial + qualityCheck).
    expect(runnerTsx.match(/{stageNotice \? <StageNoticeBar notice=\{stageNotice\} \/>\ : null}/g)?.length).toBe(2);
    expect(runnerTsx).toContain("import TrialStageRenderer, {\n  StageNoticeBar,");
  });

  test('all three retry commands are offered as stage actions', () => {
    expect(runnerTsx).toContain("label: '重试开始试次'");
    expect(runnerTsx).toContain("label: '重试结束试次'");
    expect(runnerTsx).toContain("label: '重试保存试次'");
    expect(runnerTsx).toContain('{ label: \'重试开始试次\', onClick: handleRetryBegin }');
    expect(runnerTsx).toContain('{ label: \'重试结束试次\', onClick: handleRetryEndTrial }');
    expect(runnerTsx).toContain("{ label: '重试保存试次', onClick: handleRetryFinalize }");
  });

  test('stage titles no longer promise progress while a command failure is shown', () => {
    const qualityCheckBlock = runnerTsx.match(/trialPhase === 'qualityCheck' \? \([\s\S]*?\)\ : null\}/)?.[0] ?? '';
    expect(qualityCheckBlock).toContain("stageNotice\n                  ? '试次保存失败'");

    const interTrialBlock = runnerTsx.match(/isStartingTrial\s+\?\s+'正在开始试次…'[\s\S]*?'准备下一个试次'/)?.[0] ?? '';
    expect(interTrialBlock).toContain("'试次启动失败'");
  });

  test('notice bar lays out inline so its retry buttons are visible and clickable', () => {
    const block = css.match(/\.stageNoticeBar\s*{[^}]*}/s)?.[0] ?? '';
    expect(block).toMatch(/display:\s*flex;/);
    expect(block).toMatch(/flex-wrap:\s*wrap;/);
    // The stale claim that the panel banner floats above the stage is gone.
    expect(css).not.toContain('Stays clickable above the fixed fullscreen trial stage.');
  });
});
