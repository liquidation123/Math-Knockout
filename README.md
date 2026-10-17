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
screen or use the **Play with cubes** shortcut. A drawing becomes a visual
decoration on Projectile Duel's cubes (no physics changes); Bump Duel keeps its
drawn silhouette and ink-based mass/radius. **Change mode** returns home.
Entering either page starts fresh gameplay; drawings remain available in the
tab's session storage. No combat state is shared between the two entry points.
Older mountain invite links using `/play.html?room=...` redirect to Bump Duel
with the same room ID; plain `/play.html` always starts Projectile Duel.

## Shared mountain and deliberate adaptations

Both modes use `assets/mountain.glb`, its painted materials, cliff, foliage,
clouds and ruins, plus the same warm lighting in `src/mountain.js`.
The 96-point grass rim is reused by `src/terrain.js` for ground support, falls,
curve/grid clipping, and projectile edge collisions. The top is flat at Z=0;
Z remains height. A character's centre leaving the rim loses support, as before.
Lower cliff surfaces and the decorative outer rim are scenery, not landable ground.

The original projectile collision boxes now appear as stone barriers in both
modes, with exactly matching dimensions. Bump launches now stop at these solid
barriers instead of passing through them; after contact knockback, characters
also collide with the barriers. This terrain adaptation does not change launch
speed, friction, contact impulse strength, bullet speed/damage, Force or recoil.
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

## Online Bump Duel deployment

The current Vercel configuration publishes only `dist/`; it does not run
`server.js`. Restarting a local server cannot fix a connection to `wss://math-knockout.vercel.app/`.

For the existing in-memory room implementation:

1. Deploy this repository as one persistent Node service. Install with `npm ci`,
   start with `npm start`, and set `HOST=0.0.0.0`. Let the host supply `PORT`.
   Keep one instance: rooms currently live in that process's memory.
2. Get its public HTTPS address and verify two clients can join the same room.
3. In the Vercel project's environment variables, set `BUMP_SERVER_URL` to that
   address (or its `wss://` endpoint), then rebuild and redeploy the static site.
   This URL is public browser configuration, not a secret.
4. Open the redeployed Bump Duel page and share its invite link. Both browsers
   retain the same room ID and connect to the configured server.

Local `npm start` still uses the current host and port without configuration.
An HTTPS page requires a secure `wss://` backend; a localhost server is not a
public backend. Vercel also offers WebSocket Functions, but adopting them here
requires a function endpoint and shared room state across instances; this static
build does not implement that architecture.

## Bump Duel rules

- The Blender mountain and physics both use the same 28-by-16-unit rounded summit. Going below `z = -5` eliminates a player.
- Blue starts left, Red right. Their original equation is translated to start at their current position. Blue follows increasing X; Red follows decreasing X without mirroring the curve.
- The dotted line shows the path and projected stop **without another player's collision**. Hidden opposing input means an exact collision point cannot be predicted before launch.
- Each player locks one equation. The server reveals only whether each player is ready, then starts a shared 3-second countdown. Both launch on the same server tick.
- Launch speed starts at 10 units/second and loses 4 units/second² through friction. The unobstructed travel distance is about `10² / (2 × 4) = 12.5` world units. A collision gives equal and opposite impulses; mass determines the resulting velocity change. A miss normally stops on the summit.
- A saved drawing is reduced to a 128-by-80 alpha mask. The server counts filled pixels to derive approximate mass and collision radius; more ink gives more weight and a larger hit region. Each browser renders the opponent's mask as a vertical silhouette. An absent drawing uses a cube.
- If both players survive, they choose again from their new positions. The last one on the summit wins; simultaneous falls are a draw.

## Main files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Home page with two mode choices. |
| `create.html`, `create.js`, `create.css` | Timed 20L drawing screen; saves the character in session storage. |
| `play.html`, `game.css`, `src/main.js` | Projectile controls, selection, previews, attacks and results. |
| `bump.html`, `duel.css`, `src/duel-client.js` | Bump interface, preview, countdown, and room messages. |
| `server.js` | Static files, conditional asset caching, two-player WebSocket rooms, authoritative physics snapshots. |
| `src/duel.js` | Equation lock, simultaneous launch, path motion, collisions, and winner. |
| `src/equations.js`, `src/physics.js` | Reused parser, sampled curves, gravity, friction, impulse, fixed time step, and fall boundary. |
| `src/scene.js`, `src/mountain.js`, `src/terrain.js` | Shared mountain, matching summit outline, cameras, previews and drawings. |
| `tools/build_mountain.py` | Editable Blender generator for the summit, ruins, cliff, shrubs, and clouds. |
| `assets/mountain.blend`, `assets/mountain.glb` | Blender source and browser-ready model with embedded painted grass texture. |
| `tests/` | Node tests for the duel and existing drawing/math/physics features. |

The combat engines stay separate: `src/combat.js` / `src/projectile.js` for Projectile Duel, and `src/duel.js` on the server for Bump Duel. There is no global mode flag that changes damage rules.

## Current limits

The mountain is a lightweight, editable interpretation of the supplied single-view illustration. A single image does not reveal the rear or true geometry, so this is not an exact reconstruction. Player silhouettes are textured planes with approximate circular collision regions. This does **not** calculate the drawing's center of mass, rotational inertia, or full 3D rigid-body contacts. Those require a separate shape-to-collider pipeline and balance rules. The local room server is a working two-browser prototype, not a deployed public multiplayer service with matchmaking or accounts.

## Round result screen

Finished rounds open a themed result dialog with the winning team, elapsed time,
shots fired, and survivors. Draws have their own message. **Play again** starts a
new round and keeps the equation; **Main menu** returns to the homepage.

The screen uses `victory.css` and `src/victory.js`, with no new dependencies.
Open `/victory.html` for a standalone preview. Add `?winner=Red` or
`?winner=Draw` to preview those states. The actual game supplies live statistics.

The optional `?team=Blue` or `?team=Red` query parameter sets the viewer's team
for `/play.html`. If that team loses, the result dialog shows the loss artwork
and a **Try again** button. Without a team parameter, the existing shared-screen
game continues to show the winner. Preview a loss with
`/victory.html?winner=Red&team=Blue`. The loss background was generated from the
existing landscape and is stored at `assets/defeat-landscape.jpg`.
The same choice is available in the game's **View result as** selector.

## Equation types

Choose a type in the arena, preview the white firing path, then press **Fire**.
All angles use radians. The θ, π and operator buttons insert at the cursor in
the last focused math field, including parameter bounds. `theta`/`θ` and
`pi`/`π` are equivalent. The existing math-expression-evaluator parser is reused;
no JavaScript `eval` or new dependencies are used.

1. **Explicit and symbols:** enter only f(x), such as `sin(x)`, `1/(x-2)`,
   `(x-1)^2`, `e^x`, `ln(x)` or `sqrt(x)`. The existing x domain is [−32,32].
   Blue follows increasing x; Red follows decreasing x. Undefined zero uses
   the first finite sample in that direction, as before.
2. **Parametric and polar:** enter x(t)/y(t), or r(θ), plus start/end values
   (expressions such as `2π` work). Polar converts to `(r*cos(θ), r*sin(θ))`.
   Traversal always follows start toward end, for either team. For a standard
   circle use `3cos(t)`, `3sin(t)` or polar `r=3`. Start is the starting angle;
   the CCW/CW buttons set end to start ±2π. For other expressions, actual
   geometric direction depends on the entered functions. Revisited launch
   points with matching tangents end a closed loop rather than repeating it.
3. **Implicit numerical contours:** enter `x^2+y^2=9`,
   `(x-2)^2+(y+1)^2=4`, `x*y=1`, or F(x,y) without `=0`.
   Select a branch and a launch point by clicking its gray preview or using
   the branch selector and point slider. The whole curve then shifts so that
   point sits on the shooter. Closed branches also offer right/top/left/bottom
   starting points and clockwise/counterclockwise traversal. Open branches
   offer traversal toward either end. Only the chosen continuous path fires.

Every point uses `world = shooter + point − launchPoint`, with Z fixed at 0.5.
Only translation is applied: no mirroring, scaling or removal of transformations
inside the expression. The exact preview points are copied at firing, so recoil,
selection and input changes cannot move an airborne shot. Projectile speed,
damage, force, piercing, recoil, walls and turn rules are unchanged.

### Numerical limits

This is a bounded sampler, not a universal graphing system. Parameter paths use
at most 1,280 intervals; bounds must be finite, within ±1000, and no more than
128π apart. The chosen start must be defined. Sampling stops at detected breaks
or translated coordinates beyond ±1000. Very rapid oscillations and narrow
undefined regions can escape finite sampling; common poles and steps are tested.

Implicit tracing splits a 128×128 grid over [−16,16]² into triangles, finds
verified zero crossings on their edges, and joins adjacent crossings. It stops
at junctions rather than guessing a branch. Its 0.25-unit spacing may miss tiny
loops, isolated zeros, repeated-factor zeros without a sign change, or features
finer than the grid. At most 12,000 contour edges and 128 branches are accepted.
Try a larger-scale/simpler equation if no contour is found. Poles are not treated
as roots just because the sign changes. Rendering is clipped to the arena;
existing swept collisions stop shots at walls and the boundary.

Supported names include sin/cos/tan, inverse and hyperbolic trig, sqrt/abs/exp,
ln (natural log), log (base 10), floor/ceil/round, e and pi. Implicit multiplication
works for `2π`, `2sin(t)` and `3cos(θ)`; write `x*y`, not `xy`. Inequalities,
derivatives, complex numbers and arbitrary program syntax are unsupported.

Run `npm test` for trajectory, parser, physics and combat checks; `npm run build`
also copies the new modules into the deployable `dist` folder.
