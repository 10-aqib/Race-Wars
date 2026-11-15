/**
 * Race Wars — Car Configuration System
 * Single source of truth for all vehicle data.
 * Stats are on a 0–100 scale and directly drive gameplay values.
 */

export interface CarConfig {
  id: string;
  name: string;
  tagline: string;
  modelPath: string;         // path under /public
  bodyColor: number;         // default hex color
  // Gameplay multipliers — derived from 0–100 stats
  topSpeed: number;          // max m/s   (stat → value)
  acceleration: number;      // m/s²
  brakeForce: number;        // m/s²  deceleration
  handling: number;          // rad/s turn rate
  boostPower: number;        // extra m/s² during boost
  // Display stats (0–100)
  statSpeed: number;
  statAccel: number;
  statHandling: number;
  statBraking: number;
  statBoost: number;
  // Gear thresholds in km/h  [g1max, g2max, g3max, g4max, g5max, g6=unlimited]
  gearThresholds: number[];
}

export const CAR_CATALOGUE: CarConfig[] = [
  {
    id: 'vortex_r',
    name: 'VORTEX R',
    tagline: 'Balanced sports car',
    modelPath: '/car.glb',
    bodyColor: 0xD42020,
    topSpeed: 55,
    acceleration: 18,
    brakeForce: 35,
    handling: 2.2,
    boostPower: 22,
    statSpeed: 82,
    statAccel: 74,
    statHandling: 80,
    statBraking: 78,
    statBoost: 75,
    gearThresholds: [45, 80, 120, 165, 215],
  },
  {
    id: 'apex_gt',
    name: 'APEX GT',
    tagline: 'High top speed',
    modelPath: '/car.glb',
    bodyColor: 0x2060D4,
    topSpeed: 70,
    acceleration: 14,
    brakeForce: 28,
    handling: 1.8,
    boostPower: 28,
    statSpeed: 96,
    statAccel: 60,
    statHandling: 65,
    statBraking: 65,
    statBoost: 85,
    gearThresholds: [50, 95, 145, 195, 255],
  },
  {
    id: 'nova_rs',
    name: 'NOVA RS',
    tagline: 'Strong acceleration',
    modelPath: '/car.glb',
    bodyColor: 0x20A040,
    topSpeed: 50,
    acceleration: 26,
    brakeForce: 38,
    handling: 2.0,
    boostPower: 30,
    statSpeed: 72,
    statAccel: 95,
    statHandling: 72,
    statBraking: 82,
    statBoost: 90,
    gearThresholds: [35, 65, 100, 140, 185],
  },
  {
    id: 'phantom_x',
    name: 'PHANTOM X',
    tagline: 'Supreme handling',
    modelPath: '/car.glb',
    bodyColor: 0x111111,
    topSpeed: 52,
    acceleration: 20,
    brakeForce: 42,
    handling: 2.8,
    boostPower: 18,
    statSpeed: 76,
    statAccel: 78,
    statHandling: 96,
    statBraking: 92,
    statBoost: 65,
    gearThresholds: [40, 72, 110, 152, 200],
  },
  {
    id: 'titan_xr',
    name: 'TITAN XR',
    tagline: 'Heavy but powerful',
    modelPath: '/car.glb',
    bodyColor: 0xddcc00,
    topSpeed: 58,
    acceleration: 15,
    brakeForce: 24,
    handling: 1.6,
    boostPower: 35,
    statSpeed: 88,
    statAccel: 62,
    statHandling: 55,
    statBraking: 58,
    statBoost: 98,
    gearThresholds: [55, 100, 155, 210, 270],
  },
];

export function getCarById(id: string): CarConfig {
  return CAR_CATALOGUE.find(c => c.id === id) ?? CAR_CATALOGUE[0];
}
