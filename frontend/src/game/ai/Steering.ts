import type { Body } from '../physics/PhysicsWorld';
import { Track, wrapAngle } from '../track/Track';

/**
 * Stanley-style path tracking used by every computer-driven car.
 * steer = curvature feed-forward + heading error + cross-track correction − yaw-rate damping.
 * Returns a normalised steering input (-1..1, positive = left).
 */
export function trackSteer(track: Track, self: Body, targetD: number, gain = 1.1, noise = 0): number {
  const sim = self.sim;
  const u = Math.max(0, sim.forwardSpeed);
  const preview = 4 + u * 0.22;
  const s = self.track.s;
  const kappa = track.curvatureAt(s + preview);
  const headingErr = wrapAngle(track.headingAt(s + preview) - sim.heading);
  // Cross-track error measured at the front axle; positive = target lies to the left
  const front = sim.config.cgToFront;
  const i = self.track.index;
  const dFront = self.track.d + front * (-sim.forwardX * track.tz[i] + sim.forwardZ * track.tx[i]);
  const err = dFront - targetD;
  const feedForward = Math.atan(sim.config.wheelbase * kappa);
  const crossTrack = Math.atan2(gain * err, 3 + u);
  const damping = 0.06 * (sim.yawRate - u * kappa);
  const delta = feedForward + headingErr * 0.9 + crossTrack - damping;
  return Math.max(-1, Math.min(1, delta / sim.steerLimit(u) + noise));
}
