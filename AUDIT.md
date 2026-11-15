# RACE WARS: takeover audit and stage reports

Date: 15 November 2026. This report covers the work done with the *RACE WARS Claude Code Development Pack* (prompts 00–04). Prompt 05 (full online multiplayer) was not run as a separate stage; see [Multiplayer](#multiplayer).

## 0. Takeover audit (state found)

| Area | Finding |
|---|---|
| Stack | TypeScript + Three.js 0.185 + Vite 8 frontend; Express 5 + Socket.IO 4 backend. The stack was sound and was kept. |
| Repository hygiene | `.npm-cache/` (161 MB, 556 files) and `backend/node_modules` (975 files) were committed. Both are now untracked, and a root `.gitignore` was added. |
| World | An infinite straight road built from recycled segments. With no curves, there was nothing to steer around, no corners for the AI and no meaningful checkpoints. |
| Driving | Arcade model: speed added on a keypress, heading rotated directly, `x` clamped to the road. There was no grip, inertia, handbrake or reverse dynamics, and any traffic contact triggered a "CRASHED, press R" stop. |
| Frame rate | Delta was clamped at 0.05 s, so the game slowed down in proportion whenever the frame rate dropped below 20 fps. |
| AI | Two cars held "throttle on" and steered only when |x| > 8. They had no awareness of corners, opponents or traffic. |
| Race | A 60-second timer ranked cars by distance from the start (Euclidean). There were no laps, checkpoints or finish line. |
| Visuals | A single bright, flat garage room with the car floating above the floor. The road was flat grey. A beach photo was used as the "featured race" image. |
| Reference material | `Race Wars.mp4` (8 s, 1280×720) and the storyboard JPG were both readable. Frames were extracted and reviewed: intro close-ups, garage menu with a left nav, red/blue/green lobby, turntable car selection, a wet night highway, 3-2-1-GO, a HUD with twin gauges and a minimap, and a results screen. |

**Decision.** The renderer, UI framework, network layer, audio engine and state/settings/profile modules were kept and extended. The world, vehicle model, collision system, camera, traffic and AI were replaced, because a curved circuit with checkpoints and AI that brakes for corners cannot be built on an infinite straight road. The replaced files remain in git history and in `.repair-backup/`.

## 1. Visual reconstruction

- **Intro.** Real-time 3D: a wheel close-up, the headlights switching on, a body sweep, a burnout with smoke and exhaust flames, then the wide reveal with the RACE WARS logo and the tagline. It can be skipped with ESC, Enter, Space or a click, and turned off in Settings.
- **Main menu.** An industrial garage: concrete floor with wet patches and planar reflections (medium/high quality), roller shutter, steel columns, tube lights (RectAreaLights), tool chests, tyre stacks, hazard bollards, haze particles. The red car sits centre-right, with a left navigation panel (RACE / MULTIPLAYER / GARAGE / PROFILE / SETTINGS) that responds to keyboard and mouse.
- **Lobby.** The offline lobby is clearly labelled OFFLINE / AI OPPONENTS, with red, blue and green cars lined up in the garage. Driver cards show the AI names, cars and personalities. It sets mode, laps, difficulty and traffic.
- **Car selection.** The car sits on a lit turntable and can be dragged to rotate and scrolled to zoom. Prev/next browsing, paint choice and a performance panel whose figures are measured by the physics simulation.
- **Race.** A 3.74 km night-city circuit: wet asphalt (roughness-mapped puddles plus light-pool reflections), lane markings, rumble strips, jersey barriers with reflector bands, sodium streetlights, more than 300 lit buildings, neon signs, a skyline, a start/finish gantry and corner chevrons.
- **HUD and results.** The HUD shows timer, lap and best lap, a position board with gaps, a progress bar, minimap, RPM gauge, speed, gear, nitro gauge, rival tags and wrong-way, final-lap and finish messages. The results screen shows RACE COMPLETE, the ordered leaderboard (time or gap, best lap, top speed), personal stats, RACE AGAIN and MAIN MENU.
- **Rendering.** ACES tone mapping, PMREM environment maps baked from procedural night-city and garage scenes, PCF shadows, and UnrealBloom on medium/high quality. Car LOD hides the interior and mechanical detail beyond 28–45 m; the car model is 359k triangles.

**Not matched.** All five catalogue cars use the same supplied GLB, distinguished by paint, rear wing and trim. There are no hood/interior close-up meshes beyond what that model contains. City geometry is procedural rather than photographic.

## 2. Vehicle physics

`vehicle/VehicleSim.ts` is a dynamic bicycle model integrated at a fixed 120 Hz, with render interpolation.

- Power-limited drive with a traction cap, aerodynamic drag tuned so each car's top speed is a real equilibrium, rolling resistance, and engine braking.
- Linear tyres with per-axle friction limits, longitudinal load transfer, a rear friction circle (power oversteer) and a handbrake grip multiplier.
- Speed-sensitive, rate-limited steering that self-centres; kinematic blending at walking pace; a mild yaw-stability assist that is disabled while the handbrake is held.
- Automatic gearbox (6 gears) with shift cut; RPM derived from wheel speed. Reverse is engaged by holding brake at a standstill.
- Nitro adds real drive force, has a finite capacity, recharges, and allows a limited top-speed overshoot.
- Off-road shoulders reduce grip and add drag. Barriers and car-to-car contacts (oriented-box SAT) are resolved with restitution and friction impulses, including angular terms. There is no tunnelling at 120 Hz.
- Tunable parameters per car (`CarConfig.ts`): mass, power, traction, top and reverse speed, brakes, wheelbase, CG position, steering lock, falloff and rate, grip, rear bias, cornering stiffness, handbrake grip, nitro force, capacity and recharge, gear ratios, idle and redline.
- Measured (headless): 0–100 km/h in 3.1–4.0 s, top speed 281–320 km/h, braking from 100 km/h in 25–31 m, about 1.6 g lateral grip. Integrating at 60, 120 or 240 Hz gives the same trajectory within about 1 m over 5 s.
- Presentation follows the simulation state: wheel spin and steer, chassis pitch and roll springs, brake lights, nitro flames, tyre smoke from slip, impact sparks, camera shake, and engine, tyre, gear and impact audio.
- Cameras: chase, close and hood (C), with speed and acceleration response and FOV changes. The camera is kept inside the barriers.

## 3. AI opponents, traffic and race logic

- `ai/AIController.ts` produces the same throttle, brake, steer and nitro inputs as a player, so the AI uses the same physics. It works in layers: perception throttled by reaction time; lane choice with cost terms (blockage, closing speed, racing line, risk) and commit timers so it does not oscillate; Stanley path tracking toward a smoothed lateral target; curve-aware speed planning within braking distance; car following; nitro on clear straights; and stuck/wrong-way recovery (reverse out, then reset to the track as a last resort).
- Personalities: blue is balanced and sticks to the racing line; green is aggressive, passes more readily and changes lane faster.
- Difficulty changes reaction time, time gap, corner commitment, braking margin, overtaking willingness, risk tolerance, recovery delay, steering precision and nitro use. There are no speed multipliers.
- Traffic (`ai/TrafficController.ts`) keeps its lane using IDM car-following and changes lane only when stuck. Cars come from a fixed pool and are spawned round-robin ahead of every racer, never on top of a car.
- Race (`race/RaceManager.ts`): grid, a 3-2-1-GO countdown in simulation time, 12 ordered checkpoints per lap, progress unwrapped along the centreline (reversing reduces it; teleports and resets do not add to it), lap times, finish time interpolated within the 1/120 s step, and ranking by finish time and then by progress. Rivals get 30 s after the player finishes before the race closes.
- Headless results (1 lap, normal traffic, normal difficulty): all three racers finish, about one contact per racer per race, no recoveries needed, and finishes typically within 3–12 s of each other. With traffic off, hard AI laps about 63 s against about 70–80 s for easy AI.

## 4. Browser QA and release

The QA results are recorded in [QA results](#qa-results) below.

## Multiplayer

The online mode works: rooms of up to 3 players, a ready-up step, a server countdown, positions relayed at 15 Hz with dead reckoning, and remote cars treated as kinematic bodies in the local physics. The server validates the race: progress can never exceed the maximum speed multiplied by the elapsed time, finishes are accepted only once validated progress reaches the race distance, finishing times come from the server clock, and the server produces the rankings. Malformed messages are ignored.

It is **not** a server-authoritative physics simulation. Clients simulate their own cars, so a modified client could still drive unrealistically within those speed bounds. Traffic is not shared between clients, there is no reconnection into a race in progress, and there are no accounts. These are the remaining items from prompt 05.

## Remaining limitations

- One car model for every vehicle, and its licence and branding must be resolved before a commercial release (see the README).
- Keyboard only; there is no touch or gamepad driving. Menus work at phone width.
- Weather and reflections are approximations (environment maps, light pools, planar reflections only in the garage); there is no screen-space reflection on the road.
- Audio is synthesised: functional, but not recorded engine samples.
- Frame-rate figures in this report come from a headless SwiftShader (CPU) renderer. Real GPU performance must be measured on target hardware; quality presets (low/medium/high) scale shadows, bloom, pixel ratio, reflections and dynamic lights.
