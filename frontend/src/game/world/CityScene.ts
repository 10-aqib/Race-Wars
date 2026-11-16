import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Track, BARRIER_OFFSET } from '../track/Track';
import {
  roadTextures, ROAD_TEX_WIDTH, ROAD_TEX_LENGTH, skylineTexture, skyTexture,
  glowTexture, concreteTexture, checkerTexture, bannerTexture,
} from '../render/Textures';
import { mulberry32 } from '../ai/AIController';
import { buildBuildings, FACADE_STYLES, type BuildingSpec } from './Buildings';

/**
 * Race Wars — night metropolitan circuit. Every object is placed from the
 * shared Track samples, so visuals, collisions and AI agree exactly.
 * Draw calls are kept low with merged and instanced geometry.
 */

export type Quality = 'low' | 'medium' | 'high';

const LAMP_SPACING = 46;
const LAMP_D = 13.2;
const DYNAMIC_LIGHTS = 6;

export class CityScene {
  readonly scene = new THREE.Scene();
  readonly track: Track;
  readonly moon: THREE.DirectionalLight;
  private lampHeads: THREE.Vector3[] = [];
  private dynLights: THREE.PointLight[] = [];
  private skyline: THREE.Mesh;
  private lightCones: THREE.InstancedMesh | null = null;
  private sky: THREE.Mesh;

  constructor(track: Track) {
    this.track = track;
    const scene = this.scene;
    scene.background = new THREE.Color(0x03050a);
    scene.fog = new THREE.FogExp2(0x070a13, 0.0019);

    scene.add(new THREE.AmbientLight(0x2a3550, 0.6));
    scene.add(new THREE.HemisphereLight(0x23314f, 0x0b0b0c, 0.7));
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0.55);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    const sc = this.moon.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
    this.moon.shadow.bias = -0.0005;
    scene.add(this.moon, this.moon.target);

    for (let i = 0; i < DYNAMIC_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffb36b, 70, 38, 1.6);
      scene.add(l); this.dynLights.push(l);
    }

    this.sky = this.buildSky();
    this.skyline = this.buildSkyline();
    this.buildGround();
    this.buildRoad();
    this.buildBarriersAndSidewalks();
    this.buildStreetlights();
    this.buildBuildings();
    this.buildStartGantry();
    this.buildChevrons();
  }

  // ── Sky and horizon ─────────────────────────────────────────────────────────

  private buildSky(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 24, 12), mat);
    sky.renderOrder = -10;
    this.scene.add(sky);
    return sky;
  }

  private buildSkyline(): THREE.Mesh {
    const tex = skylineTexture();
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(3, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2200, 2200, 420, 48, 1, true), mat);
    m.position.y = 150;
    m.renderOrder = -9;
    this.scene.add(m);
    return m;
  }

  private buildGround(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.95 });
    const g = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mat);
    g.rotation.x = -Math.PI / 2; g.position.y = -0.05; g.receiveShadow = true;
    this.scene.add(g);
  }

  // ── Road ────────────────────────────────────────────────────────────────────

  /** Ribbon along the centreline between lateral offsets d0..d1 at height y. */
  private ribbon(d0: number, d1: number, y0: number, y1: number, uScale: number, vScale: number, step = 1): THREE.BufferGeometry {
    const t = this.track;
    const n = Math.ceil(t.count / step);
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const p = { x: 0, z: 0 };
    for (let k = 0; k <= n; k++) {
      const s = Math.min(k * step, t.count) * t.step;
      t.pointAt(s, d0, p); pos.push(p.x, y0, p.z);
      t.pointAt(s, d1, p); pos.push(p.x, y1, p.z);
      const v = s / vScale;
      uv.push(0, v, uScale, v);
      if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  private buildRoad(): void {
    const { map, rough } = roadTextures();
    const half = ROAD_TEX_WIDTH / 2;
    const geo = this.ribbon(-half, half, 0, 0, 1, ROAD_TEX_LENGTH);
    // Normals must point up regardless of winding
    const nrm = geo.getAttribute('normal');
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const mat = new THREE.MeshStandardMaterial({
      map, roughnessMap: rough, roughness: 0.78, metalness: 0.1, envMapIntensity: 0.95, color: 0xaeb3bb,
    });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    road.name = 'road';
    this.scene.add(road);
  }

  private buildBarriersAndSidewalks(): void {
    const concrete = concreteTexture();
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x8d8c88, map: concrete, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide });
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const o = BARRIER_OFFSET;
      // Jersey profile: inner slope, upper face, top, outer face
      const faces: [number, number, number, number][] = [
        [o, o + 0.18, 0, 0.32], [o + 0.18, o + 0.32, 0.32, 0.92], [o + 0.32, o + 0.55, 0.92, 0.92], [o + 0.55, o + 0.7, 0.92, 0],
      ];
      for (const [a, b, ya, yb] of faces) {
        const g = side > 0 ? this.ribbon(a, b, ya, yb, 1, 6, 2) : this.ribbon(-b, -a, yb, ya, 1, 6, 2);
        parts.push(g);
      }
    }
    const barrier = new THREE.Mesh(mergeGeometries(parts), barrierMat);
    barrier.castShadow = false; barrier.receiveShadow = true;
    this.scene.add(barrier);

    // Reflector band on the inner face
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc46a, emissiveIntensity: 0.55, roughness: 0.5, side: THREE.DoubleSide });
    const bands: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const o = BARRIER_OFFSET + 0.2;
      bands.push(side > 0 ? this.ribbon(o - 0.01, o + 0.005, 0.55, 0.62, 1, 6, 2) : this.ribbon(-o - 0.005, -o + 0.01, 0.62, 0.55, 1, 6, 2));
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(bands), bandMat));

    // Sidewalks beyond the barriers
    concrete.repeat.set(1, 1);
    const swMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3f, map: concrete, roughness: 0.9 });
    const sw = mergeGeometries([this.ribbon(BARRIER_OFFSET + 0.7, 19, 0.15, 0.15, 2, 8, 2), this.ribbon(-19, -(BARRIER_OFFSET + 0.7), 0.15, 0.15, 2, 8, 2)]);
    const nrm = sw.getAttribute('normal');
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const sidewalk = new THREE.Mesh(sw, swMat);
    sidewalk.receiveShadow = true;
    this.scene.add(sidewalk);
  }

  // ── Streetlights ────────────────────────────────────────────────────────────

  private buildStreetlights(): void {
    const t = this.track;
    const count = Math.floor(t.length / LAMP_SPACING);
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 10, 8).translate(0, 5, 0);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 3.2).translate(0, 9.9, -1.5);
    const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1.1).translate(0, 9.78, -2.9);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.7, roughness: 0.45 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc27a, emissiveIntensity: 4 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, count * 2);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, count * 2);
    const heads = new THREE.InstancedMesh(headGeo, headMat, count * 2);
    const poolGeo = new THREE.PlaneGeometry(10, 16).rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffa860, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, count * 2);
    pools.renderOrder = 1;
    const halo: number[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const p = { x: 0, z: 0 };
    let k = 0;
    for (let i = 0; i < count; i++) {
      const s = i * LAMP_SPACING + (i % 2) * 6;
      const h = t.headingAt(s);
      for (const side of [-1, 1]) {
        t.pointAt(s, side * LAMP_D, p);
        // Arm points toward the road: local -Z rotated to face across the track
        q.setFromAxisAngle(up, h + (side > 0 ? Math.PI / 2 : -Math.PI / 2));
        m.compose(new THREE.Vector3(p.x, 0, p.z), q, one);
        poles.setMatrixAt(k, m); arms.setMatrixAt(k, m); heads.setMatrixAt(k, m);
        const head = t.pointAt(s, side * (LAMP_D - 2.9), { x: 0, z: 0 });
        this.lampHeads.push(new THREE.Vector3(head.x, 9.5, head.z));
        halo.push(head.x, 9.6, head.z);
        const pool = t.pointAt(s, side * 6.5, { x: 0, z: 0 });
        q.setFromAxisAngle(up, h);
        m.compose(new THREE.Vector3(pool.x, 0.02, pool.z), q, one);
        pools.setMatrixAt(k, m);
        k++;
      }
    }
    poles.castShadow = false;
    this.scene.add(poles, arms, heads, pools);
    // Volumetric light cones and wet-road reflection streaks under each lamp
    const coneGeo = new THREE.ConeGeometry(4.2, 9.4, 16, 1, true).translate(0, -4.7, 0);
    const coneMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xffb46a) } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0); vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 color; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float h = clamp(1.0 + vY / 9.4, 0.0, 1.0); float rim = pow(1.0 - abs(dot(vN, vV)), 1.5); gl_FragColor = vec4(color, 0.035 * h * h * (0.35 + rim)); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, this.lampHeads.length);
    const streakGeo = new THREE.PlaneGeometry(0.9, 18).rotateX(-Math.PI / 2);
    const streakMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffa14a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const streaks = new THREE.InstancedMesh(streakGeo, streakMat, this.lampHeads.length);
    streaks.renderOrder = 1;
    this.lampHeads.forEach((v, i) => {
      m.compose(new THREE.Vector3(v.x, 9.5, v.z), new THREE.Quaternion(), one);
      cones.setMatrixAt(i, m);
      const tp = t.project(v.x, v.z, -1);
      const base = t.pointAt(tp.s - 6, tp.d * 0.92);
      q.setFromAxisAngle(up, t.headingAt(tp.s));
      m.compose(new THREE.Vector3(base.x, 0.03, base.z), q, one);
      streaks.setMatrixAt(i, m);
    });
    cones.frustumCulled = false;
    this.scene.add(cones, streaks);
    this.lightCones = cones;
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(halo, 3));
    const haloMat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xffb070, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.scene.add(new THREE.Points(haloGeo, haloMat));
  }

  // ── Buildings ───────────────────────────────────────────────────────────────

  private buildBuildings(): void {
    const t = this.track;
    const rnd = mulberry32(2024);
    const specs: BuildingSpec[] = [];
    const neon: THREE.BufferGeometry[][] = [[], [], []];
    const placed: { x: number; z: number; r: number }[] = [];
    const clearOfTrack = (x: number, z: number, r: number) => {
      for (let i = 0; i < t.count; i += 3) {
        const dx = x - t.px[i], dz = z - t.pz[i];
        if (dx * dx + dz * dz < (r + 19) ** 2) return false;
      }
      return placed.every(b => (b.x - x) ** 2 + (b.z - z) ** 2 > (b.r + r) ** 2 * 0.55);
    };
    const p = { x: 0, z: 0 };
    for (const side of [-1, 1]) {
      for (let row = 0; row < 2; row++) {
        let s = rnd() * 20;
        while (s < t.length) {
          const along = 20 + rnd() * 28, depth = 16 + rnd() * 22;
          const tall = row === 1 ? 70 + rnd() * 150 : 20 + rnd() * 75;
          const dist = 21 + depth / 2 + rnd() * 3 + row * 46;
          t.pointAt(s + along / 2, side * dist, p);
          const r = Math.hypot(along, depth) / 2;
          if (clearOfTrack(p.x, p.z, r * 0.8)) {
            placed.push({ x: p.x, z: p.z, r });
            const style = FACADE_STYLES[Math.floor(rnd() * FACADE_STYLES.length)];
            specs.push({ x: p.x, z: p.z, heading: t.headingAt(s + along / 2), w: depth, d: along, h: tall, style, seed: Math.floor(rnd() * 1e9) });
            if (row === 0 && rnd() < 0.4) {
              const sign = new THREE.BoxGeometry(0.4, 2.4, along * 0.55);
              const facing = t.pointAt(s + along / 2, side * (dist - depth / 2 - 0.4), { x: 0, z: 0 });
              sign.rotateY(t.headingAt(s + along / 2));
              sign.translate(facing.x, 11 + rnd() * Math.max(2, tall - 18), facing.z);
              neon[Math.floor(rnd() * 3)].push(sign);
            }
          }
          s += along + 3 + rnd() * 14;
        }
      }
    }
    const city = buildBuildings(specs);
    this.scene.add(city);
    const neonColors = [0xff2340, 0x22d3ff, 0xff9a1f];
    neon.forEach((list, i) => {
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: neonColors[i], emissiveIntensity: 3 });
      this.scene.add(new THREE.Mesh(mergeGeometries(list), mat));
    });
    const beacons = (city.userData as { beacons: number[] }).beacons;
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
    this.scene.add(new THREE.Points(bGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xff2020, size: 6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.buildTrees(placed);
  }

  /** Street trees on the sidewalks between lamp posts (instanced). */
  private buildTrees(buildings: { x: number; z: number; r: number }[]): void {
    const t = this.track;
    const rnd = mulberry32(55);
    const spots: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (let s = 23; s < t.length; s += 23) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.2) continue;
        const p = t.pointAt(s, side * 16.5);
        let ok = true;
        for (let i = 0; i < t.count && ok; i += 4) if ((p.x - t.px[i]) ** 2 + (p.z - t.pz[i]) ** 2 < 14 * 14) ok = false;
        if (!ok || buildings.some(b => (b.x - p.x) ** 2 + (b.z - p.z) ** 2 < (b.r * 0.6) ** 2)) continue;
        const sc = 0.8 + rnd() * 0.45;
        q.setFromAxisAngle(up, rnd() * 6.28);
        spots.push(m.clone().compose(new THREE.Vector3(p.x, 0.15, p.z), q, new THREE.Vector3(sc, sc, sc)));
      }
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.22, 3.2, 6).translate(0, 1.6, 0), new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.95 }), spots.length);
    const crownGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(1.9, 1).translate(0, 4.2, 0),
      new THREE.IcosahedronGeometry(1.4, 1).translate(0.8, 5.2, 0.3),
      new THREE.IcosahedronGeometry(1.3, 1).translate(-0.7, 5.0, -0.4),
    ]);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x1d2a1a, roughness: 0.9, flatShading: true }), spots.length);
    spots.forEach((mx, i) => { trunk.setMatrixAt(i, mx); crown.setMatrixAt(i, mx); });
    this.scene.add(trunk, crown);
  }

  // ── Start/finish, signage ──────────────────────────────────────────────────

  private buildStartGantry(): void {
    const t = this.track;
    const h = t.headingAt(0);
    const group = new THREE.Group();
    const c = t.pointAt(0, 0);
    group.position.set(c.x, 0, c.z);
    group.rotation.y = h;
    const steel = new THREE.MeshStandardMaterial({ color: 0x1b1c20, metalness: 0.8, roughness: 0.35 });
    for (const x of [-12.6, 12.6]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.2, 0.8), steel);
      pillar.position.set(x, 4.1, 0); pillar.castShadow = true; group.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 1.6, 1), steel);
    beam.position.set(0, 8.4, 0); group.add(beam);
    const banner = bannerTexture('gantry', [
      { text: 'RACE', color: '#ffffff', font: 'italic 800 150px "Barlow Condensed", Impact, sans-serif', y: 128 },
    ], '#0a0a0c', 1024, 256);
    const bannerTex2 = bannerTexture('gantry2', [
      { text: 'RACE  WARS', color: '#ff2a2a', font: 'italic 800 150px "Barlow Condensed", Impact, sans-serif', y: 132 },
    ], '#08080a', 1024, 256);
    void banner;
    const signMat = new THREE.MeshStandardMaterial({ map: bannerTex2, emissiveMap: bannerTex2, emissive: 0xffffff, emissiveIntensity: 1.6 });
    for (const z of [-0.52, 0.52]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), signMat);
      sign.position.set(0, 8.4, z);
      if (z < 0) sign.rotation.y = Math.PI; // each face looks away from the beam
      group.add(sign);
    }
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(24, 0.12, 0.2), new THREE.MeshStandardMaterial({ emissive: 0xffe6c8, emissiveIntensity: 0.9, color: 0x222222 }));
    lightBar.position.set(0, 7.55, 0); group.add(lightBar);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(16.8, 1.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 }));
    line.position.set(0, 0.025, 0); line.receiveShadow = true; group.add(line);
    this.scene.add(group);
  }

  private buildChevrons(): void {
    const t = this.track;
    const tex = bannerTexture('chevron', [{ text: '❯❯❯', color: '#ff2a2a', font: '900 150px Arial, sans-serif', y: 132 }], '#f2f2f2', 512, 256);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5 });
    const geo = new THREE.PlaneGeometry(3.2, 1.6);
    for (let s = 0; s < t.length; s += 24) {
      const k = t.curvatureAt(s + 40);
      if (Math.abs(k) < 1 / 260) continue;
      const side = k > 0 ? 1 : -1; // outside of a left turn is on the right
      const p = t.pointAt(s, side * (BARRIER_OFFSET + 0.75));
      const sign = new THREE.Mesh(geo, mat);
      sign.position.set(p.x, 1.6, p.z);
      sign.rotation.y = t.headingAt(s);
      if (k > 0) sign.scale.x = -1; // arrows point into the turn (texture points right)
      this.scene.add(sign);
    }
  }

  /** Move shadow camera and the dynamic lamp lights to the action. */
  update(focusX: number, focusZ: number, aheadX: number, aheadZ: number): void {
    this.moon.position.set(focusX + 40, 90, focusZ + 30);
    this.moon.target.position.set(focusX, 0, focusZ);
    this.sky.position.set(focusX, 0, focusZ);
    this.skyline.position.set(focusX, 150, focusZ);
    // Nearest lamp heads to a point slightly ahead of the camera
    const cx = (focusX + aheadX) / 2, cz = (focusZ + aheadZ) / 2;
    const best: { d: number; v: THREE.Vector3 }[] = [];
    for (const v of this.lampHeads) {
      const d = (v.x - cx) ** 2 + (v.z - cz) ** 2;
      if (best.length < DYNAMIC_LIGHTS) { best.push({ d, v }); best.sort((a, b) => a.d - b.d); }
      else if (d < best[DYNAMIC_LIGHTS - 1].d) { best[DYNAMIC_LIGHTS - 1] = { d, v }; best.sort((a, b) => a.d - b.d); }
    }
    best.forEach((b, i) => this.dynLights[i].position.copy(b.v));
  }

  setQuality(q: Quality, shadows: boolean): void {
    this.moon.castShadow = shadows && q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.moon.shadow.mapSize.x !== size) {
      this.moon.shadow.mapSize.set(size, size);
      this.moon.shadow.map?.dispose();
      (this.moon.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.dynLights.forEach((l, i) => { l.visible = q !== 'low' || i < 2; });
    if (this.lightCones) this.lightCones.visible = q !== 'low';
  }
}
