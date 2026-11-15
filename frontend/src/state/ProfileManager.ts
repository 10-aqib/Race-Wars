/**
 * Race Wars — Profile Manager
 * Tracks player statistics locally
 */

export interface PlayerStats {
  racesPlayed: number;
  wins: number;
  podiums: number;
  bestDistance: number;   // metres in a single race (kept for older saves)
  bestSpeed: number;      // km/h
  bestLap: number;        // seconds, 0 = none
  totalDistance: number;  // metres
}

export interface RaceRecord {
  position: number;
  racers: number;
  distance: number;   // metres driven
  topSpeedKmh: number;
  bestLap: number;
  finished: boolean;
}

const STATS_KEY = 'raceWarsStats';

const DEFAULT_STATS: PlayerStats = {
  racesPlayed: 0,
  wins: 0,
  podiums: 0,
  bestDistance: 0,
  bestSpeed: 0,
  bestLap: 0,
  totalDistance: 0,
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

  public recordRace(r: RaceRecord): void {
    this.stats.racesPlayed++;
    if (r.finished && r.position === 1 && r.racers > 1) this.stats.wins++;
    if (r.finished && r.position <= 3 && r.racers > 1) this.stats.podiums++;
    if (r.distance > this.stats.bestDistance) this.stats.bestDistance = Math.round(r.distance);
    if (r.topSpeedKmh > this.stats.bestSpeed) this.stats.bestSpeed = Math.round(r.topSpeedKmh);
    if (r.bestLap > 0 && (!this.stats.bestLap || r.bestLap < this.stats.bestLap)) this.stats.bestLap = r.bestLap;
    this.stats.totalDistance += Math.round(r.distance);
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
