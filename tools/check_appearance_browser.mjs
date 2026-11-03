/** Optional real-browser CSS regression check. Install Playwright separately.
 * PLAYWRIGHT_MODULE_PATH and PLAYWRIGHT_EXECUTABLE may select an existing runtime.
 * This fixture checks CSS rendering, not live YouTube TV frontend compatibility.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { buildAppearanceCss } from '../TizenTube/mods/ui/appearanceStyles.js';
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = modulePath ? await import(pathToFileURL(modulePath).href) : await import('playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const output = new URL('../work/appearance-browser/', import.meta.url);
await mkdir(output, { recursive: true });
const page = await browser.newPage({ viewport: { width:1920, height:1080 }, deviceScaleFactor:1 });
try {
  await page.setContent(await readFile(new URL('../TizenTube/mods/tests/browser/appearance-4.4.html', import.meta.url), 'utf8'));
  await page.addStyleTag({ content: buildAppearanceCss() });
  // Exercise default browser timers: Node permits an invocation form that
  // Window timers reject, so injected fake clocks alone cannot catch this.
  const captionSource = await readFile(new URL('../TizenTube/mods/features/captionFallback.js', import.meta.url), 'utf8');
  const timerResult = await page.evaluate(async source => {
    const CaptionFallback = new Function(source.replace(/^export /gm, '') + '; return CaptionFallback;')();
    let audio = []; let current = {}; const calls = [];
    const settings = { enableCaptionFallback:true, preferredAudioLanguage:'en', fallbackCaptionLanguage:'en' };
    const player = {
      getAvailableAudioTracks: () => audio,
      getOption: (module, key) => key === 'tracklist' ? [{ languageCode:'en', vssId:'.en' }] : current,
      setOption: (module, key, value) => { calls.push(value); current = value; },
    };
    const controller = new CaptionFallback({ settings:key => settings[key] });
    controller.check(player, 'browser-video');
    const initial = controller.status;
    const scheduled = controller.timer !== null;
    audio = [{ id:'ja.4' }];
    await new Promise(resolve => setTimeout(resolve, 1100));
    const result = { initial, scheduled, count:calls.length, status:controller.status };
    controller.destroy();
    return result;
  }, captionSource);
  assert.deepEqual(timerResult, { initial:'audio-unknown', scheduled:true, count:1, status:'applied' });
  for (const [name, classes] of [
    ['default', ''], ['oled', 'ytark-oled-black'], ['glass', 'ytark-liquid-glass'],
    ['oled-glass', 'ytark-oled-black ytark-liquid-glass'],
  ]) {
    await page.evaluate(({ name, classes }) => { document.documentElement.className = classes; document.querySelector('#mode').textContent = name; }, { name, classes });
    const state = await page.evaluate(() => {
      const css = selector => getComputedStyle(document.querySelector(selector));
      return { body: css('body').backgroundColor, panel:css('.ytLrOverlayPanelRendererContent').backgroundColor,
        focus:css('.zylon-focus').color, focusBg:css('.zylon-focus').backgroundColor,
        video:css('video').backgroundColor, videoFilter:css('video').filter,
        caption:css('.caption-window').color, art:css('.art').backgroundImage,
        blur:css('.ytLrOverlayPanelRendererContent').backdropFilter };
    });
    assert.equal(state.video, 'rgb(17, 34, 51)', name);
    assert.equal(state.videoFilter, 'none', name);
    assert.equal(state.caption, 'rgb(255, 255, 255)', name);
    assert.match(state.art, /linear-gradient/, name);
    assert.equal(state.focus, 'rgb(15, 15, 15)', name);
    assert.equal(state.focusBg, 'rgb(241, 241, 241)', name);
    if (name.includes('oled')) assert.equal(state.body, 'rgb(0, 0, 0)', name);
    if (name === 'oled') assert.equal(state.panel, 'rgb(0, 0, 0)');
    if (name.includes('glass')) assert.equal(state.panel, 'rgba(28, 32, 40, 0.38)');
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) });
  }
  await page.emulateMedia({ reducedMotion:'reduce' });
  const reduced = await page.locator('.ytLrOverlayPanelRendererContent').evaluate(element => ({ background:getComputedStyle(element).backgroundColor, blur:getComputedStyle(element).backdropFilter }));
  assert.equal(reduced.background, 'rgb(20, 24, 32)');
  assert.equal(reduced.blur, 'none');
  console.log('PASS: native browser caption retry timers; default/OLED/glass/combined styles, unchanged media, readable focus, reduced-motion fallback. Fixture screenshots: work/appearance-browser.');
} finally { await browser.close(); }
