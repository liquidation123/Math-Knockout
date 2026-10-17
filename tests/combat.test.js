import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../src/equations.js";
import { ARENA, OBSTACLES, FIXED_STEP, takeFixedSteps } from "../src/physics.js";
import { createRound, updateRound, firePreview, selectCharacter, TURN_INTERVAL } from "../src/combat.js";

function groundedRound(automatic = false) {
  const round = createRound(automatic);
  round.players.forEach((player) => { player.position.z = 0.5; });
  return round;
}
function previewFor(round, expression = "0") {
  const player = round.players[round.selected[round.currentTeam]];
  return buildPreview(expression, player.position, player.team === 0 ? 1 : -1);
}

test("six independent characters spawn clear of obstacles and inside the wider map", () => {
  const round = createRound(false);
  assert.equal(round.players.length, 6);
  assert.deepEqual(round.selected, [1, 4]);
  for (const team of [0, 1]) assert.equal(round.players.filter((p) => p.team === team).length, 3);
  for (const player of round.players) {
    assert.equal(player.health, 100);
    assert.equal(player.eliminated, false);
    assert.ok(Math.abs(player.position.x) < ARENA.halfWidth);
    assert.ok(Math.abs(player.position.y) < ARENA.depth / 2);
    for (const box of OBSTACLES) {
      assert.ok(Math.abs(player.position.x - box.x) >= box.width / 2 + 0.5 ||
        Math.abs(player.position.y - box.y) >= box.depth / 2 + 0.5);
    }
  }
});

test("selection permits only a surviving character on the current team", () => {
  const round = groundedRound();
  assert.ok(selectCharacter(round, 0));
  assert.equal(round.selected[0], 0);
  assert.equal(selectCharacter(round, 3), false);
  round.players[2].health = 0;
  assert.equal(selectCharacter(round, 2), false);
  round.currentTeam = 1;
  assert.ok(selectCharacter(round, 5));
  assert.equal(round.selected[1], 5);
  assert.equal(selectCharacter(round, 1), false);
});

test("the selected character anchors preview and the fired snapshot for all example inputs", () => {
  for (const text of ["(x-1)^2 + 1", "e^x", "2sin(1/2 x) - 1"]) {
    const round = groundedRound();
    selectCharacter(round, 0);
    const preview = previewFor(round, text);
    assert.equal(preview.error, "");
    assert.ok(firePreview(round, 0, preview));
    assert.deepEqual(round.attack.path, preview.path);
    assert.notEqual(round.attack.path, preview.path);
    assert.equal(round.attack.equation.expression, text);
    assert.deepEqual([round.attack.origin.x, round.attack.origin.y], [-6, -2]);
    const frozen = JSON.stringify(round.attack.path);
    round.players[0].position.x += 1;
    round.players[0].position.y += 1;
    preview.path[0].x = 123;
    assert.equal(JSON.stringify(round.attack.path), frozen);
  }
});

test("previews and invalid input cause no attack, damage, or knockback", () => {
  const round = groundedRound();
  for (const expression of ["0", "x+1", "sin(", "1/x"]) {
    const preview = previewFor(round, expression);
    if (preview.error) assert.equal(firePreview(round, 1, preview), false);
    for (let i = 0; i < 30; i += 1) updateRound(round, FIXED_STEP);
    assert.equal(round.attack, null);
    assert.ok(round.players.every((p) => p.health === 100 && p.velocity.x === 0 && p.velocity.y === 0));
  }
});

test("only the selected current-team character can fire, and damage waits for arrival", () => {
  const round = groundedRound();
  const preview = previewFor(round);
  assert.equal(firePreview(round, 0, preview), false);
  assert.equal(firePreview(round, 4, preview), false);
  assert.ok(firePreview(round, 1, preview));
  assert.ok(round.players.every((p) => p.health === 100));
  for (let i = 0; i < 20; i += 1) updateRound(round, FIXED_STEP);
  assert.equal(round.players[4].health, 100);
  assert.equal(round.currentTeam, 0);
  for (let i = 0; i < 25; i += 1) updateRound(round, FIXED_STEP);
  assert.equal(round.players[4].health, 80);
  assert.ok(round.players.filter((_, i) => i !== 4).every((p) => p.health === 100));
  assert.ok(round.players[4].velocity.x > 0);
  assert.equal(firePreview(round, 1, preview), false);
  for (let i = 0; i < 50; i += 1) updateRound(round, FIXED_STEP);
  assert.equal(round.attack, null);
  assert.equal(round.currentTeam, 1);
  assert.ok(firePreview(round, 4, previewFor(round)));
});

test("health and falling eliminate individuals and update selection, without an early team victory", () => {
  const round = groundedRound();
  round.players[1].health = 0;
  round.players[3].position.z = ARENA.fallHeight - 0.1;
  updateRound(round, FIXED_STEP);
  assert.ok(round.players[1].eliminated);
  assert.ok(round.players[3].eliminated);
  assert.equal(round.selected[0], 0);
  assert.equal(round.result, null);
  assert.equal(selectCharacter(round, 1), false);
});

test("only elimination of the third opposing character ends the round", () => {
  const round = groundedRound();
  for (const index of [3, 4]) {
    round.players[index].health = 0;
    updateRound(round, FIXED_STEP);
    assert.equal(round.result, null);
  }
  round.players[5].position.z = ARENA.fallHeight - 0.1;
  updateRound(round, FIXED_STEP);
  assert.equal(round.result.winner, "Blue");
  const frozen = JSON.stringify(round);
  updateRound(round, FIXED_STEP);
  assert.equal(JSON.stringify(round), frozen);
});

test("simultaneous team elimination is a draw, and restart restores all six", () => {
  const round = groundedRound();
  round.players.forEach((player) => { player.health = 0; });
  updateRound(round, FIXED_STEP);
  assert.equal(round.result.winner, "Draw");
  const fresh = createRound(false);
  assert.equal(fresh.currentTeam, 0);
  assert.equal(fresh.attack, null);
  assert.equal(fresh.castCount, 0);
  assert.equal(fresh.result, null);
  assert.ok(fresh.players.every((p) => !p.eliminated && p.health === 100 && p.position.z === 3));
});

test("automatic casts alternate teams at the existing cadence", () => {
  const round = createRound(true);
  const casts = [];
  for (let tick = 0; casts.length < 6; tick += 1) {
    const before = round.castCount;
    updateRound(round, FIXED_STEP);
    if (before !== round.castCount) casts.push({ team: round.players[round.attack.attackerIndex].team, time: round.time });
    assert.ok(tick < 1500);
  }
  assert.deepEqual(casts.map((cast) => cast.team), [0, 1, 0, 1, 0, 1]);
  for (let i = 1; i < casts.length; i += 1) {
    assert.ok(casts[i].time - casts[i - 1].time >= TURN_INTERVAL - 1e-10);
  }
});

test("a full team round completes identically at 30, 60, and 144 FPS", () => {
  function simulate(fps) {
    const round = createRound(true);
    const clock = { accumulator: 0 };
    for (let frame = 0; frame < fps * 90 && !round.result; frame += 1) {
      takeFixedSteps(clock, 1 / fps, (dt) => updateRound(round, dt));
    }
    assert.ok(round.result, "Automatic team round should finish within 90 simulated seconds.");
    const loser = round.result.winner === "Blue" ? 1 : 0;
    assert.ok(round.players.filter((p) => p.team === loser).every((p) => p.eliminated));
    return { players: round.players, result: round.result, time: round.time, casts: round.castCount };
  }
  const baseline = simulate(60);
  assert.deepEqual(simulate(30), baseline);
  assert.deepEqual(simulate(144), baseline);
});
