// Exercise the actual UI with simulated IPC; never send hardware pulses.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
        if (command === 'trigger_status') return status();
        if (command === 'trigger_test') {
          await new Promise(resolve => { window.__RELEASE_TEST__ = resolve; });
          return status();
        }
        if (command === 'trigger_connect') { connected = true; return status(); }
        if (command === 'trigger_disconnect') { connected = false; return status(); }
        if (command === 'experiment_list' || command.startsWith('list_')) return [];
        if (command === 'get_storage_location') return { root: 'C:\\smoke' };
        if (command === 'load_paradigm_video_library') {
          if (!JSON.stringify(args).includes('smoke')) throw new Error('Fixture library is unavailable until selected.');
          return { rootPath: 'C:\\smoke\\videos', anxiety: [], depression: [], fear: [], calm: [], valid: true, problems: [], readinessWarnings: [] };
        }
        return {};
      },
      transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: file => file,
    };
  });
  const origin = process.env.BIOSEMI_SMOKE_URL || 'http://127.0.0.1:1421';
  const output = process.env.BIOSEMI_SMOKE_OUTPUT;
  if (output) fs.mkdirSync(output, { recursive: true });
  const screenshot = async name => { if (output) await page.screenshot({ path: path.join(output, name), fullPage: true, timeout: 10000 }); };
  const go = async () => {
    await page.goto(`${origin}/experiment-settings`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '实验设置', exact: true }).waitFor();
    const skip = page.getByRole('button', { name: '跳过', exact: true });
    if (await skip.isVisible()) await skip.click();
  };
  const step = title => page.getByRole('navigation', { name: '实验准备步骤' }).getByRole('button', { name: new RegExp(title) }).click();
  try {
    await go();
    await screenshot('preparation-wide.png');
    await page.setViewportSize({ width: 800, height: 600 });
    assert.equal(await page.getByRole('button', { name: '继续：连接与测试', exact: true }).isVisible(), true);
    await screenshot('preparation-small.png');
    const next = page.getByRole('button', { name: '下一步：连接与测试', exact: true });
    await next.scrollIntoViewIfNeeded();
    const smallBox = await next.boundingBox();
    assert.ok(smallBox && smallBox.y >= 0 && smallBox.y + smallBox.height <= 600);
    await screenshot('preparation-small-scrolled.png');
    await page.setViewportSize({ width: 1440, height: 900 });

    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isDisabled(), true);
    await step('准备素材');
    await page.getByLabel('素材库根目录', { exact: true }).fill('C:\\smoke\\videos');
    await page.getByRole('button', { name: '验证并保存素材库', exact: true }).click();
    await page.getByText(/素材库已验证：/).waitFor();
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isEnabled(), true);

    await step('选择实验');
    await page.getByLabel('模式', { exact: true }).selectOption('formal');
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isDisabled(), true);
    await step('连接与测试');
    await page.getByRole('button', { name: '连接触发盒', exact: true }).click();
    await page.getByText('触发盒已连接 · COM7', { exact: true }).waitFor();
    const test = page.getByRole('button', { name: '发送测试 Trigger', exact: true });
    const textBox = () => test.evaluate(element => {
      const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange(); range.selectNodeContents(text);
      const box = range.getBoundingClientRect();
      return { y: box.y, height: element.getBoundingClientRect().height };
    });
    const before = await textBox();
    await test.click();
    await page.waitForFunction(() => typeof window.__RELEASE_TEST__ === 'function');
    assert.equal(await test.isDisabled(), true);
    const during = await textBox();
    assert.ok(Math.abs(before.y - during.y) < 1, 'Loading must not move button text down');
    assert.ok(Math.abs(before.height - during.height) < 1, 'Loading must not resize button height');
    await page.evaluate(() => window.__RELEASE_TEST__());
    await page.getByText('测试码 254 已写入串口。请在 ActiView 和短 BDF 中确认标记。', { exact: true }).waitFor();
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isDisabled(), true);
    await screenshot('preparation-missing-recording.png');
    await step('保存脑电');
    await page.getByLabel('BDF 记录名', { exact: true }).fill('sub01_effect_run01.bdf');
    await page.getByRole('checkbox', { name: '我已在 ActiView 启动本次 BDF 保存' }).check();
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isEnabled(), true);
    await screenshot('preparation-review.png');
    await page.getByRole('button', { name: '进入效果评价', exact: true }).click();
    await page.getByRole('heading', { name: /效果评价/ }).first().waitFor();
    assert.equal(await page.getByText('正式实验', { exact: true }).isVisible(), true);
    await go();
    await step('连接与测试');
    await page.getByRole('button', { name: '连接触发盒', exact: true }).click();
    await page.getByText('触发盒已连接 · COM7', { exact: true }).waitFor();
    await step('选择实验');
    await page.getByRole('button', { name: /^逐试次范式/ }).click();
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).count(), 0);
    await page.getByRole('button', { name: '进入逐试次范式', exact: true }).click();
    await page.getByRole('heading', { name: '逐试次范式', exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: '正式 · 发送 Trigger', exact: true }).getAttribute('aria-checked'), 'false');

    await page.goto(`${origin}/effect-evaluation`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '情绪调控效果评价', exact: true }).waitFor();
    const begin = page.getByRole('button', { name: '确认配置，开始诱发', exact: true });
    assert.equal(await begin.isDisabled(), true);
    await page.getByLabel('被试 ID', { exact: true }).fill('architecture-subject');
    await begin.click();
    await page.getByText('该情绪类别的诱发素材池为空，无法播放诱发素材。请先在实验设置页补充对应类别的素材，本步骤为流程硬前置，不提供跳过。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '开始播放诱发视频', exact: true }).count(), 0);
    await page.getByRole('button', { name: '重置流程', exact: true }).click();
    await page.getByRole('button', { name: '停止并重置', exact: true }).click();
    await begin.waitFor();
    assert.equal(await page.getByLabel('被试 ID', { exact: true }).inputValue(), '');
    const startedRuns = await page.evaluate(() => window.__BIOSEMI_CALLS__.filter(call => call.command === 'experiment_start').length);
    assert.equal(startedRuns, 0, 'An empty induction pool must never start an experiment');
    assert.deepEqual(errors, []);
    console.log('Passed: five steps, small/wide layout, formal prerequisites, stable loading, experiment destinations, effect setup, empty-pool gate and reset. Simulated IPC; no hardware pulses.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
