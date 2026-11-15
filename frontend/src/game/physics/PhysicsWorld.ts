import { VehicleSim, type DriveInput, type SurfaceInfo, NEUTRAL_INPUT } from '../vehicle/VehicleSim';
import { Track, BARRIER_OFFSET, ROAD_HALF_WIDTH, type TrackPoint } from '../track/Track';

/**
 * Race Wars — Physics world.
 * Steps every vehicle with the same rules (player, AI, traffic), then resolves
 * barrier and vehicle-vehicle contacts with impulses and positional correction.
 */

export type BodyKind = 'player' | 'ai' | 'traffic' | 'remote';

export interface Body {
  id: string;
  kind: BodyKind;
  sim: VehicleSim;
  input: DriveInput;
  track: TrackPoint;
  kinematic: boolean;       // moved externally (network); infinite mass in contacts
  active: boolean;
  // Previous pose for render interpolation
  prevX: number; prevZ: number; prevHeading: number;
  onShoulder: boolean;
  lastImpact: number;       // seconds since last contact
}

export interface ContactEvent {
  a: Body;
  b: Body | null;           // null = barrier
  impulse: number;          // N·s
  x: number; z: number;
}

const OFFROAD: SurfaceInfo = { grip: 0.72, rolling: 0.05 };
const ROAD: SurfaceInfo = { grip: 1, rolling: 0 };
const BARRIER_RESTITUTION = 0.18;
const BARRIER_FRICTION = 0.3;
const CAR_RESTITUTION = 0.25;
const CAR_FRICTION = 0.2;

export class PhysicsWorld {
  readonly bodies: Body[] = [];
  readonly events: ContactEvent[] = [];
  private readonly cornersA: number[] = new Array(8);
  private readonly cornersB: number[] = new Array(8);

  readonly track: Track;
  constructor(track: Track) { this.track = track; }

  add(id: string, kind: BodyKind, sim: VehicleSim, kinematic = false): Body {
    const body: Body = {
      id, kind, sim, input: { ...NEUTRAL_INPUT }, kinematic, active: true,
      track: this.track.project(sim.x, sim.z, -1),
      prevX: sim.x, prevZ: sim.z, prevHeading: sim.heading, onShoulder: false, lastImpact: 99,
    };
    this.bodies.push(body);
    return body;
  }

  remove(body: Body): void {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  clear(): void { this.bodies.length = 0; this.events.length = 0; }

  /** Re-sync track coordinates after teleporting a body. */
  resync(body: Body): void {
    this.track.project(body.sim.x, body.sim.z, -1, body.track);
    body.prevX = body.sim.x; body.prevZ = body.sim.z; body.prevHeading = body.sim.heading;
  }

  step(dt: number): void {
    this.events.length = 0;
    for (const b of this.bodies) {
      b.prevX = b.sim.x; b.prevZ = b.sim.z; b.prevHeading = b.sim.heading;
      if (!b.active) continue;
      b.lastImpact += dt;
      if (!b.kinematic) {
        b.onShoulder = Math.abs(b.track.d) > ROAD_HALF_WIDTH + 0.3;
        b.sim.step(b.input, dt, b.onShoulder ? OFFROAD : ROAD);
      }
      this.track.project(b.sim.x, b.sim.z, b.track.index, b.track);
    }
    for (const b of this.bodies) if (b.active && !b.kinematic) this.resolveBarrier(b);
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const a = this.bodies[i];
      if (!a.active) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.bodies[j];
        if (!b.active || (a.kinematic && b.kinematic)) continue;
        const dx = a.sim.x - b.sim.x, dz = a.sim.z - b.sim.z;
        if (dx * dx + dz * dz > 36) continue;
        this.resolvePair(a, b);
      }
    }
  }

  private resolveBarrier(body: Body): void {
    const sim = body.sim;
    const t = this.track;
    const i = body.track.index;
    const rx = -t.tz[i], rz = t.tx[i]; // track right vector
    const c = sim.corners(this.cornersA);
    let worst = 0, wx = 0, wz = 0, side = 0;
    for (let k = 0; k < 4; k++) {
      const px = c[k * 2], pz = c[k * 2 + 1];
      const d = body.track.d + (px - sim.x) * rx + (pz - sim.z) * rz;
      const pen = Math.abs(d) - BARRIER_OFFSET;
      if (pen > worst) { worst = pen; wx = px; wz = pz; side = Math.sign(d); }
    }
    if (worst <= 0) return;
    const nx = -side * rx, nz = -side * rz; // points back onto the road
    sim.x += nx * worst; sim.z += nz * worst;
    body.track.d -= side * worst;
    const [vx, vz] = sim.pointVelocity(wx, wz);
    const vn = vx * nx + vz * nz;
    if (vn >= 0) return;
    const rax = wx - sim.x, raz = wz - sim.z;
    const rn = raz * nx - rax * nz;
    const j = -(1 + BARRIER_RESTITUTION) * vn / (1 / sim.mass + (rn * rn) / sim.inertia);
    sim.applyImpulse(nx * j, nz * j, wx, wz);
    // Coulomb friction along the barrier
    const tx = -nz, tz = nx;
    const [vx2, vz2] = sim.pointVelocity(wx, wz);
    const vt = vx2 * tx + vz2 * tz;
    const rt = raz * tx - rax * tz;
    const jt = clamp(-vt / (1 / sim.mass + (rt * rt) / sim.inertia), -BARRIER_FRICTION * j, BARRIER_FRICTION * j);
    sim.applyImpulse(tx * jt, tz * jt, wx, wz);
    sim.yawRate *= 0.85;
    if (j > sim.mass * 0.8) { this.events.push({ a: body, b: null, impulse: j, x: wx, z: wz }); body.lastImpact = 0; }
  }

  private resolvePair(a: Body, b: Body): void {
    const A = a.sim, B = b.sim;
    const ca = A.corners(this.cornersA), cb = B.corners(this.cornersB);
    const axes = [
      -Math.sin(A.heading), -Math.cos(A.heading), Math.cos(A.heading), -Math.sin(A.heading),
      -Math.sin(B.heading), -Math.cos(B.heading), Math.cos(B.heading), -Math.sin(B.heading),
    ];
    let minOverlap = Infinity, nx = 0, nz = 0, axisOwner = 0;
    for (let k = 0; k < 4; k++) {
      const ax = axes[k * 2], az = axes[k * 2 + 1];
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (let p = 0; p < 4; p++) {
        const pa = ca[p * 2] * ax + ca[p * 2 + 1] * az;
        const pb = cb[p * 2] * ax + cb[p * 2 + 1] * az;
        if (pa < aMin) aMin = pa; if (pa > aMax) aMax = pa;
        if (pb < bMin) bMin = pb; if (pb > bMax) bMax = pb;
      }
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap <= 0) return; // separating axis found
      if (overlap < minOverlap) {
        minOverlap = overlap; nx = ax; nz = az; axisOwner = k < 2 ? 0 : 1;
      }
    }
    // Orient normal from A to B
    if ((B.x - A.x) * nx + (B.z - A.z) * nz < 0) { nx = -nx; nz = -nz; }
    // Contact point: deepest corner of the body that does not own the axis
    let px = 0, pz = 0;
    if (axisOwner === 0) {
      let best = Infinity;
      for (let p = 0; p < 4; p++) { const v = cb[p * 2] * nx + cb[p * 2 + 1] * nz; if (v < best) { best = v; px = cb[p * 2]; pz = cb[p * 2 + 1]; } }
    } else {
      let best = -Infinity;
      for (let p = 0; p < 4; p++) { const v = ca[p * 2] * nx + ca[p * 2 + 1] * nz; if (v > best) { best = v; px = ca[p * 2]; pz = ca[p * 2 + 1]; } }
    }
    const invA = a.kinematic ? 0 : 1 / A.mass, invB = b.kinematic ? 0 : 1 / B.mass;
    const invIA = a.kinematic ? 0 : 1 / A.inertia, invIB = b.kinematic ? 0 : 1 / B.inertia;
    const invSum = invA + invB;
    if (invSum === 0) return;
    const corr = Math.max(0, minOverlap - 0.01);
    A.x -= nx * corr * invA / invSum; A.z -= nz * corr * invA / invSum;
    B.x += nx * corr * invB / invSum; B.z += nz * corr * invB / invSum;

    const [avx, avz] = A.pointVelocity(px, pz);
    const [bvx, bvz] = B.pointVelocity(px, pz);
    const rvx = bvx - avx, rvz = bvz - avz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return;
    const ran = (pz - A.z) * nx - (px - A.x) * nz;
    const rbn = (pz - B.z) * nx - (px - B.x) * nz;
    const j = -(1 + CAR_RESTITUTION) * vn / (invSum + ran * ran * invIA + rbn * rbn * invIB);
    if (!a.kinematic) A.applyImpulse(-nx * j, -nz * j, px, pz);
    if (!b.kinematic) B.applyImpulse(nx * j, nz * j, px, pz);
    const tx = -nz, tz = nx;
    const vt = rvx * tx + rvz * tz;
    const rat = (pz - A.z) * tx - (px - A.x) * tz;
    const rbt = (pz - B.z) * tx - (px - B.x) * tz;
    const jt = clamp(-vt / (invSum + rat * rat * invIA + rbt * rbt * invIB), -CAR_FRICTION * j, CAR_FRICTION * j);
    if (!a.kinematic) A.applyImpulse(-tx * jt, -tz * jt, px, pz);
    if (!b.kinematic) B.applyImpulse(tx * jt, tz * jt, px, pz);
    if (j > 600) { this.events.push({ a, b, impulse: j, x: px, z: pz }); a.lastImpact = 0; b.lastImpact = 0; }
  }
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
