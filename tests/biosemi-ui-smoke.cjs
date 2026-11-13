// Exercise the actual UI with simulated IPC; never send hardware pulses.
const { chromium } = require('playwright-core');
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
    localStorage.setItem('tauri-eeg.currentUser', JSON.stringify({ id: 'smoke-user', username: 'sub-001' }));
    localStorage.setItem('tauri-eeg.homeIntroPlayed.smoke-user', 'true');
    const calls = [];
    let connected = false;
    let tested = false;
    window.__BIOSEMI_CALLS__ = calls;
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        calls.push({ command, args });
        const status = () => ({ connected, tested, portName: connected ? 'COM7' : null, activeRunId: null, lastError: null });
        if (command === 'reserve_bdf_destination') {
          const plan = args.input;
          const task = plan.kind === 'effect_evaluation' ? (plan.condition === 'natural_recovery' ? 'rest' : plan.method) : plan.kind;
          const runIndex = calls.filter(c => c.command === command).length;
          const fileName = 'sub-' + plan.subjectId.replace(/^sub-/, '') + '_ses-01_task-' + task + '_run-' + String(runIndex).padStart(2,'0') + '_eeg.bdf';
          return {runIndex, fileName, path: 'C:/smoke/account/' + fileName};
        }
        if (command === 'trigger_list_ports') return [{ portName: 'COM7', description: 'BioSemi USB Trigger Interface' }];
        if (command === 'trigger_status') return status();
        if (command === 'trigger_test') {
          await new Promise(resolve => { window.__RELEASE_TEST__ = resolve; });
          tested = true;
          return status();
        }
        if (command === 'trigger_connect') { connected = true; return status(); }
        if (command === 'trigger_disconnect') { connected = false; tested = false; return status(); }
        if (command === 'experiment_list' || command.startsWith('list_')) return [];
        if (command === 'get_storage_location') return { root: 'C:\\smoke' };
        if (command === 'load_paradigm_video_library') {
          if (!JSON.stringify(args).includes('smoke')) throw new Error('Fixture library is unavailable until selected.');
          const clip = { videoId: 'smoke-clip', absolutePath: '/video_paradigm/Anxiety/anxiety_vid01.mp4', fileName: 'anxiety_vid01.mp4' };
          return { rootPath: 'C:\\smoke\\videos', anxiety: window.__SMOKE_CLIP_READY__ ? [clip] : [], depression: [], fear: [], calm: [], valid: true, problems: [], readinessWarnings: [] };
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
    assert.equal(await page.getByLabel('被试 ID', {exact:true}).inputValue(),'sub-001');
    await page.getByLabel('被试 ID', {exact:true}).fill('');
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
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isDisabled(), true);
    await step('选择实验');
    await page.getByLabel('被试 ID', { exact: true }).fill('smoke-subject');
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isEnabled(), true);

    await step('选择实验');
    await page.getByLabel('模式', { exact: true }).selectOption('formal');
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isDisabled(), true);
    await step('连接与测试');
    await page.getByRole('button', { name: '连接触发盒', exact: true }).click();
    await page.getByText('触发盒已连接 · COM7 · 未测试', { exact: true }).waitFor();
    const reservedCount = () => page.evaluate(() => window.__BIOSEMI_CALLS__.filter(c => c.command === 'reserve_bdf_destination').length);
    await page.getByRole('button', {name:'准备并复制短测试 BDF 路径'}).click();
    const testPath = await page.getByLabel('短测试 BDF 路径',{exact:true}).inputValue();
    assert.match(testPath, /acq-triggercheck_run-01_eeg.bdf$/);
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
    await page.getByRole('button',{name:'复制正式 BDF 路径',exact:true}).click();
    const firstPath = await page.getByLabel('正式 BDF 路径',{exact:true}).inputValue();
    assert.equal(firstPath,testPath.replace('_acq-triggercheck',''));
    assert.equal(await reservedCount(),1);
    await page.getByRole('checkbox', {name:'我已在 ActiView 启动本次 BDF 保存'}).check();
    await step('选择实验');
    await page.getByLabel('被试 ID',{exact:true}).fill('smoke-subject-2');
    await step('保存脑电');
    assert.equal(await page.getByLabel('正式 BDF 路径',{exact:true}).count(),0);
    assert.equal(await page.getByRole('checkbox', {name:'我已在 ActiView 启动本次 BDF 保存'}).isDisabled(),true);
    await step('选择实验');
    await page.getByLabel('被试 ID',{exact:true}).fill('smoke-subject');
    await step('保存脑电');
    await page.getByRole('button',{name:'准备并复制正式 BDF 路径'}).click();
    assert.equal(await reservedCount(),2);
    await page.getByRole('checkbox', { name: '我已在 ActiView 启动本次 BDF 保存' }).check();
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).isEnabled(), true);
    await screenshot('preparation-review.png');
    await page.getByRole('button', { name: '进入效果评价', exact: true }).click();
    await page.getByText(/该情绪类别的诱发素材池为空/).waitFor();
    const handoff = await page.evaluate(() => JSON.parse(sessionStorage.getItem('effectEvaluation.flowState.v1')));
    assert.equal(handoff.step, 1);
    assert.equal(handoff.subjectId, 'smoke-subject');
    assert.equal(handoff.protocol, 'brief');
    assert.equal(handoff.runMode, 'formal');
    assert.equal(await page.getByLabel('被试 ID', { exact: true }).count(), 0);
    assert.equal(await page.getByText('目标情绪:', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '开始播放视频', exact: true }).count(), 0);
    await page.getByRole('button', { name: '重置流程', exact: true }).click();
    await page.getByRole('button', { name: '停止并重置', exact: true }).click();
    await go();
    await step('连接与测试');
    await page.getByRole('button', { name: '连接触发盒', exact: true }).click();
    await page.getByText('触发盒已连接 · COM7 · 未测试', { exact: true }).waitFor();
    await step('选择实验');
    await page.getByRole('button', { name: /^逐试次范式/ }).click();
    await page.getByLabel('范式类型',{exact:true}).selectOption('held_out_generation');
    await page.getByLabel('模式', { exact: true }).selectOption('rehearsal');
    await step('核对并进入');
    assert.equal(await page.getByRole('button', { name: '进入效果评价', exact: true }).count(), 0);
    await page.getByRole('button', { name: '进入逐试次范式', exact: true }).click();
    await page.getByRole('heading', { name: '逐试次范式', exact: true }).waitFor();
    assert.equal(await page.getByText('准备模式：排练', { exact: true }).isVisible(), true);

    await page.goto(`${origin}/effect-evaluation`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '情绪调控效果评价', exact: true }).waitFor();
    await page.getByRole('button', { name: '前往实验设置', exact: true }).click();
    await page.getByRole('heading', { name: '实验设置', exact: true }).waitFor();
    await page.evaluate(() => { window.__SMOKE_CLIP_READY__ = true; });
    await page.getByLabel('被试 ID', { exact: true }).fill('ready-subject');
    await step('核对并进入');
    await page.getByRole('button', { name: '进入效果评价', exact: true }).click();
    const play = page.getByRole('button', { name: '开始播放视频', exact: true });
    await play.waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '开始播放视频' && !button.disabled));
    assert.equal(await page.getByLabel('被试 ID', { exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /anxiety_vid01|焦虑|抑郁|恐惧/);
    await page.getByRole('button', { name: '返回实验设置', exact: true }).click();
    await page.getByRole('heading', { name: '实验设置', exact: true }).waitFor();
    assert.equal(await page.getByLabel('被试 ID', { exact: true }).inputValue(), 'ready-subject');
    const startedRuns = await page.evaluate(() => window.__BIOSEMI_CALLS__.filter(call => call.command === 'experiment_start').length);
    assert.equal(startedRuns, 0, 'Loading or revising a prepared evaluation must never start acquisition');
    assert.deepEqual(errors, []);
    console.log('Passed: five steps, small/wide layout, formal prerequisites, both destinations, direct entry, empty-pool gate, video readiness and return to preparation. Simulated IPC; no hardware pulses.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
