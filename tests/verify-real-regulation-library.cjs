// Native scanning is simulated from the real folder; playback receives real MP4 bytes.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const rootPath = path.resolve(process.env.VIDEO_REGULATION_LIBRARY_ROOT || path.join(__dirname, '../video_paradigm'));
  const calmRoot = path.join(rootPath, 'Calm');
  function scan(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return scan(absolutePath);
      if (!entry.isFile() || !/\.mp4$/i.test(entry.name)) return [];
      const fileName = path.relative(calmRoot, absolutePath).split(path.sep).join('/');
      return [{ videoId: fileName.replace(/\.mp4$/i, ''), fileName, absolutePath }];
    });
  }
  const calm = scan(calmRoot).sort((a, b) => a.fileName.localeCompare(b.fileName));
  assert.ok(calm.length, 'The actual Calm folder must contain MP4 files');
  const smallest = calm.reduce((selected, candidate) => fs.statSync(candidate.absolutePath).size < fs.statSync(selected.absolutePath).size ? candidate : selected);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ rootPath, calm }) => {
    localStorage.setItem('tauri-eeg.currentUser', JSON.stringify({ id: 'real-library-user', username: 'real-library' }));
    localStorage.setItem('video.paradigmRootPath', rootPath);
    window.__TAURI_INTERNALS__ = {
      invoke: async command => {
        if (command === 'load_paradigm_video_library') return {
          rootPath, calm, anxiety: [], depression: [], fear: [], valid: false, problems: [], readinessWarnings: [],
        };
        if (command === 'experiment_list' || command.startsWith('list_')) return [];
        if (command === 'get_storage_location') return { root: rootPath };
        return {};
      },
      transformCallback: () => 1, unregisterCallback: () => {},
      convertFileSrc: file => `https://asset.localhost/${encodeURIComponent(file)}`,
    };
  }, { rootPath, calm });
  const allowedPaths = new Set(calm.map(entry => entry.absolutePath));
  await page.route('https://asset.localhost/**', async route => {
    const requestedPath = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    if (!allowedPaths.has(requestedPath)) return route.abort();
    return route.fulfill({ path: requestedPath, contentType: 'video/mp4' });
  });
  const output = process.env.VIDEO_REGULATION_SMOKE_OUTPUT;
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto(`${process.env.VIDEO_REGULATION_SMOKE_URL || 'http://127.0.0.1:1432'}/video-regulation`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '跳过', exact: true }).click();
    await page.getByRole('button', { name: '跳过本次', exact: true }).click();
    await page.getByRole('heading', { name: '视频调控', exact: true }).waitFor();
    await page.waitForFunction(count => [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === '播放').length === count, calm.length);
    assert.equal(await page.getByRole('button', { name: '播放', exact: true }).count(), calm.length);
    const actualPaths = await page.getByLabel('筛选后的视频库').locator('article code').allTextContents();
    assert.deepEqual(actualPaths.sort(), calm.map(entry => entry.fileName).sort(), 'Every real Calm MP4 must have a card with its actual relative path');
    if (output) {
      await page.getByLabel('视频调控工作区', { exact: true }).evaluate(async element => {
        await Promise.allSettled(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
      });
      await page.screenshot({ path: path.join(output, 'actual-video-library.png'), fullPage: true });
    }
    await page.getByLabel('搜索视频', { exact: true }).fill(smallest.fileName);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    const video = page.getByLabel('视频调节播放器', { exact: true }).locator('video');
    await video.waitFor();
    const metadata = await video.evaluate(element => new Promise((resolve, reject) => {
      const ready = () => resolve({ duration: element.duration, width: element.videoWidth, height: element.videoHeight, readyState: element.readyState });
      const timer = setTimeout(() => reject(new Error(`MP4 metadata timeout; media error: ${element.error?.message || 'none'}`)), 15000);
      const done = () => { clearTimeout(timer); ready(); };
      if (element.readyState >= 1) done();
      else {
        element.addEventListener('loadedmetadata', done, { once: true });
        element.addEventListener('error', () => { clearTimeout(timer); reject(new Error(element.error?.message || 'MP4 decoding failed')); }, { once: true });
      }
    }));
    assert.ok(Number.isFinite(metadata.duration) && metadata.duration > 0);
    assert.ok(metadata.width > 0 && metadata.height > 0);
    await video.evaluate(element => element.play());
    await page.waitForFunction(() => {
      const element = document.querySelector('section[aria-label="视频调节播放器"] video');
      return element && element.currentTime > 0 && element.readyState >= 2;
    }, null, { timeout: 15000 });
    const playback = await video.evaluate(element => ({ currentTime: element.currentTime, readyState: element.readyState }));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ count: calm.length, decodedFile: smallest.fileName, bytes: fs.statSync(smallest.absolutePath).size, ...metadata, ...playback }, null, 2));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
