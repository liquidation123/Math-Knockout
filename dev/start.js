import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const development = process.env.NODE_ENV !== "production" && !process.env.RENDER && !process.env.VERCEL;
const ignored = new Set(["node_modules", "dist", "coverage", "tests", "tools"]);
const extensions = new Set([".js", ".mjs", ".html", ".css", ".json", ".glb", ".jpg", ".png", ".svg", ".webp", ".woff2"]);
let child, stopping = false;

async function snapshot(folder = root, files = new Map()) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if ((entry.name.startsWith(".") && entry.name !== ".env") || ignored.has(entry.name)) continue;
    const filename = join(folder, entry.name);
    if (entry.isDirectory()) await snapshot(filename, files);
    else if (entry.isFile() && (entry.name === ".env" || extensions.has(extname(filename)))) {
      if (filename === fileURLToPath(import.meta.url) || filename === join(root, "build.js")) continue;
      const info = await stat(filename);
      files.set(filename, `${info.mtimeMs}:${info.size}`);
    }
  }
  return files;
}

// Shared modules used by the server need a restart too, not just a browser reload.
async function serverFiles(filename = join(root, "server.js"), files = new Set()) {
  if (files.has(filename)) return files;
  files.add(filename);
  const source = await readFile(filename, "utf8").catch(() => "");
  for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
    await serverFiles(resolve(dirname(filename), match[1]), files);
  }
  return files;
}

function start() {
  child = spawn(process.execPath, ["--env-file-if-exists=.env", "server.js"], {
    cwd: root,
    env: { ...process.env, OUT_MATHED_DEV_VERSION: development ? randomUUID() : "" },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  child.on("exit", (code) => {
    child = null;
    if (stopping || !development) process.exit(code || 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    if (child) child.kill(signal);
    else process.exit(0);
  });
}

let previous = development ? await snapshot() : null;
let backend = development ? await serverFiles() : null;
start();
if (development) console.log("Development refresh: checking for changes every second.");
while (development && !stopping) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (stopping) break;
  try {
    const current = await snapshot();
    const changed = [...new Set([...previous.keys(), ...current.keys()])]
      .filter((filename) => previous.get(filename) !== current.get(filename));
    previous = current;
    if (!changed.length) continue;
    console.log("Changed: " + changed.map((filename) => relative(root, filename)).join(", "));
    const restart = changed.some((filename) => backend.has(filename)
      || ["package.json", ".env"].includes(relative(root, filename)));
    if (restart) {
      backend = await serverFiles();
      if (child) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      if (!stopping) start();
    } else if (child?.connected) {
      child.send({ type: "dev-reload", version: randomUUID() });
    }
  } catch (error) {
    console.warn("Could not check for changes: " + error.message);
  }
}
