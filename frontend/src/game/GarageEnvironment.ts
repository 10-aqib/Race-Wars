import * as THREE from 'three';

export class GarageEnvironment {
  private scene: THREE.Scene;
  public group: THREE.Group;
  public lights: THREE.Light[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    
    // Position garage far away from race track
    this.group.position.set(10000, 0, 10000);
    this.scene.add(this.group);

    this.buildRoom();
    this.buildLighting();
    this.buildProps();
    this.buildSmoke();
  }

  private buildRoom(): void {
    // Floor
    const floorMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1a1c,
      metalness: 0.1,
      roughness: 0.25,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4
    });
    
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a30,
      metalness: 0.2,
      roughness: 0.8
    });

    // Back Wall (with roller door)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 1), wallMat);
    backWall.position.set(0, 6, -10);
    backWall.receiveShadow = true;
    this.group.add(backWall);

    // Roller Door (corrugated metal look)
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.6,
      roughness: 0.5
    });
    
    for(let i=0; i<40; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 0.1), doorMat);
        slat.position.set(0, i * 0.25 + 0.125, -9.4);
        slat.receiveShadow = true;
        this.group.add(slat);
    }
    
    // Door Frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });
    const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 10, 0.5), frameMat);
    frameL.position.set(-8.25, 5, -9.2);
    this.group.add(frameL);
    
    const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 10, 0.5), frameMat);
    frameR.position.set(8.25, 5, -9.2);
    this.group.add(frameR);

    // Left Wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(1, 12, 30), wallMat);
    leftWall.position.set(-15, 6, 0);
    leftWall.receiveShadow = true;
    this.group.add(leftWall);

    // Right Wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(1, 12, 30), wallMat);
    rightWall.position.set(15, 6, 0);
    rightWall.receiveShadow = true;
    this.group.add(rightWall);

    // Front Wall
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 1), wallMat);
    frontWall.position.set(0, 6, 15);
    frontWall.receiveShadow = true;
    this.group.add(frontWall);

    // Ceiling
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 30), wallMat);
    ceiling.position.set(0, 12.5, 0);
    ceiling.receiveShadow = true;
    this.group.add(ceiling);
    
    // Safety markings (yellow/black stripes on floor near door)
    const safetyMat = new THREE.MeshStandardMaterial({ color: 0xddaa00, roughness: 0.9 });
    const safetyLine = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.3), safetyMat);
    safetyLine.rotation.x = -Math.PI / 2;
    safetyLine.position.set(0, 0.01, -8);
    this.group.add(safetyLine);
  }

  private buildLighting(): void {
    // Strong ambient so garage is never pitch black regardless of physical lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.group.add(ambient);
    this.lights.push(ambient);

    // Hemisphere fill
    const hemi = new THREE.HemisphereLight(0xb7c9ed, 0x292421, 0.8);
    this.group.add(hemi);
    this.lights.push(hemi);

    // Overhead Fluorescent RectAreaLights
    const overheadColor = 0xeef5ff;
    
    const fixtures = [
      { x: -5, z: -3 }, { x: 5, z: -3 },
      { x: -5, z: 3 },  { x: 5, z: 3 }
    ];

    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: overheadColor, emissiveIntensity: 2.0 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.5, roughness: 0.5 });

    fixtures.forEach(pos => {
      // Housing
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 4), housingMat);
      housing.position.set(pos.x, 12, pos.z);
      this.group.add(housing);

      // Tube
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.8, 8), tubeMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(pos.x, 11.8, pos.z);
      this.group.add(tube);

      // Light source
      const light = new THREE.PointLight(overheadColor, 100, 20, 2);
      light.position.set(pos.x, 11.5, pos.z);
      light.castShadow = false;
      light.shadow.bias = -0.001;
      light.shadow.mapSize.width = 1024;
      light.shadow.mapSize.height = 1024;
      this.group.add(light);
      this.lights.push(light);
    });

    // Front softbox (key light for car)
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(-6, 5, -8); // from front-left
    keyLight.target.position.set(0, 0, 0);
    keyLight.castShadow = true;
    keyLight.shadow.bias = -0.001;
    this.group.add(keyLight);
    this.group.add(keyLight.target);
    this.lights.push(keyLight);
    
    // Red accent rim lights (to match Race Wars theme)
    const redRimL = new THREE.PointLight(0xff0000, 400, 15);
    redRimL.position.set(-6, 1, 4);
    this.group.add(redRimL);
    
    const redRimR = new THREE.PointLight(0xff0000, 400, 15);
    redRimR.position.set(6, 1, 4);
    this.group.add(redRimR);
  }

  private buildProps(): void {
    // Tool cabinets
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xaa1111, metalness: 0.3, roughness: 0.6 });
    const cab1 = new THREE.Mesh(new THREE.BoxGeometry(2, 2.5, 1.5), cabMat);
    cab1.position.set(-12, 1.25, -6);
    cab1.castShadow = true;
    this.group.add(cab1);
    
    // Drawers detail
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for(let i=0; i<4; i++) {
        const drawer = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 1.55), darkMat);
        drawer.position.set(-12, 0.5 + i*0.5, -6);
        this.group.add(drawer);
    }

    // Shelves
    const shelfFrameMat = new THREE.MeshStandardMaterial({ color: 0x333, metalness: 0.8, roughness: 0.5 });
    const shelfWoodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    
    const shelfGroup = new THREE.Group();
    for(let i=0; i<4; i++) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 1.5), shelfWoodMat);
        board.position.set(0, 1 + i*1.2, 0);
        board.castShadow = true;
        shelfGroup.add(board);
    }
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 5, 0.1), shelfFrameMat);
    leg1.position.set(-1.9, 2.5, 0.6);
    shelfGroup.add(leg1);
    const leg2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 5, 0.1), shelfFrameMat);
    leg2.position.set(1.9, 2.5, 0.6);
    shelfGroup.add(leg2);
    
    shelfGroup.position.set(12, 0, -5);
    this.group.add(shelfGroup);
    
    // Pipes on the wall
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.9, roughness: 0.2 });
    const pipe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 30, 8), pipeMat);
    pipe1.rotation.x = Math.PI / 2;
    pipe1.position.set(-14.5, 4, 0);
    this.group.add(pipe1);
    
    const pipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 30, 8), pipeMat);
    pipe2.rotation.x = Math.PI / 2;
    pipe2.position.set(-14.5, 4.3, 0);
    this.group.add(pipe2);
  }

  private buildSmoke(): void {
    // Abstract smoke using particle planes with low opacity
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.03,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    
    const smokeGeom = new THREE.PlaneGeometry(8, 8);
    for(let i=0; i<10; i++) {
        const p = new THREE.Mesh(smokeGeom, smokeMat);
        p.position.set((Math.random() - 0.5) * 8, 1 + Math.random() * 2, 2 + Math.random() * 4);
        p.rotation.z = Math.random() * Math.PI * 2;
        
        // Simple animation data
        p.userData = {
            rotSpeed: (Math.random() - 0.5) * 0.002,
            floatSpeed: 0.002 + Math.random() * 0.002
        };
        
        this.group.add(p);
    }
  }

  public update(_delta: number): void {
      // Animate smoke
      this.group.children.forEach(child => {
          if (child.userData.rotSpeed) {
              child.rotation.z += child.userData.rotSpeed;
              child.position.y += child.userData.floatSpeed;
              if (child.position.y > 5) child.position.y = 0;
          }
      });
  }
}
