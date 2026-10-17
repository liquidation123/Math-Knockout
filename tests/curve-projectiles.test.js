import test from "node:test";
import assert from "node:assert/strict";
import { createCurveModel, previewCurveModel } from "../src/curves.js";
import { createAttack, updateProjectile, PROJECTILE_SPEED, DAMAGE, KNOCKBACK, RECOIL } from "../src/projectile.js";
import { createPlayer } from "../src/physics.js";
import { createRound, firePreview } from "../src/combat.js";
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const requests = [
  { type: "explicit", expression: "0" },
  { type: "parametric", x: "t", y: "0", start: "0", end: "32" },
  { type: "polar", radius: "theta", start: "0", end: "0.2" },
  { type: "implicit", expression: "y=0" },
];

test("all equation types fire an exact frozen copy of their translated preview", () => {
  for (const request of requests) {
    const round = createRound();
    const index = round.selected[0];
    const shooter = round.players[index];
    shooter.position = { x: -10, y: 0, z: 0.5 };
    const model = createCurveModel(request);
    const preview = previewCurveModel(model, shooter.position, 1, { cardinal: "left" });
    const expectedPath = structuredClone(preview.path);
    assert.equal(firePreview(round, index, preview, 2), true);
    const attack = round.attack;
    assert.deepEqual(attack.path, expectedPath);
    close(attack.position.x, -10);
    close(attack.position.y, 0);
    close(Math.hypot(shooter.velocity.x, shooter.velocity.y), 2 * RECOIL);
    const velocity = { ...shooter.velocity };
    assert.equal(firePreview(round, index, preview, 3), false);
    assert.deepEqual(shooter.velocity, velocity);
    preview.path[0].x = 999;
    shooter.position.x = 9;
    assert.deepEqual(attack.path, expectedPath);
    assert.equal(attack.force, 2);
  }
});

test("parametric, polar and implicit circles terminate after one loop", () => {
  const circles = [
    { type: "parametric", x: "0.5cos(t)", y: "0.5sin(t)", start: "0", end: "4π" },
    { type: "polar", radius: "0.5", start: "0", end: "4π" },
    { type: "implicit", expression: "x^2+y^2=0.25" },
  ];
  for (const request of circles) for (const direction of ["forward", "reverse"]) {
    const players = [createPlayer("Blue", 0, 0, 0.5, 0), createPlayer("Red", 10, 0, 0.5, 1)];
    const preview = previewCurveModel(createCurveModel(request), players[0].position, 1, { cardinal: "right", direction });
    assert.deepEqual(preview.path[0], preview.path.at(-1));
    const length = preview.path.reduce((sum, point, index) => index === 0 ? 0 : sum +
      Math.hypot(point.x - preview.path[index - 1].x, point.y - preview.path[index - 1].y), 0);
    close(length, Math.PI, 0.03);
    const attack = createAttack(0, players, preview.equation, 0, preview);
    updateProjectile(attack, players, (length - 0.01) / PROJECTILE_SPEED);
    assert.equal(attack.stopped, false);
    updateProjectile(attack, players, 0.02);
    assert.equal(attack.reason, "End of continuous curve");
    close(attack.position.x, 0);
    close(attack.position.y, 0);
    assert.ok(players.every((player) => player.health === 100));
  }
});

test("new trajectories retain piercing, force and travel-ordered wall collisions", () => {
  for (const request of [
    { type: "parametric", x: "t", y: "0", start: "0", end: "20" },
    { type: "implicit", expression: "y=0" },
  ]) {
    const players = [createPlayer("Blue", -7, 4, 0.5, 0),
      ...[-6, -5, 7].map((x) => createPlayer("Red", x, 4, 0.5, 1))];
    const preview = previewCurveModel(createCurveModel(request), players[0].position, 1, { cardinal: "left" });
    const attack = createAttack(0, players, preview.equation, 0, preview, 2);
    updateProjectile(attack, players, 3);
    assert.equal(attack.reason, "Obstacle");
    assert.deepEqual(attack.hits.map((hit) => hit.playerIndex), [1, 2]);
    assert.deepEqual(players.map((player) => player.health), [100, 100 - DAMAGE, 100 - DAMAGE, 100]);
    close(players[1].velocity.x, KNOCKBACK * 2);
    close(players[2].velocity.x, KNOCKBACK * 2);
    close(attack.position.x, -4.12);
    updateProjectile(attack, players, 3);
    assert.equal(players[1].health, 100 - DAMAGE);
  }
});
