/**
 * Race Wars — Audio Manager
 * Centralized Web Audio API engine.
 * ALL audio in the game routes through here.
 *
 * Architecture:
 *  - Procedurally synthesized engine tone (oscillator) — no MP3 dependency
 *  - Squealing tires — filtered noise
 *  - Impact sounds — synthesized
 *  - UI beep
 *  - All volumes respond in real time to settings sliders
 */

import { settings } from '../state/SettingsManager';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private engineGain!: GainNode;
  private effectsGain!: GainNode;
  private musicGain!: GainNode;

  // Engine
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineOscGain: GainNode | null = null;
  private engineRunning = false;

  // @ts-ignore
  private _tireNoise: AudioBufferSourceNode | null = null;
  private tireGainNode: GainNode | null = null;
  private tireTarget = 0;
  private tireCurrent = 0;

  // @ts-ignore
  private _windNoise: AudioBufferSourceNode | null = null;
  private windGainNode: GainNode | null = null;
  private windTarget = 0;
  private windCurrent = 0;

  // Boost layer
  private boostOsc: OscillatorNode | null = null;
  private boostGain: GainNode | null = null;

  // State
  private _initialized = false;


  constructor() {
    // Resume on first user interaction
    const resume = () => {
      this._ensureContext();
    };
    window.addEventListener('keydown', resume, { once: true });
    window.addEventListener('click', resume, { once: true });

    // React to settings changes
    settings.onChange(() => this._applyVolumes());
  }

  private _ensureContext(): void {
    if (this._initialized) return;
    try {
      this.ctx = new AudioContext();
      this._buildGraph();
      this._initialized = true;
      this._applyVolumes();
    } catch (e) {
      console.warn('[AudioManager] Web Audio API not available:', e);
    }
  }

  private _buildGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // Master
    this.masterGain = ctx.createGain();
    this.masterGain.connect(ctx.destination);

    // Buses
    this.engineGain = ctx.createGain();
    this.effectsGain = ctx.createGain();
    this.musicGain = ctx.createGain();

    this.engineGain.connect(this.masterGain);
    this.effectsGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);

    this._applyVolumes();

    // Build tire noise buffer (white noise)
    this._buildTireNoise();
    this._buildWindNoise();
  }

  private _applyVolumes(): void {
    if (!this._initialized) return;
    const s = settings.getAll();
    const master = s.muted ? 0 : s.masterVolume / 100;
    this.masterGain.gain.setTargetAtTime(master, this.ctx!.currentTime, 0.05);
    this.engineGain.gain.setTargetAtTime(s.engineVolume / 100, this.ctx!.currentTime, 0.05);
    this.effectsGain.gain.setTargetAtTime(s.effectsVolume / 100, this.ctx!.currentTime, 0.05);
    this.musicGain.gain.setTargetAtTime(s.musicVolume / 100, this.ctx!.currentTime, 0.05);
  }

  private _createNoiseBuffer(duration = 2): AudioBuffer {
    const ctx = this.ctx!;
    const sampleRate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private _buildTireNoise(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const buf = this._createNoiseBuffer(3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    // Band-pass to get squealy frequency range
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 1200;
    bpf.Q.value = 0.8;

    this.tireGainNode = ctx.createGain();
    this.tireGainNode.gain.value = 0;

    src.connect(bpf);
    bpf.connect(this.tireGainNode);
    this.tireGainNode.connect(this.effectsGain);
    src.start();
    this._tireNoise = src;
  }

  private _buildWindNoise(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const buf = this._createNoiseBuffer(4);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 800;

    this.windGainNode = ctx.createGain();
    this.windGainNode.gain.value = 0;

    src.connect(lpf);
    lpf.connect(this.windGainNode);
    this.windGainNode.connect(this.effectsGain);
    src.start();
    this._windNoise = src;
  }

  // ─── ENGINE ────────────────────────────────────────────────────────────────

  public startEngine(): void {
    this._ensureContext();
    if (!this.ctx || this.engineRunning) return;
    const ctx = this.ctx;

    this.engineOscGain = ctx.createGain();
    this.engineOscGain.gain.value = 0.15;
    this.engineOscGain.connect(this.engineGain);

    // Primary tone — sawtooth for growl
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60; // idle Hz

    // Second harmonic
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 120;

    // Low-pass filter to smooth harsh edges
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 600;
    lpf.Q.value = 0.5;

    const g2 = ctx.createGain();
    g2.gain.value = 0.4;

    this.engineOsc.connect(lpf);
    this.engineOsc2.connect(g2);
    g2.connect(lpf);
    lpf.connect(this.engineOscGain);

    this.engineOsc.start();
    this.engineOsc2.start();
    this.engineRunning = true;
  }

  public stopEngine(): void {
    this.stopBoost();
    if (this.ctx) {
      this.tireGainNode?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.windGainNode?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    if (!this.engineRunning) return;
    try {
      this.engineOsc?.stop();
      this.engineOsc2?.stop();
    } catch (_) { /* already stopped */ }
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineRunning = false;
  }

  /**
   * Call every frame with vehicle state.
   * @param rpmFactor  0–1 (0=idle, 1=redline within current gear)
   * @param throttle   true if W is held
   * @param speed      m/s absolute
   * @param maxSpeed   vehicle max m/s
   * @param isBraking  true if heavy brake input
   * @param slipFactor 0–1 tire slip estimate
   */
  public updateVehicleAudio(
    rpmFactor: number,
    throttle: boolean,
    speed: number,
    maxSpeed: number,
    _isBraking: boolean,
    slipFactor: number
  ): void {
    if (!this.ctx || !this.engineRunning) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Engine pitch: idle 60 Hz → redline 220 Hz
    const baseHz = 60 + rpmFactor * 160;
    const throttleBoost = throttle ? 20 : 0;
    const targetHz = baseHz + throttleBoost;
    this.engineOsc!.frequency.setTargetAtTime(targetHz, t, 0.08);
    this.engineOsc2!.frequency.setTargetAtTime(targetHz * 2.01, t, 0.08);

    // Engine volume — louder under throttle, softer on coast
    const engVol = 0.08 + rpmFactor * 0.12 + (throttle ? 0.05 : 0);
    this.engineOscGain!.gain.setTargetAtTime(engVol, t, 0.1);

    // Tire squeal
    this.tireTarget = Math.min(1, slipFactor * 2.5);
    this.tireCurrent += (this.tireTarget - this.tireCurrent) * 0.1;
    if (this.tireGainNode) {
      this.tireGainNode.gain.setTargetAtTime(this.tireCurrent * 0.4, t, 0.05);
    }

    // Wind — grows with speed
    const speedRatio = Math.min(1, speed / maxSpeed);
    this.windTarget = speedRatio * speedRatio * 0.35;
    this.windCurrent += (this.windTarget - this.windCurrent) * 0.05;
    if (this.windGainNode) {
      this.windGainNode.gain.setTargetAtTime(this.windCurrent, t, 0.05);
    }
  }

  // ─── BOOST ─────────────────────────────────────────────────────────────────

  public startBoost(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (this.boostOsc) return;

    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    this.boostGain.connect(this.effectsGain);

    this.boostOsc = ctx.createOscillator();
    this.boostOsc.type = 'sawtooth';
    this.boostOsc.frequency.value = 280;

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'highpass';
    bpf.frequency.value = 200;

    this.boostOsc.connect(bpf);
    bpf.connect(this.boostGain);
    this.boostOsc.start();

    this.boostGain.gain.setTargetAtTime(0.12, ctx.currentTime, 0.1);
  }

  public stopBoost(): void {
    if (!this.ctx || !this.boostOsc) return;
    const t = this.ctx.currentTime;
    this.boostGain?.gain.setTargetAtTime(0, t, 0.2);
    const osc = this.boostOsc;
    this.boostOsc = null;
    this.boostGain = null;
    setTimeout(() => { try { osc.stop(); } catch (_) {} }, 400);
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  public playCrash(intensity: number = 1): void {
    this._playSynthHit(intensity);
  }

  public playGearShift(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(g);
    g.connect(this.effectsGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }

  public playUIClick(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05 * settings.get('uiVolume') / 100, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  public playCountdown(isGo: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const hz = isGo ? 880 : 440;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isGo ? 0.4 : 0.2));
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + (isGo ? 0.4 : 0.2));
  }

  private _playSynthHit(intensity: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const buf = this._createNoiseBuffer(0.4);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 300 + intensity * 600;

    const g = ctx.createGain();
    g.gain.setValueAtTime(intensity * 0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    src.connect(lpf);
    lpf.connect(g);
    g.connect(this.effectsGain);
    src.start();
    src.stop(ctx.currentTime + 0.4);
  }

  // ─── SIMPLE MUSIC (procedural, no MP3 needed) ──────────────────────────────

  private musicNodes: (OscillatorNode | GainNode | AudioBufferSourceNode)[] = [];
  private musicPlaying = false;
  private musicGeneration = 0;

  public startMenuMusic(): void {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this._playDroneLoop();
  }

  public startRaceMusic(): void {
    if (!this.ctx) return;
    this.stopMusic();
    this.musicPlaying = true;
    this._playRaceLoop();
  }

  public stopMusic(fadeDuration = 1.0): void {
    if (!this.ctx) return;
    this.musicGeneration++;
    const oldNodes = this.musicNodes;
    this.musicNodes = [];
    // fade out all music nodes
    oldNodes.forEach((n) => {
      if (n instanceof GainNode) {
        n.gain.setTargetAtTime(0, this.ctx!.currentTime, fadeDuration / 3);
      }
    });
    setTimeout(() => {
      oldNodes.forEach((n) => {
        try {
          if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) n.stop();
        } catch (_) {}
      });
    }, fadeDuration * 1000 + 200);
    this.musicPlaying = false;
  }

  private _playDroneLoop(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // Low ambient pad
    const freqs = [55, 82.5, 110, 165];
    freqs.forEach((hz, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = 0.015;
      osc.connect(g);
      g.connect(this.musicGain);
      osc.start();
      this.musicNodes.push(osc, g);
    });
  }

  private _playRaceLoop(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // Energetic arpeggio using periodic gain modulation
    const root = 110;
    const pattern = [1, 1.25, 1.5, 2, 1.5, 1.25];
    let step = 0;
    const generation = this.musicGeneration;

    const playStep = () => {
      if (!this.musicPlaying || !this.ctx || generation !== this.musicGeneration) return;
      const hz = root * pattern[step % pattern.length];
      step++;

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz;

      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 1200;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.03, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

      osc.connect(lpf);
      lpf.connect(g);
      g.connect(this.musicGain);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);

      setTimeout(playStep, 130);
    };

    playStep();
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  /** Current output gain (0 when muted) — exposed for QA checks. */
  public get outputLevel(): number {
    const s = settings.getAll();
    return s.muted ? 0 : s.masterVolume / 100;
  }

  public get engineActive(): boolean { return this.engineRunning; }

  public resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
}

export const audioManager = new AudioManager();
