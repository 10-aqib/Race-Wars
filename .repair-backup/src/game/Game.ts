import * as THREE from 'three';
import { Car } from './Car';
import { Environment } from './Environment';
import { GarageEnvironment } from './GarageEnvironment';
import { ThirdPersonCamera } from './Camera';
import { Input } from './Input';
import { TrafficManager } from './TrafficManager';
import { CollisionSystem } from './CollisionSystem';
import { UIManager } from '../ui/UIManager';
import { NetworkManager } from '../network/NetworkManager';
import { gameState } from '../state/StateManager';
import { settings } from '../state/SettingsManager';
import { profile } from '../state/ProfileManager';
import { audioManager } from './AudioManager';
import { CAR_CATALOGUE, getCarById } from './CarConfig';
import { WORLD_FORWARD } from './Constants';

/**
 * Race Wars — Main Game Engine
 *
 * ONE animation loop. start() is idempotent. stop() cleanly cancels.
 * Settings, audio, garage selection all wired here.
 */
export class Game {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private cameraSystem: ThirdPersonCamera;

  private car: Car;
  private environment: Environment;
  private garageEnvironment: GarageEnvironment;
  private input: Input;
  private trafficManager: TrafficManager;
  private collisionSystem: CollisionSystem;

  private network: NetworkManager;
  private ui: UIManager;

  // Loop state — strictly guarded so we never run two loops
  private lastTime = 0;
  private isRunning = false;
  private rafId = 0;

  // Multiplayer remote cars
  private remoteCars: Map<string, Car> = new Map();
  private remoteCarTargets: Map<string, {x: number, z: number, h: number}> = new Map();
  private aiCars: Car[] = [];

  // Race state
  private raceScore = 0;
  private raceDistance = 0;
  private topSpeedThisRace = 0;
  private nearMissCooldown = 0;
  private raceTimeLeft = 60;

  // Network rate limiting (send at ~15 Hz)
  private netSendAccum = 0;
  private NET_SEND_INTERVAL = 1 / 15;

  private previousZ = 0;
  private carUpdateCount = 0;
  private lastCarUpdateCount = 0;
  private debugTimeAccum = 0;
  private currentFps = 0;


  constructor(network: NetworkManager, ui: UIManager) {
    this.network = network;
    this.ui = ui;

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.get('antiAliasing'),
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = settings.get('shadows');
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft deprecated in newer Three
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    this.cameraSystem = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.input = new Input();
    this.input.currentPreset = settings.get('controlPreset');

    this.environment = new Environment(this.scene);
    this.environment.setQuality(settings.get('qualityPreset'));

    this.garageEnvironment = new GarageEnvironment(this.scene);

    // Load the persisted car selection
    const selectedId = settings.get('selectedCarId' as any) as string ?? 'vortex_r';
    const carConfig = getCarById(selectedId);
    this.car = new Car(this.scene, carConfig);
    this._hookCarAudio(this.car);

    this.trafficManager = new TrafficManager(this.scene);
    this.collisionSystem = new CollisionSystem();

    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Settings change handler
    settings.onChange((s: any) => this.applySettings(s));

    gameState.onStateChange(this.onStateChange.bind(this));
    this.setupNetworkListeners();

    // Start at idle/garage view
    this.cameraSystem.setIdleMode(true, new THREE.Vector3(0, 0, 0));
  }

  // ── Audio hook ─────────────────────────────────────────────────────────────

  private _hookCarAudio(car: Car): void {
    car.onGearChange = (gear) => {
      if (gear > 1) audioManager.playGearShift();
    };
    car.onBoostStart = () => audioManager.startBoost();
    car.onBoostEnd = () => audioManager.stopBoost();
    car.onCrash = () => audioManager.playCrash(1.0);
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  private applySettings(s: any): void {
    this.renderer.shadowMap.enabled = s.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.qualityPreset === 'low' ? 1 : 1.5));
    this.environment.setShadowsEnabled(s.shadows);
    this.environment.setQuality(s.qualityPreset);
    this.cameraSystem.shakeEnabled = s.cameraShake;
    this.input.currentPreset = s.controlPreset;

    const newColor = this._colorHex(s.selectedColor);
    if (this.car.getColor() !== newColor) this.car.setColor(newColor);
  }

  private _colorHex(name: string): number {
    switch ((name ?? '').toLowerCase()) {
      case 'red':    return 0xD42020;
      case 'blue':   return 0x2060D4;
      case 'green':  return 0x20A040;
      case 'black':  return 0x111111;
      case 'white':  return 0xeeeeee;
      case 'yellow': return 0xd4c020;
      default:       return 0xD42020;
    }
  }

  // ── Multiplayer ────────────────────────────────────────────────────────────

  private setupNetworkListeners(): void {
    this.network.onPlayerJoined = (id, info) => {
      if (id === this.network.getId()) return;
      const cfg = getCarById((info as any).carId ?? 'vortex_r');
      const remoteCar = new Car(this.scene, cfg);
      remoteCar.mesh.name = `remote_${id}`;
      this.remoteCars.set(id, remoteCar);
    };

    this.network.onPlayerLeft = (id) => {
      const rc = this.remoteCars.get(id);
      if (rc) { rc.removeFromScene(this.scene); this.remoteCars.delete(id); this.remoteCarTargets.delete(id); }
    };

    this.network.onPlayerUpdate = (id, state) => {
      const rc = this.remoteCars.get(id);
      if (rc) {
        this.remoteCarTargets.set(id, { x: state.x, z: state.z, h: state.h ?? 0 });
        rc.speed = state.speed;
        rc.isCrashed = state.isCrashed;
      }
    };

    this.network.onRaceFinished = (rankings) => {
      const myRank = rankings.findIndex((r: any) => r.id === this.network.getId()) + 1;
      profile.recordRace(this.raceDistance, this.topSpeedThisRace * 3.6, myRank === 1);
      gameState.setState('FINISHED');
      this.car.speed *= 0.5;
      setTimeout(() => {
        this.ui.renderResults(rankings);
        gameState.setState('RESULTS');
      }, 2000);
    };
  }

  // ── State transitions ──────────────────────────────────────────────────────

  private onStateChange(newState: string): void {
    switch (newState) {
      case 'HOME':
      case 'LOBBY':
      case 'GARAGE':
      case 'PROFILE':
      case 'SETTINGS':
      case 'MODE_SELECT':
      case 'MULTIPLAYER':
        this.garageEnvironment.group.visible = true;
        // Park car in garage world-space
        this.car.position.set(10000, 0, 10000);
        this.car.heading = -Math.PI / 4;
        this.car.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.car.heading);
        this.car.speed = 0;
        this.car.updateMesh();
        this.remoteCars.forEach(c => c.mesh.visible = false);
        this.cameraSystem.setIdleMode(true, this.car.position);
        break;

      case 'COUNTDOWN':
        this.garageEnvironment.group.visible = false;
        this.remoteCars.forEach(c => c.mesh.visible = true);
        this.aiCars.forEach(c => c.mesh.visible = true);
        this.prepareRace();
        audioManager.startRaceMusic();
        break;

      case 'RACING':
        audioManager.startEngine();
        break;

      case 'RESULTS':
      case 'FINISHED':
        this.garageEnvironment.group.visible = false;
        this.input.clearAll();
        audioManager.stopEngine();
        audioManager.stopMusic();
        audioManager.startMenuMusic();
        break;
    }
  }

  // ── Game Loop (ONE loop, strictly idempotent) ──────────────────────────────

  public start(): void {
    if (this.isRunning) return; // guard — never double-start
    this.isRunning = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  public stop(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.rafId);
  }

  private loop(time: number): void {
    if (!this.isRunning) return;
    this.rafId = requestAnimationFrame(this.loop.bind(this));
    const delta = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.update(delta);
    this.render();
    this.updateDebugHUD(delta);
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  private update(delta: number): void {
    if (this.input.consumePause()) {
      if (gameState.is('RACING')) {
        gameState.setState('PAUSED');
        this.ui.showPauseMenu(true);
      } else if (gameState.is('PAUSED')) {
        gameState.setState('RACING');
        this.ui.showPauseMenu(false);
      }
    }

    if (gameState.is('PAUSED')) return;

    if (gameState.isGameplay()) {
      if (gameState.is('COUNTDOWN')) {
        this.carUpdateCount++;
        this.car.update({ ...this.input, forward: false, backward: false } as any, delta);
      } else if (gameState.is('RACING') || gameState.is('CRASHED')) {
        this.carUpdateCount++;
        
        // Assertions for forward movement
        if (gameState.is('RACING') && this.input.forward && this.car.speed > 1 && this.car.position.z >= this.previousZ) {
          console.error('[RaceWars] FORWARD DIRECTION ASSERTION FAILED', {
            previousZ: this.previousZ,
            currentZ: this.car.position.z,
            speed: this.car.speed
          });
        }
        this.previousZ = this.car.position.z;

        this.car.update(this.input, delta);
        if (this.car.speed > this.topSpeedThisRace) this.topSpeedThisRace = this.car.speed;
      }

      // 2. Audio per-frame
      if (gameState.is('RACING') || gameState.is('CRASHED')) {
        const rpm = this.car.getRpmFactor();
        const speed = Math.abs(this.car.speed);
        const braking = this.input.backward && speed > 1;
        // Slip when: hard steer at speed OR hard braking
        const steerSlip = (this.input.left || this.input.right) ? Math.min(1, speed / this.car.maxSpeed) * 0.6 : 0;
        const brakeSlip = braking ? Math.min(1, speed / 10) * 0.7 : 0;
        const slip = Math.max(steerSlip, brakeSlip);

        audioManager.updateVehicleAudio(
          rpm,
          this.input.forward,
          speed,
          this.car.maxSpeed,
          braking,
          slip
        );
      }

      // 3. Traffic
      this.trafficManager.update(this.car.position.z, delta);

      // 4. Environment
      this.environment.update(this.car.position.z);

      // 5. Camera
      this.cameraSystem.update(
        this.car.position,
        this.car.rotation,
        delta,
        this.car.speed,
        this.car.maxSpeed,
        this.car.isBoosting
      );

      // 6. Collisions
      if (gameState.is('RACING')) {
        if (this.collisionSystem.checkCollisions(this.car, this.trafficManager)) {
          this.handleCrash();
        } else if (this.nearMissCooldown <= 0 && this.collisionSystem.checkNearMisses(this.car, this.trafficManager)) {
          this.handleNearMiss();
        }

        // Timer
        this.raceTimeLeft -= delta;
        if (this.raceTimeLeft <= 0) {
          this.raceTimeLeft = 0;
          if (this.network.isInRoom()) {
            gameState.setState('FINISHED');
            this.car.speed *= 0.5;
            this.network.finishRace(this.raceDistance);
          } else {
            this.finishRace(1);
          }
        }
        
        // Update AI cars
        if (!this.network.isInRoom()) {
          for (const ai of this.aiCars) {
            const aiInput = {
              forward: true,
              backward: false,
              left: false,
              right: false,
              boost: false,
              gearUp: false,
              gearDown: false,
              reset: false,
              pause: false,
              consumePause: () => false,
              consumeReset: () => false,
              consumeGearUp: () => false,
              consumeGearDown: () => false,
              clearAll: () => {}
            } as any;
            
            // simple obstacle avoidance (keep within road)
            if (ai.position.x > 8) aiInput.left = true;
            if (ai.position.x < -8) aiInput.right = true;
            
            // Slow down if crashed
            if (ai.isCrashed) {
                aiInput.forward = false;
                if (ai.speed === 0) ai.respawn(ai.position.z - 5);
            } else if (this.collisionSystem.checkCollisions(ai, this.trafficManager)) {
                ai.crash();
            }
            
            ai.update(aiInput, delta);
          }
        }
        
        // Interpolate Remote Cars
        for (const [id, rc] of this.remoteCars) {
          const target = this.remoteCarTargets.get(id);
          if (target) {
            // Lerp position
            rc.position.x += (target.x - rc.position.x) * 10 * delta;
            rc.position.z += (target.z - rc.position.z) * 10 * delta;
            
            // Lerp rotation
            rc.heading += (target.h - rc.heading) * 10 * delta;
            rc.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rc.heading);
            rc.updateMesh();
          }
        }
      }

      if (this.nearMissCooldown > 0) this.nearMissCooldown -= delta;

      // 7. Respawn
      if (gameState.is('CRASHED') && this.input.consumeReset()) {
        gameState.setState('RESPAWNING');
        this.ui.hideCrash();
        setTimeout(() => {
          this.car.respawn(this.car.position.z - 20);
          audioManager.startEngine();
          gameState.setState('RACING');
        }, 500);
      }

      // 8. HUD
      if (gameState.is('RACING') || gameState.is('CRASHED')) {
        this.raceDistance = this.car.getDistance();

        const speedVal = settings.get('speedUnit') === 'mph'
          ? this.car.getSpeedMph()
          : this.car.getSpeedKmh();

        const m = Math.floor(this.raceTimeLeft / 60);
        const s = Math.floor(this.raceTimeLeft % 60);
        const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

        const trackLength = 10000;
        const minimapData = [];
        minimapData.push({ type: 'player', progress: (Math.abs(this.car.position.z) % trackLength) / trackLength });
        if (this.network.isInRoom()) {
          const remotes = Array.from(this.remoteCars.values());
          if (remotes.length > 0) {
            minimapData.push({ type: 'bot1', progress: (Math.abs(remotes[0].position.z) % trackLength) / trackLength });
          }
          if (remotes.length > 1) {
            minimapData.push({ type: 'bot2', progress: (Math.abs(remotes[1].position.z) % trackLength) / trackLength });
          }
        } else {
          if (this.aiCars.length > 0) {
            minimapData.push({ type: 'bot1', progress: (Math.abs(this.aiCars[0].position.z) % trackLength) / trackLength });
          }
          if (this.aiCars.length > 1) {
            minimapData.push({ type: 'bot2', progress: (Math.abs(this.aiCars[1].position.z) % trackLength) / trackLength });
          }
        }

        this.ui.updateHUD(
          speedVal,
          this.car.getGearLabel(),
          this.raceDistance,
          this.car.getRpmFactor(),
          timeStr,
          this.car.boostCurrent / this.car.boostCapacity,
          minimapData
        );

        // Network: fixed rate (not render FPS)
        this.netSendAccum += delta;
        if (this.netSendAccum >= this.NET_SEND_INTERVAL) {
          this.netSendAccum = 0;
          this.network.sendUpdate({
            x: this.car.position.x,
            z: this.car.position.z,
            h: this.car.heading,
            speed: this.car.speed,
            isCrashed: this.car.isCrashed,
          });
        }
      }

    } else if (gameState.is('HOME', 'LOBBY', 'GARAGE', 'PROFILE', 'SETTINGS', 'MODE_SELECT', 'MULTIPLAYER')) {
      this.cameraSystem.update(this.car.position, this.car.rotation, delta);
      this.garageEnvironment.update(delta);
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.cameraSystem.camera);
  }

  // ── Race helpers ───────────────────────────────────────────────────────────

  private prepareRace(): void {
    this.cameraSystem.setIdleMode(false);
    this.cameraSystem.resetPosition();

    // Swap car to selected config
    const selectedId = (settings as any).get('selectedCarId') ?? 'vortex_r';
    const cfg = getCarById(selectedId);
    const newColor = this._colorHex(settings.get('selectedColor'));
    cfg.bodyColor = newColor;

    // Rebuild car with new config (avoids lingering remote car confusion)
    this.car.removeFromScene(this.scene);
    this.car = new Car(this.scene, cfg);
    this._hookCarAudio(this.car);

    this.car.reset();

    if (this.network.isInRoom()) {
      const allIds = [this.network.getId(), ...Array.from(this.remoteCars.keys())].sort();
      const myIdx = allIds.indexOf(this.network.getId());
      this.car.position.set(myIdx % 2 === 0 ? -2 : 2, 0, Math.floor(myIdx / 2) * 8);
      this.car.updateMesh();
      
      // Clean up AI
      this.aiCars.forEach(c => c.removeFromScene(this.scene));
      this.aiCars = [];
    } else {
      // Setup AI opponents
      this.aiCars.forEach(c => c.removeFromScene(this.scene));
      this.aiCars = [];
      
      const blueConfig = getCarById('apex_gt');
      blueConfig.bodyColor = 0x2060D4;
      const blueCar = new Car(this.scene, blueConfig);
      blueCar.position.set(-6, 0, 0);
      blueCar.updateMesh();
      this.aiCars.push(blueCar);
      
      const greenConfig = getCarById('nova_rs');
      greenConfig.bodyColor = 0x20A040;
      const greenCar = new Car(this.scene, greenConfig);
      greenCar.position.set(6, 0, 0);
      greenCar.updateMesh();
      this.aiCars.push(greenCar);
      
      this.car.position.set(0, 0, 0);
      this.car.updateMesh();
    }

    const seed = this.network.getRoomCode() ?? Date.now().toString();
    this.trafficManager.setSeed(seed);
    this.trafficManager.reset();

    this.raceScore = 0;
    this.raceDistance = 0;
    this.topSpeedThisRace = 0;
    this.raceTimeLeft = 60;
    this.netSendAccum = 0;

    for (const [id, rc] of this.remoteCars) {
      rc.reset();
      if (this.network.isInRoom()) {
        const allIds = [this.network.getId(), ...Array.from(this.remoteCars.keys())].sort();
        const idx = allIds.indexOf(id);
        rc.position.set(idx % 2 === 0 ? -2 : 2, 0, Math.floor(idx / 2) * 8);
        rc.updateMesh();
      }
    }

    this.cameraSystem.resetPosition();
  }

  private handleCrash(): void {
    this.car.crash();
    this.cameraSystem.triggerShake(0.8);
    gameState.setState('CRASHED');
    this.ui.showCrash();
    audioManager.stopEngine();
  }

  private handleNearMiss(): void {
    this.nearMissCooldown = 1.5;
    this.raceScore += 100;
    this.ui.showNearMiss(100);
  }

  public finishRace(position: number): void {
    if (!gameState.isGameplay()) return;
    gameState.setState('FINISHED');
    this.car.speed *= 0.5;
    profile.recordRace(this.raceDistance, this.topSpeedThisRace * 3.6, position === 1);
    setTimeout(() => {
      if (!this.network.isInRoom()) {
        this.ui.renderResults([{
          id: 'solo',
          name: settings.get('playerName') || 'YOU',
          distance: this.raceDistance,
        }]);
      }
      gameState.setState('RESULTS');
    }, 2000);
  }

  private onWindowResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cameraSystem.resize(w / h);
  }

  public getCar(): Car { return this.car; }
  public getCarCatalogue() { return CAR_CATALOGUE; }

  private updateDebugHUD(delta: number): void {
    if (!window.location.search.includes('debug=1') && !localStorage.getItem('raceWars.debug')) return;
    
    this.debugTimeAccum += delta;
    if (this.debugTimeAccum >= 1.0) {
      this.lastCarUpdateCount = this.carUpdateCount;
      this.carUpdateCount = 0;
      this.currentFps = Math.round(1 / (delta || 0.016));
      this.debugTimeAccum = 0;
    }

    let div = document.getElementById('debug-hud');
    if (!div) {
      div = document.createElement('div');
      div.id = 'debug-hud';
      div.style.position = 'absolute';
      div.style.top = '10px';
      div.style.right = '10px';
      div.style.backgroundColor = 'rgba(0,0,0,0.85)';
      div.style.color = '#0f0';
      div.style.padding = '15px';
      div.style.fontFamily = 'monospace';
      div.style.fontSize = '12px';
      div.style.pointerEvents = 'none';
      div.style.zIndex = '9999';
      div.style.lineHeight = '1.4';
      document.body.appendChild(div);
    }
    
    const forward = WORLD_FORWARD.clone().applyQuaternion(this.car.rotation);
    const activeTraffic = this.trafficManager.vehicles.filter((v: any) => v.active).length;
    
    let nearestTrafficZ = Infinity;
    for (const v of this.trafficManager.vehicles) {
      if (v.active) {
        nearestTrafficZ = Math.min(nearestTrafficZ, Math.abs(v.mesh.position.z - this.car.position.z));
      }
    }
    const trafficZ = nearestTrafficZ !== Infinity ? (this.car.position.z - nearestTrafficZ) : 0;
    const roadBounds = this.environment.getRoadBounds();

    div.innerHTML = `
      <b>GAME STATE:</b> ${gameState.state}<br><br>
      <b>PLAYER POSITION:</b><br>
      X: ${this.car.position.x.toFixed(2)}<br>
      Y: ${this.car.position.y.toFixed(2)}<br>
      Z: ${this.car.position.z.toFixed(2)}<br><br>
      <b>PLAYER SPEED:</b><br>
      INTERNAL SPEED: ${this.car.speed.toFixed(2)}<br>
      DISPLAY SPEED: ${(this.car.speed * 3.6).toFixed(0)} KM/H<br>
      DISTANCE: ${this.car.getDistance()} m<br>
      HEADING: ${this.car.heading.toFixed(2)}<br>
      FORWARD VECTOR: X: ${forward.x.toFixed(2)}, Z: ${forward.z.toFixed(2)}<br>
      TIMER: ${this.raceTimeLeft.toFixed(2)}<br>
      CURRENT GEAR: ${this.car.getGearLabel()}<br><br>
      <b>INPUT:</b><br>
      W: ${this.input.forward ? 'PRESSED' : 'RELEASED'}<br>
      A: ${this.input.left ? 'PRESSED' : 'RELEASED'}<br>
      S: ${this.input.backward ? 'PRESSED' : 'RELEASED'}<br>
      D: ${this.input.right ? 'PRESSED' : 'RELEASED'}<br><br>
      THROTTLE: ${this.input.forward ? 1 : 0}<br>
      BRAKE: ${this.input.backward ? 1 : 0}<br>
      STEERING: ${(this.input.left ? 1 : 0) + (this.input.right ? -1 : 0)}<br><br>
      <b>TRAFFIC ACTIVE:</b> ${activeTraffic}<br>
      TRAFFIC Z: ${trafficZ.toFixed(2)}<br>
      PLAYER Z: ${this.car.position.z.toFixed(2)}<br>
      AHEAD: ${trafficZ < this.car.position.z ? 'YES' : 'NO'}<br><br>
      <b>ROAD DEBUG:</b><br>
      NEAREST ROAD Z: ${roadBounds.maxZ.toFixed(2)}<br>
      FURTHEST ROAD Z: ${roadBounds.minZ.toFixed(2)}<br><br>
      <b>PERFORMANCE:</b><br>
      FPS: ${this.currentFps}<br>
      DELTA: ${delta.toFixed(4)}<br>
      CAR UPDATES / SEC: ${this.lastCarUpdateCount}<br>
    `;
  }
}
