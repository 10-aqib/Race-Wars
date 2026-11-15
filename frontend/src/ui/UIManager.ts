import { gameState, type GameState } from '../state/StateManager';
import { settings, type GameSettings } from '../state/SettingsManager';
import { profile } from '../state/ProfileManager';
import type { NetworkManager, PlayerInfo, RankingEntry } from '../network/NetworkManager';
import { audioManager } from '../game/AudioManager';
import { CAR_CATALOGUE, PAINT_COLORS, getCarById } from '../game/CarConfig';
import { carStats } from '../game/vehicle/VehicleStats';
import type { Game } from '../game/Game';
import { formatTime } from './Hud';

/**
 * Race Wars — UI controller. Screens are plain DOM sections toggled by the
 * global state machine; every visible control is wired to real state.
 */

const SCREENS: Partial<Record<GameState, string>> = {
  LOADING: 'loading-screen', INTRO: 'intro-screen', HOME: 'home-screen', RACE_LOBBY: 'race-lobby-screen',
  GARAGE: 'garage-screen', PROFILE: 'profile-screen', SETTINGS: 'settings-screen', MULTIPLAYER: 'multiplayer-screen',
  LOBBY: 'lobby-screen', PAUSED: 'pause-screen', RESULTS: 'results-screen', DISCONNECTED: 'disconnected-screen', ERROR: 'error-screen',
};
const HUD_STATES: GameState[] = ['COUNTDOWN', 'RACING', 'PAUSED', 'FINISHED'];
const PAINTS = Object.keys(PAINT_COLORS);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

export class UIManager {
  private network: NetworkManager;
  private game!: Game;
  private lobbyPlayers: PlayerInfo[] = [];
  private garageIndex = 0;
  private settingsReturn: GameState | null = null;
  private lastOnlineRankings: RankingEntry[] | null = null;

  constructor(network: NetworkManager) {
    this.network = network;
    gameState.onStateChange((n, o) => this.onState(n, o));
    this.bindNavigation();
    this.bindRaceLobby();
    this.bindGarage();
    this.bindProfile();
    this.bindSettings();
    this.bindMultiplayer();
    this.bindRaceControls();
    this.syncSettingsUI();
  }

  attachGame(game: Game): void {
    this.game = game;
    game.onResults = () => this.renderOfflineResults();
    const info = $('renderer-info');
    if (info) {
      const gl = game.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      info.textContent = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 48) : 'WebGL';
    }
    this.drawLobbyMap();
    this.refreshHome();
  }

  // ── State → screen ─────────────────────────────────────────────────────────

  private onState(state: GameState, old: GameState): void {
    const oldScreen = SCREENS[old];
    const newScreen = SCREENS[state];
    // Settings opened from pause keep the race HUD underneath
    if (oldScreen && oldScreen !== newScreen) $(oldScreen)?.classList.remove('screen--active');
    if (newScreen) $(newScreen)?.classList.add('screen--active');
    const hud = $('racing-hud');
    hud?.classList.toggle('is-visible', HUD_STATES.includes(state) || (state === 'SETTINGS' && this.settingsReturn === 'PAUSED'));
    document.body.classList.toggle('in-race', HUD_STATES.includes(state) || state === 'RESULTS');
    if (state === 'HOME') this.refreshHome();
    if (state === 'RACE_LOBBY') this.renderRaceLobby();
    if (state === 'GARAGE') this.openGarage();
    if (state === 'PROFILE') this.renderProfile();
    if (state === 'SETTINGS') this.syncSettingsUI();
    if (state === 'MULTIPLAYER') this.renderMpStatus();
    if (state === 'PAUSED') { $('pause-mp-note')!.style.display = this.network.isInRoom() ? 'block' : 'none'; ($('pause-restart') as HTMLButtonElement).disabled = this.network.isInRoom(); setTimeout(() => $('pause-resume')?.focus(), 30); }
    if (state === 'RESULTS') setTimeout(() => $('results-again')?.focus(), 30);
    if (state === 'HOME') setTimeout(() => (document.querySelector('.side-nav__item') as HTMLElement | null)?.focus({ preventScroll: true }), 30);
    if (old === 'GARAGE' && state !== 'GARAGE') this.game?.refreshHero();
  }

  private click(): void { audioManager.playUIClick(); }

  private bindNavigation(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(btn => btn.addEventListener('click', () => {
      this.click();
      gameState.setState(btn.dataset.nav as GameState);
    }));
    document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(btn => btn.addEventListener('click', () => { this.click(); this.back(); }));
    $('home-event')?.addEventListener('click', () => { this.click(); gameState.setState('RACE_LOBBY'); });
    // Keyboard navigation for the side menu
    $('home-nav')?.addEventListener('keydown', e => {
      const items = Array.from(document.querySelectorAll<HTMLElement>('.side-nav__item'));
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') { items[(i + 1) % items.length].focus(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !gameState.isGameplay() && ['RACE_LOBBY', 'GARAGE', 'PROFILE', 'SETTINGS', 'MULTIPLAYER'].includes(gameState.state)) {
        if (e.target instanceof HTMLInputElement) return;
        this.back();
      }
      if (gameState.is('GARAGE') && !(e.target instanceof HTMLInputElement)) {
        if (e.key === 'ArrowLeft') $('garage-prev')?.click();
        if (e.key === 'ArrowRight') $('garage-next')?.click();
      }
    });
    $('error-retry')?.addEventListener('click', () => location.reload());
    $('disconnect-menu')?.addEventListener('click', () => gameState.setState('HOME'));
  }

  private back(): void {
    if (gameState.is('SETTINGS') && this.settingsReturn === 'PAUSED') {
      this.settingsReturn = null;
      gameState.setState('PAUSED');
      return;
    }
    gameState.goBack();
    if (gameState.is('LOADING', 'INTRO')) gameState.setState('HOME');
  }

  private refreshHome(): void {
    const cfg = getCarById(settings.get('selectedCarId'));
    $('home-driver-name')!.textContent = settings.get('playerName') || 'PLAYER';
    $('home-driver-car')!.textContent = cfg.name;
    const laps = settings.get('laps');
    $('home-event-laps')!.textContent = settings.get('raceMode') === 'free' ? 'FREE DRIVE' : `${laps} LAP${laps > 1 ? 'S' : ''}`;
    if (this.game) $('home-event-length')!.textContent = `${(this.game.track.length / 1000).toFixed(1)} KM`;
  }

  // ── Offline race lobby ─────────────────────────────────────────────────────

  private bindRaceLobby(): void {
    document.querySelectorAll<HTMLElement>('.seg').forEach(seg => {
      seg.querySelectorAll<HTMLButtonElement>('button').forEach(btn => btn.addEventListener('click', () => {
        this.click();
        const key = seg.dataset.setting as keyof GameSettings;
        const raw = btn.dataset.value!;
        settings.set(key, (key === 'laps' ? Number(raw) : raw) as never);
        this.renderRaceLobby();
      }));
    });
    $('lobby-start')?.addEventListener('click', () => { this.click(); this.game.startOfflineRace(); });
    $('lobby-change-car')?.addEventListener('click', () => { this.click(); gameState.setState('GARAGE'); });
  }

  private renderRaceLobby(): void {
    document.querySelectorAll<HTMLElement>('#race-lobby-screen .seg').forEach(seg => {
      const v = String(settings.get(seg.dataset.setting as keyof GameSettings));
      seg.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.classList.toggle('is-active', b.dataset.value === v));
    });
    const free = settings.get('raceMode') === 'free';
    document.querySelectorAll<HTMLElement>('[data-race-only]').forEach(el => el.classList.toggle('is-disabled', free));
    const cfg = getCarById(settings.get('selectedCarId'));
    const diff = settings.get('difficulty').toUpperCase();
    const rows = [
      { name: settings.get('playerName') || 'YOU', car: cfg.name, color: settings.get('selectedColor'), tag: 'YOU', status: 'READY', ai: false },
      ...(free ? [] : [
        { name: 'RAYAN', car: 'APEX GT', color: 'blue', tag: `AI · ${diff} · BALANCED`, status: 'READY', ai: true },
        { name: 'ZAIN', car: 'NOVA RS', color: 'green', tag: `AI · ${diff} · AGGRESSIVE`, status: 'READY', ai: true },
      ]),
    ];
    $('race-roster')!.innerHTML = rows.map(r => `
      <div class="racer-card${r.ai ? '' : ' racer-card--me'}">
        <div class="racer-card__avatar" style="--c:${cssPaint(r.color)}">${esc(r.name.charAt(0))}</div>
        <div class="racer-card__info"><div class="racer-card__name">${esc(r.name)}</div><div class="racer-card__meta">${esc(r.car)} · ${esc(r.tag)}</div></div>
        <div class="racer-card__status">${r.status}</div>
      </div>`).join('') + (free ? '<div class="roster__note">Free Drive: no opponents, no timer limit. Leave from the pause menu.</div>' : '');
    ($('lobby-start') as HTMLButtonElement).textContent = free ? 'START DRIVING' : 'START RACE';
  }

  private drawLobbyMap(): void {
    const c = $('lobby-track-map') as HTMLCanvasElement | null;
    if (!c || !this.game) return;
    const t = this.game.track, ctx = c.getContext('2d')!;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.count; i++) { minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]); minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]); }
    const s = (c.width - 30) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (c.width - (maxX - minX) * s) / 2, oz = (c.height - (maxZ - minZ) * s) / 2;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= t.count; i += 3) { const k = i % t.count; const x = ox + (t.px[k] - minX) * s, y = oz + (t.pz[k] - minZ) * s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.strokeStyle = '#e8e8ea'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#e11d2a'; ctx.fillRect(ox + (t.px[0] - minX) * s - 7, oz + (t.pz[0] - minZ) * s - 2, 14, 4);
    $('lobby-track-meta')!.textContent = `${(t.length / 1000).toFixed(2)} KM · ${t.checkpointCount} CHECKPOINTS`;
  }

  // ── Garage ─────────────────────────────────────────────────────────────────

  private bindGarage(): void {
    $('garage-paints')!.innerHTML = PAINTS.map(p => `<button class="paint" data-paint="${p}" style="--c:${cssPaint(p)}" aria-label="${p} paint"></button>`).join('');
    document.querySelectorAll<HTMLButtonElement>('.paint').forEach(b => b.addEventListener('click', () => {
      this.click();
      settings.set('selectedColor', b.dataset.paint!);
      this.game.setHeroPaint(PAINT_COLORS[b.dataset.paint!]);
      this.renderGarage();
    }));
    const step = (d: number) => {
      this.click();
      this.garageIndex = (this.garageIndex + d + CAR_CATALOGUE.length) % CAR_CATALOGUE.length;
      this.game.refreshHero(CAR_CATALOGUE[this.garageIndex].id);
      this.renderGarage();
    };
    $('garage-prev')?.addEventListener('click', () => step(-1));
    $('garage-next')?.addEventListener('click', () => step(1));
    $('garage-rot-left')?.addEventListener('click', () => this.game.garage.rotateSelected(-0.6));
    $('garage-rot-right')?.addEventListener('click', () => this.game.garage.rotateSelected(0.6));
    $('garage-select')?.addEventListener('click', () => {
      this.click();
      const car = CAR_CATALOGUE[this.garageIndex];
      settings.set('selectedCarId', car.id);
      settings.set('selectedColor', Object.entries(PAINT_COLORS).find(([, v]) => v === car.bodyColor)?.[0] ?? settings.get('selectedColor'));
      this.game.refreshHero(car.id);
      this.game.setHeroPaint(PAINT_COLORS[settings.get('selectedColor')]);
      this.toast(`${car.name} SELECTED`);
      this.renderGarage();
    });
  }

  private openGarage(): void {
    const idx = CAR_CATALOGUE.findIndex(c => c.id === settings.get('selectedCarId'));
    this.garageIndex = idx >= 0 ? idx : 0;
    this.game?.refreshHero();
    this.renderGarage();
  }

  private renderGarage(): void {
    const car = CAR_CATALOGUE[this.garageIndex];
    const st = carStats(car);
    const selected = car.id === settings.get('selectedCarId');
    $('garage-car-index')!.textContent = `${this.garageIndex + 1} / ${CAR_CATALOGUE.length}`;
    $('garage-car-name')!.textContent = car.name;
    $('garage-car-tagline')!.textContent = car.tagline;
    for (const [k, v] of Object.entries(st.bars)) { const el = $(`perf-${k}`); if (el) el.style.width = `${v}%`; }
    const mph = settings.get('speedUnit') === 'mph';
    $('fact-top')!.textContent = mph ? `${Math.round(st.topSpeedKmh * 0.621)} MPH` : `${st.topSpeedKmh} KM/H`;
    $('fact-accel')!.textContent = `${st.zeroTo100.toFixed(2)} S`;
    $('fact-brake')!.textContent = `${st.brake100to0.toFixed(1)} M`;
    $('fact-power')!.textContent = `${st.powerKW} KW`;
    $('fact-mass')!.textContent = `${st.massKg} KG`;
    $('fact-nitro')!.textContent = `${st.nitroSeconds.toFixed(1)} S`;
    const btn = $('garage-select') as HTMLButtonElement;
    btn.textContent = selected ? '✓ SELECTED' : 'SELECT';
    btn.classList.toggle('is-selected', selected);
    document.querySelectorAll<HTMLButtonElement>('.paint').forEach(b => {
      b.classList.toggle('is-active', selected && b.dataset.paint === settings.get('selectedColor'));
      b.disabled = !selected;
      b.title = selected ? '' : 'Select this car to change its paint';
    });
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  private bindProfile(): void {
    const input = $('profile-name-input') as HTMLInputElement;
    input?.addEventListener('change', () => { settings.set('playerName', input.value.trim().slice(0, 16)); this.toast('DRIVER NAME SAVED'); });
    $('profile-reset')?.addEventListener('click', () => { if (confirm('Reset all race statistics?')) { profile.reset(); this.renderProfile(); } });
  }

  private renderProfile(): void {
    const p = profile.getStats();
    ($('profile-name-input') as HTMLInputElement).value = settings.get('playerName');
    const mph = settings.get('speedUnit') === 'mph';
    $('stat-races')!.textContent = String(p.racesPlayed);
    $('stat-wins')!.textContent = String(p.wins);
    $('stat-podiums')!.textContent = String(p.podiums);
    $('stat-winrate')!.textContent = `${profile.getWinRate()}%`;
    $('stat-bestlap')!.textContent = p.bestLap ? formatTime(p.bestLap).slice(1) : '--';
    $('stat-topspeed')!.textContent = String(mph ? Math.round(p.bestSpeed * 0.621) : p.bestSpeed);
    $('stat-topspeed-unit')!.textContent = mph ? 'TOP MPH' : 'TOP KM/H';
    $('stat-distance')!.textContent = `${(p.totalDistance / 1000).toFixed(1)} KM`;
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  private bindSettings(): void {
    document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => tab.addEventListener('click', () => {
      this.click();
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === `tab-${tab.dataset.tab}`));
    }));
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[id^="set-"]').forEach(el => {
      const key = el.id.slice(4) as keyof GameSettings;
      const ev = el instanceof HTMLInputElement && el.type === 'range' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        let value: unknown;
        if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked;
        else if (el instanceof HTMLInputElement && el.type === 'range') value = Number(el.value);
        else value = el.value;
        settings.set(key, value as never);
        if (key === 'antiAliasing') this.toast('ANTI-ALIASING APPLIES AFTER RELOAD');
        this.syncSettingsUI();
      });
    });
    $('settings-reset')?.addEventListener('click', () => { this.click(); const name = settings.get('playerName'); settings.reset(); settings.set('playerName', name); this.syncSettingsUI(); this.toast('SETTINGS RESET'); });
  }

  private syncSettingsUI(): void {
    const s = settings.getAll() as unknown as Record<string, unknown>;
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[id^="set-"]').forEach(el => {
      const v = s[el.id.slice(4)];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = String(v);
      const out = el.parentElement?.querySelector('output');
      if (out) out.textContent = `${v}%`;
    });
  }

  // ── Online multiplayer ─────────────────────────────────────────────────────

  private bindMultiplayer(): void {
    const name = $('mp-player-name') as HTMLInputElement;
    name?.addEventListener('change', () => settings.set('playerName', name.value.trim().slice(0, 16)));
    const connect = () => {
      const n = (name?.value.trim() || settings.get('playerName')).slice(0, 16);
      if (!n) { this.toast('ENTER A DRIVER NAME FIRST'); name?.focus(); return false; }
      settings.set('playerName', n);
      this.network.connect(n, settings.get('selectedColor'), settings.get('selectedCarId'));
      $('mp-status')!.textContent = 'CONNECTING…';
      return true;
    };
    $('mp-create-btn')?.addEventListener('click', () => { this.click(); if (connect()) this.network.createRoom(); });
    $('mp-join-btn')?.addEventListener('click', () => {
      this.click();
      const code = ($('mp-join-code') as HTMLInputElement).value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) { this.toast('ROOM CODES ARE 4 LETTERS'); return; }
      if (connect()) this.network.joinRoom(code);
    });
    $('lobby-copy-btn')?.addEventListener('click', async () => {
      const code = this.network.getRoomCode();
      if (!code) return;
      try { await navigator.clipboard.writeText(code); this.toast('ROOM CODE COPIED'); } catch { this.toast(`ROOM CODE: ${code}`); }
    });
    $('lobby-ready-btn')?.addEventListener('click', e => {
      this.click();
      const btn = e.currentTarget as HTMLButtonElement;
      const ready = !btn.classList.contains('is-ready');
      btn.classList.toggle('is-ready', ready);
      btn.textContent = ready ? 'READY ✓' : 'READY';
      this.network.setReady(ready);
    });
    $('lobby-leave-btn')?.addEventListener('click', () => { this.click(); this.network.leaveRoom(); gameState.setState('MULTIPLAYER'); });

    this.network.onError = msg => { this.toast(msg.toUpperCase()); this.renderMpStatus(); };
    this.network.onRoomJoined = (code, players) => {
      $('lobby-room-code')!.textContent = code;
      this.lobbyPlayers = players;
      const btn = $('lobby-ready-btn') as HTMLButtonElement; btn.classList.remove('is-ready'); btn.textContent = 'READY';
      this.renderOnlineLobby();
      gameState.setState('LOBBY');
    };
    this.network.onPlayerJoined = (_, info) => {
      if (this.lobbyPlayers.some(p => p.id === info.id)) return;
      this.lobbyPlayers.push(info); this.renderOnlineLobby(); this.toast(`${info.name} JOINED`);
    };
    this.network.onPlayerLeft = id => {
      const p = this.lobbyPlayers.find(x => x.id === id);
      if (p) this.toast(`${p.name} LEFT`);
      this.lobbyPlayers = this.lobbyPlayers.filter(x => x.id !== id);
      this.renderOnlineLobby();
    };
    this.network.onPlayerReady = (id, ready) => { const p = this.lobbyPlayers.find(x => x.id === id); if (p) { p.isReady = ready; this.renderOnlineLobby(); } };
    this.network.onCountdown = value => {
      if (!this.game.race.player || !gameState.isGameplay()) {
        this.game.startOnlineRace(this.lobbyPlayers);
        gameState.setState('COUNTDOWN');
      }
      void value;
    };
    this.network.onRaceStart = () => {
      if (this.game.race.phase === 'countdown') { this.game.race.countdownTime = 0; }
    };
    this.network.onRaceFinished = rankings => {
      this.lastOnlineRankings = rankings;
      this.renderOnlineResults(rankings);
      gameState.setState('RESULTS');
    };
  }

  private renderMpStatus(): void {
    const el = $('mp-status');
    if (el) el.textContent = this.network.connected ? 'CONNECTED' : 'NOT CONNECTED';
    const name = $('mp-player-name') as HTMLInputElement | null;
    if (name && !name.value) name.value = settings.get('playerName');
  }

  private renderOnlineLobby(): void {
    const me = this.network.getId();
    $('lobby-player-list')!.innerHTML = this.lobbyPlayers.map((p, i) => `
      <div class="racer-card${p.id === me ? ' racer-card--me' : ''}">
        <div class="racer-card__avatar" style="--c:${cssPaint(p.color)}">${esc(p.name.charAt(0))}</div>
        <div class="racer-card__info"><div class="racer-card__name">${esc(p.name)}${p.id === me ? ' (YOU)' : ''}</div><div class="racer-card__meta">${esc(getCarById(p.carId ?? 'vortex_r').name)}${i === 0 ? ' · HOST' : ''}</div></div>
        <div class="racer-card__status${p.isReady ? ' is-ready' : ''}">${p.isReady ? 'READY' : 'WAITING'}</div>
      </div>`).join('');
  }

  // ── In-race controls ───────────────────────────────────────────────────────

  private bindRaceControls(): void {
    $('pause-resume')?.addEventListener('click', () => { this.click(); this.game.resume(); });
    $('pause-restart')?.addEventListener('click', () => { this.click(); this.game.abandonRace(); this.game.restartRace(); });
    $('pause-settings')?.addEventListener('click', () => { this.click(); this.settingsReturn = 'PAUSED'; gameState.setState('SETTINGS'); });
    $('pause-leave')?.addEventListener('click', () => { this.click(); $('leave-confirm')!.classList.add('is-visible'); $('confirm-stay')?.focus(); });
    $('confirm-stay')?.addEventListener('click', () => { this.click(); $('leave-confirm')!.classList.remove('is-visible'); });
    $('confirm-leave')?.addEventListener('click', () => {
      this.click();
      $('leave-confirm')!.classList.remove('is-visible');
      this.game.abandonRace();
      if (this.network.isInRoom()) this.network.leaveRoom();
      gameState.resetHistory('HOME');
      gameState.setState('HOME');
    });
    $('results-again')?.addEventListener('click', () => {
      this.click();
      if (this.network.isInRoom()) { gameState.setState('LOBBY'); this.renderOnlineLobby(); return; }
      this.game.startOfflineRace();
    });
    $('results-menu')?.addEventListener('click', () => {
      this.click();
      if (this.network.isInRoom()) this.network.leaveRoom();
      gameState.resetHistory('HOME');
      gameState.setState('HOME');
    });
  }

  private renderOfflineResults(): void {
    const race = this.game.race;
    const st = race.standings();
    const me = st.find(s => s.isPlayer);
    const free = race.options.mode === 'free';
    $('results-kicker')!.textContent = `NIGHT CIRCUIT · ${race.options.laps} LAP${race.options.laps > 1 ? 'S' : ''} · ${race.options.difficulty.toUpperCase()} AI`;
    $('results-place')!.textContent = me ? ordinal(me.position) + (me.finished ? '' : ' · DNF') : '';
    $('results-place')!.classList.toggle('is-win', me?.position === 1);
    const leader = st[0];
    $('results-rankings')!.innerHTML = `<div class="results__row results__row--head"><span>POS</span><span>DRIVER</span><span>CAR</span><span>TIME</span><span>BEST LAP</span><span>TOP</span></div>` + st.map(s => {
      const time = s.finished ? (s.position === 1 || !leader.finished ? formatTime(s.time) : `+${(s.time - leader.time).toFixed(3)}`) : `DNF · ${Math.round(Math.max(0, race.raceDistance - s.progress))}M LEFT`;
      return `<div class="results__row${s.isPlayer ? ' results__row--me' : ''}" role="row"><span class="results__pos">${ordinal(s.position)}</span><span>${esc(s.name)}</span><span>${esc(s.carName)}</span><span>${time}</span><span>${s.bestLap ? formatTime(s.bestLap) : '--'}</span><span>${s.topSpeedKmh} KM/H</span></div>`;
    }).join('');
    const p = race.player!;
    $('results-stats')!.innerHTML = [
      ['YOUR TIME', p.finished ? formatTime(p.finishTime) : 'DNF'],
      ['BEST LAP', p.bestLap ? formatTime(p.bestLap) : '--'],
      ['TOP SPEED', `${Math.round(p.topSpeed * 3.6)} KM/H`],
      ['CONTACTS', String(p.collisions)],
      ['RESETS', String(p.resets)],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    void free;
  }

  private renderOnlineResults(rankings: RankingEntry[]): void {
    const me = this.network.getId();
    const mine = rankings.find(r => r.id === me);
    $('results-kicker')!.textContent = 'ONLINE · NIGHT CIRCUIT · SERVER-VALIDATED';
    $('results-place')!.textContent = mine ? ordinal(mine.position) : '';
    $('results-rankings')!.innerHTML = `<div class="results__row results__row--head"><span>POS</span><span>DRIVER</span><span>STATUS</span><span>TIME</span><span></span><span></span></div>` + rankings.map(r =>
      `<div class="results__row${r.id === me ? ' results__row--me' : ''}"><span class="results__pos">${ordinal(r.position)}</span><span>${esc(r.name)}</span><span>${r.finished ? 'FINISHED' : 'DNF'}</span><span>${r.finished && r.time ? formatTime(r.time) : `${Math.round(r.progress)} M`}</span><span></span><span></span></div>`).join('');
    $('results-stats')!.innerHTML = '';
    void this.lastOnlineRankings;
  }

  toast(msg: string): void {
    const host = $('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.classList.add('is-leaving'), 2400);
    setTimeout(() => el.remove(), 2900);
  }
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH';
  return `${n}${n % 10 > 3 ? 'TH' : s}`;
}
function cssPaint(name: string): string { return `#${(PAINT_COLORS[name] ?? 0xb3121b).toString(16).padStart(6, '0')}`; }
function esc(v: string): string { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
