import * as THREE from 'three';


/**
 * Race Wars — Traffic Manager
 * Spawns and recycles civilian traffic on the highway.
 */

export class TrafficVehicle {
  public mesh: THREE.Group;
  public boundingBox: THREE.Box3;
  public speed: number = 0;
  public active: boolean = false;
  // isBoxTruck removed

  constructor(scene: THREE.Scene, isBoxTruck: boolean = false) {
    this.mesh = new THREE.Group();
    
    // Choose civilian colors
    const colors = [0xffffff, 0xd0d0d0, 0x111111, 0x1c2b4c, 0x3d0c0c, 0x4a4a4a];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: color,
      metalness: 0.4,
      roughness: 0.5
    });

    if (isBoxTruck) {
      // Box truck
      const cabGeom = new THREE.BoxGeometry(2.4, 2.5, 2.0);
      const cab = new THREE.Mesh(cabGeom, bodyMat);
      cab.position.set(0, 1.4, -2.5);
      cab.castShadow = true;
      cab.receiveShadow = true;
      this.mesh.add(cab);

      const boxGeom = new THREE.BoxGeometry(2.6, 3.5, 6.0);
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.8 });
      const box = new THREE.Mesh(boxGeom, boxMat);
      box.position.set(0, 1.9, 1.5);
      box.castShadow = true;
      box.receiveShadow = true;
      this.mesh.add(box);
    } else {
      // Sedan
      const bodyGeom = new THREE.BoxGeometry(2.0, 0.8, 4.8);
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.y = 0.5;
      body.castShadow = true;
      body.receiveShadow = true;
      this.mesh.add(body);

      const cabinGeom = new THREE.BoxGeometry(1.8, 0.6, 2.4);
      const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });
      const cabin = new THREE.Mesh(cabinGeom, cabinMat);
      cabin.position.set(0, 1.2, -0.2);
      this.mesh.add(cabin);
    }

    // Tail lights
    const tailGeom = new THREE.BoxGeometry(0.4, 0.15, 0.05);
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xcc0000 });
    const tlL = new THREE.Mesh(tailGeom, tailMat);
    tlL.position.set(-0.7, 0.6, isBoxTruck ? 4.5 : 2.4);
    this.mesh.add(tlL);
    
    const tlR = new THREE.Mesh(tailGeom, tailMat);
    tlR.position.set(0.7, 0.6, isBoxTruck ? 4.5 : 2.4);
    this.mesh.add(tlR);

    this.mesh.visible = false;
    scene.add(this.mesh);
    this.boundingBox = new THREE.Box3();
  }

  public spawn(zOffset: number, laneOffset: number, speed: number): void {
    this.active = true;
    this.mesh.visible = true;
    this.mesh.position.set(laneOffset, 0, zOffset);
    this.speed = speed;
    this.updateBoundingBox();
  }

  public deactivate(): void {
    this.active = false;
    this.mesh.visible = false;
  }

  public update(delta: number): void {
    if (!this.active) return;
    this.mesh.position.z -= this.speed * delta;
    this.updateBoundingBox();
  }

  public updateBoundingBox(): void {
    this.boundingBox.setFromObject(this.mesh);
  }
}

export class TrafficManager {
  // scene removed
  public vehicles: TrafficVehicle[] = [];
  
  private maxVehicles = 15;
  private spawnDistance = 250;
  private despawnDistance = 40;
  private lanes = [-8, -4, 0, 4, 8]; // Fixed lanes to prevent overlapping

  private seedState = 1000;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < this.maxVehicles; i++) {
      // Make 20% of traffic trucks
      this.vehicles.push(new TrafficVehicle(scene, i % 5 === 0));
    }
  }

  public setSeed(seedStr: string): void {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = (hash << 5) - hash + seedStr.charCodeAt(i);
      hash |= 0;
    }
    this.seedState = hash;
  }

  private random(): number {
    const x = Math.sin(this.seedState++) * 10000;
    return x - Math.floor(x);
  }

  public update(playerZ: number, delta: number): void {
    let activeCount = 0;

    for (const v of this.vehicles) {
      if (v.active) {
        v.update(delta);
        if (v.mesh.position.z > playerZ + this.despawnDistance) {
          v.deactivate();
        } else {
          activeCount++;
        }
      }
    }

    if (activeCount < this.maxVehicles) {
      if (this.random() < 0.1) {
        const inactiveVehicle = this.vehicles.find(v => !v.active);
        if (inactiveVehicle) {
          const lane = this.lanes[Math.floor(this.random() * this.lanes.length)];
          const spawnZ = playerZ - this.spawnDistance - this.random() * 80;
          
          // Verify no active vehicle is too close to spawn point
          let safeToSpawn = true;
          for (const v of this.vehicles) {
            if (v.active && Math.abs(v.mesh.position.x - lane) < 1 && Math.abs(v.mesh.position.z - spawnZ) < 30) {
              safeToSpawn = false;
              break;
            }
          }

          if (safeToSpawn) {
            // Speed between 18 and 28 units/sec
            const speed = 18 + this.random() * 10;
            inactiveVehicle.spawn(spawnZ, lane, speed);
          }
        }
      }
    }
  }

  public reset(): void {
    for (const v of this.vehicles) {
      v.deactivate();
    }
  }
}
