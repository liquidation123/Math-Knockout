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
- There are no keyboard or direct movement controls. Characters move only through
  knockback, gravity, and the existing physics.
- Enter f(x), inspect the dashed white firing path, and press Fire.
- The selected character anchors the preview. Selecting another character
  cannot move an already-fired projectile's path.
- Only the current team's selected character can fire. Teams alternate when the
  active attack's existing 0.7-second lifetime ends. One attack is active at a time.
- New round restores all six characters and randomizes their spawns. The current
  expression is retained. Previous iteration/debug views and automatic controls
  have been removed from the website; turns are player-controlled.

A character is eliminated at zero health or below z = -5. Eliminated cubes disappear,
stop moving, and cannot be selected or hit. If the selected character is eliminated,
selection falls back to another surviving teammate. The round ends only when a whole
team is eliminated. Simultaneous team elimination is a draw.

## Arena coordinates and obstacles

X points right, Y up, and Z is height toward the camera. The orthographic camera
looks directly down -Z. Framing includes the entire 28-by-16-unit platform, with margins,
at both narrow and wide aspect ratios. The platform's top is z = 0.
Characters are one-unit cubes, landing with their centres at z = 0.5.

Spawn centres are in the left/right bands 7 <= |x| <= 12.5, with |y| <= 6.5.
This leaves a 14-unit central buffer between spawn zones, at least 2.5 units
between teammates, and a full cube footprint plus 0.5-unit obstacle clearance.
Each character gets at most 50 placement attempts. If placement fails, the entire
team uses its verified fallback slots: x = -10 or +10; y = -5, 0, +5.
Replacing the whole team prevents fallback/random overlap.

Twelve orange boxes form two open L-walls, staggered barriers, and two block
clusters. The same OBSTACLES dimensions create each visible box and each collision
rectangle: no encompassing rectangle fills the L notches or the 1.6-unit cluster
gaps. The central horizontal corridor stays open. Obstacles are confined to the
middle of the arena, away from both spawn bands; spawns cannot be enclosed.

Character movement sweeps X then Y against the obstacle rectangles, expanded by the
character's half-width. A crossing is clamped to the obstacle face, and that component
of knockback velocity is stopped. This prevents large knockback steps from
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

Curves are automatically translated, never stretched or mirrored. For finite f(0):

    worldX = characterX + x
    worldY = characterY + (f(x) - f(0))
    worldZ = 0.5

For example, 6 becomes a horizontal shot, x+6 becomes a diagonal shot,
e^x becomes e^x-1, and (x-1)^2+1 becomes (x-1)^2-1.
The input keeps the original expression.

If f(0) is undefined, scan the 0.05-unit samples from zero in the firing direction.
Use the first finite point (a, f(a)) and translate both coordinates:

    worldX = characterX + (x - a)
    worldY = characterY + (f(x) - f(a))

If that side has no finite samples, scan from the opposite domain edge in the same
direction. This allows a valid branch on either side rather than rejecting it.
Invalid syntax or no finite sampled launch point produces an equation error.

Sampling uses -32 <= localX <= 32, at 0.05-unit intervals, to cover the wider arena.
Undefined/nonfinite values and far-offscreen |f(x)-f(a)| > 1000 are omitted.
The limit is applied after translation, so large constant offsets still work.
Midpoint overshoots and flat-to-flat steps split poles and discontinuities;
steep monotone sections such as the first segment of 1/x stay connected.

Blue follows increasing original x; Red follows decreasing original x. This reverses
traversal, not the curve's shape. The preview shows only the continuous outgoing
branch from the launch anchor. A one-point branch can fire but immediately stops.
The ball starts directly at the shooter; there is no launch transition or connector.
Firing copies the expression, shooter position, and exact translated preview points.
The fixed shot cannot follow later selection changes or knockback.

## Projectile movement and collisions

The bright sphere uses an emissive material and a small transparent halo; no bloom
or extra graphics library is used. The solid fired curve is only a visual guide.

On the curve, the ball moves at 60 world units per second measured along the
sampled polyline. Each update spends speed * elapsedTime along successive segments,
including partial segments. Steep curves therefore do not make the ball move faster.
The speed is increased to cover the larger map; the existing attack lifetime
remains 0.7 second. Curves are visually clipped
to the platform rectangle, without changing the sampled firing path.

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

## Shooter-relative Cartesian grid

The selected shooter is always (0, 0). Grid lines are exactly one world/physics unit
apart; axis numbers appear every two units, with +X right and +Y up.
Both axes and their numbers move when the selected shooter changes or is knocked back.
Enemy labels show (enemyX-shooterX, enemyY-shooterY), rounded to one decimal for
readability; physics and equation samples retain full precision. Labels follow moving
enemies and disappear on elimination. These coordinates are gameplay aiming aids,
not the removed debug readouts.

## Fullscreen interface and diagnostics

The canvas fills the viewport with no page scrolling. Compact health and firing
panels overlay it. A ResizeObserver watches both the viewport container and panels,
including validation/winner text changes. The orthographic frustum is sized and
shifted so the whole platform fits between the panels, even on portrait screens.
Very narrow screens necessarily show a smaller arena; this is not a mobile-first
touch game.

Only gameplay information remains on the page. Spawn coordinates, selections,
shots, impacts, eliminations, turns, and results are logged to the browser console
once per event, not every frame. Invalid equations are reported in the controls;
a rejected expression is also logged when the edit is committed.
The engine's existing automatic simulation is retained for regression tests only,
not exposed by a checkbox or URL.

## Verification and limitations

Automated tests cover camera framing, all input examples, selected-character anchoring,
immutable fired paths, turn restrictions, individual/team elimination, 1,000 seeded random spawn layouts, bounded fallback placement,
obstacle movement blocking and open compound-shape gaps, first-hit ordering, fast swept collisions, all four map
edges, arc-length speed, translated anchors, grid units and relative coordinates,
undefined-zero fallback anchors, branch stopping, and complete
fixed-corridor rounds at 30/60/144 rendering frames per second.
These controlled combat fixtures do not prove that every random layout has a winning shot.

Approximations remain deliberate: characters use circular projectile hit regions,
obstacle corners use expanded rectangles, and obstacles have axis-separated movement
resolution. Moving enemies are checked at each fixed physics step, not with a full
continuous moving-body solver. Sampling cannot guarantee detection of every narrow
discontinuity or accurately reproduce details smaller than the sampling interval.
The first finite point near a singularity may produce a very steep translated shot.
This demonstration is not balanced competitive gameplay.

## Files

- src/equations.js: existing parser, sampling, and outgoing firing-path selection.
- src/physics.js: arena, obstacle definitions, characters, motion, and impulses.
- src/projectile.js: projectile movement and swept collisions.
- src/grid.js: Cartesian grid positions and shooter-relative coordinate labels.
- src/spawns.js: bounded random placement, spawn clearance, and safe fallback slots.
- src/combat.js: teams, selection, turns, and eliminations.
- src/scene.js: camera, six cubes, selection outline, obstacles, and glowing ball.
- src/main.js: input, previews, team readout, and simulation loop.
- index.html / style.css: fullscreen canvas and compact gameplay overlays.
- tests/: Node's built-in test runner.

Root-level physics.js and shapes.js are separate existing files, not used or modified here.
