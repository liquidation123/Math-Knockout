import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import WebSocket from "ws";

const root = new URL("../", import.meta.url);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function start(t, env = {}) {
  const folder = await mkdtemp(join(tmpdir(), "out-mathed-refresh-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const file of ["package.json", "server.js", "dev", "src", "index.html", "play.html", "bump.html"]) {
    await cp(new URL(file, root), join(folder, file), { recursive: true });
  }
  await symlink(new URL("node_modules", root).pathname, join(folder, "node_modules"));
  const child = spawn(process.execPath, ["dev/start.js"], {
    cwd: folder,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", NODE_ENV: "development",
      RENDER: "", VERCEL: "", POSTHOG_PROJECT_TOKEN: "", POSTHOG_HOST: "", ...env },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });
  async function waitFor(check) {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      if (child.exitCode !== null) throw new Error(output);
      await pause(30);
    }
    throw new Error("Refresh timed out: " + output);
  }
  const addresses = () => [...output.matchAll(/Out-Mathed: (http:\/\/[^\s]+)/g)].map((match) => match[1]);
  await waitFor(() => addresses()[0]);
  const version = async () => (await fetch(addresses().at(-1) + "/__dev/version")).text();
  return { folder, addresses, waitFor, version };
}

test("development refresh reloads frontend files, restarts shared backend code, and ignores generated files", { timeout: 15000 }, async (t) => {
  const game = await start(t);
  const original = await game.version();
  for (const page of ["/", "/play.html", "/bump.html"]) {
    const html = await (await fetch(game.addresses()[0] + page)).text();
    assert.ok(html.includes('/dev/client.js?version=' + original), page);
  }
  const socket = new WebSocket(game.addresses()[0].replace("http:", "ws:") + "/?room=refresh-test");
  t.after(() => socket.terminate());
  const [data] = await once(socket, "message");
  assert.equal(JSON.parse(data).side, 0);

  await writeFile(join(game.folder, "frontend.css"), "body { color: red; }");
  await game.waitFor(async () => await game.version() !== original);
  assert.equal(game.addresses().length, 1, "frontend changes keep the server running");
  assert.equal(socket.readyState, WebSocket.OPEN, "the multiplayer connection stays open");
  const frontendVersion = await game.version();
  for (const folder of ["dist", ".git", "coverage", "tests"]) {
    await mkdir(join(game.folder, folder), { recursive: true });
    await writeFile(join(game.folder, folder, "ignored.js"), "// ignored");
  }
  await pause(1300);
  assert.equal(await game.version(), frontendVersion);
  assert.equal(game.addresses().length, 1);

  const physics = join(game.folder, "src/physics.js");
  await writeFile(physics, await readFile(physics, "utf8") + "\n// Backend change\n");
  await game.waitFor(() => game.addresses().length === 2);
  assert.notEqual(await game.version(), frontendVersion);
  const next = new WebSocket(game.addresses().at(-1).replace("http:", "ws:") + "/?room=restarted-test");
  t.after(() => next.terminate());
  assert.equal(JSON.parse((await once(next, "message"))[0]).side, 0);
});

test("production and hosting environments do not inject refresh or watch files", { timeout: 15000 }, async (t) => {
  for (const env of [{ NODE_ENV: "production" }, { RENDER: "true" }, { VERCEL: "1" }]) {
    await t.test(JSON.stringify(env), async (t) => {
      const game = await start(t, env);
      const address = game.addresses()[0];
      assert.doesNotMatch(await (await fetch(address)).text(), /dev\/client.js/);
      assert.equal((await fetch(address + "/__dev/version")).status, 404);
      await writeFile(join(game.folder, "frontend.css"), "body {}");
      await pause(1100);
      assert.equal(game.addresses().length, 1);
    });
  }
});

test("browser polling reloads on a new version and tolerates a restarting server", async () => {
  const source = await readFile(new URL("dev/client.js", root), "utf8");
  let tick, current = "original", reloads = 0, offline = false;
  runInNewContext(source.replace("import.meta.url", JSON.stringify("http://localhost/dev/client.js?version=original")), {
    URL,
    setInterval: (callback, interval) => { assert.equal(interval, 1000); tick = callback; },
    fetch: async (url, options) => {
      assert.equal(url, "/__dev/version");
      assert.equal(options.cache, "no-store");
      if (offline) throw new Error("Restarting");
      return { ok: true, text: async () => current };
    },
    location: { reload: () => reloads++ },
  });
  await tick();
  assert.equal(reloads, 0);
  offline = true;
  await tick();
  assert.equal(reloads, 0);
  offline = false;
  current = "changed";
  await tick();
  assert.equal(reloads, 1);
});
