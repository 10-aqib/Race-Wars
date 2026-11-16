# RACE WARS — Race. Survive. Dominate.

A browser-based 3D street-racing game set in a rain-soaked night city. Drive a real
vehicle simulation against two AI rivals and civilian traffic on a 3.7 km circuit, or
race friends online through the bundled multiplayer server.

Built with **TypeScript + Three.js + Vite** (frontend) and **Node.js + Express + Socket.IO** (backend). No game engine, no external texture or audio files: textures, sounds and music are generated procedurally.

---

## Quick start

Requirements: Node.js 20+ (tested on 22) and a WebGL2-capable browser with hardware acceleration enabled.

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. That is all you need for offline racing against AI.

For online multiplayer, also start the server in a second terminal:

```bash
cd backend
npm install
npm start
```

The client connects to `http://localhost:3000` in development, or to the page's own origin in production. Override with `VITE_SERVER_URL` at build time.

### Production build

```bash
cd frontend
npm run build
npm run preview
```

`dist/` is a static site; deploy it to any static host. Deploy `backend/` to a Node host and set `VITE_SERVER_URL` for the frontend build (and optionally `CORS_ORIGIN` on the server).

---

## Controls

| Key | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A / ← · D / → | Steer |
| Space | Handbrake |
| Shift | Nitro |
| C | Cycle camera (chase / close / hood) |
| R | Reset onto the track |
| H | Horn |
| M | Mute |
| Esc | Pause / resume |

WASD and the arrow keys work at the same time. In the menus, use ↑/↓ and Enter; in the garage, ←/→ browse cars and you can drag to rotate and scroll to zoom.

---

## What is in the game

- **Cinematic intro.** Real-time close-ups of the wheel and headlights, a body sweep, a burnout and the logo reveal. Skippable, and it can be turned off in Settings.
- **Industrial garage menus.** Main menu, offline race lobby (red, blue and green cars), car selection on a lit turntable, profile and settings.
- **Five cars** with distinct physics. The garage figures (top speed, 0–100 km/h, braking distance) are measured by running the simulation, not typed in by hand.
- **Vehicle physics:** a fixed 120 Hz dynamic bicycle model with tyre grip limits, load transfer, power-limited drive, drag, an automatic gearbox, speed-sensitive steering, a handbrake that breaks rear grip, and limited, recharging nitro.
- **Collisions** with barriers, rivals and traffic, resolved with impulses. They produce sparks, camera shake and sound.
- **AI opponents** that use the same physics as you. They track the racing line, brake for corners, pick lanes, overtake, avoid traffic and recover from crashes. Difficulty (Easy / Normal / Hard) changes behaviour, not speed cheats.
- **Race logic:** ordered checkpoints, laps, live positions, finish detection to the sub-step, and results calculated from real race state.
- **HUD:** timer, lap and best lap, position board with gaps, track progress, minimap, RPM gauge, speed, gear, nitro gauge, rival name tags, and wrong-way, final-lap and finish messages.
- **Persistence:** settings and profile statistics are saved in `localStorage`.
- **Online multiplayer** for 2–3 players in rooms. See [Multiplayer](#multiplayer) for what the server does and does not validate.

---

## Project structure

```
frontend/
  index.html                 UI markup for every screen
  src/main.ts                boot, intro, QA hooks
  src/style.css              interface styles
  src/game/
    Game.ts                  orchestrator: fixed-step loop, scenes, race lifecycle
    Input.ts                 keyboard state (focus-loss safe)
    CarConfig.ts             vehicle catalogue (physical parameters)
    AudioManager.ts          procedural Web Audio engine, effects and music
    vehicle/VehicleSim.ts    vehicle dynamics (pure, render-independent)
    vehicle/VehicleStats.ts  garage figures measured by simulation
    physics/PhysicsWorld.ts  stepping, barrier and car-to-car collisions
    track/Track.ts           circuit spline, projection, curvature, racing line
    ai/                      racing AI, traffic driver, steering, difficulty
    race/RaceManager.ts      grid, countdown, checkpoints, laps, ranking, traffic pool
    render/                  car model/LOD, car & traffic views, cameras, particles, post FX
    world/                   night-city track scene, garage scene
  src/ui/                    UI controller and HUD
  src/state/                 state machine, settings, profile
  src/network/               Socket.IO client
  tests/e2e.mjs              browser end-to-end suite
  public/                    car.glb, Draco decoder
backend/
  server.js                  rooms, countdown, progress validation, rankings
```

Simulation (`vehicle`, `physics`, `track`, `ai`, `race`) has no rendering dependencies. Rendering reads the simulation state and interpolates between fixed steps.

---

## Testing

```bash
cd frontend
npm test              # end-to-end suite against the dev server and a local game server
npm run test:prod     # builds, serves dist/ and runs the suite against the production build
```

The suite starts its own Vite and backend servers, launches Chromium and drives the real game with the keyboard and mouse. It reads state through `?qa=1` hooks that expose the actual simulation; nothing is mocked. Results are written to `frontend/qa-output/`.

Browser selection: `TEST_BROWSER=chrome` (or `msedge`) uses an installed browser, and `PW_CHROMIUM=/path/to/chrome` uses a specific binary. Otherwise Playwright's bundled Chromium is used (`npx playwright install chromium`).

---

## Multiplayer

The server keeps its own view of each player's race progress. It clamps progress that would need more than the maximum possible speed since the start, accepts a finish only after validated progress reaches the race distance, and times finishes with its own clock. Rankings come from the server.

Positions are client-simulated and relayed at 15 Hz with dead-reckoning on the receiver. The server is not a full authoritative physics simulation, and traffic is local to each client. See [AUDIT.md](AUDIT.md) for the full list of limitations.

---

## Assets and licences

- `frontend/public/car.glb`: the sports-car model shipped with the three.js examples ("Ferrari 458 Italia" by vicent091036, CC BY 4.0, via the three.js repository). Manufacturer badges are recoloured at runtime. Replace it with an original or properly licensed model before any commercial release.
- `frontend/public/draco/`: the Draco decoder from three.js (Apache-2.0).
- Fonts: Barlow and Barlow Condensed via `@fontsource` (SIL Open Font License 1.1), self-hosted.
- All other textures, sounds and music are generated in code.
