import * as THREE from 'three';
import { mulberry32 } from '../ai/AIController';

/**
 * Race Wars — procedural textures (canvas generated, cached).
 * Everything the scenes need is generated here, so the game has no external
 * texture dependencies or licensing concerns.
 */

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function make(key: string, build: () => HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: boolean } = {}): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = new THREE.CanvasTexture(build());
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = opts.aniso ? 8 : 1;
  cache.set(key, tex);
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, base: number, spread: number, seed: number, alpha = 1): void {
  const img = ctx.getImageData(0, 0, w, h);
  const rnd = mulberry32(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = base + (rnd() - 0.5) * spread;
    img.data[i] = img.data[i] * (1 - alpha) + v * alpha;
    img.data[i + 1] = img.data[i + 1] * (1 - alpha) + v * alpha;
    img.data[i + 2] = img.data[i + 2] * (1 - alpha) + (v + 2) * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

/** Soft radial glow for light halos, tail-light streaks and smoke. */
export function glowTexture(): THREE.Texture {
  return make('glow', () => {
    const [c, ctx] = canvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return c;
  });
}

export function smokeTexture(): THREE.Texture {
  return make('smoke', () => {
    const [c, ctx] = canvas(128, 128);
    const rnd = mulberry32(5);
    for (let i = 0; i < 26; i++) {
      const x = 34 + rnd() * 60, y = 34 + rnd() * 60, r = 18 + rnd() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    }
    return c;
  });
}

/**
 * Road surface: 24 m wide × 12 m long tile. Lanes at -6,-2,2,6 m (dashed
 * separators at -4,0,4), solid edge lines at ±8.4, rumble strips on shoulders.
 */
export const ROAD_TEX_WIDTH = 24;
export const ROAD_TEX_LENGTH = 12;
export function roadTextures(): { map: THREE.Texture; rough: THREE.Texture } {
  const W = 1024, H = 512;
  const px = (m: number) => (m + ROAD_TEX_WIDTH / 2) / ROAD_TEX_WIDTH * W;
  const map = make('road', () => {
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#1b1c1f'; ctx.fillRect(0, 0, W, H);
    noise(ctx, W, H, 30, 26, 11, 0.55);
    // Tyre-worn lanes slightly darker and smoother
    for (const lane of [-6, -2, 2, 6]) {
      for (const off of [-0.8, 0.8]) {
        const g = ctx.createLinearGradient(px(lane + off - 0.5), 0, px(lane + off + 0.5), 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(px(lane + off - 0.5), 0, px(lane + off + 0.5) - px(lane + off - 0.5), H);
      }
    }
    // Shoulders
    ctx.fillStyle = 'rgba(40,40,44,0.6)';
    ctx.fillRect(0, 0, px(-8.6), H); ctx.fillRect(px(8.6), 0, W - px(8.6), H);
    // Edge lines
    ctx.fillStyle = '#d9d9d2';
    for (const e of [-8.4, 8.4]) ctx.fillRect(px(e) - 6, 0, 12, H);
    // Dashed separators: 4.5 m dash, 7.5 m gap
    for (const l of [-4, 0, 4]) ctx.fillRect(px(l) - 5, 0, 10, H * (4.5 / ROAD_TEX_LENGTH));
    // Rumble strips on shoulders
    ctx.fillStyle = 'rgba(200,200,190,0.35)';
    for (let y = 0; y < H; y += 32) { ctx.fillRect(px(-9.6), y, px(-8.8) - px(-9.6), 14); ctx.fillRect(px(8.8), y, px(9.6) - px(8.8), 14); }
    // Cracks and patches
    const rnd = mulberry32(3);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) {
      ctx.beginPath(); let x = rnd() * W, y = rnd() * H; ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return c;
  }, { repeat: true, aniso: true });
  const rough = make('road-rough', () => {
    const [c, ctx] = canvas(512, 256);
    ctx.fillStyle = 'rgb(150,150,150)'; ctx.fillRect(0, 0, 512, 256);
    noise(ctx, 512, 256, 150, 40, 21, 1);
    // Puddles: low roughness (green channel drives roughness) → wet reflections
    const rnd = mulberry32(9);
    for (let i = 0; i < 9; i++) {
      const x = rnd() * 512, y = rnd() * 256, r = 30 + rnd() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(25,25,25,0.95)'); g.addColorStop(0.7, 'rgba(40,40,40,0.6)'); g.addColorStop(1, 'rgba(150,150,150,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    }
    return c;
  }, { srgb: false, repeat: true });
  return { map, rough };
}

/** Distant skyline silhouette strip with lit windows (wraps around the horizon). */
export function skylineTexture(): THREE.Texture {
  return make('skyline', () => {
    const [c, ctx] = canvas(2048, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(10,16,30,0)'); g.addColorStop(0.55, 'rgba(26,34,56,0.0)'); g.addColorStop(1, 'rgba(40,46,70,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 2048, 256);
    const rnd = mulberry32(77);
    let x = 0;
    while (x < 2048) {
      const w = 18 + rnd() * 60, h = 40 + rnd() * 190;
      ctx.fillStyle = `rgb(${8 + rnd() * 8},${10 + rnd() * 8},${18 + rnd() * 10})`;
      ctx.fillRect(x, 256 - h, w, h);
      for (let wy = 256 - h + 6; wy < 250; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 6) {
        if (rnd() < 0.3) { ctx.fillStyle = rnd() < 0.7 ? 'rgba(255,214,150,0.85)' : 'rgba(170,205,255,0.85)'; ctx.fillRect(wx, wy, 2, 3); }
      }
      if (rnd() < 0.12) { ctx.fillStyle = '#ff2a2a'; ctx.fillRect(x + w / 2 - 1, 256 - h - 6, 2, 2); }
      x += w + rnd() * 6;
    }
    return c;
  });
}

/** Night sky gradient with a faint city glow on the horizon. */
export function skyTexture(): THREE.Texture {
  return make('sky', () => {
    const [c, ctx] = canvas(16, 512);
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#02040a'); g.addColorStop(0.55, '#0a1222'); g.addColorStop(0.8, '#1d2438'); g.addColorStop(1, '#2a2a36');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 512);
    return c;
  });
}

export function concreteTexture(): THREE.Texture {
  return make('concrete', () => {
    const [c, ctx] = canvas(512, 512);
    ctx.fillStyle = '#4a4a4c'; ctx.fillRect(0, 0, 512, 512);
    noise(ctx, 512, 512, 70, 30, 41, 0.6);
    const rnd = mulberry32(42);
    for (let i = 0; i < 30; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 20 + rnd() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(10,10,10,${0.15 + rnd() * 0.25})`); g.addColorStop(1, 'rgba(10,10,10,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(256, 512); ctx.moveTo(0, 256); ctx.lineTo(512, 256); ctx.stroke();
    return c;
  }, { repeat: true, aniso: true });
}

export function concreteRoughness(): THREE.Texture {
  return make('concrete-r', () => {
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = 'rgb(170,170,170)'; ctx.fillRect(0, 0, 256, 256);
    noise(ctx, 256, 256, 170, 50, 43, 1);
    const rnd = mulberry32(44);
    for (let i = 0; i < 8; i++) {
      const x = rnd() * 256, y = rnd() * 256, r = 20 + rnd() * 50;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(30,30,30,0.9)'); g.addColorStop(1, 'rgba(170,170,170,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    }
    return c;
  }, { srgb: false, repeat: true });
}

export function shutterTexture(): THREE.Texture {
  return make('shutter', () => {
    const [c, ctx] = canvas(256, 512);
    for (let y = 0; y < 512; y += 16) {
      const g = ctx.createLinearGradient(0, y, 0, y + 16);
      g.addColorStop(0, '#5a5d63'); g.addColorStop(0.45, '#3a3c41'); g.addColorStop(0.55, '#222428'); g.addColorStop(1, '#4b4e54');
      ctx.fillStyle = g; ctx.fillRect(0, y, 256, 16);
    }
    noise(ctx, 256, 512, 60, 30, 61, 0.15);
    return c;
  }, { repeat: true });
}

export function hazardTexture(): THREE.Texture {
  return make('hazard', () => {
    const [c, ctx] = canvas(128, 128);
    ctx.fillStyle = '#d8a600'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#111';
    for (let i = -128; i < 256; i += 48) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 24, 0); ctx.lineTo(i + 24 - 128, 128); ctx.lineTo(i - 128, 128); ctx.fill(); }
    return c;
  }, { repeat: true });
}

export function checkerTexture(): THREE.Texture {
  return make('checker', () => {
    const [c, ctx] = canvas(256, 64);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { ctx.fillStyle = (x + y) % 2 ? '#e9e9e9' : '#111'; ctx.fillRect(x * 16, y * 16, 16, 16); }
    return c;
  });
}

/** Text banner (start gantry, billboards). */
export function bannerTexture(key: string, lines: { text: string; color: string; font: string; y: number }[], bg = '#0b0b0d', w = 1024, h = 256): THREE.Texture {
  return make(`banner-${key}`, () => {
    const [c, ctx] = canvas(w, h);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of lines) { ctx.font = l.font; ctx.fillStyle = l.color; ctx.fillText(l.text, w / 2, l.y); }
    return c;
  });
}

export function wallPanelTexture(): THREE.Texture {
  return make('wall', () => {
    const [c, ctx] = canvas(512, 512);
    ctx.fillStyle = '#26272b'; ctx.fillRect(0, 0, 512, 512);
    noise(ctx, 512, 512, 40, 18, 51, 0.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
    for (let x = 0; x <= 512; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
    for (let y = 0; y <= 512; y += 256) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < 512; x += 128) ctx.fillRect(x + 3, 0, 2, 512);
    return c;
  }, { repeat: true });
}
