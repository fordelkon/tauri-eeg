// Exercise the page with simulated directory scanning; no real files or hardware are opened.
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
    window.__VIDEO_REGULATION_CALLS__ = calls;
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === 'plugin:dialog|open') return 'C:\\smoke\\replacement-root';
        if (command === 'load_paradigm_video_library') {
          const rootPath = args.input.rootPath;
          const replacement = rootPath.includes('replacement-root');
          const relativePaths = replacement
            ? ['scenery/replacement_vid04.mp4']
            : ['healing_animation/calm_vid01.mp4', 'scenery/calm_vid01.mp4', 'music/calm_vid02.mp4'];
          return {
            rootPath, anxiety: [], depression: [], fear: [],
            calm: relativePaths.map(relativePath => ({
              videoId: relativePath.replace(/\.mp4$/, ''),
              fileName: relativePath,
              absolutePath: `${replacement ? rootPath : 'C:\\smoke\\video_paradigm'}\\Calm\\${relativePath.replace(/\//g, '\\')}`,
            })),
            // Standalone browsing must work even when experimental pools are incomplete.
            valid: false, problems: ['Anxiety requires at least 5 MP4 files (found 0).'], readinessWarnings: [],
          };
        }
        if (command === 'experiment_list' || command.startsWith('list_')) return [];
        if (command === 'get_storage_location') return { root: 'C:\\smoke' };
        return {};
      },
      transformCallback: () => 1, unregisterCallback: () => {},
      convertFileSrc: file => `https://asset.localhost/${encodeURIComponent(file)}`,
    };
  });
  const origin = process.env.VIDEO_REGULATION_SMOKE_URL || 'http://127.0.0.1:1432';
  const output = process.env.VIDEO_REGULATION_SMOKE_OUTPUT;
  if (output) fs.mkdirSync(output, { recursive: true });
  const plays = () => page.getByRole('button', { name: '播放', exact: true });
  const go = async () => {
    await page.goto(`${origin}/video-regulation`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '跳过', exact: true }).click();
    await page.getByRole('button', { name: '跳过本次', exact: true }).click();
    await page.getByRole('heading', { name: '视频调控', exact: true }).waitFor();
  };
  const waitForCount = async count => {
    await page.waitForFunction(expected => [...document.querySelectorAll('button')]
      .filter(button => (button.getAttribute('aria-label') || button.textContent.trim()) === '播放').length === expected, count);
    assert.equal(await plays().count(), count);
  };
  try {
    await go();
    await waitForCount(3);
    const initialScan = await page.evaluate(() => window.__VIDEO_REGULATION_CALLS__.find(call => call.command === 'load_paradigm_video_library'));
    assert.match(initialScan.args.input.rootPath, /[\\/]video_paradigm$/);
    for (const label of ['治愈动画', '风景', '音乐']) {
      assert.equal(await page.getByRole('button', { name: new RegExp(`^${label}\\s+1$`) }).isVisible(), true);
    }
    for (const obsolete of ['森林', '海岸']) {
      assert.equal(await page.getByRole('button', { name: obsolete, exact: true }).count(), 0);
    }
    await page.getByRole('button', { name: /^治愈动画/ }).click();
    await waitForCount(1);
    await plays().first().click();
    const player = page.getByLabel('视频调节播放器', { exact: true });
    await player.waitFor();
    assert.equal(decodeURIComponent(await player.locator('video').getAttribute('src')), 'https://asset.localhost/C:\\smoke\\video_paradigm\\Calm\\healing_animation\\calm_vid01.mp4');
    await page.getByRole('button', { name: '关闭调节视频', exact: true }).click();
    assert.equal(await player.count(), 0);
    await page.getByRole('button', { name: /^风景/ }).click();
    await waitForCount(1);
    await plays().first().click();
    await player.waitFor();
    assert.equal(decodeURIComponent(await player.locator('video').getAttribute('src')), 'https://asset.localhost/C:\\smoke\\video_paradigm\\Calm\\scenery\\calm_vid01.mp4');
    await page.keyboard.press('Escape');
    assert.equal(await player.count(), 0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('agent:play-video', { detail: { videoId: 'unknown-video' } })));
    assert.equal(await player.count(), 0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('agent:play-video', { detail: { videoId: 'music/calm_vid02' } })));
    await player.waitFor();
    assert.equal(decodeURIComponent(await player.locator('video').getAttribute('src')), 'https://asset.localhost/C:\\smoke\\video_paradigm\\Calm\\music\\calm_vid02.mp4');
    await page.getByRole('button', { name: '关闭调节视频', exact: true }).click();
    await page.getByRole('button', { name: /^全部/ }).click();
    const search = page.getByLabel('搜索视频', { exact: true });
    await search.fill('calm_vid02');
    await waitForCount(1);
    await search.fill('治愈动画');
    await waitForCount(1);
    await search.fill('不存在的视频');
    await waitForCount(0);
    await search.fill('');
    await waitForCount(3);
    if (output) await page.screenshot({ path: path.join(output, 'video-library.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await search.isVisible(), true);
    assert.equal(await page.getByRole('button', { name: '选择视频根目录', exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'The video library must fit the small viewport');
    if (output) await page.screenshot({ path: path.join(output, 'video-library-small.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: '选择视频根目录', exact: true }).click();
    await page.getByText('replacement_vid04', { exact: true }).waitFor();
    await waitForCount(1);
    assert.equal(await page.evaluate(() => localStorage.getItem('video.paradigmRootPath')), 'C:\\smoke\\replacement-root');
    assert.equal(await page.evaluate(() => localStorage.getItem('paradigm.libraryRootPath')), null, 'Standalone selection must preserve experiment preparation');
    await go();
    await waitForCount(1);
    assert.equal(await page.evaluate(() => window.__VIDEO_REGULATION_CALLS__.find(call => call.command === 'load_paradigm_video_library').args.input.rootPath), 'C:\\smoke\\replacement-root');
    assert.deepEqual(errors, []);

    const preview = await browser.newPage();
    await preview.addInitScript(() => {
      localStorage.setItem('tauri-eeg.currentUser', JSON.stringify({ id: 'smoke-user', username: 'smoke' }));
      localStorage.setItem('tauri-eeg.homeIntroPlayed.smoke-user', 'true');
    });
    await preview.goto(`${origin}/video-regulation`, { waitUntil: 'domcontentloaded' });
    await preview.getByRole('button', { name: '跳过', exact: true }).click();
    await preview.getByRole('button', { name: '跳过本次', exact: true }).click();
    await preview.getByRole('heading', { name: '视频调控', exact: true }).waitFor();
    await preview.getByText(/浏览器预览/).waitFor();
    assert.equal(await preview.getByRole('button', { name: '播放', exact: true }).count(), 0);
    await preview.close();
    console.log('Passed: Calm library, nested duplicate filenames, category and filename search, real asset paths, close/Escape, root selection, saved-root restoration, browser-preview empty state. Simulated IPC; file decoding is not covered.');
  } catch (error) {
    console.error('Page diagnostics:', await page.locator('body').innerText(), errors);
    if (output) await page.screenshot({ path: path.join(output, 'video-library-failure.png'), fullPage: true });
    throw error;
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
