import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Final grade in display space: gentle S-curve, teal shadows / warm highlights, vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.55 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c += mix(vec3(-0.012, 0.004, 0.022), vec3(0.025, 0.008, -0.018), smoothstep(0.15, 0.75, l));
      vec2 d = vUv - 0.5; float v = 1.0 - vignette * dot(d, d) * 1.6;
      gl_FragColor = vec4(clamp(c * v, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Race Wars — restrained post-processing: bloom on lamps, tail lights, neon and
 * nitro, then tone mapping/colour output. Disabled on LOW quality.
 */
export class PostFX {
  enabled = true;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.72, 0.5, 0.74);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
  }

  setStrength(strength: number): void { this.bloom.strength = strength; }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.enabled) { this.renderer.render(scene, camera); return; }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom.resolution.set(w / 2, h / 2);
  }
}
