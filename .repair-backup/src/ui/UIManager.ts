import { gameState } from '../state/StateManager';
import type { GameState } from '../state/StateManager';
import { settings } from '../state/SettingsManager';
import { profile } from '../state/ProfileManager';
import type { NetworkManager, PlayerInfo } from '../network/NetworkManager';
import { audioManager } from '../game/AudioManager';
import { CAR_CATALOGUE } from '../game/CarConfig';

/**
 * Race Wars — UI Manager
 * Handles DOM manipulation and state bindings.
 * All settings controls NOW affect actual game state.
 * Garage is wired to 5 real car configurations.
 */

export class UIManager {
  private network: NetworkManager;
  private lobbyPlayers: PlayerInfo[] = [];

  // Garage state
  private garageIndex = 0;

  constructor(network: NetworkManager) {
    this.network = network;
    this.setupStateBindings();
    this.setupButtonListeners();
    this.setupSettingsBindings();
    this.setupNetworkBindings();
    this.setupGarage();

    this.applySettingsToUI();
    this.updateProfileUI();
    this.renderGarageCard();
  }

  // =====================================================
  // STATE MANAGEMENT
  // =====================================================

  private setupStateBindings(): void {
    gameState.onStateChange((newState, oldState) => {
      const oldScreen = this.getScreenId(oldState);
      if (oldScreen) document.getElementById(oldScreen)?.classList.remove('screen--active');

      const newScreen = this.getScreenId(newState);
      if (newScreen) document.getElementById(newScreen)?.classList.add('screen--active');

      const hud = document.getElementById('racing-hud');
      if (hud) {
        hud.style.display = (newState === 'RACING' || newState === 'CRASHED' || newState === 'PAUSED' || newState === 'COUNTDOWN') ? 'block' : 'none';
      }

      this.handleStateSpecificLogic(newState);
    });
  }

  private getScreenId(state: GameState): string | null {
    switch (state) {
      case 'LOADING':      return 'loading-screen';
      case 'INTRO':        return 'intro-screen';
      case 'HOME':         return 'home-screen';
      case 'MODE_SELECT':  return 'mode-screen';
      case 'MULTIPLAYER':  return 'multiplayer-screen';
      case 'LOBBY':        return 'lobby-screen';
      case 'GARAGE':       return 'garage-screen';
      case 'PROFILE':      return 'profile-screen';
      case 'SETTINGS':     return 'settings-screen';
      case 'RESULTS':      return 'results-screen';
      case 'DISCONNECTED': return 'disconnected-screen';
      case 'ERROR':        return 'error-screen';
      case 'PAUSED':       return 'pause-screen';
      default:             return null;
    }
  }

  private handleStateSpecificLogic(state: GameState): void {
    if (state === 'LOBBY') {
      const btn = document.getElementById('btn-ready');
      if (btn) { btn.textContent = 'READY'; btn.classList.remove('btn--ready-active'); }
      this.network.setReady(false);
    }
    if (state === 'GARAGE') {
      this.renderGarageCard();
    }
    if (state === 'SETTINGS') {
      this.applySettingsToUI();
    }
    if (state === 'COUNTDOWN') {
      audioManager.resume();
    }
  }

  // =====================================================
  // BUTTON LISTENERS
  // =====================================================

  private setupButtonListeners(): void {
    // Back buttons
    document.querySelectorAll('.btn--back').forEach(btn => {
      btn.addEventListener('click', () => { audioManager.playUIClick(); gameState.goBack(); });
    });

    // Intro
    document.getElementById('intro-screen')?.addEventListener('click', () => {
      settings.set('introSeen', true);
      gameState.setState('HOME');
    });

    // Home
    document.getElementById('nav-race')?.addEventListener('click', () => { audioManager.playUIClick(); gameState.setState('MODE_SELECT'); });
    document.getElementById('nav-multiplayer')?.addEventListener('click', () => { audioManager.playUIClick(); gameState.setState('MULTIPLAYER'); });
    document.getElementById('nav-garage')?.addEventListener('click', () => { audioManager.playUIClick(); gameState.setState('GARAGE'); });
    document.getElementById('nav-profile')?.addEventListener('click', () => { audioManager.playUIClick(); gameState.setState('PROFILE'); });
    document.getElementById('nav-settings')?.addEventListener('click', () => { audioManager.playUIClick(); gameState.setState('SETTINGS'); });

    document.getElementById('home-featured')?.addEventListener('click', () => {
      audioManager.playUIClick();
      gameState.setState('COUNTDOWN');
      this.startCountdown();
    });

    // Mode select
    document.getElementById('mode-time-race')?.addEventListener('click', () => {
      audioManager.playUIClick();
      gameState.setState('COUNTDOWN');
      this.startCountdown();
    });
    document.getElementById('mode-free-drive')?.addEventListener('click', () => {
      audioManager.playUIClick();
      gameState.setState('COUNTDOWN');
      this.startCountdown();
    });
    document.getElementById('mode-multiplayer')?.addEventListener('click', () => {
      audioManager.playUIClick();
      gameState.setState('MULTIPLAYER');
    });

    // Multiplayer
    document.getElementById('mp-create-btn')?.addEventListener('click', () => {
      if (!settings.get('playerName')) { this.showNotification('Enter a player name first!'); return; }
      audioManager.playUIClick();
      this.network.connect(settings.get('playerName'), settings.get('selectedColor'));
      this.network.createRoom();
    });
    document.getElementById('mp-join-btn')?.addEventListener('click', () => {
      if (!settings.get('playerName')) { this.showNotification('Enter a player name first!'); return; }
      const input = document.getElementById('mp-join-code') as HTMLInputElement;
      const code = input.value.trim().toUpperCase();
      if (code.length === 4) {
        audioManager.playUIClick();
        this.network.connect(settings.get('playerName'), settings.get('selectedColor'));
        this.network.joinRoom(code);
      } else {
        this.showNotification('Invalid room code. Must be 4 letters.');
      }
    });

    // Lobby
    document.getElementById('lobby-copy-btn')?.addEventListener('click', async () => {
      const code = this.network.getRoomCode();
      if (code) {
        try { await navigator.clipboard.writeText(code); } catch (_) {}
        const el = document.getElementById('lobby-copied');
        if (el) { el.style.display = 'inline'; setTimeout(() => el.style.display = 'none', 2000); }
      }
    });
    document.getElementById('lobby-ready-btn')?.addEventListener('click', (e) => {
      audioManager.playUIClick();
      const btn = e.target as HTMLButtonElement;
      const isReady = !btn.classList.contains('btn--ready-active');
      btn.classList.toggle('btn--ready-active', isReady);
      btn.textContent = isReady ? 'READY ✓' : 'READY';
      this.network.setReady(isReady);
    });
    document.getElementById('lobby-leave-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      this.network.leaveRoom();
      gameState.setState('MULTIPLAYER');
    });

    // Settings tabs
    document.querySelectorAll('.settings__tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        audioManager.playUIClick();
        const target = e.target as HTMLElement;
        const tabId = target.getAttribute('data-tab');
        document.querySelectorAll('.settings__tab').forEach(t => t.classList.remove('settings__tab--active'));
        document.querySelectorAll('.settings__content').forEach(c => c.classList.remove('settings__content--active'));
        target.classList.add('settings__tab--active');
        document.getElementById(`settings-${tabId}`)?.classList.add('settings__content--active');
      });
    });

    // Reset defaults button
    document.getElementById('settings-reset-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      settings.reset();
      this.applySettingsToUI();
      this.showNotification('Settings reset to defaults');
    });

    // Profile / name input
    const nameInput = document.getElementById('mp-player-name') as HTMLInputElement;
    nameInput?.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value.trim();
      settings.set('playerName', val);
      this.updateProfileUI();
      this.showNotification('Player name updated');
    });

    // Pause menu
    document.getElementById('pause-resume-btn')?.addEventListener('click', () => { audioManager.playUIClick(); gameState.setState('RACING'); });
    document.getElementById('pause-settings-btn')?.addEventListener('click', () => { audioManager.playUIClick(); gameState.setState('SETTINGS'); });
    document.getElementById('pause-leave-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      document.getElementById('leave-confirm')!.style.display = 'flex';
    });
    document.getElementById('confirm-leave-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      document.getElementById('leave-confirm')!.style.display = 'none';
      if (this.network.isInRoom()) this.network.leaveRoom();
      gameState.setState('HOME');
    });
    document.getElementById('confirm-stay-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      document.getElementById('leave-confirm')!.style.display = 'none';
    });

    // Results
    document.getElementById('results-race-again')?.addEventListener('click', () => {
      audioManager.playUIClick();
      if (this.network.isInRoom()) { gameState.setState('LOBBY'); }
      else { gameState.setState('COUNTDOWN'); this.startCountdown(); }
    });
    document.getElementById('results-lobby-btn')?.addEventListener('click', () => { audioManager.playUIClick(); gameState.setState('LOBBY'); });
    document.getElementById('results-menu-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      if (this.network.isInRoom()) this.network.leaveRoom();
      gameState.setState('HOME');
    });

    // Disconnect / Error
    document.getElementById('disconnect-menu-btn')?.addEventListener('click', () => gameState.setState('HOME'));
    document.getElementById('error-retry-btn')?.addEventListener('click', () => gameState.setState('HOME'));
  }

  // =====================================================
  // GARAGE
  // =====================================================

  private setupGarage(): void {
    // Load persisted index
    const savedId = (settings as any).get('selectedCarId') ?? 'vortex_r';
    const idx = CAR_CATALOGUE.findIndex(c => c.id === savedId);
    this.garageIndex = idx >= 0 ? idx : 0;

    document.getElementById('garage-prev-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      this.garageIndex = (this.garageIndex - 1 + CAR_CATALOGUE.length) % CAR_CATALOGUE.length;
      this.renderGarageCard();
    });

    document.getElementById('garage-next-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      this.garageIndex = (this.garageIndex + 1) % CAR_CATALOGUE.length;
      this.renderGarageCard();
    });

    document.getElementById('garage-select-btn')?.addEventListener('click', () => {
      audioManager.playUIClick();
      const car = CAR_CATALOGUE[this.garageIndex];
      (settings as any).set('selectedCarId', car.id);
      this.renderGarageCard(); // update SELECT → SELECTED
      this.showNotification(`${car.name} selected!`);
    });

    // Color buttons still work
    document.querySelectorAll('.color__btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        audioManager.playUIClick();
        document.querySelectorAll('.color__btn').forEach(b => b.classList.remove('color__btn--active'));
        const target = e.target as HTMLElement;
        target.classList.add('color__btn--active');
        const color = target.getAttribute('data-color');
        if (color) settings.set('selectedColor', color);
      });
    });
  }

  private renderGarageCard(): void {
    const car = CAR_CATALOGUE[this.garageIndex];
    const selectedId = (settings as any).get('selectedCarId') ?? 'vortex_r';

    const setT = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const setW = (id: string, pct: number) => {
      const el = document.getElementById(id);
      if (el) el.style.width = `${pct}%`;
    };

    setT('garage-car-name', car.name);
    setT('garage-car-tagline', car.tagline);
    setT('garage-car-index', `${this.garageIndex + 1} / ${CAR_CATALOGUE.length}`);

    setW('perf-bar-speed', car.statSpeed);
    setW('perf-bar-accel', car.statAccel);
    setW('perf-bar-handling', car.statHandling);
    setW('perf-bar-braking', car.statBraking);
    setW('perf-bar-boost', car.statBoost);

    setT('perf-val-speed', car.statSpeed.toString());
    setT('perf-val-accel', car.statAccel.toString());
    setT('perf-val-handling', car.statHandling.toString());
    setT('perf-val-braking', car.statBraking.toString());
    setT('perf-val-boost', car.statBoost.toString());

    const selectBtn = document.getElementById('garage-select-btn');
    if (selectBtn) {
      if (car.id === selectedId) {
        selectBtn.textContent = '✓ SELECTED';
        selectBtn.classList.add('btn--selected');
      } else {
        selectBtn.textContent = 'SELECT';
        selectBtn.classList.remove('btn--selected');
      }
    }
  }

  // =====================================================
  // SETTINGS BINDINGS — every control wires to settings
  // =====================================================

  private setupSettingsBindings(): void {
    const bindToggle = (id: string, key: string, onChange?: (v: boolean) => void) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (!el) return;
      el.addEventListener('change', (e) => {
        const v = (e.target as HTMLInputElement).checked;
        (settings as any).set(key, v);
        onChange?.(v);
      });
    };

    const bindSelect = (id: string, key: string, onChange?: (v: string) => void) => {
      const el = document.getElementById(id) as HTMLSelectElement;
      if (!el) return;
      el.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        (settings as any).set(key, v);
        onChange?.(v);
      });
    };

    const bindSlider = (id: string, valId: string, key: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      const val = document.getElementById(valId);
      if (!el) return;
      el.addEventListener('input', (e) => {
        const v = (e.target as HTMLInputElement).value;
        if (val) val.textContent = v + '%';
      });
      el.addEventListener('change', (e) => {
        const v = parseInt((e.target as HTMLInputElement).value, 10);
        (settings as any).set(key, v);
      });
    };

    // Gameplay
    bindToggle('setting-camera-shake', 'cameraShake');
    bindToggle('setting-hud-visible', 'hudVisible', (v) => {
      const hud = document.getElementById('racing-hud');
      if (hud) hud.style.opacity = v ? '1' : '0';
    });
    bindToggle('setting-minimap', 'minimap');
    bindSelect('setting-speed-unit', 'speedUnit');

    // Controls
    bindSelect('setting-control-preset', 'controlPreset');

    // Graphics — these apply to the renderer in Game.ts via settings.onChange
    bindSelect('setting-quality', 'qualityPreset');
    bindToggle('setting-shadows', 'shadows');
    bindToggle('setting-reflections', 'reflections');
    bindToggle('setting-antialiasing', 'antiAliasing');

    // Audio — sliders update settings, Game.ts audio listens via settings.onChange
    bindSlider('setting-master-vol', 'master-vol-display', 'masterVolume');
    bindSlider('setting-music-vol', 'music-vol-display', 'musicVolume');
    bindSlider('setting-engine-vol', 'engine-vol-display', 'engineVolume');
    bindSlider('setting-effects-vol', 'effects-vol-display', 'effectsVolume');
    bindSlider('setting-ui-vol', 'ui-vol-display', 'uiVolume');
  }

  private applySettingsToUI(): void {
    const s = settings.getAll();
    const setToggle = (id: string, v: boolean) => { const el = document.getElementById(id) as HTMLInputElement; if (el) el.checked = v; };
    const setSelect = (id: string, v: string) => { const el = document.getElementById(id) as HTMLSelectElement; if (el) el.value = v; };
    const setSlider = (id: string, valId: string, v: number) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el) el.value = v.toString();
      const d = document.getElementById(valId);
      if (d) d.textContent = v + '%';
    };

    setToggle('setting-camera-shake', s.cameraShake);
    setToggle('setting-hud-visible', s.hudVisible);
    setToggle('setting-minimap', s.minimap);
    setToggle('setting-shadows', s.shadows);
    setToggle('setting-reflections', s.reflections);
    setToggle('setting-antialiasing', s.antiAliasing);
    setSelect('setting-speed-unit', s.speedUnit);
    setSelect('setting-control-preset', s.controlPreset);
    setSelect('setting-quality', s.qualityPreset);
    setSlider('setting-master-vol', 'master-vol-display', s.masterVolume);
    setSlider('setting-music-vol', 'music-vol-display', s.musicVolume);
    setSlider('setting-engine-vol', 'engine-vol-display', (s as any).engineVolume ?? 70);
    setSlider('setting-effects-vol', 'effects-vol-display', s.effectsVolume);
    setSlider('setting-ui-vol', 'ui-vol-display', (s as any).uiVolume ?? 50);

    const nameEl = document.getElementById('mp-player-name') as HTMLInputElement;
    if (nameEl) nameEl.value = s.playerName;

    document.querySelectorAll('.color__btn').forEach(btn => {
      btn.classList.toggle('color__btn--active', btn.getAttribute('data-color') === s.selectedColor);
    });

    const hud = document.getElementById('racing-hud');
    if (hud) hud.style.opacity = s.hudVisible ? '1' : '0';
  }

  private updateProfileUI(): void {
    const p = profile.getStats();
    const setT = (id: string, v: string) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setT('profile-races', p.racesPlayed.toString());
    setT('profile-wins', p.wins.toString());
    setT('profile-win-rate', profile.getWinRate() + '%');
    const unit = settings.get('speedUnit') === 'mph' ? 'MPH' : 'KM/H';
    const top = settings.get('speedUnit') === 'mph' ? Math.round(p.bestSpeed * 0.621371) : p.bestSpeed;
    setT('profile-best-speed', `${top} ${unit}`);
    setT('profile-best-distance', p.bestDistance.toLocaleString() + ' M');
    setT('profile-name', settings.get('playerName') || 'RACER_UNKNOWN');
  }

  // =====================================================
  // NETWORK BINDINGS
  // =====================================================

  private setupNetworkBindings(): void {
    this.network.onRoomJoined = (roomCode, players) => {
      const el = document.getElementById('lobby-room-code');
      if (el) el.textContent = roomCode;
      this.lobbyPlayers = players;
      this.renderLobbyPlayers();
      gameState.setState('LOBBY');
    };
    this.network.onPlayerJoined = (_, info) => {
      this.lobbyPlayers.push(info);
      this.renderLobbyPlayers();
      this.showNotification(`${info.name} joined`);
    };
    this.network.onPlayerLeft = (id) => {
      const p = this.lobbyPlayers.find(x => x.id === id);
      if (p) this.showNotification(`${p.name} left`);
      this.lobbyPlayers = this.lobbyPlayers.filter(x => x.id !== id);
      this.renderLobbyPlayers();
    };
    this.network.onPlayerReady = (id, isReady) => {
      const p = this.lobbyPlayers.find(x => x.id === id);
      if (p) { p.isReady = isReady; this.renderLobbyPlayers(); }
    };
    this.network.onCountdown = (time) => {
      if (!gameState.is('COUNTDOWN')) gameState.setState('COUNTDOWN');
      this.updateCountdown(time);
    };
    this.network.onRaceStart = () => {
      this.hideCountdown();
      gameState.setState('RACING');
    };
  }

  private renderLobbyPlayers(): void {
    const container = document.getElementById('lobby-player-list');
    if (!container) return;
    container.innerHTML = '';
    this.lobbyPlayers.forEach(p => {
      const card = document.createElement('div');
      card.className = 'player-card';
      const isMe = p.id === this.network.getId();
      const hostBadge = p.id === this.lobbyPlayers[0]?.id ? '<span class="player-card__badge">HOST</span>' : '';
      const readyClass = p.isReady ? 'player-card__ready--yes' : 'player-card__ready--no';
      card.innerHTML = `
        <div class="player-card__color" style="background-color: var(--player-${p.color})"></div>
        <div class="player-card__info">
          <div class="player-card__name">${p.name} ${isMe ? '(YOU)' : ''} ${hostBadge}</div>
        </div>
        <div class="player-card__ready ${readyClass}">${p.isReady ? 'READY' : 'WAITING'}</div>
      `;
      container.appendChild(card);
    });
  }

  // =====================================================
  // HUD — updated signature with boostFactor
  // =====================================================

  public updateHUD(speed: number, gear: string, distance: number, rpmFactor: number, timeStr: string, boostFactor: number = 1, minimapData: {type: string, progress: number}[] = []): void {
    const elSpeed = document.getElementById('hud-speed');
    const elUnit = document.getElementById('hud-speed-unit');
    const elGear = document.getElementById('hud-gear');
    const elDist = document.getElementById('hud-distance');
    const elTimer = document.getElementById('hud-timer');
    const elBoostFill = document.getElementById('hud-boost-fill');

    if (elSpeed) elSpeed.textContent = speed.toString().padStart(3, '0');
    if (elGear) {
      elGear.textContent = gear;
      elGear.style.color = rpmFactor > 0.85 ? 'var(--red-primary, #D42020)' : '';
    }
    if (elDist) elDist.textContent = distance.toLocaleString() + ' M';
    if (elTimer) elTimer.textContent = timeStr;
    if (elUnit) elUnit.textContent = settings.get('speedUnit') === 'mph' ? 'MPH' : 'KM/H';
    if (elBoostFill) elBoostFill.style.width = `${Math.round(boostFactor * 100)}%`;

    // Minimap
    if (settings.get('minimap')) {
      const minimap = document.getElementById('hud-minimap');
      if (minimap) minimap.style.display = 'flex';
      for (const entity of minimapData) {
        const percent = Math.min(Math.max(entity.progress * 100, 0), 100);
        let dot: HTMLElement | null = null;
        if (entity.type === 'player') dot = document.getElementById('minimap-player');
        if (entity.type === 'bot1') dot = document.getElementById('minimap-bot1');
        if (entity.type === 'bot2') dot = document.getElementById('minimap-bot2');
        if (dot) dot.style.bottom = `${percent}%`;
      }
    } else {
      const minimap = document.getElementById('hud-minimap');
      if (minimap) minimap.style.display = 'none';
    }
  }

  public showCrash(): void {
    const el = document.getElementById('hud-crash');
    if (el) el.style.display = 'block';
  }

  public hideCrash(): void {
    const el = document.getElementById('hud-crash');
    if (el) el.style.display = 'none';
  }

  public showNearMiss(score: number): void {
    const hud = document.getElementById('racing-hud');
    if (!hud) return;
    const el = document.createElement('div');
    el.className = 'hud__near-miss-pop';
    el.innerHTML = `NEAR MISS <span>+${score}</span>`;
    hud.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  public showPauseMenu(show: boolean): void {
    const el = document.getElementById('pause-screen');
    if (el) el.classList.toggle('screen--active', show);
  }

  // =====================================================
  // COUNTDOWN & RESULTS
  // =====================================================

  public startCountdown(): void {
    let count = 3;
    this.updateCountdown(count);
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        this.updateCountdown(count);
        audioManager.playCountdown(false);
      } else if (count === 0) {
        this.updateCountdown('GO');
        audioManager.playCountdown(true);
      } else {
        clearInterval(interval);
        this.hideCountdown();
        gameState.setState('RACING');
      }
    }, 1000);
  }

  private updateCountdown(val: number | string): void {
    const overlay = document.getElementById('countdown-overlay');
    const num = document.getElementById('countdown-num');
    if (overlay && num) {
      overlay.style.display = 'flex';
      num.textContent = val.toString();
      num.classList.toggle('countdown__number--go', val === 'GO' || val === 0);
    }
  }

  private hideCountdown(): void {
    const el = document.getElementById('countdown-overlay');
    if (el) el.style.display = 'none';
  }

  public renderResults(rankings: any[]): void {
    const container = document.getElementById('results-list') || document.getElementById('results-rankings');
    if (!container) return;
    container.innerHTML = '';
    if (!rankings?.length) {
      rankings = [{ name: settings.get('playerName') || 'YOU', distance: document.getElementById('hud-distance')?.textContent }];
    }
    rankings.forEach((r, i) => {
      const pos = i + 1;
      const suffix = pos === 1 ? 'st' : pos === 2 ? 'nd' : pos === 3 ? 'rd' : 'th';
      const row = document.createElement('div');
      row.className = 'result__row';
      row.innerHTML = `<div class="result__position">${pos}<sup>${suffix}</sup></div><div class="result__name">${r.name}</div><div class="result__distance">${r.distance} M</div>`;
      container.appendChild(row);
    });
  }

  // =====================================================
  // UTILS
  // =====================================================

  private showNotification(msg: string): void {
    const el = document.createElement('div');
    el.className = 'notification';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
}
