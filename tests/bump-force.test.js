import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../src/equations.js";
import { forwardDirection } from "../src/aiming.js";
import { createDuel, lockEquation, launchDuel, safeTravelPath, travelDistance, updateDuel } from "../src/duel.js";
import { FIXED_STEP } from "../src/physics.js";

test("Bump force multiplies forward speed and distance follows v²/(2 friction)", () => {
  const speeds = [];
  for (const force of [.5, 1, 2]) {
    const duel = createDuel();
    lockEquation(duel, 0, "0", force);
    lockEquation(duel, 1, "0");
    const player = duel.players[0], start = player.position.x;
    speeds.push(duel.paths[0].speed);
    launchDuel(duel);
    updateDuel(duel, FIXED_STEP);
    assert.ok(player.position.x > start, "force launches forward, never as recoil");
    assert.ok(player.velocity.x > 0);
    assert.ok(Math.abs(travelDistance(player.mass, force) - 12.5 * force ** 2 / player.mass) < 1e-10);
  }
  assert.equal(speeds[2], speeds[1] * 2);
  assert.equal(speeds[0], speeds[1] * .5);
});

test("both teams use the same force-aware preview and capture its path, even after swapping sides", () => {
  for (const swapped of [false, true]) for (const side of [0, 1]) {
    const duel = createDuel();
    if (swapped) duel.players.forEach((p) => { p.position.x *= -1; });
    const player = duel.players[side], force = 1.7;
    const direction = forwardDirection(player.position, duel.players[1 - side].position, side === 0 ? 1 : -1);
    const preview = buildPreview("sin(x)", player.position, direction);
    const expected = safeTravelPath(preview.path, player.mass, duel.radius, force);
    assert.equal(lockEquation(duel, side, "sin(x)", force), "");
    assert.deepEqual(duel.paths[side].points, expected);
    const frozen = structuredClone(duel.paths[side]);
    assert.equal(lockEquation(duel, side, "0", .5), "Already locked.");
    preview.path[0].x = 999;
    assert.deepEqual(duel.paths[side], frozen);
  }
});

test("higher Bump force creates a stronger contact impulse with unchanged mass and health", () => {
  const impacts = [];
  for (const force of [.8, 1.6]) {
    const duel = createDuel();
    duel.players[0].position.x = -1;
    duel.players[1].position.x = 1;
    lockEquation(duel, 0, "0", force); lockEquation(duel, 1, "0", force); launchDuel(duel);
    for (let i = 0; i < 240 && !duel.lastImpact; i++) updateDuel(duel, FIXED_STEP);
    assert.ok(duel.lastImpact);
    assert.ok(duel.players.every((p) => p.health === 100));
    impacts.push(Math.hypot(duel.players[0].velocity.x, duel.players[0].velocity.y));
  }
  assert.ok(impacts[1] > impacts[0]);
});

test("invalid force cannot lock; default remains 1× and high-force previews stay on the safe branch", () => {
  for (const force of [0, -.5, .4, 3.1, NaN, Infinity, "2"]) {
    const duel = createDuel();
    assert.match(lockEquation(duel, 0, "0", force), /Force/);
    assert.equal(duel.locked[0], false);
  }
  const duel = createDuel();
  lockEquation(duel, 0, "0");
  assert.equal(duel.paths[0].force, 1);
  assert.equal(duel.paths[0].speed, 7.5 / Math.sqrt(duel.players[0].mass));
  const preview = buildPreview("1/(x-2)", { x: 0, y: 0 }, 1);
  const path = safeTravelPath(preview.path, 1, 8.25, 3);
  assert.ok(path.every((p) => p.x < 2 && Math.hypot(p.x, p.y) <= 8.05 + 1e-8));
});
