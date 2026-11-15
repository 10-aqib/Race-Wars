import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import './style.css';
import { Game } from './game/Game';
import { NetworkManager } from './network/NetworkManager';
import { UIManager } from './ui/UIManager';
import { gameState } from './state/StateManager';
import { settings } from './state/SettingsManager';
import { audioManager } from './game/AudioManager';

/**
 * Race Wars — application entry point.
 */

const params = new URLSearchParams(location.search);
const QA = params.has('qa');

function setLoading(text: string, pct: number): void {
  const t = document.getElementById('loading-text');
  const f = document.getElementById('loading-bar-fill');
  if (t) t.textContent = text;
  if (f) f.style.width = `${pct}%`;
}

function fail(message: string, error?: unknown): void {
  console.error('[RaceWars] Startup failed', error);
  const text = document.getElementById('error-text');
  if (text) text.textContent = message;
  gameState.setState('ERROR');
}

function playIntro(): void {
  gameState.setState('INTRO');
  const logo = document.getElementById('intro-logo');
  const fade = document.getElementById('intro-fade');
  const timers: number[] = [];
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    window.removeEventListener('keydown', onKey);
    settings.set('introSeen', true);
    if (gameState.is('INTRO')) {
      gameState.resetHistory('HOME');
      gameState.setState('HOME');
    }
  };
  const onKey = (e: KeyboardEvent) => { if (['Escape', 'Enter', 'Space'].includes(e.code)) { e.preventDefault(); finish(); } };
  window.addEventListener('keydown', onKey);
  document.getElementById('intro-skip')?.addEventListener('click', finish, { once: true });
  document.getElementById('intro-screen')?.addEventListener('click', finish, { once: true });
  fade?.classList.add('is-on');
  timers.push(window.setTimeout(() => fade?.classList.remove('is-on'), 120));
  timers.push(window.setTimeout(() => logo?.classList.add('is-visible'), 4200));
  timers.push(window.setTimeout(finish, 6800));
}

document.addEventListener('DOMContentLoaded', async () => {
  const network = new NetworkManager();
  const ui = new UIManager(network);
  let game: Game;
  setLoading('STARTING RENDERER', 10);
  try {
    game = new Game(network);
  } catch (error) {
    fail('The 3D renderer could not start. Enable hardware acceleration (WebGL) in your browser and reload.', error);
    return;
  }
  ui.attachGame(game);
  setLoading('LOADING VEHICLES', 45);
  try {
    await game.init();
  } catch (error) {
    fail('Game assets failed to load. Check your connection and reload.', error);
    return;
  }
  setLoading(game.modelStatus === 'loaded' ? 'READY' : 'VEHICLE MODEL UNAVAILABLE · USING FALLBACK', 100);
  game.start();

  (window as unknown as { RaceWars: unknown }).RaceWars = {
    game, ui, network, state: gameState, settings, audio: audioManager,
    ...(QA ? { qa: game.qaApi() } : {}),
  };

  const skipIntro = QA || params.has('nointro') || !settings.get('introOnStartup');
  if (skipIntro) {
    gameState.setState('HOME');
    gameState.resetHistory('HOME');
  } else {
    playIntro();
  }
});
