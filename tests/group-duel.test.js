import test from "node:test";
import assert from "node:assert/strict";
import { createDuel, duelReady, duelTarget, lockEquation, launchDuel, resignDuel, updateDuel, insideDuel } from "../src/duel.js";
import { FIXED_STEP } from "../src/physics.js";

test("four distinct players spawn separated on the summit and require every surviving choice", () => {
  const duel = createDuel(4);
  assert.deepEqual(duel.players.map((p) => p.name), ["Blue", "Red", "Green", "Gold"]);
  assert.equal(new Set(duel.players.map((p) => p.team)).size, 4);
  for (const player of duel.players) assert.ok(insideDuel(player.position.x, player.position.y, duel.radius - player.radius));
  for (let side = 0; side < 3; side++) assert.equal(lockEquation(duel, side, "0"), "");
  assert.equal(duelReady(duel), false);
  assert.equal(launchDuel(duel), false);
  assert.equal(lockEquation(duel, 3, "0"), "");
  assert.equal(launchDuel(duel), true);
});

test("automatic aiming chooses the nearest surviving rival with stable ties", () => {
  const duel = createDuel(4);
  assert.equal(duelTarget(duel.players, 0), 2);
  duel.players[2].eliminated = true;
  assert.equal(duelTarget(duel.players, 0), 3);
  duel.players[3].eliminated = true;
  assert.equal(duelTarget(duel.players, 0), 1);
  duel.players[1].eliminated = true;
  assert.equal(duelTarget(duel.players, 0), null);
});

test("collisions between Green and Gold leave unrelated equation launches running", () => {
  const duel = createDuel(4);
  duel.players[0].position = { x: -6, y: 4, z: .5 };
  duel.players[1].position = { x: 6, y: 4, z: .5 };
  duel.players[2].position = { x: -1, y: -2, z: .5 };
  duel.players[3].position = { x: 1, y: -2, z: .5 };
  for (let side = 0; side < 4; side++) lockEquation(duel, side, "0");
  launchDuel(duel);
  for (let i = 0; i < 120 && !duel.lastImpact; i++) updateDuel(duel, FIXED_STEP);
  assert.ok(duel.lastImpact);
  assert.equal(duel.paths[2].done, true);
  assert.equal(duel.paths[3].done, true);
  assert.equal(duel.paths[0].done, undefined);
  assert.equal(duel.paths[1].done, undefined);
});

test("individual resignation eliminates only that player; the last survivor wins", () => {
  const duel = createDuel(4);
  assert.equal(resignDuel(duel, 2), true);
  assert.equal(duel.phase, "planning");
  assert.equal(duel.winner, null);
  assert.ok(lockEquation(duel, 2, "0"));
  resignDuel(duel, 0); resignDuel(duel, 1);
  assert.equal(duel.phase, "finished");
  assert.equal(duel.winner, "Gold");
  assert.equal(resignDuel(duel, 3), false);
});

test("erosion can eliminate one of four players and continue with the remaining three", () => {
  const duel = createDuel(4);
  for (let side = 0; side < 4; side++) lockEquation(duel, side, "0");
  launchDuel(duel);
  duel.paths.forEach((path) => { path.done = true; });
  duel.players[0].position.x = 7.8;
  for (let i = 0; i < 500 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  assert.equal(duel.players[0].eliminated, true);
  assert.equal(duel.phase, "planning");
  assert.equal(duel.round, 2);
  assert.equal(duel.winner, null);
  for (const side of [1, 2, 3]) assert.equal(lockEquation(duel, side, "0"), "");
  assert.equal(launchDuel(duel), true);
  updateDuel(duel, FIXED_STEP);
});
