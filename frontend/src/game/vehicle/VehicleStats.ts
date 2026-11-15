import { VehicleSim, NEUTRAL_INPUT } from './VehicleSim';
import type { CarConfig } from '../CarConfig';

/**
 * Garage performance figures measured by running the real simulation,
 * so the numbers shown to the player are the numbers the car actually achieves.
 */
export interface CarStats {
  topSpeedKmh: number;
  zeroTo100: number;
  brake100to0: number;  // metres
  lateralG: number;
  nitroSeconds: number;
  powerKW: number;
  massKg: number;
  bars: { speed: number; accel: number; handling: number; braking: number; nitro: number };
}

const cache = new Map<string, CarStats>();
const DT = 1 / 120;

export function carStats(config: CarConfig): CarStats {
  const hit = cache.get(config.id);
  if (hit) return hit;
  const accel = new VehicleSim(config);
  let t = 0, t100 = 0;
  while (t < 70) {
    accel.step({ ...NEUTRAL_INPUT, throttle: 1 }, DT); t += DT;
    if (!t100 && accel.forwardSpeed >= 100 / 3.6) t100 = t;
  }
  const brake = new VehicleSim(config);
  brake.vz = -100 / 3.6;
  let bt = 0;
  while (brake.speed > 0.05 && bt < 10) { brake.step({ ...NEUTRAL_INPUT, brake: 1 }, DT); bt += DT; }
  const brakeDist = Math.abs(brake.z);
  const lat = new VehicleSim(config);
  lat.vz = -30;
  let maxLat = 0;
  for (let k = 0; k < 360; k++) {
    lat.step({ ...NEUTRAL_INPUT, throttle: lat.forwardSpeed < 30 ? 0.5 : 0, steer: 1 }, DT);
    maxLat = Math.max(maxLat, Math.abs(lat.latAccel));
  }
  const topKmh = accel.forwardSpeed * 3.6;
  const pct = (v: number, lo: number, hi: number) => Math.round(Math.max(5, Math.min(100, ((v - lo) / (hi - lo)) * 100)));
  const stats: CarStats = {
    topSpeedKmh: Math.round(topKmh),
    zeroTo100: Math.round(t100 * 100) / 100,
    brake100to0: Math.round(brakeDist * 10) / 10,
    lateralG: Math.round((maxLat / 9.81) * 100) / 100,
    nitroSeconds: config.nitroCapacity,
    powerKW: config.enginePowerKW,
    massKg: config.mass,
    bars: {
      speed: pct(topKmh, 230, 330),
      accel: pct(-t100, -4.6, -2.8),
      handling: pct(maxLat / 9.81 + config.steerSpeedFalloff / 100, 1.25, 1.95),
      braking: pct(-brakeDist, -34, -22),
      nitro: pct(config.nitroAccel * config.nitroCapacity, 15, 42),
    },
  };
  cache.set(config.id, stats);
  return stats;
}
