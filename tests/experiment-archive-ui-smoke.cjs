// Run against a local preview with Playwright Core and Edge. All IPC is simulated.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const userId = 'archive-preview';
const run = {
  runId: '00000000-0000-4000-8000-000000000073',
  userId,
  subjectId: 'sub-001',
  kind: 'effect_evaluation',
  mode: 'formal',
  status: 'completed',
  emotion: 'anxiety',
  condition: 'natural_recovery',
  method: null,
  durationMinutes: 1,
  startedAt: '2026-11-13T14:25:15Z',
  endedAt: '2026-11-13T14:28:34Z',
  protocolVersion: 'deq_zh_state_12_v1',
  eventMappingVersion: '1',
  externalRecordingConfirmedAt: null,
  expectedRecordingName: 'C:/preview/sub-001/eeg_recordings/sub-001_task-effect_run-01_eeg.bdf',
  bdfFiles: [],
};

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1366, height: 800 },
      reducedMotion: 'reduce',
    });
    await page.addInitScript((record) => {
      localStorage.setItem(
        'tauri-eeg.currentUser',
        JSON.stringify({ id: record.userId, username: record.subjectId }),
      );
      window.archiveActions = [];
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args) => {
          switch (command) {
            case 'experiment_list':
              return [record];
            case 'experiment_associate_bdf':
              window.archiveActions.push({ command, args });
              record.bdfFiles = args.bdfFiles;
              return record;
            case 'plugin:dialog|open':
              return args.options.directory ? 'C:/preview/export' : null;
            case 'experiment_export':
              window.archiveActions.push({ command, args });
              return { path: 'C:/preview/export/experiment.json' };
            case 'trigger_status':
              return { connected: false, portName: null, activeRunId: null };
            default:
              return [];
          }
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        convertFileSrc: (path) => path,
      };
    }, run);
    await page.goto(
      (process.env.ARCHIVE_UI_URL || 'http://127.0.0.1:1420') + '/experiment-settings',
    );
    const header = page.locator('summary').filter({ hasText: '导出日志' }).first();
    await header.focus();
    await page.keyboard.press('Enter');
    const row = page
      .locator('summary')
      .filter({ has: page.getByText(run.subjectId, { exact: true }) });
    await row.waitFor();
    await page.waitForFunction(() => {
      const header = document.querySelector('details[open] time')?.closest('summary');
      return header && header.getBoundingClientRect().bottom <= innerHeight;
    });
    assert.match(await row.innerText(), /BDF 待关联/);
    assert(
      !(await row.innerText()).includes(run.runId),
      'The collapsed row exposes a technical identifier',
    );
    await row.click();
    for (const width of [1366, 800, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const fits = await row.evaluate((el) => {
        const archive = el.closest('details').parentElement.closest('details');
        return (
          archive.scrollWidth <= archive.clientWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth
        );
      });
      assert(fits, 'Archive overflows at ' + width + 'px');
    }
    await page.getByRole('button', { name: '核验并关联本次 BDF' }).click();
    await page.getByRole('button', { name: '重新选择 BDF 文件' }).waitFor();
    assert.match(await row.innerText(), /BDF 已关联/);
    await page.getByRole('button', { name: '导出实验日志' }).click();
    await page.getByText('C:/preview/export/experiment.json', { exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.archiveActions), [
      {
        command: 'experiment_associate_bdf',
        args: { runId: run.runId, userId, bdfFiles: [run.expectedRecordingName] },
      },
      { command: 'experiment_export', args: { runId: run.runId, path: 'C:/preview/export' } },
    ]);
    console.log('Verified record disclosure, responsive layout, BDF association and log export.');
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
