import { VehicleSim, NEUTRAL_INPUT } from '../vehicle/VehicleSim';
import { PhysicsWorld, type Body, type BodyKind, type ContactEvent } from '../physics/PhysicsWorld';
import { Track, LANE_OFFSETS, wrapAngle } from '../track/Track';
import { AIController, mulberry32 } from '../ai/AIController';
import { TrafficController } from '../ai/TrafficController';
import { DIFFICULTY, PERSONALITIES, type DifficultyLevel } from '../ai/Difficulty';
import { TRAFFIC_CONFIG, type CarConfig } from '../CarConfig';

/**
 * Race Wars — Race manager (simulation side, no rendering).
 * Owns the physics world, racers, AI and traffic. Progress is measured along
 * the track centreline and only advances through ordered checkpoints, so
 * reversing, resets and contact cannot gain positions.
 */

export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finishing' | 'complete';
export type TrafficDensity = 'off' | 'light' | 'normal';
export type RaceMode = 'race' | 'free';

export interface RaceOptions {
  mode: RaceMode;
  laps: number;
  difficulty: DifficultyLevel;
  traffic: TrafficDensity;
  seed: number;
}

export interface RacerSpec {
  id: string;
  name: string;
  config: CarConfig;
  kind: Exclude<BodyKind, 'traffic'>;
  personality?: keyof typeof PERSONALITIES;
  grid: number; // grid slot index
}

export interface Racer {
  spec: RacerSpec;
  body: Body;
  ai: AIController | null;
  progress: number;      // metres along the race distance (negative on the grid)
  lastS: number;
  checkpoint: number;    // highest ordered checkpoint reached (global index)
  lapsDone: number;
  lapStart: number;
  bestLap: number;
  lastLap: number;
  finished: boolean;
  finishTime: number;
  position: number;
  topSpeed: number;
  collisions: number;
  resets: number;
  resetCooldown: number;
  wrongWay: number;      // seconds driving the wrong way
  impactLatch: number;   // debounces collision counting
}

export interface Standing {
  id: string; name: string; carName: string; position: number; finished: boolean;
  time: number; gap: number; bestLap: number; topSpeedKmh: number; progress: number; isPlayer: boolean;
}

const COUNTDOWN = 3;
const FINISH_GRACE = 30; // s that rivals get to finish after the player
const GRID_SLOTS: [number, number][] = [[-12, 0], [-8, -5], [-8, 5], [-20, -5], [-20, 5], [-24, 0]];
const TRAFFIC_COUNT: Record<TrafficDensity, number> = { off: 0, light: 6, normal: 10 };

export class RaceManager {
  readonly track: Track;
  readonly world: PhysicsWorld;
  racers: Racer[] = [];
  traffic: { body: Body; ctl: TrafficController }[] = [];
  phase: RacePhase = 'idle';
  options: RaceOptions = { mode: 'race', laps: 2, difficulty: 'normal', traffic: 'light', seed: 1 };
  raceTime = 0;           // s since GO
  countdownTime = 0;      // s remaining before GO
  finishTimer = 0;
  player: Racer | null = null;
  /** When true the player's car is driven by an AI controller (post-finish cool-down and automated tests). */
  playerAutopilot = false;
  private playerPilot: AIController | null = null;
  private rng = mulberry32(1);
  private anchorIndex = 0;
  /** Contact events since the presentation layer last drained them. */
  readonly pendingEvents: ContactEvent[] = [];
  onFinish?: (racer: Racer) => void;
  onLap?: (racer: Racer, lapTime: number) => void;
  onComplete?: () => void;

  constructor(track: Track) {
    this.track = track;
    this.world = new PhysicsWorld(track);
  }

  get raceDistance(): number { return this.options.mode === 'free' ? Infinity : this.options.laps * this.track.length; }

  setup(options: RaceOptions, specs: RacerSpec[]): void {
    this.options = { ...options };
    this.world.clear();
    this.racers = [];
    this.traffic = [];
    this.rng = mulberry32(options.seed);
    this.raceTime = 0; this.finishTimer = 0;
    this.playerAutopilot = false;
    for (const spec of specs) {
      const sim = new VehicleSim(spec.config);
      const [gs, gd] = GRID_SLOTS[spec.grid % GRID_SLOTS.length];
      const p = this.track.pointAt(gs, gd);
      sim.place(p.x, p.z, this.track.headingAt(gs));
      const body = this.world.add(spec.id, spec.kind, sim, spec.kind === 'remote');
      const ai = spec.kind === 'ai'
        ? new AIController(this.track, DIFFICULTY[options.difficulty], PERSONALITIES[spec.personality ?? 'balanced'], options.seed * 31 + spec.grid)
        : null;
      ai?.reset(gd);
      const racer: Racer = {
        spec, body, ai, progress: gs, lastS: this.track.wrapS(gs), checkpoint: 0, lapsDone: 0, lapStart: 0,
        bestLap: 0, lastLap: 0, finished: false, finishTime: 0, position: 0, topSpeed: 0, collisions: 0,
        resets: 0, resetCooldown: 0, wrongWay: 0, impactLatch: 0,
      };
      this.racers.push(racer);
      if (spec.kind === 'player') this.player = racer;
    }
    this.playerPilot = this.player ? new AIController(this.track, { ...DIFFICULTY.normal, cornerFactor: 0.86, nitroUse: 0.4 }, PERSONALITIES.balanced, options.seed + 99) : null;
    this.playerPilot?.reset(this.player!.body.track.d);
    const count = TRAFFIC_COUNT[options.traffic];
    for (let i = 0; i < count; i++) {
      const sim = new VehicleSim(TRAFFIC_CONFIG);
      const body = this.world.add(`traffic-${i}`, 'traffic', sim);
      body.active = false;
      this.traffic.push({ body, ctl: new TrafficController(this.track) });
    }
    this.seedTraffic(true);
    this.updatePositions();
    this.phase = 'idle';
  }

  startCountdown(): void {
    this.phase = 'countdown';
    this.countdownTime = COUNTDOWN;
  }

  /** 3, 2, 1, then 0 for "GO" (shown briefly after start), or null. */
  get countdownValue(): number | null {
    if (this.phase === 'countdown') return Math.ceil(this.countdownTime - 1e-6);
    if (this.phase === 'racing' && this.raceTime < 0.8) return 0;
    return null;
  }

  setPlayerAutopilot(on: boolean): void {
    this.playerAutopilot = on;
    if (on && this.player && this.playerPilot) this.playerPilot.reset(this.player.body.track.d);
  }

  /** Advance the race by one fixed timestep. */
  step(dt: number): void {
    if (this.phase === 'idle' || this.phase === 'complete') return;
    if (this.phase === 'countdown') {
      this.countdownTime -= dt;
      for (const r of this.racers) Object.assign(r.body.input, NEUTRAL_INPUT);
      if (this.countdownTime <= 0) { this.phase = 'racing'; this.raceTime = 0; this.countdownTime = 0; }
      return;
    }
    this.raceTime += dt;
    const bodies = this.world.bodies;

    for (const r of this.racers) {
      r.resetCooldown = Math.max(0, r.resetCooldown - dt);
      r.impactLatch -= dt;
      if (r.ai) {
        r.ai.update(r.body, bodies, dt);
        if (r.ai.wantsReset) { r.ai.wantsReset = false; this.resetRacer(r); }
      } else if (r === this.player && (this.playerAutopilot || r.finished) && this.playerPilot) {
        this.playerPilot.update(r.body, bodies, dt);
        if (r.finished) { r.body.input.throttle = Math.min(r.body.input.throttle, 0.5); r.body.input.nitro = false; }
        if (this.playerPilot.wantsReset) { this.playerPilot.wantsReset = false; this.resetRacer(r); }
      }
    }
    for (const t of this.traffic) if (t.body.active) t.ctl.update(t.body, bodies, dt);

    this.world.step(dt);
    for (const e of this.world.events) {
      if (this.pendingEvents.length < 64) this.pendingEvents.push(e);
      for (const b of [e.a, e.b]) {
        const r = b && this.racers.find(x => x.body === b);
        if (r && e.impulse > 1500 && b!.lastImpact === 0 && r.impactLatch <= 0) { r.collisions++; r.impactLatch = 0.5; }
      }
    }

    for (const r of this.racers) this.updateProgress(r, dt);
    this.updatePositions();
    this.manageTraffic();

    if (this.phase === 'finishing') {
      this.finishTimer += dt;
      const online = this.racers.some(r => r.spec.kind === 'remote');
      // Online races are closed by the server's race_finished message instead
      if (!online && (this.finishTimer > FINISH_GRACE || this.racers.every(r => r.finished))) {
        this.phase = 'complete';
        this.onComplete?.();
      }
    }
  }

  private updateProgress(r: Racer, dt: number): void {
    const t = this.track;
    const s = r.body.track.s;
    const ds = t.deltaS(r.lastS, s);
    r.lastS = s;
    // Larger jumps are teleports (resets keep progress); progress is frozen once finished
    if (Math.abs(ds) < 40 && !r.finished) r.progress += ds;
    const sim = r.body.sim;
    r.topSpeed = Math.max(r.topSpeed, sim.forwardSpeed);
    const err = Math.abs(wrapAngle(sim.heading - t.headingAt(s)));
    r.wrongWay = err > 1.75 && sim.forwardSpeed > 3 ? r.wrongWay + dt : 0;
    if (r.finished || this.options.mode === 'free') return;

    // Ordered checkpoints: each must be reached in sequence along the race distance
    const cp = t.checkpointSpacing;
    while (r.progress >= (r.checkpoint + 1) * cp) {
      r.checkpoint++;
      if (r.checkpoint % t.checkpointCount === 0) {
        const crossing = this.raceTime - (ds > 0 ? dt * (r.progress - r.checkpoint * cp) / ds : 0);
        const lap = crossing - r.lapStart;
        r.lapStart = crossing; r.lastLap = lap; r.lapsDone++;
        if (!r.bestLap || lap < r.bestLap) r.bestLap = lap;
        this.onLap?.(r, lap);
        if (r.lapsDone >= this.options.laps) {
          r.finished = true;
          r.finishTime = crossing;
          this.onFinish?.(r);
          if (r === this.player && this.phase === 'racing') { this.phase = 'finishing'; this.finishTimer = 0; }
        }
      }
    }
  }

  private updatePositions(): void {
    const sorted = [...this.racers].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime || a.spec.grid - b.spec.grid;
      return b.progress - a.progress || a.spec.grid - b.spec.grid;
    });
    sorted.forEach((r, i) => { r.position = i + 1; });
  }

  /** Put a racer back on the road at its current track position, facing the right way. */
  resetRacer(r: Racer): boolean {
    if (r.resetCooldown > 0 || this.phase === 'countdown') return false;
    const s = r.body.track.s;
    const lane = LANE_OFFSETS.reduce((best, l) => {
      const occupied = this.world.bodies.some(o => o !== r.body && o.active && Math.abs(this.track.deltaS(s, o.track.s)) < 12 && Math.abs(o.track.d - l) < 2.5);
      if (occupied) return best;
      return best === null || Math.abs(l - r.body.track.d) < Math.abs(best - r.body.track.d) ? l : best;
    }, null as number | null) ?? LANE_OFFSETS[0];
    const p = this.track.pointAt(s, lane);
    r.body.sim.place(p.x, p.z, this.track.headingAt(s));
    this.world.resync(r.body);
    r.lastS = r.body.track.s;
    r.ai?.reset(lane);
    r.resets++;
    r.resetCooldown = 2.5;
    return true;
  }

  // ── Traffic pool ────────────────────────────────────────────────────────────

  /** Traffic is shared fairly: each spawn is placed ahead of the next racer in turn. */
  private anchorS(): number {
    const racers = this.racers.filter(r => !r.finished || r === this.player);
    if (!racers.length) return 0;
    this.anchorIndex = (this.anchorIndex + 1) % racers.length;
    return racers[this.anchorIndex].body.track.s;
  }

  private seedTraffic(initial: boolean): void {
    let k = 0;
    for (const t of this.traffic) {
      if (t.body.active) continue;
      const base = this.anchorS();
      const s = base + (initial ? 110 + Math.floor(k / Math.max(1, this.racers.length)) * 120 + this.rng() * 40 : 330 + this.rng() * 220);
      k++;
      this.spawnTraffic(t, s);
    }
  }

  private spawnTraffic(t: { body: Body; ctl: TrafficController }, s: number): void {
    for (let attempt = 0; attempt < 4; attempt++) {
      const lane = Math.floor(this.rng() * LANE_OFFSETS.length);
      const d = LANE_OFFSETS[lane];
      const ss = s + attempt * 25;
      const blocked = this.world.bodies.some(o => o !== t.body && o.active &&
        Math.abs(this.track.deltaS(ss, o.track.s)) < (o.kind === 'traffic' ? 28 : 60) && (o.kind !== 'traffic' || Math.abs(o.track.d - d) < 3));
      if (blocked) continue;
      const cruise = 16 + this.rng() * 9;
      const p = this.track.pointAt(ss, d);
      const sim = t.body.sim;
      sim.place(p.x, p.z, this.track.headingAt(ss));
      const h = sim.heading;
      sim.vx = -Math.sin(h) * cruise; sim.vz = -Math.cos(h) * cruise;
      t.body.active = true;
      this.world.resync(t.body);
      t.ctl.reset(lane, cruise);
      return;
    }
  }

  private manageTraffic(): void {
    for (const t of this.traffic) {
      if (!t.body.active) continue;
      let behindAll = true, aheadAll = true;
      for (const r of this.racers) {
        const ds = this.track.deltaS(r.body.track.s, t.body.track.s);
        if (ds > -150) behindAll = false;
        if (ds < 700) aheadAll = false;
      }
      if (behindAll || aheadAll) t.body.active = false;
    }
    for (const t of this.traffic) if (!t.body.active) this.spawnTraffic(t, this.anchorS() + 340 + this.rng() * 220);
  }

  // ── Reporting ──────────────────────────────────────────────────────────────

  standings(): Standing[] {
    const leader = [...this.racers].sort((a, b) => a.position - b.position)[0];
    return [...this.racers].sort((a, b) => a.position - b.position).map(r => ({
      id: r.spec.id,
      name: r.spec.name,
      carName: r.spec.config.name,
      position: r.position,
      finished: r.finished,
      time: r.finished ? r.finishTime : this.raceTime,
      gap: r.finished && leader.finished ? r.finishTime - leader.finishTime : Math.max(0, leader.progress - r.progress),
      bestLap: r.bestLap,
      topSpeedKmh: Math.round(r.topSpeed * 3.6),
      progress: Math.max(0, Math.min(r.progress, this.raceDistance)),
      isPlayer: r.spec.kind === 'player',
    }));
  }

  currentLap(r: Racer): number {
    return Math.min(this.options.laps, r.lapsDone + 1);
  }

  dispose(): void {
    this.world.clear();
    this.racers = [];
    this.traffic = [];
    this.phase = 'idle';
    this.player = null;
  }
}
