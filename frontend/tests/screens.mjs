/**
 * Race Wars — visual capture of the main screens at the target resolutions.
 * Output: qa-output/screens/<screen>-<w>x<h>.png  (compare against the reference
 * video/storyboard by eye; the game is procedural, so this is not pixel-diffed).
 *
 *   node tests/screens.mjs [baseUrl]   (default: starts its own dev server)
 *   SIZES=1920x1080,1366x768 QUALITY=high node tests/screens.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa-output', 'screens');
fs.mkdirSync(OUT, { recursive: true });
const SIZES = (process.env.SIZES ?? '1920x1080,1600x900,1366x768').split(',').map(s => s.split('x').map(Number));
const QUALITY = process.env.QUALITY ?? 'medium';
let base = process.argv[2];
let server;
if (!base) {
  base = 'http://127.0.0.1:5181';
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 200; i++) { try { if ((await fetch(base)).ok) break; } catch { /* wait */ } await new Promise(r => setTimeout(r, 200)); }
}
const exe = process.env.PW_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(process.env.TEST_BROWSER ? { channel: process.env.TEST_BROWSER } : { executablePath: exe, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] });

for (const [w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.setDefaultTimeout(600000);
  await page.addInitScript(q => { localStorage.setItem('raceWarsSettings', JSON.stringify({ qualityPreset: q, laps: 1, traffic: 'light', playerName: 'AQIB' })); }, QUALITY);
  await page.goto(`${base}/?qa=1&seed=7`);
  await page.waitForFunction(() => window.RaceWars?.state?.state === 'HOME');
  const frames = async n => { const f0 = await page.evaluate(() => window.RaceWars.game.perf.frames); await page.waitForFunction(([f, k]) => window.RaceWars.game.perf.frames >= f + k, [f0, n]); };
  const shot = async name => { await frames(3); await page.screenshot({ path: path.join(OUT, `${name}-${w}x${h}.png`) }); console.log(`${name} ${w}x${h}`); };
  await frames(8); await shot('1-main-menu');
  await page.click('#nav-garage'); await frames(25); await shot('2-garage');
  await page.click('#garage-screen [data-back]');
  await page.click('#nav-race'); await frames(25); await shot('3-lobby');
  await page.click('#lobby-start');
  await page.waitForFunction(() => window.RaceWars.state.state === 'COUNTDOWN');
  await page.evaluate(() => window.RaceWars.qa.advance(0.4)); await shot('4-starting-grid');
  await page.evaluate(() => { window.RaceWars.qa.advance(2.8); window.RaceWars.qa.autopilot(true); window.RaceWars.qa.advance(12); });
  await frames(6); await shot('5-gameplay');
  await page.keyboard.press('KeyC'); await frames(6); await shot('5b-gameplay-close-cam');
  await page.keyboard.press('KeyC'); await frames(6); await shot('5c-gameplay-hood-cam');
  await page.keyboard.press('KeyC');
  await page.keyboard.press('Escape'); await frames(4); await shot('6-pause');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.RaceWars.state.state === 'RACING');
  await page.evaluate(() => { for (let i = 0; i < 80; i++) { if (window.RaceWars.qa.advance(5).state === 'RESULTS') break; } });
  await frames(8); await shot('7-results');
  await page.close();
}
await browser.close();
server?.kill();
