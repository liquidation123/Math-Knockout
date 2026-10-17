import test from "node:test";
import assert from "node:assert/strict";
import { createRound } from "../src/combat.js";
import { ARENA, OBSTACLES, PLAYER_SIZE } from "../src/physics.js";
import { generateSpawns, validSpawn, SPAWN_RULES } from "../src/spawns.js";

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function checkSpawns(points) {
  assert.equal(points.length, 6);
  points.forEach((point, index) => {
    const team = Math.floor(index / 3);
    const teammates = points.slice(team * 3, index);
    assert.ok(validSpawn(point, team, teammates));
    // Check independently, not just by calling the placement predicate.
    assert.ok((team === 0 ? -point.x : point.x) >= 7);
    assert.ok(Math.abs(point.x) <= ARENA.halfWidth - 1.5);
    assert.ok(Math.abs(point.y) <= ARENA.depth / 2 - 1.5);
    for (const other of teammates) assert.ok(Math.hypot(point.x - other.x, point.y - other.y) >= 2.5);
    for (const box of OBSTACLES) {
      const padding = PLAYER_SIZE / 2 + 0.5;
      assert.ok(Math.abs(point.x - box.x) >= box.width / 2 + padding ||
        Math.abs(point.y - box.y) >= box.depth / 2 + padding);
    }
  });
}

test("1,000 seeded rounds have six safe, separated spawns, with varied layouts", () => {
  const layouts = new Set();
  const random = seededRandom(817);
  for (let i = 0; i < 1000; i += 1) {
    const round = createRound(false, random);
    const points = round.players.map((player) => player.position);
    checkSpawns(points);
    layouts.add(JSON.stringify(points));
  }
  assert.equal(layouts.size, 1000);
});

test("repeated random candidates hit a bounded fallback, which is valid for every team", () => {
  for (const value of [0, 0.5, 0.999999]) {
    let calls = 0;
    const points = generateSpawns(() => { calls += 1; return value; });
    checkSpawns(points);
    assert.ok(calls <= 2 * 3 * SPAWN_RULES.attemptsPerCharacter * 2);
    assert.deepEqual(points.map((p) => p.x), [-10, -10, -10, 10, 10, 10]);
  }
});
