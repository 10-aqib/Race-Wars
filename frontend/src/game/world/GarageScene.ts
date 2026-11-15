import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { concreteTexture, concreteRoughness, shutterTexture, hazardTexture, wallPanelTexture, smokeTexture, glowTexture, bannerTexture } from '../render/Textures';
import { ParticleSystem } from '../render/Particles';
import { CarView } from '../render/CarView';

/**
 * Race Wars — industrial garage used by the intro, main menu, lobby and car
 * selection. Cars are real CarView instances; camera framing is defined as
 * shots per screen and blended smoothly.
 */

export type GarageMode = 'intro' | 'home' | 'lobby' | 'select' | 'profile' | 'settings';

interface Shot { pos: THREE.Vector3; target: THREE.Vector3; fov: number; }

const HERO_HEADING = Math.PI - 0.62;
const shot = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 40): Shot =>
  ({ pos: new THREE.Vector3(px, py, pz), target: new THREE.Vector3(tx, ty, tz), fov });

const SHOTS: Record<Exclude<GarageMode, 'intro'>, Shot> = {
  home: shot(-2.3, 1.15, 7.0, -1.25, 0.72, 0, 38),
  lobby: shot(0, 2.6, 12.5, 0, 0.8, -0.6, 42),
  select: shot(0, 1.9, 8.2, 0, 0.75, 0, 38),
  profile: shot(4.6, 1.6, 6.8, 0.4, 0.8, 0, 40),
  settings: shot(-5.5, 2.2, 6.5, 0, 0.8, -1, 44),
};

export class GarageScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  hero: CarView | null = null;
  readonly rivals: CarView[] = [];
  mode: GarageMode = 'home';
  /** Car-select orbit controlled by the user (drag / wheel / buttons). */
  orbitYaw = 0;
  orbitZoom = 1;
  private platform: THREE.Group;
  private platformRing: THREE.MeshStandardMaterial;
  private haze: ParticleSystem;
  private burst: ParticleSystem;
  private time = 0;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camFov = 40;
  private snap = true;
  private reflector: Reflector | null = null;
  private floor: THREE.Mesh;
  private heroSpin = 0;
  introTime = 0;

  constructor(aspect: number) {
    RectAreaLightUniformsLib.init();
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.05, 200);
    const scene = this.scene;
    scene.background = new THREE.Color(0x050506);
    scene.fog = new THREE.Fog(0x050506, 18, 46);

    this.floor = this.buildRoom();
    this.buildLights();
    this.buildProps();
    this.platform = new THREE.Group();
    this.platformRing = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.4 });
    this.buildPlatform();

    this.haze = new ParticleSystem({ max: 90, texture: smokeTexture(), color: 0x9aa0aa, drag: 0.2, grow: 0.12, fade: 1.4 });
    this.burst = new ParticleSystem({ max: 160, texture: smokeTexture(), color: 0xc8c8cc, drag: 1.4, grow: 0.9, fade: 1.6 });
    scene.add(this.haze.mesh, this.burst.mesh);
    for (let i = 0; i < 40; i++) this.emitHaze(Math.random() * 10);
  }

  // ── Construction ───────────────────────────────────────────────────────────

  private buildRoom(): THREE.Mesh {
    const scene = this.scene;
    const tex = concreteTexture().clone(); tex.needsUpdate = true; tex.repeat.set(5, 5);
    const rough = concreteRoughness().clone(); rough.needsUpdate = true; rough.repeat.set(4, 4);
    const floorMat = new THREE.MeshStandardMaterial({ map: tex, roughnessMap: rough, roughness: 0.9, metalness: 0.05, color: 0x8a8a8e, transparent: true, opacity: 0.93 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; floor.receiveShadow = true;
    scene.add(floor);

    const wallTex = wallPanelTexture().clone(); wallTex.needsUpdate = true; wallTex.repeat.set(6, 1.5);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.2, color: 0x9a9aa0 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), wallMat); back.position.set(0, 6, -11); scene.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), wallMat); left.rotation.y = Math.PI / 2; left.position.set(-16, 6, 3); scene.add(left);
    const right = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), wallMat); right.rotation.y = -Math.PI / 2; right.position.set(16, 6, 3); scene.add(right);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 9, 3); scene.add(ceil);

    // Roller shutter door
    const sTex = shutterTexture().clone(); sTex.needsUpdate = true; sTex.repeat.set(1, 6);
    const shutter = new THREE.Mesh(new THREE.PlaneGeometry(10, 6.5), new THREE.MeshStandardMaterial({ map: sTex, metalness: 0.65, roughness: 0.45, color: 0xbfc2c8 }));
    shutter.position.set(0, 3.25, -10.95); scene.add(shutter);
    const steel = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, metalness: 0.8, roughness: 0.4 });
    for (const x of [-5.25, 5.25]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel); f.position.set(x, 3.5, -10.8); scene.add(f); }
    const header = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 0.6), steel); header.position.set(0, 6.85, -10.8); scene.add(header);
    // Structural columns and beams
    for (const x of [-11, 11]) for (const z of [-10.4, 1, 12]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.45, 9, 0.45), steel); c.position.set(x, 4.5, z); c.castShadow = true; scene.add(c);
    }
    for (const z of [-6, 0, 6]) { const b = new THREE.Mesh(new THREE.BoxGeometry(32, 0.5, 0.3), steel); b.position.set(0, 8.6, z); scene.add(b); }
    // Hazard floor line and painted bay lines
    const hz = hazardTexture().clone(); hz.needsUpdate = true; hz.repeat.set(16, 0.5);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.35), new THREE.MeshStandardMaterial({ map: hz, roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.006, -9.2); scene.add(line);
    const paint = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 0.8, transparent: true, opacity: 0.35 });
    for (const x of [-7.6, -2.6, 2.6, 7.6]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 9), paint); l.rotation.x = -Math.PI / 2; l.position.set(x, 0.006, -1.5); scene.add(l); }
    // Wall logo
    const logo = bannerTexture('garage-logo', [{ text: 'RACE  WARS', color: '#d11a1a', font: 'italic 800 150px "Barlow Condensed", Impact, sans-serif', y: 130 }], 'rgba(0,0,0,0)', 1024, 256);
    const logoMesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshStandardMaterial({ map: logo, transparent: true, emissiveMap: logo, emissive: 0xffffff, emissiveIntensity: 0.6 }));
    logoMesh.position.set(-15.95, 5.2, -2); logoMesh.rotation.y = Math.PI / 2; scene.add(logoMesh);
    return floor;
  }

  private buildLights(): void {
    const scene = this.scene;
    scene.add(new THREE.HemisphereLight(0x8a96b0, 0x141210, 0.35));
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeef4ff, emissiveIntensity: 3.2 });
    const housing = new THREE.MeshStandardMaterial({ color: 0x18181a, metalness: 0.6, roughness: 0.5 });
    for (const [x, z] of [[-4.5, -5], [4.5, -5], [-4.5, 1.5], [4.5, 1.5], [0, -1.8], [-9, 6], [9, 6], [0, 7]] as [number, number][]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 3.4), housing); h.position.set(x, 7.6, z); scene.add(h);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 3.2), tubeMat); tube.position.set(x, 7.52, z); scene.add(tube);
      const rect = new THREE.RectAreaLight(0xeef4ff, 6, 0.4, 3.2);
      rect.position.set(x, 7.45, z); rect.lookAt(x, 0, z); scene.add(rect);
    }
    // Key light with soft shadow for grounding the cars
    const key = new THREE.SpotLight(0xffffff, 260, 30, 0.55, 0.6, 1.5);
    key.position.set(2.5, 7.2, 3.5); key.target.position.set(0, 0, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.radius = 4;
    scene.add(key, key.target);
    // Cool rim from the door, warm/red accents
    const rim = new THREE.SpotLight(0x8fb0ff, 160, 30, 0.6, 0.8, 1.5); rim.position.set(-1, 4, -9); rim.target.position.set(0, 0.6, 0); scene.add(rim, rim.target);
    const red = new THREE.PointLight(0xff1a1a, 18, 12, 1.6); red.position.set(-7, 1.2, -6); scene.add(red);
    const red2 = new THREE.PointLight(0xff2a1a, 14, 12, 1.6); red2.position.set(8, 1.5, -7); scene.add(red2);
    const fill = new THREE.PointLight(0xc8d6ff, 10, 16, 1.6); fill.position.set(-4, 2.2, 7); scene.add(fill);
    // Wash on the back wall and shutter so the room reads behind the car
    const wash = new THREE.SpotLight(0xdfe6f5, 120, 26, 0.75, 0.9, 1.4); wash.position.set(0, 7.5, -3); wash.target.position.set(0, 2.5, -11); scene.add(wash, wash.target);
    for (const x of [-9, 9]) { const w = new THREE.SpotLight(0xffe2c0, 50, 18, 0.7, 0.9, 1.5); w.position.set(x, 7, -6); w.target.position.set(x * 1.2, 1, -10.5); scene.add(w, w.target); }
  }

  private buildProps(): void {
    const scene = this.scene;
    const red = new THREE.MeshStandardMaterial({ color: 0x8a0f12, metalness: 0.5, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.4, roughness: 0.5 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 1, roughness: 0.25 });
    // Tool chests
    for (const [x, z, w] of [[-12.5, -8.6, 2.4], [-9.6, -9.8, 1.6], [12.6, -7.8, 2.2]] as [number, number, number][]) {
      const chest = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, 0.9), red); chest.position.set(x, 0.8, z); chest.castShadow = true; scene.add(chest);
      for (let i = 0; i < 5; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.02, 0.02), chrome); d.position.set(x, 0.3 + i * 0.27, z + 0.46); scene.add(d); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.7), red); top.position.set(x, 2.3, z - 0.1); scene.add(top);
    }
    // Workbench with tools
    const bench = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 1.2), dark); bench.position.set(12.4, 1, -3.5); bench.rotation.y = Math.PI / 2; scene.add(bench);
    for (const dz of [-1.8, 1.8]) for (const dx of [-0.5, 0.5]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), dark); l.position.set(12.4 + dx, 0.5, -3.5 + dz); scene.add(l); }
    // Tyre stacks
    const tyreGeo = new THREE.TorusGeometry(0.36, 0.17, 10, 20).rotateX(Math.PI / 2);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.9 });
    for (const [x, z, n] of [[-13, -2, 4], [-13.2, -3.2, 3], [13.4, 2, 5], [9.5, -9.6, 4]] as [number, number, number][]) {
      for (let i = 0; i < n; i++) { const t = new THREE.Mesh(tyreGeo, tyreMat); t.position.set(x, 0.17 + i * 0.34, z); t.castShadow = true; scene.add(t); }
    }
    // Hazard-striped bollards near the door
    const hzMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6 });
    for (const x of [-6.2, 6.2]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 14), hzMat); b.position.set(x, 0.6, -9.6); b.castShadow = true; scene.add(b); }
    for (const x of [-11, 11]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), hzMat); c.position.set(x, 0.8, 1); scene.add(c); }
    // Oil drums
    const drumMat = new THREE.MeshStandardMaterial({ color: 0x1f3a6a, metalness: 0.5, roughness: 0.5 });
    for (const [x, z] of [[-14.6, 4], [-14, 5], [14.5, -9.6]] as [number, number][]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.95, 16), drumMat); d.position.set(x, 0.48, z); d.castShadow = true; scene.add(d); }
    // Shelving with boxes
    const shelf = new THREE.Group();
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.8), dark); b.position.y = 0.4 + i * 1.1; shelf.add(b); }
    for (const x of [-1.55, 1.55]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.2, 0.8), dark); p.position.set(x, 2.1, 0); shelf.add(p); }
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
    for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.5 + (i % 3) * 0.15, 0.5, 0.5), boxMat); b.position.set(-1.1 + (i % 4) * 0.7, 0.68 + Math.floor(i / 4) * 1.1, 0); shelf.add(b); }
    shelf.position.set(15.4, 0, 6); shelf.rotation.y = -Math.PI / 2; scene.add(shelf);
    const shelf2 = shelf.clone(); shelf2.position.set(-15.4, 0, 8); shelf2.rotation.y = Math.PI / 2; scene.add(shelf2);
    // Pipes along the walls
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.9, roughness: 0.3 });
    for (const y of [6.2, 6.5]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 30, 8).rotateX(Math.PI / 2), pipeMat); p.position.set(-15.8, y, 3); scene.add(p); }
  }

  private buildPlatform(): void {
    const g = this.platform;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.45, 0.22, 64), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.75, roughness: 0.28 }));
    top.position.y = 0.11; top.receiveShadow = true; g.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.38, 0.035, 8, 96).rotateX(Math.PI / 2), this.platformRing);
    ring.position.y = 0.2; g.add(ring);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.015, 6, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 2 }));
    inner.position.y = 0.225; g.add(inner);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xdfe6ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 0.01; g.add(glow);
    const spot = new THREE.SpotLight(0xffffff, 220, 20, 0.5, 0.5, 1.5);
    spot.position.set(0, 8, 0.5); spot.target.position.set(0, 0, 0); g.add(spot, spot.target);
    g.visible = false;
    this.scene.add(g);
  }

  setReflections(enabled: boolean): void {
    if (enabled && !this.reflector) {
      this.reflector = new Reflector(new THREE.PlaneGeometry(40, 40), {
        textureWidth: 1024, textureHeight: 1024, color: 0x6d6d72, clipBias: 0.003,
      });
      this.reflector.rotation.x = -Math.PI / 2;
      this.scene.add(this.reflector);
    }
    if (this.reflector) this.reflector.visible = enabled;
    (this.floor.material as THREE.MeshStandardMaterial).opacity = enabled ? 0.9 : 1;
  }

  // ── Cars ───────────────────────────────────────────────────────────────────

  setHero(view: CarView): void {
    if (this.hero) this.hero.dispose();
    this.hero = view;
    this.scene.add(view.group);
    view.ready.then(() => view.setLights(true, 0.8));
    this.layout();
  }

  setRivals(views: CarView[]): void {
    this.rivals.forEach(r => r.dispose());
    this.rivals.length = 0;
    for (const v of views) { this.rivals.push(v); this.scene.add(v.group); v.ready.then(() => v.setLights(true, 0.8)); }
    this.layout();
  }

  setMode(mode: GarageMode, snap = false): void {
    this.mode = mode;
    if (snap) this.snap = true;
    if (mode === 'select') { this.orbitYaw = 0; this.orbitZoom = 1; }
    if (mode === 'intro') this.introTime = 0;
    this.layout();
  }

  private layout(): void {
    const lobby = this.mode === 'lobby';
    const select = this.mode === 'select';
    this.platform.visible = select;
    if (this.hero) {
      if (lobby) this.hero.setPose(0, 0.6, Math.PI);
      else if (select) this.hero.setPose(0, 0, Math.PI - 0.5 + this.heroSpin, 0.22);
      else this.hero.setPose(0, 0, HERO_HEADING);
    }
    const slots: [number, number, number][] = [[-4.6, -0.4, Math.PI + 0.22], [4.6, -0.4, Math.PI - 0.22]];
    this.rivals.forEach((r, i) => {
      r.group.visible = lobby;
      const [x, z, h] = slots[i % slots.length];
      r.setPose(x, z, h);
    });
  }

  private emitHaze(age = 0): void {
    const x = (Math.random() - 0.5) * 22, z = -8 + Math.random() * 14;
    this.haze.emit(x, 0.15 + Math.random() * 0.4, z, (Math.random() - 0.5) * 0.15, 0.02, (Math.random() - 0.3) * 0.1, 2 + Math.random() * 2.5, 0.06, 9 + age);
  }

  /** Burnout smoke from the hero's rear wheels (intro). */
  smokeBurst(): void {
    if (!this.hero) return;
    const g = this.hero.group;
    const back = new THREE.Vector3(0, 0, 1.6).applyQuaternion(g.quaternion);
    for (let i = 0; i < 60; i++) {
      const side = i % 2 ? 1 : -1;
      const lat = new THREE.Vector3(side * 0.85, 0, 0).applyQuaternion(g.quaternion);
      this.burst.emit(g.position.x + back.x + lat.x, 0.3, g.position.z + back.z + lat.z,
        back.x * 2 + (Math.random() - 0.5) * 2.5, 0.4 + Math.random() * 0.8, back.z * 2 + (Math.random() - 0.5) * 2.5,
        1 + Math.random(), 0.32, 2.5 + Math.random() * 2);
    }
  }

  /** Drag/zoom input for the car-select turntable. */
  rotateSelected(delta: number): void { this.heroSpin += delta; this.layout(); }
  zoom(delta: number): void { this.orbitZoom = THREE.MathUtils.clamp(this.orbitZoom + delta, 0.65, 1.35); }

  update(dt: number): void {
    this.time += dt;
    if (this.mode === 'intro' && this.hero) {
      const prev = this.introTime;
      this.introTime += dt;
      const crossed = (t: number) => prev < t && this.introTime >= t;
      if (prev === 0) this.hero.setLights(false);
      if (crossed(1.75)) this.hero.setLights(true, 0.8);
      if (crossed(4.0)) { this.smokeBurst(); this.hero.flamePop(true); }
      if (crossed(4.4)) this.hero.flamePop(false);
    }
    if (Math.random() < dt * 2.5) this.emitHaze();
    this.haze.update(dt);
    this.burst.update(dt);
    this.platformRing.emissiveIntensity = 2 + Math.sin(this.time * 2) * 0.5;
    if (this.mode === 'select') { this.heroSpin += dt * 0.25; this.layout(); }
    if (this.mode !== 'intro' || this.introTime < 4 || this.introTime > 4.4) this.hero?.idle(dt);
    this.rivals.forEach(r => r.idle(dt));

    let target: Shot;
    if (this.mode === 'intro') target = this.introShot(this.introTime);
    else {
      const base = SHOTS[this.mode];
      if (this.mode === 'select') {
        const dir = base.pos.clone().sub(base.target).multiplyScalar(this.orbitZoom);
        target = { pos: base.target.clone().add(dir), target: base.target, fov: base.fov };
      } else {
        const drift = new THREE.Vector3(Math.sin(this.time * 0.18) * 0.25, Math.sin(this.time * 0.13) * 0.06, 0);
        target = { pos: base.pos.clone().add(drift), target: base.target, fov: base.fov };
      }
    }
    if (this.snap || this.mode === 'intro') {
      this.camPos.copy(target.pos); this.camTarget.copy(target.target); this.camFov = target.fov; this.snap = false;
    } else {
      const k = 1 - Math.exp(-dt * 2.6);
      this.camPos.lerp(target.pos, k); this.camTarget.lerp(target.target, k); this.camFov += (target.fov - this.camFov) * k;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    if (Math.abs(this.camera.fov - this.camFov) > 0.01) { this.camera.fov = this.camFov; this.camera.updateProjectionMatrix(); }
  }

  /** Scripted intro camera: wheel → headlight → body sweep → wide reveal. */
  private introShot(t: number): Shot {
    const h = HERO_HEADING;
    const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), h);
    if (t < 1.5) {
      const k = t / 1.5;
      return { pos: toWorld(-1.75 - k * 0.2, 0.42, -1.0 + k * 0.6), target: toWorld(-0.9, 0.36, -1.45), fov: 30 };
    }
    if (t < 2.8) {
      const k = (t - 1.5) / 1.3;
      return { pos: toWorld(-1.2 + k * 0.5, 0.82, -3.1), target: toWorld(-0.62, 0.7, -2.1), fov: 28 };
    }
    if (t < 3.9) {
      const k = (t - 2.8) / 1.1;
      return { pos: toWorld(-2.6, 0.55, 1.8 - k * 3.6), target: toWorld(0, 0.6, 0.6 - k * 2.4), fov: 34 };
    }
    const k = Math.min(1, (t - 3.9) / 1.8);
    const e = 1 - Math.pow(1 - k, 3);
    const from = toWorld(-1.4, 0.7, -5.2), to = SHOTS.home.pos;
    return { pos: from.lerp(to, e), target: toWorld(0, 0.6, -0.5).lerp(SHOTS.home.target, e), fov: 36 + e * 2 };
  }

  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
