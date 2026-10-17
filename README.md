# Math-Knockout

## Run locally

With Node.js 22 or newer:

    npm install
    npm start

Open http://127.0.0.1:5173/. The homepage opens the drawing screen at
/create.html; the arena is also available directly at /play.html.

Vercel Deployment: https://math-knockout.vercel.app/
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
