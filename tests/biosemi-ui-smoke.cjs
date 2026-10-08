// Renderer smoke test with simulated IPC. Hardware delivery is verified separately.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('tauri-eeg.currentUser', JSON.stringify({ id: 'smoke-user', username: 'smoke' }));
    localStorage.setItem('tauri-eeg.homeIntroPlayed.smoke-user', 'true');
    const calls = [];
    let connected = false;
    window.__BIOSEMI_CALLS__ = calls;
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        calls.push({ command, args });
        const status = () => ({ connected, portName: connected ? 'COM7' : null, activeRunId: null, lastError: null });
        if (command === 'trigger_list_ports') return [{ portName: 'COM7', description: 'BioSemi USB Trigger Interface' }];
        if (command === 'trigger_status' || command === 'trigger_test') return status();
        if (command === 'trigger_connect') { connected = true; return status(); }
        if (command === 'trigger_disconnect') { connected = false; return status(); }
        if (command === 'experiment_list' || command.startsWith('list_')) return [];
        if (command === 'get_storage_location') return { root: 'C:\\smoke' };
        if (command === 'load_paradigm_video_library') return {
          rootPath: 'C:\\smoke\\videos', anxiety: [], depression: [], fear: [], calm: [], happy: [],
        };
        return {};
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      convertFileSrc: file => file,
    };
  });
  try {
    const origin = process.env.BIOSEMI_SMOKE_URL || 'http://127.0.0.1:1420';
    await page.goto(`${origin}/experiment-settings`);
    console.log('Loaded settings route');
    await page.getByRole('heading', { name: '实验设置', exact: true }).waitFor();
    const skipIntro = page.getByRole('button', { name: '跳过', exact: true });
    if (await skipIntro.isVisible()) await skipIntro.click();
    await page.getByRole('button', { name: '连接触发盒', exact: true }).click();
    await page.getByText('触发盒已连接 · COM7', { exact: true }).waitFor();
    await page.getByRole('button', { name: '发送测试 Trigger', exact: true }).click();
    await page.getByText('测试码 254 已写入串口。请在 ActiView 和短 BDF 中确认标记。', { exact: true }).waitFor();
    await page.getByLabel('模式', { exact: true }).selectOption('formal');
    await page.getByLabel('BDF 记录名', { exact: true }).fill('sub01_music_run01.bdf');
    await page.getByRole('checkbox', { name: '我已在 ActiView 启动本次 BDF 保存' }).check();
    const preferences = await page.evaluate(() => JSON.parse(sessionStorage.getItem('biosemi.experimentPreferences.v1')));
    assert.deepEqual(preferences, { mode: 'formal', expectedRecordingName: 'sub01_music_run01.bdf', externalRecordingConfirmed: true });
    const calls = await page.evaluate(() => window.__BIOSEMI_CALLS__);
    assert.deepEqual(calls.find(call => call.command === 'trigger_connect').args, { portName: 'COM7' });
    assert.equal(calls.filter(call => call.command === 'trigger_test').length, 1);
    if (process.env.BIOSEMI_SMOKE_OUTPUT) await page.screenshot({ path: path.join(process.env.BIOSEMI_SMOKE_OUTPUT, 'biosemi-settings.png'), fullPage: true });
    await page.getByRole('link', { name: '进入逐试次范式' }).click();
    await page.getByRole('heading', { name: '逐试次范式', exact: true }).waitFor();
    console.log('Verified settings and paradigm route');
    await page.goto(`${origin}/effect-evaluation`);
    await page.getByRole('heading', { name: /效果评价/ }).first().waitFor();
    assert.deepEqual(errors, []);
    console.log('Renderer smoke passed: COM selection/connect/test, formal preparation, paradigm and effect routes. IPC simulated; no hardware pulse sent.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
