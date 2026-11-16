import * as THREE from 'three';
import { Input } from './Input';
import { getTrack, wrapAngle, type Track } from './track/Track';
import { RaceManager, type RacerSpec, type RaceOptions, type Racer } from './race/RaceManager';
import { CityScene } from './world/CityScene';
import { GarageScene, type GarageMode } from './world/GarageScene';
import { CarView } from './render/CarView';
import { TrafficView } from './render/TrafficView';
import { RaceCamera, type CameraMode } from './render/RaceCamera';
import { ParticleSystem } from './render/Particles';
import { PostFX } from './render/PostFX';
import { createGarageEnv, createNightCityEnv } from './render/Environment';
import { smokeTexture, glowTexture } from './render/Textures';
import { preloadCarModel, modelStatus } from './render/CarModel';
import { CAR_CATALOGUE, PAINT_COLORS, getCarById, type CarConfig } from './CarConfig';
import { audioManager } from './AudioManager';
import { VehicleAudio } from './audio/VehicleAudio';
import { gameState, type GameState } from '../state/StateManager';
import { settings, type GameSettings } from '../state/SettingsManager';
import { profile } from '../state/ProfileManager';
import { Hud, type HudFrame } from '../ui/Hud';
import type { NetworkManager, PlayerInfo, PlayerState } from '../network/NetworkManager';
import type { Body } from './physics/PhysicsWorld';
import { VehicleSim } from './vehicle/VehicleSim';

/**
 * Race Wars — game orchestrator.
 *
 * One requestAnimationFrame loop. Simulation advances in fixed 1/120 s steps
 * (accumulator, capped catch-up) and rendering interpolates between the last
 * two physics states, so gameplay is frame-rate independent.
 */

export const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.25;
const RIVALS: { id: string; name: string; carId: string; paint: number; personality: 'balanced' | 'aggressive' }[] = [
  { id: 'ai-blue', name: 'RAYAN', carId: 'apex_gt', paint: 0x1f4fd1, personality: 'balanced' },
  { id: 'ai-green', name: 'ZAIN', carId: 'nova_rs', paint: 0x1b9a3a, personality: 'aggressive' },
];
const MARKER_COLORS: Record<string, string> = { 'ai-blue': '#3b7bff', 'ai-green': '#2fd05a' };

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly track: Track;
  readonly race: RaceManager;
  readonly input = new Input();
  readonly garage: GarageScene;
  city: CityScene | null = null;
  readonly camera: RaceCamera;
  readonly hud = new Hud();
  private post: PostFX;
  private network: NetworkManager;
  private nightEnv: THREE.Texture;
  private garageEnv: THREE.Texture;
  private views = new Map<string, CarView>();
  private trafficViews = new Map<string, TrafficView>();
  private smoke: ParticleSystem;
  private sparks: ParticleSystem;
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private inRace = false;
  private quality: GameSettings['qualityPreset'] = 'medium';
  private lastGear = 0;
  private driftScore = 0;
  private driftTime = 0;
  private driftCooldown = 0;
  readonly vehicleAudio = new VehicleAudio(audioManager);
  private hornCooldown = new Map<string, number>();
  private remoteTargets = new Map<string, PlayerState & { t: number }>();
  private netAccum = 0;
  private finishedHandled = false;
  private lastCountdown: number | null = null;
  private fps = 60;
  private frameTimes: number[] = [];
  /** Wall-clock seconds spent on the last frames (QA/perf). */
  readonly perf = { frames: 0, simSteps: 0, avgFrameMs: 0, drawCalls: 0, triangles: 0 };
  onResults?: () => void;
  onLapMessage?: (text: string) => void;

  constructor(network: NetworkManager) {
    this.network = network;
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.get('antiAliasing'), powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.track = getTrack();
    this.race = new RaceManager(this.track);
    this.garage = new GarageScene(window.innerWidth / window.innerHeight);
    this.camera = new RaceCamera(this.track, window.innerWidth / window.innerHeight);
    this.nightEnv = createNightCityEnv(this.renderer);
    this.garageEnv = createGarageEnv(this.renderer);
    this.garage.scene.environment = this.garageEnv;
    this.post = new PostFX(this.renderer, this.garage.scene, this.garage.camera);
    this.smoke = new ParticleSystem({ max: 420, texture: smokeTexture(), color: 0xb9bcc4, drag: 1.1, grow: 1.4, fade: 1.3 });
    this.sparks = new ParticleSystem({ max: 200, texture: glowTexture(), color: 0xffb347, additive: true, gravity: 9, drag: 0.5, fade: 1 });
    this.hud.setTrack(this.track);

    this.race.onLap = (r, lap) => {
      if (r !== this.race.player || r.finished) return;
      const laps = this.race.options.laps;
      if (r.lapsDone === laps - 1 && laps > 1) this.hud.message(`FINAL LAP · ${fmt(lap)}`, 2.4, 'red');
      else this.hud.message(`LAP ${r.lapsDone} · ${fmt(lap)}`, 2.2);
    };
    this.race.onFinish = r => { if (r === this.race.player) this.onPlayerFinished(r); };
    this.race.onComplete = () => this.showResults();

    window.addEventListener('resize', () => this.onResize());
    settings.onChange(s => this.applySettings(s));
    gameState.onStateChange((n, o) => this.onStateChange(n, o));
    this.applySettings(settings.getAll());
    this.bindNetwork();
    this.bindGarageControls();
  }

  /** Load the car model and populate the garage; resolves when the first frame can render. */
  async init(): Promise<void> {
    await preloadCarModel();
    this.refreshHero();
    this.garage.setRivals(RIVALS.map(r => new CarView({ paint: r.paint, wing: true })));
    await this.garage.hero!.ready;
    // Build the city while the menu is shown
    setTimeout(() => this.ensureCity(), 50);
  }

  get modelStatus() { return modelStatus(); }

  private ensureCity(): CityScene {
    if (!this.city) {
      this.city = new CityScene(this.track);
      this.city.scene.environment = this.nightEnv;
      this.city.scene.add(this.smoke.mesh, this.sparks.mesh);
      this.city.setQuality(this.quality, settings.get('shadows'));
      this.prewarmCity(this.city);
    }
    return this.city;
  }

  /** Compile the race scene's shaders in the background so starting a race does not stall. */
  private prewarmCity(city: CityScene): void {
    const car = new CarView({ paint: 0xb3121b, wing: true, headlightBeam: true });
    const traffic = new TrafficView(1);
    car.ready.then(() => {
      const p = this.track.pointAt(0, 0);
      car.setPose(p.x, p.z, this.track.headingAt(0));
      traffic.group.visible = true;
      traffic.group.position.set(p.x, 0, p.z - 20);
      city.scene.add(car.group, traffic.group);
      this.camera.update(p.x, p.z, this.track.headingAt(0), new VehicleSim(this.selectedConfig()), 0);
      const done = () => { if (!this.inRace) { car.dispose(); traffic.dispose(); } else { car.group.removeFromParent(); traffic.group.removeFromParent(); } };
      this.renderer.compileAsync(city.scene, this.camera.camera).then(done, done);
    });
  }

  // ── Menu cars ──────────────────────────────────────────────────────────────

  selectedConfig(): CarConfig { return getCarById(settings.get('selectedCarId')); }

  selectedPaint(): number { return PAINT_COLORS[settings.get('selectedColor')] ?? this.selectedConfig().bodyColor; }

  /** Rebuild the garage hero car for the current selection (or a previewed catalogue car). */
  refreshHero(previewId?: string): void {
    const cfg = previewId ? getCarById(previewId) : this.selectedConfig();
    const paint = previewId && previewId !== settings.get('selectedCarId') ? cfg.bodyColor : this.selectedPaint();
    const view = new CarView({ paint, wing: cfg.id === 'apex_gt' || cfg.id === 'titan_xr' || cfg.id === 'nova_rs', trim: cfg.id === 'titan_xr' ? 'chrome' : 'dark' });
    this.garage.setHero(view);
  }

  setHeroPaint(hex: number): void { this.garage.hero?.setPaint(hex); }

  private bindGarageControls(): void {
    const canvas = this.renderer.domElement;
    let dragging = false, lastX = 0;
    canvas.addEventListener('pointerdown', e => { if (gameState.is('GARAGE')) { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); } });
    canvas.addEventListener('pointermove', e => { if (dragging) { this.garage.rotateSelected((e.clientX - lastX) * 0.01); lastX = e.clientX; } });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('wheel', e => { if (gameState.is('GARAGE')) { this.garage.zoom(e.deltaY * 0.0012); e.preventDefault(); } }, { passive: false });
  }

  // ── State handling ─────────────────────────────────────────────────────────

  private onStateChange(state: GameState, old: GameState): void {
    const menuModes: Partial<Record<GameState, GarageMode>> = {
      INTRO: 'intro', HOME: 'home', RACE_LOBBY: 'lobby', LOBBY: 'lobby', GARAGE: 'select', PROFILE: 'profile', SETTINGS: 'settings', MULTIPLAYER: 'home',
    };
    this.input.gameplayActive = gameState.isGameplay();
    const mode = menuModes[state];
    if (mode && !(state === 'SETTINGS' && old === 'PAUSED')) {
      if (this.inRace) this.endRace();
      this.garage.setMode(mode, old === 'LOADING' || old === 'RESULTS' || old === 'PAUSED');
      this.input.clearAll();
      this.vehicleAudio.stop();
      if (state !== 'INTRO') audioManager.startMenuMusic();
    }
    if (state === 'PAUSED') { this.vehicleAudio.stop(); this.input.clearAll(); }
    if (state === 'DISCONNECTED' && this.inRace) this.endRace();
    if (state === 'RACING' && old === 'PAUSED') { this.vehicleAudio.start(); this.lastTime = performance.now(); }
    if (state === 'COUNTDOWN' && old !== 'PAUSED') this.lastCountdown = null;
  }

  /** Begin an offline race (or Free Drive) from the race lobby / results. */
  startOfflineRace(): void {
    const opts: RaceOptions = {
      mode: settings.get('raceMode'),
      laps: settings.get('laps'),
      difficulty: settings.get('difficulty'),
      traffic: settings.get('traffic'),
      seed: (Date.now() % 100000) + 1,
    };
    if (new URLSearchParams(location.search).has('seed')) opts.seed = Number(new URLSearchParams(location.search).get('seed')) || 1;
    const specs: RacerSpec[] = [{ id: 'player', name: settings.get('playerName') || 'YOU', config: this.selectedConfig(), kind: 'player', grid: 0 }];
    if (opts.mode === 'race') RIVALS.forEach((r, i) => specs.push({ id: r.id, name: r.name, config: { ...getCarById(r.carId), bodyColor: r.paint }, kind: 'ai', personality: r.personality, grid: i + 1 }));
    this.beginRace(opts, specs);
    this.race.startCountdown();
    gameState.setState('COUNTDOWN');
  }

  /** Begin an online race: remote players are kinematic bodies driven by network updates. */
  startOnlineRace(players: PlayerInfo[]): void {
    const myId = this.network.getId();
    const ids = players.map(p => p.id).sort();
    const specs: RacerSpec[] = players.map(p => ({
      id: p.id === myId ? 'player' : p.id,
      name: p.name,
      config: { ...getCarById(p.carId ?? 'vortex_r'), bodyColor: PAINT_COLORS[p.color] ?? 0xb3121b },
      kind: p.id === myId ? 'player' : 'remote',
      grid: ids.indexOf(p.id),
    }));
    this.beginRace({ mode: 'race', laps: 1, difficulty: 'normal', traffic: 'off', seed: 1 }, specs);
    this.race.startCountdown();
  }

  private beginRace(opts: RaceOptions, specs: RacerSpec[]): void {
    if (this.inRace) this.endRace();
    const city = this.ensureCity();
    this.race.setup(opts, specs);
    this.inRace = true;
    this.finishedHandled = false;
    this.accumulator = 0;
    this.remoteTargets.clear();
    for (const r of this.race.racers) {
      const cfg = r.spec.config;
      const view = new CarView({
        paint: r.spec.kind === 'player' ? this.selectedPaint() : cfg.bodyColor,
        wing: cfg.id === 'apex_gt' || cfg.id === 'titan_xr' || cfg.id === 'nova_rs',
        trim: cfg.id === 'titan_xr' ? 'chrome' : 'dark',
        headlightBeam: r.spec.kind === 'player',
      });
      view.ready.then(() => view.setLights(true));
      city.scene.add(view.group);
      this.views.set(r.spec.id, view);
    }
    this.race.traffic.forEach((t, i) => {
      const v = new TrafficView(i * 7 + 3);
      city.scene.add(v.group);
      this.trafficViews.set(t.body.id, v);
    });
    this.smoke.clear(); this.sparks.clear();
    this.camera.setMode(settings.get('cameraMode'));
    this.camera.snap();
    this.hud.clear();
    this.lastGear = 0;
    this.syncViews(1, 0);
    audioManager.stopMusic();
    audioManager.startRaceMusic();
    this.vehicleAudio.start();
    this.hornCooldown.clear();
  }

  endRace(): void {
    for (const v of this.views.values()) v.dispose();
    for (const v of this.trafficViews.values()) v.dispose();
    this.views.clear(); this.trafficViews.clear();
    this.race.dispose();
    this.smoke.clear(); this.sparks.clear();
    this.hud.clear();
    this.inRace = false;
    this.vehicleAudio.stop();
  }

  restartRace(): void {
    if (this.network.isInRoom()) return;
    this.startOfflineRace();
  }

  private onPlayerFinished(r: Racer): void {
    if (this.finishedHandled) return;
    this.finishedHandled = true;
    const n = this.race.racers.length;
    this.hud.message(n > 1 ? `FINISHED P${r.position}` : 'FINISHED', 3.5, r.position === 1 ? 'red' : 'normal');
    profile.recordRace({ position: r.position, racers: n, distance: r.body.sim.distanceTravelled, topSpeedKmh: r.topSpeed * 3.6, bestLap: r.bestLap, finished: true });
    if (this.network.isInRoom()) this.network.finishRace(r.progress, r.finishTime);
    gameState.setState('FINISHED');
  }

  private showResults(): void {
    if (this.network.isInRoom()) return; // server sends authoritative results
    this.onResults?.();
    if (gameState.is('FINISHED', 'RACING')) gameState.setState('RESULTS');
  }

  /** Leave mid-race: record a DNF for statistics. */
  abandonRace(): void {
    const p = this.race.player;
    if (p && !p.finished && this.race.raceTime > 5) {
      profile.recordRace({ position: p.position, racers: this.race.racers.length, distance: p.body.sim.distanceTravelled, topSpeedKmh: p.topSpeed * 3.6, bestLap: p.bestLap, finished: false });
    }
  }

  // ── Network ────────────────────────────────────────────────────────────────

  private bindNetwork(): void {
    const prevUpdate = this.network.onPlayerUpdate;
    this.network.onPlayerUpdate = (id, state) => {
      prevUpdate?.(id, state);
      this.remoteTargets.set(id, { ...state, t: performance.now() });
    };
    const prevLeft = this.network.onPlayerLeft;
    this.network.onPlayerLeft = id => {
      prevLeft?.(id);
      const r = this.race.racers.find(x => x.spec.id === id);
      if (r) { r.body.active = false; this.views.get(id)?.dispose(); this.views.delete(id); }
      this.remoteTargets.delete(id);
    };
  }

  private applyRemoteTargets(): void {
    for (const r of this.race.racers) {
      if (r.spec.kind !== 'remote') continue;
      const t = this.remoteTargets.get(r.spec.id);
      if (!t) continue;
      const sim = r.body.sim;
      // Dead-reckon from the last update, then ease toward it
      const age = Math.min(0.25, (performance.now() - t.t) / 1000);
      const px = t.x + (t.vx ?? 0) * age, pz = t.z + (t.vz ?? 0) * age;
      const k = Math.min(1, FIXED_DT * 12);
      sim.x += (px - sim.x) * k; sim.z += (pz - sim.z) * k;
      sim.heading += wrapAngle(t.h - sim.heading) * k;
      sim.vx = t.vx ?? 0; sim.vz = t.vz ?? 0;
      sim.forwardSpeed = t.speed;
    }
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(MAX_FRAME, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.frame(dt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.rafId); }

  private frame(dt: number): void {
    const t0 = performance.now();
    this.handleActions();
    if (this.inRace) {
      const simulating = gameState.is('COUNTDOWN', 'RACING', 'FINISHED', 'RESULTS');
      if (simulating) {
        this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < Math.ceil(MAX_FRAME / FIXED_DT)) {
          this.simStep();
          this.accumulator -= FIXED_DT;
          steps++;
        }
        this.perf.simSteps += steps;
      }
      const alpha = simulating ? this.accumulator / FIXED_DT : 1;
      this.syncViews(alpha, gameState.is('PAUSED') ? 0 : dt);
      this.renderRace(dt);
    } else {
      this.garage.update(dt);
      this.post.render(this.garage.scene, this.garage.camera);
    }
    this.recordPerf(performance.now() - t0, dt);
  }

  private handleActions(): void {
    const inp = this.input;
    if (inp.consume('mute')) { settings.set('muted', !settings.get('muted')); this.hud.message(settings.get('muted') ? 'AUDIO MUTED' : 'AUDIO ON', 1.2); }
    if (!this.inRace) { inp.consume('pause'); inp.consume('camera'); inp.consume('reset'); return; }
    if (inp.consume('pause')) {
      if (gameState.is('RACING', 'COUNTDOWN')) gameState.setState('PAUSED');
      else if (gameState.is('PAUSED')) this.resume();
    }
    if (inp.consume('camera')) {
      const mode = this.camera.cycle();
      settings.set('cameraMode', mode as CameraMode);
    }
    if (inp.consume('reset') && gameState.is('RACING') && this.race.player) {
      if (this.race.resetRacer(this.race.player)) { this.camera.snap(); this.hud.message('RESET TO TRACK', 1.2); }
    }
  }

  resume(): void {
    if (!gameState.is('PAUSED')) return;
    this.input.clearAll();
    this.lastTime = performance.now();
    gameState.setState(this.race.phase === 'countdown' ? 'COUNTDOWN' : 'RACING');
  }

  /** One fixed simulation step: input → race (AI, traffic, physics, progress). */
  private simStep(): void {
    const player = this.race.player;
    if (player && !this.race.playerAutopilot && !player.finished && player.spec.kind === 'player') {
      const i = this.input, b = player.body.input;
      b.throttle = i.forward ? 1 : 0;
      b.brake = i.backward ? 1 : 0;
      b.steer = (i.left ? 1 : 0) - (i.right ? 1 : 0);
      b.handbrake = i.handbrake;
      b.nitro = i.nitro;
    }
    if (this.network.isInRoom()) this.applyRemoteTargets();
    const before = this.race.phase;
    this.race.step(FIXED_DT);
    if (before === 'countdown' && this.race.phase === 'racing' && gameState.is('COUNTDOWN')) gameState.setState('RACING');
    // Contact effects
    for (const e of this.race.pendingEvents) {
      const n = Math.min(24, Math.floor(e.impulse / 900));
      for (let k = 0; k < n; k++) this.sparks.emit(e.x, 0.5, e.z, (Math.random() - 0.5) * 8, 1 + Math.random() * 4, (Math.random() - 0.5) * 8, 0.12, 1, 0.25 + Math.random() * 0.35);
      const involvesPlayer = e.a === player?.body || e.b === player?.body;
      if (involvesPlayer) {
        const strength = Math.min(1, e.impulse / 18000);
        this.camera.impact(strength);
        audioManager.playCrash(0.3 + strength);
      }
    }
    this.race.pendingEvents.length = 0;
    this.emitTyreSmoke();
    if (this.network.isInRoom() && player) {
      this.netAccum += FIXED_DT;
      if (this.netAccum >= 1 / 15) {
        this.netAccum = 0;
        const s = player.body.sim;
        this.network.sendUpdate({ x: s.x, z: s.z, h: s.heading, speed: s.forwardSpeed, vx: s.vx, vz: s.vz, progress: player.progress, isCrashed: false });
      }
    }
  }

  private emitTyreSmoke(): void {
    for (const b of this.race.world.bodies) {
      if (!b.active) continue;
      const sim = b.sim;
      const amount = sim.skid + (b.onShoulder && Math.abs(sim.forwardSpeed) > 8 ? 0.35 : 0);
      if (amount < 0.15 || Math.random() > amount * 0.6) continue;
      const fx = sim.forwardX, fz = sim.forwardZ, rx = -fz, rz = fx;
      for (const side of [-1, 1]) {
        const x = sim.x - fx * 1.5 + rx * side * 0.9, z = sim.z - fz * 1.5 + rz * side * 0.9;
        this.smoke.emit(x, 0.25, z, sim.vx * 0.25 + (Math.random() - 0.5), 0.5 + Math.random() * 0.6, sim.vz * 0.25 + (Math.random() - 0.5), 0.9, 0.22 * Math.min(1, amount), 1.4 + Math.random());
      }
    }
  }

  /** Interpolate bodies into views and drive presentation effects. */
  private syncViews(alpha: number, dt: number): void {
    for (const r of this.race.racers) {
      const v = this.views.get(r.spec.id);
      if (!v) continue;
      const b = r.body;
      const x = b.prevX + (b.sim.x - b.prevX) * alpha;
      const z = b.prevZ + (b.sim.z - b.prevZ) * alpha;
      const h = b.prevHeading + wrapAngle(b.sim.heading - b.prevHeading) * alpha;
      v.setPose(x, z, h);
      const camDist = Math.hypot(x - this.camera.camera.position.x, z - this.camera.camera.position.z);
      v.group.visible = b.active && camDist < 900;
      v.setDetail(camDist < (this.quality === 'high' ? 45 : 28));
      v.update(b.sim, dt);
    }
    for (const t of this.race.traffic) {
      const v = this.trafficViews.get(t.body.id);
      if (!v) continue;
      const b = t.body;
      v.group.visible = b.active;
      if (!b.active) continue;
      const x = b.prevX + (b.sim.x - b.prevX) * alpha, z = b.prevZ + (b.sim.z - b.prevZ) * alpha;
      v.update(b.sim, x, z, b.prevHeading + wrapAngle(b.sim.heading - b.prevHeading) * alpha);
    }
  }

  private renderRace(dt: number): void {
    const city = this.city!;
    const player = this.race.player;
    if (!player) return;
    const view = this.views.get(player.spec.id)!;
    const sim = player.body.sim;
    const paused = gameState.is('PAUSED');
    if (!paused) {
      this.camera.update(view.group.position.x, view.group.position.z, view.group.rotation.y, sim, dt);
      this.smoke.update(dt); this.sparks.update(dt);
    }
    const cam = this.camera.camera;
    city.update(cam.position.x, cam.position.z, view.group.position.x + sim.forwardX * 40, view.group.position.z + sim.forwardZ * 40);
    this.updateAudio(player, paused);
    this.updateHud(player, dt);
    this.post.render(city.scene, cam);
  }

  private updateAudio(player: Racer, paused: boolean): void {
    const sim = player.body.sim;
    if (paused || !gameState.is('RACING', 'COUNTDOWN', 'FINISHED')) return;
    const c = sim.config;
    this.vehicleAudio.update({
      rpm: sim.rpm, idleRpm: c.idleRpm, redlineRpm: c.redlineRpm, throttle: sim.throttle,
      speed: Math.abs(sim.forwardSpeed), topSpeed: c.topSpeed, braking: sim.braking, skid: sim.skid,
      onShoulder: player.body.onShoulder, boosting: sim.boosting, horn: this.input.horn && !player.finished,
    }, 1 / 60);
    if (sim.gear !== this.lastGear && this.lastGear >= 1 && sim.gear >= 1) this.vehicleAudio.gearShift(sim.gear > this.lastGear);
    this.lastGear = sim.gear;
    // Traffic: spatial engine/road noise, and horns for near misses or contact with the player
    const cam = this.camera.camera.position;
    const cars = this.race.traffic.filter(t => t.body.active).map(t => ({ id: t.body.id, x: t.body.sim.x, z: t.body.sim.z, vx: t.body.sim.vx, vz: t.body.sim.vz, speed: Math.abs(t.body.sim.forwardSpeed) }));
    this.vehicleAudio.updateTraffic(cam.x, cam.z, sim.heading, sim.vx, sim.vz, cars);
    const now = performance.now();
    for (const t of this.race.traffic) {
      if (!t.body.active) continue;
      const tb = t.body.sim;
      const dx = tb.x - sim.x, dz = tb.z - sim.z, dist = Math.hypot(dx, dz);
      const closing = (sim.vx - tb.vx) * dx + (sim.vz - tb.vz) * dz;
      const nearMiss = dist < 6.5 && closing > 0 && Math.abs(sim.forwardSpeed) - Math.abs(tb.forwardSpeed) > 18;
      if ((nearMiss || t.body.lastImpact < 0.05) && (this.hornCooldown.get(t.body.id) ?? 0) < now) {
        this.hornCooldown.set(t.body.id, now + 5000);
        this.vehicleAudio.trafficHorn((dx * Math.cos(sim.heading) - dz * Math.sin(sim.heading)) / Math.max(1, dist), dist);
      }
    }
    const cd = this.race.countdownValue;
    if (cd !== this.lastCountdown) {
      if (cd !== null) audioManager.playCountdown(cd === 0);
      this.lastCountdown = cd;
      this.renderCountdown(cd);
    }
  }

  private renderCountdown(value: number | null): void {
    const overlay = document.getElementById('countdown-overlay');
    const num = document.getElementById('countdown-num');
    if (!overlay || !num) return;
    overlay.classList.toggle('is-visible', value !== null);
    if (value === null) return;
    num.textContent = value === 0 ? 'GO' : String(value);
    num.classList.toggle('countdown__number--go', value === 0);
    num.classList.remove('countdown__number--pop'); void num.offsetWidth; num.classList.add('countdown__number--pop');
  }

  /** Drift scoring: points from speed × slip angle while sliding; banked when the slide ends. */
  private updateDrift(player: Racer, dt: number): void {
    const sim = player.body.sim;
    const sliding = sim.drift > 0.5 && Math.abs(sim.slipAngle) > 0.18 && sim.forwardSpeed > 12 && gameState.is('RACING');
    if (sliding) {
      this.driftTime += dt;
      this.driftScore += sim.forwardSpeed * Math.abs(sim.slipAngle) * dt * 12;
      this.driftCooldown = 0.6;
      if (this.driftTime > 0.4) this.hud.message(`DRIFT  ${Math.round(Math.abs(sim.slipAngle) * 57.3)}°  +${Math.round(this.driftScore)}`, 0.3, 'red');
    } else if (this.driftScore > 0) {
      this.driftCooldown -= dt;
      if (this.driftCooldown <= 0) {
        if (this.driftTime > 0.8) this.hud.message(`DRIFT BONUS  ${Math.round(this.driftScore)}`, 1.6);
        this.driftScore = 0; this.driftTime = 0;
      }
    }
  }

  private updateHud(player: Racer, dt: number): void {
    const sim = player.body.sim;
    if (dt > 0) this.updateDrift(player, dt);
    const mph = settings.get('speedUnit') === 'mph';
    const speed = Math.abs(sim.forwardSpeed) * (mph ? 2.23694 : 3.6);
    const race = this.race;
    const free = race.options.mode === 'free';
    const dist = race.raceDistance;
    const markers: HudFrame['markers'] = [];
    const labels: HudFrame['labels'] = [];
    const cam = this.camera.camera.position;
    for (const r of race.racers) {
      const b = r.body;
      if (!b.active) continue;
      const isPlayer = r === player;
      markers.push({ id: r.spec.id, x: b.sim.x, z: b.sim.z, color: isPlayer ? '#ff2a2a' : MARKER_COLORS[r.spec.id] ?? '#ffd23f', player: isPlayer, heading: b.sim.heading });
      if (!isPlayer) {
        const v = this.views.get(r.spec.id);
        if (v) labels.push({ id: r.spec.id, name: r.spec.name, pos: v.group.position.clone().setY(1.9), position: r.position, dist: v.group.position.distanceTo(cam) });
      }
    }
    for (const t of race.traffic) if (t.body.active) markers.push({ id: t.body.id, x: t.body.sim.x, z: t.body.sim.z, color: '#aaa', traffic: true });
    const frame: HudFrame = {
      speed, unit: mph ? 'MPH' : 'KM/H', gear: sim.gear === -1 ? 'R' : sim.gear === 0 ? 'N' : String(sim.gear),
      rpm: sim.rpm, redline: sim.config.redlineRpm, nitro: sim.nitroFraction, boosting: sim.boosting,
      raceTime: race.phase === 'countdown' ? 0 : player.finished ? player.finishTime : race.raceTime,
      lap: race.currentLap(player), laps: race.options.laps, lastLap: player.lastLap, bestLap: player.bestLap,
      position: player.position, racers: race.racers.length,
      progress: free ? 0 : Math.max(0, Math.min(1, player.progress / dist)),
      remaining: free ? sim.distanceTravelled : Math.max(0, dist - Math.max(0, player.progress)),
      standings: race.standings(), freeMode: free, wrongWay: player.wrongWay > 1.2, cameraMode: this.camera.mode,
      markers, labels,
    };
    this.hud.update(frame, this.camera.camera, dt);
  }

  // ── Settings / resize / perf ───────────────────────────────────────────────

  private applySettings(s: GameSettings): void {
    this.quality = s.qualityPreset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.qualityPreset === 'low' ? 1 : s.qualityPreset === 'medium' ? 1.25 : 1.5));
    this.renderer.shadowMap.enabled = s.shadows && s.qualityPreset !== 'low';
    this.post.enabled = s.qualityPreset !== 'low';
    this.post.setSize(window.innerWidth, window.innerHeight);
    this.garage.scene.environment = s.reflections ? this.garageEnv : null;
    this.garage.setReflections(s.reflections && s.qualityPreset !== 'low');
    if (this.city) {
      this.city.scene.environment = s.reflections ? this.nightEnv : null;
      this.city.setQuality(s.qualityPreset, s.shadows);
    }
    this.camera.shakeEnabled = s.cameraShake;
    const hud = document.getElementById('racing-hud');
    if (hud) hud.classList.toggle('hud--hidden', !s.hudVisible);
    document.getElementById('hud-minimap')?.classList.toggle('is-hidden', !s.minimap);
  }

  private onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.garage.resize(w / h);
    this.camera.resize(w / h);
  }

  private recordPerf(ms: number, dt: number): void {
    this.perf.frames++;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.perf.avgFrameMs = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps += ((dt > 0 ? 1 / dt : 60) - this.fps) * 0.05;
    this.perf.drawCalls = this.renderer.info.render.calls;
    this.perf.triangles = this.renderer.info.render.triangles;
  }

  get currentFps(): number { return this.fps; }

  // ── QA hooks (enabled with ?qa=1; uses the real systems, no mocks) ────────────

  qaApi() {
    return {
      advance: (seconds: number) => {
        const steps = Math.round(seconds / FIXED_DT);
        for (let i = 0; i < steps; i++) {
          if (!gameState.is('COUNTDOWN', 'RACING', 'FINISHED', 'RESULTS')) break;
          this.simStep();
        }
        this.syncViews(1, 0);
        this.camera.snap();
        return this.qaState();
      },
      autopilot: (on: boolean) => this.race.setPlayerAutopilot(on),
      state: () => this.qaState(),
      catalogue: () => CAR_CATALOGUE.map(c => c.id),
      inputs: () => ({ forward: this.input.forward, backward: this.input.backward, left: this.input.left, right: this.input.right, handbrake: this.input.handbrake, nitro: this.input.nitro, held: this.input.heldCount }),
      placePlayer: (s: number, d: number, speedKmh = 0) => {
        const p = this.race.player; if (!p) return;
        const pos = this.track.pointAt(s, d);
        p.body.sim.place(pos.x, pos.z, this.track.headingAt(s));
        const h = p.body.sim.heading;
        p.body.sim.vx = -Math.sin(h) * speedKmh / 3.6; p.body.sim.vz = -Math.cos(h) * speedKmh / 3.6;
        this.race.world.resync(p.body); p.lastS = p.body.track.s; this.camera.snap();
      },
      perf: () => ({ ...this.perf, fps: Math.round(this.fps), memory: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures }),
      track: () => ({ length: this.track.length, minRadius: this.track.minRadius(), checkpoints: this.track.checkpointCount }),
    };
  }

  private qaState() {
    const r = this.race;
    const p = r.player;
    const body = (b: Body) => ({ x: b.sim.x, z: b.sim.z, heading: b.sim.heading, s: b.track.s, d: b.track.d, speedKmh: b.sim.forwardSpeed * 3.6, lateral: b.sim.lateralSpeed });
    return {
      state: gameState.state, phase: r.phase, raceTime: r.raceTime, countdown: r.countdownValue, inRace: this.inRace,
      options: r.options, camera: this.camera.mode,
      player: p ? {
        ...body(p.body), gear: p.body.sim.gear, rpm: p.body.sim.rpm, nitro: p.body.sim.nitro, nitroFraction: p.body.sim.nitroFraction,
        boosting: p.body.sim.boosting, braking: p.body.sim.braking, steerAngle: p.body.sim.steerAngle, progress: p.progress,
        lap: r.currentLap(p), lapsDone: p.lapsDone, checkpoint: p.checkpoint, position: p.position, finished: p.finished,
        finishTime: p.finishTime, collisions: p.collisions, resets: p.resets, onShoulder: p.body.onShoulder, wrongWay: p.wrongWay,
        distance: p.body.sim.distanceTravelled,
      } : null,
      racers: r.racers.map(x => ({ id: x.spec.id, name: x.spec.name, kind: x.spec.kind, ...body(x.body), progress: x.progress, position: x.position, finished: x.finished, finishTime: x.finishTime, lapsDone: x.lapsDone, checkpoint: x.checkpoint, mode: x.ai?.mode ?? null, overtakes: x.ai?.overtakes ?? 0, collisions: x.collisions })),
      traffic: r.traffic.filter(t => t.body.active).length,
      standings: r.standings(),
      hud: {
        speed: document.getElementById('hud-speed')?.textContent, gear: document.getElementById('hud-gear')?.textContent,
        position: document.getElementById('hud-position')?.textContent, lap: document.getElementById('hud-lap')?.textContent,
        timer: document.getElementById('hud-timer')?.textContent, nitro: document.getElementById('hud-nitro-pct')?.textContent,
      },
    };
  }
}

function fmt(t: number): string {
  const m = Math.floor(t / 60), s = (t % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}
