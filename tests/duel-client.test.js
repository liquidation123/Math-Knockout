import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { buildPreview } from "../src/equations.js";
import { createDuel, travelPath, lockEquation, launchDuel, updateDuel, inkFromMask, setShapePhysics } from "../src/duel.js";
import { insideArena, takeFixedSteps } from "../src/physics.js";
import { publicBumpState } from "../src/ai.js";
import { duelSocketUrl } from "../src/duel-connection.js";

// Run the real client with a fake DOM/socket, without needing WebGL in Node.
const source = (await readFile(new URL("../src/duel-client.js", import.meta.url), "utf8"))
  .replace(/^import .+;\n/gm, "");
function setup({ pageUrl = "http://localhost/bump.html?room=test-room", serverUrl = "", chooseBumpAction = async () => "0" } = {}) {
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: id === "#retry", disabled: true, textContent: "", value: "0", style: {},
      addEventListener(name, handler) { this[name] = handler; },
    });
    return nodes.get(id);
  };
  let resolveMountain, rejectMountain, socket;
  const ready = new Promise((resolve, reject) => { resolveMountain = resolve; rejectMountain = reject; });
  const errors = [], windowEvents = {};
  const frames = [], speeches = [];
  let generation = 0;
  const difficulty = new URL(pageUrl).searchParams.get("opponent") || "human";
  const opponent = { difficulty, isAI: difficulty !== "human", cancel: () => { generation += 1; },
    token: () => generation, current: (token) => token === generation, wait: async () => true,
    choosing() {}, speak: (name, text) => { speeches.push({ name, text }); return Promise.resolve(true); } };
  const view = {
    ready, setViewMode() {}, removeCurve() {}, drawCurve() {}, setPlayerShape() {},
    drawPlayers() {}, updateCharacterCamera() {}, render() {},
  };
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    handlers = {};
    sent = [];
    constructor(url) { socket = this; this.url = url; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    emit(name, event = {}) { this.handlers[name]?.(event); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.emit("close"); }
  }
  runInNewContext(source, {
    URL, location: new URL(pageUrl),
    document: { querySelector: element, querySelectorAll: () => [] }, window: { addEventListener(name, handler) { windowEvents[name] = handler; } },
    createView: () => view, WebSocket: FakeSocket, readSavedMask: async () => null,
    buildPreview, travelPath, insideArena, takeFixedSteps, createDuel, lockEquation, launchDuel, updateDuel, inkFromMask, setShapePhysics,
    createOpponentUI: () => opponent, publicBumpState, chooseBumpAction,
    duelSocketUrl: (url) => duelSocketUrl(url, serverUrl), requestAnimationFrame(fn) { if (fn.name === "frame") frames.push(fn); },
    console: { error: (...args) => errors.push(args), warn() {} },
  });
  const message = (data) => socket.emit("message", { data: JSON.stringify(data) });
  const state = (side = 0) => message({ type: "state", side, ...createDuel() });
  return { element, resolveMountain, rejectMountain, socket, message, state, errors, windowEvents, speeches,
    frame: (time = 0) => { const fn = frames.shift(); fn?.(time); } };
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

test("a deployed page connects to its configured backend and preserves the invite room", () => {
  const ui = setup({ pageUrl: "https://math-knockout.vercel.app/bump.html?room=77164621", serverUrl: "https://duel.example.com" });
  assert.equal(ui.socket.url, "wss://duel.example.com/?room=77164621");
  ui.socket.emit("error");
  assert.match(ui.element("#loading-message").textContent, /Online Bump Duel/);
  assert.doesNotMatch(ui.element("#loading-message").textContent, /npm start|old server/);
});

test("insecure deployment configuration fails with an error instead of crashing startup", () => {
  const ui = setup({ pageUrl: "https://math-knockout.vercel.app/bump.html?room=77164621", serverUrl: "ws://duel.example.com" });
  assert.equal(ui.socket, undefined);
  assert.equal(ui.element("#retry").hidden, false);
  assert.equal(ui.element("#lock").disabled, true);
  assert.match(ui.element("#loading-message").textContent, /Online Bump Duel/);
  assert.equal(ui.errors.length, 1);
});

test("solo Bump starts on a static site without constructing any WebSocket; Red commits before Blue", async () => {
  let decisions = 0;
  const ui = setup({ pageUrl: "https://static.example.com/bump.html?opponent=hard", chooseBumpAction: async (publicState) => {
    assert.deepEqual(Object.keys(publicState), ["players"]);
    decisions += 1;
    return "0";
  } });
  ui.resolveMountain();
  await flush();
  assert.equal(ui.socket, undefined);
  assert.equal(ui.element("#loading").hidden, true);
  assert.match(ui.element("#side").textContent, /You are Blue/);
  ui.frame();
  await flush();
  ui.frame(16);
  await flush();
  assert.equal(decisions, 1, "Already committed choices must not run twice.");
  assert.match(ui.element("#red").textContent, /ready/);
  assert.equal(ui.speeches.length, 0, "The committed equation is hidden until Blue locks.");
  ui.element("#form").submit({ preventDefault() {} });
  assert.equal(ui.element("#phase").textContent, "Launching together");
  assert.deepEqual(ui.speeches, [{ name: "Red", text: "y = 0" }]);
  ui.element("#reset").click();
  await flush();
  assert.equal(ui.element("#phase").textContent, "Choose a path");
  assert.equal(ui.errors.length, 0);
});

test("solo Bump restart and page exit invalidate a pending AI decision", async () => {
  for (const action of ["restart", "leave"]) {
    let finish;
    const ui = setup({ pageUrl: "https://static.example.com/bump.html?opponent=hard", chooseBumpAction: () => new Promise((resolve) => { finish = resolve; }) });
    ui.resolveMountain();
    await flush();
    ui.frame();
    await flush();
    if (action === "restart") ui.element("#reset").click();
    else ui.windowEvents.pagehide();
    finish("0");
    await flush();
    assert.equal(ui.speeches.length, 0);
    assert.doesNotMatch(ui.element("#red").textContent, /ready/);
    assert.equal(ui.errors.length, 0);
  }
});
