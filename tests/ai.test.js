import test from "node:test";
import assert from "node:assert/strict";
import { createRound, firePreview, selectCharacter } from "../src/combat.js";
import { createDuel, lockEquation, setShapePhysics, launchDuel, updateDuel } from "../src/duel.js";
import { FIXED_STEP } from "../src/physics.js";
import { buildPreview } from "../src/equations.js";
import { chooseProjectileAction, scoreProjectileAction, chooseBumpAction,
  publicBumpState, scoreBumpAction, AI_LEVELS } from "../src/ai.js";
import { createAimGeometry } from "../src/scene.js";

const options = { random: () => 0.5, pause: async () => {} };
function arena() {
  const round = createRound(false, () => 0.5);
  round.currentTeam = 1;
  round.players.forEach((player, index) => {
    player.position = { x: index < 3 ? -9 : 9, y: (index % 3 - 1) * 2, z: 0.5 };
  });
  return round;
}

test("every projectile difficulty chooses a valid unchanged-rules Red action, within its budget", async () => {
  for (const difficulty of Object.keys(AI_LEVELS)) {
    const round = arena(), before = structuredClone(round);
    let yields = 0;
    const action = await chooseProjectileAction(round, difficulty, { ...options, pause: async () => { yields += 1; } });
    assert.ok(action);
    assert.equal(round.players[action.playerIndex].team, 1);
    assert.ok(action.force >= 0.5 && action.force <= 3);
    assert.ok(Math.abs(action.force * 10 - Math.round(action.force * 10)) < 1e-9, "AI force must use the human slider's 0.1 steps.");
    assert.ok(yields <= AI_LEVELS[difficulty].projectileLimit && yields > 0);
    assert.deepEqual(round, before, "Search must not change real health, mass, velocities or turn state.");
    const preview = buildPreview(action.expression, round.players[action.playerIndex].position, -1);
    assert.equal(preview.error, "");
    assert.equal(selectCharacter(round, action.playerIndex), true);
    assert.equal(firePreview(round, action.playerIndex, preview, action.force), true);
    assert.equal(round.attack.force, action.force);
    assert.deepEqual(round.attack.path, preview.path);
    assert.equal(firePreview(round, action.playerIndex, preview, action.force), false, "A second action cannot fire during the first.");
  }
});

test("AI can use each of the three surviving Red characters, never eliminated or airborne ones", async () => {
  for (const survivor of [3, 4, 5]) {
    const round = arena();
    round.players.forEach((player, index) => { if (player.team === 1) player.eliminated = index !== survivor; });
    const action = await chooseProjectileAction(round, "easy", options);
    assert.equal(action.playerIndex, survivor);
    round.players[survivor].position.z = -3;
    assert.equal(await chooseProjectileAction(round, "hard", options), null);
  }
});

test("cancelling search stops at a yield and cannot produce a late action", async () => {
  let cancelled = false, yields = 0;
  assert.equal(await chooseProjectileAction(arena(), "hard", {
    cancelled: () => cancelled, pause: async () => { cancelled = true; yields += 1; },
  }), null);
  assert.equal(yields, 1);
  assert.equal(await chooseBumpAction(publicBumpState(createDuel()), "hard", { cancelled: () => true }), null);
});

test("reproducible recoil-edge scenario distinguishes Easy, Medium and Hard without bonuses", async () => {
  const round = arena();
  round.players.forEach((player, index) => {
    player.eliminated = ![0, 3].includes(index);
    player.position = { x: index === 0 ? -10 : 13.75, y: 0, z: 0.5 };
  });
  const scores = [];
  for (const difficulty of Object.keys(AI_LEVELS)) {
    const action = await chooseProjectileAction(round, difficulty, options);
    scores.push(scoreProjectileAction(round, action, "hard"));
    if (difficulty === "hard") assert.equal(action.force, 0.5, "Low recoil is safer at this edge.");
  }
  assert.ok(scores[0] < scores[1] && scores[1] < scores[2], JSON.stringify(scores));
});

test("all Bump levels choose legal independent actions; mass and health are untouched by search", async () => {
  for (const difficulty of Object.keys(AI_LEVELS)) {
    const duel = createDuel();
    const before = structuredClone(duel);
    const expression = await chooseBumpAction(publicBumpState(duel), difficulty, options);
    assert.equal(lockEquation(duel, 1, expression), "");
    assert.equal(duel.locked[0], false, "Red commits without waiting for Blue.");
    assert.deepEqual(duel.players, before.players);
    assert.equal(duel.phase, "planning");
  }
});

test("hidden Bump equations/locks cannot affect AI input or choice", async () => {
  const duel = createDuel();
  const guarded = new Proxy(duel, { get(target, key) {
    if (key !== "players") throw new Error("Hidden state read: " + String(key));
    return target.players;
  } });
  const publicState = publicBumpState(guarded);
  assert.deepEqual(Object.keys(publicState), ["players"]);
  const first = await chooseBumpAction(publicState, "hard", options);
  lockEquation(duel, 0, "2*sin(x/3)");
  const second = await chooseBumpAction(publicBumpState(guarded), "hard", options);
  assert.equal(first, second);
  assert.equal(duel.paths[0].expression, "2*sin(x/3)");
});

test("open Bump scenario rewards a stronger collision, while Medium and Hard may tie", async () => {
  const duel = createDuel();
  duel.players[0].position = { x: -8, y: 4, z: 0.5 };
  duel.players[1].position = { x: 8, y: 4, z: 0.5 };
  const publicState = publicBumpState(duel), scores = [];
  for (const difficulty of Object.keys(AI_LEVELS)) {
    const expression = await chooseBumpAction(publicState, difficulty, options);
    scores.push(scoreBumpAction(publicState, expression, "0"));
  }
  assert.ok(scores[0] < scores[1] && scores[1] <= scores[2], JSON.stringify(scores));
});

test("all Bump AI levels seek contact instead of the formerly preferred passive route", async () => {
  function fight(expression, crossed = false) {
    const duel = createDuel();
    if (crossed) { duel.players[0].position.x = 5; duel.players[1].position.x = -5; }
    lockEquation(duel, 0, "0"); lockEquation(duel, 1, expression); launchDuel(duel);
    for (let tick = 0; tick < 1000 && duel.phase === "running"; tick += 1) updateDuel(duel, FIXED_STEP);
    return duel;
  }
  assert.equal(fight("0.2*x").contacts, 0, "Reproduce the old safe-but-passive miss.");
  for (const difficulty of Object.keys(AI_LEVELS)) for (const crossed of [false, true]) {
    const duel = createDuel();
    if (crossed) { duel.players[0].position.x = 5; duel.players[1].position.x = -5; }
    const publicState = publicBumpState(duel);
    const expression = await chooseBumpAction(publicState, difficulty, options);
    const result = fight(expression, crossed);
    assert.ok(result.contacts > 0, difficulty + (crossed ? " after crossing" : " at spawn"));
    assert.ok(result.players.every((player) => player.health === 100 && player.mass === 1));
    assert.ok(scoreBumpAction(publicState, expression, "0") > scoreBumpAction(publicState, "0.2*x", "0"));
  }
});

test("solo and online drawings share exactly the same mass/radius calculation", () => {
  const player = createDuel().players[0];
  setShapePhysics(player, "1".repeat(1024) + "0".repeat(9216));
  assert.equal(player.mass, 1.4);
  assert.ok(Math.abs(player.radius - (0.25 + 0.55 * Math.sqrt(0.5))) < 1e-12);
  assert.equal(player.health, 100);
});

test("noticeable preview ribbon stays centered on the original sampled segments", () => {
  const points = [{ x: 0, y: 0, z: 0.5 }, { x: 3, y: 4, z: 0.5 }];
  const geometry = createAimGeometry(points, 0.18);
  const vertices = geometry.getAttribute("position");
  assert.equal(vertices.count, 6);
  assert.ok(Math.abs((vertices.getX(0) + vertices.getX(1)) / 2) < 1e-7);
  assert.ok(Math.abs((vertices.getY(0) + vertices.getY(1)) / 2) < 1e-7);
  assert.ok(Math.abs(Math.hypot(vertices.getX(0) - vertices.getX(1), vertices.getY(0) - vertices.getY(1)) - 0.18) < 1e-7);
  geometry.dispose();
});
