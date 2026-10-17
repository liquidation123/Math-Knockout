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

test("a projectile passes through multiple enemies, hits each once, and ignores teammates", () => {
  const players = [blue(), blue(-2), red(0), red(4)];
  const attack = createAttack(0, players, parseEquation("0"), 0);
  assert.ok(players.every((p) => p.health === 100));
  updateProjectile(attack, players, 0.6);
  assert.equal(attack.stopped, false);
  assert.equal(attack.reason, "");
  assert.equal(players[2].health, 80);
  assert.equal(players[1].health, 100);
  assert.equal(players[3].health, 100);
  close(attack.position.x, 0);
  updateProjectile(attack, players, 0.5);
  close(attack.position.x, 5);
  assert.equal(players[3].health, 80);
  assert.deepEqual([...attack.hitEnemies], [2, 3]);
  assert.deepEqual(attack.hits.map((hit) => hit.playerIndex), [2, 3]);
  close(attack.hits[0].position.x, -0.62);
  close(attack.hits[1].position.x, 3.38);
  const velocity = { ...players[2].velocity };
  const secondVelocity = { ...players[3].velocity };
  for (let i = 0; i < 30; i += 1) updateProjectile(attack, players, 0.1);
  assert.equal(players[2].health, 80);
  assert.deepEqual(players[2].velocity, velocity);
  assert.equal(players[3].health, 80);
  assert.deepEqual(players[3].velocity, secondVelocity);
  assert.equal(attack.reason, "Map boundary");
});

test("an obstacle blocks an enemy behind it, while a nearer enemy is hit first", () => {
  let players = [blue(-7, 4), red(7, 4)];
  let attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 0.6);
  assert.equal(attack.reason, "Obstacle");
  assert.deepEqual(attack.impactPoint, attack.position);
  close(attack.position.x, -4 - PROJECTILE_RADIUS);
  assert.equal(players[1].health, 100);

  players = [blue(-7, 4), red(-6, 4)];
  attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 0.6);
  assert.equal(attack.reason, "Obstacle");
  assert.equal(players[1].health, 80);
  close(attack.position.x, -4 - PROJECTILE_RADIUS);
});

test("one long segment hits enemies in travel order and stops before enemies behind a wall", () => {
  const players = [blue(-7, 4), red(7, 4), red(-5, 4), red(-6, 4)];
  const preview = {
    origin: players[0].position,
    path: [{ x: -7, y: 4, z: 0.5 }, { x: 10, y: 4, z: 0.5 }],
  };
  const attack = createAttack(0, players, parseEquation("0"), 0, preview);
  updateProjectile(attack, players, 2);
  assert.deepEqual(attack.hits.map((hit) => hit.playerIndex), [3, 2]);
  assert.deepEqual(players.map((player) => player.health), [100, 100, 80, 80]);
  assert.equal(attack.reason, "Obstacle");
  close(attack.position.x, -4 - PROJECTILE_RADIUS);
  assert.deepEqual(attack.impactPoint, attack.position);
});

test("overlapping enemies and repeated contact cannot apply a second hit", () => {
  const players = [blue(), red(0), red(0.1)];
  const attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 0.56);
  assert.deepEqual(players.map((player) => player.health), [100, 80, 80]);
  const velocities = players.map((player) => ({ ...player.velocity }));
  for (let tick = 0; tick < 20; tick += 1) updateProjectile(attack, players, 0.005);
  assert.deepEqual(players.map((player) => player.velocity), velocities);
  assert.equal(attack.hits.length, 2);
  assert.equal(attack.stopped, false);
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
  let players = [blue(-11, 0)];
  let attack = createAttack(0, players, parseEquation("0.1x"), 0);
  updateProjectile(attack, players, 0.1);
  close(Math.hypot(attack.position.x + 11, attack.position.y), PROJECTILE_SPEED * 0.1);

  players = [blue(-11, 0)];
  attack = createAttack(0, players, parseEquation("0.1x^2"), 0);
  updateProjectile(attack, players, 0.1);
  const x = attack.position.x + 11;
  // Independent analytic arc length of y = 0.1x² from 0 to x.
  const length = 0.5 * x * Math.sqrt(1 + 0.04 * x * x) + Math.asinh(0.2 * x) / 0.4;
  close(length, PROJECTILE_SPEED * 0.1, 0.001);
});

test("a constant offset is anchored through the shooter with no launch delay or connector", () => {
  const players = [blue(-6, 0), red(-6, 2), red(0, 0)];
  const attack = createAttack(0, players, parseEquation("6"), 0);
  assert.equal(attack.launchDuration, undefined);
  assert.deepEqual(attack.position, { x: -6, y: 0, z: 0.5 });
  assert.deepEqual(attack.path[0], attack.position);
  updateProjectile(attack, players, 0.01);
  close(attack.position.x, -6 + PROJECTILE_SPEED * 0.01);
  close(attack.position.y, 0);
  updateProjectile(attack, players, 0.6);
  assert.equal(players[1].health, 100);
  assert.equal(players[2].health, 80);
});

test("every translated preview is the exact immutable path used by the projectile", () => {
  for (const team of [0, 1]) {
    for (const expression of ["6", "x+6", "e^x", "(x-1)^2+1", "(x-2)^2+6", "(x+2)^2-3", "sin(x-1)", "1/x", "ln(x)"]) {
      const players = [createPlayer("Shooter", team === 0 ? -11 : 11, 0, 0.5, team)];
      const preview = buildPreview(expression, players[0].position, team === 0 ? 1 : -1);
      assert.equal(preview.error, "");
      const attack = createAttack(0, players, preview.equation, 0, preview);
      assert.deepEqual(attack.path, preview.path);
      assert.notEqual(attack.path, preview.path);
      assert.deepEqual(attack.position, attack.path[0]);
      const frozen = JSON.stringify(attack.path);
      players[0].position.x += 0.5;
      preview.path[0].y += 100;
      assert.equal(JSON.stringify(attack.path), frozen);
      updateProjectile(attack, players, 0.005);
      // Locate the travelled distance independently on the saved preview polyline.
      let remaining = PROJECTILE_SPEED * 0.005;
      let expected = attack.path[0];
      for (let i = 1; i < attack.path.length; i += 1) {
        const a = attack.path[i - 1], b = attack.path[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (remaining <= length) {
          expected = { x: a.x + (b.x - a.x) * remaining / length,
            y: a.y + (b.y - a.y) * remaining / length };
          break;
        }
        remaining -= length;
        expected = b;
      }
      close(attack.position.x, expected.x);
      close(attack.position.y, expected.y);
    }
  }
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

test("a one-point branch fires at the shooter and stops without teleporting", () => {
  const players = [red()];
  const preview = buildPreview("sqrt(x)", players[0].position, -1);
  const attack = createAttack(0, players, preview.equation, 0, preview);
  updateProjectile(attack, players, 0.1);
  assert.equal(attack.reason, "End of continuous curve");
  assert.deepEqual(attack.position, { x: 6, y: 0, z: 0.5 });
});

test("Red traverses decreasing local X without mirroring the equation", () => {
  const players = [red(6, 0), blue(-6, 0)];
  const preview = buildPreview("0.1x+1", players[0].position, -1);
  const attack = createAttack(0, players, preview.equation, 0, preview);
  assert.equal(attack.path[0].x, 6);
  assert.equal(attack.path[0].y, 0);
  assert.ok(attack.path[1].x < 6);
  for (const point of attack.path) close(point.y, 0.1 * (point.x - 6));
});

test("a slow projectile survives the former cutoff and reaches a distant enemy", () => {
  assert.equal(PROJECTILE_SPEED, 10);
  const players = [blue(-11, 0), red(11, 0)];
  const attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 1);
  close(attack.position.x, -1);
  assert.equal(attack.stopped, false);
  assert.equal(attack.stoppedAt, null);
  assert.equal(players[1].health, 100);
  updateProjectile(attack, players, 1);
  close(attack.position.x, 9);
  assert.equal(attack.stopped, false);
  updateProjectile(attack, players, 0.2);
  assert.equal(attack.stopped, false);
  assert.equal(players[1].health, 80);
  updateProjectile(attack, players, ATTACK_DURATION);
  assert.equal(attack.reason, "Map boundary");
  const stoppedAt = attack.stoppedAt;
  updateProjectile(attack, players, ATTACK_DURATION);
  assert.equal(attack.stoppedAt, stoppedAt);
  assert.equal(players[1].health, 80);
});

test("eliminated or airborne targets are ignored until the shot reaches the boundary", () => {
  const players = [blue(), red(0, 0), red(2, 0)];
  players[1].eliminated = true;
  players[2].position.z = 3;
  const attack = createAttack(0, players, parseEquation("0"), 0);
  updateProjectile(attack, players, 2);
  assert.equal(attack.age, 2);
  assert.equal(attack.reason, "Map boundary");
  assert.ok(players.every((p) => p.health === 100));
});


test("visible block gaps and L-wall notches are not filled by compound colliders", () => {
  for (const [start, end] of [
    [{ x: 2.5, y: 4.5 }, { x: 6.5, y: 4.5 }],
    [{ x: -2, y: 1 }, { x: -2, y: 4.5 }],
    [{ x: -13, y: 0 }, { x: 13, y: 0 }],
  ]) assert.equal(firstCollision(start, end, [blue(start.x, start.y)], 0), null);
});
