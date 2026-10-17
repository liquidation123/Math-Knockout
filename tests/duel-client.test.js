import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { buildPreview } from "../src/equations.js";
import { createDuel, travelPath } from "../src/duel.js";
import { insideArena } from "../src/physics.js";

// Run the real client with a fake DOM/socket, without needing WebGL in Node.
const source = (await readFile(new URL("../src/duel-client.js", import.meta.url), "utf8"))
  .replace(/^import .+;\n/gm, "");
function setup() {
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: id === "#retry", disabled: true, textContent: "", value: "0",
      addEventListener(name, handler) { this[name] = handler; },
    });
    return nodes.get(id);
  };
  let resolveMountain, rejectMountain, socket;
  const ready = new Promise((resolve, reject) => { resolveMountain = resolve; rejectMountain = reject; });
  const errors = [], windowEvents = {};
  const view = {
    ready, setViewMode() {}, removeCurve() {}, drawCurve() {}, setPlayerShape() {},
    drawPlayers() {}, updateCharacterCamera() {}, render() {},
  };
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    handlers = {};
    sent = [];
    constructor() { socket = this; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    emit(name, event = {}) { this.handlers[name]?.(event); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.emit("close"); }
  }
  runInNewContext(source, {
    URL, location: { href: "http://localhost/bump.html?room=test-room", protocol: "http:", host: "localhost" },
    document: { querySelector: element }, window: { addEventListener(name, handler) { windowEvents[name] = handler; } },
    createView: () => view, WebSocket: FakeSocket, readSavedMask: async () => null,
    buildPreview, travelPath, insideArena, requestAnimationFrame() {},
    console: { error: (...args) => errors.push(args) },
  });
  const message = (data) => socket.emit("message", { data: JSON.stringify(data) });
  const state = (side = 0) => message({ type: "state", side, ...createDuel() });
  return { element, resolveMountain, rejectMountain, socket, message, state, errors, windowEvents };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Bump loading waits for both the mountain and a server-assigned side, in either order", async () => {
  for (const mountainFirst of [true, false]) {
    const ui = setup();
    if (mountainFirst) ui.resolveMountain(); else ui.state(1);
    await flush();
    assert.equal(ui.element("#loading").hidden, false);
    assert.equal(ui.element("#lock").disabled, true);
    if (mountainFirst) ui.state(1); else ui.resolveMountain();
    await flush();
    assert.equal(ui.element("#loading").hidden, true);
    assert.equal(ui.element("#lock").disabled, false);
    assert.match(ui.element("#side").textContent, /You are Red/);
    ui.element("#reset").click();
    assert.deepEqual(ui.socket.sent, [{ type: "reset" }]);
    ui.state(1);
    assert.equal(ui.element("#loading").hidden, true);
    assert.equal(ui.errors.length, 0);
  }
});

test("a failed WebSocket handshake shows restart instructions and Retry, not an assigned side", async () => {
  const ui = setup();
  ui.resolveMountain();
  await flush();
  ui.socket.emit("error", new Error("Unexpected HTTP 200"));
  assert.equal(ui.element("#loading").hidden, false);
  assert.equal(ui.element("#retry").hidden, false);
  assert.match(ui.element("#loading-message").textContent, /old server.*npm start/);
  assert.equal(ui.element("#side").textContent, "Connection unavailable");
  for (const id of ["#equation", "#lock", "#reset", "#view"]) assert.equal(ui.element(id).disabled, true);
  ui.element("#reset").click();
  ui.element("#form").submit({ preventDefault() {} });
  assert.equal(ui.socket.sent.length, 0);
  ui.state(); // A late message must not re-enable a failed initialization.
  assert.equal(ui.element("#loading").hidden, false);
  assert.equal(ui.errors.length, 1, "error + close should log only once");
});

test("room rejection and disconnect after assignment both show a useful retry error", async () => {
  for (const assigned of [true, false]) {
    const ui = setup();
    ui.resolveMountain();
    if (assigned) ui.state();
    await flush();
    ui.socket.emit("close", { reason: assigned ? "" : "This room already has two players." });
    assert.equal(ui.element("#retry").hidden, false);
    assert.match(ui.element("#loading-message").textContent, assigned ? /Cannot reach/ : /two players/);
    assert.equal(ui.element("#loading").hidden, false);
  }
});

test("mountain failure and malformed initial messages fail safely with Retry", async () => {
  for (const problem of ["mountain", "json", "side", "null"]) {
    const ui = setup();
    if (problem === "mountain") ui.rejectMountain(new Error("404"));
    if (problem === "json") ui.socket.emit("message", { data: "not JSON" });
    if (problem === "side") ui.state(99);
    if (problem === "null") ui.message(null);
    await flush();
    assert.equal(ui.element("#loading").hidden, false);
    assert.equal(ui.element("#retry").hidden, false);
    assert.equal(ui.element("#lock").disabled, true);
    assert.equal(ui.errors.length, 1);
  }
});

test("leaving Bump Duel closes the socket without showing a spurious startup failure", () => {
  const ui = setup();
  ui.windowEvents.pagehide();
  assert.equal(ui.socket.readyState, 3);
  assert.equal(ui.errors.length, 0);
});
