import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../ai/AIController';

/**
 * Race Wars — procedural city buildings.
 *
 * Four facade styles, each with colour, emissive (lit windows), roughness and
 * normal maps generated on canvas from one layout, so window frames catch
 * light, glass reflects the night sky and only some offices are lit. Towers
 * get a lit storefront podium, optional setbacks and rooftop equipment.
 * Everything is merged per material: a few draw calls for the whole city.
 */

export type FacadeStyle = 'glass' | 'concrete' | 'brick' | 'dark';
export const FACADE_STYLES: FacadeStyle[] = ['glass', 'concrete', 'brick', 'dark'];

const TEX = 512;
/** World size covered by one facade tile (metres): 8 bays × 3 m, 8 floors × 3.5 m. */
export const TILE_W = 24, TILE_H = 28;
const STORE_TILE_W = 18, STORE_TILE_H = 7;

interface FacadeMaps { map: THREE.Texture; emissive: THREE.Texture; rough: THREE.Texture; normal: THREE.Texture; }
const cache = new Map<string, FacadeMaps>();

function canvas(w = TEX, h = TEX): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Height map → tangent-space normal map (Sobel). */
function normalFromHeight(h: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = h.width, hh = h.height;
  const src = h.getContext('2d')!.getImageData(0, 0, w, hh).data;
  const [c, ctx] = canvas(w, hh);
  const out = ctx.createImageData(w, hh);
  const at = (x: number, y: number) => src[(((y + hh) % hh) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
    out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
    out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const r = mulberry32(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

export function facadeMaps(style: FacadeStyle): FacadeMaps {
  const hit = cache.get(style);
  if (hit) return hit;
  const rnd = mulberry32(style.length * 97 + 13);
  const [cc, col] = canvas();
  const [ce, emi] = canvas();
  const [cr, rough] = canvas();
  const [ch, height] = canvas();
  emi.fillStyle = '#000'; emi.fillRect(0, 0, TEX, TEX);
  const bays = 8, floors = 8, bw = TEX / bays, fh = TEX / floors;
  const warm = ['#ffd49a', '#ffc77d', '#ffe6bf', '#f9b56a'];
  const cool = ['#cfe2ff', '#a9c9ff', '#e8f1ff'];
  const litColor = () => (rnd() < 0.7 ? warm : cool)[Math.floor(rnd() * 3)];

  if (style === 'glass') {
    // Curtain wall: reflective blue-grey glass, thin aluminium mullions, office interiors behind glass
    col.fillStyle = '#1a2433'; col.fillRect(0, 0, TEX, TEX);
    rough.fillStyle = 'rgb(40,40,40)'; rough.fillRect(0, 0, TEX, TEX);
    height.fillStyle = '#808080'; height.fillRect(0, 0, TEX, TEX);
    for (let f = 0; f < floors; f++) {
      const officeLit = rnd() < 0.42;
      for (let b = 0; b < bays; b++) {
        const x = b * bw, y = f * fh;
        const g = col.createLinearGradient(x, y, x + bw, y + fh);
        g.addColorStop(0, '#24344a'); g.addColorStop(1, '#141c28');
        col.fillStyle = g; col.fillRect(x + 2, y + 2, bw - 4, fh - 10);
        if (officeLit && rnd() < 0.8) {
          const c = litColor();
          emi.fillStyle = c; emi.globalAlpha = 0.45 + rnd() * 0.35; emi.fillRect(x + 3, y + 4, bw - 6, fh - 16); emi.globalAlpha = 1;
          // Ceiling light rows inside the office
          emi.fillStyle = '#ffffff'; emi.globalAlpha = 0.5; emi.fillRect(x + 6, y + 6, bw - 12, 2); emi.globalAlpha = 1;
          col.fillStyle = c; col.globalAlpha = 0.25; col.fillRect(x + 3, y + 4, bw - 6, fh - 16); col.globalAlpha = 1;
        }
      }
      // Spandrel band
      col.fillStyle = '#0e131b'; col.fillRect(0, f * fh + fh - 9, TEX, 9);
      rough.fillStyle = 'rgb(150,150,150)'; rough.fillRect(0, f * fh + fh - 9, TEX, 9);
      height.fillStyle = '#9a9a9a'; height.fillRect(0, f * fh + fh - 9, TEX, 9);
    }
    col.fillStyle = '#6d7684';
    for (let b = 0; b <= bays; b++) { col.fillRect(b * bw - 1, 0, 3, TEX); height.fillStyle = '#c0c0c0'; height.fillRect(b * bw - 1, 0, 3, TEX); }
  } else if (style === 'concrete') {
    col.fillStyle = '#5d5c58'; col.fillRect(0, 0, TEX, TEX);
    grain(col, TEX, TEX, 26, 3);
    rough.fillStyle = 'rgb(225,225,225)'; rough.fillRect(0, 0, TEX, TEX);
    height.fillStyle = '#b0b0b0'; height.fillRect(0, 0, TEX, TEX);
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw + 9, y = f * fh + 12, w = bw - 18, h = fh - 24;
      col.fillStyle = '#2a2d31'; col.fillRect(x - 3, y - 3, w + 6, h + 6); // reveal
      col.fillStyle = '#151a22'; col.fillRect(x, y, w, h);
      height.fillStyle = '#404040'; height.fillRect(x - 3, y - 3, w + 6, h + 6);
      height.fillStyle = '#202020'; height.fillRect(x, y, w, h);
      rough.fillStyle = 'rgb(35,35,35)'; rough.fillRect(x, y, w, h);
      if (rnd() < 0.3) {
        const c = litColor();
        emi.fillStyle = c; emi.globalAlpha = 0.6 + rnd() * 0.4; emi.fillRect(x, y, w, h); emi.globalAlpha = 1;
        col.fillStyle = c; col.globalAlpha = 0.3; col.fillRect(x, y, w, h); col.globalAlpha = 1;
        // Blinds
        col.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = y + 3; k < y + h; k += 4) col.fillRect(x, k, w, 1);
      }
      col.fillStyle = '#3a3d42'; col.fillRect(x + w / 2 - 1, y, 2, h); // mullion
    }
    // Rain streaks
    col.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 40; i++) col.fillRect(rnd() * TEX, rnd() * TEX, 2, 30 + rnd() * 80);
  } else if (style === 'brick') {
    col.fillStyle = '#4f2f24'; col.fillRect(0, 0, TEX, TEX);
    for (let y = 0; y < TEX; y += 6) for (let x = (y / 6) % 2 ? 0 : 7; x < TEX; x += 14) {
      col.fillStyle = `rgb(${70 + rnd() * 30},${38 + rnd() * 15},${28 + rnd() * 10})`; col.fillRect(x, y, 12, 5);
    }
    rough.fillStyle = 'rgb(235,235,235)'; rough.fillRect(0, 0, TEX, TEX);
    height.fillStyle = '#909090'; height.fillRect(0, 0, TEX, TEX);
    for (let y = 0; y < TEX; y += 6) { height.fillStyle = '#707070'; height.fillRect(0, y + 5, TEX, 1); }
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw + 16, y = f * fh + 10, w = bw - 32, h = fh - 22;
      col.fillStyle = '#d8d0c4'; col.fillRect(x - 3, y - 3, w + 6, h + 8); // stone surround
      col.fillStyle = '#10141b'; col.fillRect(x, y, w, h);
      height.fillStyle = '#d0d0d0'; height.fillRect(x - 3, y - 3, w + 6, h + 8);
      height.fillStyle = '#303030'; height.fillRect(x, y, w, h);
      rough.fillStyle = 'rgb(40,40,40)'; rough.fillRect(x, y, w, h);
      if (rnd() < 0.38) {
        emi.fillStyle = warm[Math.floor(rnd() * 4)]; emi.globalAlpha = 0.7; emi.fillRect(x, y, w, h); emi.globalAlpha = 1;
        // Curtains
        emi.fillStyle = '#000'; emi.globalAlpha = 0.5; emi.fillRect(x, y, w * 0.22, h); emi.fillRect(x + w * 0.78, y, w * 0.22, h); emi.globalAlpha = 1;
      }
      col.fillStyle = '#c9c2b6'; col.fillRect(x + w / 2 - 1, y, 2, h); col.fillRect(x, y + h / 2, w, 2);
    }
  } else {
    // Dark modern: black composite panels, vertical LED fins, sparse lit windows
    col.fillStyle = '#121316'; col.fillRect(0, 0, TEX, TEX);
    grain(col, TEX, TEX, 10, 9);
    rough.fillStyle = 'rgb(110,110,110)'; rough.fillRect(0, 0, TEX, TEX);
    height.fillStyle = '#808080'; height.fillRect(0, 0, TEX, TEX);
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw + 6, y = f * fh + 6, w = bw - 12, h = fh - 14;
      col.fillStyle = '#0b0e13'; col.fillRect(x, y, w, h);
      rough.fillStyle = 'rgb(25,25,25)'; rough.fillRect(x, y, w, h);
      height.fillStyle = '#505050'; height.fillRect(x, y, w, h);
      if (rnd() < 0.22) { emi.fillStyle = litColor(); emi.globalAlpha = 0.55; emi.fillRect(x, y, w, h); emi.globalAlpha = 1; }
    }
    for (let b = 0; b <= bays; b += 2) {
      emi.fillStyle = '#9fd4ff'; emi.fillRect(b * bw - 2, 0, 3, TEX);
      col.fillStyle = '#9fd4ff'; col.fillRect(b * bw - 2, 0, 3, TEX);
      height.fillStyle = '#ffffff'; height.fillRect(b * bw - 3, 0, 5, TEX);
    }
  }
  const maps: FacadeMaps = {
    map: tex(cc, true), emissive: tex(ce, true), rough: tex(cr, false), normal: tex(normalFromHeight(ch, 3), false),
  };
  cache.set(style, maps);
  return maps;
}

/** Ground-floor retail: lit shop windows, signage band and awnings. */
export function storefrontMaps(): FacadeMaps {
  const hit = cache.get('store');
  if (hit) return hit;
  const W = 512, H = 200;
  const rnd = mulberry32(77);
  const [cc, col] = canvas(W, H), [ce, emi] = canvas(W, H), [cr, rough] = canvas(W, H), [ch, height] = canvas(W, H);
  col.fillStyle = '#26272b'; col.fillRect(0, 0, W, H);
  emi.fillStyle = '#000'; emi.fillRect(0, 0, W, H);
  rough.fillStyle = 'rgb(200,200,200)'; rough.fillRect(0, 0, W, H);
  height.fillStyle = '#909090'; height.fillRect(0, 0, W, H);
  const signs = ['#ff3b4e', '#38d6ff', '#ffb02e', '#ffffff', '#7dff8a'];
  const shops = 3, sw = W / shops;
  for (let i = 0; i < shops; i++) {
    const x = i * sw;
    const sign = signs[Math.floor(rnd() * signs.length)];
    // Signage band
    col.fillStyle = '#0d0d10'; col.fillRect(x + 6, 10, sw - 12, 34);
    emi.fillStyle = sign; emi.globalAlpha = 0.9;
    emi.font = 'bold 22px Arial'; emi.textAlign = 'center'; emi.textBaseline = 'middle';
    emi.fillText(['CAFE', 'MARKET', 'PHARMACY', 'NOODLES', 'DINER', 'GYM', 'BAR', 'HOTEL'][Math.floor(rnd() * 8)], x + sw / 2, 28);
    emi.globalAlpha = 1;
    // Shop window
    const lit = rnd() < 0.8;
    const g = col.createLinearGradient(0, 56, 0, H - 8);
    g.addColorStop(0, lit ? '#e8c890' : '#1a1d22'); g.addColorStop(1, lit ? '#9c7a4a' : '#101215');
    col.fillStyle = g; col.fillRect(x + 10, 56, sw - 20, H - 66);
    rough.fillStyle = 'rgb(30,30,30)'; rough.fillRect(x + 10, 56, sw - 20, H - 66);
    height.fillStyle = '#404040'; height.fillRect(x + 10, 56, sw - 20, H - 66);
    if (lit) {
      const eg = emi.createLinearGradient(0, 56, 0, H - 8);
      eg.addColorStop(0, '#ffe2b0'); eg.addColorStop(1, '#a8743c');
      emi.fillStyle = eg; emi.globalAlpha = 0.85; emi.fillRect(x + 10, 56, sw - 20, H - 66); emi.globalAlpha = 1;
      // Shelves / silhouettes
      col.fillStyle = 'rgba(0,0,0,0.35)'; emi.fillStyle = 'rgba(0,0,0,0.5)';
      for (let k = 0; k < 4; k++) { const sx = x + 18 + rnd() * (sw - 60); col.fillRect(sx, 110 + rnd() * 30, 14 + rnd() * 20, 40); emi.fillRect(sx, 110, 16, 60); }
    }
    col.fillStyle = '#3c3e44'; col.fillRect(x + sw / 2 - 4, 56, 8, H - 66); // door frame
    // Awning
    col.fillStyle = ['#5a1014', '#13324f', '#1f3d22'][i % 3]; col.fillRect(x + 6, 46, sw - 12, 8);
    height.fillStyle = '#e0e0e0'; height.fillRect(x + 6, 46, sw - 12, 8);
  }
  const maps: FacadeMaps = { map: tex(cc, true), emissive: tex(ce, true), rough: tex(cr, false), normal: tex(normalFromHeight(ch, 3), false) };
  cache.set('store', maps);
  return maps;
}

export function facadeMaterial(style: FacadeStyle | 'store'): THREE.MeshStandardMaterial {
  const m = style === 'store' ? storefrontMaps() : facadeMaps(style);
  return new THREE.MeshStandardMaterial({
    map: m.map, emissiveMap: m.emissive, emissive: 0xffffff,
    emissiveIntensity: style === 'store' ? 0.62 : style === 'dark' ? 1.1 : 0.9,
    roughnessMap: m.rough, roughness: 1, normalMap: m.normal, normalScale: new THREE.Vector2(0.8, 0.8),
    metalness: style === 'glass' ? 0.55 : style === 'dark' ? 0.35 : 0.05,
    envMapIntensity: style === 'glass' ? 1.4 : 0.6,
  });
}

/** Box with world-scaled facade UVs (sides only; roof uses a dark wall texel). */
export function facadeBox(w: number, h: number, d: number, tileW = TILE_W, tileH = TILE_H, vOffset = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const dims: [number, number][] = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    const [a, b] = dims[f];
    if (a === 0) uv.setXY(i, 0.02, 0.985);
    else uv.setXY(i, uv.getX(i) * (a / tileW), uv.getY(i) * (b / tileH) + vOffset);
  }
  return g;
}

export interface BuildingSpec { x: number; z: number; heading: number; w: number; d: number; h: number; style: FacadeStyle; seed: number; }

/** Geometry buckets for a set of building specs, merged per material. */
export function buildBuildings(specs: BuildingSpec[]): THREE.Group {
  const group = new THREE.Group();
  const buckets = new Map<string, THREE.BufferGeometry[]>();
  const push = (key: string, g: THREE.BufferGeometry) => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key)!.push(g); };
  const roofParts: THREE.BufferGeometry[] = [];
  const roofLights: number[] = [];
  const place = (g: THREE.BufferGeometry, b: BuildingSpec, lx: number, y: number, lz: number) => {
    g.translate(lx, y, lz);
    g.rotateY(b.heading);
    g.translate(b.x, 0, b.z);
    return g;
  };
  for (const b of specs) {
    const r = mulberry32(b.seed);
    const podiumH = 7;
    // Retail podium slightly proud of the tower
    push('store', place(facadeBox(b.w + 1, podiumH, b.d + 1, STORE_TILE_W, STORE_TILE_H), b, 0, podiumH / 2, 0));
    // Tower with optional setback
    const setback = b.h > 60 && r() < 0.6;
    const mainH = setback ? b.h * (0.62 + r() * 0.15) : b.h;
    const vOff = Math.floor(r() * 8) / 8;
    push(b.style, place(facadeBox(b.w, mainH - podiumH, b.d, TILE_W, TILE_H, vOff), b, 0, podiumH + (mainH - podiumH) / 2, 0));
    let topH = mainH, topW = b.w, topD = b.d;
    if (setback) {
      topW = b.w * (0.6 + r() * 0.2); topD = b.d * (0.6 + r() * 0.2);
      push(b.style, place(facadeBox(topW, b.h - mainH, topD, TILE_W, TILE_H, vOff), b, 0, mainH + (b.h - mainH) / 2, 0));
      roofParts.push(place(new THREE.BoxGeometry(b.w + 0.4, 0.6, b.d + 0.4), b, 0, mainH + 0.3, 0)); // ledge
      topH = b.h;
    }
    // Parapet + rooftop equipment
    roofParts.push(place(new THREE.BoxGeometry(topW + 0.5, 1.1, topD + 0.5), b, 0, topH + 0.55, 0));
    const units = 2 + Math.floor(r() * 4);
    for (let k = 0; k < units; k++) {
      const s = 1.5 + r() * 3;
      roofParts.push(place(new THREE.BoxGeometry(s, 1.2 + r() * 2, s * (0.6 + r())), b, (r() - 0.5) * topW * 0.6, topH + 1.6, (r() - 0.5) * topD * 0.6));
    }
    if (r() < 0.4) roofParts.push(place(new THREE.CylinderGeometry(1.6, 1.6, 3.5, 10), b, topW * 0.2, topH + 2.8, -topD * 0.15)); // water tank
    if (b.h > 90) {
      roofParts.push(place(new THREE.CylinderGeometry(0.15, 0.25, 14, 6), b, 0, topH + 8, 0)); // antenna
      const p = new THREE.Vector3(0, topH + 15, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.heading);
      roofLights.push(b.x + p.x, p.y, b.z + p.z);
    }
  }
  for (const [key, list] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(list), facadeMaterial(key as FacadeStyle | 'store'));
    mesh.name = `buildings-${key}`;
    mesh.receiveShadow = false;
    group.add(mesh);
    list.forEach(g => g.dispose());
  }
  if (roofParts.length) {
    const roof = new THREE.Mesh(mergeGeometries(roofParts), new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.85, metalness: 0.3 }));
    roof.name = 'rooftops';
    group.add(roof);
  }
  (group.userData as { beacons: number[] }).beacons = roofLights;
  return group;
}
