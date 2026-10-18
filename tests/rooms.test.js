import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(check) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await delay(20);
  }
  throw new Error("Timed out waiting for the local duel server.");
}

test("mode pages load; Bump restart cancels old countdowns and an empty room starts fresh", { timeout: 15000 }, async (t) => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../", import.meta.url), env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });
  const address = await waitUntil(() => output.match(/Out-Mathed: (http:\/\/[^\s]+)/)?.[1]);
  for (const path of ["/", "/play.html", "/bump.html", "/assets/mountain.glb"]) {
    assert.equal((await fetch(address + path)).status, 200, path);
  }
  const clients = [];
  function connect() {
    const socket = new WebSocket(address.replace("http:", "ws:") + "/?room=integration-test");
    const client = { socket, state: null, shapes: [] };
    clients.push(client);
    socket.on("message", (bytes) => {
      const message = JSON.parse(bytes);
      if (message.type === "state") client.state = message;
      if (message.type === "shape") client.shapes.push(message);
    });
    return client;
  }
  t.after(() => clients.forEach((client) => client.socket.terminate()));
  const blue = connect(), red = connect();
  await waitUntil(() => blue.state && red.state);
  assert.equal(blue.state.side, 0);
  assert.equal(red.state.side, 1);
  const extra = connect();
  const [closeCode, closeReason] = await once(extra.socket, "close");
  assert.equal(closeCode, 1008);
  assert.match(closeReason.toString(), /two players/);
  assert.equal(extra.state, null, "A full room must never assign a fake side.");
  const initialPositions = blue.state.players.map((player) => player.position);
  const lockBoth = () => [blue, red].forEach((client) => client.socket.send(JSON.stringify({ type: "lock", expression: "0" })));
  lockBoth();
  await waitUntil(() => blue.state.phase === "countdown");
  const oldLaunchTime = blue.state.startAt;
  await delay(650);
  blue.socket.send(JSON.stringify({ type: "reset" }));
  await waitUntil(() => blue.state.phase === "planning" && blue.state.locked.every((value) => !value));
  assert.deepEqual(blue.state.players.map((player) => player.position), initialPositions);
  assert.equal(blue.state.winner, null);
  lockBoth();
  await waitUntil(() => blue.state.phase === "countdown");
  assert.ok(blue.state.startAt > oldLaunchTime + 500);
  await delay(Math.max(0, oldLaunchTime + 120 - Date.now()));
  assert.equal(blue.state.phase, "countdown", "An old timer must not launch the new round early.");
  await waitUntil(() => blue.state.phase === "running");
  assert.ok(blue.state.players.every((player) => player.health === 100));

  // Leaving clears the departing player's old drawing on the remaining client.
  const mask = "1".repeat(100) + "0".repeat(10140);
  blue.socket.send(JSON.stringify({ type: "reset" }));
  await waitUntil(() => blue.state.phase === "planning");
  red.socket.send(JSON.stringify({ type: "shape", mask }));
  await waitUntil(() => blue.shapes.some((message) => message.side === 1 && message.mask === mask));
  await waitUntil(() => blue.state.players[1].mass !== 1);
  assert.ok(Math.abs(blue.state.players[1].mass - (0.8 + 0.06 * 100 * 100 / 10240)) < 1e-6);
  red.socket.close();
  await once(red.socket, "close");
  await waitUntil(() => blue.shapes.some((message) => message.side === 1 && message.mask === null));
  blue.socket.close();
  await once(blue.socket, "close");
  const fresh = connect();
  await waitUntil(() => fresh.state);
  assert.equal(fresh.state.side, 0);
  assert.equal(fresh.state.phase, "planning");
  assert.deepEqual(fresh.state.locked, [false, false]);
  assert.deepEqual(fresh.state.players.map((player) => player.position), initialPositions);
  assert.ok(fresh.state.players.every((player) => player.health === 100 && player.mass === 1));
});
