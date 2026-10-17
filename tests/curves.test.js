import test from "node:test";
import assert from "node:assert/strict";
import { createCurveModel, previewCurveModel } from "../src/curves.js";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const origin = { x: -4, y: 2 };
const parametric = (extra = {}) => ({ type: "parametric", x: "3cos(t)", y: "3sin(t)", start: "0", end: "2π", ...extra });

test("parametric circle anchors at shooter and closes after one interval", () => {
  const model = createCurveModel(parametric());
  const preview = previewCurveModel(model, origin);
  assert.equal(model.branches[0].closed, true);
  assert.deepEqual(preview.path[0], { ...origin, z: 0.5 });
  assert.deepEqual(preview.path.at(-1), preview.path[0]);
  close(preview.path[320].x, -7);
  close(preview.path[320].y, 5);
  const clockwise = previewCurveModel(createCurveModel(parametric({ end: "-2pi" })), origin);
  assert.ok(clockwise.path[1].y < origin.y);
});

test("polar Greek and text inputs agree, including implicit multiplication", () => {
  const make = (radius, end) => createCurveModel({ type: "polar", radius, start: "0", end });
  const greek = make("3cos(θ)", "2π");
  const text = make("3cos(theta)", "2pi");
  assert.deepEqual(greek.branches, text.branches);
  close(greek.branches[0].points[320].x, 0);
  close(greek.branches[0].points[320].y, 0);
});

test("repeated circle intervals stop on the first loop, not the second", () => {
  const twice = createCurveModel(parametric({ end: "4π" }));
  assert.equal(twice.branches[0].closed, true);
  assert.ok(twice.branches[0].points.length < 700);
  const polar = createCurveModel({ type: "polar", radius: "3cos(θ)", start: "0", end: "2π" });
  assert.equal(polar.branches[0].closed, true);
  assert.ok(polar.branches[0].points.length < 700);
});

test("parameter start and reversed traversal preserve transformations", () => {
  const model = createCurveModel(parametric({ x: "t+5", y: "(t-1)^2", start: "2", end: "-2" }));
  const preview = previewCurveModel(model, origin);
  close(preview.path.at(-1).x, origin.x - 4);
  close(preview.path.at(-1).y, origin.y + 8);
  assert.ok(preview.path[1].x < origin.x);
});

test("parameter poles stop the path; invalid starts and bounds reject clearly", () => {
  const model = createCurveModel(parametric({ x: "t", y: "1/(t-1)", start: "0", end: "2" }));
  assert.ok(model.branches[0].points.at(-1).x < 1);
  assert.ok(model.warning);
  assert.throws(() => createCurveModel(parametric({ start: "1001" })), /bounds/);
  assert.throws(() => createCurveModel(parametric({ end: "0" })), /different bounds/);
  assert.throws(() => createCurveModel(parametric({ y: "ln(t)", start: "0" })), /undefined/);
});

test("explicit rational, exponential, logarithmic and root paths reuse anchoring", () => {
  for (const expression of ["sin(x)", "1/(x-2)", "(x-1)^2", "e^x", "ln(x)", "sqrt(x)"]) {
    const preview = previewCurveModel(createCurveModel({ type: "explicit", expression }), origin);
    assert.equal(preview.error, "", expression);
    close(preview.path[0].x, origin.x);
    close(preview.path[0].y, origin.y);
  }
});

test("parameter and polar polynomial, rational, exponential, log and root expressions", () => {
  for (const expression of ["t^2+1", "1/(t+2)", "2sin(t)", "e^t", "ln(t+1)", "sqrt(t+1)"]) {
    const model = createCurveModel(parametric({ x: "t", y: expression, start: "0", end: "1" }));
    assert.equal(model.branches[0].points.length, 1281, expression);
    const polar = createCurveModel({ type: "polar", radius: expression.replace(/\bt\b/g, "theta"), start: "0", end: "1" });
    assert.ok(polar.branches[0].points.length > 1000, expression);
  }
  const rootBreak = createCurveModel(parametric({ x: "t", y: "sqrt((t-0.3)*(t-0.6))", start: "0", end: "1" }));
  assert.ok(rootBreak.branches[0].points.at(-1).x <= 0.3);
  const pole = createCurveModel(parametric({ x: "t", y: "1/(t-1.001)", start: "0", end: "2" }));
  assert.ok(pole.branches[0].points.at(-1).x < 1.001);
});
