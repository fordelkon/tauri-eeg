// Run against the local UI with Playwright available, as for select-ui-smoke.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.addInitScript(() => {
      const user = { id: 'assistant-audit', username: 'assistant-audit' };
      localStorage.setItem('tauri-eeg.currentUser', JSON.stringify(user));
    });
    const origin = process.env.ASSISTANT_AUDIT_URL || 'http://localhost:1420';
    await page.goto(origin + '/experiment-settings', { waitUntil: 'domcontentloaded' });

    const rail = page.getByRole('region', { name: '实验助手聊天' });
    const toggle = page.getByRole('button', { name: '实验助手', exact: true });
    await toggle.click();
    await rail.getByRole('button', { name: '下一步：连接与测试' }).click();
    await page.getByRole('heading', { name: '连接与测试' }).waitFor();
    await rail.getByRole('button', { name: '下一步：准备素材' }).waitFor();

    const input = rail.getByRole('textbox', { name: '助手指令' });
    await input.fill('查看本步提示');
    await input.press('Escape');
    await rail.waitFor({ state: 'hidden' });
    assert(await toggle.evaluate((element) => element === document.activeElement));
    await toggle.click();
    assert.equal(await input.inputValue(), '查看本步提示');
    await input.press('Enter');
    await rail.getByText('排练可跳过设备连接，继续准备素材。', { exact: true }).waitFor();

    await input.fill('下一步');
    await page.setViewportSize({ width: 1280, height: 720 });
    assert.equal(await input.inputValue(), '下一步');
    await input.press('Enter');
    await page.getByRole('heading', { name: '准备素材' }).waitFor();
    await rail.getByRole('button', { name: '下一步：保存脑电' }).waitFor();
    await page
      .getByRole('navigation', { name: '实验准备步骤' })
      .getByRole('button', { name: /选择实验/ })
      .click();
    await rail.getByRole('button', { name: '下一步：连接与测试' }).waitFor();
    assert(!(await rail.getByRole('button', { name: '下一步：保存脑电' }).count()));

    await input.fill('查看');
    await input.press('Shift+Enter');
    await page.keyboard.insertText('本');
    assert.equal(await input.inputValue(), '查看\n本');
    const transcript = rail.getByRole('log');
    const previousEntries = await transcript.getByRole('listitem').count();
    await input.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.equal(await input.inputValue(), '查看\n本');
    assert.equal(await transcript.getByRole('listitem').count(), previousEntries);

    // The browser has no native planner bridge. A failed free-text request
    // must produce one visible reply and leave the current workflow intact.
    await input.fill('解释这次排练');
    await rail.getByRole('button', { name: '发送助手指令' }).click();
    const offline = transcript.getByText(
      '无法连接推荐服务。你仍可使用本地快捷指令，或稍后重新发送。',
      { exact: true },
    );
    await offline.waitFor();
    await rail.getByRole('button', { name: '下一步：连接与测试' }).click();
    await page.getByRole('heading', { name: '连接与测试' }).waitFor();
    assert.equal(await offline.count(), 1);
    assert.equal(await rail.getByText('本地指令', { exact: true }).count(), 1);

    // Hold one planner stream open long enough to enter a draft and leave
    // the page. Even a late response must not land in the new workspace.
    await page.evaluate(() => {
      window.__TAURI_INTERNALS__ = { invoke: async () => location.origin };
      const originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (!String(url).endsWith('/agent/plan/stream')) return originalFetch(url, options);
        delete window.__TAURI_INTERNALS__;
        return new Promise((resolve) => {
          options.signal.addEventListener('abort', () => {
            window.abortedPriorPlan = true;
            resolve(
              new Response(
                'event: response\ndata: {"status":"available","action":"no_op","reason":"过期回复"}\n\n',
              ),
            );
          });
        });
      };
    });
    await input.fill('说明当前材料');
    await rail.getByRole('button', { name: '发送助手指令' }).click();
    await rail.getByRole('button', { name: '取消', exact: true }).waitFor();
    await input.fill('给下一页的草稿');
    assert(await rail.getByRole('button', { name: '发送助手指令' }).isDisabled());
    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: '首页', exact: true })
      .click();
    await page.waitForURL('**/home');
    await page.waitForFunction(() => window.abortedPriorPlan === true);
    await rail.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await input.inputValue(), '给下一页的草稿');
    assert.equal(await rail.getByText('过期回复', { exact: true }).count(), 0);
    console.log(
      'Rehearsal commands, replies, drafts, IME, multiline, offline and route cancellation passed.',
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
