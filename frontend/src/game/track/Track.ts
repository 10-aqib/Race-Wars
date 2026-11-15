import * as THREE from 'three';

/**
 * Race Wars — Circuit definition (pure data + geometry queries).
 *
 * A closed Catmull-Rom centreline resampled every SAMPLE_STEP metres. Every
 * system (physics surface, barriers, AI, race progress, minimap, rendering)
 * reads the same samples, so they always agree on where the road is.
 *
 * Track coordinates: s = distance along the centreline [0, length), d = lateral
 * offset, positive to the right of the driving direction.
 */

export interface TrackPoint { s: number; d: number; index: number; }

export const LANE_WIDTH = 4;
export const LANE_OFFSETS = [-6, -2, 2, 6];
export const ROAD_HALF_WIDTH = 8.4;     // painted edge line
export const BARRIER_OFFSET = 11;       // inner face of the concrete barrier
const SAMPLE_STEP = 2;

// Night-city circuit: long start straight, fast sweepers, one tighter hairpin complex.
const CONTROL_POINTS: [number, number][] = [
  [0, 120], [0, -200], [0, -520], [30, -760], [150, -900], [360, -950],
  [560, -880], [680, -720], [700, -520], [640, -330], [520, -230], [430, -110],
  [440, 60], [520, 220], [500, 400], [360, 500], [180, 480], [60, 380],
];

export class Track {
  readonly length: number;
  readonly count: number;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;   // unit tangent
  readonly tz: Float32Array;
  readonly curvature: Float32Array; // signed, 1/m, positive = left turn
  readonly racingLine: Float32Array; // preferred lateral offset
  readonly checkpointSpacing: number;
  readonly checkpointCount = 12;
  readonly startS = 0;

  constructor() {
    const curve = new THREE.CatmullRomCurve3(
      CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.5,
    );
    const approx = curve.getLength();
    const n = Math.round(approx / SAMPLE_STEP);
    const pts = curve.getSpacedPoints(n).slice(0, n);
    // Rotate the sample ring so s = 0 sits on the start straight at z = 0
    let startIdx = 0, best = Infinity;
    pts.forEach((p, i) => { const dd = Math.abs(p.z) + Math.abs(p.x) * 4; if (p.z <= 0 && dd < best) { best = dd; startIdx = i; } });
    const ordered = pts.slice(startIdx).concat(pts.slice(0, startIdx));

    this.count = n;
    this.px = new Float32Array(n); this.pz = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.racingLine = new Float32Array(n);
    let len = 0;
    for (let i = 0; i < n; i++) {
      this.px[i] = ordered[i].x; this.pz[i] = ordered[i].z;
      const j = (i + 1) % n;
      len += Math.hypot(ordered[j].x - ordered[i].x, ordered[j].z - ordered[i].z);
    }
    this.length = len;
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    // Curvature from heading change over ±8 m
    const w = 4;
    for (let i = 0; i < n; i++) {
      const a = (i - w + n) % n, b = (i + w) % n;
      const ha = Math.atan2(-this.tx[a], -this.tz[a]);
      const hb = Math.atan2(-this.tx[b], -this.tz[b]);
      this.curvature[i] = wrapAngle(hb - ha) / (2 * w * this.step);
    }
    // Racing line: drift toward the inside ahead of and through corners, smoothed
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let o = -10; o <= 25; o++) k += this.curvature[(i + o + n) % n];
      k /= 36;
      raw[i] = -Math.sign(k) * Math.min(5.5, Math.abs(k) * 1400);
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let o = -15; o <= 15; o++) sum += raw[(i + o + n) % n];
      this.racingLine[i] = sum / 31;
    }
    this.checkpointSpacing = this.length / this.checkpointCount;
  }

  get step(): number { return this.length / this.count; }

  /** Wrap any distance into [0, length). */
  wrapS(s: number): number { return ((s % this.length) + this.length) % this.length; }

  indexAt(s: number): number { return Math.floor(this.wrapS(s) / this.step) % this.count; }

  /** World position for track coordinates. */
  pointAt(s: number, d: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
    const ws = this.wrapS(s);
    const f = ws / this.step;
    const i = Math.floor(f) % this.count, j = (i + 1) % this.count, t = f - Math.floor(f);
    const cx = this.px[i] + (this.px[j] - this.px[i]) * t;
    const cz = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz) || 1;
    // right = (-tz, tx)
    out.x = cx + (-tz / l) * d;
    out.z = cz + (tx / l) * d;
    return out;
  }

  /** Heading (game convention) of the track direction at s. */
  headingAt(s: number): number {
    const i = this.indexAt(s);
    return Math.atan2(-this.tx[i], -this.tz[i]);
  }

  curvatureAt(s: number): number { return this.curvature[this.indexAt(s)]; }
  racingLineAt(s: number): number { return this.racingLine[this.indexAt(s)]; }

  /**
   * Project a world point to track coordinates. `hint` (previous index) keeps
   * the search local and O(1); pass -1 for a full search.
   */
  project(x: number, z: number, hint = -1, out: TrackPoint = { s: 0, d: 0, index: 0 }): TrackPoint {
    const n = this.count;
    let bestI = 0, bestD = Infinity;
    if (hint >= 0) {
      for (let o = -40; o <= 40; o++) {
        const i = (hint + o + n) % n;
        const dx = x - this.px[i], dz = z - this.pz[i];
        const dd = dx * dx + dz * dz;
        if (dd < bestD) { bestD = dd; bestI = i; }
      }
      if (bestD > 30 * 30) return this.project(x, z, -1, out);
    } else {
      for (let i = 0; i < n; i++) {
        const dx = x - this.px[i], dz = z - this.pz[i];
        const dd = dx * dx + dz * dz;
        if (dd < bestD) { bestD = dd; bestI = i; }
      }
    }
    const tx = this.tx[bestI], tz = this.tz[bestI];
    const dx = x - this.px[bestI], dz = z - this.pz[bestI];
    const along = dx * tx + dz * tz;
    out.index = bestI;
    out.s = this.wrapS(bestI * this.step + along);
    out.d = dx * -tz + dz * tx;
    return out;
  }

  /** Signed shortest difference b - a along the loop. */
  deltaS(a: number, b: number): number {
    let d = b - a;
    const L = this.length;
    if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
    return d;
  }

  /** Smallest radius on the circuit (used by tests / tuning). */
  minRadius(): number {
    let m = Infinity;
    for (let i = 0; i < this.count; i++) { const k = Math.abs(this.curvature[i]); if (k > 1e-6) m = Math.min(m, 1 / k); }
    return m;
  }
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

let shared: Track | null = null;
export function getTrack(): Track { return shared ??= new Track(); }
