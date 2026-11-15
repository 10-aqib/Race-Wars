import './style.css';
import { Game } from './game/Game';
import { NetworkManager } from './network/NetworkManager';
import { UIManager } from './ui/UIManager';
import { gameState } from './state/StateManager';
import { settings } from './state/SettingsManager';

/**
 * Race Wars — Application Entry Point
 */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🏁 Starting Race Wars Engine...');

  // Initialize Core Systems
  const network = new NetworkManager();
  const ui = new UIManager(network);
  let game: Game;
  try {
    game = new Game(network, ui);
    const text = document.getElementById('loading-text');
    if (text) text.textContent = 'LOADING VEHICLE';
    await game.getCar().ready;
    if (text) text.textContent = game.getCar().modelStatus === 'loaded' ? 'READY' : 'MODEL UNAVAILABLE: USING FALLBACK';
  } catch (error) {
    console.error('[RaceWars] Startup failed', error);
    gameState.setState('ERROR');
    const text = document.getElementById('error-text');
    if (text) text.textContent = 'The 3D renderer could not start. Enable browser hardware acceleration and reload.';
    document.getElementById('error-retry-btn')?.addEventListener('click', () => location.reload());
    return;
  }

  // Initial State Logic
  const hasSeenIntro = settings.get('introSeen');
  
  if (!hasSeenIntro) {
    gameState.setState('INTRO');
    
    // Play cinematic intro sequence
    setTimeout(() => {
      const logo = document.querySelector('.intro__logo');
      if (logo) {
        logo.classList.remove('intro__logo--hidden');
        logo.classList.add('intro__logo--visible');
      }
    }, 500);

    // Auto-advance after 5 seconds if not skipped
    setTimeout(() => {
      if (gameState.is('INTRO')) {
        settings.set('introSeen', true);
        gameState.setState('HOME');
      }
    }, 5000);
  } else {
    // Jump straight to home
    gameState.setState('HOME');
  }

  // Bind Game lifecycle to State
  gameState.onStateChange((newState) => {
    // Start game loop when leaving loading/intro screens
    if (newState === 'HOME' || newState === 'LOBBY' || newState === 'RACING') {
      game.start();
    }
  });

  // Start engine if we skipped intro
  if (hasSeenIntro) {
    game.start();
  }

  // Expose to window for debugging if needed
  (window as any).RaceWars = { game, network, ui, state: gameState, settings };
});
