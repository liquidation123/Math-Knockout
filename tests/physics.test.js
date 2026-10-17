import test from "node:test";
import assert from "node:assert/strict";
import {
  ARENA, OBSTACLES, FIXED_STEP, createPlayer, updatePlayer,
  applyImpulse, applyKnockback, takeFixedSteps,
} from "../src/physics.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10);

test("gravity changes Z only and cubes land at z = 0.5", () => {
  const player = createPlayer("Blue", 1, -1);
  updatePlayer(player, FIXED_STEP);
  assert.ok(player.velocity.z < 0);
  assert.deepEqual([player.position.x, player.position.y], [1, -1]);
  for (let i = 0; i < 1200; i += 1) updatePlayer(player, FIXED_STEP);
  assert.equal(player.position.z, 0.5);
  assert.deepEqual(player.velocity, { x: 0, y: 0, z: 0 });
});

test("a high-speed downward crossing lands; a cube below the top is not teleported", () => {
  const falling = createPlayer("Blue", 0, 0, 1);
  falling.velocity.z = -200;
  updatePlayer(falling, FIXED_STEP);
  assert.equal(falling.position.z, 0.5);
  const below = createPlayer("Red", 0, 0, -1);
  updatePlayer(below, FIXED_STEP);
  assert.ok(below.position.z < -1);
});

test("all four XY edges lose support, but each boundary itself still supports", () => {
  for (const [x, y] of [
    [ARENA.halfWidth + 0.01, 0], [-ARENA.halfWidth - 0.01, 0],
    [0, ARENA.depth / 2 + 0.01], [0, -ARENA.depth / 2 - 0.01],
  ]) {
    const player = createPlayer("Blue", x, y, 0.5);
    updatePlayer(player, FIXED_STEP);
    assert.ok(player.position.z < 0.5);
  }
  for (const [x, y] of [[ARENA.halfWidth, 0], [-ARENA.halfWidth, 0], [0, ARENA.depth / 2], [0, -ARENA.depth / 2]]) {
    const player = createPlayer("Blue", x, y, 0.5);
    updatePlayer(player, FIXED_STEP);
    assert.equal(player.position.z, 0.5);
  }
});

test("XY impulse divides by mass, without changing Z or position", () => {
  const player = createPlayer("Blue", 0);
  player.mass = 2;
  applyImpulse(player, { x: 6, y: 4 });
  assert.deepEqual(player.velocity, { x: 3, y: 2, z: 0 });
  assert.deepEqual(player.position, { x: 0, y: 0, z: 3 });
});

test("horizontal, vertical, diagonal, and overlapping knockback use the XY vector", () => {
  for (const [x, y, expectedX, expectedY] of [
    [4, 0, 5, 0], [-4, 0, -5, 0], [0, 4, 0, 5], [0, -4, 0, -5],
    [3, 4, 3, 4], [-3, -4, -3, -4], [0, 0, 5, 0],
  ]) {
    const attacker = createPlayer("Blue", 0, 0, 0.5);
    const target = createPlayer("Red", x, y, 0.5);
    applyKnockback(attacker, target, 5);
    close(target.velocity.x, expectedX);
    close(target.velocity.y, expectedY);
    assert.equal(target.velocity.z, 0);
  }
});

test("ground friction preserves the XY direction and does not reverse tiny velocities", () => {
  const player = createPlayer("Blue", 0, 0, 0.5);
  player.velocity.x = 3;
  player.velocity.y = 4;
  updatePlayer(player, FIXED_STEP);
  close(player.velocity.x / player.velocity.y, 3 / 4);
  player.velocity.x = -0.001;
  player.velocity.y = 0.001;
  updatePlayer(player, FIXED_STEP);
  close(player.velocity.x, 0);
  close(player.velocity.y, 0);
});

test("direct movement arguments have no effect; only velocity moves a character", () => {
  for (const movement of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: -1 }]) {
    const player = createPlayer("Blue", -10, 0, 0.5);
    for (let i = 0; i < 120; i += 1) updatePlayer(player, FIXED_STEP, movement);
    assert.deepEqual(player.position, { x: -10, y: 0, z: 0.5 });
  }
});

test("XY knockback gives identical physics at 30/60/144 FPS", () => {
  function simulate(fps) {
    const player = createPlayer("Blue", 0, 0);
    const clock = { accumulator: 0 };
    applyImpulse(player, { x: 1, y: 0.5 });
    for (let frame = 0; frame < fps * 2; frame += 1) {
      takeFixedSteps(clock, 1 / fps, (dt) => updatePlayer(player, dt));
    }
    return player;
  }
  assert.deepEqual(simulate(30), simulate(60));
  assert.deepEqual(simulate(144), simulate(60));
});

test("large knockback steps cannot cross any solid component", () => {
  for (const box of OBSTACLES) {
    for (const axis of ["x", "y"]) {
      for (const direction of [-1, 1]) {
        const half = (axis === "x" ? box.width : box.depth) / 2 + 0.5;
        const other = axis === "x" ? "y" : "x";
        const player = createPlayer("Blue", box.x, box.y, 0.5);
        // Start outside the entire compound layout, then sweep toward this component.
        player.position[axis] = -direction * 12;
        const start = player.position[axis];
        const expected = OBSTACLES.filter((part) =>
          Math.abs(player.position[other] - part[other]) <
            (other === "x" ? part.width : part.depth) / 2 + 0.5,
        ).map((part) => part[axis] - direction * ((axis === "x" ? part.width : part.depth) / 2 + 0.5));
        const firstFace = direction > 0 ? Math.min(...expected) : Math.max(...expected);
        player.velocity[axis] = direction * 4000;
        updatePlayer(player, FIXED_STEP);
        close(player.position[axis], firstFace);
        assert.equal(player.velocity[axis], 0);
        assert.ok(direction * (player.position[axis] - start) < direction * (box[axis] + direction * half - start));
      }
    }
  }
});

test("characters slide through cluster gaps and the open notch of an L-wall", () => {
  const gap = createPlayer("Blue", 2.5, 4.5, 0.5);
  gap.velocity.x = 10;
  updatePlayer(gap, 0.4);
  close(gap.position.x, 6.5);
  const notch = createPlayer("Blue", -2, 1, 0.5);
  notch.velocity.y = 10;
  updatePlayer(notch, 0.3);
  close(notch.position.y, 4);
});

test("an eliminated character no longer moves or falls", () => {
  const player = createPlayer("Blue", 0, 0, 0.5);
  player.eliminated = true;
  const before = structuredClone(player);
  updatePlayer(player, FIXED_STEP, { x: 1, y: 1 });
  assert.deepEqual(player, before);
});
