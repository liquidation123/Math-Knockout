import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { duelSocketUrl } from "./src/duel-connection.js";

const root = new URL("./", import.meta.url);
const output = new URL("./dist/", root);
const bumpServerUrl = process.env.BUMP_SERVER_URL?.trim() || "";
if (bumpServerUrl) duelSocketUrl("https://example.com/bump.html?room=build-check", bumpServerUrl);

// Rebuild only the generated public folder. The local development server is unchanged.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of [
  "index.html", "create.html", "play.html", "bump.html", "victory.html",
  "style.css", "create.css", "game.css", "duel.css", "victory.css", "create.js", "src",
]) {
  await cp(new URL(file, root), new URL(file, output), { recursive: true });
}
await mkdir(new URL("assets/", output));
for (const file of ["hero-landscape.jpg", "defeat-landscape.jpg", "pencil-cursor.svg", "mountain.glb"]) {
  await cp(new URL("assets/" + file, root), new URL("assets/" + file, output));
}

// Publish just the browser libraries, rather than relying on /node_modules URLs.
await mkdir(new URL("vendor/three/", output), { recursive: true });
await mkdir(new URL("vendor/math-expression-evaluator/", output), { recursive: true });
for (const [source, destination] of [
  ["three/build/three.module.js", "three/three.module.js"],
  ["three/build/three.core.js", "three/three.core.js"],
  ["three/LICENSE", "three/LICENSE"],
  ["three/examples/jsm/loaders/GLTFLoader.js", "three/addons/loaders/GLTFLoader.js"],
  ["three/examples/jsm/libs/meshopt_decoder.module.js", "three/addons/libs/meshopt_decoder.module.js"],
  ["three/examples/jsm/utils/BufferGeometryUtils.js", "three/addons/utils/BufferGeometryUtils.js"],
  ["three/examples/jsm/utils/SkeletonUtils.js", "three/addons/utils/SkeletonUtils.js"],
  ["math-expression-evaluator/dist/browser/math-expression-evaluator.min.js", "math-expression-evaluator/math-expression-evaluator.min.js"],
  ["math-expression-evaluator/LICENSE", "math-expression-evaluator/LICENSE"],
]) {
  await cp(new URL("node_modules/" + source, root), new URL("vendor/" + destination, output));
}

for (const name of ["play.html", "bump.html"]) {
  const page = new URL(name, output);
  await writeFile(page, (await readFile(page, "utf8"))
    .replace("/node_modules/three/build/three.module.js", "/vendor/three/three.module.js")
    .replace("/node_modules/three/examples/jsm/", "/vendor/three/addons/"));
}
const parser = new URL("src/math-parser-browser.js", output);
await writeFile(parser, (await readFile(parser, "utf8"))
  .replace("../node_modules/math-expression-evaluator/dist/browser/", "../vendor/math-expression-evaluator/"));

const connection = new URL("src/duel-connection.js", output);
await writeFile(connection, (await readFile(connection, "utf8"))
  .replace('export const BUMP_SERVER_URL = "";', "export const BUMP_SERVER_URL = " + JSON.stringify(bumpServerUrl) + ";"));
if (!bumpServerUrl) console.warn("Bump Duel: BUMP_SERVER_URL is unset. This static build needs a live multiplayer server; npm start on your computer does not start one on Vercel.");

console.log("Built Out-Mathed in dist/ (homepage, character creator, arena, and browser libraries).");
