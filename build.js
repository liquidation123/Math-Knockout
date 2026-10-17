import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const output = new URL("./dist/", root);

// Rebuild only the generated public folder. The local development server is unchanged.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of [
  "index.html", "create.html", "play.html", "victory.html",
  "style.css", "create.css", "game.css", "duel.css", "victory.css", "create.js", "src", "assets",
]) {
  await cp(new URL(file, root), new URL(file, output), { recursive: true });
}

// Publish just the browser libraries, rather than relying on /node_modules URLs.
await mkdir(new URL("vendor/three/", output), { recursive: true });
await mkdir(new URL("vendor/math-expression-evaluator/", output), { recursive: true });
for (const [source, destination] of [
  ["three/build/three.module.js", "three/three.module.js"],
  ["three/build/three.core.js", "three/three.core.js"],
  ["three/LICENSE", "three/LICENSE"],
  ["three/examples/jsm/loaders/GLTFLoader.js", "three/addons/loaders/GLTFLoader.js"],
  ["three/examples/jsm/utils/BufferGeometryUtils.js", "three/addons/utils/BufferGeometryUtils.js"],
  ["three/examples/jsm/utils/SkeletonUtils.js", "three/addons/utils/SkeletonUtils.js"],
  ["math-expression-evaluator/dist/browser/math-expression-evaluator.min.js", "math-expression-evaluator/math-expression-evaluator.min.js"],
  ["math-expression-evaluator/LICENSE", "math-expression-evaluator/LICENSE"],
]) {
  await cp(new URL("node_modules/" + source, root), new URL("vendor/" + destination, output));
}

const playPage = new URL("play.html", output);
await writeFile(playPage, (await readFile(playPage, "utf8"))
  .replace("/node_modules/three/build/three.module.js", "/vendor/three/three.module.js")
  .replace("/node_modules/three/examples/jsm/", "/vendor/three/addons/"));
const parser = new URL("src/math-parser-browser.js", output);
await writeFile(parser, (await readFile(parser, "utf8"))
  .replace("../node_modules/math-expression-evaluator/dist/browser/", "../vendor/math-expression-evaluator/"));

console.log("Built Out-Mathed in dist/ (homepage, character creator, arena, and browser libraries).");
