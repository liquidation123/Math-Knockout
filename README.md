# Out-Mathed

Draw a character, then use equations to compete on a mountain. The site has two modes:

- **Projectile Duel** (`play.html`): three characters per team take turns firing equation-shaped shots. Play locally against a friend or one AI opponent.
- **Bump Duel** (`bump.html`): two characters secretly choose paths and launch together. Collisions push characters; the last one on the summit wins. Use an invite link for an online room, or Quick Match for a bot if no second player joins within 10 seconds.

Both modes use the same Three.js mountain (`assets/mountain.glb`), equation parser, and fixed-step physics. The equation editor uses **MathLive**, styled like a math notebook; it does not use the Desmos API. If MathLive fails to load, plain text inputs still work.

## Character drawing

`create.html` starts a 10-second clock when drawing begins. You get 20 L of ink: one liter covers 1% of the 720×440 canvas. Repainting an occupied pixel costs nothing. Pencil, line, bucket, undo, and clear share the same ink count. Press **Enter** to finish early. The drawing is saved in tab `sessionStorage`, so keep the same tab when entering the arena.

`create.js` saves the image and a compact occupancy mask. `src/character-geometry.js` calculates area, mass, centre of mass, and moment of inertia from that mask. `src/body.js` uses the same mask for the extruded Three.js shape and Bump Duel contact outline. This keeps what you see aligned with what collides. Projectile Duel keeps its existing projectile combat rules.

## Bump Duel

The Node/WebSocket server (`server.js`) owns online rooms, side assignments, bot matchmaking, countdowns, and the authoritative simulation. The bot sees positions and masses, never the player's hidden equation. It chooses a varied dodge path. The arena rim shrinks between rounds; ruins enter on round 3. A short replay follows a final collision. Interrupted connections can rejoin the same room with a session token.

On static hosting without a configured WebSocket backend, Quick Match runs the same Bump simulation against a browser bot. Online invites require a persistent server and `BUMP_SERVER_URL` at build time. Static hosting alone cannot host multiplayer rooms.

The editable mountain source is `assets/mountain.blend`; `tools/build_mountain.py` exports the browser GLB. The exported GLB is about 2.1 MB. `src/mountain.js` loads it once, and `src/scene.js` renders the arena, characters, previews, and camera views.

## Run and verify

Use Node.js 22 or newer:

```sh
npm install
npm start
```

Open the printed local address. For a second device, run the server on a reachable host (`HOST=0.0.0.0`) and open that host's address on both devices; `localhost` only reaches the device itself. An old server process must be restarted after pulling changes.

During local development, `npm start` checks files every second. Frontend changes
reload open pages; backend and shared simulation changes restart the server and
then reload pages. A backend restart clears local multiplayer rooms. Dependencies,
generated output, hidden folders, and tests are ignored. Stop with Ctrl+C.
Refresh is disabled when `NODE_ENV=production`, or when running on Render or Vercel.
To run locally without refresh, use `NODE_ENV=production npm start`.

```sh
npm test
npm run build
```

`dist/` contains the static deployment. The tests cover drawing and ink, equation parsing, fixed-step physics, collision masks, both game modes, bot choices, room connections, and the static solo fallback.

## PostHog

The shared browser setup records page activity and the custom events
`character_created`, `projectile_attack_fired`, `projectile_round_completed`,
`bump_path_locked`, `bump_duel_completed`, and `bump_invite_copied`.
The multiplayer server also exports startup, countdown, and room-release logs.
These events do not include drawings, room/reconnect tokens, or typed equations.

Set `POSTHOG_PROJECT_TOKEN` to the public project token and `POSTHOG_HOST` to
the ingestion host from your PostHog project (for example, `https://us.i.posthog.com`).
For local use, keep these in `.env`, which is ignored by Git. With Node 22.9 or
newer, `npm start` and `npm run build` load that file automatically.
Without configuration, analytics stays disabled and the game still works.

For Vercel, set both variables in Production and rebuild/redeploy; the static
build exposes only these two public values in `posthog-config.json`.
For Render, set both variables on the Node service and deploy the latest commit.
Never use a personal API key in browser configuration. The browser SDK can be
blocked by an ad blocker; verify live ingestion in PostHog after deployment.

Web deploy: https://math-knockout-2.onrender.com/
