/**
 * Race Wars — Vehicle catalogue.
 * Physical parameters drive VehicleSim directly. Display stats shown in the
 * garage are derived from these values (see vehicle/VehicleStats.ts), never typed by hand.
 */

export interface CarConfig {
  id: string;
  name: string;
  tagline: string;
  modelPath: string;
  bodyColor: number;

  // Physical parameters (SI units)
  mass: number;              // kg
  enginePowerKW: number;     // peak wheel power
  maxDriveAccel: number;     // m/s², traction-limited launch acceleration
  topSpeed: number;          // m/s, aerodynamic drag is tuned so power balances drag here
  reverseSpeed: number;      // m/s
  brakeDecel: number;        // m/s² at full brake
  rollingResistance: number; // coefficient
  wheelbase: number;         // m
  cgToFront: number;         // m, centre of gravity to front axle
  steerMax: number;          // rad, maximum wheel angle at walking pace
  steerSpeedFalloff: number; // m/s, speed where available steering halves
  steerRate: number;         // rad/s, how fast the wheels turn
  grip: number;              // tyre friction coefficient
  rearGripBias: number;      // >1 = stable rear, <1 = loose rear
  corneringStiffness: number;// N/rad per axle
  handbrakeGrip: number;     // rear grip multiplier with handbrake applied
  nitroAccel: number;        // extra m/s² while nitro is active
  nitroCapacity: number;     // seconds of continuous nitro
  nitroRecharge: number;     // seconds of nitro regained per second when not in use
  nitroTopSpeedBonus: number;// fraction above topSpeed allowed while boosting
  gearRatios: number[];      // fraction of top speed reached at redline in each gear
  idleRpm: number;
  redlineRpm: number;
}

const BASE_GEARS = [0.27, 0.42, 0.57, 0.71, 0.85, 1.02];

function car(c: Omit<CarConfig, 'modelPath' | 'rollingResistance' | 'idleRpm' | 'gearRatios'> & Partial<CarConfig>): CarConfig {
  return {
    modelPath: '/car.glb',
    rollingResistance: 0.015,
    idleRpm: 900,
    gearRatios: BASE_GEARS,
    ...c,
  } as CarConfig;
}

export const CAR_CATALOGUE: CarConfig[] = [
  car({
    id: 'vortex_r', name: 'VORTEX R', tagline: 'Balanced street weapon', bodyColor: 0xb3121b,
    mass: 1420, enginePowerKW: 410, maxDriveAccel: 8.6, topSpeed: 82, reverseSpeed: 11, brakeDecel: 13,
    wheelbase: 2.65, cgToFront: 1.22, steerMax: 0.58, steerSpeedFalloff: 25, steerRate: 2.4,
    grip: 1.55, rearGripBias: 1.05, corneringStiffness: 205000, handbrakeGrip: 0.42,
    nitroAccel: 6.5, nitroCapacity: 3.6, nitroRecharge: 0.16, nitroTopSpeedBonus: 0.16, redlineRpm: 8500,
  }),
  car({
    id: 'apex_gt', name: 'APEX GT', tagline: 'Highest top speed', bodyColor: 0x1f4fd1,
    mass: 1510, enginePowerKW: 455, maxDriveAccel: 7.8, topSpeed: 89, reverseSpeed: 10, brakeDecel: 12,
    wheelbase: 2.72, cgToFront: 1.28, steerMax: 0.54, steerSpeedFalloff: 24, steerRate: 2.1,
    grip: 1.45, rearGripBias: 1.1, corneringStiffness: 200000, handbrakeGrip: 0.45,
    nitroAccel: 6.0, nitroCapacity: 3.4, nitroRecharge: 0.15, nitroTopSpeedBonus: 0.15, redlineRpm: 7800,
  }),
  car({
    id: 'nova_rs', name: 'NOVA RS', tagline: 'Explosive acceleration', bodyColor: 0x1b9a3a,
    mass: 1330, enginePowerKW: 420, maxDriveAccel: 9.6, topSpeed: 78, reverseSpeed: 11, brakeDecel: 13.5,
    wheelbase: 2.58, cgToFront: 1.2, steerMax: 0.6, steerSpeedFalloff: 25, steerRate: 2.5,
    grip: 1.5, rearGripBias: 1.0, corneringStiffness: 200000, handbrakeGrip: 0.4,
    nitroAccel: 7.5, nitroCapacity: 3.8, nitroRecharge: 0.18, nitroTopSpeedBonus: 0.17, redlineRpm: 9000,
  }),
  car({
    id: 'phantom_x', name: 'PHANTOM X', tagline: 'Precision handling', bodyColor: 0x15161a,
    mass: 1360, enginePowerKW: 385, maxDriveAccel: 8.8, topSpeed: 79, reverseSpeed: 11, brakeDecel: 14.5,
    wheelbase: 2.6, cgToFront: 1.25, steerMax: 0.62, steerSpeedFalloff: 28, steerRate: 2.8,
    grip: 1.68, rearGripBias: 1.08, corneringStiffness: 220000, handbrakeGrip: 0.45,
    nitroAccel: 5.5, nitroCapacity: 3.2, nitroRecharge: 0.15, nitroTopSpeedBonus: 0.14, redlineRpm: 8800,
  }),
  car({
    id: 'titan_xr', name: 'TITAN XR', tagline: 'Heavy, brutal nitro', bodyColor: 0xc9a50c,
    mass: 1650, enginePowerKW: 470, maxDriveAccel: 7.4, topSpeed: 85, reverseSpeed: 9, brakeDecel: 11.5,
    wheelbase: 2.8, cgToFront: 1.32, steerMax: 0.52, steerSpeedFalloff: 23, steerRate: 2.0,
    grip: 1.42, rearGripBias: 0.98, corneringStiffness: 205000, handbrakeGrip: 0.4,
    nitroAccel: 9.0, nitroCapacity: 4.4, nitroRecharge: 0.17, nitroTopSpeedBonus: 0.2, redlineRpm: 7200,
  }),
];

/** Civilian traffic: softer, slower, heavier. Uses the same simulation as racers. */
export const TRAFFIC_CONFIG: CarConfig = car({
  id: 'civilian', name: 'CIVILIAN', tagline: '', bodyColor: 0x888888,
  mass: 1550, enginePowerKW: 110, maxDriveAccel: 3.5, topSpeed: 40, reverseSpeed: 6, brakeDecel: 9,
  wheelbase: 2.7, cgToFront: 1.3, steerMax: 0.5, steerSpeedFalloff: 20, steerRate: 1.6,
  grip: 1.0, rearGripBias: 1.1, corneringStiffness: 150000, handbrakeGrip: 0.6,
  nitroAccel: 0, nitroCapacity: 0, nitroRecharge: 0, nitroTopSpeedBonus: 0, redlineRpm: 6000,
});

export const PAINT_COLORS: Record<string, number> = {
  red: 0xb3121b, blue: 0x1f4fd1, green: 0x1b9a3a, black: 0x15161a, white: 0xe8e8e8, yellow: 0xc9a50c,
};

export function getCarById(id: string): CarConfig {
  const config = CAR_CATALOGUE.find(c => c.id === id) ?? CAR_CATALOGUE[0];
  return { ...config, gearRatios: [...config.gearRatios] };
}
