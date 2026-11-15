/**
 * Race Wars — Keyboard input.
 * WASD and arrow keys both work at all times. Held keys are tracked by code so
 * simultaneous presses and releases resolve correctly; everything resets on
 * focus loss. One-shot actions (pause, camera, reset, mute) are edge-triggered.
 */

export type InputAction = 'pause' | 'camera' | 'reset' | 'mute';

const HELD_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);
const ACTION_CODES: Record<string, InputAction> = { Escape: 'pause', KeyP: 'pause', KeyC: 'camera', KeyR: 'reset', KeyM: 'mute' };
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  private held = new Set<string>();
  private queued = new Set<InputAction>();
  /** When true, arrow/space default browser behaviour (scrolling) is suppressed. */
  public gameplayActive = false;

  private readonly onDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    if (this.gameplayActive && SCROLL_KEYS.has(e.code)) e.preventDefault();
    if (HELD_CODES.has(e.code)) this.held.add(e.code);
    const action = ACTION_CODES[e.code];
    if (action && !e.repeat) this.queued.add(action);
  };
  private readonly onUp = (e: KeyboardEvent) => { this.held.delete(e.code); };
  private readonly onBlur = () => this.clearAll();
  private readonly onVisibility = () => { if (document.hidden) this.clearAll(); };

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get forward(): boolean { return this.held.has('KeyW') || this.held.has('ArrowUp'); }
  get backward(): boolean { return this.held.has('KeyS') || this.held.has('ArrowDown'); }
  get left(): boolean { return this.held.has('KeyA') || this.held.has('ArrowLeft'); }
  get right(): boolean { return this.held.has('KeyD') || this.held.has('ArrowRight'); }
  get handbrake(): boolean { return this.held.has('Space'); }
  get nitro(): boolean { return this.held.has('ShiftLeft') || this.held.has('ShiftRight'); }
  get heldCount(): number { return this.held.size; }

  /** Returns true once per key press. */
  consume(action: InputAction): boolean {
    const had = this.queued.has(action);
    this.queued.delete(action);
    return had;
  }

  clearAll(): void {
    this.held.clear();
    this.queued.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
