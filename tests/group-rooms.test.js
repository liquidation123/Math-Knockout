import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(check, timeout = 7000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await delay(20); }
  throw new Error("Group room did not reach the expected state.");
}
async function server(t) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../", import.meta.url), env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.socket.terminate());
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
  });
  await waitUntil(() => /Out-Mathed: http:\/\/[^\s]+/.test(output));
  const address = output.match(/Out-Mathed: (http:\/\/[^\s]+)/)[1].replace("http:", "ws:");
  return (room, resume = "") => {
    const socket = new WebSocket(`${address}/?room=${room}&players=4${resume ? "&resume=" + resume : ""}`);
    const client = { socket, state: null, errors: [], shapes: [] };
    clients.push(client);
    socket.on("message", (data) => {
      const message = JSON.parse(data);
      if (message.type === "state") client.state = message;
      if (message.type === "error") client.errors.push(message.error);
      if (message.type === "shape") client.shapes.push(message);
    });
    client.send = (message) => socket.send(JSON.stringify(message));
    return client;
  };
}

test("one invite supports four humans, host start, hidden choices, elimination, and restart", { timeout: 20000 }, async (t) => {
  const connect = await server(t);
  const blue = connect("four-human-test");
  await waitUntil(() => blue.state);
  assert.equal(blue.state.phase, "lobby");
  blue.send({ type: "start" });
  await waitUntil(() => blue.errors.length);
  assert.match(blue.errors[0], /Invite/);
  const red = connect("four-human-test"), green = connect("four-human-test"), gold = connect("four-human-test");
  const players = [blue, red, green, gold];
  await waitUntil(() => players.every((p) => p.state?.connected.every(Boolean)));
  assert.deepEqual(players.map((p) => p.state.side), [0, 1, 2, 3]);
  const fifth = connect("four-human-test");
  const [code, reason] = await once(fifth.socket, "close");
  assert.equal(code, 1008); assert.match(String(reason), /full/);
  assert.equal(fifth.state, null);
  green.send({ type: "start" });
  await delay(100);
  assert.equal(blue.state.phase, "lobby", "only the host starts the match");
  blue.send({ type: "start" });
  await waitUntil(() => players.every((p) => p.state.phase === "planning"));
  green.send({ type: "lock", side: 0, expression: "sin(x)", force: 1.4 });
  await waitUntil(() => blue.state.locked[2]);
  assert.equal(blue.state.locked[0], false, "socket identity, not the supplied side, owns a choice");
  assert.equal(blue.state.paths, undefined);
  assert.equal(blue.state.expression, undefined);
  for (const player of [blue, red, gold]) player.send({ type: "lock", expression: "0", force: .5 });
  await waitUntil(() => players.every((p) => p.state.phase === "countdown"));
  assert.ok(players.every((p) => p.state.startAt === blue.state.startAt));
  await waitUntil(() => players.every((p) => p.state.phase === "running"));
  green.send({ type: "resign", side: 0 });
  await waitUntil(() => blue.state.players[2].eliminated);
  assert.notEqual(blue.state.phase, "finished");
  red.send({ type: "resign" }); gold.send({ type: "resign" });
  await waitUntil(() => players.every((p) => p.state.phase === "finished"));
  assert.equal(blue.state.winner, "Blue");
  green.send({ type: "reset" }); await delay(100);
  assert.equal(blue.state.phase, "finished");
  blue.send({ type: "reset" });
  await waitUntil(() => players.every((p) => p.state.phase === "lobby"));
  assert.ok(blue.state.players.every((p) => !p.eliminated));
  assert.equal(blue.state.radius, 8.25);
});

test("group hosts may start with two or three players; late joins wait for a new match", async (t) => {
  const connect = await server(t);
  for (const count of [2, 3]) {
    const players = Array.from({ length: count }, () => connect("small-group-" + count));
    await waitUntil(() => players.every((p) => p.state));
    players[0].send({ type: "start" });
    await waitUntil(() => players.every((p) => p.state.phase === "planning"));
    assert.equal(players[0].state.players.filter((p) => !p.eliminated).length, count);
    const late = connect("small-group-" + count);
    const [code, reason] = await once(late.socket, "close");
    assert.equal(code, 1008); assert.match(String(reason), /started/);
    players.forEach((p) => p.send({ type: "lock", expression: "0" }));
    await waitUntil(() => players.every((p) => p.state.phase === "countdown"));
  }
});

test("group reconnect preserves the same slot and drawing; expired disconnects eliminate only that player", { timeout: 25000 }, async (t) => {
  const connect = await server(t);
  const players = Array.from({ length: 3 }, () => connect("rejoin-group"));
  await waitUntil(() => players.every((p) => p.state));
  const mask = "1".repeat(100) + "0".repeat(10140);
  players[2].send({ type: "shape", mask });
  await waitUntil(() => players[0].shapes.some((s) => s.side === 2 && s.mask === mask));
  const token = players[2].state.token;
  players[2].socket.close(); await once(players[2].socket, "close");
  const resumed = connect("rejoin-group", token);
  await waitUntil(() => resumed.state);
  assert.equal(resumed.state.side, 2);
  assert.ok(resumed.shapes.some((s) => s.side === 2 && s.mask === mask));
  players[0].send({ type: "start" });
  await waitUntil(() => players[0].state.phase === "planning");
  resumed.socket.close(); await once(resumed.socket, "close");
  await waitUntil(() => players[0].state.players[2].eliminated, 17500);
  assert.equal(players[0].state.phase, "planning");
  assert.ok(!players[0].state.players[0].eliminated && !players[0].state.players[1].eliminated);
  for (const player of players.slice(0, 2)) player.send({ type: "lock", expression: "0" });
  await waitUntil(() => players[0].state.phase === "countdown");
});
