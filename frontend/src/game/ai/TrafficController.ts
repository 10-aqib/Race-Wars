import type { Body } from '../physics/PhysicsWorld';
import { Track, LANE_OFFSETS } from '../track/Track';
import { trackSteer } from './Steering';

/**
 * Race Wars — Civilian traffic driver.
 * Lane keeping with Intelligent-Driver-Model car following. Changes lane only
 * when stuck behind a stopped obstacle and the neighbouring lane is clear.
 */
export class TrafficController {
  lane = 0;
  cruise = 20;
  private stuck = 0;
  private laneD = 0;
  private readonly track: Track;

  constructor(track: Track) { this.track = track; }

  reset(lane: number, cruise: number): void {
    this.lane = lane; this.laneD = LANE_OFFSETS[lane]; this.cruise = cruise; this.stuck = 0;
  }

  update(self: Body, others: readonly Body[], dt: number): void {
    const t = this.track, sim = self.sim, inp = self.input;
    const s = self.track.s;
    const v = Math.max(0, sim.forwardSpeed);
    const target = LANE_OFFSETS[this.lane];
    this.laneD += Math.max(-2 * dt, Math.min(2 * dt, target - this.laneD));

    // Nearest obstacle ahead in this lane
    let gap = Infinity, leadV = 0;
    for (const o of others) {
      if (o === self || !o.active) continue;
      const ds = t.deltaS(s, o.track.s);
      if (ds <= 0 || ds > 90 || Math.abs(o.track.d - this.laneD) > 2.6) continue;
      const net = ds - 4.6;
      if (net < gap) { gap = net; const i = o.track.index; leadV = o.sim.vx * t.tx[i] + o.sim.vz * t.tz[i]; }
    }
    // IDM acceleration
    const aMax = 2.2, b = 3.5, s0 = 4, T = 1.4;
    const dv = v - leadV;
    const sStar = s0 + v * T + (v * dv) / (2 * Math.sqrt(aMax * b));
    let acc = aMax * (1 - (v / this.cruise) ** 4);
    if (gap < Infinity) acc -= aMax * (Math.max(0, sStar) / Math.max(0.5, gap)) ** 2;
    if (acc >= 0) { inp.throttle = Math.min(1, acc / aMax); inp.brake = 0; }
    else { inp.throttle = 0; inp.brake = Math.min(1, -acc / sim.config.brakeDecel); }

    // Blocked by a stopped car: try a neighbouring lane
    this.stuck = gap < 20 && leadV < 3 ? this.stuck + dt : 0;
    if (this.stuck > 2) {
      for (const cand of [this.lane - 1, this.lane + 1]) {
        if (cand < 0 || cand >= LANE_OFFSETS.length) continue;
        const clear = others.every(o => o === self || !o.active || Math.abs(o.track.d - LANE_OFFSETS[cand]) > 2.8 || Math.abs(t.deltaS(s, o.track.s)) > 18);
        if (clear) { this.lane = cand; this.stuck = 0; break; }
      }
    }

    inp.steer = trackSteer(t, self, this.laneD, 0.8);
    inp.handbrake = false; inp.nitro = false;
  }
}
