import type { Body } from '../physics/PhysicsWorld';
import { Track, LANE_OFFSETS, BARRIER_OFFSET, wrapAngle } from '../track/Track';
import type { DifficultyProfile, Personality } from './Difficulty';
import { trackSteer } from './Steering';

/**
 * Race Wars — Racing AI.
 * Produces the same throttle/brake/steer/nitro inputs a player would; the car
 * is driven by the shared VehicleSim, so the AI obeys the same physics,
 * collisions and race rules. No teleporting, no speed multipliers.
 *
 * Layers: perception (throttled by reaction time) → lane selection with
 * hysteresis → smooth lateral target → pure-pursuit steering → curve-aware
 * speed planning → throttle/brake/nitro, plus stuck/wrong-way recovery.
 */

export type AIMode = 'race' | 'follow' | 'overtake' | 'recover';

interface Seen { ds: number; d: number; vs: number; body: Body; }

const G = 9.81;
const CAR_CLEARANCE = 2.5;

export class AIController {
  mode: AIMode = 'race';
  laneTarget = 0;
  targetD = 0;
  desiredSpeed = 0;
  overtakes = 0;
  /** Set by the race manager when the AI cannot recover by driving. */
  wantsReset = false;

  private decisionTimer = 0;
  private commitTimer = 0;
  private stuckTimer = 0;
  private recoverTimer = 0;
  private recoverAttempts = 0;
  private recoverWindow = 0;
  private followSpeed = Infinity;
  private seen: Seen[] = [];
  private time = 0;
  private nitroLatch = false;
  private blockedBy: Body | null = null;
  private rng: () => number;
  private noisePhase: number;

  private readonly track: Track;
  difficulty: DifficultyProfile;
  personality: Personality;

  constructor(track: Track, difficulty: DifficultyProfile, personality: Personality, seed = 1) {
    this.track = track;
    this.difficulty = difficulty;
    this.personality = personality;
    this.rng = mulberry32(seed);
    this.noisePhase = this.rng() * 6.28;
    this.decisionTimer = this.rng() * difficulty.reactionTime;
  }

  reset(d: number): void {
    this.mode = 'race'; this.laneTarget = d; this.targetD = d;
    this.stuckTimer = this.recoverTimer = this.recoverAttempts = this.recoverWindow = 0;
    this.commitTimer = 0.8; this.followSpeed = Infinity; this.wantsReset = false; this.seen = [];
    this.blockedBy = null;
  }

  update(self: Body, others: readonly Body[], dt: number): void {
    const sim = self.sim;
    const t = this.track;
    const s = self.track.s, d = self.track.d;
    const u = sim.forwardSpeed;
    const inp = self.input;
    this.time += dt;
    this.recoverWindow = Math.max(0, this.recoverWindow - dt);
    if (this.recoverWindow === 0) this.recoverAttempts = 0;

    const headingErr = wrapAngle(sim.heading - t.headingAt(s));

    // ── Recovery: reverse out when stuck or facing the wrong way
    if (this.mode === 'recover') {
      this.recoverTimer -= dt;
      inp.throttle = 0; inp.brake = 1; inp.nitro = false; inp.handbrake = false;
      // Reversing: steer opposite to where the nose should go
      inp.steer = clamp(headingErr * 1.5 + (d / BARRIER_OFFSET) * 0.4, -1, 1);
      if (this.recoverTimer <= 0) { this.mode = 'race'; this.stuckTimer = 0; this.commitTimer = 0; }
      return;
    }
    const pushing = inp.throttle > 0.5 && Math.abs(u) < 1.5;
    const wrongWay = Math.abs(headingErr) > 1.9;
    this.stuckTimer = pushing || wrongWay ? this.stuckTimer + dt : Math.max(0, this.stuckTimer - dt * 2);
    if (this.stuckTimer > this.difficulty.recoveryDelay) {
      this.recoverAttempts++;
      this.recoverWindow = 12;
      if (this.recoverAttempts > 3) { this.wantsReset = true; this.recoverAttempts = 0; }
      this.mode = 'recover'; this.recoverTimer = 1.4; this.stuckTimer = 0;
      return;
    }

    // ── Perception + lane decision at reaction-time intervals
    this.decisionTimer -= dt;
    this.commitTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.difficulty.reactionTime;
      this.perceive(self, others);
      this.chooseLane(self);
    }

    // ── Smooth lateral target toward the chosen lane
    const rate = this.personality.laneChangeRate * dt;
    this.targetD += clamp(this.laneTarget - this.targetD, -rate, rate);

    // ── Path tracking toward the smoothed lateral target
    const noise = this.difficulty.steerNoise * Math.sin(this.time * 1.7 + this.noisePhase);
    inp.steer = trackSteer(t, self, this.targetD, 1.1, noise);
    inp.handbrake = false;

    // ── Speed planning: curvature ahead within braking distance, then traffic
    const grip = sim.config.grip * this.difficulty.cornerFactor;
    const decel = sim.config.brakeDecel * this.difficulty.brakeMargin;
    const horizon = Math.min(320, (u * u) / (2 * decel) + 50);
    let vPlan = sim.config.topSpeed * 1.02;
    for (let x = 0; x <= horizon; x += 6) {
      const k = Math.max(Math.abs(t.curvatureAt(s + x)), 1e-4);
      const vCorner = Math.sqrt((grip * G * 0.94) / k);
      const vNow = Math.sqrt(vCorner * vCorner + 2 * decel * x);
      if (vNow < vPlan) vPlan = vNow;
    }
    this.desiredSpeed = Math.min(vPlan, this.followSpeed);

    const err = this.desiredSpeed - u;
    if (err > 0.4) {
      inp.throttle = clamp(0.35 + err * 0.25, 0, 1);
      inp.brake = 0;
    } else if (err < -1.2) {
      inp.throttle = 0;
      inp.brake = clamp(-err * 0.18, 0.15, 1);
    } else {
      inp.throttle = 0.25; inp.brake = 0;
    }
    // Traction control: lift when sliding hard
    if (Math.abs(sim.lateralSpeed) > 3.5) inp.throttle *= 0.5;

    // ── Nitro on clear straights
    const straight = Math.abs(t.curvatureAt(s + 60)) < 0.0015 && Math.abs(t.curvatureAt(s + 140)) < 0.002;
    const clear = this.followSpeed === Infinity && Math.abs(headingErr) < 0.12;
    if (!straight || !clear || u < 18 || this.desiredSpeed < u) this.nitroLatch = false;
    inp.nitro = this.nitroLatch && inp.throttle > 0.5;
  }

  private perceive(self: Body, others: readonly Body[]): void {
    this.seen.length = 0;
    const t = this.track;
    const range = 30 + Math.max(0, self.sim.forwardSpeed) * 1.8;
    for (const o of others) {
      if (o === self || !o.active) continue;
      const ds = t.deltaS(self.track.s, o.track.s);
      if (ds < -14 || ds > range) continue;
      const i = o.track.index;
      const vs = o.sim.vx * t.tx[i] + o.sim.vz * t.tz[i];
      this.seen.push({ ds, d: o.track.d, vs, body: o });
    }
    // Decide whether to (re)latch nitro this decision tick
    if (!this.nitroLatch && this.rng() < this.difficulty.nitroUse * this.personality.nitroBias * 0.5) this.nitroLatch = true;
  }

  private chooseLane(self: Body): void {
    const t = this.track;
    const s = self.track.s, d = self.track.d;
    const u = Math.max(0, self.sim.forwardSpeed);
    const lookAhead = 30 + u * 1.8;
    const willing = this.difficulty.overtakeWillingness * this.personality.overtakeBias;
    const risk = clamp(this.difficulty.riskTolerance + this.personality.riskBias, 0, 1);
    const line = t.racingLineAt(s + 25);
    const candidates = [line, ...LANE_OFFSETS, this.laneTarget];

    let bestC = this.laneTarget, bestCost = Infinity, currentCost = Infinity;
    for (const c of candidates) {
      let free = lookAhead, blocker: Seen | null = null, unsafe = false;
      for (const o of this.seen) {
        const lateral = Math.abs(o.d - c);
        // Car alongside in or crossing the path to this lane
        const crossing = (o.d - d) * (o.d - c) < 0 || lateral < CAR_CLEARANCE + 0.4;
        if (o.ds > -9 && o.ds < 7 && crossing && Math.abs(c - d) > 1) unsafe = true;
        if (o.ds > 0 && lateral < CAR_CLEARANCE && o.ds < free) {
          const closing = u - o.vs;
          if (closing > -1 || o.ds < 15) { free = o.ds; blocker = o; }
        }
      }
      if (unsafe) continue;
      let cost = 0;
      if (blocker) {
        const closing = Math.max(0.5, u - blocker.vs);
        cost += ((lookAhead - free) / lookAhead) * 40 * Math.min(2, closing / 5 + 0.3);
      }
      cost += Math.abs(c - this.laneTarget) * (1.2 - willing) * 0.6;
      cost += Math.abs(c - line) * 1.1 * this.personality.lineAdherence;
      if (Math.abs(c) > 6.5) cost += 3 * (1 - risk);
      if (c === this.laneTarget) currentCost = cost;
      if (cost < bestCost) { bestCost = cost; bestC = c; }
    }
    const margin = 4 * (1.1 - willing);
    if (bestC !== this.laneTarget && (this.commitTimer <= 0 || bestCost + margin < currentCost)) {
      if (Math.abs(bestC - this.laneTarget) > 1.5) {
        this.commitTimer = 1.3;
        if (this.blockedBy) this.overtakes++;
      }
      this.laneTarget = bestC;
    }

    // Car-following speed in the corridor we are in or moving through
    this.followSpeed = Infinity;
    this.blockedBy = null;
    const gapWanted = 6 + this.difficulty.timeGap * (1 - risk * 0.4) * u;
    for (const o of this.seen) {
      if (o.ds <= 0) continue;
      const inPath = Math.abs(o.d - d) < CAR_CLEARANCE || Math.abs(o.d - this.targetD) < CAR_CLEARANCE;
      if (!inPath) continue;
      const v = o.vs + (o.ds - gapWanted) * 0.7;
      if (v < this.followSpeed) { this.followSpeed = Math.max(0, v); this.blockedBy = o.body; }
    }
    this.mode = this.blockedBy ? (Math.abs(this.laneTarget - d) > 1.5 ? 'overtake' : 'follow') : 'race';
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
