// Run against the local UI with Playwright available, as for button-ui-audit.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const origin = process.env.SELECT_AUDIT_URL || 'http://127.0.0.1:1420';
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
      reducedMotion: 'reduce',
    });
    await page.addInitScript(() => {
      const user = { id: 'select-audit', username: 'select-audit' };
      localStorage.setItem('tauri-eeg.currentUser', JSON.stringify(user));
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args) => {
          if (command === 'trigger_status')
            return { connected: false, portName: null, activeRunId: null, lastError: null };
          if (command === 'trigger_list_ports')
            return [{ portName: 'COM10', description: 'Test device' }];
          if (command === 'trigger_connect')
            return { connected: true, portName: args.portName, activeRunId: null, lastError: null };
          if (command.startsWith('list_') || command === 'experiment_list') return [];
          return {};
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        convertFileSrc: (file) => file,
      };
    });
    await page.goto(origin + '/experiment-settings');
    const mode = page.getByRole('combobox', { name: '模式', exact: true });
    const previous = await mode.inputValue();
    await mode.focus();
    await page.keyboard.press('Space');
    assert(await mode.evaluate((e) => e.matches(':open')));
    assert.equal(
      await mode.evaluate((e) => getComputedStyle(e, '::picker(select)').appearance),
      'base-select',
    );
    if (process.env.SELECT_AUDIT_IMAGE)
      await page.screenshot({ path: process.env.SELECT_AUDIT_IMAGE });
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    assert.equal(await mode.inputValue(), previous);
    await page.keyboard.press('Space');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await mode.inputValue(), 'formal');
    assert(await mode.evaluate((e) => e === document.activeElement));

    await page.getByText('研究者配置', { exact: false }).first().click();
    const duration = page.getByRole('combobox', { name: /条件时长/ });
    for (const [width, zoom] of [
      [1100, 1],
      [800, 1.25],
      [480, 1.5],
    ]) {
      await page.setViewportSize({ width, height: 760 });
      await page.evaluate((scale) => {
        document.body.style.zoom = String(scale);
      }, zoom);
      await duration.click();
      const bounds = await duration.evaluate((select) => {
        const field = select.getBoundingClientRect();
        const label = select.parentElement.getBoundingClientRect();
        const card = select.closest('details').getBoundingClientRect();
        const option = select.options[0].getBoundingClientRect();
        return {
          fieldFits: field.left >= label.left - 1 && field.right <= label.right + 1,
          menuFits: option.left >= card.left && option.right <= card.right,
        };
      });
      assert(bounds.fieldFits, `Duration field overflows its label at ${width}px / ${zoom}x`);
      assert(bounds.menuFits, `Duration menu overflows its card at ${width}px / ${zoom}x`);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => {
      document.body.style.zoom = '';
    });
    await page.setViewportSize({ width: 1100, height: 760 });
    await duration.click();
    await page.getByRole('option', { name: '30', exact: true }).click();
    assert.equal(await duration.inputValue(), '30');

    await page.getByRole('button', { name: /逐试次范式/ }).click();
    const kind = page.getByRole('combobox', { name: '范式类型' });
    const lastKind = await kind.locator('option').last().getAttribute('value');
    await kind.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await kind.inputValue(), lastKind);

    await page
      .getByRole('navigation', { name: '实验准备步骤' })
      .getByRole('button', { name: /连接与测试/ })
      .click();
    const port = page.getByRole('combobox', { name: 'COM 端口' });
    await port.click();
    await page.getByRole('option', { name: /COM10/ }).click();
    assert.equal(await port.inputValue(), 'COM10');
    await page.getByRole('button', { name: '连接触发盒', exact: true }).click();
    await page.getByRole('button', { name: '断开触发盒', exact: true }).waitFor();
    assert(await port.isDisabled());

    await page.setViewportSize({ width: 800, height: 600 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.goto(origin + '/music-regulation');
    const length = page.getByRole('combobox', { name: '长度', exact: true });
    await length.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await length.inputValue(), '120');
    console.log(
      'Passed all five native selects, keyboard selection, cancellation and focus return.',
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
