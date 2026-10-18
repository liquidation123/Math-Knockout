import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(check, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await delay(20);
  }
  throw new Error("Timed out waiting for the local duel server.");
}

test("mode pages, room resets, and Quick Match bot work on the local server", { timeout: 60000 }, async (t) => {
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
  function connect(query = "room=integration-test") {
    const socket = new WebSocket(address.replace("http:", "ws:") + "/?" + query);
    const client = { socket, state: null, shapes: [], errors: [] };
    clients.push(client);
    socket.on("message", (bytes) => {
      const message = JSON.parse(bytes);
      if (message.type === "state") client.state = message;
      if (message.type === "shape") client.shapes.push(message);
      if (message.type === "error") client.errors.push(message.error);
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
  assert.match(closeReason.toString(), /room is full/);
  assert.equal(extra.state, null, "A full room must never assign a fake side.");
  blue.socket.send(JSON.stringify({ type: "lock", expression: "0", force: 100 }));
  await waitUntil(() => blue.errors.length);
  assert.match(blue.errors[0], /Force/);
  assert.equal(blue.state.locked[0], false);
  blue.socket.send(JSON.stringify({ type: "lock", expression: "0", force: .5 }));
  await waitUntil(() => blue.state.locked[0]);
  assert.equal(blue.state.phase, "planning");
  assert.equal(blue.state.paths, undefined, "an opponent's chosen path and force stay hidden");
  blue.socket.send(JSON.stringify({ type: "reset" }));
  await waitUntil(() => !blue.state.locked[0]);
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
  await waitUntil(() => blue.state.round === 2 && red.state.round === 2, 12000);
  assert.equal(blue.state.radius, red.state.radius);
  assert.ok(Math.abs(blue.state.radius - 7.55) < 1e-8);
  assert.equal(blue.state.phase, "planning");
  assert.ok(blue.state.players.every((p) => Math.hypot(p.position.x, p.position.y) < blue.state.radius));
  red.socket.send(JSON.stringify({ type: "resign", side: 0 })); // The server must use the socket's side.
  await waitUntil(() => blue.state.phase === "finished" && red.state.phase === "finished");
  assert.equal(blue.state.winner, "Blue");
  assert.equal(red.state.resignedBy, 1);

  // Leaving clears the departing player's old drawing on the remaining client.
  const mask = "1".repeat(100) + "0".repeat(10140);
  blue.socket.send(JSON.stringify({ type: "reset" }));
  await waitUntil(() => blue.state.phase === "planning");
  red.socket.send(JSON.stringify({ type: "shape", mask }));
  await waitUntil(() => blue.shapes.some((message) => message.side === 1 && message.mask === mask));
  await waitUntil(() => blue.state.players[1].mass !== 1);
  assert.ok(Math.abs(blue.state.players[1].mass - (0.65 + 0.10 * 100 * 100 / 10240)) < 1e-6);
  red.socket.close();
  await once(red.socket, "close");
  const resumed = connect("room=integration-test&resume=" + red.state.token);
  await waitUntil(() => resumed.state?.side === 1);
  assert.equal(resumed.state.players[1].mass, red.state.players[1].mass);
  assert.ok(resumed.shapes.some((message) => message.side === 1 && message.mask === mask));
  blue.socket.close();
  await once(blue.socket, "close");
  resumed.socket.close();
  await once(resumed.socket, "close");
  const fresh = connect("room=fresh-test");
  await waitUntil(() => fresh.state);
  assert.equal(fresh.state.side, 0);
  assert.equal(fresh.state.phase, "planning");
  assert.deepEqual(fresh.state.locked, [false, false]);
  assert.deepEqual(fresh.state.players.map((player) => player.position), initialPositions);
  assert.ok(fresh.state.players.every((player) => player.health === 100 && player.mass > 1 && player.inertia > 0));
  fresh.socket.close();
  await once(fresh.socket, "close");

  const pairedA = connect("quick=1"), pairedB = connect("quick=1");
  await waitUntil(() => pairedA.state && pairedB.state);
  assert.equal(pairedA.state.room, pairedB.state.room);
  assert.equal(pairedB.state.side, 1);
  pairedA.socket.close(); pairedB.socket.close();
  await Promise.all([once(pairedA.socket, "close"), once(pairedB.socket, "close")]);

  const solo = connect("quick=1");
  await waitUntil(() => solo.state?.bot, 12000);
  assert.equal(solo.state.side, 0);
  // Quick Match chooses an evasive path without waiting for a second browser.
  const tiny = Array.from({ length: 10240 }, (_, i) => {
    const x = i % 128, y = Math.floor(i / 128);
    return x >= 44 && x < 84 && y >= 38 && y < 43 ? "1" : "0";
  }).join("");
  solo.socket.send(JSON.stringify({ type: "shape", mask: tiny }));
  await waitUntil(() => solo.state.players[0].mass < 1);
  solo.socket.send(JSON.stringify({ type: "lock", expression: "0" }));
  await waitUntil(() => solo.state?.phase === "finished" ||
    (solo.state?.phase === "planning" && solo.state.round === 2), 20000);
  assert.ok(Math.abs(solo.state.players[1].position.y) > 1, "bot should sidestep the straight path");
});
