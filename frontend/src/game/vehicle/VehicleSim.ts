import type { CarConfig } from '../CarConfig';

/**
 * Race Wars — Vehicle simulation (pure, render-independent).
 *
 * Dynamic bicycle model integrated in world space at a fixed timestep:
 *  - power-limited drive force with traction cap, aerodynamic drag, rolling resistance
 *  - linear tyre model with friction limits per axle, longitudinal load transfer
 *  - rear friction circle (power oversteer) and handbrake grip loss
 *  - speed-sensitive, rate-limited steering with self-centring
 *  - automatic gearbox with shift cut, RPM derived from wheel speed
 *  - limited nitro that adds real drive force
 * Below walking pace the model blends to kinematic steering to stay stable.
 *
 * World conventions: Y up, heading 0 faces -Z, positive heading/yaw turns left.
 */

export interface DriveInput {
  throttle: number;  // 0..1
  brake: number;     // 0..1 (brake, then reverse when stopped)
  steer: number;     // -1..1, positive = left
  handbrake: boolean;
  nitro: boolean;
}

export interface SurfaceInfo {
  grip: number;         // multiplier
  rolling: number;      // extra rolling resistance coefficient
}

export const NEUTRAL_INPUT: Readonly<DriveInput> = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
const ROAD: SurfaceInfo = { grip: 1, rolling: 0 };
const G = 9.81;
export const CAR_HALF_LENGTH = 2.25;
export const CAR_HALF_WIDTH = 0.98;
const CG_HEIGHT = 0.36;
const STABILITY_ASSIST = 1.6; // 1/s yaw damping toward the steered path (off with handbrake)
const WHEEL_RADIUS = 0.34;

export class VehicleSim {
  readonly config: CarConfig;
  readonly mass: number;
  readonly inertia: number;
  readonly halfLength = CAR_HALF_LENGTH;
  readonly halfWidth = CAR_HALF_WIDTH;
  private readonly dragCoef: number;
  private readonly gearTops: number[];

  // Rigid-body state (world space)
  x = 0; z = 0; heading = 0;
  vx = 0; vz = 0; yawRate = 0;

  // Drivetrain / controls
  steerAngle = 0;
  gear = 0;          // -1 R, 0 N, 1..n
  rpm: number;
  nitro: number;     // seconds remaining
  boosting = false;
  private shiftTimer = 0;

  // Derived outputs for HUD, audio and presentation
  forwardSpeed = 0;  // m/s along heading (negative when reversing)
  lateralSpeed = 0;  // m/s, positive = sliding left
  longAccel = 0;
  latAccel = 0;
  rearSlip = 0;      // rad
  skid = 0;          // 0..1 tyre smoke / squeal intensity
  braking = false;
  throttle = 0;
  wheelRotation = 0; // rad
  distanceTravelled = 0;

  constructor(config: CarConfig) {
    this.config = config;
    this.mass = config.mass;
    const a = config.cgToFront, b = config.wheelbase - config.cgToFront;
    this.inertia = config.mass * (a * a + b * b) * 0.55;
    const power = config.enginePowerKW * 1000;
    this.dragCoef = Math.max(0.05, (power / config.topSpeed - config.rollingResistance * config.mass * G) / (config.topSpeed ** 2));
    this.gearTops = config.gearRatios.map(r => r * config.topSpeed);
    this.rpm = config.idleRpm;
    this.nitro = config.nitroCapacity;
  }

  get speed(): number { return Math.hypot(this.vx, this.vz); }
  get forwardX(): number { return -Math.sin(this.heading); }
  get forwardZ(): number { return -Math.cos(this.heading); }
  get gearCount(): number { return this.gearTops.length; }
  get rpmFactor(): number { return (this.rpm - this.config.idleRpm) / (this.config.redlineRpm - this.config.idleRpm); }
  get nitroFraction(): number { return this.config.nitroCapacity > 0 ? this.nitro / this.config.nitroCapacity : 0; }

  /** Place the car at rest. */
  place(x: number, z: number, heading: number): void {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = this.vz = this.yawRate = 0;
    this.steerAngle = 0; this.gear = 0; this.rpm = this.config.idleRpm;
    this.forwardSpeed = this.lateralSpeed = this.longAccel = this.latAccel = 0;
    this.skid = this.rearSlip = 0; this.boosting = false; this.braking = false; this.shiftTimer = 0;
  }

  resetConsumables(): void {
    this.nitro = this.config.nitroCapacity;
    this.distanceTravelled = 0;
  }

  /** Maximum road-wheel angle available at the current speed. */
  steerLimit(speed = Math.abs(this.forwardSpeed)): number {
    const c = this.config;
    return Math.max(0.03, c.steerMax / (1 + (speed / c.steerSpeedFalloff) ** 2));
  }

  step(input: DriveInput, dt: number, surface: SurfaceInfo = ROAD): void {
    const c = this.config;
    const m = this.mass;
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading); // forward
    const lx = -Math.cos(this.heading), lz = Math.sin(this.heading);  // left
    let u = this.vx * fx + this.vz * fz;
    let vLat = this.vx * lx + this.vz * lz;
    const absU = Math.abs(u);
    const throttle = clamp01(input.throttle);
    const brake = clamp01(input.brake);
    this.throttle = throttle;

    // ── Steering: rate-limited toward a speed-dependent target, faster return to centre
    const target = Math.max(-1, Math.min(1, input.steer)) * this.steerLimit(absU);
    const centring = Math.abs(target) < Math.abs(this.steerAngle) || Math.sign(target) !== Math.sign(this.steerAngle);
    const rate = c.steerRate * (centring ? 1.6 : 1);
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);
    const delta = this.steerAngle;

    // ── Longitudinal forces
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const shiftCut = this.shiftTimer > 0 ? 0.35 : 1;
    let drive = 0;
    let brakeForce = 0; // magnitude, opposes motion
    let reversing = false;

    if (throttle > 0 && u > -0.5) {
      const power = c.enginePowerKW * 1000;
      drive = throttle * Math.min(m * c.maxDriveAccel, power / Math.max(absU, 1)) * shiftCut;
    } else if (throttle > 0) {
      brakeForce = throttle * c.brakeDecel * m; // throttle while rolling backwards brakes first
    }
    if (brake > 0) {
      if (u > 0.5) brakeForce += brake * c.brakeDecel * m;
      else if (throttle === 0) {
        reversing = true;
        if (u > -c.reverseSpeed) drive = -brake * m * 4.5;
      }
    }

    // Nitro adds genuine force and is consumed only while it does work
    const nitroWanted = input.nitro && throttle > 0.1 && u > 1 && this.nitro > 0 && c.nitroCapacity > 0;
    this.boosting = nitroWanted;
    if (nitroWanted) {
      drive += m * c.nitroAccel;
      this.nitro = Math.max(0, this.nitro - dt);
    } else if (!input.nitro) {
      this.nitro = Math.min(c.nitroCapacity, this.nitro + c.nitroRecharge * dt);
    }
    const speedCap = c.topSpeed * (this.boosting ? 1 + c.nitroTopSpeedBonus : 1);
    if (u > speedCap && drive > 0) drive = 0;

    if (input.handbrake && absU > 0.5) brakeForce += m * 3.5;
    if (throttle === 0 && !reversing && absU > 0.5) brakeForce += m * 0.9 * (0.4 + 0.6 * Math.max(0, this.rpmFactor)); // engine braking

    const resist = this.dragCoef * u * absU + (c.rollingResistance + surface.rolling) * m * G * Math.sign(u) * Math.min(1, absU);
    const uBefore = u;
    const Fx = drive - resist - (absU > 0 ? Math.sign(u) * brakeForce : 0);

    // ── Lateral tyre forces (dynamic bicycle model)
    const a = c.cgToFront, b = c.wheelbase - c.cgToFront, L = c.wheelbase;
    const transfer = clamp(m * this.longAccel * CG_HEIGHT / L, -m * G * 0.2, m * G * 0.2);
    const Nf = m * G * b / L - transfer;
    const Nr = m * G * a / L + transfer;
    const muF = c.grip * surface.grip;
    const muR = c.grip * c.rearGripBias * surface.grip * (input.handbrake ? c.handbrakeGrip : 1);
    const rearDrive = 0.55 * Math.min(Math.abs(drive), muR * Nr); // partial friction-circle coupling: power oversteer without snap spins
    const rearLatMax = Math.sqrt(Math.max((muR * Nr) ** 2 - rearDrive ** 2, (0.25 * muR * Nr) ** 2));
    const uEff = Math.max(absU, 4);
    const r = this.yawRate;
    let Fyf = 0, Fyr = 0;
    if (u >= 0) {
      const alphaF = delta - Math.atan2(vLat + a * r, uEff);
      const alphaR = -Math.atan2(vLat - b * r, uEff);
      Fyf = clamp(c.corneringStiffness * alphaF, -muF * Nf, muF * Nf);
      Fyr = clamp(c.corneringStiffness * c.rearGripBias * alphaR, -rearLatMax, rearLatMax);
      this.rearSlip = Math.abs(alphaR);
    } else {
      this.rearSlip = 0;
    }

    const axLocal = (Fx - Fyf * Math.sin(delta)) / m;
    const ayLocal = (Fyf * Math.cos(delta) + Fyr) / m;
    const yawAccel = (a * Fyf * Math.cos(delta) - b * Fyr) / this.inertia;

    this.vx += (fx * axLocal + lx * ayLocal) * dt;
    this.vz += (fz * axLocal + lz * ayLocal) * dt;
    this.yawRate += yawAccel * dt;

    // ── Low-speed / reverse blend to kinematic steering (no lateral sliding at parking speeds)
    u = this.vx * fx + this.vz * fz;
    vLat = this.vx * lx + this.vz * lz;
    const k = u < 0 ? 0 : clamp01((Math.abs(u) - 2) / 6);
    const kinematicYaw = u * Math.tan(delta) / L;
    this.yawRate = kinematicYaw + (this.yawRate - kinematicYaw) * k;
    if (!input.handbrake) this.yawRate += (kinematicYaw - this.yawRate) * Math.min(1, STABILITY_ASSIST * dt);
    vLat *= 1 - (1 - k) * Math.min(1, 12 * dt);
    if (!input.handbrake) vLat *= 1 - Math.min(1, 0.6 * dt); // residual scrub so slides settle

    // Braking can stop the car but never reverse its direction within a step
    if (brakeForce > 0 && uBefore !== 0 && Math.sign(u) !== Math.sign(uBefore) && Math.abs(drive) < 1) u = 0;
    // Come to a clean stop instead of creeping
    if (throttle === 0 && (brake === 0 || u > 0) && Math.abs(u) < 0.08) u = 0;

    this.vx = fx * u + lx * vLat;
    this.vz = fz * u + lz * vLat;
    this.heading += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // ── Outputs
    this.longAccel = axLocal;
    this.latAccel = ayLocal;
    this.forwardSpeed = u;
    this.lateralSpeed = vLat;
    this.braking = (brake > 0 && u > 0.5) || (throttle > 0 && u < -0.5) || (input.handbrake && Math.abs(u) > 0.5);
    this.wheelRotation += (u / WHEEL_RADIUS) * dt;
    this.distanceTravelled += Math.abs(u) * dt;
    const slide = clamp01((Math.abs(vLat) - 1.2) / 6);
    const spin = throttle > 0.5 && u < 9 && u >= 0 ? clamp01((m * c.maxDriveAccel * throttle) / (muR * Nr) - 0.75) * clamp01(1 - u / 9) : 0;
    const hb = input.handbrake && Math.abs(u) > 4 ? 0.7 : 0;
    this.skid = Math.max(slide, spin, hb, clamp01((this.rearSlip - 0.09) / 0.2));
    this.updateGearbox(u, throttle, reversing);
  }

  private updateGearbox(u: number, throttle: number, reversing: boolean): void {
    const c = this.config;
    const prev = this.gear;
    if (u < -0.3 || (reversing && u < 0.3)) this.gear = -1;
    else if (u < 0.3 && throttle === 0) this.gear = 0;
    else {
      if (this.gear < 1) this.gear = 1;
      const top = this.gearTops[this.gear - 1];
      if (this.gear < this.gearTops.length && u > top * 0.97) this.gear++;
      else if (this.gear > 1 && u < this.gearTops[this.gear - 2] * 0.62) this.gear--;
    }
    if (this.gear > prev && prev >= 1) this.shiftTimer = 0.16;

    let targetRpm = c.idleRpm;
    if (this.gear >= 1) {
      const top = this.gearTops[this.gear - 1];
      targetRpm = c.idleRpm + (c.redlineRpm - c.idleRpm) * clamp01(Math.abs(u) / top);
      if (this.gear === 1 && throttle > 0) targetRpm = Math.max(targetRpm, c.idleRpm + 2600 * throttle);
    } else if (this.gear === -1) {
      targetRpm = c.idleRpm + (c.redlineRpm - c.idleRpm) * clamp01(Math.abs(u) / (c.reverseSpeed * 1.4));
    } else if (throttle > 0) {
      targetRpm = c.idleRpm + 3000 * throttle;
    }
    const lag = this.shiftTimer > 0 ? 0.5 : 0.25;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, (1 / lag) * (1 / 60));
    this.rpm = Math.min(c.redlineRpm, Math.max(c.idleRpm * 0.95, this.rpm));
  }

  /** Apply an impulse (N·s) at a world point. */
  applyImpulse(jx: number, jz: number, px: number, pz: number): void {
    this.vx += jx / this.mass;
    this.vz += jz / this.mass;
    const rx = px - this.x, rz = pz - this.z;
    this.yawRate += (rz * jx - rx * jz) / this.inertia;
  }

  /** World velocity of a point attached to the body. */
  pointVelocity(px: number, pz: number): [number, number] {
    const rx = px - this.x, rz = pz - this.z;
    return [this.vx + this.yawRate * rz, this.vz - this.yawRate * rx];
  }

  /** Corner points (world XZ) of the collision rectangle: FL, FR, RR, RL. */
  corners(out: number[] = new Array(8)): number[] {
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    const L = this.halfLength, W = this.halfWidth;
    const pts = [[L, -W], [L, W], [-L, W], [-L, -W]];
    for (let i = 0; i < 4; i++) {
      out[i * 2] = this.x + fx * pts[i][0] + rx * pts[i][1];
      out[i * 2 + 1] = this.z + fz * pts[i][0] + rz * pts[i][1];
    }
    return out;
  }
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
