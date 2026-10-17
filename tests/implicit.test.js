import test from "node:test";
import assert from "node:assert/strict";
import { traceImplicit, implicitPath, IMPLICIT_STEP } from "../src/implicit-curves.js";
import { previewCurveModel } from "../src/curves.js";
const circle = traceImplicit("(x-2)^2 + (y+1)^2 = 4");

test("translated circle is a closed contour with accurate samples and extrema", () => {
  assert.equal(circle.branches.length, 1);
  assert.equal(circle.branches[0].closed, true);
  for (const point of circle.branches[0].points) {
    assert.ok(Math.abs(Math.hypot(point.x - 2, point.y + 1) - 2) < 1e-5);
  }
  const chosen = implicitPath(circle, { cardinal: "right" });
  assert.ok(Math.abs(chosen.anchor.x - 4) < 1e-5);
  assert.ok(Math.abs(chosen.anchor.y + 1) < 1e-5);
});

test("closed loops anchor at chosen point, traverse CW or CCW once, and keep shape", () => {
  const origin = { x: -3, y: 0 };
  const ccw = previewCurveModel(circle, origin, 1, { cardinal: "right", direction: "forward" });
  const cw = previewCurveModel(circle, origin, 1, { cardinal: "right", direction: "reverse" });
  assert.deepEqual(ccw.path[0], { ...origin, z: 0.5 });
  assert.deepEqual(ccw.path.at(-1), ccw.path[0]);
  assert.ok(ccw.path[1].y > origin.y);
  assert.ok(cw.path[1].y < origin.y);
  assert.equal(ccw.path.length, circle.branches[0].points.length);
  for (const point of ccw.path) assert.ok(Math.abs(Math.hypot(point.x + 5, point.y) - 2) < 1e-5);
});

test("disconnected hyperbola branches never jump, and user can choose either", () => {
  const model = traceImplicit("x*y = 1");
  assert.equal(model.branches.length, 2);
  for (let branch = 0; branch < 2; branch += 1) {
    const chosen = implicitPath(model, { branch, start: 10, cardinal: "custom" });
    assert.equal(chosen.closed, false);
    for (let index = 1; index < chosen.path.length; index += 1) {
      assert.ok(Math.hypot(chosen.path[index].x - chosen.path[index - 1].x,
        chosen.path[index].y - chosen.path[index - 1].y) < 2 * IMPLICIT_STEP);
    }
  }
  const forward = implicitPath(model, { branch: 0, start: 10 });
  const reverse = implicitPath(model, { branch: 0, start: 10, direction: "reverse" });
  assert.deepEqual(forward.path[0], reverse.path[0]);
  assert.notDeepEqual(forward.path[1], reverse.path[1]);
});

test("implicit F=0 and two sides agree; poles and invalid syntax do not invent curves", () => {
  assert.deepEqual(traceImplicit("x^2+y^2-9").branches, traceImplicit("x^2+y^2=9").branches);
  assert.throws(() => traceImplicit("1/(x-0.1234)"), /No traceable/);
  assert.throws(() => traceImplicit("floor(x)-0.5"), /No traceable/);
  assert.throws(() => traceImplicit("x=x"), /area/);
  assert.throws(() => traceImplicit("x=y=1"), /single equation/);
  assert.throws(() => traceImplicit("x="), /Enter/);
  assert.throws(() => traceImplicit("x^2+y^2+1"), /No traceable/);
});

test("general polynomial, trigonometric, log and root implicit contours are bounded", () => {
  for (const expression of ["y=x^2", "y=sin(x)", "y=ln(x)", "y=sqrt(x)", "(x^2+y^2-4)*(x^2+y^2-16)=0"]) {
    const model = traceImplicit(expression);
    assert.ok(model.branches.length > 0, expression);
    for (const branch of model.branches) for (const point of branch.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(Math.abs(point.x) <= 16 && Math.abs(point.y) <= 16);
    }
  }
});
