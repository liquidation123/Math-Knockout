# Out-Mathed

Two equation-combat modes share one mountain summit. Projectile Duel uses team projectile attacks; Bump Duel uses simultaneous character launches and contact knockback. It uses plain HTML/CSS/JavaScript, Three.js for rendering, `ws` for the room connection, and the existing equation parser and fixed-step physics.

## Game modes

- **Projectile Duel**: `/play.html`. Local, shared-screen play with three characters per
  team. Select a surviving character; explicit, parametric, polar and implicit
  previews, Force, recoil, piercing bullets, single-hit damage, and victory screens
  remain from main. Contact between characters does not deal damage.
- **Bump Duel**: `/bump.html`. Two tabs/devices join an invite room. Each player
  secretly locks an explicit equation, then both characters launch together.
  Contact applies momentum-based impulses, not projectile damage. The last
  character on the mountain wins; simultaneous falls are a draw.

The homepage has both choices. Each can go through the same 10-second drawing
screen or use the **Play with cubes** shortcut. Saved drawings appear as
team-colored characters in both modes. Projectile Duel keeps its original
collider and mass; Bump Duel keeps its ink-based mass/radius. **Change mode** returns home.
Entering either page starts fresh gameplay; drawings remain available in the
tab's session storage. No combat state is shared between the two entry points.
Older mountain invite links using `/play.html?room=...` redirect to Bump Duel
with the same room ID; plain `/play.html` always starts Projectile Duel.

## Drawn characters (data handoff)

`create.html` gives each player 10 seconds and 20 L of ink (1 L covers 1% of the
720×440 canvas; repainting covered pixels is free). Clear needs two taps and can
be undone. When time runs out, `create.js` saves one JSON record to
`sessionStorage` under both `outMathedCharacter` (latest) and
`outMathedCharacter:<id>`. Read it with `loadSavedCharacter(id)` in
`src/saved-character.js`. The record contains:

- `id`, `format: "out-mathed-character"`, `version: 1`, `createdAt`
- `image`: transparent PNG data URL, plus the original `inkUsed`, `width`, `height`
- `mask`: full-resolution occupancy mask (alpha ≥ 128), run-length encoded row by
  row, starting with an empty run. Use `decodeRuns` to rebuild it.
- `material`: density (1 kg/L), pixel size (2.5 mm), and ink thickness (≈5.05 cm)
- `physics`: ink litres, area (m²), mass (kg), centre of mass (pixels, 0–1, and
  metres), spin moment of inertia (kg·m²), and the solid bounding box

`src/character-geometry.js` holds this math as small, pure functions. Mass is
density × volume. The centre of mass is the coverage-weighted average pixel
position. Inertia is Σ m(r² + s²/6) over square pixels. The occupancy mask is ready
for later polygon extraction (marching squares) or 3D extrusion by the ink
thickness. Existing game modes still use `readSavedMask()` and Bump Duel's server
mass formula unchanged.

## Shared mountain and deliberate adaptations

Both modes use `assets/mountain.glb`, its painted materials, cliff, foliage,
clouds and ruins, plus the same warm lighting in `src/mountain.js`.
The editable `assets/mountain.blend` and `tools/build_mountain.py` generate the
browser model. WebP textures and Meshopt geometry compression keep the GLB near
1 MB; `build.js` ships only runtime images and the GLB, not the Blender source.
The 96-point grass rim is reused by `src/terrain.js` for ground support, falls,
curve/grid clipping, and projectile edge collisions. The top is flat at Z=0;
Z remains height. A character's centre leaving the rim loses support, as before.
Lower cliff surfaces and the decorative outer rim are scenery, not landable ground.

The original projectile collision boxes now appear as stone barriers in both
modes, with exactly matching dimensions. Bump launches now stop at these solid
barriers instead of passing through them; after contact knockback, characters
also collide with the barriers. Projectile Duel's bullet speed/damage, Force and
recoil are unchanged. Bump Duel's launch is slower (7.5 units/s with 2.25
units/s² friction) while retaining the same 12.5-unit unobstructed distance.
Bump's dotted path is still an unobstructed projection; a wall or rival can stop
or alter actual travel.

Projectile spawns are sampled safely inside the rounded summit, with a bounded
fallback at x=±10 and y=−4.5,0,4.5. Bump spawns remain (−9.5,0) and (9.5,0).
Both eliminate falling characters below Z=−5. Restart clears attacks, velocities,
results and pending Bump countdowns. Leaving a Bump page closes its connection;
an empty room is removed, and departing silhouettes are cleared for the peer.
Browser back/forward restoration reloads a game rather than reviving stale state.

## Run

Use Node.js 22 or newer:

    npm install
    npm start

Run these commands from the `Math-Knockout-1` folder. After pulling changes,
run `npm install` again to install any newly added dependencies (including `ws`).
Keep the terminal running and open the address printed after **Out-Mathed:**.
Local startup tries ports 5173–5182 if another server is already running.
An explicit `PORT` is always respected; for example, `PORT=5183 npm start`.
Press Ctrl+C in that server's terminal to stop it.
After pulling server changes or switching branches, stop and restart the server.
An old process can serve new pages while still running the old server code;
a pre-Bump server cannot assign sides. If Bump shows a connection error, restart
with `npm start`, open its printed address, and use **Retry**.

Open the printed address (normally `http://127.0.0.1:5173`) and choose a mode. For Bump Duel, copy the invite link into another tab or device for Red. A second device needs a reachable Node server address; localhost refers only to its own computer. Run `npm test` for the Node tests. The server binds to localhost by default; set `HOST=0.0.0.0` and `PORT` for a Node host that accepts external connections. The Vercel static build includes the arena assets, but live rooms need a persistent Node/WebSocket host; the current Vercel deployment cannot run the duel server.

Web host: https://math-knockout-2.onrender.com/
