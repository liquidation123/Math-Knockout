import test from "node:test";
import assert from "node:assert/strict";
import { createDuel, insideDuel, lockEquation, launchDuel, travelDistance, travelPath, updateDuel } from "../src/duel.js";
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

test("heavier drawings launch slower, and each round tightens the circular boundary", () => {
  const duel = createDuel();
  duel.players[0].mass = 2;
  assert.equal(travelDistance(2), travelDistance(1) / 2);
  assert.ok(insideDuel(0, 7, duel.radius));
  assert.equal(insideDuel(7, 7, duel.radius), false);
  lockEquation(duel, 0, "3*x"); lockEquation(duel, 1, "-3*x"); launchDuel(duel);
  assert.ok(duel.paths[0].speed < duel.paths[1].speed);
  duel.paths.forEach((path) => { path.done = true; });
  duel.elapsed = 8;
  updateDuel(duel, FIXED_STEP);
  assert.equal(duel.phase, "planning");
  assert.equal(duel.round, 2);
  assert.equal(duel.radius, 6.2);
});
