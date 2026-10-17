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
