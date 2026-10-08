// Measure real page buttons; IPC is simulated and no device commands are sent.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const output = process.env.BUTTON_AUDIT_OUTPUT || 'docs/ui-buttons';
  fs.mkdirSync(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const results = [];
  await page.addInitScript(() => {
    localStorage.setItem('tauri-eeg.currentUser', JSON.stringify({ id: 'button-audit', username: 'button-audit' }));
    localStorage.setItem('tauri-eeg.homeIntroPlayed.button-audit', 'true');
    window.__TAURI_INTERNALS__ = {
      invoke: async command => {
        if (command === 'trigger_status') return { connected: false, portName: null, activeRunId: null, lastError: null };
        if (command === 'trigger_list_ports') return [{ portName: 'COM5', description: 'BioSemi' }];
        if (command === 'load_paradigm_video_library') return { rootPath: 'C:\\fixture', anxiety: [], depression: [], fear: [], calm: [], happy: [] };
        if (command.startsWith('list_') || command === 'experiment_list' || command === 'load_video_library') return [];
        if (command === 'get_storage_location') return { root: 'C:\\fixture' };
        return {};
      },
      transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: file => file,
    };
  });
  const origin = process.env.BUTTON_AUDIT_URL || 'http://127.0.0.1:1421';
  const visit = async route => {
    await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading').first().waitFor();
    const intro = page.getByRole('button', { name: '跳过', exact: true });
    if (await intro.isVisible()) await intro.click();
  };
  const measure = async (name, expected, scope = page) => {
    const button = scope.getByRole('button', { name, exact: true });
    await button.waitFor();
    const geometry = await button.evaluate(element => {
      const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return { height: element.offsetHeight, width: box.width, radius: style.borderRadius,
        fontSize: style.fontSize, lineHeight: style.lineHeight };
    });
    assert.ok(Math.abs(geometry.height - expected) < 0.8, `${name}: ${geometry.height}, expected ${expected}`);
    results.push({ label: name, expectedHeight: expected, ...geometry });
  };
  try {
    await visit('/experiment-settings');
    await page.getByRole('heading', { name: '实验设置', exact: true }).waitFor();
    await page.getByRole('navigation', { name: '实验准备步骤' }).getByRole('button', { name: /连接与测试/ }).click();
    await measure('刷新端口', 40); await measure('连接触发盒', 40); await measure('发送测试 Trigger', 40);
    await measure('下一步：准备素材', 44);
    await page.screenshot({ path: path.join(output, 'settings-buttons.png'), fullPage: true, timeout: 10000 });
    await page.setViewportSize({ width: 800, height: 600 });
    await measure('继续：准备素材', 32);
    await page.screenshot({ path: path.join(output, 'settings-buttons-small.png'), fullPage: true, timeout: 10000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 900 });

    await visit('/effect-evaluation');
    await page.getByRole('heading', { name: /效果评价/ }).first().waitFor();
    await measure('Trigger 与实验设置', 32);
    await page.screenshot({ path: path.join(output, 'effect-buttons.png'), fullPage: true, timeout: 10000 });

    await visit('/video-regulation');
    const videoSkip = page.getByRole('button', { name: '跳过本次', exact: true });
    await videoSkip.waitFor(); await videoSkip.click();
    await measure('选择视频库', 40); await measure('重新选择', 40);
    await page.screenshot({ path: path.join(output, 'video-buttons.png'), fullPage: true, timeout: 10000 });

    await visit('/music-regulation');
    const musicSkip = page.getByRole('button', { name: '跳过本次', exact: true });
    await musicSkip.waitFor(); await musicSkip.click();
    await measure('生成 WAV', 44);
    await page.screenshot({ path: path.join(output, 'music-buttons.png'), fullPage: true, timeout: 10000 });
    const login = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await login.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
    const submit = login.locator('button[type="submit"]');
    await submit.waitFor();
    const loginHeight = await submit.evaluate(element => element.offsetHeight);
    assert.ok(Math.abs(loginHeight - 44) < 0.8, `Login height: ${loginHeight}`);
    results.push({ label: '登录', height: loginHeight, expectedHeight: 44 });
    await login.close();
    fs.writeFileSync(path.join(output, 'button-measurements.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    console.log('Passed: shared button sizes across native and MUI pages; no horizontal overflow at 800px.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
