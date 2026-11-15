import * as THREE from 'three';
import type { VehicleSim } from '../vehicle/VehicleSim';
import { Track, BARRIER_OFFSET, wrapAngle } from '../track/Track';

/**
 * Race Wars — race cameras: CHASE, CLOSE and HOOD (cycle with C).
 * Frame-rate independent smoothing; responds to speed, acceleration, nitro and
 * impacts; kept inside the barriers so it never clips into scenery.
 */

export type CameraMode = 'chase' | 'close' | 'hood';
export const CAMERA_MODES: CameraMode[] = ['chase', 'close', 'hood'];

const PRESETS: Record<CameraMode, { dist: number; height: number; look: number; lookH: number; fov: number; follow: number }> = {
  chase: { dist: 7.6, height: 2.55, look: 6, lookH: 1.0, fov: 60, follow: 7 },
  close: { dist: 5.4, height: 1.75, look: 7, lookH: 0.95, fov: 64, follow: 9 },
  hood: { dist: -1.25, height: 1.1, look: 20, lookH: 1.0, fov: 72, follow: 30 },
};

export class RaceCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  shakeEnabled = true;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private heading = 0;
  private accelOffset = 0;
  private shake = 0;
  private fov = 60;
  private snapNext = true;
  private time = 0;
  private readonly track: Track;
  private trackHint = -1;

  constructor(track: Track, aspect: number) {
    this.track = track;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 6000);
  }

  setMode(mode: CameraMode): void { this.mode = mode; this.snapNext = true; }

  cycle(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  snap(): void { this.snapNext = true; }

  impact(strength: number): void { if (this.shakeEnabled) this.shake = Math.min(1, this.shake + strength); }

  update(x: number, z: number, heading: number, sim: VehicleSim, dt: number): void {
    const p = PRESETS[this.mode];
    this.time += dt;
    const speed = Math.max(0, sim.forwardSpeed);
    const ratio = Math.min(1, speed / sim.config.topSpeed);

    // Heading lag gives the car room to rotate on screen during cornering
    if (this.snapNext) this.heading = heading;
    const lag = this.mode === 'hood' ? 40 : 6;
    this.heading += wrapAngle(heading - this.heading) * Math.min(1, dt * lag);
    this.accelOffset += (THREE.MathUtils.clamp(sim.longAccel, -14, 14) * 0.045 - this.accelOffset) * Math.min(1, dt * 3);

    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    const dist = p.dist + (this.mode === 'hood' ? 0 : ratio * 1.6 + this.accelOffset);
    const height = p.height + (this.mode === 'hood' ? 0 : ratio * 0.3);
    const desired = new THREE.Vector3(x - fx * dist, height, z - fz * dist);
    const cfx = -Math.sin(heading), cfz = -Math.cos(heading);
    const look = new THREE.Vector3(x + cfx * (p.look + ratio * 6), p.lookH, z + cfz * (p.look + ratio * 6));

    // Clipping mitigation: keep the camera between the barriers
    const tp = this.track.project(desired.x, desired.z, this.trackHint);
    this.trackHint = tp.index;
    const limit = BARRIER_OFFSET - 0.5;
    if (Math.abs(tp.d) > limit) {
      const fixed = this.track.pointAt(tp.s, Math.sign(tp.d) * limit);
      desired.x = fixed.x; desired.z = fixed.z;
    }

    if (this.snapNext) {
      this.pos.copy(desired); this.look.copy(look); this.snapNext = false;
    } else {
      const k = 1 - Math.exp(-dt * p.follow);
      this.pos.lerp(desired, k);
      this.look.lerp(look, 1 - Math.exp(-dt * (p.follow + 6)));
    }
    this.camera.position.copy(this.pos);

    // Shake: impacts plus fine high-speed vibration
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const vib = this.shakeEnabled ? ratio * ratio * 0.012 + (sim.boosting ? 0.018 : 0) : 0;
    const amp = this.shake * 0.35 + vib;
    if (amp > 0) {
      this.camera.position.x += Math.sin(this.time * 61) * amp;
      this.camera.position.y += Math.sin(this.time * 47 + 1) * amp * 0.6;
    }
    this.camera.position.y = Math.max(0.5, this.camera.position.y);
    this.camera.lookAt(this.look);

    const targetFov = p.fov + ratio * 12 + (sim.boosting ? 7 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 3);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }

  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
