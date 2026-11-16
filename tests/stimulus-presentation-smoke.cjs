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
      window.records = [];
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
          if (cmd === 'save_scale_record') {
            window.records.push(args.input);
            return { id: args.input.phase };
          }
          if (cmd === 'compute_regulation_effect') {
            const [t0, t1, t2] = window.records.map(record => record.dimensionScores);
            return { emotionChanges: Object.keys(t0).map(dimension => ({
              dimension, preInduction: t0[dimension], baseline: t1[dimension], post: t2[dimension],
              inductionChange: t1[dimension] - t0[dimension], conditionChange: t2[dimension] - t1[dimension],
            })) };
          }
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
    await page.getByLabel('核对并进入', { exact: true }).getByRole('button', { name: '进入效果评价', exact: true }).click();
    const rating = page.getByRole('dialog', { name: '此刻的情绪感受' });
    let firstWords;
    async function fillRating(phase, values) {
      await rating.waitFor();
      await rating.getByText(phase, { exact: true }).waitFor();
      const rows = rating.locator('fieldset');
      const words = await rows.locator('legend').allTextContents();
      assert.equal(words.length, 12);
      if (firstWords) assert.deepEqual(words, firstWords);
      else firstWords = words;
      assert.equal(await rating.locator('input:checked').count(), 0);
      const submit = rating.getByRole('button', { name: '提交评分' });
      assert.equal(await submit.isDisabled(), true);
      for (const row of await rows.all()) {
        const id = await row.locator('input').first().getAttribute('name');
        const value = ['sad', 'empty', 'grief', 'lonely'].includes(id) ? values.sadness :
          ['scared', 'panic', 'terror', 'fear'].includes(id) ? values.fear : values.anxiety;
        await row.locator(`input[value="${value}"]`).check();
      }
      await submit.click();
      await rating.waitFor({ state: 'hidden' });
    }
    await page.getByRole('button', { name: '填写观看前感受' }).click();
    const scores = [
      { anxiety: 2, sadness: 1, fear: 1 },
      { anxiety: 6, sadness: 1, fear: 4 },
      { anxiety: 3, sadness: 1, fear: 3 },
    ];
    await fillRating('诱发前', scores[0]);
    assert.deepEqual(await page.evaluate(() => window.markers), ['pre_induction_scale_start', 'pre_induction_scale_submit']);
    await page.getByRole('button', { name: '开始播放视频', exact: true }).click();
    await page.waitForFunction(() => window.markers.includes('anxiety_video_start'));
    const stimulus = page.locator('[data-playing="true"]');
    assert.equal((await stimulus.innerText()).trim(), '');
    assert.equal(await stimulus.locator('video').evaluate((v) => v.controls), false);
    await page.keyboard.press('Control+Shift+s');
    await fillRating('诱发后', scores[1]);
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
    await fillRating('条件结束后', scores[2]);
    const result = page.getByRole('region', { name: '三次情绪评分' });
    await result.waitFor();
    assert.equal(await result.getByRole('row').count(), 4);
    assert.match(await result.innerText(), /目标情绪「焦虑」在诱发后上升 4 分，自然恢复后下降 3 分/);
    const records = await page.evaluate(() => window.records);
    assert.deepEqual(records.map(record => record.phase), ['pre_induction', 'baseline', 'post']);
    assert.ok(records.every(record => record.experimentRunId === 'qa-run'));
    for (const [index, record] of records.entries()) {
      assert.equal(record.scaleId, 'deq_zh_state_12_v1');
      assert.equal(record.rawAnswers.timeframe, 'now');
      assert.equal(Object.keys(record.rawAnswers.deq).length, 12);
      assert.equal(record.rawAnswers.deq.nervous, scores[index].anxiety);
      assert.equal(record.rawAnswers.deq.lonely, scores[index].sadness);
      assert.equal(record.rawAnswers.deq.panic, scores[index].fear);
      assert.deepEqual(record.dimensionScores, scores[index]);
    }
    assert.equal(await page.evaluate(() => window.markers.at(-1)), 'post_scale_submit');
    console.log(
      'Verified video presentation, fixation, three DEQ submissions and target-emotion changes in the final report. Simulated IPC.'
    );
  } finally {
    await browser.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
