# Out-Mathed

A browser game where two players draw characters, secretly choose equations, and launch together across a mountain summit. It uses plain HTML/CSS/JavaScript, Three.js for rendering, `ws` for the room connection, and the existing equation parser and fixed-step physics.

## Run

Use Node.js 22 or newer:

    npm install
    npm start

Open `http://127.0.0.1:5173`. PLAY opens the 10-second drawing screen; after it locks, choose **Open arena demo**. Copy the invite link and open it in another browser/tab for Red. Each player can draw on their own device before joining the same room. Run `npm test` for the Node tests. The server binds to localhost by default; set `HOST=0.0.0.0` and `PORT` for a Node host that accepts external connections. A public host/domain is not configured in this repository.

## Duel rules

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
| `index.html`, `style.css` | Home page and PLAY link. |
| `create.html`, `create.js`, `create.css` | Timed 20L drawing screen; saves the character in session storage. |
| `play.html`, `duel.css`, `src/duel-client.js` | First-person duel interface, preview, countdown, and room messages. |
| `server.js` | Static files, conditional asset caching, two-player WebSocket rooms, authoritative physics snapshots. |
| `src/duel.js` | Equation lock, simultaneous launch, path motion, collisions, and winner. |
| `src/equations.js`, `src/physics.js` | Reused parser, sampled curves, gravity, friction, impulse, fixed time step, and fall boundary. |
| `src/scene.js` | Three.js cameras, GLB mountain, dotted preview, and player silhouettes. |
| `tools/build_mountain.py` | Editable Blender generator for the summit, ruins, cliff, shrubs, and clouds. |
| `assets/mountain.blend`, `assets/mountain.glb` | Blender source and browser-ready model with embedded painted grass texture. |
| `tests/` | Node tests for the duel and existing drawing/math/physics features. |

The earlier six-character projectile modules remain in `src/combat.js`, `src/projectile.js`, `src/main.js`, and related tests. The public `play.html` now uses the two-character duel instead.

## Current limits

The mountain is a lightweight, editable interpretation of the supplied single-view illustration. A single image does not reveal the rear or true geometry, so this is not an exact reconstruction. Player silhouettes are textured planes with approximate circular collision regions. This does **not** calculate the drawing's center of mass, rotational inertia, or full 3D rigid-body contacts. Those require a separate shape-to-collider pipeline and balance rules. The local room server is a working two-browser prototype, not a deployed public multiplayer service with matchmaking or accounts.
