const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const origin = process.env.STIMULUS_URL || 'http://127.0.0.1:1434';
    await page.addInitScript(() => {
      localStorage.setItem('tauri-eeg.currentUser', JSON.stringify({ id: 'qa', username: 'qa' }));
      localStorage.setItem('tauri-eeg.homeIntroPlayed.qa', 'true');
      window.markers = [];
      window.__TAURI_INTERNALS__ = {
        convertFileSrc: (path) => path,
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (cmd, args) => {
          if (cmd === 'trigger_status') return { connected: false, activeRunId: null };
          if (cmd === 'load_paradigm_video_library') {
            const clip = {
              fileName: 'test-clip.mp4',
              videoId: 'clip',
              absolutePath: '/video_paradigm/Anxiety/anxiety_vid01.mp4',
            };
            return {
              rootPath: 'videos',
              valid: true,
              anxiety: [clip],
              depression: [],
              fear: [],
              calm: [clip],
            };
          }
          if (cmd === 'experiment_start') return { runId: 'qa-run' };
          if (cmd === 'experiment_event') {
            window.markers.push(args.input.event);
            return { result: 'rehearsal' };
          }
          if (cmd === 'save_scale_record') return { id: args.input.phase };
          if (
            cmd === 'list_effect_history' ||
            cmd === 'experiment_list' ||
            cmd === 'trigger_list_ports'
          )
            return [];
          return {};
        },
      };
    });
    await page.goto(origin + '/experiment-settings');
    await page.getByLabel('被试 ID', { exact: true }).fill('test01');
    await page.getByRole('button', { name: /05 核对并进入/ }).click();
    await page.getByRole('button', { name: '进入效果评价', exact: true }).click();
    await page.getByRole('button', { name: '开始播放视频', exact: true }).click();
    await page.waitForFunction(() => window.markers.includes('anxiety_video_start'));
    const stimulus = page.locator('[data-playing="true"]');
    assert.equal((await stimulus.innerText()).trim(), '');
    assert.equal(await stimulus.locator('video').evaluate((v) => v.controls), false);
    await page.keyboard.press('Control+Shift+s');
    const rating = page.getByRole('dialog', { name: '此刻感受' });
    await rating.waitFor();
    for (const name of ['愉悦度', '唤醒度', '控制感'])
      await rating.getByRole('radio', { name: name + ' 3', exact: true }).check();
    await rating.getByRole('button', { name: '提交评分' }).click();
    await page.getByRole('button', { name: '开始静息' }).click();
    const fix = page.getByRole('dialog', { name: '静息，请注视中央十字' });
    await fix.waitFor();
    assert.equal((await fix.innerText()).trim(), '');
    const box = await fix.boundingBox();
    assert.equal(box.width, 800);
    assert.equal(box.height, 600);
    await page.waitForFunction(() => window.markers.includes('natural_recovery_start'));
    if (process.env.STIMULUS_WAIT_FULL === '1') await rating.waitFor({ timeout: 68000 });
    else {
      await page.keyboard.press('Control+Shift+s');
      await rating.waitFor();
    }
    const events = await page.evaluate(() => window.markers);
    assert.equal(
      events.filter((e) => e === 'trial_skip').length,
      process.env.STIMULUS_WAIT_FULL === '1' ? 1 : 2,
    );
    assert.deepEqual(events.slice(-2), ['natural_recovery_end', 'post_scale_start']);
    console.log(
      'Verified actual clip, no overlay text, viewport-size fixation, rehearsal skip and post measurement:',
      events,
    );
  } finally {
    await browser.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
