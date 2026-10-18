import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createCurveModel, previewCurveModel } from "../src/curves.js";
import { projectilePlan } from "../src/attack-paths.js";
import { createAttack, updateProjectile } from "../src/projectile.js";
import { createPlayer } from "../src/physics.js";

const source = (await readFile(new URL("../src/curve-input.js", import.meta.url), "utf8"))
  .replace(/^import .+;\n/gm, "").replace("export function", "function");
function setup() {
  const nodes = new Map();
  const field = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: "0", textContent: "", addEventListener() {} });
    return nodes.get(id);
  };
  field("equation-type").value = "explicit";
  const input = runInNewContext(source + "\ncreateEquationInput(() => {});", {
    document: { getElementById: field, querySelectorAll: () => [] },
    createCurveModel, previewCurveModel, projectilePlan,
  });
  return { input, field };
}

test("real equation input retains rational text and fires finite moving branches for both teams", () => {
  const { input, field } = setup();
  for (const direction of [1, -1]) for (const expression of ["1/x", "1/(x-2)", "(x+1)/(x^2+1)"]) {
    field("expression").value = expression;
    const origin = { x: direction === 1 ? -8 : 8, y: 0 };
    const preview = input.preview(origin, direction);
    assert.equal(preview.error, "");
    assert.equal(field("expression").value, expression, "Input must not reset to zero");
    assert.equal(preview.equation.expression, expression);
    if (expression === "1/x") {
      assert.equal(preview.anchor.x, direction);
      assert.match(field("curve-note").textContent, /expression is unchanged/);
    } else assert.equal(preview.anchor.x, 0, "Defined-zero anchors remain unchanged");
    const players = [createPlayer("Shooter", origin.x, origin.y, 0.5, direction === 1 ? 0 : 1)];
    const attack = createAttack(0, players, preview.equation, 0, preview);
    updateProjectile(attack, players, 0.05);
    assert.equal(attack.bullets[0].stopped, false, "Clear launch must not disappear immediately");
    assert.ok((attack.position.x - origin.x) * direction > 0.1);
    assert.ok(Number.isFinite(attack.position.y));
    assert.equal(field("expression").value, expression);
  }
});

test("player discrete-dot fields use the same model and validation as AI", () => {
  const { input, field } = setup();
  field("equation-type").value = "dots";
  field("dots-expression").value = "0.1*x";
  field("dots-extra-x").value = "-3.25";
  const origin = { x: 8, y: 0 };
  const preview = input.preview(origin, -1);
  const ai = previewCurveModel(createCurveModel({ type: "dots", expression: "0.1*x", direction: -1, targetX: -3.25 }), origin, -1);
  assert.deepEqual(preview.travelSections, ai.travelSections);
  assert.ok(preview.sections.every((section) => section.length === 1));
  field("dots-extra-x").value = "5";
  assert.match(input.preview(origin, -1).error, /firing direction/);
});
