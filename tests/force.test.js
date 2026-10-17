import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../src/equations.js";
import { createRound, firePreview, updateRound } from "../src/combat.js";
import { ARENA, FIXED_STEP, PLAYER_SIZE } from "../src/physics.js";
import { DEFAULT_FORCE, MIN_FORCE, KNOCKBACK, RECOIL, updateProjectile } from "../src/projectile.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " != " + b);

function groundedRound(team = 0) {
  const round = createRound();
  round.currentTeam = team;
  round.players.forEach((player, index) => {
    player.position = { x: player.team === 0 ? -10 : 10, y: [-5, 0, 5][index % 3], z: 0.5 };
  });
  return round;
}

function fire(round, expression = "0", force = DEFAULT_FORCE) {
  const index = round.selected[round.currentTeam];
  const shooter = round.players[index];
  const preview = buildPreview(expression, shooter.position, shooter.team === 0 ? 1 : -1);
  assert.equal(preview.error, "");
  assert.equal(firePreview(round, index, preview, force), true);
  return { shooter, preview, attack: round.attack };
}

test("recoil happens once at firing, even on a miss, and failed firing adds no recoil", () => {
  const round = groundedRound();
  round.players[4].position.y = 6;
  const { shooter, preview, attack } = fire(round);
  close(shooter.velocity.x, -RECOIL);
  close(shooter.velocity.y, 0);
  const velocity = { ...shooter.velocity };
  assert.equal(firePreview(round, 1, preview, 3), false);
  for (let tick = 0; tick < 400; tick += 1) updateProjectile(attack, round.players, FIXED_STEP);
  assert.equal(attack.stopped, true);
  assert.equal(attack.hits.length, 0);
  assert.deepEqual(shooter.velocity, velocity);
  assert.ok(round.players.every((player) => player.health === 100));
});

test("higher force scales both impulses, divides by mass, and leaves damage and speed unchanged", () => {
  const results = [];
  for (const force of [0.5, 3]) {
    const round = groundedRound();
    round.players[1].mass = 2;
    const target = round.players[4];
    target.position.x = 0;
    target.mass = 2;
    const { shooter, attack } = fire(round, "0", force);
    close(shooter.velocity.x, -RECOIL * force / shooter.mass);
    updateProjectile(attack, round.players, 1.1);
    close(target.velocity.x, KNOCKBACK * force / target.mass);
    assert.equal(target.health, 80);
    close(attack.position.x, 1);
    assert.equal(target.velocity.z, 0);
    assert.equal(shooter.velocity.z, 0);
    results.push({ recoil: Math.abs(shooter.velocity.x), knockback: target.velocity.x });
  }
  close(results[1].recoil / results[0].recoil, 6);
  close(results[1].knockback / results[0].knockback, 6);
});

test("recoil opposes the initial XY segment for both teams and curved shots", () => {
  for (const team of [0, 1]) {
    for (const expression of ["0", "x", "-x", "(x-1)^2 + 1", "1/x"]) {
      const round = groundedRound(team);
      const { shooter, attack } = fire(round, expression);
      const start = attack.path[0], next = attack.path[1];
      const dx = next.x - start.x, dy = next.y - start.y;
      const length = Math.hypot(dx, dy);
      close(shooter.velocity.x, -dx / length * RECOIL);
      close(shooter.velocity.y, -dy / length * RECOIL);
    }
  }
});

test("changing the selected force, preview, or shooter position cannot change a fired shot", () => {
  const round = groundedRound();
  let selectedForce = 0.5;
  const { shooter, preview, attack } = fire(round, "0", selectedForce);
  const savedPath = structuredClone(attack.path);
  const savedOrigin = { ...attack.origin };
  selectedForce = 3;
  preview.path[0].x = 100;
  assert.equal(firePreview(round, 1, preview, selectedForce), false);
  for (let tick = 0; tick < 60; tick += 1) updateRound(round, FIXED_STEP);
  assert.ok(shooter.position.x < savedOrigin.x, "Recoil should move the shooter.");
  assert.deepEqual(attack.path, savedPath);
  assert.deepEqual(attack.origin, savedOrigin);
  assert.equal(attack.force, 0.5);
  close(attack.position.x, -5);
  // Reach a target using the captured force even after the control value changes.
  updateProjectile(attack, round.players, 1.5);
  close(round.players[4].velocity.x, KNOCKBACK * 0.5);
  assert.equal(round.players[4].health, 80);
});

test("invalid input has no recoil and a one-point miss uses the team's fallback direction", () => {
  const round = groundedRound();
  const badPreview = buildPreview("sin(", round.players[1].position, 1);
  assert.equal(firePreview(round, 1, badPreview, 3), false);
  assert.deepEqual(round.players[1].velocity, { x: 0, y: 0, z: 0 });
  const redRound = groundedRound(1);
  const { shooter, attack } = fire(redRound, "sqrt(x)");
  assert.equal(attack.path.length, 1);
  close(shooter.velocity.x, RECOIL);
  close(shooter.velocity.y, 0);
  updateProjectile(attack, redRound.players, FIXED_STEP);
  assert.equal(attack.reason, "End of continuous curve");
  close(shooter.velocity.x, RECOIL);
});

test("a minimum-force hit visibly moves the enemy through the full physics loop for either team", () => {
  for (const team of [0, 1]) {
    const round = groundedRound(team);
    const targetIndex = round.selected[1 - team];
    const target = round.players[targetIndex];
    const { attack } = fire(round, "0", MIN_FORCE);
    for (let tick = 0; tick < 480 && target.health === 100; tick += 1) updateRound(round, FIXED_STEP);
    assert.equal(target.health, 80);
    const hitX = target.position.x;
    const direction = team === 0 ? 1 : -1;
    assert.ok(target.velocity.x * direction > 0);
    for (let tick = 0; tick < 120; tick += 1) updateRound(round, FIXED_STEP);
    assert.ok((target.position.x - hitX) * direction > PLAYER_SIZE,
      "Even minimum Force should move an unobstructed cube by more than its width.");
    assert.equal(target.health, 80);
    assert.equal(attack.hits.filter((hit) => hit.playerIndex === targetIndex).length, 1);
  }
});

test("one piercing shot moves multiple enemies without repeating damage during physics updates", () => {
  const round = groundedRound();
  const enemies = round.players.slice(3);
  enemies.forEach((player, index) => { player.position = { x: index * 4, y: 0, z: 0.5 }; });
  const starts = enemies.map((player) => player.position.x);
  const { attack } = fire(round);
  for (let tick = 0; tick < 480; tick += 1) updateRound(round, FIXED_STEP);
  assert.deepEqual(attack.hits.map((hit) => hit.playerIndex), [3, 4, 5]);
  enemies.forEach((player, index) => {
    assert.equal(player.health, 80);
    assert.ok(player.position.x > starts[index] + PLAYER_SIZE);
  });
});

test("an edge hit pushes an enemy off the platform without repeated damage", () => {
  const round = groundedRound();
  const target = round.players[4];
  target.position.x = ARENA.halfWidth - 0.75;
  const { attack } = fire(round);
  for (let tick = 0; tick < 600; tick += 1) updateRound(round, FIXED_STEP);
  assert.equal(target.health, 80);
  assert.ok(target.position.x > ARENA.halfWidth);
  assert.ok(target.position.z < ARENA.fallHeight);
  assert.equal(target.eliminated, true);
  assert.equal(attack.hits.filter((hit) => hit.playerIndex === 4).length, 1);
});
