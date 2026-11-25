# 🏎️ RACE WARS
### Race. Survive. Dominate.

**Race Wars** is a browser-based 3D car racing game built to deliver an immersive racing experience through realistic 3D vehicle rendering, interactive environments, competitive gameplay, and real-time multiplayer functionality.

The game combines modern web technologies with a custom 3D racing engine to create an interactive experience where players can explore the garage, customize their vehicles, compete against AI opponents, challenge other players online, and track their racing performance.

Designed with an emphasis on visual quality, responsive gameplay, and real-time interaction, Race Wars brings the excitement of street racing directly to the browser without requiring a traditional game installation.

---

## 🎮 Project Overview

Race Wars is an interactive 3D racing experience that brings together single-player racing, free driving, and online multiplayer gameplay.

Players can select and customize vehicles, navigate a procedurally generated city environment, avoid traffic, use nitro boosts, recover from crashes, and compete for the highest race distance.

The project includes a dedicated frontend game environment and a separate Node.js multiplayer backend responsible for room management and real-time player communication.

### Key Highlights

- Immersive 3D racing environment.
- Real-time multiplayer room functionality.
- Interactive vehicle selection and customization.
- AI-controlled opponents and civilian traffic.
- Multiple gameplay modes.
- Dynamic racing camera and environment.
- Vehicle performance and player statistics.
- Customizable graphics, audio, and gameplay settings.
- Browser-based gameplay powered by WebGL.

---

## ✨ Features

### 1. 🏁 Multiple Game Modes

Race Wars currently includes two primary gameplay modes and an online multiplayer mode.

**Time Race**
- Competitive 60-second racing challenge.
- Travel as much distance as possible before time expires.
- Race against AI opponents.
- Distance-based results and performance tracking.

**Free Drive**
- Unlimited driving without a race countdown.
- Explore the environment at your own pace.
- Practice steering, acceleration, braking, and boosting.
- Enjoy unrestricted driving sessions.

**Multiplayer**
- Create private racing rooms.
- Join existing rooms using room codes.
- Share room codes with friends.
- Lobby-based player management.
- Ready-up functionality.
- Host-controlled race starting.
- Real-time player synchronization.
- Supports up to three players per room.

### 2. 🚗 Interactive Vehicle Garage

The garage provides an interactive environment for browsing and configuring available vehicles.

Features include:

- Five selectable vehicle configurations.
- Interactive 3D vehicle presentation.
- Vehicle selection and navigation.
- Customizable vehicle paint colors.
- Performance statistics.
- Speed, acceleration, handling, braking, and boost indicators.
- Independent vehicle configuration management.

**Available paint colors:**
- Red
- Blue
- Green
- Black
- Yellow

### 3. 🌆 3D Racing Environment

The game features a 3D city environment designed to provide an engaging street-racing atmosphere.

Environment features include:

- Procedurally generated city buildings.
- Dynamic road sections and road markers.
- Civilian traffic vehicles.
- Continuous environment recycling.
- Follow-camera system.
- 3D lighting and reflective vehicle surfaces.
- Optimized vehicle model loading.
- Collision detection and crash recovery.

### 4. ⚡ Vehicle Driving Mechanics

Race Wars includes an interactive vehicle-control system designed for responsive gameplay.

Driving mechanics include:

- Acceleration.
- Braking and reverse driving.
- Left and right steering.
- Nitro boost.
- Vehicle collision detection.
- Crash and recovery mechanics.
- Dynamic speed display.
- Camera movement and feedback.

### 5. 👥 Real-Time Multiplayer System

The multiplayer architecture uses Socket.IO to facilitate communication between connected players.

Features include:

- Private room creation.
- Room-code-based joining.
- Player lobby synchronization.
- Player readiness management.
- Host and participant handling.
- Live opponent positioning.
- Multiplayer race countdown.
- Player disconnection handling.
- Room cleanup and state management.
- Server-side message validation.

### 6. 📊 Player Profile & Statistics

The profile section provides an overview of individual racing performance.

Available statistics include:

- Total races played.
- Number of wins.
- Best racing distance.
- Highest recorded speed.
- Win percentage.

Statistics are refreshed when entering the profile screen.

### 7. ⚙️ Customizable Settings

Players can personalize their gaming experience through dedicated settings panels.

**Gameplay Settings**
- Camera shake.
- HUD visibility.
- Speed measurement units.
- Minimap visibility.

**Control Settings**
- WASD controls.
- Arrow-key controls.
- Configurable control presets.

**Graphics Settings**
- Graphics quality.
- Shadows.
- Reflections.
- Anti-aliasing.

**Audio Settings**
- Background music volume.
- Sound effects volume.
- Interface audio settings.

A reset-to-defaults option is also available.

---

## 🛠️ Technology Stack

Race Wars is developed using modern JavaScript and web-based 3D technologies.

| Technology | Purpose |
|---|---|
| HTML5 | Game structure and interface |
| CSS3 | UI styling and animations |
| TypeScript | Frontend application logic |
| JavaScript | Backend and supporting logic |
| Three.js | 3D rendering and game environment |
| WebGL | Hardware-accelerated graphics |
| Node.js | Backend runtime |
| Express.js | Backend HTTP server |
| Socket.IO | Real-time multiplayer communication |
| Vite | Frontend development and build tooling |
| Playwright | Browser-based regression testing |
| npm | Dependency and package management |

### Architecture

The project follows a separated frontend and backend architecture.

**Frontend**
- Renders the 3D game environment.
- Handles vehicle movement and gameplay.
- Manages the user interface.
- Controls game modes and settings.
- Communicates with the multiplayer server.

**Backend**
- Manages multiplayer connections.
- Creates and maintains racing rooms.
- Handles room membership.
- Synchronizes multiplayer state.
- Validates incoming network messages.
- Manages race countdowns and room lifecycle.

---

## 📂 Project Structure

```text
Race-Wars/
│
├── frontend/
│   ├── public/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   ├── regression.mjs
│   ├── world-regression.mjs
│   └── regression-results.json
│
├── backend/
│   ├── server.js
│   └── package.json
│
├── AUDIT.md
├── README.md
└── .gitignore
```

*Note: This is a simplified logical overview. Refer to the repository for the complete directory structure.*

---

## 🚀 Installation & Setup

Follow these instructions to run Race Wars locally.

### Prerequisites

Make sure you have installed:

- Node.js (LTS recommended).
- npm.
- Git.
- A modern browser with WebGL support.

### Step 1: Clone the Repository

```bash
git clone https://github.com/10-aqib/Race-Wars.git
```

Navigate into the project:

```bash
cd Race-Wars
```

### Step 2: Install Backend Dependencies

```bash
cd backend
npm install
```

### Step 3: Start the Backend Server

```bash
npm start
```

Keep this terminal running.

### Step 4: Install Frontend Dependencies

Open another terminal:

```bash
cd Race-Wars/frontend
npm install
```

### Step 5: Start the Frontend

```bash
npm run dev -- --host 127.0.0.1
```

### Step 6: Launch the Game

Open your browser and visit:

```text
http://127.0.0.1:5173
```

The Race Wars application should now load.

**Important:** For multiplayer connections from other devices or a separately hosted frontend, configure the appropriate backend URL using the `VITE_SERVER_URL` environment variable.

---

## 🎮 Game Controls

| Action | Keyboard |
|---|---|
| Accelerate | W |
| Brake / Reverse | S |
| Steer Left | A |
| Steer Right | D |
| Nitro Boost | Shift |
| Recover After Crash | R |
| Pause Game | Escape |

Players can also switch to arrow-key controls through the settings menu.

---

## 🧪 Testing & Quality Assurance

Race Wars includes automated regression testing to verify important gameplay, rendering, networking, and application behavior.

### Testing Tools

- Playwright browser automation.
- Node.js regression testing.
- TypeScript compilation.
- Vite production build.
- Backend syntax validation.
- Environment and world-state regression checks.

### Verified Test Coverage

The documented regression suite includes:

- 3D vehicle model and Draco loading.
- Camera positioning and geometry.
- Vehicle acceleration and braking.
- Steering, reverse, and boost.
- Road coverage and environment recycling.
- Pause and settings behavior.
- Crash recovery.
- Race completion and results.
- Profile statistics.
- Free Drive functionality.
- Graphics settings.
- Player-name escaping.
- Multiplayer room capacity.
- Malformed network messages.
- Multiplayer player synchronization.
- Race replay.
- Countdown cancellation.
- Missing-model fallback.
- WebGL error handling.
- Browser error monitoring.

### Latest Documented Test Results

- 19 browser/server regression checks passed.
- Focused world regression checks completed.
- TypeScript/Vite production build passed.
- Backend JavaScript syntax validation passed.

For additional technical details, see [AUDIT.md](./AUDIT.md).

---

## 🔮 Future Development

The following improvements are potential future development goals:

- Additional unique 3D vehicle models.
- More detailed city environments.
- Advanced AI driving and opponent behavior.
- Improved rival-to-rival collision mechanics.
- Additional race tracks and distances.
- Difficulty selection.
- Mobile touch driving controls.
- Server-authoritative movement and race validation.
- Advanced multiplayer matchmaking.
- Global leaderboards.
- Online player profiles.
- Expanded vehicle customization.
- Further performance optimization.

These items are not represented as completed features.

---

## ⚠️ Current Development Limitations

For transparency, the current implementation has some limitations:

- The five garage configurations currently share one supplied Ferrari convertible 3D model.
- The implemented gameplay modes are 60-second Time Race and unlimited Free Drive.
- Multiplayer supports a maximum of three players per room.
- AI avoidance behavior is basic.
- Full rival-to-rival collisions are not implemented.
- Movement remains client-driven; comprehensive server-authoritative anti-cheat is not implemented.
- Touch-based mobile driving controls are not implemented.
- Anti-aliasing changes require an application reload.
- Actual GPU performance and multiplayer latency require testing on target devices and networks.

The project is actively documented and can be extended with additional features and optimizations.

---

## 👨‍💻 Developer

**Developed by Aqib**

Race Wars is a personal game development project focused on exploring browser-based 3D graphics, interactive game systems, real-time networking, and modern web application development.

GitHub: [@10-aqib](https://github.com/10-aqib)

Project Repository: [Race Wars](https://github.com/10-aqib/Race-Wars)

---

## 📜 License

No specific open-source license has been declared in this repository. All rights and permissions should be treated according to the repository owner's terms unless a license is added.

---

<p align="center">

**RACE WARS**

*Race. Survive. Dominate.*

Built with passion for 3D gaming and web technologies.

</p>
