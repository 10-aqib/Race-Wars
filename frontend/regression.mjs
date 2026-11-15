import { chromium } from 'playwright';
import { io } from 'socket.io-client';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const results = [];
const processes = [];
const sockets = [];
let browser;
const saveResults = () => fs.writeFileSync('regression-results.json', JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const event = (socket, name) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout: ${name}`)), 15000);
  socket.once(name, data => { clearTimeout(timer); resolve(data); });
});
async function check(name, fn) {
  console.log(`RUN ${name}`);
  try { await fn(); results.push({ name, status: 'PASS' }); saveResults(); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'FAIL', error: String(error) }); saveResults(); throw error; }
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await pause(150);
  }
  throw new Error(`Server unavailable: ${url}`);
}
async function client(name) {
  const socket = io('http://127.0.0.1:3101', { auth: { playerName: name, color: 'blue' }, transports: ['websocket'] });
  sockets.push(socket); await event(socket, 'connect'); return socket;
}
try {
  processes.push(spawn(process.execPath, ['../backend/server.js'], { env: { ...process.env, PORT: '3101' }, windowsHide: true, stdio: 'ignore' }));
  processes.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { env: { ...process.env, VITE_SERVER_URL: 'http://127.0.0.1:3101' }, windowsHide: true, stdio: 'ignore' }));
  await Promise.all([ready('http://127.0.0.1:3101/health'), ready('http://127.0.0.1:5175')]);
  console.log('Servers ready; launching browser');
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER || 'msedge', headless: true, timeout: 30000 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('raceWarsSettings', JSON.stringify({ introSeen: true, qualityPreset: 'low', shadows: false })));
  await page.goto('http://127.0.0.1:5175', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RaceWars?.game.getCar().modelStatus === 'loaded', null, { timeout: 60000 });
  await check('GLB/DRACO load, home camera, rendered geometry', async () => {
    await page.waitForFunction(() => window.RaceWars.game.renderer.info.render.calls > 0);
    assert.equal(await page.evaluate(() => window.RaceWars.state.state), 'HOME');
    assert.ok(await page.evaluate(() => window.RaceWars.game.cameraSystem.camera.position.distanceTo(window.RaceWars.game.getCar().position) < 15));
    await page.screenshot({ path: 'regression-home.png' });
  });
  await page.click('#nav-race');
  await page.click('#mode-time-race');
  await check('Countdown locks throttle and boost; then starts race', async () => {
    await page.keyboard.down('w'); await page.keyboard.down('Shift'); await pause(400);
    assert.equal(await page.evaluate(() => window.RaceWars.game.getCar().speed), 0);
    assert.equal(await page.evaluate(() => window.RaceWars.game.getCar().boostCurrent), 100);
    await page.keyboard.up('w'); await page.keyboard.up('Shift');
    await page.waitForFunction(() => window.RaceWars.state.state === 'RACING', null, { timeout: 15000 });
  });
  await check('Keyboard forward movement and brake', async () => {
    await page.keyboard.down('w');
    await page.waitForFunction(() => window.RaceWars.game.getCar().position.z < -5);
    await page.keyboard.up('w');
    const speed = await page.evaluate(() => window.RaceWars.game.getCar().speed);
    await page.keyboard.down('s'); await pause(300); await page.keyboard.up('s');
    assert.ok(await page.evaluate(s => window.RaceWars.game.getCar().speed < s, speed));
  });
  await check('Physics steering, boost drain, collision size, reverse', async () => {
    const data = await page.evaluate(() => {
      const g = window.RaceWars.game; g.stop(); const c = g.getCar(); c.reset();
      for (let i = 0; i < 120; i++) c.update({ forward: true, boost: true }, 1 / 60);
      const forward = c.position.z < -20 && c.boostCurrent < 40;
      c.update({ forward: true, left: true }, 0.1); const left = c.position.x < 0;
      c.reset(); for (let i = 0; i < 60; i++) c.update({ backward: true }, 1 / 60);
      return { forward, left, reverse: c.position.z > 0, box: c.boundingBox.max.z - c.boundingBox.min.z };
    });
    assert.ok(data.forward && data.left && data.reverse); assert.equal(data.box, 4.5);
  });
  await check('Road coverage at 0/500/1000/3000m, reverse and restart', async () => {
    assert.ok(await page.evaluate(() => {
      const e = window.RaceWars.game.environment;
      return [0, -500, -1000, -3000, 500, 0].every(z => {
        e.update(z); const b = e.getRoadBounds();
        return b.minZ < z - 1000 && b.maxZ >= z;
      });
    }));
  });
  await check('Pause settings preserve car position; pause UI visible', async () => {
    await page.evaluate(() => { const r = window.RaceWars; r.state.setState('PAUSED'); });
    assert.ok(await page.locator('#pause-screen').isVisible());
    const before = await page.evaluate(() => window.RaceWars.game.getCar().position.toArray());
    await page.click('#pause-settings-btn'); await page.click('#settings-back-btn');
    assert.deepEqual(await page.evaluate(() => window.RaceWars.game.getCar().position.toArray()), before);
    await page.click('#pause-resume-btn');
    assert.equal(await page.evaluate(() => window.RaceWars.state.state), 'RACING');
  });
  await check('Crash recovery and race clock while crashed', async () => {
    const data = await page.evaluate(async () => {
      const r = window.RaceWars; const g = r.game; g.handleCrash();
      const t = g.raceTimeLeft; g.update(0.1); const ticking = g.raceTimeLeft < t;
      g.input.reset = true; g.update(0.01);
      await new Promise(resolve => setTimeout(resolve, 600));
      return { ticking, state: r.state.state, crashed: g.getCar().isCrashed };
    });
    assert.ok(data.ticking); assert.equal(data.state, 'RACING'); assert.equal(data.crashed, false);
  });
  await check('Race results, AI rankings and profile refresh', async () => {
    await page.evaluate(() => { const g = window.RaceWars.game; g.raceTimeLeft = 0.01; g.update(0.02); });
    await page.waitForFunction(() => window.RaceWars.state.state === 'RESULTS');
    assert.equal(await page.locator('.result__row').count(), 3);
    await page.click('#results-menu-btn'); await page.click('#nav-profile');
    assert.equal(await page.locator('#profile-races').textContent(), '1');
  });
  await check('Free drive has no time limit and restart is playable', async () => {
    await page.evaluate(() => window.RaceWars.state.setState('HOME'));
    await page.click('#nav-race'); await page.click('#mode-free-drive');
    await page.waitForFunction(() => window.RaceWars.state.state === 'RACING');
    const data = await page.evaluate(() => { const g = window.RaceWars.game; g.stop(); g.raceTimeLeft = 0.01; g.update(0.1); return { state: window.RaceWars.state.state, timer: g.raceTimeLeft }; });
    assert.equal(data.state, 'RACING'); assert.equal(data.timer, 0.01);
    await page.evaluate(() => window.RaceWars.game.render());
    await page.screenshot({ path: 'regression-race.png' });
  });
  await check('Reflections/shadows settings and hostile player-name escaping', async () => {
    assert.ok(await page.evaluate(() => {
      const r = window.RaceWars; r.settings.set('reflections', false); r.settings.set('shadows', false);
      r.ui.renderResults([{ name: '<img src=x onerror=alert(1)>', distance: 10 }]);
      return r.game.scene.environment === null && !r.game.environment.directionalLight.castShadow && !document.querySelector('#results-rankings img');
    }));
  });
  await check('Mobile menus fit viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.RaceWars.state.setState('HOME'));
    assert.ok(await page.locator('#nav-race').isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  const a = await client('Host'), b = await client('Guest'), c = await client('Third'), d = await client('Fourth');
  let code;
  await check('Create/join three-player room; reject fourth', async () => {
    const joined = event(a, 'room_joined'); a.emit('create_room'); code = (await joined).roomCode;
    for (const s of [b, c]) { const joined = event(s, 'room_joined'); s.emit('join_room', code); await joined; }
    const full = event(d, 'error_msg'); d.emit('join_room', code); assert.equal(await full, 'Room is full');
  });
  await check('Malformed messages do not crash server; countdown/start/sync', async () => {
    d.emit('join_room', { bad: true }); a.emit('set_ready', 'true'); a.emit('player_update', null);
    const started = event(a, 'start_race'); [a, b, c].forEach(s => s.emit('set_ready', true)); await started;
    a.emit('player_update', null); a.emit('player_update', { x: 0, z: 'bad' });
    const update = event(b, 'player_update'); a.emit('player_update', { x: -2, z: -100, h: 0, speed: 20, isCrashed: false });
    assert.equal((await update).state.z, -100); await ready('http://127.0.0.1:3101/health');
  });
  await check('Finish ranking ignores forged distance; room can race again', async () => {
    const finished = event(a, 'race_finished'); [a, b, c].forEach(s => s.emit('finish_race', { distance: 9999999 }));
    const rankings = await finished; assert.equal(rankings[0].distance, 100);
    const started = event(a, 'start_race'); [a, b, c].forEach(s => s.emit('set_ready', true)); await started;
  });
  await check('Leaving during countdown cancels abandoned start', async () => {
    [b, c].forEach(s => s.emit('leave_room')); await pause(100);
    const j = event(b, 'room_joined'); b.emit('join_room', code); await j;
    const countdown = event(a, 'countdown'); a.emit('set_ready', true); b.emit('set_ready', true); await countdown;
    let started = false; a.once('start_race', () => started = true); b.emit('leave_room'); await pause(4500);
    assert.equal(started, false);
  });
  await check('Browser lobby roster and remote cars synchronize on join/leave', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.click('#nav-multiplayer');
    await page.fill('#mp-player-name', 'Browser Racer');
    await page.fill('#mp-join-code', code);
    await page.click('#mp-join-btn');
    await page.waitForFunction(() => window.RaceWars.state.state === 'LOBBY');
    assert.equal(await page.locator('.player-card').count(), 2);
    assert.equal(await page.evaluate(() => window.RaceWars.game.remoteCars.size), 1);
    const joined = event(b, 'room_joined'); b.emit('join_room', code); await joined;
    await page.waitForFunction(() => window.RaceWars.game.remoteCars.size === 2);
    assert.equal(await page.locator('.player-card').count(), 3);
    b.emit('leave_room');
    await page.waitForFunction(() => window.RaceWars.game.remoteCars.size === 1);
    assert.equal(await page.locator('.player-card').count(), 2);
    await page.click('#lobby-leave-btn');
    assert.equal(await page.evaluate(() => window.RaceWars.game.remoteCars.size), 0);
  });
  await check('Missing model uses visible fallback without a stuck loading screen', async () => {
    const fallback = await browser.newPage();
    await fallback.route('**/car.glb', route => route.abort());
    await fallback.goto('http://127.0.0.1:5175', { waitUntil: 'domcontentloaded' });
    await fallback.waitForFunction(() => window.RaceWars?.game.getCar().modelStatus === 'fallback', null, { timeout: 60000 });
    assert.ok(await fallback.evaluate(() => window.RaceWars.game.getCar().mesh.children[0].children.length >= 2));
    await fallback.close();
  });
  await check('Unavailable WebGL displays recoverable error screen', async () => {
    const unavailable = await browser.newPage();
    await unavailable.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type === 'webgl2') return null;
        return getContext.call(this, type, ...args);
      };
    });
    await unavailable.goto('http://127.0.0.1:5175', { waitUntil: 'domcontentloaded' });
    await unavailable.waitForSelector('#error-screen.screen--active');
    assert.ok(await unavailable.locator('#error-screen').isVisible());
    await unavailable.close();
  });
  await check('No uncaught browser runtime errors', async () => assert.deepEqual(errors, []));
} catch (error) { results.push({ name: 'Run completion', status: 'FAIL', error: String(error) }); saveResults(); console.error(error); process.exitCode = 1; }
finally {
  sockets.forEach(s => s.disconnect()); await browser?.close(); processes.forEach(p => p.kill());
  fs.writeFileSync('regression-results.json', JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
}
