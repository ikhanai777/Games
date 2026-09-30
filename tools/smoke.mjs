// Browser smoke test: boots the game in headless Chromium, plays a run, dies, opens menus,
// and fails on any page error. Screenshots go to $SHOTS (default: ./smoke-shots).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const shots = process.env.SHOTS || 'smoke-shots';
mkdirSync(shots, { recursive: true });
const port = 8123;
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// The web font is optional (system fallback); keep the test offline-safe.
const offline = (page) => page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await offline(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/`);
  await sleep(600);
  await page.screenshot({ path: `${shots}/1-title.png` });
  const state = () => page.evaluate(() => window.__pulsegon.state);

  await page.keyboard.press('Enter');
  await sleep(300);
  await page.screenshot({ path: `${shots}/2-menu.png` });
  await page.keyboard.press('Enter'); // Movements
  await sleep(300);
  await page.screenshot({ path: `${shots}/3-movements.png` });
  await page.keyboard.press('Enter'); // Start I Normal
  await sleep(200);
  if ((await state()) !== 'playing') throw new Error(`expected playing, got ${await state()}`);
  await sleep(2500);
  await page.screenshot({ path: `${shots}/4-playing.png` });
  // Hold left until something happens (the warm-up gap is straight ahead, so we will die eventually).
  await page.keyboard.down('ArrowLeft');
  for (let i = 0; i < 80 && (await state()) === 'playing'; i++) await sleep(100);
  await page.keyboard.up('ArrowLeft');
  const s = await state();
  console.log('state after holding left:', s);
  if (s === 'dead') {
    await sleep(150);
    await page.screenshot({ path: `${shots}/5-death.png` });
    await page.keyboard.down('ArrowLeft'); // rewind
    await sleep(900);
    await page.screenshot({ path: `${shots}/6-rewind.png` });
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.screenshot({ path: `${shots}/7-results.png` });
    if ((await state()) !== 'results') throw new Error('expected results');
    await page.keyboard.press('Enter'); // retry
    await sleep(300);
    if ((await state()) !== 'playing') throw new Error('retry failed');
  }
  await page.keyboard.press('Escape');
  await sleep(200);
  if ((await state()) !== 'paused') throw new Error('expected paused');
  await page.screenshot({ path: `${shots}/8-paused.png` });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // quit
  await sleep(200);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // Options
  await sleep(200);
  await page.screenshot({ path: `${shots}/9-options.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp'); // How to play (wraps)
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.screenshot({ path: `${shots}/10-help.png` });

  // Unlock everything and try the later Movements for runtime errors.
  await page.evaluate(() => {
    window.__pulsegon.app.store.unlockAll(window.__pulsegon.app.data);
  });
  const views = ['3d', 'perspective', 'flat', 'perspective'];
  const runs = [[4, 2], [5, 2], [2, 0], [3, 1]];
  for (let i = 0; i < runs.length; i++) {
    const [movement, tier] = runs[i];
    await page.evaluate((v) => (window.__pulsegon.app.data.settings.view = v), views[i]);
    await page.evaluate(([m, t]) => window.__pulsegon.app.startRun({ mode: 'stage', movement: m, tier: t }), [movement, tier]);
    await sleep(3200);
    await page.screenshot({ path: `${shots}/run-m${movement}-t${tier}-${views[i]}.png` });
  }
  // V cycles the view mid-run.
  const before = await page.evaluate(() => window.__pulsegon.app.data.settings.view);
  await page.keyboard.press('KeyV');
  const after = await page.evaluate(() => window.__pulsegon.app.data.settings.view);
  if (before === after) throw new Error('V did not change the view');
  if (!(await page.evaluate(() => window.__pulsegon.app.has3d()))) errors.push('WebGL renderer failed to start');
  await page.evaluate(() => window.__pulsegon.app.startRun({ mode: 'gauntlet', movement: 0, tier: 0 }));
  await sleep(1000);
  await page.evaluate(() => window.__pulsegon.app.startRun({ mode: 'endless', movement: 1, tier: 1 }));
  await sleep(1000);

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await offline(phone);
  phone.on('pageerror', (e) => errors.push(String(e)));
  await phone.goto(`http://localhost:${port}/`);
  await sleep(400);
  await phone.tap('#overlay');
  await sleep(300);
  await phone.screenshot({ path: `${shots}/phone-menu.png` });
  await phone.tap('.item[data-i="0"]');
  await sleep(300);
  await phone.screenshot({ path: `${shots}/phone-movements.png` });
  const noHScroll = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  if (!noHScroll) errors.push('horizontal scroll on phone');
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error('Smoke test errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('smoke ok');
