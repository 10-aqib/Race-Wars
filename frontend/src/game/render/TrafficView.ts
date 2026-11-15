import * as THREE from 'three';
import { glowTexture } from './Textures';
import type { VehicleSim } from '../vehicle/VehicleSim';

/**
 * Race Wars — procedural civilian vehicles (sedan, SUV, van).
 * Low-poly extruded silhouettes with emissive lights; geometry shared per type.
 */

type Kind = 'sedan' | 'suv' | 'van';
const PROFILES: Record<Kind, [number, number][]> = {
  sedan: [[-2.3, 0.3], [-2.3, 0.78], [-1.4, 0.92], [-0.7, 1.4], [0.75, 1.42], [1.55, 0.98], [2.3, 0.86], [2.3, 0.3]],
  suv: [[-2.35, 0.35], [-2.35, 1.0], [-1.55, 1.12], [-1.05, 1.75], [1.9, 1.78], [2.3, 1.2], [2.35, 0.35]],
  van: [[-2.4, 0.35], [-2.4, 1.15], [-1.7, 1.95], [2.4, 2.05], [2.4, 0.35]],
};
const geoCache = new Map<Kind, THREE.BufferGeometry>();
const COLORS = [0xd8d8d8, 0x8b8f96, 0x1b1c20, 0x23324f, 0x5a1a1a, 0x3c4a3c, 0xb7b0a0];

function bodyGeometry(kind: Kind): THREE.BufferGeometry {
  const hit = geoCache.get(kind);
  if (hit) return hit;
  const shape = new THREE.Shape();
  PROFILES[kind].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const width = kind === 'sedan' ? 1.78 : 1.9;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2); // profile x → world z, so the bonnet (negative x) faces -Z
  geo.computeVertexNormals();
  geoCache.set(kind, geo);
  return geo;
}

const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.4, roughness: 0.08 });

export class TrafficView {
  readonly group = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private tailMat: THREE.MeshStandardMaterial;
  private tailGlows: THREE.Sprite[] = [];
  private bodyMat: THREE.MeshStandardMaterial;

  constructor(seed: number) {
    const kind: Kind = (['sedan', 'sedan', 'suv', 'van'] as Kind[])[seed % 4];
    this.bodyMat = new THREE.MeshStandardMaterial({ color: COLORS[seed % COLORS.length], metalness: 0.5, roughness: 0.35 });
    const body = new THREE.Mesh(bodyGeometry(kind), this.bodyMat);
    body.castShadow = true;
    this.group.add(body);
    const top = kind === 'van' ? 1.85 : kind === 'suv' ? 1.6 : 1.3;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(kind === 'sedan' ? 1.7 : 1.82, 0.32, kind === 'van' ? 3.6 : 2.2), glassMat);
    glass.position.set(0, top - 0.12, kind === 'van' ? 0.1 : -0.05);
    this.group.add(glass);
    for (const [x, z] of [[-0.85, -1.45], [0.85, -1.45], [-0.85, 1.5], [0.85, 1.5]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(x, 0.33, z); this.group.add(w); this.wheels.push(w);
    }
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1515, emissiveIntensity: 1.2 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.5 });
    const tex = glowTexture();
    const rear = kind === 'van' ? 2.42 : 2.36;
    for (const x of [-0.68, 0.68]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), this.tailMat); t.position.set(x, 0.85, rear); this.group.add(t);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.05), headMat); h.position.set(x, 0.72, -rear); this.group.add(h);
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xff2a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
      g.position.set(x, 0.85, rear + 0.1); g.scale.setScalar(0.8); this.group.add(g); this.tailGlows.push(g);
      const hg = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xfff0d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
      hg.position.set(x, 0.72, -rear - 0.1); hg.scale.setScalar(0.9); this.group.add(hg);
    }
    this.group.visible = false;
  }

  update(sim: VehicleSim, x: number, z: number, heading: number): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.set(0, heading, 0);
    for (const w of this.wheels) w.rotation.x = -sim.wheelRotation;
    const b = sim.braking ? 1 : 0;
    this.tailMat.emissiveIntensity = 1.2 + b * 2.5;
    this.tailGlows.forEach(g => { g.material.opacity = 0.4 + b * 0.5; });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.bodyMat.dispose(); this.tailMat.dispose();
    this.group.traverse(n => { if (n instanceof THREE.Sprite) n.material.dispose(); });
  }
}
