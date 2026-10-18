import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview, parseEquation } from "../src/equations.js";
import { buildCurvePreview } from "../src/curves.js";
import { projectilePlan } from "../src/attack-paths.js";
import { createAttack, updateProjectile, RECOIL, ATTACK_DURATION } from "../src/projectile.js";
import { createPlayer, FIXED_STEP } from "../src/physics.js";
import { createRound, firePreview, updateRound } from "../src/combat.js";
import { createDuel, lockEquation, launchDuel, updateDuel } from "../src/duel.js";
import { createProjectileCamera, aimProjectileCamera, createDotPreview } from "../src/scene.js";

const p = (x, y = 0) => ({ x, y, z: 0.5 });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture(paths, rational = false, team = 0) {
  const equation = parseEquation(rational ? "1/(x-2)" : "sqrt((x-1)*(x-2))");
  const players = [createPlayer("Shooter", paths[0][0].x, paths[0][0].y, 0.5, team)];
  const preview = { equation, origin: paths[0][0], path: paths[0], sections: paths,
    travelSections: paths, rationalSections: paths, error: "" };
  return { players, preview, attack: createAttack(0, players, equation, 0, preview) };
}

test("real rational asymptotes spawn translated branch bullets together in both directions", () => {
  for (const direction of [1, -1]) {
    const origin = p(-10 * direction);
    const preview = buildPreview(`0.3/(x-(${3 * direction}))`, origin, direction);
    assert.equal(preview.error, "");
    const plan = projectilePlan(preview);
    assert.equal(plan.mode, "parallel");
    assert.equal(plan.paths.length, 2);
    const players = [createPlayer("Shooter", origin.x, origin.y, 0.5, direction === 1 ? 0 : 1),
      createPlayer("Target", 0, direction * 0.143, 0.5, direction === 1 ? 1 : 0)];
    const attack = createAttack(0, players, preview.equation, 0, preview);
    assert.equal(attack.bullets.length, 2);
    attack.bullets.forEach((bullet, index) => assert.deepEqual(bullet.path, plan.paths[index]));
    for (const point of attack.paths[1]) {
      const x = point.x - origin.x;
      close(point.y, preview.equation.evaluate(x) - preview.equation.evaluate(0));
    }
    assert.notDeepEqual(attack.paths[1][0], origin, "Never re-anchor a later branch");
    const frozen = structuredClone(attack.paths);
    preview.travelSections[0][0].x = 999;
    players[0].position.x += 0.2;
    for (let i = 0; i < 600 && !attack.stopped; i += 1) updateProjectile(attack, players, FIXED_STEP);
    assert.equal(players[1].health, 80);
    assert.equal(attack.teleports.length, 0);
    assert.ok(attack.bullets.every((bullet) => bullet.stopped));
    assert.deepEqual(attack.paths, frozen);
  }
});

test("all rational branches are considered, including behind the anchor; empty branches are skipped", () => {
  const preview = buildPreview("0.3/(x+3)", p(-9), 1);
  assert.equal(projectilePlan(preview).paths.length, 2);
  const paths = [[p(0), p(1)], [p(2, 99), p(3, 99)], [p(4), p(5)]];
  const { attack } = fixture(paths, true);
  assert.equal(attack.bullets.length, 2);
  assert.deepEqual(attack.bullets[1].path[0], p(4));
});

test("rational recognition uses arithmetic structure, not just the slash character", () => {
  for (const expression of ["1/(x-2)", "(x+1)/(x^2+1)", "x^(-2)"]) assert.equal(parseEquation(expression).rational, true);
  for (const expression of ["x/3", "sin(x)/2", "1/exp(x)", "sqrt(x)"]) assert.equal(parseEquation(expression).rational, false);
});

test("non-rational gap teleports once, never hits a gap enemy or a gap wall, and checks arrival", () => {
  for (const direction of [1, -1]) {
    const paths = [[p(-8 * direction, 4), p(-7 * direction, 4)],
      [p(7 * direction, 4), p(10 * direction, 4)]];
    const { attack, players } = fixture(paths, false, direction === 1 ? 0 : 1);
    const enemyTeam = 1 - players[0].team;
    players.push(createPlayer("Gap enemy", 0, 4, 0.5, enemyTeam), createPlayer("Arrival", 7 * direction, 4, 0.5, enemyTeam));
    updateProjectile(attack, players, 0.15);
    assert.equal(attack.teleports.length, 1);
    assert.equal(players[1].health, 100);
    assert.equal(players[2].health, 80);
    assert.equal(attack.stopped, false, "Walls crossed only by the gap cannot block a teleport");
    assert.equal(attack.bullets[0].teleportCount, 1);
  }
});

test("arrival inside a wall stops immediately; a wall on travel never triggers a teleport", () => {
  const inside = fixture([[p(-8, 4), p(-7, 4)], [p(-3.6, 4), p(8, 4)]]);
  inside.players.push(createPlayer("Inside wall", -3.6, 4, 0.5, 1));
  updateProjectile(inside.attack, inside.players, 0.2);
  assert.equal(inside.attack.reason, "Obstacle");
  assert.equal(inside.attack.teleports.length, 1);
  assert.equal(inside.players[1].health, 100, "Wall takes priority over an overlapping enemy");
  close(inside.attack.position.x, -3.6);
  const blocked = fixture([[p(-8, 4), p(-2, 4)], [p(7, 4), p(9, 4)]]);
  updateProjectile(blocked.attack, blocked.players, 2);
  assert.equal(blocked.attack.reason, "Obstacle");
  assert.equal(blocked.attack.teleports.length, 0);
  close(blocked.attack.position.x, -4.12);
});

test("exiting the map never teleports back in; a gapless rational graph stays one bullet", () => {
  const out = fixture([[p(10), p(16)], [p(-8), p(-6)]]);
  updateProjectile(out.attack, out.players, 2);
  assert.equal(out.attack.reason, "Map boundary");
  assert.equal(out.attack.teleports.length, 0);
  const preview = buildPreview("1/(x^2+1)", p(-10), 1);
  assert.equal(projectilePlan(preview).paths.length, 1);
});

test("parallel bullets and repeated teleport arrivals share one hit and knockback per enemy", () => {
  for (const rational of [true, false]) {
    const { attack, players } = fixture([[p(-8), p(2)], [p(-6), p(2)], [p(-4), p(2)]], rational);
    players.push(createPlayer("Enemy", 0, 0, 0.5, 1));
    updateProjectile(attack, players, 4);
    assert.equal(players[1].health, 80);
    assert.equal(attack.hits.length, 1);
    close(players[1].velocity.x, 6.4);
    assert.equal(attack.hitEnemies.size, 1);
  }
});

test("recoil occurs once; all branch paths and force freeze; turn waits for slowest bullet plus pause", () => {
  const round = createRound(false, () => 0.5);
  const index = round.selected[0];
  round.players.forEach((player, i) => { player.position = p(i < 3 ? -9 : 9, i % 3 * 2 - 4); });
  const shooter = round.players[index];
  shooter.position = p(-8);
  const paths = [[p(-8), p(-7.5)], [p(-6), p(6)]];
  const { preview } = fixture(paths, true);
  assert.ok(firePreview(round, index, preview, 2));
  close(shooter.velocity.x, -2 * RECOIL);
  assert.equal(firePreview(round, index, preview, 3), false);
  const attack = round.attack, frozen = structuredClone(attack.paths);
  preview.path[0].y = 99;
  shooter.position.x += 0.1;
  updateRound(round, 0.1);
  assert.ok(attack.bullets[0].stopped);
  assert.equal(attack.stopped, false);
  assert.equal(round.currentTeam, 0);
  close(attack.force, 2);
  assert.deepEqual(attack.paths, frozen);
  for (let tick = 0; tick < 1000 && !attack.stopped; tick += 1) updateRound(round, FIXED_STEP);
  assert.equal(round.attack, attack);
  for (let tick = 0; tick < Math.ceil(ATTACK_DURATION / FIXED_STEP) + 2; tick += 1) updateRound(round, FIXED_STEP);
  assert.equal(round.currentTeam, 1);
  assert.equal(round.attack, null);
});

test("real parameter gaps are retained for bullets, while Bump characters never teleport", () => {
  const preview = buildCurvePreview({ type: "parametric", x: "t", y: "sqrt((t-1)*(t-2))", start: "0", end: "4" }, p(-6), 1);
  assert.equal(preview.error, "");
  assert.equal(projectilePlan(preview).mode, "teleport");
  const duel = createDuel();
  duel.players[0].position = p(-6);
  lockEquation(duel, 0, { type: "parametric", x: "t", y: "sqrt((t-1)*(t-2))", start: "0", end: "4" });
  lockEquation(duel, 1, "0"); launchDuel(duel);
  for (let tick = 0; tick < 120; tick += 1) {
    const before = { ...duel.players[0].position };
    updateDuel(duel, FIXED_STEP);
    assert.ok(Math.hypot(duel.players[0].position.x - before.x, duel.players[0].position.y - before.y) < 0.1);
  }
  assert.deepEqual(duel.paths[0].points, preview.path);
});

test("camera remains with the anchored bullet and cuts level to a teleport destination", () => {
  const { attack, players } = fixture([[p(-8), p(-7)], [p(7), p(9)]]);
  const camera = createProjectileCamera();
  aimProjectileCamera(camera, attack.bullets[0]);
  const before = camera.position.x;
  updateProjectile(attack, players, 0.11);
  aimProjectileCamera(camera, attack.bullets[0]);
  assert.ok(camera.position.x - before > 14);
  close(camera.position.z, 0.5);
  assert.deepEqual(camera.up.toArray(), [0, 0, 1]);
});

test("the last elimination waits for all projectiles and the impact pause before victory", () => {
  const round = createRound(false, () => 0.5);
  round.players.forEach((player, index) => {
    player.position = p(index < 3 ? -8 : -6);
    player.eliminated = index >= 3 && index !== 3;
  });
  round.players[3].health = 20;
  const paths = [[p(-8), p(-5)], [p(0), p(10)]];
  const { preview } = fixture(paths, true);
  assert.ok(firePreview(round, round.selected[0], preview));
  const attack = round.attack;
  updateRound(round, 0.2);
  assert.equal(round.players[3].eliminated, true);
  assert.equal(round.result, null);
  while (!attack.stopped) updateRound(round, FIXED_STEP);
  assert.equal(round.result, null);
  for (let tick = 0; tick < 90; tick += 1) updateRound(round, FIXED_STEP);
  assert.equal(round.result.winner, "Blue");
});

test("discrete dots have no traversed segments, keep speed-based timing, and hit only destinations", () => {
  for (const direction of [1, -1]) {
    const origin = p(-8 * direction);
    const players = [createPlayer("Shooter", origin.x, 0, 0.5, direction === 1 ? 0 : 1),
      createPlayer("Gap", origin.x + direction, 0, 0.5, direction === 1 ? 1 : 0),
      createPlayer("Dot", origin.x + direction * 2, 0, 0.5, direction === 1 ? 1 : 0)];
    const preview = buildCurvePreview({ type: "dots", expression: "0" }, origin, direction);
    assert.ok(preview.sections.every((section) => section.length === 1));
    const attack = createAttack(0, players, preview.equation, 0, preview);
    assert.equal(attack.bullets.length, 1);
    updateProjectile(attack, players, 0.19);
    assert.equal(attack.teleports.length, 0);
    assert.equal(attack.bullets[0].inGap, true);
    close(attack.position.x, origin.x);
    assert.equal(players[1].health, 100);
    updateProjectile(attack, players, 0.011);
    assert.equal(attack.teleports.length, 1);
    assert.equal(players[1].health, 100);
    assert.equal(players[2].health, 80);
    close(attack.position.x, origin.x + direction * 2);
    const camera = createProjectileCamera();
    aimProjectileCamera(camera, attack.bullets[0]);
    assert.ok((attack.position.x - camera.position.x) * direction > 0, "Camera looks toward the next dot");
  }
});

test("players and Dot AI use identical domains, previews, force, recoil and arrival collisions", () => {
  for (const direction of [1, -1]) {
    const origin = p(-8 * direction);
    const ai = buildCurvePreview({ type: "dots", expression: "0.1*x", targetX: 3.25 * direction }, origin, direction);
    const human = buildCurvePreview({ type: "dots", expression: "0.1*x", extra: String(3.25 * direction) }, origin, direction);
    assert.deepEqual(human.travelSections, ai.travelSections);
    const players = [createPlayer("Shooter", origin.x, origin.y, 0.5, direction === 1 ? 0 : 1)];
    const first = createAttack(0, players, ai.equation, 0, ai, 1.8);
    const second = createAttack(0, structuredClone(players), human.equation, 0, human, 1.8);
    assert.deepEqual(first.paths, second.paths);
    assert.equal(first.force, second.force);
    assert.ok(first.paths.some((path) => Math.abs(path[0].x - origin.x - 3.25 * direction) < 1e-8));
    assert.ok(buildCurvePreview({ type: "dots", expression: "0", extra: String(-direction) }, origin, direction).error);
  }
});

test("isolated-dot jumps ignore a gap wall but a destination in a wall stops the whole shot", () => {
  for (const destination of [p(7, 4), p(-3.6, 4)]) {
    const paths = [[p(-8, 4)], [destination], [p(10, 4)]];
    const { preview, players } = fixture(paths);
    preview.dots = true;
    const attack = createAttack(0, players, preview.equation, 0, preview);
    players.push(createPlayer("Enemy", 10, 4, 0.5, 1));
    updateProjectile(attack, players, 3);
    if (destination.x === -3.6) {
      assert.equal(attack.reason, "Obstacle");
      assert.equal(attack.teleports.length, 1);
      assert.equal(players[1].health, 100);
    } else {
      assert.equal(attack.reason, "End of discrete curve");
      assert.equal(attack.teleports.length, 2);
      assert.equal(players[1].health, 80);
    }
  }
});

test("dot preview contains visible point markers and no line or connector geometry", () => {
  const paths = [[p(0)], [p(2, 1)], [p(4, 3)]];
  const group = createDotPreview(paths);
  assert.equal(group.children.length, paths.length);
  group.children.forEach((dot, index) => {
    assert.equal(dot.isMesh, true);
    assert.deepEqual(dot.position.toArray(), [paths[index][0].x, paths[index][0].y, 0.5]);
    assert.equal(dot.material.transparent, true, "Aiming points render after transparent scenery");
    assert.equal(dot.material.depthTest, false);
    dot.geometry.dispose(); dot.material.dispose();
  });
});
