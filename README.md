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

## AI opponents

Both game pages have separate **Opponent**, **AI Type**, and **Difficulty** selectors.
Human is the default; AI matches always put you on Blue and the AI on Red.
Changing any selector reloads a fresh
match and cancels pending decisions/dialogue. Drawings and human equation types
are preserved. Projectile aiming now uses a bright yellow ribbon with a dark
outline, centered on exactly the original sampled trajectory.

- **Easy** uses one approximate type-appropriate curve, normal Force and occasional controlled aiming errors.
- **Medium** compares several type-appropriate routes with the existing collision/physics simulation.
- **Hard** compares more curves and forces, penalizes unsafe recoil/landings, and
  chooses the best predicted result. It has no health, damage, speed or mass bonus.

Projectile search checks at most 81 choices (Medium 36); each uses at most eight
seconds of fixed-step simulation. Bump search checks at most twelve curves against
four hypothetical public-state Blue choices. Each trial yields to the browser;
no external AI, API keys or new dependencies are used. These bounded predictions
are imperfect and Hard is not guaranteed to win.

Solo Bump runs entirely in the browser using `createDuel`, `lockEquation`,
`launchDuel` and `updateDuel`. It needs no multiplayer server, including in the
static build. **Human** Bump still uses the configured WebSocket server and
invite rooms. AI decisions receive only a copy of public character state, never
Blue's equation, path or locks. Red commits independently and its fast-typed
equation dialogue stays hidden until both choices lock. Projectile dialogue
appears before firing. Neither mode displays predicted recoil/knockback distances.

Bump AI actively chases the player: candidate curves target Blue, and scoring
rewards closing the gap, real contact and knockouts rather than central retreat.
It may accept a collision trade, but still penalizes falling without a useful hit.
It never reads Blue's hidden choice. Both characters launch toward the rival's
current horizontal side, so they can pursue each other after crossing. Preview
and firing use that same direction; the captured path never homes during flight.

Reproducible regressions in `tests/ai.test.js` compare the three levels at a
projectile recoil edge and in open-summit Bump encounters, checking decision quality
without treating those examples as a win-rate benchmark.

### AI types and disconnected shots

Type restricts equations, never health or physics. Parametric uses `x(t), y(t)`;
Polar uses complete circles or cardioids in `r(θ)` form, never near-straight spirals;
Absolute uses real absolute-value bends; Trig uses waves;
Rational uses a nonconstant polynomial denominator. Normal compares all supported
families, including implicit curves, exponentials, logarithms and roots. Easy has
one simple candidate; higher levels explore more. Dot is Projectile-only: its
domain is isolated x-values, not rational/asymptote sections. Bump deliberately
omits Dot because characters require continuous movement and must never teleport.

In Projectile Duel, an explicit rational graph launches one bullet per sampled
playable branch. The graph is translated once; only the launch branch begins at
the shooter. Cyan rings mark other bullet starts. Non-rational disconnected curves
use one teleporting bullet; purple rings mark arrivals. Dot uses a single bullet
and purple point markers with no connecting curves. Explicit teleports visit later branches
in the team's X direction. Parameter/polar branches retain parameter order;
implicit branches follow the selected branch, then displayed branch-index order.

Teleports have no connector, swept gap, or gap damage. Arrival points are checked
immediately, and a wall or map exit stops the bullet rather than allowing a jump.
Every bullet in an attack shares one hit set. An enemy takes damage/knockback at
most once per attack; recoil occurs once using the launch branch. Turns and victory
wait for all bullets and the existing impact pause. The camera follows only the
launch bullet, cuts on teleports, and trails reset across gaps. Bump characters use
only one continuous launch branch: they never teleport or spawn extra characters.

Players can select **Discrete dots** in Projectile Duel. This is exactly Dot AI's
ability: sample any supported `y=f(x)` at x=0, ±2, ±4, …, ±32 in the team's firing
direction, plus one optional extra x-value (AI uses the target's public relative x).
The whole point set is translated once. Every interval is an undefined gap in
this discrete domain: no interpolation, trail, or collision connector. Inter-dot
timing is distance/projectile-speed while the bullet disappears, then it cuts to
the destination with a flash and checks collision. Normal equation input retains
circles/cardioids, absolute, trig, rational and all other AI-supported families.

Numerical limits remain important: 1,280 sampling intervals, explicit x in [−32,32],
and the existing implicit 0.25-unit contour grid in [−16,16]². Very narrow domain
gaps, tiny loops, and highly oscillatory functions can be missed. Rational detection
uses the existing parser's arithmetic/integer-power tokens for explicit functions;
it is not symbolic simplification of arbitrary equivalent expressions. AI searches
use these same sampled branches and actual combat rules, with bounded lookahead.
If an explicit function is undefined at zero, its automatic anchor now prefers
a finite sample at least one unit in the firing direction, avoiding the near-pole
`1/x` anchor at x=0.05 that looked like a vertical line and exited immediately.
Narrow domains retain a near-zero fallback; functions defined at zero are unchanged.
The input is never rewritten, and a short note explains any nonzero launch anchor.
`tests/ai-types.test.js` checks all 21 Projectile and 18 supported Bump type/difficulty pairs;
`tests/branch-projectiles.test.js` covers both directions, real gaps/asymptotes,
arrival collisions, shared hits, frozen paths, recoil, camera cuts and completion.

## Shared mountain and deliberate adaptations

Both modes use `assets/mountain.glb`, its painted materials, cliff, foliage,
clouds, water and sky, plus the same warm lighting in `src/mountain.js`.
Projectile Duel retains the stone ruins; Bump hides them for a completely open summit.
The editable `assets/mountain.blend` and `tools/build_mountain.py` generate the
browser model. WebP textures and Meshopt geometry compression keep the GLB near
1 MB; `build.js` ships only runtime images and the GLB, not the Blender source.
The 96-point grass rim is reused by `src/terrain.js` for ground support, falls,
curve/grid clipping, and projectile edge collisions. The top is flat at Z=0;
Z remains height. A character's centre leaving the rim loses support, as before.
Lower cliff surfaces and the decorative outer rim are scenery, not landable ground.

The projectile collision boxes appear as stone barriers in Projectile Duel,
with exactly matching dimensions. Bump Duel has no visible walls and no wall
colliders, during either launches or knockback. Projectile Duel's bullet speed/damage, Force and
recoil are unchanged. Bump Duel's launch is slower (7.5 units/s with 2.25
units/s² friction) while retaining the same 12.5-unit unobstructed distance.
Bump's dotted path is still an unobstructed projection; contact with a rival can
alter actual travel, and the cliff edge still causes falls.

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
