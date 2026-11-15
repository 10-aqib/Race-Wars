/**
 * Race Wars — Settings Manager
 * Persists all game settings to localStorage
 */

export interface GameSettings {
  // Gameplay
  cameraShake: boolean;
  hudVisible: boolean;
  speedUnit: 'kmh' | 'mph';
  minimap: boolean;

  // Camera
  cameraMode: 'chase' | 'close' | 'hood';

  // Graphics
  qualityPreset: 'low' | 'medium' | 'high';
  shadows: boolean;
  reflections: boolean;
  antiAliasing: boolean;

  // Audio
  masterVolume: number;
  musicVolume: number;
  engineVolume: number;
  effectsVolume: number;
  uiVolume: number;
  muted: boolean;

  // Race setup
  laps: number;
  difficulty: 'easy' | 'normal' | 'hard';
  traffic: 'off' | 'light' | 'normal';
  raceMode: 'race' | 'free';

  // Profile
  playerName: string;
  selectedColor: string;
  selectedCarId: string;

  // Misc
  introSeen: boolean;
  introOnStartup: boolean;
}

const DEFAULT_SETTINGS: GameSettings = {
  cameraShake: true,
  hudVisible: true,
  speedUnit: 'kmh',
  minimap: true,
  cameraMode: 'chase',
  qualityPreset: 'medium',
  shadows: true,
  reflections: true,
  antiAliasing: true,
  masterVolume: 80,
  musicVolume: 60,
  engineVolume: 70,
  effectsVolume: 75,
  uiVolume: 50,
  muted: false,
  laps: 2,
  difficulty: 'normal',
  traffic: 'light',
  raceMode: 'race',
  playerName: '',
  selectedColor: 'red',
  selectedCarId: 'vortex_r',
  introSeen: false,
  introOnStartup: true,
};

const STORAGE_KEY = 'raceWarsSettings';

export class SettingsManager {
  private settings: GameSettings;
  private changeListeners: Array<(settings: GameSettings) => void> = [];

  constructor() {
    this.settings = this.load();
  }

  private load(): GameSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new keys; drop values of the wrong type
        const merged = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed ?? {})) {
          if (k in DEFAULT_SETTINGS && typeof v === typeof (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k]) merged[k] = v;
        }
        return merged as unknown as GameSettings;
      }
    } catch {
      // Invalid stored data, use defaults
    }
    return { ...DEFAULT_SETTINGS };
  }

  public save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage full or unavailable
    }
  }

  public get<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return this.settings[key];
  }

  public set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    this.settings[key] = value;
    this.save();
    this.notifyListeners();
  }

  public getAll(): Readonly<GameSettings> {
    return { ...this.settings };
  }

  public onChange(callback: (settings: GameSettings) => void): () => void {
    this.changeListeners.push(callback);
    return () => {
      this.changeListeners = this.changeListeners.filter(l => l !== callback);
    };
  }

  private notifyListeners(): void {
    const snapshot = { ...this.settings };
    for (const listener of this.changeListeners) {
      listener(snapshot);
    }
  }

  public reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
    this.notifyListeners();
  }
}

export const settings = new SettingsManager();
