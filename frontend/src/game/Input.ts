/**
 * Race Wars — Input Handler
 * Keyboard input with preset support and blur safety
 */

export type ControlPreset = 'WASD' | 'ARROWS';

export class Input {
  public forward = false;
  public backward = false;
  public left = false;
  public right = false;
  public boost = false;
  public reset = false;
  public pause = false;
  public enter = false;

  public currentPreset: ControlPreset = 'WASD';

  // Track pause/reset as single presses
  private resetPressed = false;
  private pausePressed = false;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));

    // Clear all inputs when window loses focus
    window.addEventListener('blur', () => this.clearAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearAll();
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Skip when typing in input/select
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;

    // Universal keys
    switch (event.code) {
      case 'KeyR':
        if (!this.resetPressed) {
          this.reset = true;
          this.resetPressed = true;
        }
        return;
      case 'Escape':
        if (!this.pausePressed) {
          this.pause = true;
          this.pausePressed = true;
        }
        return;
      case 'Enter':
        this.enter = true;
        return;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.boost = true;
        return;
    }

    // Preset-specific
    if (this.currentPreset === 'WASD') {
      switch (event.code) {
        case 'KeyW': this.forward = true; break;
        case 'KeyS': this.backward = true; break;
        case 'KeyA': this.left = true; break;
        case 'KeyD': this.right = true; break;
      }
    } else if (this.currentPreset === 'ARROWS') {
      switch (event.code) {
        case 'ArrowUp': this.forward = true; event.preventDefault(); break;
        case 'ArrowDown': this.backward = true; event.preventDefault(); break;
        case 'ArrowLeft': this.left = true; event.preventDefault(); break;
        case 'ArrowRight': this.right = true; event.preventDefault(); break;
      }
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;

    switch (event.code) {
      case 'KeyR': this.reset = false; this.resetPressed = false; return;
      case 'Escape': this.pause = false; this.pausePressed = false; return;
      case 'Enter': this.enter = false; return;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.boost = false;
        return;
    }

    if (this.currentPreset === 'WASD') {
      switch (event.code) {
        case 'KeyW': this.forward = false; break;
        case 'KeyS': this.backward = false; break;
        case 'KeyA': this.left = false; break;
        case 'KeyD': this.right = false; break;
      }
    } else if (this.currentPreset === 'ARROWS') {
      switch (event.code) {
        case 'ArrowUp': this.forward = false; break;
        case 'ArrowDown': this.backward = false; break;
        case 'ArrowLeft': this.left = false; break;
        case 'ArrowRight': this.right = false; break;
      }
    }
  }

  public clearAll(): void {
    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;
    this.boost = false;
    this.reset = false;
    this.pause = false;
    this.enter = false;
    this.resetPressed = false;
    this.pausePressed = false;
  }

  public consumeReset(): boolean {
    if (this.reset) {
      this.reset = false;
      return true;
    }
    return false;
  }

  public consumePause(): boolean {
    if (this.pause) {
      this.pause = false;
      return true;
    }
    return false;
  }

  public consumeEnter(): boolean {
    if (this.enter) {
      this.enter = false;
      return true;
    }
    return false;
  }
}
