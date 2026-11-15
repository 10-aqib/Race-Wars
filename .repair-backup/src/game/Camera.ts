import * as THREE from 'three';

/**
 * Race Wars — Third Person Camera
 * Cinematic chase camera with speed-based effects
 */

export class ThirdPersonCamera {
  public camera: THREE.PerspectiveCamera;

  // Chase parameters
  private baseOffset = new THREE.Vector3(0, 3.5, 8);
  private lookAtOffset = new THREE.Vector3(0, 1.2, -5);

  // Smoothing
  private currentPosition = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();
  private initialized = false;

  // Speed effects
  private baseFov = 60;
  private maxFov = 75;
  private currentFov = 60;

  // Camera shake
  public shakeEnabled = true;
  private shakeAmount = 0;

  // Idle orbit (for menu scenes)
  private idleMode = false;
  private idleTarget = new THREE.Vector3(0, 1, 0);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 1200);
    this.camera.position.set(0, 5, 15);
  }

  public update(
    targetPosition: THREE.Vector3,
    targetRotation: THREE.Quaternion,
    delta: number,
    speed: number = 0,
    maxSpeed: number = 55,
    isBoosting: boolean = false
  ): void {
    if (this.idleMode) {
      this.updateIdle(delta);
      return;
    }

    // Speed-based FOV — extra during boost
    const speedRatio = Math.min(1, Math.abs(speed) / maxSpeed);
    const boostFovAdd = isBoosting ? 8 : 0;
    const targetFov = this.baseFov + (this.maxFov - this.baseFov) * speedRatio + boostFovAdd;
    this.currentFov += (targetFov - this.currentFov) * Math.min(1, delta * 3);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    // Speed-based offset (pull back at high speed)
    const dynamicOffset = this.baseOffset.clone();
    dynamicOffset.z += speedRatio * 3;
    dynamicOffset.y += speedRatio * 0.5;

    // Calculate ideal position
    const idealOffset = dynamicOffset.clone();
    idealOffset.applyQuaternion(targetRotation);
    idealOffset.add(targetPosition);

    // Calculate ideal lookat (further ahead at speed)
    const dynamicLookAt = this.lookAtOffset.clone();
    dynamicLookAt.z -= speedRatio * 8;
    const idealLookAt = dynamicLookAt.clone();
    idealLookAt.applyQuaternion(targetRotation);
    idealLookAt.add(targetPosition);

    // Smooth follow (frame-rate independent)
    const t = 1.0 - Math.pow(0.005, delta);

    if (!this.initialized) {
      this.currentPosition.copy(idealOffset);
      this.currentLookAt.copy(idealLookAt);
      this.initialized = true;
    } else {
      this.currentPosition.lerp(idealOffset, t);
      this.currentLookAt.lerp(idealLookAt, t);
    }

    this.camera.position.copy(this.currentPosition);

    // Camera shake
    if (this.shakeEnabled && this.shakeAmount > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount * 0.5;
      this.shakeAmount *= 0.9;
    }

    this.camera.lookAt(this.currentLookAt);
  }

  public setIdleMode(enabled: boolean, target?: THREE.Vector3): void {
    this.idleMode = enabled;
    if (target) this.idleTarget.copy(target);
    if (enabled) {
      this.initialized = false;
    }
  }

  private idleTime = 0;

  private updateIdle(delta: number): void {
    this.idleTime += delta;
    
    // Cinematic low angle, positioned behind-left so car appears right-center
    const baseX = -3.5;
    const baseY = 0.9;
    const baseZ = -6.5;

    const driftX = Math.sin(this.idleTime * 0.2) * 0.3;
    const driftY = Math.cos(this.idleTime * 0.15) * 0.1;
    const driftZ = Math.sin(this.idleTime * 0.1) * 0.2;

    const targetPos = new THREE.Vector3(
      this.idleTarget.x + baseX + driftX,
      this.idleTarget.y + baseY + driftY,
      this.idleTarget.z + baseZ + driftZ
    );

    // Look slightly ahead of the car and to the right
    const lookTarget = new THREE.Vector3(
      this.idleTarget.x + 0.8,
      this.idleTarget.y + 0.7,
      this.idleTarget.z + 1.5
    );

    this.currentPosition.lerp(targetPos, 0.05);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(lookTarget);
  }


  public triggerShake(intensity: number = 0.15): void {
    if (this.shakeEnabled) {
      this.shakeAmount = intensity;
    }
  }

  public resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public resetPosition(): void {
    this.initialized = false;
  }
}
