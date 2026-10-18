import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { buildPreview } from "../src/equations.js";
import { shotDirection } from "../src/aiming.js";
import { createRound, updateRound, firePreview, resignRound, selectCharacter, setRoundTeamBody, TEAM_NAMES } from "../src/combat.js";
import { starterMask } from "../src/body.js";
import { takeFixedSteps } from "../src/physics.js";

const source = (await readFile(new URL("../src/main.js", import.meta.url), "utf8")).replace(/^import .+;\n/gm, "");
async function setup(chooseProjectileAction = async () => ({ playerIndex: 3, expression: "0", force: 1 }), savedMask = null) {
  const nodes = new Map(), windowEvents = {}, errors = [], spoken = [];
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { value: "1", hidden: false, textContent: "", checked: false,
      firstChild: { textContent: "" },
      addEventListener(name, fn) { this[name] = fn; }, insertBefore() {}, focus() {},
      dataset: {}, style: { setProperty() {} }, replaceChildren() {}, append() {}, setAttribute() {},
      querySelector() { return node("result-select"); } });
    return nodes.get(selector);
  };
  let generation = 0;
  const opponent = { difficulty: "ai", isAI: true, cancel: () => { generation += 1; },
    token: () => generation, current: (token) => token === generation, wait: async () => true,
    choosing() {}, speak: async (name, text) => { spoken.push({ name, text }); return true; } };
  const view = { ready: Promise.resolve(), resetCinematic() {}, finishProjectilePOV() {}, removeCurve() {}, drawCurve() {}, setPlayerShape() {}, onCharacterClick() {}, canvas: { focus() {} } };
  const api = runInNewContext(source + "\n;({ getRound: () => round, playAiTurn, resetRound });", {
    URLSearchParams, location: { search: "?opponent=ai" }, createOpponentUI: () => opponent,
    document: { querySelector: node, querySelectorAll: () => [], createElement: () => node("new-label") },
    window: { confirm: () => true, addEventListener(name, fn) { windowEvents[name] = fn; } },
    createView: () => view, createVictoryScreen: () => ({ hide() {}, show() {} }),
    createEquationInput: () => ({ key: () => "0", preview: (origin, direction) => buildPreview("0", origin, direction) }),
    readSavedMask: async () => savedMask, chooseProjectileAction, buildPreview, shotDirection,
    createRound, updateRound, firePreview, resignRound, selectCharacter, setRoundTeamBody, starterMask,
    TEAM_NAMES, takeFixedSteps, requestAnimationFrame() {},
    console: { info() {}, warn() {}, error: (...args) => errors.push(args) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const round = api.getRound();
  round.currentTeam = 1;
  round.players.forEach((player) => { player.position.z = 0.5; });
  return { ...api, nodes, errors, spoken, windowEvents };
}

test("the loaded drawing sets Projectile Duel mass and keeps it on restart", async () => {
  const mask = "1".repeat(2048) + "0".repeat(8192);
  const ui = await setup(undefined, mask);
  assert.ok(ui.getRound().players[0].mass > ui.getRound().players[3].mass);
  assert.ok(ui.getRound().players.slice(0, 3).every((player) => player.mass === ui.getRound().players[0].mass));
  const mass = ui.getRound().players[0].mass;
  ui.resetRound();
  assert.equal(ui.getRound().players[0].mass, mass);
});

test("Projectile AI uses the human fire action once, and never fires twice during flight", async () => {
  const ui = await setup();
  await ui.playAiTurn();
  assert.equal(ui.getRound().castCount, 1);
  assert.equal(ui.getRound().attack.attackerIndex, 3);
  assert.equal(ui.spoken.length, 1);
  await ui.playAiTurn();
  assert.equal(ui.getRound().castCount, 1);
  assert.equal(ui.errors.length, 0);
});

test("Projectile AI never acts on Blue's turn or after the round is finished", async () => {
  const ui = await setup();
  ui.getRound().currentTeam = 0;
  await ui.playAiTurn();
  ui.getRound().currentTeam = 1;
  ui.getRound().result = { winner: "Blue" };
  await ui.playAiTurn();
  assert.equal(ui.getRound().castCount, 0);
  assert.equal(ui.spoken.length, 0);
});

test("restart, leaving, resignation and elimination prevent a late projectile decision from firing", async () => {
  for (const change of ["restart", "leave", "resign", "eliminate"]) {
    let finish;
    const ui = await setup(() => new Promise((resolve) => { finish = resolve; }));
    const pending = ui.playAiTurn();
    await new Promise((resolve) => setImmediate(resolve));
    if (change === "restart") ui.resetRound();
    if (change === "leave") ui.windowEvents.pagehide();
    if (change === "resign") ui.nodes.get("#resign").click();
    if (change === "eliminate") ui.getRound().players[3].eliminated = true;
    finish({ playerIndex: 3, expression: "0", force: 1 });
    await pending;
    assert.equal(ui.getRound().castCount, 0, change);
    if (change === "resign") assert.equal(ui.getRound().result.reason, "Blue resigned");
    assert.equal(ui.errors.length, 0);
  }
});
