/**
 * Race Wars — Game State Manager
 * Centralized state machine for all application states
 */

export type GameState =
  | 'LOADING'
  | 'INTRO'
  | 'HOME'
  | 'RACE_LOBBY'
  | 'GARAGE'
  | 'PROFILE'
  | 'SETTINGS'
  | 'MULTIPLAYER'
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'RACING'
  | 'PAUSED'
  | 'FINISHED'
  | 'RESULTS'
  | 'DISCONNECTED'
  | 'ERROR';

export type StateChangeCallback = (newState: GameState, oldState: GameState) => void;

export class StateManager {
  private currentState: GameState = 'LOADING';
  private previousState: GameState = 'LOADING';
  private listeners: StateChangeCallback[] = [];
  private stateHistory: GameState[] = ['LOADING'];

  public get state(): GameState {
    return this.currentState;
  }

  public get prevState(): GameState {
    return this.previousState;
  }

  public get history(): GameState[] {
    return [...this.stateHistory];
  }

  public setState(newState: GameState): void {
    if (newState === this.currentState) return;

    this.previousState = this.currentState;
    this.currentState = newState;
    this.stateHistory.push(newState);

    // Keep history reasonable
    if (this.stateHistory.length > 50) {
      this.stateHistory = this.stateHistory.slice(-30);
    }

    for (const listener of this.listeners) {
      listener(newState, this.previousState);
    }
  }

  public onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  public goBack(): void {
    // Never step back into transient gameplay screens
    while (this.stateHistory.length > 1 && ['COUNTDOWN', 'RACING', 'PAUSED', 'FINISHED', 'RESULTS', 'INTRO', 'LOADING'].includes(this.stateHistory[this.stateHistory.length - 2])) {
      this.stateHistory.splice(this.stateHistory.length - 2, 1);
    }
    if (this.stateHistory.length > 1) {
      this.stateHistory.pop(); 
      const prevState = this.stateHistory[this.stateHistory.length - 1];
      this.previousState = this.currentState;
      this.currentState = prevState;

      for (const listener of this.listeners) {
        listener(this.currentState, this.previousState);
      }
    }
  }

  public is(...states: GameState[]): boolean {
    return states.includes(this.currentState);
  }

  public isGameplay(): boolean {
    return this.is('COUNTDOWN', 'RACING', 'PAUSED', 'FINISHED');
  }

  /** Replace the current history entry (used for transient screens such as countdown → racing). */
  public resetHistory(base: GameState): void {
    this.stateHistory = [base];
  }
}

export const gameState = new StateManager();
