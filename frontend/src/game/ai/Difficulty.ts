/**
 * Race Wars — AI difficulty and driver personalities.
 * Difficulty changes behaviour (perception delay, gaps, corner commitment,
 * willingness to pass, precision), never the car's physics or speed limits.
 */

export type DifficultyLevel = 'easy' | 'normal' | 'hard';

export interface DifficultyProfile {
  reactionTime: number;     // s between perception/decision updates
  timeGap: number;          // s headway kept to the car ahead
  cornerFactor: number;     // fraction of the physical grip limit used in corners
  brakeMargin: number;      // fraction of brake capability planned for
  overtakeWillingness: number; // 0..1
  riskTolerance: number;    // 0..1, how tight a gap it accepts
  recoveryDelay: number;    // s stuck before recovery manoeuvre
  steerNoise: number;       // steering imprecision
  nitroUse: number;         // 0..1
}

export const DIFFICULTY: Record<DifficultyLevel, DifficultyProfile> = {
  easy: {
    reactionTime: 0.5, timeGap: 1.1, cornerFactor: 0.8, brakeMargin: 0.7, overtakeWillingness: 0.35,
    riskTolerance: 0.25, recoveryDelay: 2.2, steerNoise: 0.08, nitroUse: 0.25,
  },
  normal: {
    reactionTime: 0.28, timeGap: 0.75, cornerFactor: 0.9, brakeMargin: 0.82, overtakeWillingness: 0.7,
    riskTolerance: 0.5, recoveryDelay: 1.5, steerNoise: 0.035, nitroUse: 0.6,
  },
  hard: {
    reactionTime: 0.14, timeGap: 0.5, cornerFactor: 0.97, brakeMargin: 0.9, overtakeWillingness: 1,
    riskTolerance: 0.8, recoveryDelay: 1.0, steerNoise: 0.01, nitroUse: 1,
  },
};

export interface Personality {
  name: string;
  lineAdherence: number;    // how strongly it returns to the racing line
  overtakeBias: number;     // multiplier on overtaking willingness
  riskBias: number;         // added to risk tolerance
  laneChangeRate: number;   // m/s of lateral target movement
  nitroBias: number;
}

export const PERSONALITIES: Record<'balanced' | 'aggressive', Personality> = {
  balanced: { name: 'Balanced', lineAdherence: 1, overtakeBias: 0.85, riskBias: 0, laneChangeRate: 3.2, nitroBias: 0.9 },
  aggressive: { name: 'Aggressive', lineAdherence: 0.55, overtakeBias: 1.35, riskBias: 0.2, laneChangeRate: 5, nitroBias: 1.2 },
};
