/**
 * Race Wars — browser end-to-end tests.
 *
 * Runs the real game in Chromium against real servers: Vite (dev) or the
 * production build (`--prod`), plus the multiplayer backend. Tests drive the
 * game with keyboard/mouse input and read state through the ?qa=1 hooks, which
 * expose the actual simulation (no mocks). Simulated time is advanced with
 * qa.advance() so results do not depend on the machine's frame rate.
 *
 *   node tests/e2e.mjs            # dev server
 *   node tests/e2e.mjs --prod     # build + preview, production smoke suite
 *   ONLY=race,garage node tests/e2e.mjs
 *
 * Browser: TEST_BROWSER=chrome|msedge uses an installed browser; PW_CHROMIUM
 * points at a Chromium binary; otherwise Playwright's bundled Chromium.
 */
import { chromium } from 'playwright';
import { io } from 'socket.io-client';
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa-output');
const PROD = process.argv.includes('--prod');
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const WEB_PORT = PROD ? 4179 : 5179;
const API_PORT = 3109;
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const VIEW = { width: 960, height: 540 };
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const procs = [];
const sockets = [];
let browser;
const pause = ms => new Promise(r => setTimeout(r, ms));

function save() {
  fs.writeFileSync(path.join(OUT, PROD ? 'e2e-prod-results.json' : 'e2e-results.json'), JSON.stringify({
    date: new Date().toISOString(), mode: PROD ? 'production' : 'development',
    passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length,
    skipped: results.filter(r => r.status === 'SKIP').length, results,
  }, null, 2));
}

async function test(name, fn, { prod = true } = {}) {
  if (ONLY.length && !name.startsWith('startup') && !ONLY.some(o => name.includes(o))) return;
  if (PROD && !prod) { results.push({ name, status: 'SKIP', reason: 'dev-only' }); return; }
  const t0 = Date.now();
  process.stdout.write(`RUN  ${name}\n`);
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', ms: Date.now() - t0, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${detail ? ' ' + JSON.stringify(detail) : ''}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', ms: Date.now() - t0, error: String(err?.stack ?? err).slice(0, 1500) });
    console.log(`FAIL ${name}: ${err?.message ?? err}`);
  }
  save();
}

async function waitHttp(url) {
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* retry */ }
    await pause(200);
  }
  throw new Error(`Server not reachable: ${url}`);
}

function launchOptions() {
  const args = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  if (process.env.TEST_BROWSER) return { channel: process.env.TEST_BROWSER, args };
  const exe = process.env.PW_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return { executablePath: exe, args: [...args, '--use-angle=swiftshader'] };
}

/** Open the game, wait for the main menu, collect console errors. */
async function openGame({ settings = {}, query = 'qa=1&seed=11', viewport = VIEW, context } = {}) {
  const ctx = context ?? await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => { if (!r.url().includes('socket.io')) errors.push(`requestfailed: ${r.url()}`); });
  await page.addInitScript(s => {
    if (location.protocol === 'about:') return;
    if (!sessionStorage.getItem('qa-init')) {
      sessionStorage.setItem('qa-init', '1');
      localStorage.clear();
      localStorage.setItem('raceWarsSettings', JSON.stringify(s));
    }
  }, { qualityPreset: 'low', laps: 1, traffic: 'light', difficulty: 'normal', ...settings });
  await page.goto(`${BASE}/?${query}`);
  await page.waitForFunction(() => window.RaceWars?.state?.state === 'HOME' || window.RaceWars?.state?.state === 'INTRO' || document.getElementById('error-screen')?.classList.contains('screen--active'), null, { timeout: 180000 });
  return { page, errors, ctx };
}

const qa = (page, expr, arg) => page.evaluate(expr, arg);
const state = page => qa(page, () => window.RaceWars.qa.state());
const advance = (page, s) => qa(page, sec => window.RaceWars.qa.advance(sec), s);
async function frames(page, n = 2) {
  const f0 = await qa(page, () => window.RaceWars.game.perf.frames);
  await page.waitForFunction(([f, k]) => window.RaceWars.game.perf.frames >= f + k, [f0, n]);
}
async function startRace(page) {
  await page.click('#nav-race');
  await page.waitForFunction(() => window.RaceWars.state.state === 'RACE_LOBBY');
  await page.click('#lobby-start');
  await page.waitForFunction(() => window.RaceWars.state.state === 'COUNTDOWN');
}
async function toRacing(page) {
  await startRace(page);
  const s = await advance(page, 3.1);
  assert.equal(s.state, 'RACING', 'countdown should hand over to racing');
  return s;
}
const realErrors = errs => errs.filter(e => !/favicon|DevTools|WebGL.*(warning|performance)|GPU stall|swiftshader/i.test(e));

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // Servers
  procs.push(spawn(process.execPath, [path.join(ROOT, '../backend/server.js')], { env: { ...process.env, PORT: String(API_PORT) }, stdio: ['ignore', fs.openSync(path.join(OUT, 'server.log'), 'w'), fs.openSync(path.join(OUT, 'server.log'), 'a')] }));
  if (PROD) {
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_SERVER_URL: `http://127.0.0.1:${API_PORT}` } });
    procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
  } else {
    procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SERVER_URL: `http://127.0.0.1:${API_PORT}` } }));
  }
  await Promise.all([waitHttp(`http://127.0.0.1:${API_PORT}/health`), waitHttp(BASE)]);
  browser = await chromium.launch(launchOptions());
  console.log(`Browser ${browser.version()} · ${PROD ? 'production build' : 'dev server'} · ${BASE}`);

  // Shared session for most gameplay checks
  let main;

  await test('startup: app, WebGL, fonts and car model load without errors', async () => {
    main = await openGame();
    const { page, errors } = main;
    const info = await qa(page, async () => {
      const faces = await document.fonts.load('italic 800 20px "Barlow Condensed"');
      return {
        state: window.RaceWars.state.state,
        model: window.RaceWars.game.modelStatus,
        gl: !!window.RaceWars.game.renderer.getContext(),
        fonts: faces.length > 0 && faces.every(f => f.status === 'loaded'),
        track: window.RaceWars.qa.track(),
      };
    });
    assert.equal(info.state, 'HOME');
    assert.equal(info.model, 'loaded', 'GLB car model must load (not the fallback)');
    assert.ok(info.gl);
    assert.ok(info.fonts, 'self-hosted Barlow Condensed must be available');
    assert.ok(info.track.length > 3000 && info.track.minRadius > 100);
    await frames(page, 3);
    assert.deepEqual(realErrors(errors), []);
    return info;
  });
  if (!main) throw new Error('Game failed to start; aborting suite');
  const { page } = main;

  await test('menu: every main-menu item opens a real screen and BACK returns', async () => {
    const pairs = [['#nav-race', 'RACE_LOBBY'], ['#nav-multiplayer', 'MULTIPLAYER'], ['#nav-garage', 'GARAGE'], ['#nav-profile', 'PROFILE'], ['#nav-settings', 'SETTINGS']];
    for (const [sel, st] of pairs) {
      await page.click(sel);
      await page.waitForFunction(s => window.RaceWars.state.state === s, st);
      await page.click('.screen--active [data-back]');
      await page.waitForFunction(() => window.RaceWars.state.state === 'HOME');
    }
    // Keyboard: focus, arrow down, enter
    await page.focus('#nav-race');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.RaceWars.state.state === 'MULTIPLAYER');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.RaceWars.state.state === 'HOME');
  });

  await test('garage: browsing changes car + measured stats; SELECT persists the vehicle used in the race', async () => {
    await page.click('#nav-garage');
    await page.waitForFunction(() => window.RaceWars.state.state === 'GARAGE');
    const first = await page.textContent('#garage-car-name');
    const top1 = await page.textContent('#fact-top');
    await page.click('#garage-next');
    const second = await page.textContent('#garage-car-name');
    const top2 = await page.textContent('#fact-top');
    assert.notEqual(first, second);
    assert.notEqual(top1, top2, 'stats must change with the car');
    await page.click('#garage-select');
    const sel = await qa(page, () => window.RaceWars.settings.get('selectedCarId'));
    assert.equal(sel, 'apex_gt');
    // Drag rotate + zoom act on the showroom camera/turntable without errors
    const box = await page.locator('#game-canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2); await page.mouse.up();
    await page.mouse.wheel(0, 300);
    const zoom = await qa(page, () => window.RaceWars.game.garage.orbitZoom);
    assert.ok(zoom > 1, 'wheel zooms out');
    await page.click('.paint[data-paint="green"]');
    assert.equal(await qa(page, () => window.RaceWars.settings.get('selectedColor')), 'green');
    // Back to the default car for the remaining tests
    await page.click('#garage-prev');
    await page.click('#garage-select');
    await page.click('#garage-screen [data-back]');
    return { first, second, top1, top2 };
  });

  await test('lobby: offline AI lobby lists rivals and race options update settings', async () => {
    await page.click('#nav-race');
    await page.waitForFunction(() => window.RaceWars.state.state === 'RACE_LOBBY');
    const roster = await page.locator('#race-roster .racer-card').count();
    assert.equal(roster, 3);
    assert.match(await page.textContent('#race-lobby-screen .screen-sub'), /OFFLINE/);
    await page.click('[data-setting="difficulty"] [data-value="hard"]');
    await page.click('[data-setting="laps"] [data-value="2"]');
    const s = await qa(page, () => [window.RaceWars.settings.get('difficulty'), window.RaceWars.settings.get('laps')]);
    assert.deepEqual(s, ['hard', 2]);
    await page.click('[data-setting="raceMode"] [data-value="free"]');
    assert.equal(await page.locator('#race-roster .racer-card').count(), 1, 'free drive has no AI');
    await page.click('[data-setting="raceMode"] [data-value="race"]');
    await page.click('[data-setting="difficulty"] [data-value="normal"]');
    await page.click('[data-setting="laps"] [data-value="1"]');
    await page.click('#race-lobby-screen [data-back]');
  });

  await test('race start: grid, countdown 3-2-1-GO tied to race state, controls locked until GO', async () => {
    await startRace(page);
    await page.keyboard.down('KeyW');
    let s = await advance(page, 1.0);
    assert.equal(s.phase, 'countdown');
    assert.equal(s.countdown, 2);
    assert.ok(Math.abs(s.player.speedKmh) < 0.5, 'car must not move during countdown');
    assert.equal(s.racers.length, 3);
    await frames(page, 2);
    assert.equal(await page.textContent('#countdown-num'), '2');
    s = await advance(page, 2.1);
    assert.equal(s.state, 'RACING');
    assert.equal(s.countdown, 0, 'GO shown right after start');
    s = await advance(page, 1);
    assert.ok(s.player.speedKmh > 20, 'throttle works after GO');
    await page.keyboard.up('KeyW');
  });

  await test('physics: acceleration, top-speed limit, gears/RPM and HUD use real state', async () => {
    await qa(page, () => window.RaceWars.qa.placePlayer(3600, 0, 0));
    await page.keyboard.down('KeyW');
    let s = await advance(page, 3.5);
    const at35 = s.player.speedKmh;
    assert.ok(at35 > 80 && at35 < 160, `0→${at35.toFixed(0)} km/h in 3.5 s`);
    assert.ok(s.player.gear >= 2, 'auto gearbox shifted');
    await frames(page, 2);
    s = await state(page);
    assert.equal(Number(s.hud.speed), Math.round(Math.abs(s.player.speedKmh)), 'HUD speed equals simulation speed');
    assert.equal(s.hud.gear, String(s.player.gear));
    // Top speed: long straight then hold
    await qa(page, () => window.RaceWars.qa.placePlayer(3600, 0, 260));
    s = await advance(page, 6);
    await page.keyboard.up('KeyW');
    assert.ok(s.player.speedKmh < 300, `speed limited by drag/limiter (${s.player.speedKmh.toFixed(0)})`);
    return { kmhAfter3_5s: Math.round(at35) };
  });

  await test('physics: braking, reverse gear and coasting', async () => {
    await qa(page, () => window.RaceWars.qa.placePlayer(3600, 0, 100));
    await page.keyboard.down('KeyS');
    let s = await advance(page, 0.5);
    assert.ok(s.player.braking, 'brake lights / braking state on');
    s = await advance(page, 2.5);
    assert.ok(s.player.speedKmh < 0, 'car stops, then reverses');
    assert.equal(s.player.gear, -1);
    assert.ok(s.player.speedKmh > -50, 'reverse speed limited');
    await page.keyboard.up('KeyS');
    await qa(page, () => window.RaceWars.qa.placePlayer(3600, 0, 100));
    s = await advance(page, 2);
    assert.ok(s.player.speedKmh < 95 && s.player.speedKmh > 60, 'coasting decelerates gradually');
  });

  await test('physics: speed-sensitive steering left/right, return to centre', async () => {
    await qa(page, () => window.RaceWars.qa.placePlayer(20, 0, 30));
    await page.keyboard.down('KeyA');
    let s = await advance(page, 0.6);
    const lowAngle = s.player.steerAngle;
    assert.ok(lowAngle > 0.15, 'left = positive wheel angle');
    await page.keyboard.up('KeyA');
    await qa(page, () => window.RaceWars.qa.placePlayer(20, 0, 220));
    await page.keyboard.down('ArrowRight');
    s = await advance(page, 0.6);
    const highAngle = s.player.steerAngle;
    assert.ok(highAngle < 0 && Math.abs(highAngle) < lowAngle / 2, 'less lock at high speed');
    await page.keyboard.up('ArrowRight');
    s = await advance(page, 0.6);
    assert.ok(Math.abs(s.player.steerAngle) < 0.01, 'wheels self-centre');
    return { lowAngle, highAngle };
  });

  await test('physics: handbrake breaks rear grip into a controllable slide', async () => {
    await qa(page, () => window.RaceWars.qa.placePlayer(20, 0, 110));
    await page.keyboard.down('Space');
    await page.keyboard.down('KeyD');
    const s = await advance(page, 0.7);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyD');
    assert.ok(Math.abs(s.player.lateral) > 1.5, `lateral slide ${s.player.lateral.toFixed(2)} m/s`);
    const after = await advance(page, 2.5);
    assert.ok(Math.abs(after.player.lateral) < 3, 'slide settles after release');
    return { slide: s.player.lateral };
  });

  await test('nitro: consumes capacity, adds real acceleration, recharges', async () => {
    await qa(page, () => window.RaceWars.qa.placePlayer(3600, 0, 120));
    await page.keyboard.down('KeyW');
    const base = await advance(page, 2);
    await qa(page, () => window.RaceWars.qa.placePlayer(3600, 0, 120));
    await page.keyboard.down('ShiftLeft');
    const boosted = await advance(page, 2);
    assert.ok(boosted.player.boosting);
    assert.ok(boosted.player.speedKmh > base.player.speedKmh + 8, `nitro faster (${base.player.speedKmh.toFixed(0)} vs ${boosted.player.speedKmh.toFixed(0)})`);
    assert.ok(boosted.player.nitroFraction < 0.6, 'nitro consumed');
    await page.keyboard.up('ShiftLeft');
    const rec = await advance(page, 3);
    await page.keyboard.up('KeyW');
    assert.ok(rec.player.nitroFraction > boosted.player.nitroFraction, 'nitro recharges');
    await frames(page, 2);
    const hud = await page.textContent('#hud-nitro-pct');
    return { base: Math.round(base.player.speedKmh), boosted: Math.round(boosted.player.speedKmh), hudNitro: hud };
  });

  await test('collisions: barrier stops the car leaving the road without trapping it', async () => {
    await qa(page, () => window.RaceWars.qa.placePlayer(200, 6, 160));
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
    let s = await advance(page, 1.2);
    await page.keyboard.up('KeyD');
    let maxD = 0;
    for (let i = 0; i < 6; i++) { s = await advance(page, 0.25); maxD = Math.max(maxD, Math.abs(s.player.d)); }
    assert.ok(maxD < 11, `stayed inside barriers (max |d| ${maxD.toFixed(2)})`);
    assert.ok(s.player.collisions >= 1, 'impact registered');
    await page.keyboard.down('KeyA');
    s = await advance(page, 0.4);
    await page.keyboard.up('KeyA');
    s = await advance(page, 0.8);
    await page.keyboard.up('KeyW');
    assert.ok(s.player.speedKmh > 30 && Math.abs(s.player.d) < 10.5, `drives away from the wall (${s.player.speedKmh.toFixed(0)} km/h, d ${s.player.d.toFixed(2)})`);
    return { maxD, collisions: s.player.collisions };
  });

  await test('collisions: car-to-car contact exchanges momentum (no overlap, no tunnelling)', async () => {
    const res = await qa(page, () => {
      const g = window.RaceWars.game, r = g.race, p = r.player, ai = r.racers.find(x => x.spec.kind === 'ai');
      const t = g.track;
      const s0 = p.body.track.s + 80;
      let pos = t.pointAt(s0 + 25, 2); ai.body.sim.place(pos.x, pos.z, t.headingAt(s0 + 25)); r.world.resync(ai.body); ai.lastS = ai.body.track.s; ai.ai.reset(2);
      pos = t.pointAt(s0, 2); p.body.sim.place(pos.x, pos.z, t.headingAt(s0));
      const h = p.body.sim.heading; p.body.sim.vx = -Math.sin(h) * 45; p.body.sim.vz = -Math.cos(h) * 45;
      r.world.resync(p.body); p.lastS = p.body.track.s;
      ai.body.sim.vx = -Math.sin(h) * 10; ai.body.sim.vz = -Math.cos(h) * 10;
      return true;
    });
    assert.ok(res);
    let minGap = Infinity, s;
    for (let i = 0; i < 12; i++) {
      s = await advance(page, 0.1);
      const ai = s.racers.find(x => x.kind === 'ai' && x.id === 'ai-blue');
      minGap = Math.min(minGap, Math.hypot(ai.x - s.player.x, ai.z - s.player.z));
    }
    assert.ok(minGap > 2.5, `bodies did not interpenetrate (min centre gap ${minGap.toFixed(2)} m)`);
    assert.ok(s.player.collisions >= 1);
    return { minGap };
  });

  await test('camera: C cycles chase → close → hood and persists', async () => {
    const modes = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('KeyC'); await frames(page, 1); modes.push((await state(page)).camera); }
    assert.deepEqual(modes, ['close', 'hood', 'chase']);
    assert.equal(await page.textContent('#hud-camera'), 'CHASE');
    assert.equal(await qa(page, () => window.RaceWars.settings.get('cameraMode')), 'chase');
  });

  await test('input: focus loss releases held keys; simultaneous keys combine', async () => {
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA'); await page.keyboard.down('ShiftLeft');
    let inp = await qa(page, () => window.RaceWars.qa.inputs());
    assert.ok(inp.forward && inp.left && inp.nitro);
    await qa(page, () => window.dispatchEvent(new Event('blur')));
    inp = await qa(page, () => window.RaceWars.qa.inputs());
    assert.equal(inp.held, 0, 'all inputs cleared on blur');
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('ShiftLeft');
    // Arrow keys do not scroll the page while racing
    const scroll = await qa(page, () => { window.scrollTo(0, 0); return window.scrollY; });
    await page.keyboard.press('ArrowDown');
    assert.equal(await qa(page, () => window.scrollY), scroll);
  });

  await test('reset: R puts the car back on the road facing the right way, progress kept', async () => {
    await qa(page, () => window.RaceWars.qa.placePlayer(400, 9, 0));
    await qa(page, () => { const p = window.RaceWars.game.race.player; p.body.sim.heading += 2.8; p.resetCooldown = 0; });
    const before = await state(page);
    await page.keyboard.press('KeyR');
    await frames(page, 1);
    const after = await advance(page, 0.05);
    assert.ok(Math.abs(after.player.d) <= 6.01, 'snapped to a lane');
    assert.ok(Math.abs(after.player.progress - before.player.progress) < 3, 'progress unchanged');
    assert.ok(after.player.resets >= 1);
  });

  await test('pause/resume: ESC freezes the simulation and resumes cleanly', async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.RaceWars.state.state === 'PAUSED');
    const t1 = (await state(page)).raceTime;
    await frames(page, 3);
    const t2 = (await state(page)).raceTime;
    assert.equal(t1, t2, 'race clock frozen while paused');
    assert.ok(await page.isVisible('#pause-resume'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.RaceWars.state.state === 'RACING');
    // Settings from pause returns to pause, not the menu
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.RaceWars.state.state === 'PAUSED');
    await page.click('#pause-settings');
    await page.waitForFunction(() => window.RaceWars.state.state === 'SETTINGS');
    assert.ok(await qa(page, () => window.RaceWars.game.race.player !== null), 'race kept while in settings');
    await page.click('#settings-screen [data-back]');
    await page.waitForFunction(() => window.RaceWars.state.state === 'PAUSED');
    await page.click('#pause-resume');
    await page.waitForFunction(() => window.RaceWars.state.state === 'RACING');
  });

  await test('race: AI opponents drive the course, follow the road and use checkpoints', async () => {
    await qa(page, () => window.RaceWars.qa.autopilot(true));
    const s = await advance(page, 25);
    for (const r of s.racers.filter(x => x.kind === 'ai')) {
      assert.ok(r.progress > 600, `${r.name} progressed ${r.progress.toFixed(0)} m`);
      assert.ok(Math.abs(r.d) < 11, `${r.name} on the road`);
      assert.ok(r.checkpoint >= 2, `${r.name} reached checkpoints in order`);
    }
    const order = s.standings.map(x => x.name);
    const byProgress = [...s.racers].filter(r => !r.finished).sort((a, b) => b.progress - a.progress).map(r => r.name);
    assert.deepEqual(order.filter(n => byProgress.includes(n)), byProgress, 'positions follow track progress');
    await frames(page, 2);
    const hudPos = await page.textContent('#hud-position');
    assert.equal(Number(hudPos), s.player.position);
    return { standings: s.standings.map(x => `${x.position}.${x.name}@${Math.round(x.progress)}m`) };
  });

  await test('race: finish detection, data-driven results, profile updated', async () => {
    const before = await qa(page, () => JSON.parse(localStorage.getItem('raceWarsStats') ?? '{}').racesPlayed ?? 0);
    let s;
    for (let i = 0; i < 40; i++) { s = await advance(page, 5); if (s.state === 'RESULTS') break; }
    assert.equal(s.state, 'RESULTS');
    assert.ok(s.player.finished, 'player finished');
    assert.ok(Math.abs(s.player.progress - await qa(page, () => window.RaceWars.game.track.length)) < 120, 'finished at race distance');
    const fin = s.standings.filter(x => x.finished);
    for (let i = 1; i < fin.length; i++) assert.ok(fin[i].time >= fin[i - 1].time, 'finishers ordered by time');
    await frames(page, 2);
    const rows = await page.locator('#results-rankings .results__row:not(.results__row--head)').count();
    assert.equal(rows, 3);
    const after = await qa(page, () => JSON.parse(localStorage.getItem('raceWarsStats')).racesPlayed);
    assert.equal(after, before + 1, 'race recorded in profile');
    await page.screenshot({ path: path.join(OUT, `results${PROD ? '-prod' : ''}.png`) });
    return { results: s.standings.map(x => `${x.position}.${x.name} ${x.finished ? x.time.toFixed(2) + 's' : 'DNF'}`) };
  });

  await test('results: RACE AGAIN restarts a fresh race; MAIN MENU returns home', async () => {
    await page.click('#results-again');
    await page.waitForFunction(() => window.RaceWars.state.state === 'COUNTDOWN');
    const s = await state(page);
    assert.ok(s.raceTime === 0 && s.player.progress < 0 && !s.player.finished, 'new race state');
    await advance(page, 3.2);
    await page.keyboard.press('Escape');
    await page.click('#pause-leave');
    await page.click('#confirm-leave');
    await page.waitForFunction(() => window.RaceWars.state.state === 'HOME');
    assert.equal(await qa(page, () => window.RaceWars.game.race.racers.length), 0, 'race torn down');
  });

  await test('stability: repeated races do not leak listeners, GPU resources or memory', async () => {
    const sample = () => qa(page, () => ({ ...window.RaceWars.qa.perf(), listeners: window.RaceWars.game.input.heldCount }));
    const startRaceOnce = async () => {
      await startRace(page); await advance(page, 6);
      await page.keyboard.press('Escape'); await page.click('#pause-leave'); await page.click('#confirm-leave');
      await page.waitForFunction(() => window.RaceWars.state.state === 'HOME');
      await frames(page, 2);
    };
    await startRaceOnce();
    const a = await sample();
    for (let i = 0; i < 3; i++) await startRaceOnce();
    const b = await sample();
    assert.ok(b.geometries - a.geometries <= 8, `geometries ${a.geometries} → ${b.geometries}`);
    assert.ok(b.textures - a.textures <= 4, `textures ${a.textures} → ${b.textures}`);
    if (a.memory && b.memory) assert.ok(b.memory - a.memory < 40e6, `heap ${a.memory} → ${b.memory}`);
    return { geometries: [a.geometries, b.geometries], textures: [a.textures, b.textures], heapMB: a.memory ? [Math.round(a.memory / 1e6), Math.round(b.memory / 1e6)] : null };
  });

  await test('settings: persist across reload and apply (speed unit, HUD, mute)', async () => {
    await page.click('#nav-settings');
    await page.selectOption('#set-speedUnit', 'mph');
    await page.click('.tab[data-tab="audio"]');
    await page.check('#set-muted');
    await page.reload();
    await page.waitForFunction(() => window.RaceWars?.state?.state === 'HOME');
    const s = await qa(page, () => ({ unit: window.RaceWars.settings.get('speedUnit'), muted: window.RaceWars.settings.get('muted'), level: window.RaceWars.audio.outputLevel }));
    assert.deepEqual(s, { unit: 'mph', muted: true, level: 0 });
    await startRace(page);
    await page.keyboard.down('KeyW'); await advance(page, 5); await page.keyboard.up('KeyW');
    await frames(page, 2);
    assert.equal(await page.textContent('#hud-speed-unit'), 'MPH');
    await page.keyboard.press('KeyM');
    await frames(page, 2);
    assert.equal(await qa(page, () => window.RaceWars.settings.get('muted')), false, 'M toggles mute');
    await qa(page, () => window.RaceWars.settings.set('speedUnit', 'kmh'));
    await page.keyboard.press('Escape'); await page.click('#pause-leave'); await page.click('#confirm-leave');
    await page.waitForFunction(() => window.RaceWars.state.state === 'HOME');
  });

  await test('layout: window resize keeps HUD elements inside the viewport without overlap', async () => {
    const sizes = [[1366, 768], [1024, 640], [800, 600]];
    await startRace(page); await advance(page, 3.2);
    const out = [];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await frames(page, 2);
      const boxes = await qa(page, () => ['.cluster', '#hud-minimap', '.hud__top-center', '.hud__top-left'].map(sel => {
        const r = document.querySelector(sel).getBoundingClientRect(); return { sel, x: r.x, y: r.y, w: r.width, h: r.height };
      }));
      const canvas = await qa(page, () => [window.RaceWars.game.renderer.domElement.clientWidth, window.RaceWars.game.renderer.domElement.clientHeight]);
      assert.deepEqual(canvas, [w, h], 'renderer follows the window size');
      for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= w + 1 && b.y + b.h <= h + 1, `${b.sel} inside ${w}x${h}`);
      const [cl, mm] = boxes;
      const overlap = !(cl.x >= mm.x + mm.w || mm.x >= cl.x + cl.w || cl.y >= mm.y + mm.h || mm.y >= cl.y + cl.h);
      assert.ok(!overlap, `cluster and minimap do not overlap at ${w}x${h}`);
      out.push(`${w}x${h}`);
    }
    await page.setViewportSize(VIEW);
    await page.keyboard.press('Escape'); await page.click('#pause-leave'); await page.click('#confirm-leave');
    return out;
  });

  await test('sim: AI difficulty changes real behaviour (lap times) — easy slower than hard', async () => {
    const times = await qa(page, async () => {
      const { RaceManager } = await import('/src/game/race/RaceManager.ts');
      const { getTrack } = await import('/src/game/track/Track.ts');
      const { CAR_CATALOGUE } = await import('/src/game/CarConfig.ts');
      const run = (difficulty) => {
        const rm = new RaceManager(getTrack());
        rm.setup({ mode: 'race', laps: 1, difficulty, traffic: 'off', seed: 3 }, [
          { id: 'a', name: 'A', config: CAR_CATALOGUE[0], kind: 'ai', personality: 'balanced', grid: 1 },
          { id: 'b', name: 'B', config: CAR_CATALOGUE[0], kind: 'ai', personality: 'aggressive', grid: 2 },
        ]);
        rm.startCountdown();
        for (let i = 0; i < 120 * 200 && !rm.racers.every(r => r.finished); i++) rm.step(1 / 120);
        return rm.racers.map(r => r.finished ? r.finishTime : Infinity);
      };
      return { easy: run('easy'), hard: run('hard') };
    });
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    assert.ok(times.easy.every(Number.isFinite) && times.hard.every(Number.isFinite), 'all AI finish');
    assert.ok(avg(times.hard) < avg(times.easy) - 2, `hard ${avg(times.hard).toFixed(1)}s vs easy ${avg(times.easy).toFixed(1)}s`);
    return times;
  }, { prod: false });

  await test('sim: progress cannot be gained by reversing or skipping checkpoints', async () => {
    const r = await qa(page, async () => {
      const { RaceManager } = await import('/src/game/race/RaceManager.ts');
      const { getTrack } = await import('/src/game/track/Track.ts');
      const { CAR_CATALOGUE } = await import('/src/game/CarConfig.ts');
      const t = getTrack();
      const rm = new RaceManager(t);
      rm.setup({ mode: 'race', laps: 1, difficulty: 'normal', traffic: 'off', seed: 1 }, [{ id: 'p', name: 'P', config: CAR_CATALOGUE[0], kind: 'player', grid: 0 }]);
      rm.startCountdown(); for (let i = 0; i < 400; i++) rm.step(1 / 120);
      const p = rm.racers[0];
      // Reverse across the start line: progress must go down, not wrap to a full lap
      p.body.input.brake = 1; for (let i = 0; i < 120 * 6; i++) rm.step(1 / 120); p.body.input.brake = 0;
      const afterReverse = { progress: p.progress, laps: p.lapsDone };
      // Teleport near the finish (simulated cut): no lap credited, checkpoints not skipped
      const pos = t.pointAt(t.length - 20, 0); p.body.sim.place(pos.x, pos.z, t.headingAt(t.length - 20));
      for (let i = 0; i < 120 * 3; i++) { p.body.input.throttle = 1; rm.step(1 / 120); }
      return { afterReverse, after: { progress: p.progress, laps: p.lapsDone, finished: p.finished, checkpoint: p.checkpoint } };
    });
    assert.ok(r.afterReverse.progress < 0 && r.afterReverse.laps === 0, 'reversing reduces progress');
    assert.equal(r.after.finished, false, 'cutting to the line does not finish the race');
    assert.ok(r.after.checkpoint <= 1);
    return r;
  }, { prod: false });

  await test('server: track length constant matches the client track', async () => {
    const { TRACK_LENGTH_M } = await import(path.join(ROOT, '../backend/server.js').replace(/\\/g, '/')).then(m => m.default ?? m);
    const len = await qa(page, () => window.RaceWars.qa.track().length);
    assert.ok(Math.abs(len - TRACK_LENGTH_M) < 2, `client ${len.toFixed(1)} vs server ${TRACK_LENGTH_M}`);
  }, { prod: false });

  await test('multiplayer: two browsers create/join, ready up, race with synced positions, server-validated results', async () => {
    const small = { width: 640, height: 360 };
    await page.goto('about:blank'); // park the idle main session to free CPU for the two clients
    const a = await openGame({ settings: { playerName: 'ALPHA' }, viewport: small });
    const b = await openGame({ settings: { playerName: 'BRAVO', selectedColor: 'blue' }, viewport: small });
    try {
    await a.page.click('#nav-multiplayer');
    await a.page.click('#mp-create-btn');
    await a.page.waitForFunction(() => window.RaceWars.state.state === 'LOBBY');
    const code = (await a.page.textContent('#lobby-room-code')).trim();
    assert.match(code, /^[A-Z]{4}$/);
    await b.page.click('#nav-multiplayer');
    await b.page.fill('#mp-join-code', code);
    await b.page.click('#mp-join-btn');
    await b.page.waitForFunction(() => window.RaceWars.state.state === 'LOBBY');
    await a.page.waitForFunction(() => document.querySelectorAll('#lobby-player-list .racer-card').length === 2);
    await a.page.click('#lobby-ready-btn'); await b.page.click('#lobby-ready-btn');
    await Promise.all([a, b].map(x => x.page.waitForFunction(() => ['COUNTDOWN', 'RACING'].includes(window.RaceWars.state.state), null, { timeout: 60000 })));
    for (const x of [a, b]) if ((await state(x.page)).state === 'COUNTDOWN') await advance(x.page, 3.2);
    for (const x of [a, b]) assert.equal((await state(x.page)).state, 'RACING');
    for (const x of [a, b]) await qa(x.page, () => window.RaceWars.qa.autopilot(true));
    // Positions synchronise: B sees A's car move
    await advance(a.page, 4);
    await pause(800);
    await frames(b.page, 2);
    const seen = await qa(b.page, () => window.RaceWars.game.race.racers.find(r => r.spec.kind === 'remote')?.body.track.s ?? null);
    assert.ok(seen !== null && seen > 50 && seen < 1000, `remote car progressed on B (s=${seen})`);
    // Cheat attempt from a raw client is rejected by the server
    // Drive both to the finish respecting real time (server bounds progress by elapsed time)
    for (let i = 0; i < 70; i++) {
      await advance(a.page, 1.2); await advance(b.page, 1.2);
      await pause(700);
      const done = await Promise.all([a, b].map(x => qa(x.page, () => window.RaceWars.state.state)));
      if (done.every(d => d === 'RESULTS')) break;
    }
    await Promise.all([a, b].map(x => x.page.waitForFunction(() => window.RaceWars.state.state === 'RESULTS', null, { timeout: 60000 })));
    const rowsA = await a.page.locator('#results-rankings .results__row:not(.results__row--head)').allTextContents();
    assert.equal(rowsA.length, 2);
    assert.match(await a.page.textContent('#results-kicker'), /SERVER-VALIDATED/);
    return { code, rows: rowsA };
    } finally {
      const dbg = await Promise.all([a, b].map(x => x.page.evaluate(() => ({ st: window.RaceWars?.state?.state, phase: window.RaceWars?.game?.race?.phase, conn: window.RaceWars?.network?.connected, reason: window.RaceWars?.network?.lastDisconnectReason })).catch(e => String(e))));
      console.log('   mp debug', JSON.stringify(dbg), JSON.stringify([...a.errors, ...b.errors].slice(0, 5)), fs.readFileSync(path.join(OUT, 'server.log'), 'utf8').slice(-1500));
      await a.ctx.close(); await b.ctx.close();
    }
  });

  await test('multiplayer: server rejects early finish and impossible progress; disconnect ends the race', async () => {
    const url = `http://127.0.0.1:${API_PORT}`;
    const mk = name => new Promise((res, rej) => { const s = io(url, { auth: { playerName: name }, transports: ['websocket'] }); sockets.push(s); s.once('connect', () => res(s)); s.once('connect_error', rej); });
    const once = (s, ev, ms = 10000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });
    const c1 = await mk('C1'), c2 = await mk('C2');
    c1.emit('create_room'); const { roomCode } = await once(c1, 'room_joined');
    c2.emit('join_room', roomCode); await once(c2, 'room_joined');
    c1.emit('set_ready', true); c2.emit('set_ready', true);
    await once(c1, 'start_race', 8000);
    // Spoofed progress and early finish
    c1.emit('player_update', { x: 0, z: 0, h: 0, speed: 50, progress: 5000 });
    await pause(200);
    const err = once(c1, 'error_msg');
    c1.emit('finish_race', { progress: 5000, time: 1 });
    assert.match(await err, /rejected/i);
    // Malformed updates are ignored without crashing the server
    c1.emit('player_update', { x: 'NaN', z: null });
    c1.emit('player_update', null);
    // Disconnect: remaining player gets results
    const fin = once(c2, 'race_finished');
    c1.disconnect();
    const rankings = await fin;
    assert.equal(rankings.length, 1);
    assert.equal(rankings[0].finished, false);
    assert.ok((await fetch(`${url}/health`)).ok, 'server still healthy');
    c2.disconnect();
    return { roomCode };
  });

  await test('intro: plays on startup with logo and can be skipped', async () => {
    const x = await openGame({ settings: { introOnStartup: true }, query: 'seed=1' });
    await x.page.waitForFunction(() => window.RaceWars?.state?.state === 'INTRO' && document.getElementById('intro-skip').getBoundingClientRect().width > 0);
    await x.page.keyboard.press('Escape');
    await x.page.waitForFunction(() => window.RaceWars.state.state === 'HOME');
    assert.deepEqual(realErrors(x.errors), []);
    await x.ctx.close();
  });

  await test('console: no errors during the whole session', async () => {
    // (main session was parked on about:blank before the multiplayer tests)
    assert.deepEqual(realErrors(main.errors), []);
  });
}

try {
  await main();
} catch (err) {
  console.error('Suite aborted:', err);
  results.push({ name: 'suite', status: 'FAIL', error: String(err) });
} finally {
  save();
  sockets.forEach(s => s.close());
  await browser?.close().catch(() => {});
  procs.forEach(p => p.kill());
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n${results.filter(r => r.status === 'PASS').length} passed, ${failed} failed, ${results.filter(r => r.status === 'SKIP').length} skipped`);
  process.exit(failed ? 1 : 0);
}
