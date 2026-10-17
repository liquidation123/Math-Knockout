# Math-Knockout

## Run locally

With Node.js 22 or newer:

    npm install
    npm start

Open http://127.0.0.1:5173/. The homepage opens the drawing screen at
/create.html; the arena is also available directly at /play.html.

## Deploy to Vercel

The game runs in the browser. Vercel should publish the static build, rather than
run the local server. The included vercel.json sets these values:

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Root Directory | Repository root (leave blank in Vercel) |
| Install Command | npm ci |
| Build Command | npm run build |
| Output Directory | dist |

1. Commit and push package.json, build.js, vercel.json, .gitignore, and these
   instructions to the GitHub repository connected to Vercel.
2. In Vercel, open the project connected to liquidation123/Math-Knockout.
   Check that the production branch is main and that Root Directory is the
   repository root, where package.json and vercel.json live.
3. Check the build settings above and deploy the new commit to Production.
   Redeploying an older commit will not include the fix.
4. In Settings > Domains, confirm math-knockout.vercel.app belongs to this project
   and points to the production deployment.
5. Once the deployment is Ready, check /, /create.html, and /play.html.

The build copies the public pages, source, images, and the installed browser
libraries into dist/. It changes dependency URLs in the generated copies to
/vendor/, so deployment does not depend on serving node_modules. No external
CDN, backend, or environment variables are required for the current game.
Do not commit dist/ or node_modules/; Vercel generates them during the build.

To check the build and gameplay tests locally:

    npm run build
    npm test

If the domain still returns 404, check the new production deployment's build logs,
Root Directory, and domain assignment. File changes alone do not update an
already-deployed site until the new commit is deployed.
