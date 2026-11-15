import * as THREE from 'three';
import type { Car } from './Car';
import type { TrafficManager } from './TrafficManager';

/**
 * Race Wars — Collision System
 * Precise bounding box collision detection between player and traffic
 */

export class CollisionSystem {
  public checkCollisions(playerCar: Car, trafficManager: TrafficManager): boolean {
    if (playerCar.isCrashed) return false;

    // Use smaller bounding box for player for more forgiving gameplay
    const playerBox = playerCar.boundingBox.clone();
    
    // Shrink the collision box slightly (by 15%) so near misses don't register as crashes
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    playerBox.getCenter(center);
    playerBox.getSize(size);
    size.multiplyScalar(0.85);
    playerBox.setFromCenterAndSize(center, size);

    for (const vehicle of trafficManager.vehicles) {
      if (vehicle.active) {
        if (playerBox.intersectsBox(vehicle.boundingBox)) {
          return true;
        }
      }
    }
    return false;
  }

  public checkNearMisses(playerCar: Car, trafficManager: TrafficManager): boolean {
    if (playerCar.isCrashed) return false;

    // Create a slightly larger box for near miss detection
    const nearMissBox = playerCar.boundingBox.clone();
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    nearMissBox.getCenter(center);
    nearMissBox.getSize(size);
    
    // Widen box horizontally and extend slightly forward for near misses
    size.x *= 2.5; 
    size.z *= 1.5;
    nearMissBox.setFromCenterAndSize(center, size);

    for (const vehicle of trafficManager.vehicles) {
      if (vehicle.active) {
        // Must not be actually colliding
        if (!playerCar.boundingBox.intersectsBox(vehicle.boundingBox)) {
          if (nearMissBox.intersectsBox(vehicle.boundingBox)) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
