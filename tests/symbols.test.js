import test from "node:test";
import assert from "node:assert/strict";
import { compileExpression, parseEquation } from "../src/equations.js";

test("Greek symbols, textual constants, and implicit multiplication use radians", () => {
  assert.equal(parseEquation("sin(π/2)").evaluate(0), 1);
  assert.equal(parseEquation("2π").evaluate(0), 2 * Math.PI);
  for (const name of ["θ", "theta"]) {
    assert.ok(Math.abs(compileExpression("3cos(" + name + ")", ["theta"]).evaluate({ theta: Math.PI }) + 3) < 1e-10);
  }
  assert.equal(compileExpression("2sin(t)", ["t"]).evaluate({ t: Math.PI / 2 }), 2);
  assert.equal(compileExpression("x^2+y^2", ["x", "y"]).evaluate({ x: 3, y: 4 }), 25);
  assert.throws(() => parseEquation("theta"), /Unknown name/);
  assert.throws(() => compileExpression("window.alert(1)"), /Unknown name/);
});
