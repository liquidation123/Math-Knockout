import test from "node:test";
import assert from "node:assert/strict";
import { createDuel, lockEquation, launchDuel, travelPath, updateDuel, bumpDirection } from "../src/duel.js";
import { buildPreview } from "../src/equations.js";
import { FIXED_STEP } from "../src/physics.js";

function run(blue, red) {
  const duel = createDuel();
  assert.equal(lockEquation(duel, 0, blue), "");
  assert.equal(lockEquation(duel, 1, red), "");
  assert.equal(launchDuel(duel), true);
  for (let i = 0; i < 1200 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  return duel;
}

test("two hidden choices are required before a simultaneous launch", () => {
  const duel = createDuel();
  assert.equal(lockEquation(duel, 0, "0"), "");
  assert.equal(launchDuel(duel), false);
  assert.equal(lockEquation(duel, 0, "x"), "Already locked.");
  assert.ok(lockEquation(duel, 1, "notMath"));
  assert.equal(lockEquation(duel, 1, "0"), "");
  assert.equal(launchDuel(duel), true);
});

test("head-on launches collide and knock both players off", () => {
  const duel = run("0", "0");
  assert.equal(duel.phase, "finished");
  assert.equal(duel.winner, "Draw");
  assert.ok(duel.players.every((player) => player.eliminated));
});

test("a curved miss can fall while the other player remains on top", () => {
  const duel = run("0", "2*x");
  assert.equal(duel.winner, "Blue");
  assert.equal(duel.players[0].eliminated, false);
  assert.equal(duel.players[1].eliminated, true);
});

test("more ink means more mass and changes a head-on collision", () => {
  const duel = createDuel();
  duel.players[0].mass = 2;
  duel.players[1].mass = 0.8;
  lockEquation(duel, 0, "0"); lockEquation(duel, 1, "0"); launchDuel(duel);
  for (let i = 0; i < 1200 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  assert.equal(duel.winner, "Blue");
});

test("an invalid equation cannot lock or launch", () => {
  const duel = createDuel();
  assert.ok(lockEquation(duel, 0, "sin("));
  assert.deepEqual(duel.locked, [false, false]);
  assert.equal(launchDuel(duel), false);
});

test("preview stops at the same friction-limited travel distance", () => {
  const points = travelPath([{ x: 0, y: 0, z: 0.5 }, { x: 20, y: 0, z: 0.5 }]);
  assert.equal(points.at(-1).x, 12.5);
});

test("both players turn toward the rival after crossing; preview and captured paths agree", () => {
  const duel = createDuel();
  duel.players[0].position.x = 6;
  duel.players[1].position.x = -6;
  for (const side of [0, 1]) {
    const direction = bumpDirection(duel.players, side);
    assert.equal(direction, side === 0 ? -1 : 1);
    const preview = buildPreview("0", duel.players[side].position, direction);
    assert.equal(lockEquation(duel, side, "0"), "");
    assert.deepEqual(duel.paths[side].points, preview.path);
    assert.ok((duel.paths[side].points[1].x - duel.players[side].position.x) * direction > 0);
  }
  launchDuel(duel);
  for (let tick = 0; tick < 120; tick += 1) updateDuel(duel, FIXED_STEP);
  assert.ok(duel.contacts > 0, "The crossed characters can actually meet again.");
});
