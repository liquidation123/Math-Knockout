import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview, parseEquation } from "../src/equations.js";
import { ARENA, createPlayer } from "../src/physics.js";
import {
  ATTACK_DURATION, PROJECTILE_SPEED, PROJECTILE_RADIUS, createAttack, updateProjectile,
  segmentCircleHit, segmentBoxHit, firstCollision,
} from "../src/projectile.js";

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, a + " != " + b);
const blue = (x = -6, y = 0) => createPlayer("Blue", x, y, 0.5, 0);
const red = (x = 6, y = 0) => createPlayer("Red", x, y, 0.5, 1);

test("long swept segments detect small circles and thin obstacles between endpoints", () => {
  close(segmentCircleHit({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 0.1), 0.495);
  close(segmentBoxHit({ x: -10, y: 0 }, { x: 10, y: 0 },
    { x: 0, y: 0, width: 0.2, depth: 1 }), 0.495);
  assert.equal(segmentCircleHit({ x: -10, y: 2 }, { x: 10, y: 2 }, { x: 0, y: 0 }, 0.1), null);
});

test("a fast projectile damages only the first enemy, once, and ignores teammates", () => {
  const players = [blue(), blue(-2), red(0), red(4)];
  const attack = createAttack(0, players, parseEquation("0"), 0);
  assert.ok(players.every((p) => p.health === 100));
  updateProjectile(attack, players, 0.5);
  assert.equal(attack.reason, "Enemy hit");
  assert.equal(players[2].health, 80);
  assert.equal(players[1].health, 100);
  assert.equal(players[3].health, 100);
  assert.ok(attack.position.x < 0);
  const velocity = { ...players[2].velocity };
  for (let i = 0; i < 30; i += 1) updateProjectile(attack, players, 0.1);
  assert.equal(players[2].health, 80);
  assert.deepEqual(players[2].velocity, velocity);
});

test("an obstacle blocks an enemy behind it, while a nearer enemy is hit first", () => {
  let players = [blue(-4, 1), red(4, 1)];
  let attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 0.6);
  assert.equal(attack.reason, "Obstacle");
  close(attack.position.x, -0.6 - PROJECTILE_RADIUS);
  assert.equal(players[1].health, 100);

  players = [blue(-4, 1), red(-2, 1)];
  attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 0.6);
  assert.equal(attack.reason, "Enemy hit");
  assert.equal(players[1].health, 80);
  assert.ok(attack.position.x < -2);
});

test("all four map boundaries stop a swept shot before an outside target", () => {
  for (const [start, end] of [
    [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    [{ x: 0, y: 0 }, { x: -20, y: 0 }],
    [{ x: 8, y: 0 }, { x: 8, y: 10 }],
    [{ x: 8, y: 0 }, { x: 8, y: -10 }],
  ]) {
    const hit = firstCollision(start, end, [blue(start.x, start.y)], 0);
    assert.equal(hit.reason, "Map boundary");
    assert.ok(hit.t >= 0 && hit.t <= 1);
  }
  const players = [blue(9, 0), red(20, 0)];
  const attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 0.6);
  close(attack.position.x, ARENA.halfWidth - PROJECTILE_RADIUS);
  assert.equal(players[1].health, 100);
});

test("speed is measured along a line and a parabola, rather than along X", () => {
  let players = [blue(-6, -2)];
  let attack = createAttack(0, players, parseEquation("0.1x"), 0);
  updateProjectile(attack, players, 0.1);
  close(Math.hypot(attack.position.x + 6, attack.position.y + 2), PROJECTILE_SPEED * 0.1);

  players = [blue(-6, -2)];
  attack = createAttack(0, players, parseEquation("0.1x^2"), 0);
  updateProjectile(attack, players, 0.1);
  const x = attack.position.x + 6;
  // Independent analytic arc length of y = 0.1x² from 0 to x.
  const length = 0.5 * x * Math.sqrt(1 + 0.04 * x * x) + Math.asinh(0.2 * x) / 0.4;
  close(length, PROJECTILE_SPEED * 0.1, 0.001);
});

test("an offset curve uses a harmless launch transition without a damaging connector", () => {
  const players = [blue(-6, 0), red(-6, 1)];
  const attack = createAttack(0, players, parseEquation("2"), 0);
  assert.equal(attack.launchDuration, 0.12);
  assert.deepEqual(attack.position, { x: -6, y: 0, z: 0.5 });
  assert.deepEqual(attack.path[0], { x: -6, y: 2, z: 0.5 });
  updateProjectile(attack, players, 0.06);
  close(attack.position.y, 1);
  assert.equal(players[1].health, 100);
  updateProjectile(attack, players, 0.6);
  assert.equal(players[1].health, 100);
});

test("a target at the offset curve start is hit only after the visual transition", () => {
  const players = [blue(-6, 0), red(-6, 2)];
  const attack = createAttack(0, players, parseEquation("2"), 0);
  updateProjectile(attack, players, 0.1);
  assert.equal(players[1].health, 100);
  updateProjectile(attack, players, 0.03);
  assert.equal(players[1].health, 80);
});

test("a harmless launch still stops at an obstacle or map edge", () => {
  let players = [blue(0, -1), red(6, 0)];
  let attack = createAttack(0, players, parseEquation("4"), 0);
  updateProjectile(attack, players, 0.2);
  assert.equal(attack.reason, "Obstacle");
  assert.ok(players.every((player) => player.health === 100));
  close(attack.position.y, 1 - 0.4 - PROJECTILE_RADIUS);

  players = [blue(-6, 3.5), red(6, 0)];
  attack = createAttack(0, players, parseEquation("2"), 0);
  updateProjectile(attack, players, 0.2);
  assert.equal(attack.reason, "Map boundary");
  close(attack.position.y, ARENA.depth / 2 - PROJECTILE_RADIUS);
});

test("a discontinuity ends the first branch without teleporting to a later branch", () => {
  const players = [blue(-6, 0), red(-3, Math.sqrt(2))];
  const preview = buildPreview("sqrt((x-1)(x-2))", players[0].position, 1);
  assert.equal(preview.error, "");
  assert.ok(preview.sections.length >= 2);
  const attack = createAttack(0, players, preview.equation, 0, preview);
  updateProjectile(attack, players, 0.6);
  assert.equal(attack.reason, "End of continuous curve");
  assert.ok(attack.position.x <= -5 + 1e-8);
  assert.equal(players[1].health, 100);
});

test("undefined f(0) and a branch with no outgoing path reject firing clearly", () => {
  assert.ok(buildPreview("1/x", { x: -6, y: 0 }, 1).error);
  assert.ok(buildPreview("sqrt(x)", { x: 6, y: 0 }, -1).error);
});

test("Red traverses decreasing local X without mirroring the equation", () => {
  const players = [red(6, 0), blue(-6, 0)];
  const preview = buildPreview("0.1x+1", players[0].position, -1);
  const attack = createAttack(0, players, preview.equation, 0, preview);
  assert.equal(attack.path[0].x, 6);
  assert.equal(attack.path[0].y, 1);
  assert.ok(attack.path[1].x < 6);
  for (const point of attack.path) close(point.y, 0.1 * (point.x - 6) + 1);
});

test("eliminated or airborne targets are ignored, and lifetime remains bounded", () => {
  const players = [blue(), red(0, 0), red(2, 0)];
  players[1].eliminated = true;
  players[2].position.z = 3;
  const attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 2);
  assert.equal(attack.age, ATTACK_DURATION);
  assert.ok(players.every((p) => p.health === 100));
});
