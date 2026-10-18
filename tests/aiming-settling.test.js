import test from "node:test";
import assert from "node:assert/strict";
import { forwardDirection, shotDirection, shotTarget } from "../src/aiming.js";
import { buildPreview } from "../src/equations.js";
import { createCurveModel, previewCurveModel } from "../src/curves.js";
import { createRound, firePreview, updateRound } from "../src/combat.js";
import { createDuel, duelObstacles, lockEquation, launchDuel, updateDuel } from "../src/duel.js";
import { FIXED_STEP, playersAreStill } from "../src/physics.js";
import { projectileCandidates, scoreProjectileAction } from "../src/ai.js";

test("both teams reverse toward the existing target after passing it, with stable vertical ties", () => {
  const round = createRound();
  round.players.forEach((p, i) => { p.position = { x: i < 3 ? 5 : -5, y: i % 3, z: .5 }; });
  assert.equal(shotDirection(round.players, 1), -1);
  assert.equal(shotDirection(round.players, 4), 1);
  assert.equal(shotTarget(round.players, 1), round.players[4]);
  round.players[4].eliminated = true;
  assert.equal(shotTarget(round.players, 1), round.players[3]);
  for (const dx of [0, -.001, .001]) {
    for (const y of [-8, 0, 8]) {
      assert.equal(forwardDirection({ x: 0, y: 0 }, { x: dx, y }, -1), -1);
    }
  }
});

test("reversed explicit previews remain anchored, frozen and on their original continuous branch", () => {
  const round = createRound();
  round.players.forEach((p, i) => { p.position = { x: i < 3 ? 5 : -5, y: 0, z: .5 }; });
  for (const expression of ["0", "x+6", "(x-1)^2", "sin(x)", "1/(x+2)", "1/x", "floor(x)"]) {
    const preview = buildPreview(expression, round.players[1].position, shotDirection(round.players, 1));
    assert.equal(preview.error, "");
    assert.ok(preview.path.every((p) => p.x <= 5));
    assert.deepEqual(preview.path[0], round.players[1].position);
    assert.equal(firePreview(round, 1, preview), true);
    assert.deepEqual(round.attack.path, preview.path);
    const frozen = structuredClone(round.attack.path);
    round.players[1].position.x += .01;
    assert.deepEqual(round.attack.path, frozen);
    round.attack = null;
    round.players[1].position.x = 5;
  }
  const rational = buildPreview("1/(x+2)", { x: 5, y: 0 }, -1);
  assert.ok(rational.path.every((p) => p.x > 3));
});

test("parameter bounds and polar traversal are unchanged by team direction", () => {
  for (const request of [
    { type: "parametric", x: "3cos(t)", y: "3sin(t)", start: "0", end: "2pi" },
    { type: "polar", radius: "2(1+cos(theta))", start: "0", end: "2pi" },
  ]) {
    const model = createCurveModel(request);
    assert.deepEqual(previewCurveModel(model, { x: 2, y: 1 }, -1).path,
      previewCurveModel(model, { x: 2, y: 1 }, 1).path);
  }
});

test("crossed shots knock enemies away and recoil opposite travel; AI simulates the same direction", () => {
  const round = createRound();
  round.players.forEach((p, i) => {
    p.eliminated = ![1, 4].includes(i);
    p.position = { x: i < 3 ? 5 : -5, y: 0, z: .5 };
  });
  const preview = buildPreview("0", round.players[1].position, shotDirection(round.players, 1));
  firePreview(round, 1, preview, .5);
  assert.ok(round.players[1].velocity.x > 0);
  for (let i = 0; i < 120; i++) updateRound(round, FIXED_STEP);
  assert.equal(round.players[4].health, 80);
  assert.ok(round.players[4].velocity.x < 0);
  round.attack = null;
  round.currentTeam = 1;
  const action = projectileCandidates(round).find((a) => a.force === .5);
  assert.equal(action.targetIndex, 1);
  assert.ok(scoreProjectileAction(round, action) > 0);
});

test("Bump previews and locked paths reverse after a swap; quiet rounds finish without eight seconds", () => {
  const duel = createDuel();
  duel.players.forEach((p) => { p.position.x *= -1; });
  lockEquation(duel, 0, "0"); lockEquation(duel, 1, "0");
  assert.ok(duel.paths[0].points[1].x < duel.players[0].position.x);
  assert.ok(duel.paths[1].points[1].x > duel.players[1].position.x);
  launchDuel(duel);
  duel.paths.forEach((path) => { path.done = true; });
  for (let i = 0; i < 24; i++) updateDuel(duel, FIXED_STEP);
  assert.equal(duel.phase, "planning");
  assert.ok(duel.elapsed < .25);
});

test("settling waits for actual motion and falls, then advances quickly", () => {
  const round = createRound();
  round.players.forEach((p, i) => { p.position = { x: i < 3 ? -6 : 6, y: 0, z: .5 }; });
  firePreview(round, 1, buildPreview("0", round.players[1].position));
  round.attack.stopped = true;
  round.attack.stoppedAt = 0;
  round.players[1].velocity.x = 1;
  assert.equal(playersAreStill(round.players), false);
  for (let i = 0; i < 12; i++) updateRound(round, FIXED_STEP);
  assert.ok(round.attack);
  round.players[1].position.z = .3;
  assert.equal(playersAreStill(round.players), false);
  round.players[1].position.z = .5;
  round.players[1].velocity.x = 0;
  for (let i = 0; i < 24; i++) updateRound(round, FIXED_STEP);
  assert.equal(round.attack, null);
  assert.equal(round.currentTeam, 1);
  assert.ok(round.time < .7);
});

test("erosion removes unsupported walls and waits for simultaneous falls before naming a winner", () => {
  assert.equal(duelObstacles(2, 8.25).length, 0);
  assert.equal(duelObstacles(3, 6.85).length, 2);
  assert.equal(duelObstacles(9, 2.8).length, 0);
  const duel = createDuel();
  lockEquation(duel, 0, "0"); lockEquation(duel, 1, "0"); launchDuel(duel);
  duel.paths.forEach((path) => { path.done = true; });
  duel.players[0].eliminated = true;
  duel.players[1].position = { x: 10, y: 0, z: -4.9 };
  updateDuel(duel, FIXED_STEP);
  assert.equal(duel.phase, "running");
  for (let i = 0; i < 120 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  assert.equal(duel.phase, "finished");
  assert.equal(duel.winner, "Draw");
});
