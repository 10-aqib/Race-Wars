import * as THREE from 'three';
import { createCarParts, disposeCarParts, type CarParts } from './CarModel';
import { glowTexture } from './Textures';
import type { VehicleSim } from '../vehicle/VehicleSim';

/**
 * Race Wars — visual car. Purely presentational: every effect is driven by
 * VehicleSim state (wheel spin from distance, steering from wheel angle,
 * pitch/roll from accelerations, brake lights from brake input, flames from
 * nitro). Nothing animates on its own.
 */

export interface CarViewOptions {
  paint: number;
  trim?: 'dark' | 'chrome';
  wing?: boolean;
  headlightBeam?: boolean;  // real spotlight (player only)
  reflections?: boolean;    // wet-road light streaks
}

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class CarView {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  parts: CarParts | null = null;
  private pitch = 0; private roll = 0; private pitchVel = 0; private rollVel = 0;
  private flames: THREE.Mesh[] = [];
  private glows: THREE.Sprite[] = [];
  private headGlows: THREE.Sprite[] = [];
  private streaks: THREE.Mesh[] = [];
  private beam: THREE.SpotLight | null = null;
  private brakeLevel = 0;
  private flicker = 0;
  private disposed = false;
  private paint: number;
  private bodyBase = new THREE.Quaternion();
  /** Geometry/materials created by this view (the model's own geometry is shared via the cache). */
  private ownGeometry = new Set<THREE.BufferGeometry>();
  private ownMaterials = new Set<THREE.Material>();

  constructor(opts: CarViewOptions) {
    this.paint = opts.paint;
    this.group.name = 'car';
    this.ready = createCarParts('/car.glb', opts.paint, opts.trim ?? 'dark').then(parts => {
      if (this.disposed) { disposeCarParts(parts); return; }
      this.parts = parts;
      if (parts.body) this.bodyBase.copy(parts.body.quaternion);
      this.group.add(parts.root);
      if (opts.wing) this.addWing();
      this.addLights(opts);
    });
  }

  setPaint(hex: number): void {
    this.paint = hex;
    this.parts?.paint.forEach(m => m.color.setHex(hex));
  }

  getPaint(): number { return this.paint; }

  private addWing(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0d0e10, metalness: 0.4, roughness: 0.35 });
    const wing = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.38), mat);
    blade.position.set(0, 1.28, 1.95); blade.rotation.x = -0.12;
    const plateGeo = new THREE.BoxGeometry(0.03, 0.22, 0.45);
    for (const x of [-0.86, 0.86]) {
      const plate = new THREE.Mesh(plateGeo, mat); plate.position.set(x, 1.24, 1.95); wing.add(plate);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.1), mat); strut.position.set(x * 0.55, 1.07, 1.98); wing.add(strut);
    }
    wing.add(blade);
    wing.traverse(n => { if (n instanceof THREE.Mesh) { n.castShadow = true; this.ownGeometry.add(n.geometry); this.ownMaterials.add(n.material as THREE.Material); } });
    this.parts!.root.add(wing);
  }

  private addLights(opts: CarViewOptions): void {
    const parts = this.parts!;
    const tex = glowTexture();
    for (const p of parts.tailPoints) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xff2020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
      s.position.copy(p).add(new THREE.Vector3(0, 0, 0.08)); s.scale.setScalar(0.7);
      this.group.add(s); this.glows.push(s);
    }
    for (const p of parts.headPoints) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xdfe9ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.28 }));
      s.position.copy(p).add(new THREE.Vector3(0, 0, -0.1)); s.scale.setScalar(0.45);
      this.group.add(s); this.headGlows.push(s);
    }
    // Nitro flames from the exhaust
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x5fb6ff, map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffb066, map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const geo = new THREE.ConeGeometry(0.16, 1.1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.55);
    for (const x of [-0.16, 0.16]) {
      const outer = new THREE.Mesh(geo, flameMat); outer.position.set(x, 0.38, 2.22); outer.visible = false;
      const inner = new THREE.Mesh(geo, coreMat); inner.scale.set(0.55, 0.55, 0.7); outer.add(inner);
      this.group.add(outer); this.flames.push(outer);
    }
    if (opts.reflections !== false) {
      // Wet-road reflections of the lights: long additive streaks on the asphalt
      const streakGeo = new THREE.PlaneGeometry(0.55, 4.2).rotateX(-Math.PI / 2);
      for (const p of parts.tailPoints) {
        const m = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({ map: tex, color: 0xff1a1a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.35 }));
        m.position.set(p.x, 0.03, p.z + 2.1); m.renderOrder = 2;
        this.group.add(m); this.streaks.push(m);
      }
      for (const p of parts.headPoints) {
        const m = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({ map: tex, color: 0xcfdcff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.25 }));
        m.position.set(p.x, 0.03, p.z - 2.6); m.scale.set(1.3, 1, 1.4); m.renderOrder = 2;
        this.group.add(m); this.streaks.push(m);
      }
    }
    if (opts.headlightBeam) {
      const beam = new THREE.SpotLight(0xe6eeff, 140, 75, 0.42, 0.55, 1.6);
      beam.position.set(0, 0.8, -2.0);
      beam.target.position.set(0, 0, -22);
      this.group.add(beam, beam.target);
      this.beam = beam;
    }
  }

  /** Place the car (interpolated pose). */
  setPose(x: number, z: number, heading: number, y = 0): void {
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, heading, 0);
  }

  /** Drive every visual from simulation state. */
  update(sim: VehicleSim, dt: number, nitroVisible = sim.boosting): void {
    const parts = this.parts;
    if (!parts) return;
    // Wheels: spin from travelled distance, front wheels steer
    for (const w of parts.wheels) {
      _q1.setFromAxisAngle(w.steerAxis, w.front ? sim.steerAngle * 1.6 : 0);
      _q2.setFromAxisAngle(w.spinAxis, -sim.wheelRotation);
      w.node.quaternion.copy(_q1).multiply(_q2).multiply(w.base);
    }
    // Suspension approximation: damped springs driven by accelerations
    const targetPitch = THREE.MathUtils.clamp(sim.longAccel * 0.0035, -0.035, 0.035);
    const targetRoll = THREE.MathUtils.clamp(-sim.latAccel * 0.0028, -0.04, 0.04);
    const k = 70, c = 11, h = Math.min(dt, 1 / 30);
    this.pitchVel += ((targetPitch - this.pitch) * k - this.pitchVel * c) * h; this.pitch += this.pitchVel * h;
    this.rollVel += ((targetRoll - this.roll) * k - this.rollVel * c) * h; this.roll += this.rollVel * h;
    const idleShake = sim.forwardSpeed < 1 ? Math.sin(performance.now() * 0.09) * 0.0012 * (sim.rpm / sim.config.redlineRpm + 0.3) : 0;
    if (parts.body) {
      // Compose with the node's authored rotation (the GLB chassis node is not identity)
      _q1.setFromAxisAngle(parts.pitchAxis, this.pitch + idleShake);
      _q2.setFromAxisAngle(parts.rollAxis, this.roll);
      parts.body.quaternion.copy(_q1).multiply(_q2).multiply(this.bodyBase);
    }

    // Brake lights
    const braking = sim.braking ? 1 : 0;
    this.brakeLevel += (braking - this.brakeLevel) * Math.min(1, dt * 18);
    const tail = 0.8 + this.brakeLevel * 3.2;
    parts.tail.forEach(m => { m.emissiveIntensity = tail; });
    this.glows.forEach(g => { g.material.opacity = 0.25 + this.brakeLevel * 0.45; g.scale.setScalar(0.42 + this.brakeLevel * 0.3); });
    this.streaks.forEach((s, i) => {
      const mat = s.material as THREE.MeshBasicMaterial;
      if (i < parts.tailPoints.length) mat.opacity = 0.12 + this.brakeLevel * 0.25;
    });

    // Nitro flames with flicker
    this.flicker += dt * 40;
    this.flames.forEach((f, i) => {
      f.visible = nitroVisible;
      if (nitroVisible) {
        const len = 0.8 + 0.35 * Math.sin(this.flicker + i * 1.7) + 0.2 * Math.sin(this.flicker * 2.3);
        f.scale.set(1, 1, len);
      }
    });
  }

  private detailVisible = true;
  /** Level of detail: hide interior/mechanical detail when far from the camera. */
  setDetail(full: boolean): void {
    if (full === this.detailVisible || !this.parts) return;
    this.detailVisible = full;
    for (const d of this.parts.details) d.visible = full;
    this.streaks.forEach(s => { s.visible = full; });
  }

  setLights(on: boolean, intensity = 1.6): void {
    this.parts?.head.forEach(m => { m.emissiveIntensity = on ? intensity : 0.15; });
    this.headGlows.forEach(g => { g.visible = on; });
    if (this.beam) this.beam.visible = on;
  }

  /** Static pose for showroom scenes. */
  idle(dt: number): void {
    if (!this.parts) return;
    for (const w of this.parts.wheels) w.node.quaternion.copy(w.base);
    this.flicker += dt * 40;
    this.flames.forEach(f => { f.visible = false; });
  }

  /** Brief exhaust flame pop (intro / garage rev). */
  flamePop(on: boolean): void {
    this.flames.forEach((f, i) => { f.visible = on; if (on) f.scale.set(1.2, 1.2, 0.9 + 0.3 * Math.sin(this.flicker + i)); });
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    const modelMeshes = new Set<THREE.Object3D>();
    this.parts?.root.traverse(n => { if (!this.ownGeometry.has((n as THREE.Mesh).geometry)) modelMeshes.add(n); });
    this.group.traverse(n => {
      if ((n instanceof THREE.Mesh || n instanceof THREE.Sprite) && !modelMeshes.has(n)) {
        if (n instanceof THREE.Mesh) this.ownGeometry.add(n.geometry);
        this.ownMaterials.add(n.material as THREE.Material);
      }
    });
    if (this.parts) disposeCarParts(this.parts);
    this.ownGeometry.forEach(g => g.dispose());
    this.ownMaterials.forEach(m => m.dispose());
  }

}
