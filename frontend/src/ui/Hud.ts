import * as THREE from 'three';
import type { Track } from '../game/track/Track';
import type { Standing } from '../game/race/RaceManager';

/**
 * Race Wars — racing HUD. Values come straight from simulation state each
 * frame; DOM writes are skipped when the displayed text has not changed.
 */

export interface HudFrame {
  speed: number;            // display units
  unit: string;
  gear: string;
  rpm: number;              // absolute
  redline: number;
  nitro: number;            // 0..1
  boosting: boolean;
  raceTime: number;
  lap: number;
  laps: number;
  lastLap: number;
  bestLap: number;
  position: number;
  racers: number;
  progress: number;         // 0..1 of race distance
  remaining: number;        // metres to finish
  standings: Standing[];
  freeMode: boolean;
  wrongWay: boolean;
  cameraMode: string;
  markers: { id: string; x: number; z: number; color: string; player?: boolean; heading?: number; traffic?: boolean }[];
  labels: { id: string; name: string; pos: THREE.Vector3; position: number; dist: number }[];
}

const TICKS = 9;

export class Hud {
  private root = document.getElementById('racing-hud')!;
  private cache = new Map<string, string>();
  private mapCanvas: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private mapStatic: HTMLCanvasElement | null = null;
  private mapTransform = { scale: 1, ox: 0, oz: 0 };
  private mapTimer = 0;
  private rpmNeedle: SVGElement | null;
  private rpmArc: SVGPathElement | null;
  private nitroArc: SVGPathElement | null;
  private labelPool = new Map<string, HTMLElement>();
  private messageTimer = 0;
  private track: Track | null = null;
  private v = new THREE.Vector3();

  constructor() {
    this.mapCanvas = document.getElementById('hud-minimap-canvas') as HTMLCanvasElement;
    this.mapCtx = this.mapCanvas.getContext('2d')!;
    this.rpmNeedle = document.getElementById('rpm-needle') as unknown as SVGElement | null;
    this.rpmArc = document.getElementById('rpm-arc') as unknown as SVGPathElement | null;
    this.nitroArc = document.getElementById('nitro-arc') as unknown as SVGPathElement | null;
    this.buildTicks();
  }

  private buildTicks(): void {
    const g = document.getElementById('rpm-ticks');
    if (!g) return;
    let html = '';
    for (let i = 0; i <= TICKS; i++) {
      const a = (-225 + (i / TICKS) * 270) * Math.PI / 180;
      const x1 = 60 + Math.cos(a) * 46, y1 = 60 + Math.sin(a) * 46;
      const x2 = 60 + Math.cos(a) * 52, y2 = 60 + Math.sin(a) * 52;
      const tx = 60 + Math.cos(a) * 37, ty = 60 + Math.sin(a) * 37 + 3;
      html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${i >= TICKS - 1 ? 'tick tick--red' : 'tick'}"/>`;
      html += `<text x="${tx}" y="${ty}" class="tick-label">${i}</text>`;
    }
    g.innerHTML = html;
  }

  setTrack(track: Track): void {
    this.track = track;
    this.mapStatic = null;
  }

  private set(id: string, text: string): void {
    if (this.cache.get(id) === text) return;
    this.cache.set(id, text);
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  private toggle(id: string, cls: string, on: boolean): void {
    const key = `${id}:${cls}`;
    const v = on ? '1' : '0';
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    document.getElementById(id)?.classList.toggle(cls, on);
  }

  update(f: HudFrame, camera: THREE.Camera, dt: number): void {
    this.set('hud-speed', Math.round(f.speed).toString().padStart(3, '0'));
    this.set('hud-speed-unit', f.unit);
    this.set('hud-gear', f.gear);
    this.toggle('hud-gear', 'gear--redline', f.rpm > f.redline * 0.93);
    this.set('hud-rpm', `${(f.rpm / 1000).toFixed(1)}`);
    this.set('hud-timer', formatTime(f.raceTime));
    this.set('hud-lap', f.freeMode ? 'FREE DRIVE' : `LAP ${f.lap}/${f.laps}`);
    this.set('hud-best', f.bestLap ? `BEST ${formatTime(f.bestLap)}` : f.lastLap ? `LAST ${formatTime(f.lastLap)}` : 'BEST --:--.---');
    this.set('hud-position', f.freeMode ? '--' : `${f.position}`);
    this.set('hud-position-total', f.freeMode ? '' : `/${f.racers}`);
    this.set('hud-progress-text', f.freeMode ? `${(f.remaining / 1000).toFixed(1)} KM DRIVEN` : `${(f.remaining / 1000).toFixed(2)} KM TO GO`);
    this.set('hud-camera', f.cameraMode.toUpperCase());
    const prog = document.getElementById('hud-progress-fill');
    const pw = `${(f.progress * 100).toFixed(1)}%`;
    if (prog && this.cache.get('pw') !== pw) { prog.style.width = pw; this.cache.set('pw', pw); }
    this.toggle('hud-wrong-way', 'is-visible', f.wrongWay);
    this.toggle('hud-nitro-wrap', 'is-boosting', f.boosting);
    this.set('hud-nitro-pct', `${Math.round(f.nitro * 100)}`);

    // Gauges
    const rpmFrac = Math.min(1, f.rpm / (Math.ceil(f.redline / 1000) * 1000 + 1000));
    const ang = -225 + rpmFrac * 270;
    const rpmKey = ang.toFixed(1);
    if (this.rpmNeedle && this.cache.get('needle') !== rpmKey) { this.rpmNeedle.setAttribute('transform', `rotate(${ang + 90} 60 60)`); this.cache.set('needle', rpmKey); }
    if (this.rpmArc) setArc(this.rpmArc, 52, -225, ang, this.cache, 'rpmarc');
    if (this.nitroArc) setArc(this.nitroArc, 50, -225, -225 + f.nitro * 270, this.cache, 'nitroarc');

    // Standings board
    const board = f.standings.map(s => `${s.position}|${s.name}|${s.isPlayer ? '' : s.finished ? 'FIN' : gapText(s, f.standings)}`).join(';');
    if (this.cache.get('board') !== board) {
      this.cache.set('board', board);
      const el = document.getElementById('hud-board');
      if (el) el.innerHTML = f.standings.map(s => `<div class="board__row${s.isPlayer ? ' board__row--me' : ''}"><span class="board__pos">${s.position}</span><span class="board__name">${escapeHtml(s.name)}</span><span class="board__gap">${s.isPlayer ? '' : s.finished ? 'FIN' : gapText(s, f.standings)}</span></div>`).join('');
    }

    // Minimap at ~30 Hz
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) { this.mapTimer = 1 / 30; this.drawMap(f.markers); }

    this.updateLabels(f.labels, camera);

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) document.getElementById('hud-message')?.classList.remove('is-visible');
    }
  }

  message(text: string, seconds = 2, tone: 'normal' | 'red' = 'normal'): void {
    const el = document.getElementById('hud-message');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hud-message--red', tone === 'red');
    el.classList.add('is-visible');
    this.messageTimer = seconds;
  }

  private drawMap(markers: HudFrame['markers']): void {
    const t = this.track;
    if (!t) return;
    const c = this.mapCanvas, ctx = this.mapCtx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = c.clientWidth || 180;
    if (c.width !== Math.round(size * dpr)) { c.width = Math.round(size * dpr); c.height = Math.round(size * dpr); this.mapStatic = null; }
    if (!this.mapStatic) this.mapStatic = this.renderStaticMap(t, c.width);
    const { scale, ox, oz } = this.mapTransform;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this.mapStatic, 0, 0);
    for (const m of markers) {
      const x = (m.x - ox) * scale, y = (m.z - oz) * scale;
      if (m.traffic) { ctx.fillStyle = 'rgba(200,200,200,0.55)'; ctx.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr); continue; }
      if (m.player) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-(m.heading ?? 0));
        ctx.fillStyle = m.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(0, -7 * dpr); ctx.lineTo(5 * dpr, 6 * dpr); ctx.lineTo(0, 3 * dpr); ctx.lineTo(-5 * dpr, 6 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = m.color; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }

  private renderStaticMap(t: Track, px: number): HTMLCanvasElement {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.count; i++) { minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]); minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]); }
    const pad = px * 0.1;
    const scale = (px - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = minX - (px / scale - (maxX - minX)) / 2, oz = minZ - (px / scale - (maxZ - minZ)) / 2;
    this.mapTransform = { scale, ox, oz };
    const c = document.createElement('canvas'); c.width = c.height = px;
    const ctx = c.getContext('2d')!;
    const path = () => { ctx.beginPath(); for (let i = 0; i <= t.count; i += 2) { const k = i % t.count; const x = (t.px[k] - ox) * scale, y = (t.pz[k] - oz) * scale; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); };
    ctx.lineJoin = 'round';
    path(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = px * 0.06; ctx.stroke();
    path(); ctx.strokeStyle = 'rgba(235,235,240,0.85)'; ctx.lineWidth = px * 0.022; ctx.stroke();
    // Start/finish marker
    const sx = (t.px[0] - ox) * scale, sy = (t.pz[0] - oz) * scale;
    ctx.fillStyle = '#e11d2a'; ctx.fillRect(sx - px * 0.035, sy - px * 0.008, px * 0.07, px * 0.016);
    return c;
  }

  private updateLabels(labels: HudFrame['labels'], camera: THREE.Camera): void {
    const host = document.getElementById('hud-labels');
    if (!host) return;
    const seen = new Set<string>();
    const w = window.innerWidth, h = window.innerHeight;
    for (const l of labels) {
      let el = this.labelPool.get(l.id);
      if (!el) { el = document.createElement('div'); el.className = 'car-tag'; host.appendChild(el); this.labelPool.set(l.id, el); }
      seen.add(l.id);
      this.v.copy(l.pos).project(camera);
      const visible = this.v.z < 1 && this.v.z > -1 && l.dist < 160 && l.dist > 6;
      if (!visible) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
      const text = `P${l.position} ${l.name} · ${Math.round(l.dist)}m`;
      if (el.textContent !== text) el.textContent = text;
    }
    for (const [id, el] of this.labelPool) if (!seen.has(id)) { el.remove(); this.labelPool.delete(id); }
  }

  clear(): void {
    this.cache.clear();
    for (const el of this.labelPool.values()) el.remove();
    this.labelPool.clear();
    document.getElementById('hud-message')?.classList.remove('is-visible');
  }

  get element(): HTMLElement { return this.root; }
}

function setArc(path: SVGPathElement, r: number, a0: number, a1: number, cache: Map<string, string>, key: string): void {
  const k = a1.toFixed(1);
  if (cache.get(key) === k) return;
  cache.set(key, k);
  if (a1 - a0 < 0.5) { path.setAttribute('d', ''); return; }
  const p = (a: number) => `${60 + Math.cos(a * Math.PI / 180) * r} ${60 + Math.sin(a * Math.PI / 180) * r}`;
  path.setAttribute('d', `M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`);
}

export function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.floor((t * 1000) % 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function gapText(s: Standing, all: Standing[]): string {
  const me = all.find(x => x.isPlayer);
  if (!me) return '';
  const diff = s.progress - me.progress;
  return `${diff >= 0 ? '+' : '-'}${Math.abs(Math.round(diff))}m`;
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
