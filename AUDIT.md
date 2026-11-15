# Race Wars: repair and regression report

Date: 20 October 2026

## Result

The local game loads its actual car GLB, renders the garage and race scene, supports driving and race completion, and passes the expanded browser/server regression suite. This is an engine repair and graphics integration improvement, not a verified recreation of the reference video.

Reviewed the active entry point, game, UI, network and state modules, HTML/CSS, asset metadata, server, package scripts and original test runner. The original source is backed up in `.repair-backup/src`.

## Errors found and repaired

| Area | Finding and repair |
|---|---|
| Opening graphics | The camera interpolated from the origin toward a garage 10 km away, initially showing darkness. Snap its initial position, then smooth subsequent movement. |
| Car alignment | Model grounding applied scale twice. Ground the scaled model using its world bounds. |
| Metallic surfaces | Missing environment reflections. Added a local reflection map and connected the reflections setting. |
| Garage performance | Four point lights each cast six shadow faces. Removed their shadow maps and reduced excessive lighting. |
| Road markers | Markers extended mainly behind the racer. Reoriented their pool along negative Z. |
| World recycling | Forward-only recycling broke restart and reverse travel. Each section now retains its position until it needs recycling; nearby buildings do not jump at boundaries. |
| Collisions | Debug geometry and exhaust enlarged collision bounds. Added explicit vehicle bounds independent of visuals. |
| Repeated model loading | Every race decoded the same GLB again. Cache the parsed model, share geometry and clone instance materials. |
| Paint | Red interior material was included in paint matching; only one material was recolored. Restrict matching and update all body materials. |
| Car configurations | Selecting colors mutated shared catalogue objects. Return independent configuration copies. |
| Multiplayer callbacks | Game callbacks overwrote lobby UI callbacks. Preserve both; create cars for players already in a joined room. |
| Room exit | Remote cars and stale interpolation targets survived leaving. Clear them on exit/disconnect. |
| Free Drive | It used the same 60-second limit as Time Race. Added untimed free driving. |
| Results | Solo mode always treated the player as winner. Rank AI/player distances and record the appropriate outcome. |
| Crash timing | Crashes paused the race clock indefinitely. Continue timing during crash/respawn. |
| Pause/settings | Opening settings moved the race vehicle into the garage. Preserve the paused scene and transforms. |
| Hidden screens | Pause, error and disconnect screens had permanent inline display:none. Let application state control visibility. |
| Countdown | Boost could drain before the start. Suppress driving and boost during countdown. |
| Delayed transitions | Abandoned countdown, respawn and results callbacks could change a later screen. Guard transitions against current state. |
| Audio lifecycle | Menu transitions left vehicle effects playing; music cleanup could stop a new track. Stop vehicle layers, snapshot outgoing music nodes and invalidate old timers. |
| Audio settings | Initial saved volume/UI volume were ignored. Apply volume after graph creation and scale UI clicks. |
| Graphics settings | Every settings change recreated shadow maps. Only rebuild on quality changes; apply reflection/shadow choices. Anti-aliasing explicitly requires reload. |
| Profile | Statistics did not refresh after racing. Refresh when entering Profile. |
| Traffic | Spawn chance depended on FPS; traffic could escape far ahead. Use elapsed-time spawn probability and forward-distance recycling. |
| Room capacity | Backend allowed eight players while UI advertised three. Enforce three. |
| Network input | Malformed state/room messages could break handlers. Validate types, finite numeric fields and bounds. |
| Room maps | Object prototype keys/code collisions were possible. Use null-prototype maps and collision checks. |
| Finish score | Arbitrary finish distances were trusted. Rank using validated movement updates. |
| Abandoned countdown | A disconnected room could still start later. Clear the interval when ending a race. |
| Player names | Names were inserted as HTML. Escape displayed names and result values. |
| Startup failures | Loading did not reflect model readiness; WebGL errors stranded startup. Await model/fallback, expose a visible renderer error and reload option. |
| Connection failures | Failed connections lacked useful feedback. Show a notification and support VITE_SERVER_URL. |
| Test durability | Interrupted runs could leave an empty result file. Checkpoint each test result and record setup failures. |

## Verification

- `frontend/regression.mjs`: 19 browser/server checks passed in installed Microsoft Edge. Tests include real GLB/Draco loading, camera/geometry, countdown, keyboard driving/braking, steering/reverse/boost, world coverage, pause/settings, crash recovery, results/profile, Free Drive, graphics toggles, name escaping, mobile menu width, three-player room capacity, malformed messages, finish ranking, race replay, countdown cancellation, actual browser roster/opponent synchronization, missing-model fallback, unavailable-WebGL errors, and no uncaught browser errors. Related assertions are grouped into 19 checks.
- `frontend/world-regression.mjs`: focused checks exercise the actual Environment module for road coverage, reverse/restart, and stable building positions across section boundaries.
- `npm run build`: TypeScript/Vite production build passes. A bundle-size warning remains; it is not a build failure.
- `node --check backend/server.js`: server syntax check passes.

Machine-readable evidence: `frontend/regression-results.json` and `frontend/world-regression-results.json`.

The regression suite uses real browser interactions and deterministic state/physics checks. It is not proof of all possible gameplay inputs or production readiness. Real GPU frame rate, audio listening quality and internet multiplayer latency still need acceptance testing on the intended devices.

## Remaining limits

- The reference video entry was located, but its contents could not be opened. No claim of exact visual matching is made. Put the video directly in this project or attach an accessible copy to continue comparison.
- The five catalogue choices share one supplied Ferrari convertible model. City buildings and civilian traffic are procedural. Distinct vehicles and photorealistic scenery require appropriate optimized assets.
- The implemented modes are 60-second Time Race and untimed Free Drive. 2 km/4 km course choices and a difficulty selector are not implemented.
- AI avoidance is basic; full rival-to-rival collisions are not implemented.
- Movement remains client-driven. Input validation and finish-score checks are not server-authoritative physics or comprehensive anti-cheat.
- Mobile menu width is tested; touch driving controls are not implemented.
- Anti-aliasing changes require reload. External fonts/featured-card imagery can fail offline; local font fallbacks remain available.

## Run

1. Terminal in `backend`: `npm start`.
2. Terminal in `frontend`: `npm run dev -- --host 127.0.0.1`.
3. Open http://127.0.0.1:5173.

W/A/S/D drive; Shift boosts; Escape pauses; R recovers after a crash. Arrow controls are available in Settings.

Run regression from `frontend` with `npm test`. It starts isolated test servers on ports 5175 and 3101 and closes its own browser/server processes. Installed Edge is the default; TEST_BROWSER=chrome selects installed Chrome. Build with `npm run build`.
