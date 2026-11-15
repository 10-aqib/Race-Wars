import * as THREE from 'three';

/**
 * Race Wars — Downtown City Environment
 *
 * PERFORMANCE FIXES vs original:
 * - Streetlight bulbs use emissive material only (no PointLight per lamp)
 * - Only 2 shared "key" PointLights exist for the whole road
 * - Buildings use InstancedMesh where practical
 * - Lane markings are still InstancedMesh
 * - Segment recycling uses pool
 */
export class Environment {
  private scene: THREE.Scene;

  private roadSegments: THREE.Mesh[] = [];
  private segmentLength = 200;
  private numSegments = 8;
  private roadWidth = 50;

  private markersInstancedMesh!: THREE.InstancedMesh;
  private markerSpacing = 15;
  private numMarkers = 80;

  private cityBlocks: THREE.Group[] = [];
  private blockLength = 200;
  private numBlocks = 8;

  public directionalLight: THREE.DirectionalLight;

  // Shared key street-lights (2 moving PointLights instead of hundreds)
  private keyLight1: THREE.PointLight;
  private keyLight2: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.directionalLight = new THREE.DirectionalLight();
    this.keyLight1 = new THREE.PointLight(0xffaa55, 400, 120);
    this.keyLight2 = new THREE.PointLight(0xffaa55, 400, 120);

    this.setupSky();
    this.setupLighting();
    this.setupRoad();
    this.setupLaneMarkings();
    this.setupCityBlocks();
  }

  private setupSky(): void {
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.0025);
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0x111122, 3.0);
    this.scene.add(ambient);

    this.directionalLight = new THREE.DirectionalLight(0x4466aa, 4.0);
    this.directionalLight.position.set(50, 100, 50);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 1024;
    this.directionalLight.shadow.mapSize.height = 1024;
    this.directionalLight.shadow.camera.near = 0.5;
    this.directionalLight.shadow.camera.far = 300;
    const d = 100;
    this.directionalLight.shadow.camera.left = -d;
    this.directionalLight.shadow.camera.right = d;
    this.directionalLight.shadow.camera.top = d;
    this.directionalLight.shadow.camera.bottom = -d;
    this.scene.add(this.directionalLight);

    const hemi = new THREE.HemisphereLight(0x05051a, 0x050505, 2.0);
    this.scene.add(hemi);

    // 2 shared moving streetlights follow player instead of hundreds
    this.keyLight1.castShadow = false;
    this.keyLight2.castShadow = false;
    this.keyLight1.position.set(-28, 11, 0);
    this.keyLight2.position.set(28, 11, 0);
    this.scene.add(this.keyLight1);
    this.scene.add(this.keyLight2);
  }

  private setupRoad(): void {
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x08080a,
      metalness: 0.9,
      roughness: 0.18,
    });
    const roadGeom = new THREE.PlaneGeometry(this.roadWidth, this.segmentLength);
    for (let i = 0; i < this.numSegments; i++) {
      const segment = new THREE.Mesh(roadGeom, roadMat);
      segment.rotation.x = -Math.PI / 2;
      segment.receiveShadow = true;
      segment.position.z = -(i - 1) * this.segmentLength;
      this.scene.add(segment);
      this.roadSegments.push(segment);
    }
  }

  private setupLaneMarkings(): void {
    const markerGeom = new THREE.PlaneGeometry(0.15, 4);
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x222222, transparent: true, opacity: 0.5,
    });
    this.markersInstancedMesh = new THREE.InstancedMesh(markerGeom, markerMat, this.numMarkers * 5);
    const dummy = new THREE.Object3D();
    dummy.rotation.x = -Math.PI / 2;
    let idx = 0;
    const laneXPositions = [-8, -4, 0, 4, 8];
    for (const lx of laneXPositions) {
      for (let i = 0; i < this.numMarkers; i++) {
        dummy.position.set(lx, 0.05, (i - 10) * this.markerSpacing);
        dummy.updateMatrix();
        this.markersInstancedMesh.setMatrixAt(idx, dummy.matrix);
        idx++;
      }
    }
    this.markersInstancedMesh.count = idx;
    this.scene.add(this.markersInstancedMesh);
  }

  private setupCityBlocks(): void {
    for (let i = 0; i < this.numBlocks; i++) {
      const blockGroup = this.createCityBlock();
      blockGroup.position.z = -(i - 1) * this.blockLength;
      this.scene.add(blockGroup);
      this.cityBlocks.push(blockGroup);
    }
  }

  private createCityBlock(): THREE.Group {
    const group = new THREE.Group();
    const halfWidth = this.roadWidth / 2;

    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const swL = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, this.blockLength), sidewalkMat);
    swL.position.set(-halfWidth - 5, 0.25, 0); swL.receiveShadow = true; group.add(swL);
    const swR = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, this.blockLength), sidewalkMat);
    swR.position.set(halfWidth + 5, 0.25, 0); swR.receiveShadow = true; group.add(swR);

    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.5, roughness: 0.3 });
    const bL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, this.blockLength), barrierMat);
    bL.position.set(-halfWidth - 0.25, 0.6, 0); group.add(bL);
    const bR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, this.blockLength), barrierMat);
    bR.position.set(halfWidth + 0.25, 0.6, 0); group.add(bR);

    // Streetlamp VISUAL ONLY — emissive bulb, no PointLight per lamp
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffaa55, emissive: 0xffaa55, emissiveIntensity: 8.0 });

    const lampSpacing = 50;
    for (let z = -this.blockLength / 2 + 15; z < this.blockLength / 2; z += lampSpacing) {
      for (const side of [-1, 1]) {
        const x = side * (halfWidth + 1.5);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 10), poleMat);
        pole.position.set(x, 5, z); group.add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3), bulbMat);
        bulb.position.set(x + side * 1.5, 10.5, z); group.add(bulb);
      }
    }

    // Buildings — shared materials per block, multiple uses
    const bMats = [
      new THREE.MeshStandardMaterial({ color: 0x0a0a0f, metalness: 0.6, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x111115, metalness: 0.4, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x050511, metalness: 0.8, roughness: 0.2 }),
    ];
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x6699cc });
    const neonColors = [0xff0055, 0x00ffff, 0x00ff55, 0xff9900];
    const neonMats = neonColors.map(c =>
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 12.0 })
    );

    for (const side of [-1, 1]) {
      for (let b = 0; b < 3; b++) {
        const w = 22 + Math.random() * 28;
        const h = 40 + Math.random() * 130;
        const d = 28 + Math.random() * 22;

        const bMat = bMats[Math.floor(Math.random() * bMats.length)];
        const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bMat);
        const x = side * (halfWidth + 11 + w / 2 + Math.random() * 4);
        const z = -this.blockLength / 2 + 30 + b * 65 + Math.random() * 10;
        building.position.set(x, h / 2, z);
        building.castShadow = false; // buildings too expensive for shadow casting
        group.add(building);

        // Window strip (emissive — no lights)
        if (Math.random() > 0.3) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1.8, d + 0.4), stripMat);
          strip.position.set(x, h * 0.4, z); group.add(strip);
          const strip2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1.8, d + 0.4), stripMat);
          strip2.position.set(x, h * 0.8, z); group.add(strip2);
        }

        // Neon sign on shorter buildings — emissive only
        if (h < 90 && Math.random() > 0.5) {
          const nMat = neonMats[Math.floor(Math.random() * neonMats.length)];
          const neon = new THREE.Mesh(new THREE.BoxGeometry(1.5, 8, d * 0.7), nMat);
          neon.position.set(x - side * (w / 2 + 0.1), h / 2, z);
          group.add(neon);
        }
      }
    }

    return group;
  }

  public getRoadBounds(): { minZ: number, maxZ: number } {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const seg of this.roadSegments) {
      if (seg.position.z < minZ) minZ = seg.position.z;
      if (seg.position.z > maxZ) maxZ = seg.position.z;
    }
    return { minZ, maxZ };
  }

  public update(playerZ: number): void {
    // Recycle road segments
    for (const seg of this.roadSegments) {
      if (seg.position.z - playerZ > this.segmentLength) {
        seg.position.z -= this.numSegments * this.segmentLength;
      }
    }

    // Slide lane markers
    const containerOffset = Math.floor(playerZ / this.markerSpacing) * this.markerSpacing;
    this.markersInstancedMesh.position.z = containerOffset;

    // Recycle city blocks
    for (const block of this.cityBlocks) {
      if (block.position.z - playerZ > this.blockLength * 2) {
        block.position.z -= this.numBlocks * this.blockLength;
      }
    }

    // Move 2 shared street-lights to flank the player
    this.keyLight1.position.z = playerZ;
    this.keyLight2.position.z = playerZ;

    // Move directional light with player
    this.directionalLight.position.set(50, 100, playerZ + 50);
    this.directionalLight.target.position.set(0, 0, playerZ);
    this.directionalLight.target.updateMatrixWorld();
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.directionalLight.castShadow = enabled;
  }

  public setQuality(quality: 'low' | 'medium' | 'high'): void {
    switch (quality) {
      case 'low':
        this.directionalLight.shadow.mapSize.set(512, 512);
        this.directionalLight.castShadow = false;
        break;
      case 'medium':
        this.directionalLight.shadow.mapSize.set(1024, 1024);
        this.directionalLight.castShadow = true;
        break;
      case 'high':
        this.directionalLight.shadow.mapSize.set(2048, 2048);
        this.directionalLight.castShadow = true;
        break;
    }
    this.directionalLight.shadow.map?.dispose();
    (this.directionalLight.shadow as any).map = null;
  }
}
