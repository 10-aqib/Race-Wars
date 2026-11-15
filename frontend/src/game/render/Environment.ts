import * as THREE from 'three';

/**
 * Race Wars — image-based lighting. Small procedural scenes are baked with
 * PMREM into reflection maps so paint, glass and wet asphalt pick up the
 * right highlights (street lamps and city glow at night, tube lights in the garage).
 */

function bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sigma: number): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, sigma).texture;
  pmrem.dispose();
  scene.traverse(n => { if (n instanceof THREE.Mesh) { n.geometry.dispose(); (n.material as THREE.Material).dispose(); } });
  return tex;
}

const emissive = (hex: number, intensity: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity) });

export function createNightCityEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const geo = sky.geometry;
  const colors: number[] = [];
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    const c = new THREE.Color().lerpColors(new THREE.Color(0x2a2a38), new THREE.Color(0x03050c), Math.max(0, y) ** 0.5);
    if (y < 0) c.setHex(0x050506);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(sky);
  // Street lamps overhead along the driving axis, building windows on the sides
  for (let i = -4; i <= 4; i++) {
    for (const x of [-9, 9]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 2.5), emissive(0xffb36b, 14));
      lamp.position.set(x, 12, i * 10); scene.add(lamp);
    }
  }
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(4 + (i % 3) * 3, 6 + (i % 5) * 3), emissive(i % 3 ? 0x6f86b8 : 0xc29a6a, 1.6));
    w.position.set(Math.cos(a) * 40, 4 + (i % 4) * 4, Math.sin(a) * 40);
    w.lookAt(0, 4, 0); scene.add(w);
  }
  return bake(renderer, scene, 0.035);
}

export function createGarageEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 10, 30), new THREE.MeshBasicMaterial({ color: 0x0b0b0d, side: THREE.BackSide }));
  room.position.y = 4; scene.add(room);
  for (const [x, z] of [[-4.5, -5], [4.5, -5], [-4.5, 1.5], [4.5, 1.5], [0, -1.8], [0, 7]] as [number, number][]) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 3.4), emissive(0xeef4ff, 18));
    tube.position.set(x, 8.8, z); scene.add(tube);
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), emissive(0x9fb4ff, 0.5)); door.position.set(0, 3, -14.9); scene.add(door);
  const softbox = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), emissive(0xffffff, 3)); softbox.position.set(4, 5, 12); softbox.lookAt(0, 1, 0); scene.add(softbox);
  const red = new THREE.Mesh(new THREE.PlaneGeometry(3, 1), emissive(0xff2020, 4)); red.position.set(-14.8, 1.5, -6); red.rotation.y = Math.PI / 2; scene.add(red);
  return bake(renderer, scene, 0.03);
}
