import * as THREE from 'three';

/**
 * Race Wars — GPU-instanced billboard particles (tyre smoke, sparks, garage haze).
 * One draw call per system; fixed-size pool, no per-frame allocation.
 */

interface Options {
  max: number;
  texture: THREE.Texture;
  color: number;
  additive?: boolean;
  gravity?: number;
  drag?: number;
  grow?: number;     // size growth per second
  fade?: number;     // alpha falloff exponent
}

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aSize: THREE.InstancedBufferAttribute;
  private readonly aAlpha: THREE.InstancedBufferAttribute;
  private readonly aRot: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;
  private count = 0;
  private readonly opts: Options;

  constructor(opts: Options) {
    this.opts = opts;
    this.max = opts.max;
    const n = opts.max;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n); this.alpha0 = new Float32Array(n);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) this.aRot.array[i] = Math.random() * Math.PI * 2;
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iAlpha', this.aAlpha); geo.setAttribute('iRot', this.aRot);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: opts.texture }, color: { value: new THREE.Color(opts.color) } },
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute float iRot;
        varying vec2 vUv; varying float vAlpha;
        void main() {
          vUv = uv; vAlpha = iAlpha;
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          float c = cos(iRot), s = sin(iRot);
          vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          mv.xy += p * iSize;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec3 color;
        varying vec2 vUv; varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(color * t.rgb, t.a * vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, alpha: number, life: number): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life; this.size0[i] = size; this.alpha0[i] = alpha;
  }

  update(dt: number): void {
    const { gravity = 0, drag = 0, grow = 0, fade = 1 } = this.opts;
    const dragF = Math.max(0, 1 - drag * dt);
    let i = 0;
    while (i < this.count) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // Swap-remove
        const last = --this.count;
        for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[last * 3 + k]; this.vel[i * 3 + k] = this.vel[last * 3 + k]; }
        this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last]; this.size0[i] = this.size0[last]; this.alpha0[i] = this.alpha0[last];
        continue;
      }
      this.vel[i * 3 + 1] -= gravity * dt;
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= dragF; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
      if (gravity > 0 && this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
      const t = this.life[i] / this.maxLife[i];
      this.aPos.array[i * 3] = this.pos[i * 3]; this.aPos.array[i * 3 + 1] = this.pos[i * 3 + 1]; this.aPos.array[i * 3 + 2] = this.pos[i * 3 + 2];
      this.aSize.array[i] = this.size0[i] * (1 + grow * this.life[i]);
      this.aAlpha.array[i] = this.alpha0[i] * Math.pow(1 - t, fade) * Math.min(1, this.life[i] * 8);
      i++;
    }
    this.geo.instanceCount = this.count;
    this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }

  clear(): void { this.count = 0; this.geo.instanceCount = 0; }

  get alive(): number { return this.count; }

  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
