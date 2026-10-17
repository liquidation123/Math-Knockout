# Out-Mathed

A plain-JavaScript, Three.js equation combat game with three cubes per team.
The existing math-expression-evaluator library handles input; no new dependencies were added.

## Run

With Node.js 22 or newer, open a terminal in this folder:

    npm install
    npm start

Open http://127.0.0.1:5173. No build step or network connection is needed after installation.

    npm test

## Team controls and turns

- Blue and Red each have three independently simulated characters, initially 100 HP each.
- Click a surviving cube on the current team. A yellow outline and the team readout identify it.
- The selected Blue character moves with WASD; the selected Red character uses arrow keys.
  Click the arena to focus movement. Typing in the equation field does not move characters.
- Enter f(x), inspect the dashed white firing path, and press Fire.
- The selected character anchors the preview. Selecting or moving another character
  cannot move an already-fired projectile's path.
- Only the current team's selected character can fire. Teams alternate when the
  active attack's existing 0.7-second lifetime ends. One attack is active at a time.
- Automatic demo retains alternating teams and a minimum 1.25-second cast interval.
  It aims the existing line/sine/parabola patterns at surviving opponents by adding
  a linear term. Displayed automatic coefficients are rounded to four decimal places.
- Restart restores all six characters, health, selection, attacks, and turn state.
  The current expression and automatic setting are retained.

A character is eliminated at zero health or below z = -5. Eliminated cubes disappear,
stop moving, and cannot be selected or hit. If the selected character is eliminated,
selection falls back to another surviving teammate. The round ends only when a whole
team is eliminated. Simultaneous team elimination is a draw.

## Arena coordinates and obstacles

X points right, Y up, and Z is height toward the camera. The orthographic camera
looks directly down -Z. Framing includes the entire 20-by-8-unit platform, with margins,
at both narrow and wide aspect ratios. The platform's top is z = 0.
Characters are one-unit cubes, landing with their centres at z = 0.5.

Each team spawns at x = -6 or +6, with y = -2, 0, and +2.
Three orange obstacles use fixed dimensions and positions from src/physics.js.
Spawn footprints are clear; horizontal firing lanes remain open.

Character movement sweeps X then Y against the obstacle rectangles, expanded by the
character's half-width. A crossing is clamped to the obstacle face, and that component
of knockback velocity is stopped. This prevents large walking/knockback steps from
tunnelling through obstacles and permits simple sliding along their sides.
Obstacles are XY barriers, with no climbing or jumping.

Gravity affects only Z. Ground friction reduces the magnitude of XY velocity.
The platform checks both XY boundaries; crossing an edge permits falling.
Character-to-character solid collision is intentionally unchanged (not implemented).

Knockback remains:

    direction = (targetXY - attackerXY) / distance
    changeInVelocity = direction * 3.2 / mass

Overlapping positions use (+1, 0). Physics still runs at 1/120 second per step,
with at most 0.25 second of catch-up after a long background pause.

## Equations and firing path

The parser supports the existing expressions, including:

    (x-1)^2 + 1
    e^x
    2sin(1/2 x) - 1

Parentheses, powers, implicit multiplication, and common functions are supported.
Trigonometry uses radians. Input is restricted to mathematical names and operators.
ln is natural logarithm, log is base 10. Chained powers should be parenthesized
explicitly because the library's ^ operator is left-associative.

Coordinates remain unscaled and unmirrored:

    worldX = characterX + localX
    worldY = characterY + f(localX)
    worldZ = 0.5

Sampling now uses -24 <= localX <= 24, at 0.05-unit intervals, to cover the wider arena.
Undefined/nonfinite values and far-offscreen |f(x)| > 1000 are omitted.
The existing midpoint/jump checks separate discontinuous branches.

The firing path starts at local x = 0. Blue follows increasing local x;
Red follows decreasing local x. This reverses traversal, not the equation's shape.
The preview shows exactly this outgoing portion of the first continuous branch.
An undefined f(0), or no outgoing continuous segment, disables Fire with an error.
The ball stops when that branch ends; it never teleports to another branch.

If f(0) is nonzero, the ball makes a 0.12-second visual transition from the character
to the first curve point. No connector is drawn, and enemies cannot take damage
during that transition. Obstacles and map boundaries can still stop the launch.
Firing copies the expression, origin, and exact preview points.

## Projectile movement and collisions

The bright sphere uses an emissive material and a small transparent halo; no bloom
or extra graphics library is used. The solid fired curve is only a visual guide.

On the curve, the ball moves at 40 world units per second measured along the
sampled polyline. Each update spends speed * elapsedTime along successive segments,
including partial segments. Steep curves therefore do not make the ball move faster.
The existing attack lifetime remains 0.7 second, including any launch transition.

Every travelled segment is swept for its earliest collision:

- Enemies: solve the segment-versus-circle quadratic, using character radius 0.5
  plus projectile radius 0.12. The enemy's height must overlap the combat plane.
- Obstacles: intersect X/Y entry and exit intervals against a rectangle expanded
  by the projectile radius (the slab method).
- Map edges: find the earliest crossing of the platform boundary, inset by the
  projectile radius.

The earliest collision wins, so a shot cannot hit through an earlier obstacle or
enemy. Teammates are ignored. Only arrival at an enemy removes 20 health and applies
one XY impulse. The projectile then stops, preventing repeated damage or knockback.
A stopped ball remains visible until its original lifetime ends.

## Verification and limitations

Automated tests cover camera framing, all input examples, selected-character anchoring,
immutable fired paths, turn restrictions, individual/team elimination, clear spawns,
obstacle movement blocking, first-hit ordering, fast swept collisions, all four map
edges, arc-length speed, harmless offset launches, branch stopping, and complete
rounds at 30/60/144 rendering frames per second.

Approximations remain deliberate: characters use circular projectile hit regions,
obstacle corners use expanded rectangles, and obstacles have axis-separated movement
resolution. Moving enemies are checked at each fixed physics step, not with a full
continuous moving-body solver. Sampling cannot guarantee detection of every narrow
discontinuity; steep continuous details may be omitted conservatively.
This demonstration is not balanced competitive gameplay.

## Files

- src/equations.js: existing parser, sampling, and outgoing firing-path selection.
- src/physics.js: arena, obstacle definitions, characters, motion, and impulses.
- src/projectile.js: projectile movement, launch transition, and swept collisions.
- src/combat.js: teams, selection, turns, eliminations, and automatic demo.
- src/scene.js: camera, six cubes, selection outline, obstacles, and glowing ball.
- src/main.js: input, previews, team readout, and simulation loop.
- index.html / style.css: existing page and controls.
- tests/: Node's built-in test runner.

The earlier ?iteration=1 and ?iteration=2 views remain available with the updated arena.
Root-level physics.js and shapes.js are separate existing files, not used or modified here.
