import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { Input } from './Input';
import type { CarConfig } from './CarConfig';
import { WORLD_FORWARD } from './Constants';

/**
 * Race Wars — Car
 * Loads the GLB model with local DRACO decoder (no CDN dependency).
 *
 * COORDINATE CONVENTION:
 *   Game forward = +Z  (vehicle drives in +Z direction)
 *   The GLB model faces -Z by default after export, so the visual wrapper
 *   is rotated 180° on Y so the FRONT bumper visually points +Z.
 *   Physics always use +Z as forward — never compensate inside movement math.
 */

// Shared DRACO loader — created once for the whole session
const _dracoLoader = new DRACOLoader();
_dracoLoader.setDecoderPath('/draco/'); // served from /public/draco/

const _gltfLoader = new GLTFLoader();
_gltfLoader.setDRACOLoader(_dracoLoader);

export class Car {
  public mesh: THREE.Group;        // physics root — moves with position/heading
  private visualRoot: THREE.Group; // child — corrects model orientation once
  public boundingBox: THREE.Box3;

  // Physics
  public position = new THREE.Vector3();
  public heading = 0; // radians, Y axis
  public rotation = new THREE.Quaternion();

  public speed = 0;  // m/s, positive = forward (+Z)

  // Config-driven stats
  public maxSpeed: number;
  public acceleration: number;
  public brakeForce: number;
  public friction = 6;
  public handling: number;
  public boostPower: number;
  public gearThresholds: number[];

  // Boost
  public boostCapacity = 100;
  public boostCurrent = 100;
  private boostRegenRate = 8;    // per second
  private boostDrainRate = 35;   // per second

  // Gear
  public currentGear = 0;        // 0 = N, 1-6 = gears, -1 = R

  // State
  public isCrashed = false;
  public isBoosting = false;
  public topSpeedReached = 0;

  // Road boundaries
  private roadHalfWidth = 24;

  // Color
  private bodyColor: number;
  private bodyMaterial: THREE.MeshStandardMaterial | null = null;

  // Boost Exhaust
  private exhaustL: THREE.Mesh | null = null;
  private exhaustR: THREE.Mesh | null = null;


  // Events (optional callbacks for AudioManager)
  public onGearChange?: (gear: number) => void;
  public onBoostStart?: () => void;
  public onBoostEnd?: () => void;
  public onCrash?: () => void;
  public onBrake?: (intensity: number) => void;

  constructor(scene: THREE.Scene, config: CarConfig) {
    this.bodyColor = config.bodyColor;
    this.maxSpeed = config.topSpeed;
    this.acceleration = config.acceleration;
    this.brakeForce = config.brakeForce;
    this.handling = config.handling;
    this.boostPower = config.boostPower;
    this.gearThresholds = config.gearThresholds;

    // Physics root (no visual — just transforms)
    this.mesh = new THREE.Group();
    this.mesh.name = 'carRoot';

    // Visual child — corrects the GLB model orientation
    // GLB faces -Z. We rotate +180° on Y so front bumper → +Z (game forward).
    this.visualRoot = new THREE.Group();
    this.visualRoot.rotation.y = 0; // will be set once model loads if needed
    this.mesh.add(this.visualRoot);

    scene.add(this.mesh);
    this.boundingBox = new THREE.Box3();

    this._loadModel(config.modelPath);
    this.updateBoundingBox();

    // ArrowHelper for debugging forward direction
    const arrowHelper = new THREE.ArrowHelper(
      WORLD_FORWARD.clone(), // Forward is -Z
      new THREE.Vector3(0, 1, 0),
      6, // Length
      0x00ff00 // Bright green
    );
    this.mesh.add(arrowHelper);

    // Exhaust flames
    const exhaustGeom = new THREE.ConeGeometry(0.2, 0.8, 8);
    exhaustGeom.rotateX(Math.PI / 2);
    const exhaustMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
    
    this.exhaustL = new THREE.Mesh(exhaustGeom, exhaustMat);
    this.exhaustL.position.set(-0.6, 0.4, 2.5); // Back of the car (+Z)
    this.exhaustL.visible = false;
    this.mesh.add(this.exhaustL);

    this.exhaustR = new THREE.Mesh(exhaustGeom, exhaustMat);
    this.exhaustR.position.set(0.6, 0.4, 2.5); // Back of the car (+Z)
    this.exhaustR.visible = false;
    this.mesh.add(this.exhaustR);
  }

  private _loadModel(modelPath: string): void {
    _gltfLoader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;

        // Normalize size to ~4.5 m length
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        if (size.z < 0.001) {
          // Model has no depth — unusual, use max dimension
          const maxDim = Math.max(size.x, size.y, size.z);
          const s = 4.5 / maxDim;
          model.scale.setScalar(s);
        } else {
          const s = 4.5 / size.z;
          model.scale.setScalar(s);
        }

        // Re-center after scale
        const box2 = new THREE.Box3().setFromObject(model);
        const center = box2.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.position.y = -box2.min.y * model.scale.y; // sit on ground

        // Since game forward is -Z, and typical Blender models face -Z,
        // we set rotation to 0. If it faces backwards, we would use Math.PI.
        this.visualRoot.rotation.y = 0;

        // Apply shadows and body color
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            const mat = child.material;
            const matName = mat?.name?.toLowerCase() ?? '';
            if (
              matName.includes('body') ||
              matName.includes('paint') ||
              matName.includes('carrosserie') ||
              matName.includes('red') ||
              matName.includes('color')
            ) {
              if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
                this.bodyMaterial = mat;
                mat.color.setHex(this.bodyColor);
                if (mat instanceof THREE.MeshPhysicalMaterial) {
                  mat.clearcoat = 1.0;
                  mat.clearcoatRoughness = 0.1;
                  mat.metalness = 0.7;
                  mat.roughness = 0.2;
                }
              }
            }
          }
        });

        this.visualRoot.add(model);

        // Debug marker: red sphere above the FRONT of the visual model
        const markerGeom = new THREE.SphereGeometry(0.3, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const frontMarker = new THREE.Mesh(markerGeom, markerMat);
        // Position it at the visual front (-2.25 on Z if it naturally faces -Z)
        frontMarker.position.set(0, 2.5, -2.25);
        this.visualRoot.add(frontMarker);

        this.updateBoundingBox();
        console.log('[RaceWars] Car model loaded:', modelPath);
      },
      undefined,
      (err: any) => {
        console.error('[RaceWars] Car.glb load FAILED:', err.message ?? err);
        this._buildFallback();
      }
    );
  }

  /** Fallback if GLB fails — visible colored box so we know something is wrong */
  private _buildFallback(): void {
    console.warn('[RaceWars] Using fallback box car — real model failed to load!');
    const mat = new THREE.MeshPhysicalMaterial({
      color: this.bodyColor,
      metalness: 0.7,
      roughness: 0.2,
      clearcoat: 1.0,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 4.5), mat);
    body.position.y = 0.5;
    body.castShadow = true;
    this.visualRoot.add(body);

    // Cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.6, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.3 })
    );
    cabin.position.set(0, 1.2, 0);
    this.visualRoot.add(cabin);

    this.bodyMaterial = mat;
    this.updateBoundingBox();
  }

  public setColor(color: number): void {
    this.bodyColor = color;
    if (this.bodyMaterial) this.bodyMaterial.color.setHex(color);
  }

  public getColor(): number {
    return this.bodyColor;
  }

  /** Main physics update. forward = +Z */
  public update(input: Input, delta: number): void {
    if (this.isCrashed) {
      this.speed *= 0.92;
      if (Math.abs(this.speed) < 0.5) this.speed = 0;
      this.updateMesh();
      return;
    }

    const prevGear = this.currentGear;

    // Boost input
    const wantBoost = (input as any).boost === true;
    if (wantBoost && this.boostCurrent > 0) {
      if (!this.isBoosting) {
        this.isBoosting = true;
        this.onBoostStart?.();
      }
      this.boostCurrent = Math.max(0, this.boostCurrent - this.boostDrainRate * delta);
    } else {
      if (this.isBoosting) {
        this.isBoosting = false;
        this.onBoostEnd?.();
      }
      // Regen
      if (!wantBoost) {
        this.boostCurrent = Math.min(this.boostCapacity, this.boostCurrent + this.boostRegenRate * delta);
      }
    }

    const effectiveMaxSpeed = this.isBoosting
      ? this.maxSpeed * 1.20
      : this.maxSpeed;

    const effectiveAccel = this.isBoosting
      ? this.acceleration + this.boostPower
      : this.acceleration;

    // Throttle / Brake
    if (input.forward) {
      this.speed += effectiveAccel * delta;
    } else if (input.backward) {
      if (this.speed > 1) {
        // Braking while moving forward
        const brakeAmt = this.brakeForce * delta;
        this.onBrake?.(Math.min(1, brakeAmt / this.brakeForce));
        this.speed -= brakeAmt;
      } else {
        // Reverse
        this.speed -= (this.acceleration * 0.5) * delta;
      }
    } else {
      // Friction coast
      if (this.speed > 0) {
        this.speed -= this.friction * delta;
        if (this.speed < 0) this.speed = 0;
      } else if (this.speed < 0) {
        this.speed += this.friction * delta;
        if (this.speed > 0) this.speed = 0;
      }
    }

    this.speed = Math.max(-this.maxSpeed / 3, Math.min(effectiveMaxSpeed, this.speed));

    const absSpeed = Math.abs(this.speed);
    if (absSpeed > this.topSpeedReached) this.topSpeedReached = absSpeed;

    // Steering — less responsive at high speed
    if (absSpeed > 0.5) {
      const speedRatio = Math.min(1, absSpeed / this.maxSpeed);
      const steer = this.handling * delta * THREE.MathUtils.lerp(1.0, 0.45, speedRatio);
      if (input.left) this.heading += steer * (this.speed < 0 ? -1 : 1);
      if (input.right) this.heading -= steer * (this.speed < 0 ? -1 : 1);
    }

    this.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);

    // Move in heading direction — game forward = -Z
    const forward = WORLD_FORWARD.clone();
    forward.applyQuaternion(this.rotation);
    this.position.addScaledVector(forward, this.speed * delta);

    // Clamp to road
    this.position.x = Math.max(-this.roadHalfWidth, Math.min(this.roadHalfWidth, this.position.x));

    // Gear calculation
    this.currentGear = this._calcGear();
    if (this.currentGear !== prevGear) {
      this.onGearChange?.(this.currentGear);
    }

    this.updateMesh();
    this.updateBoundingBox();
    // Exhaust animation
    if (this.exhaustL && this.exhaustR) {
      this.exhaustL.visible = this.isBoosting;
      this.exhaustR.visible = this.isBoosting;
      if (this.isBoosting) {
        const scale = 0.8 + Math.random() * 0.4;
        this.exhaustL.scale.set(1, 1, scale);
        this.exhaustR.scale.set(1, 1, scale);
      }
    }
  }

  private _calcGear(): number {
    const kmh = this.getSpeedKmh();
    if (this.speed < 0) return -1; // R
    if (kmh < 2) return 0;         // N
    for (let g = 0; g < this.gearThresholds.length; g++) {
      if (kmh <= this.gearThresholds[g]) return g + 1;
    }
    return this.gearThresholds.length + 1; // top gear
  }

  public updateMesh(): void {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.rotation);
  }

  private updateBoundingBox(): void {
    this.boundingBox.setFromObject(this.mesh);
  }

  public getSpeedKmh(): number {
    return Math.abs(Math.round(this.speed * 3.6));
  }

  public getSpeedMph(): number {
    return Math.abs(Math.round(this.speed * 2.237));
  }

  public getGearLabel(): string {
    if (this.currentGear === -1) return 'R';
    if (this.currentGear === 0) return 'N';
    return this.currentGear.toString();
  }

  public getDistance(): number {
    return Math.max(0, Math.floor(-this.position.z));
  }

  /** RPM factor 0–1 for audio pitch */
  public getRpmFactor(): number {
    const gear = Math.max(1, this.currentGear);
    const topForGear = gear <= this.gearThresholds.length
      ? this.gearThresholds[gear - 1]
      : this.maxSpeed * 3.6 * 1.5;
    const bottomForGear = gear > 1 ? this.gearThresholds[gear - 2] : 0;
    const range = topForGear - bottomForGear;
    if (range < 1) return 0;
    return Math.min(1, (this.getSpeedKmh() - bottomForGear) / range);
  }

  public reset(): void {
    this.position.set(0, 0, 0);
    this.heading = 0;
    this.speed = 0;
    this.isCrashed = false;
    this.isBoosting = false;
    this.boostCurrent = this.boostCapacity;
    this.topSpeedReached = 0;
    this.currentGear = 0;
    this.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
    this.updateMesh();
    this.updateBoundingBox();
  }

  public respawn(safeZ: number): void {
    const lanes = [-6, -2, 2, 6];
    let best = 0, bestDist = Infinity;
    for (const lane of lanes) {
      const d = Math.abs(this.position.x - lane);
      if (d < bestDist) { bestDist = d; best = lane; }
    }
    this.position.set(best, 0, safeZ);
    this.heading = 0;
    this.speed = 0;
    this.isCrashed = false;
    this.isBoosting = false;
    this.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
    this.updateMesh();
    this.updateBoundingBox();
  }

  public crash(): void {
    if (!this.isCrashed) {
      this.isCrashed = true;
      this.onCrash?.();
    }
  }

  public removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
