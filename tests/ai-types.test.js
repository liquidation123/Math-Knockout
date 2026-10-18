import test from "node:test";
import assert from "node:assert/strict";
import { AI_TYPES, typeEquations, actionPreview, equationText } from "../src/ai-types.js";
import { AI_LEVELS, chooseProjectileAction, chooseBumpAction, projectileCandidates, publicBumpState } from "../src/ai.js";
import { createRound, firePreview, selectCharacter } from "../src/combat.js";
import { createDuel, lockEquation } from "../src/duel.js";
import { buildCurvePreview } from "../src/curves.js";
import { projectilePlan } from "../src/attack-paths.js";

const options = { random: () => 0.5, pause: async () => {} };
function arena() {
  const round = createRound(false, () => 0.5);
  round.currentTeam = 1;
  round.players.forEach((player, index) => {
    player.position = { x: index < 3 ? -9 : 9, y: index % 3 - 1, z: 0.5 };
  });
  return round;
}

for (const type of Object.keys(AI_TYPES)) for (const difficulty of Object.keys(AI_LEVELS)) {
  test(`${type} / ${difficulty}: legal bounded Projectile${type === "dot" ? "-only" : " and independent Bump"} choices`, async () => {
    const round = arena(), before = structuredClone(round);
    let yields = 0;
    const action = await chooseProjectileAction(round, difficulty, { ...options, type, pause: async () => { yields += 1; } });
    assert.ok(action, "No valid projectile action");
    assert.ok(yields <= AI_LEVELS[difficulty].projectileLimit);
    const preview = actionPreview(action, round.players[action.playerIndex].position, -1);
    assert.equal(preview.error, "");
    assert.deepEqual(round, before, "AI evaluation must not change the real round");
    assert.ok(selectCharacter(round, action.playerIndex));
    assert.ok(firePreview(round, action.playerIndex, preview, action.force));
    if (type === "dot") assert.equal(round.attack.bullets.length, 1);
    if (type === "dot") return;
    const duel = createDuel();
    const guarded = new Proxy(duel, { get(state, key) {
      assert.equal(key, "players", "AI accessed hidden Bump information");
      return state.players;
    } });
    const choice = await chooseBumpAction(publicBumpState(guarded), difficulty, { ...options, type });
    assert.ok(choice);
    const aim = buildCurvePreview(choice, duel.players[1].position, -1);
    assert.equal(lockEquation(duel, 1, choice), "");
    assert.equal(duel.locked[0], false);
    assert.deepEqual(duel.paths[1].points, aim.path, "Bump uses only the continuous launch branch");
    assert.ok(equationText(choice).length > 0);
  });
}

test("specialized templates have real family shapes, in both directions; Normal includes all formats", () => {
  for (const direction of [-1, 1]) for (const mode of ["bump", "projectile"]) {
    const origin = { x: direction > 0 ? -9 : 9, y: 0 }, target = { x: -origin.x, y: 1 };
    for (const type of Object.keys(AI_TYPES)) {
      if (type === "dot" && mode === "bump") continue;
      const inputs = typeEquations(origin, target, direction, type, "hard", mode, () => 0.5);
      for (const input of inputs) {
        const preview = buildCurvePreview(input, origin, direction);
        assert.equal(preview.error, "", JSON.stringify(input));
        assert.ok(Math.abs(preview.path[0].x - origin.x) < 1e-8);
        assert.ok(Math.abs(preview.path[0].y - origin.y) < 1e-8);
        if (type === "parametric" || type === "polar") assert.equal(input.type, type);
        if (type === "dot") {
          assert.ok(preview.sections.length > 1);
          assert.ok(preview.sections.every((section) => section.length === 1));
          assert.equal(preview.equation.rational, false);
        }
        if (type === "rational") assert.equal(preview.equation.rational, true);
        if (type === "absolute" || type === "trig") {
          const equation = preview.equation;
          const a = equation.evaluate(0), b = equation.evaluate(direction * 4), c = equation.evaluate(direction * 12);
          assert.ok(Math.abs((b - a) / 4 - (c - a) / 12) > 0.01, "Shape must not simplify to a line");
        }
      }
      if (type === "normal") {
        for (const format of ["parametric", "polar", "implicit"]) assert.ok(inputs.some((input) => input.type === format));
        for (const family of ["abs(", "sin(", "/(x-", "exp(", "ln(", "sqrt("]) assert.ok(inputs.some((input) => typeof input === "string" && input.includes(family)));
      }
    }
  }
});

test("Dot choices are isolated point domains, never rational curves; typed searches cancel at a yield", async () => {
  const round = arena();
  for (const action of projectileCandidates(round, "hard", () => 0.5, "dot")) {
    assert.equal(action.input.type, "dots");
    const preview = actionPreview(action, round.players[action.playerIndex].position, -1);
    assert.equal(preview.dots, true);
    assert.equal(preview.equation.rational, false);
    assert.equal(projectilePlan(preview).mode, "teleport");
  }
  assert.equal(await chooseBumpAction(publicBumpState(createDuel()), "hard", { type: "dot" }), null);
  let cancelled = false;
  const result = await chooseProjectileAction(round, "hard", { type: "polar", cancelled: () => cancelled,
    pause: async () => { cancelled = true; } });
  assert.equal(result, null);
});

test("Polar AI candidates are complete circles or cardioids, never near-straight spirals", () => {
  for (const difficulty of Object.keys(AI_LEVELS)) for (const mode of ["bump", "projectile"]) {
    const inputs = typeEquations({ x: 9, y: 0 }, { x: -9, y: 2 }, -1, "polar", difficulty, mode, () => 0.5);
    for (const input of inputs) {
      assert.ok(/^\d/.test(input.radius));
      assert.ok(!input.radius.includes("theta") || input.radius.includes("1+cos(theta-"));
      const preview = buildCurvePreview(input, { x: 9, y: 0 }, -1);
      assert.equal(preview.error, "");
      assert.ok(Math.hypot(preview.path[0].x - preview.path.at(-1).x, preview.path[0].y - preview.path.at(-1).y) < 1e-7);
      const width = Math.max(...preview.path.map((point) => point.x)) - Math.min(...preview.path.map((point) => point.x));
      const depth = Math.max(...preview.path.map((point) => point.y)) - Math.min(...preview.path.map((point) => point.y));
      assert.ok(width > 5 && depth > 5, "A polar candidate must really bend");
    }
    if (difficulty !== "easy") assert.ok(inputs.some((input) => input.radius.includes("1+cos(theta-")));
  }
});
