import test from "node:test";
import assert from "node:assert/strict";
import { createPlayer, movePlayerXY, updatePlayer, FIXED_STEP, OBSTACLES, takeFixedSteps } from "../src/physics.js";
import { createDuel, duelObstacles, lockEquation, launchDuel, updateDuel } from "../src/duel.js";
import { firstCollision } from "../src/projectile.js";

const wall = { x: 0, y: 0, width: 1, depth: 4, height: 1.4 };
const overlaps = (player, box) => Math.abs(player.position.x - box.x) < box.width / 2 + (player.radius || .5) - 1e-8 &&
  Math.abs(player.position.y - box.y) < box.depth / 2 + (player.radius || .5) - 1e-8;

test("each wall face reflects incoming speed while preserving motion along the wall", () => {
  for (const axis of ["x", "y"]) for (const sign of [-1, 1]) {
    const other = axis === "x" ? "y" : "x";
    const player = createPlayer("Blue", 0, 0, .5);
    player.position[axis] = -sign * 4;
    player.velocity[axis] = sign * 12;
    player.velocity[other] = .3;
    movePlayerXY(player, player.velocity.x / 2, player.velocity.y / 2, [wall]);
    assert.ok(Math.abs(player.velocity[axis] + sign * 9.6) < 1e-8);
    assert.equal(player.velocity[other], .3);
    assert.equal(overlaps(player, wall), false);
    assert.equal(player.health, 100);
  }
});

test("stationary, moving and large characters are freed from existing overlaps, including L corners", () => {
  const lWalls = [
    { x: 0, y: 0, width: 1, depth: 4 },
    { x: 1.5, y: 1.5, width: 4, depth: 1 },
  ];
  for (const radius of [.5, 1.2]) for (const velocity of [0, -3, 3]) {
    const player = createPlayer("Blue", 0, 1.5, .5);
    player.radius = radius;
    player.velocity.x = velocity;
    movePlayerXY(player, 0, 0, lWalls);
    assert.ok(lWalls.every((box) => !overlaps(player, box)));
    const position = { ...player.position }, speed = Math.hypot(player.velocity.x, player.velocity.y);
    movePlayerXY(player, 0, 0, lWalls);
    assert.deepEqual(player.position, position, "resting contacts do not jitter");
    assert.ok(Math.hypot(player.velocity.x, player.velocity.y) <= speed);
  }
});

test("all existing obstacles free an embedded player and allow it to move away", () => {
  for (const box of OBSTACLES) {
    const player = createPlayer("Blue", box.x, box.y, .5);
    movePlayerXY(player, 0, 0);
    assert.ok(OBSTACLES.every((part) => !overlaps(player, part)));
    const from = { ...player.position };
    player.velocity.x = (from.x - box.x) * 3;
    player.velocity.y = (from.y - box.y) * 3;
    updatePlayer(player, FIXED_STEP);
    assert.ok(Math.hypot(player.position.x - from.x, player.position.y - from.y) > 0);
    assert.ok(OBSTACLES.every((part) => !overlaps(player, part)));
  }
});

test("Bump equation launches hand their reflected velocity back to physics instead of sticking", () => {
  const duel = createDuel();
  duel.round = 3;
  duel.players[0].position = { x: -4, y: -3, z: .5 };
  duel.players[1].position = { x: 4, y: -3, z: .5 };
  lockEquation(duel, 0, "0", 2); lockEquation(duel, 1, "0"); launchDuel(duel);
  for (let i = 0; i < 240 && !duel.paths[0].done; i++) updateDuel(duel, FIXED_STEP);
  assert.equal(duel.paths[0].done, true);
  assert.ok(duel.players[0].velocity.x < 0);
  assert.ok(duelObstacles(duel.round, duel.radius).every((box) => !overlaps(duel.players[0], box)));
  const x = duel.players[0].position.x;
  updateDuel(duel, FIXED_STEP);
  assert.ok(duel.players[0].position.x < x);
});

test("wall bounces are frame-rate independent and bullets still stop at walls", () => {
  const simulate = (fps) => {
    const player = createPlayer("Blue", -3, 0, .5), clock = { accumulator: 0 };
    player.velocity.x = 10;
    for (let frame = 0; frame < fps; frame++) takeFixedSteps(clock, 1 / fps,
      (dt) => updatePlayer(player, dt, [wall]));
    return player;
  };
  assert.deepEqual(simulate(30), simulate(60));
  assert.deepEqual(simulate(144), simulate(60));
  const box = OBSTACLES[0];
  const players = [createPlayer("Blue", box.x - 4, box.y, .5, 0), createPlayer("Red", box.x + 4, box.y, .5, 1)];
  assert.equal(firstCollision(players[0].position, players[1].position, players, 0).reason, "Obstacle");
});
