import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { buildPreview } from "../src/equations.js";
import { forwardDirection } from "../src/aiming.js";
import { DUEL_NAMES, chooseBotEquation, createDuel, duelTarget, insideDuel, interceptSlope, launchDuel, lockEquation, resignDuel, safeTravelPath, setDuelBody, updateDuel } from "../src/duel.js";
import { takeFixedSteps } from "../src/physics.js";
import { duelSocketUrl } from "../src/duel-connection.js";
import { chooseBumpAction, publicBumpState } from "../src/ai.js";
import { equationText } from "../src/ai-types.js";

// Run the real client with a fake DOM/socket, without needing WebGL in Node.
const source = (await readFile(new URL("../src/duel-client.js", import.meta.url), "utf8"))
  .replace(/^import .+;\n/gm, "");
function setup({ pageUrl = "http://localhost/bump.html?room=test-room", serverUrl = "", chooseAI = chooseBumpAction } = {}) {
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: id === "#retry", disabled: true, textContent: "", value: id === "#bump-force" ? "1" : "0", style: {},
      addEventListener(name, handler) { this[name] = handler; },
    });
    return nodes.get(id);
  };
  let resolveMountain, rejectMountain, socket;
  const ready = new Promise((resolve, reject) => { resolveMountain = resolve; rejectMountain = reject; });
  const errors = [], windowEvents = {}, frames = [], analytics = [], copied = [];
  let generation = 0;
  const difficulty = new URL(pageUrl).searchParams.get("opponent") || "human";
  const opponent = { isAI: difficulty !== "human", difficulty, type: "polar",
    token: () => generation, current: (token) => token === generation,
    cancel() { generation++; }, wait: async () => true, choosing() {}, speak: async () => true };
  let now = 0;
  class FakeDate extends Date { static now() { return now; } }
  const sessionStorage = { getItem: () => null, setItem() {} };
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
  const api = runInNewContext(source + "\n;({ getDuel: () => duel, getState: () => state });", {
    URL, location: new URL(pageUrl), navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    setTimeout: () => 0,
    document: { querySelector: element, querySelectorAll: () => [] }, window: {
      addEventListener(name, handler) { windowEvents[name] = handler; },
      confirm: () => true,
      posthog: { capture: (name, properties) => analytics.push({ name, properties }) },
    },
    createView: () => view, WebSocket: FakeSocket, readSavedMask: async () => null,
    createOpponentUI: () => opponent, chooseBumpAction: chooseAI, publicBumpState, equationText,
    buildPreview, forwardDirection, safeTravelPath, insideDuel, interceptSlope, sessionStorage,
    DUEL_NAMES, chooseBotEquation, createDuel, duelTarget, launchDuel, lockEquation, resignDuel, setDuelBody, updateDuel, takeFixedSteps,
    Date: FakeDate, duelSocketUrl: (url) => duelSocketUrl(url, serverUrl), requestAnimationFrame(fn) { frames.push(fn); },
    console: { error: (...args) => errors.push(args) },
  });
  const message = (data) => socket.emit("message", { data: JSON.stringify(data) });
  const state = (side = 0) => message({ type: "state", side, ...createDuel() });
  return { ...api, element, resolveMountain, rejectMountain, socket, message, state, errors, windowEvents, analytics, copied,
    setNow: (time) => { now = time; }, frame: () => {
      const index = frames.findIndex((fn) => fn.name === "frame");
      if (index >= 0) frames.splice(index, 1)[0]();
    } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("selected Bump AI starts locally at every difficulty, commits independently and uses normal countdown", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const ui = setup({ pageUrl: "https://static.example/bump.html?opponent=" + difficulty });
    ui.resolveMountain(); await flush();
    assert.equal(ui.socket, undefined, "Selected AI must not need a multiplayer server");
    assert.equal(ui.element("#loading").hidden, true);
    ui.frame(); await flush();
    assert.equal(ui.getDuel().locked[1], true);
    assert.equal(ui.getDuel().locked[0], false, "AI commits before learning the human choice");
    assert.equal(ui.getDuel().phase, "planning");
    ui.element("#form").submit({ preventDefault() {} });
    ui.frame();
    assert.equal(ui.getDuel().phase, "countdown");
    ui.setNow(3001); ui.frame();
    assert.equal(ui.getDuel().phase, "running");
    assert.equal(ui.errors.length, 0);
  }
});

test("restarting or leaving during a Bump decision prevents the old AI action", async () => {
  for (const action of ["restart", "leave"]) {
    let finish, decisions = 0;
    const ui = setup({ pageUrl: "https://static.example/bump.html?opponent=hard",
      chooseAI: () => { decisions++; return new Promise((resolve) => { finish = resolve; }); } });
    ui.resolveMountain(); await flush();
    ui.frame(); await flush();
    ui.frame(); await flush();
    assert.equal(decisions, 1, "Only one decision may be pending");
    if (action === "restart") { ui.element("#reset").click(); await flush(); }
    else ui.windowEvents.pagehide();
    finish("0"); await flush();
    assert.equal(ui.getDuel().locked[1], false);
    assert.equal(ui.errors.length, 0);
  }
});

test("Render, custom domains and LAN hosts use their own multiplayer server without extra configuration", async () => {
  for (const origin of ["https://math-knockout-2.onrender.com", "https://game.example.com", "http://192.168.1.20:5173"]) {
    const ui = setup({ pageUrl: origin + "/bump.html?room=online-test&players=4" });
    assert.equal(ui.socket.url, origin.replace(/^http/, "ws") + "/?room=online-test&players=4");
    assert.equal(ui.errors.length, 0);
    const duel = createDuel(4); duel.phase = "lobby";
    ui.message({ type: "state", side: 0, host: 0, connected: [true, true, false, false], ...duel });
    ui.resolveMountain(); await flush();
    assert.equal(ui.element("#loading").hidden, true);
    assert.equal(ui.element("#start").disabled, false);
  }
});

test("hosted Quick Match tries online first and does not replace a connected match with a local bot", async () => {
  const ui = setup({ pageUrl: "https://math-knockout-2.onrender.com/bump.html?quick=1" });
  assert.equal(ui.socket.url, "wss://math-knockout-2.onrender.com/?quick=1");
  ui.resolveMountain(); ui.state(); await flush();
  ui.setNow(10001); ui.frame(); await flush();
  assert.equal(ui.socket.readyState, 1);
  assert.equal(ui.element("#loading").hidden, true);
  assert.notEqual(ui.element("#invite").hidden, true);
  assert.equal(ui.errors.length, 0);
});

test("an unavailable same-origin invite server fails clearly rather than silently becoming a solo match", () => {
  const ui = setup({ pageUrl: "https://game.example.com/bump.html?room=online-test&players=4" });
  ui.socket.emit("error", new Error("Connection refused"));
  assert.equal(ui.element("#retry").hidden, false);
  assert.match(ui.element("#loading-message").textContent, /server is running.*BUMP_SERVER_URL/);
  assert.equal(ui.element("#start").disabled, true);
  assert.equal(ui.element("#lock").disabled, true);
});

test("group lobby supports Green and Gold, host start, spectator controls and the same invite URL", async () => {
  const url = "http://localhost/bump.html?room=group-test&players=4";
  const ui = setup({ pageUrl: url });
  ui.resolveMountain(); await flush();
  const duel = createDuel(4);
  duel.phase = "lobby";
  const publish = (side = 0) => ui.message({ type: "state", side, host: 0, connected: [true, true, true, true], ...duel });
  publish();
  assert.equal(ui.element("#start").hidden, false);
  assert.equal(ui.element("#start").disabled, false);
  assert.equal(ui.element("#lock").disabled, true);
  assert.match(ui.element("#roster").textContent, /Green: joined.*Gold: joined/);
  await ui.element("#invite").click();
  assert.deepEqual(ui.copied, [url]);
  ui.element("#start").click();
  assert.deepEqual(ui.socket.sent.at(-1), { type: "start" });
  publish(2);
  assert.match(ui.element("#side").textContent, /Green/);
  assert.equal(ui.element("#start").hidden, true);
  duel.phase = "planning";
  publish(3);
  assert.match(ui.element("#side").textContent, /Gold/);
  assert.equal(ui.element("#lock").disabled, false);
  assert.equal(ui.element("#reset").disabled, true);
  duel.players[3].eliminated = true; duel.locked[3] = true;
  publish(3);
  assert.equal(ui.element("#lock").disabled, true);
  assert.equal(ui.element("#resign").disabled, true);
  assert.match(ui.element("#side").textContent, /spectating/);
  assert.equal(ui.errors.length, 0);
});

test("an old two-player backend cannot silently downgrade a four-player invite", () => {
  const ui = setup({ pageUrl: "http://localhost/bump.html?room=old-group&players=4" });
  ui.state();
  assert.equal(ui.element("#retry").hidden, false);
  assert.match(ui.element("#loading-message").textContent, /updated game server.*Restart npm start/);
  assert.equal(ui.element("#start").disabled, true);
  assert.equal(ui.element("#lock").disabled, true);
});

test("Bump resignation sends one action and displays the server's result", async () => {
  const ui = setup();
  ui.resolveMountain();
  await flush();
  const duel = createDuel();
  ui.message({ type: "state", side: 1, ...duel });
  ui.element("#resign").click();
  assert.deepEqual(ui.socket.sent, [{ type: "resign" }]);
  resignDuel(duel, 1);
  ui.message({ type: "state", side: 1, ...duel });
  assert.equal(ui.element("#result-title").textContent, "You resigned");
  assert.match(ui.element("#result-detail").textContent, /Red resigned.*Blue wins/);
  assert.equal(ui.element("#resign").disabled, true);
});

test("Bump analytics records lock and completion once even when repeated states share mutable arrays", () => {
  const ui = setup();
  const duel = createDuel();
  const publish = () => ui.message({ type: "state", side: 0, bot: true, ...duel });
  publish();
  duel.locked[0] = true;
  publish();
  publish();
  duel.phase = "finished";
  duel.winner = "Blue";
  publish();
  publish();
  assert.deepEqual(ui.analytics.map((event) => event.name), ["bump_path_locked", "bump_duel_completed"]);
  assert.equal(ui.analytics[0].properties.opponent_type, "ai");
  assert.equal(ui.analytics[1].properties.outcome, "win");
});

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

test("static hosting starts a local dodge bot after ten seconds and launches with the real duel physics", async () => {
  const ui = setup({ pageUrl: "https://math-knockout.vercel.app/bump.html?quick=1" });
  await flush();
  ui.resolveMountain();
  await flush();
  assert.equal(ui.socket.url, "wss://math-knockout.vercel.app/?quick=1");
  assert.equal(ui.element("#loading").hidden, false);
  ui.socket.emit("error"); ui.socket.emit("close");
  ui.setNow(10001); ui.frame();
  await flush(); ui.frame();
  assert.equal(ui.socket.readyState, 3);
  assert.match(ui.element("#red").textContent, /Bot · ready/);
  ui.element("#form").submit({ preventDefault() {} });
  ui.frame();
  assert.equal(ui.element("#countdown").hidden, false);
  ui.setNow(13002); ui.frame();
  assert.equal(ui.element("#countdown").hidden, true);
  for (let time = 13102; time < 21302; time += 100) { ui.setNow(time); ui.frame(); }
  assert.match(ui.element("#stage").textContent, /Round [12]/);
  assert.equal(ui.errors.length, 0);
});

test("Bump force is labelled, sent with the locked equation, and disabled after locking", async () => {
  const ui = setup();
  ui.resolveMountain(); ui.state(); await flush();
  const force = ui.element("#bump-force");
  assert.equal(force.disabled, false);
  force.value = "1.8";
  force.input();
  assert.equal(ui.element("#bump-force-value").textContent, "1.8×");
  ui.element("#form").submit({ preventDefault() {} });
  assert.deepEqual(ui.socket.sent.at(-1), { type: "lock", expression: "0", force: 1.8 });
  const state = createDuel();
  state.locked[0] = true;
  ui.message({ type: "state", side: 0, ...state });
  assert.equal(force.disabled, true);
});

test("solo Bump force refreshes its landing preview without a multiplayer server", async () => {
  const ui = setup({ pageUrl: "https://math-knockout.vercel.app/bump.html?quick=1" });
  ui.resolveMountain(); await flush();
  ui.socket.emit("error"); ui.socket.emit("close");
  ui.setNow(10001); ui.frame(); await flush();
  const force = ui.element("#bump-force");
  force.value = ".5"; force.input();
  const lowForceLanding = ui.element("#location").textContent;
  force.value = "2"; force.input();
  assert.notEqual(ui.element("#location").textContent, lowForceLanding);
  ui.element("#form").submit({ preventDefault() {} });
  assert.equal(force.disabled, true);
  assert.equal(ui.socket.readyState, 3);
  assert.equal(ui.errors.length, 0);
});

test("Quick Match falls back to the browser bot when a configured backend never assigns a side", async () => {
  const ui = setup({ pageUrl: "https://math-knockout.vercel.app/bump.html?quick=1",
    serverUrl: "https://duel.example.com" });
  ui.resolveMountain();
  await flush();
  ui.socket.emit("error");
  ui.socket.emit("close");
  assert.equal(ui.element("#retry").hidden, true);
  ui.setNow(10001); ui.frame();
  await flush();
  ui.frame();
  assert.match(ui.element("#red").textContent, /Bot · ready/);
  assert.equal(ui.element("#loading").hidden, true);
  assert.equal(ui.element("#invite").hidden, true);
  assert.equal(ui.errors.length, 0);
});
