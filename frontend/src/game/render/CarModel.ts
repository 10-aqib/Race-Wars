import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * Race Wars — car model loading.
 * The GLB is decoded once (Draco, local decoder) and cloned per car with
 * shared geometry and per-instance materials. Materials are re-tuned for the
 * dark, glossy look of the reference and brand badges are neutralised.
 */

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
const cache = new Map<string, Promise<GLTF>>();

export interface CarParts {
  root: THREE.Group;            // normalised model, front faces -Z, ground at y = 0
  body: THREE.Object3D | null;  // chassis node (for pitch/roll)
  wheels: { node: THREE.Object3D; base: THREE.Quaternion; front: boolean; spinAxis: THREE.Vector3; steerAxis: THREE.Vector3 }[];
  /** Car-space X (pitch) and Z (roll) axes expressed in the body node's parent space. */
  pitchAxis: THREE.Vector3;
  rollAxis: THREE.Vector3;
  paint: THREE.MeshPhysicalMaterial[];
  tail: THREE.MeshStandardMaterial[];
  head: THREE.MeshStandardMaterial[];
  tailPoints: THREE.Vector3[];  // approximate tail-light centres (model space)
  headPoints: THREE.Vector3[];
  length: number;
  fallback: boolean;
  /** Interior and small mechanical parts: hidden at distance (LOD) and never cast shadows. */
  details: THREE.Object3D[];
}

const DETAIL_PARTS = ['interior_light', 'leather', 'interior_dark', 'carpet', 'brake', 'brakes', 'nuts', 'centre', 'wipers', 'leds', 'carbon fibre', 'carbon_fibre_trim', 'yellow_trim', 'blue', 'steering_wheel'];

export type ModelStatus = 'loaded' | 'fallback';
let lastStatus: ModelStatus = 'loaded';
export function modelStatus(): ModelStatus { return lastStatus; }

export function preloadCarModel(path = '/car.glb'): Promise<void> {
  return load(path).then(() => { lastStatus = 'loaded'; }, () => { lastStatus = 'fallback'; });
}

function load(path: string): Promise<GLTF> {
  if (!cache.has(path)) {
    const p = loader.loadAsync(path);
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path)!;
}

export async function createCarParts(path: string, paint: number, trim: 'dark' | 'chrome' = 'dark'): Promise<CarParts> {
  try {
    const gltf = await load(path);
    lastStatus = 'loaded';
    return buildFromGltf(gltf, paint, trim);
  } catch (err) {
    console.error('[RaceWars] Car model failed to load, using procedural fallback:', err);
    lastStatus = 'fallback';
    return buildFallback(paint);
  }
}

function buildFromGltf(gltf: GLTF, paintHex: number, trim: 'dark' | 'chrome'): CarParts {
  const model = gltf.scene.clone(true);
  const materials = new Map<THREE.Material, THREE.Material>();
  const paint: THREE.MeshPhysicalMaterial[] = [];
  const tail: THREE.MeshStandardMaterial[] = [];
  const head: THREE.MeshStandardMaterial[] = [];

  const tune = (src: THREE.Material): THREE.Material => {
    if (materials.has(src)) return materials.get(src)!;
    const name = src.name.toLowerCase();
    let mat: THREE.Material = src.clone();
    const std = mat as THREE.MeshStandardMaterial;
    if (name === 'body_color' || name.includes('paint')) {
      const phys = new THREE.MeshPhysicalMaterial({
        color: paintHex, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25,
      });
      phys.name = src.name;
      paint.push(phys);
      mat = phys;
    } else if (name.includes('ferrari_yellow') || name.includes('dodgerblue')) {
      // Neutralise manufacturer badges/stripes: they take the paint colour
      const phys = new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: 0.55, roughness: 0.3, clearcoat: 1 });
      paint.push(phys);
      mat = phys;
    } else if (name.includes('taillight')) {
      std.color.setHex(0x330000); std.emissive.setHex(0xff1010); std.emissiveIntensity = 0.8;
      std.transparent = false; std.opacity = 1;
      tail.push(std);
    } else if (name.includes('projector')) {
      std.color.setHex(0xffffff); std.emissive.setHex(0xe8f1ff); std.emissiveIntensity = 1.6;
      head.push(std);
    } else if (name.includes('turn_signal')) {
      std.emissive?.setHex(0x331a00);
    } else if (name === 'tires') {
      std.color.setHex(0x0d0d0e); std.roughness = 0.88; std.metalness = 0;
    } else if (name === 'metal_gray') {
      std.color.setHex(trim === 'dark' ? 0x1d1e21 : 0x8c8f95); std.metalness = 0.85; std.roughness = 0.32;
    } else if (name === 'metal_chrome') {
      std.color.setHex(trim === 'dark' ? 0x3a3c40 : 0xd8d8d8); std.metalness = 1; std.roughness = 0.18;
    } else if (name === 'glass_gray') {
      std.color.setHex(0x0b0d10); std.metalness = 0.3; std.roughness = 0.04; std.transparent = true; std.opacity = 0.82;
    } else if (name.includes('plastic') || name.includes('carbon')) {
      std.color.setHex(0x111214); std.roughness = 0.45;
    } else if (name === 'leather' || name.includes('interior_dark') || name === 'carpet') {
      std.color.setHex(0x101012);
    }
    materials.set(src, mat);
    return mat;
  };

  const details: THREE.Object3D[] = [];
  model.traverse(node => {
    const isDetail = DETAIL_PARTS.includes(node.name);
    if (isDetail) details.push(node);
    if (node instanceof THREE.Mesh) {
      const inDetail = isDetail || DETAIL_PARTS.includes(node.parent?.name ?? '');
      node.castShadow = !inDetail && ['body', 'tire', 'wheel', 'trim', 'glass'].includes(node.name);
      node.receiveShadow = !inDetail;
      node.material = Array.isArray(node.material) ? node.material.map(tune) : tune(node.material);
    }
  });

  // Normalise to 4.5 m length, centred, wheels on the ground
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = 4.5 / Math.max(size.z, 0.001);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box2.min.y, -center.z);
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);

  // Express car-space axes in each animated node's parent frame (the GLB hierarchy is not Y-up)
  const rootInv = new THREE.Quaternion();
  const axisIn = (node: THREE.Object3D, axis: THREE.Vector3) => {
    const pq = new THREE.Quaternion();
    node.parent?.getWorldQuaternion(pq);
    root.getWorldQuaternion(rootInv);
    // parent-local = inverse(parentWorld) * rootWorld * axis
    return axis.clone().applyQuaternion(rootInv).applyQuaternion(pq.invert()).normalize();
  };
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const wheels: CarParts['wheels'] = [];
  for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const node = model.getObjectByName(name);
    if (node) wheels.push({ node, base: node.quaternion.clone(), front: name.includes('_f'), spinAxis: axisIn(node, X), steerAxis: axisIn(node, Y) });
  }
  const bodyNode = model.getObjectByName('main') ?? null;
  const pointsOf = (meshName: string, rear: boolean): THREE.Vector3[] => {
    const mesh = model.getObjectByName(meshName);
    if (!mesh) return [];
    const b = new THREE.Box3().setFromObject(mesh);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    b.applyMatrix4(inv);
    const z = rear ? b.max.z - 0.05 : b.min.z + 0.05;
    const y = (b.min.y + b.max.y) / 2;
    const x = Math.max(0.35, (b.max.x - b.min.x) / 2 - 0.15);
    return [new THREE.Vector3(-x, y, z), new THREE.Vector3(x, y, z)];
  };
  return {
    root, body: bodyNode, wheels, paint, tail, head,
    pitchAxis: bodyNode ? axisIn(bodyNode, X) : X.clone(), rollAxis: bodyNode ? axisIn(bodyNode, Z) : Z.clone(),
    tailPoints: pointsOf('lights_red', true), headPoints: pointsOf('lights', false),
    length: 4.5, fallback: false, details,
  };
}

/** Procedural sports-car silhouette used only when the GLB cannot load. */
function buildFallback(paintHex: number): CarParts {
  const root = new THREE.Group();
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: 0.6, roughness: 0.25, clearcoat: 1 });
  const shape = new THREE.Shape();
  shape.moveTo(-2.25, 0.25); shape.lineTo(-2.25, 0.7); shape.quadraticCurveTo(-1.6, 0.95, -0.6, 1.05);
  shape.quadraticCurveTo(0.1, 1.25, 0.9, 1.05); shape.quadraticCurveTo(1.9, 0.95, 2.25, 0.75); shape.lineTo(2.25, 0.25); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.9, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3 });
  geo.translate(0, 0, -0.95);
  geo.rotateY(Math.PI / 2);
  const body = new THREE.Mesh(geo, paintMat);
  body.castShadow = true;
  const bodyGroup = new THREE.Group();
  bodyGroup.add(body);
  root.add(bodyGroup);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.9 });
  const wheels: CarParts['wheels'] = [];
  for (const [x, z, f] of [[-0.9, -1.4, true], [0.9, -1.4, true], [-0.9, 1.4, false], [0.9, 1.4, false]] as [number, number, boolean][]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.28, 18).rotateZ(Math.PI / 2), tyre);
    w.position.set(x, 0.34, z);
    root.add(w);
    wheels.push({ node: w, base: w.quaternion.clone(), front: f, spinAxis: new THREE.Vector3(1, 0, 0), steerAxis: new THREE.Vector3(0, 1, 0) });
  }
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f1ff, emissiveIntensity: 1.6 });
  for (const x of [-0.65, 0.65]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.04), tailMat); t.position.set(x, 0.72, 2.27); root.add(t);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.04), headMat); h.position.set(x, 0.7, -2.27); root.add(h);
  }
  return {
    root, body: bodyGroup, wheels, paint: [paintMat], tail: [tailMat], head: [headMat],
    pitchAxis: new THREE.Vector3(1, 0, 0), rollAxis: new THREE.Vector3(0, 0, 1),
    tailPoints: [new THREE.Vector3(-0.65, 0.72, 2.27), new THREE.Vector3(0.65, 0.72, 2.27)],
    headPoints: [new THREE.Vector3(-0.65, 0.7, -2.27), new THREE.Vector3(0.65, 0.7, -2.27)],
    length: 4.5, fallback: true, details: [],
  };
}

/** Dispose per-instance materials (geometry is shared with the cache). */
export function disposeCarParts(parts: CarParts): void {
  const seen = new Set<THREE.Material>();
  parts.root.traverse(node => {
    if (node instanceof THREE.Mesh) {
      for (const m of Array.isArray(node.material) ? node.material : [node.material]) if (!seen.has(m)) { seen.add(m); m.dispose(); }
      if (parts.fallback) node.geometry.dispose();
    }
  });
}
