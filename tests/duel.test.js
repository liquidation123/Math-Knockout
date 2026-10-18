import test from "node:test";
import assert from "node:assert/strict";
import { chooseBotEquation, createDuel, insideDuel, interceptSlope, lockEquation, launchDuel, resignDuel,
  safeTravelPath, setDuelBody, travelDistance, travelPath, updateDuel } from "../src/duel.js";
import { FIXED_STEP, GROUND_FRICTION } from "../src/physics.js";
import { bodyFromMask, starterMask } from "../src/body.js";

function run(blue, red) {
  const duel = createDuel();
  assert.equal(lockEquation(duel, 0, blue), "");
  assert.equal(lockEquation(duel, 1, red), "");
  assert.equal(launchDuel(duel), true);
  for (let i = 0; i < 1200 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  return duel;
}

test("resigning ends a duel immediately and cannot overwrite its winner", () => {
  const duel = createDuel();
  assert.equal(resignDuel(duel, 0), true);
  assert.equal(duel.phase, "finished");
  assert.equal(duel.winner, "Red");
  assert.equal(duel.resignedBy, 0);
  assert.equal(resignDuel(duel, 1), false);
  updateDuel(duel, FIXED_STEP);
  assert.equal(duel.winner, "Red");
});

test("two hidden choices are required before a simultaneous launch", () => {
  const duel = createDuel();
  assert.equal(lockEquation(duel, 0, "0"), "");
  assert.equal(launchDuel(duel), false);
  assert.equal(lockEquation(duel, 0, "x"), "Already locked.");
  assert.ok(lockEquation(duel, 1, "notMath"));
  assert.equal(lockEquation(duel, 1, "0"), "");
  assert.equal(launchDuel(duel), true);
});

test("equal head-on launches collide and continue into the shrinking round", () => {
  const duel = run("0", "0");
  assert.ok(duel.lastImpact);
  assert.equal(duel.phase, "planning");
  assert.equal(duel.round, 2);
  assert.ok(duel.players.every((player) => !player.eliminated));
});

test("a chosen curved path stops at the safe rim instead of throwing its player off", () => {
  const duel = run("0", "2*x");
  assert.equal(duel.phase, "planning");
  assert.ok(duel.players.every((player) => !player.eliminated));
  assert.ok(duel.players.every((player) => insideDuel(player.position.x, player.position.y, duel.radius)));
});

test("more ink means more mass and changes a head-on collision", () => {
  const duel = createDuel();
  const baseline = run("0", "0");
  const square = Array.from({ length: 10240 }, (_, i) => {
    const x = i % 128, y = Math.floor(i / 128);
    return x >= 38 && x < 90 && y >= 20 && y < 59 ? "1" : "0";
  }).join("");
  setDuelBody(duel, 0, square);
  assert.ok(duel.players[0].mass > baseline.players[0].mass);
  lockEquation(duel, 0, "0"); lockEquation(duel, 1, "0"); launchDuel(duel);
  for (let i = 0; i < 1200 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  assert.ok(duel.lastImpact);
  assert.notEqual(duel.players[0].position.x, baseline.players[0].position.x);
});

test("a heavy fighter takes a smaller velocity change than a light fighter in the same collision", () => {
  const mask = (width, height) => Array.from({ length: 10240 }, (_, index) => {
    const x = index % 128, y = Math.floor(index / 128);
    return x >= 64 - width / 2 && x < 64 + width / 2 &&
      y >= 40 - height / 2 && y < 40 + height / 2 ? "1" : "0";
  }).join("");
  const duel = createDuel();
  setDuelBody(duel, 0, mask(50, 40));
  setDuelBody(duel, 1, mask(10, 10));
  lockEquation(duel, 0, "0"); lockEquation(duel, 1, "0"); launchDuel(duel);
  duel.paths.forEach((path) => { path.done = true; });
  duel.players[0].position.x = -.2;
  duel.players[1].position.x = .2;
  duel.players[0].velocity.x = 2;
  duel.players[1].velocity.x = -2;
  updateDuel(duel, FIXED_STEP);
  assert.ok(duel.lastImpact);
  const before = 2 - GROUND_FRICTION * FIXED_STEP;
  const heavyChange = before - duel.players[0].velocity.x;
  const lightChange = duel.players[1].velocity.x + before;
  assert.ok(lightChange > heavyChange * 3);
  assert.ok(Math.abs(heavyChange * duel.players[0].mass - lightChange * duel.players[1].mass) < 1e-8);
});

test("using most of the ink has a clearly shorter launch than a light drawing", () => {
  const light = bodyFromMask("1".repeat(103) + "0".repeat(10137));
  const heavy = bodyFromMask("1".repeat(2048) + "0".repeat(8192));
  assert.ok(travelDistance(light.mass) > 3 * travelDistance(heavy.mass));
  assert.ok(heavy.inertia > light.inertia);
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
  const full = "1".repeat(2048) + "0".repeat(8192);
  setDuelBody(duel, 0, full);
  assert.equal(travelDistance(2), travelDistance(1) / 2);
  assert.ok(insideDuel(0, 7, duel.radius));
  assert.equal(insideDuel(7, 7, duel.radius), false);
  lockEquation(duel, 0, "3*x"); lockEquation(duel, 1, "-3*x"); launchDuel(duel);
  assert.ok(duel.paths[0].speed < duel.paths[1].speed);
  duel.paths.forEach((path) => { path.done = true; });
  duel.elapsed = 8;
  for (let i = 0; i < 24 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  assert.equal(duel.phase, "planning");
  assert.equal(duel.round, 2);
  assert.ok(Math.abs(duel.radius - 7.55) < 1e-8);
});

test("bot varies evasive paths without reading the hidden human equation", () => {
  const first = createDuel(), second = createDuel();
  lockEquation(first, 0, "0");
  lockEquation(second, 0, "3*x");
  assert.equal(chooseBotEquation(first, () => .3), chooseBotEquation(second, () => .3));
  assert.notEqual(chooseBotEquation(first, () => .3), chooseBotEquation(first, () => .9));
  const dodge = chooseBotEquation(first, () => .3);
  lockEquation(first, 1, dodge);
  launchDuel(first);
  for (let i = 0; i < 1200 && first.phase === "running"; i++) updateDuel(first, FIXED_STEP);
  assert.equal(first.lastImpact, undefined, "the bot should miss a straight player launch");
});

test("the shrinking island lets a character fall before eliminating it", () => {
  const duel = createDuel();
  lockEquation(duel, 0, "0"); lockEquation(duel, 1, "0"); launchDuel(duel);
  duel.paths.forEach((path) => { path.done = true; });
  duel.players[0].position.x = 7.8;
  duel.players[1].position.x = 0;
  duel.elapsed = 8;
  for (let i = 0; i < 24; i++) updateDuel(duel, FIXED_STEP);
  assert.equal(duel.phase, "running");
  assert.equal(duel.players[0].eliminated, false);
  assert.ok(duel.players[0].position.z < .5);
  assert.ok(Math.abs(duel.radius - 7.55) < 1e-8);
  for (let i = 0; i < 360 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  assert.equal(duel.phase, "finished");
  assert.equal(duel.winner, "Red");
});

test("mask cells determine mass, centre, inertia, and actual overlap", () => {
  const mask = starterMask(0), body = bodyFromMask(mask);
  assert.ok(body.mass > 0 && body.inertia > 0);
  assert.ok(body.cx > 50 && body.cx < 78);
  const duel = createDuel();
  assert.equal(duel.players[0].mass, body.mass);
  assert.equal(duel.players[0].inertia, body.inertia);
  assert.equal(interceptSlope(duel.players[0].position, duel.players[1].position,
    duel.players[0].mass, duel.players[1].mass, 0, duel.radius), 0);
  assert.equal(interceptSlope(duel.players[1].position, duel.players[0].position,
    duel.players[1].mass, duel.players[0].mass, 0, duel.radius) === 0, true);
  const path = safeTravelPath([{ x: 0, y: 0, z: .5 }, { x: 30, y: 0, z: .5 }], 1, duel.radius);
  assert.ok(Math.abs(path.at(-1).x - (duel.radius - .2)) < 1e-8);
});

test("suggested intercept meets a straight rival even with a vertical offset", () => {
  const duel = createDuel();
  duel.players[1].position.y = 2;
  const slope = interceptSlope(duel.players[0].position, duel.players[1].position,
    duel.players[0].mass, duel.players[1].mass, 0, duel.radius);
  assert.ok(slope > 0);
  lockEquation(duel, 0, `${slope.toFixed(3)}*x`);
  lockEquation(duel, 1, "0");
  launchDuel(duel);
  for (let i = 0; i < 1200 && duel.phase === "running"; i++) updateDuel(duel, FIXED_STEP);
  assert.ok(duel.lastImpact);
});
