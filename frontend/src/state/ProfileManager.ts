/**
 * Race Wars — Profile Manager
 * Tracks player statistics locally
 */

export interface PlayerStats {
  racesPlayed: number;
  wins: number;
  bestDistance: number;
  bestSpeed: number;
}

const STATS_KEY = 'raceWarsStats';

const DEFAULT_STATS: PlayerStats = {
  racesPlayed: 0,
  wins: 0,
  bestDistance: 0,
  bestSpeed: 0,
};

export class ProfileManager {
  private stats: PlayerStats;

  constructor() {
    this.stats = this.load();
  }

  private load(): PlayerStats {
    try {
      const stored = localStorage.getItem(STATS_KEY);
      if (stored) {
        return { ...DEFAULT_STATS, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_STATS };
  }

  private save(): void {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(this.stats));
    } catch {
      // ignore
    }
  }

  public getStats(): Readonly<PlayerStats> {
    return { ...this.stats };
  }

  public recordRace(distance: number, topSpeed: number, isWin: boolean): void {
    this.stats.racesPlayed++;
    if (isWin) this.stats.wins++;
    if (distance > this.stats.bestDistance) this.stats.bestDistance = Math.round(distance);
    if (topSpeed > this.stats.bestSpeed) this.stats.bestSpeed = Math.round(topSpeed);
    this.save();
  }

  public getWinRate(): number {
    if (this.stats.racesPlayed === 0) return 0;
    return Math.round((this.stats.wins / this.stats.racesPlayed) * 100);
  }

  public reset(): void {
    this.stats = { ...DEFAULT_STATS };
    this.save();
  }
}

export const profile = new ProfileManager();
