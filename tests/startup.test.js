import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import WebSocket from "ws";

const folder = new URL("../", import.meta.url);

async function reservePort(port) {
  const server = createServer();
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    return server;
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    return null;
  }
}

function startGame(t, port) {
  const env = { ...process.env, HOST: "127.0.0.1" };
  if (port === undefined) delete env.PORT;
  else env.PORT = String(port);
  const child = spawn(process.execPath, ["server.js"], { cwd: folder, env });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });
  return { child, output: () => output };
}

async function waitForAddress(game) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const address = game.output().match(/Out-Mathed: (http:\/\/[^\s]+)/)?.[1];
    if (address) return address;
    if (game.child.exitCode !== null) throw new Error(game.output());
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Startup timed out: " + game.output());
}

test("local startup skips a busy default port and serves HTTP plus live rooms", { timeout: 10000 }, async (t) => {
  // Never stop an existing user's server; reserve 5173 only if it is free.
  const blocker = await reservePort(5173);
  if (blocker) t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const game = startGame(t);
  const address = await waitForAddress(game);
  assert.notEqual(new URL(address).port, "5173");
  assert.match(game.output(), /Port 5173 is busy/);
  for (const path of ["/", "/play.html", "/src/duel-client.js", "/node_modules/three/build/three.module.js"]) {
    assert.equal((await fetch(address + path)).status, 200, path);
  }
  const socket = new WebSocket(address.replace("http:", "ws:") + "/?room=startup-test");
  t.after(() => socket.terminate());
  const [data] = await once(socket, "message");
  const message = JSON.parse(data);
  assert.equal(message.type, "state");
  assert.equal(message.phase, "planning");
  assert.equal(message.side, 0);
});

test("an explicit free PORT is respected and reported correctly", { timeout: 10000 }, async (t) => {
  const game = startGame(t, 0);
  const address = await waitForAddress(game);
  assert.ok(Number(new URL(address).port) > 0);
  assert.equal((await fetch(address)).status, 200);
  assert.doesNotMatch(game.output(), /is busy/);
});

test("an explicitly occupied PORT fails clearly without silently moving", { timeout: 10000 }, async (t) => {
  const blocker = await reservePort(0);
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const game = startGame(t, blocker.address().port);
  const [code] = await once(game.child, "exit");
  assert.equal(code, 1);
  assert.match(game.output(), /Could not start Out-Mathed/);
  assert.match(game.output(), /choose a free port/);
  assert.doesNotMatch(game.output(), /trying|Unhandled/);
});
