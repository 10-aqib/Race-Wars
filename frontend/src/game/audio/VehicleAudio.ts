import type { AudioManager } from '../AudioManager';

/**
 * Race Wars — race audio (procedural Web Audio, no samples).
 * Every layer follows simulation values: RPM, throttle, speed, slip, brake,
 * nitro, surface and the positions/velocities of nearby traffic.
 */

export interface VehicleAudioFrame {
  rpm: number; idleRpm: number; redlineRpm: number;
  throttle: number; speed: number; topSpeed: number;
  braking: boolean; skid: number; onShoulder: boolean; boosting: boolean; horn: boolean;
}

export interface TrafficSource { id: string; x: number; z: number; vx: number; vz: number; speed: number; }

interface TrafficVoice { id: string; osc: OscillatorNode; filter: BiquadFilterNode; noiseGain: GainNode; gain: GainNode; pan: StereoPannerNode; }

const SOUND_SPEED = 120; // compressed for an audible but not cartoonish Doppler shift

export class VehicleAudio {
  private am: AudioManager;
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private running = false;
  private noise!: AudioBuffer;
  // Engine
  private oscs: OscillatorNode[] = [];
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private shiftGain!: GainNode;
  private intakeFilter!: BiquadFilterNode;
  private intakeGain!: GainNode;
  // Layers
  private tyreGainA!: GainNode; private tyreGainB!: GainNode;
  private tyreBandA!: BiquadFilterNode; private tyreBandB!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private windGain!: GainNode;
  private brakeHissGain!: GainNode;
  private brakeSqueal!: OscillatorNode; private brakeSquealGain!: GainNode;
  private turbo!: OscillatorNode; private turboGain!: GainNode; private whooshGain!: GainNode; private whooshFilter!: BiquadFilterNode;
  private hornGain!: GainNode;
  private traffic = new Map<string, TrafficVoice>();
  private time = 0;
  private lastBoost = false;

  constructor(am: AudioManager) { this.am = am; }

  get active(): boolean { return this.running; }

  start(): void {
    if (this.running) return;
    const ctx = this.am.context;
    if (!ctx) return;
    this.ctx = ctx;
    this.running = true;
    this.noise = this.makeNoise(ctx, 2);
    const eng = this.am.engineBus, fx = this.am.effectsBus;

    // ── Engine: fundamental (firing frequency), sub-octave and second harmonic through soft clipping
    this.shiftGain = this.gain(1, eng);
    this.engineGain = this.gain(0, this.shiftGain);
    this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.Q.value = 3;
    const shaper = ctx.createWaveShaper(); shaper.curve = softClip(2.5); shaper.oversample = '2x';
    const mix = this.gain(0.33, shaper);
    shaper.connect(this.engineFilter); this.engineFilter.connect(this.engineGain);
    this.nodes.push(shaper, this.engineFilter);
    for (const [type, mult, level, detune] of [['sawtooth', 1, 0.55, 0], ['square', 0.5, 0.45, 0], ['sawtooth', 2, 0.25, 7], ['triangle', 3, 0.12, -5]] as [OscillatorType, number, number, number][]) {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = detune; o.frequency.value = 60 * mult;
      (o as OscillatorNode & { mult?: number }).mult = mult;
      o.connect(this.gain(level, mix)); o.start();
      this.oscs.push(o); this.sources.push(o);
    }
    this.intakeFilter = ctx.createBiquadFilter(); this.intakeFilter.type = 'bandpass'; this.intakeFilter.Q.value = 1.2;
    this.intakeGain = this.gain(0, this.shiftGain);
    this.loopNoise().connect(this.intakeFilter); this.intakeFilter.connect(this.intakeGain);

    // ── Tyre squeal: two resonant bands with wobble
    this.tyreBandA = this.band('bandpass', 1900, 9); this.tyreBandB = this.band('bandpass', 2750, 12);
    this.tyreGainA = this.gain(0, fx); this.tyreGainB = this.gain(0, fx);
    const tyreSrc = this.loopNoise();
    tyreSrc.connect(this.tyreBandA); this.tyreBandA.connect(this.tyreGainA);
    tyreSrc.connect(this.tyreBandB); this.tyreBandB.connect(this.tyreGainB);

    // ── Rumble strips / gravel: low noise chopped by a 28 Hz square
    const rumbleLp = this.band('lowpass', 180, 1);
    this.rumbleGain = this.gain(0, fx);
    const chop = this.gain(0, this.rumbleGain);
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 28;
    const lfoDepth = this.gain(0.5, chop.gain as unknown as AudioNode); lfo.connect(lfoDepth); lfo.start(); this.sources.push(lfo);
    chop.gain.value = 0.5;
    this.loopNoise().connect(rumbleLp); rumbleLp.connect(chop);

    // ── Wind
    const windLp = this.band('lowpass', 650, 0.7);
    this.windGain = this.gain(0, fx);
    this.loopNoise().connect(windLp); windLp.connect(this.windGain);

    // ── Brakes: disc hiss + low-speed squeal
    const hissHp = this.band('highpass', 2600, 0.7);
    this.brakeHissGain = this.gain(0, fx);
    this.loopNoise().connect(hissHp); hissHp.connect(this.brakeHissGain);
    this.brakeSqueal = ctx.createOscillator(); this.brakeSqueal.type = 'sine'; this.brakeSqueal.frequency.value = 3150;
    const vib = ctx.createOscillator(); vib.frequency.value = 7; const vibDepth = this.gain(45, this.brakeSqueal.frequency as unknown as AudioNode);
    vib.connect(vibDepth); vib.start(); this.sources.push(vib);
    this.brakeSquealGain = this.gain(0, fx);
    this.brakeSqueal.connect(this.brakeSquealGain); this.brakeSqueal.start(); this.sources.push(this.brakeSqueal);

    // ── Nitro: turbo whistle + rushing air
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine'; this.turbo.frequency.value = 2400;
    this.turboGain = this.gain(0, fx); this.turbo.connect(this.turboGain); this.turbo.start(); this.sources.push(this.turbo);
    this.whooshFilter = this.band('bandpass', 900, 1.5);
    this.whooshGain = this.gain(0, fx);
    this.loopNoise().connect(this.whooshFilter); this.whooshFilter.connect(this.whooshGain);

    // ── Horn: two detuned square tones through a horn-like band
    const hornBand = this.band('bandpass', 1100, 0.9);
    this.hornGain = this.gain(0, fx);
    for (const f of [392, 494]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hornBand); o.start(); this.sources.push(o); }
    hornBand.connect(this.hornGain);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const t = this.ctx!.currentTime;
    this.engineGain.gain.setTargetAtTime(0, t, 0.05);
    const sources = this.sources, nodes = this.nodes, voices = [...this.traffic.values()];
    this.sources = []; this.nodes = []; this.oscs = []; this.traffic.clear();
    setTimeout(() => {
      for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } s.disconnect(); }
      for (const n of nodes) n.disconnect();
      for (const v of voices) { try { v.osc.stop(); } catch { /* stopped */ } v.gain.disconnect(); }
    }, 250);
  }

  update(f: VehicleAudioFrame, dt: number): void {
    if (!this.running || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.time += dt;
    const k = 0.04;
    const rpmFrac = Math.max(0, Math.min(1, (f.rpm - f.idleRpm) / (f.redlineRpm - f.idleRpm)));
    // V8 firing frequency: rpm/60 × 4 pulses per revolution
    const fire = (f.rpm / 60) * 4 * 0.5;
    for (const o of this.oscs) o.frequency.setTargetAtTime(fire * ((o as OscillatorNode & { mult?: number }).mult ?? 1), t, 0.02);
    this.engineFilter.frequency.setTargetAtTime(380 + f.throttle * 2200 + rpmFrac * 1600, t, k);
    this.engineGain.gain.setTargetAtTime(0.16 + f.throttle * 0.14 + rpmFrac * 0.1, t, 0.06);
    this.intakeFilter.frequency.setTargetAtTime(fire * 4, t, k);
    this.intakeGain.gain.setTargetAtTime(f.throttle * (0.02 + rpmFrac * 0.05), t, k);

    // Tyres: squeal needs speed; wobbling centre frequency sells the scrub
    const speedK = Math.min(1, f.speed / 8);
    const squeal = Math.pow(Math.max(0, f.skid - 0.12) / 0.88, 1.3) * speedK;
    const wob = Math.sin(this.time * 23) * 90 + Math.sin(this.time * 9.7) * 60;
    this.tyreBandA.frequency.setTargetAtTime(1750 + wob + squeal * 300, t, 0.02);
    this.tyreBandB.frequency.setTargetAtTime(2650 - wob * 0.6, t, 0.02);
    this.tyreGainA.gain.setTargetAtTime(squeal * 0.55, t, 0.05);
    this.tyreGainB.gain.setTargetAtTime(squeal * 0.32, t, 0.05);
    this.rumbleGain.gain.setTargetAtTime(f.onShoulder ? Math.min(1, f.speed / 20) * 0.5 : 0, t, 0.05);
    const sr = Math.min(1, f.speed / f.topSpeed);
    this.windGain.gain.setTargetAtTime(sr * sr * 0.3, t, 0.1);

    // Brakes
    const hiss = f.braking ? Math.min(1, f.speed / 30) * 0.08 : 0;
    this.brakeHissGain.gain.setTargetAtTime(hiss, t, 0.04);
    const squealBrake = f.braking && f.speed > 1.5 && f.speed < 9 ? 0.05 * (1 - f.speed / 9) : 0;
    this.brakeSquealGain.gain.setTargetAtTime(squealBrake, t, 0.05);

    // Nitro
    if (f.boosting && !this.lastBoost) this.burst(this.whooshGain, 0.35, 0.6);
    if (!f.boosting && this.lastBoost) this.blowOff(0.18);
    this.lastBoost = f.boosting;
    this.turbo.frequency.setTargetAtTime(2300 + sr * 1900, t, 0.1);
    this.turboGain.gain.setTargetAtTime(f.boosting ? 0.045 : 0, t, f.boosting ? 0.08 : 0.2);
    this.whooshFilter.frequency.setTargetAtTime(f.boosting ? 700 + sr * 1600 : 500, t, 0.1);
    this.whooshGain.gain.setTargetAtTime(f.boosting ? 0.12 : 0, t, f.boosting ? 0.1 : 0.25);

    this.hornGain.gain.setTargetAtTime(f.horn ? 0.11 : 0, t, 0.012);
  }

  /** Gear change: ignition cut, blow-off valve on upshifts, gearbox clunk. */
  gearShift(up: boolean): void {
    if (!this.running || !this.ctx) return;
    const t = this.ctx.currentTime, g = this.shiftGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(up ? 0.25 : 0.6, t + 0.035);
    g.linearRampToValueAtTime(1, t + (up ? 0.17 : 0.1));
    if (up) this.blowOff(0.11);
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(up ? 110 : 140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.07);
    const gg = ctx.createGain(); gg.gain.setValueAtTime(0.18, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(gg); gg.connect(this.am.effectsBus); o.start(t); o.stop(t + 0.1);
  }

  /** Spatial traffic: engine + road noise per nearby car with pan and Doppler. */
  updateTraffic(lx: number, lz: number, heading: number, lvx: number, lvz: number, cars: TrafficSource[]): void {
    if (!this.running || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const near = cars.map(c => ({ c, d: Math.hypot(c.x - lx, c.z - lz) })).filter(n => n.d < 70).sort((a, b) => a.d - b.d).slice(0, 3);
    const keep = new Set(near.map(n => n.c.id));
    for (const [id, v] of this.traffic) if (!keep.has(id)) { v.gain.gain.setTargetAtTime(0, t, 0.15); setTimeout(() => { try { v.osc.stop(); } catch { /* stopped */ } v.gain.disconnect(); }, 600); this.traffic.delete(id); }
    const rx = Math.cos(heading), rz = -Math.sin(heading);
    for (const { c, d } of near) {
      let v = this.traffic.get(c.id);
      if (!v) {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth';
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 420;
        const gain = ctx.createGain(); gain.gain.value = 0;
        const pan = ctx.createStereoPanner();
        const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.6;
        const roadLp = ctx.createBiquadFilter(); roadLp.type = 'lowpass'; roadLp.frequency.value = 900;
        const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true; n.start();
        n.connect(roadLp); roadLp.connect(noiseGain); noiseGain.connect(gain);
        osc.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.am.effectsBus); osc.start();
        v = { id: c.id, osc, filter, noiseGain, gain, pan };
        this.traffic.set(c.id, v);
        this.sources.push(n);
      }
      const dx = (c.x - lx) / Math.max(d, 0.1), dz = (c.z - lz) / Math.max(d, 0.1);
      const vRel = (lvx - c.vx) * dx + (lvz - c.vz) * dz; // closing speed along the line of sight
      const doppler = Math.max(0.6, Math.min(1.6, SOUND_SPEED / (SOUND_SPEED - vRel)));
      v.osc.frequency.setTargetAtTime((38 + c.speed * 2.1) * doppler, t, 0.05);
      v.gain.gain.setTargetAtTime(Math.min(0.22, 2.4 / Math.max(3, d)) * 0.5, t, 0.05);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, dx * rx + dz * rz)), t, 0.05);
    }
  }

  /** One-shot car horn from a traffic vehicle, panned toward its position. */
  trafficHorn(pan: number, distance: number): void {
    if (!this.running || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    const level = Math.min(0.14, 1.6 / Math.max(4, distance));
    g.gain.linearRampToValueAtTime(level, t + 0.02); g.gain.setValueAtTime(level, t + 0.42); g.gain.linearRampToValueAtTime(0, t + 0.5);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = 1;
    for (const f of [420, 530]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(band); o.start(t); o.stop(t + 0.52); }
    band.connect(g); g.connect(p); p.connect(this.am.effectsBus);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private gain(v: number, to: AudioNode): GainNode {
    const g = this.ctx!.createGain(); g.gain.value = v; g.connect(to); this.nodes.push(g); return g;
  }

  private band(type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
    const b = this.ctx!.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; this.nodes.push(b); return b;
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); this.sources.push(s); return s;
  }

  private burst(target: GainNode, level: number, dur: number): void {
    const t = this.ctx!.currentTime;
    target.gain.cancelScheduledValues(t); target.gain.setValueAtTime(level, t); target.gain.setTargetAtTime(0.12, t + 0.05, dur / 3);
  }

  /** Turbo blow-off valve: a short, falling burst of filtered air. */
  private blowOff(level: number): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    s.connect(f); f.connect(g); g.connect(this.am.effectsBus); s.start(t, Math.random()); s.stop(t + 0.35);
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  return c;
}
