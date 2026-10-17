import test from "node:test";
import assert from "node:assert/strict";
import {
  COMBAT_Z, DOMAIN_START, DOMAIN_END, SAMPLE_COUNT,
  parseEquation, sampleEquation, buildPreview,
} from "../src/equations.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10);

test("all three requested expressions evaluate against independent calculations", () => {
  const examples = [
    ["(x-1)^2 + 1", (x) => (x - 1) ** 2 + 1],
    ["e^x", Math.exp],
    ["2sin(1/2 x) - 1", (x) => 2 * Math.sin(0.5 * x) - 1],
  ];
  for (const [text, expected] of examples) {
    const equation = parseEquation(text);
    for (const x of [-3, -1, 0, 1, 2, Math.PI]) close(equation.evaluate(x), expected(x));
    const preview = buildPreview(text, { x: -2, y: 0 });
    assert.equal(preview.error, "");
    assert.ok(preview.sections.length > 0);
    for (const section of preview.sections) {
      for (const point of section) {
        close(point.y, expected(point.x + 2));
        assert.equal(point.z, COMBAT_Z);
      }
    }
  }
});

test("radians, constants, common functions, and implicit multiplication work", () => {
  for (const [text, x, expected] of [
    ["sin(pi/2)", 0, 1], ["cos(pi)", 0, -1], ["tan(pi/4)", 0, 1],
    ["sqrt(abs(x)) + ln(e) + log(100)", -4, 5],
    ["2(x+1)", 3, 8], ["x(x-1)", 3, 6], ["exp(x)", 1, Math.E],
  ]) close(parseEquation(text).evaluate(x), expected);
});

test("sampling preserves the bounded domain, real shape, and offsets", () => {
  const origin = { x: 3, y: -2 };
  const equation = parseEquation("(x-1)^2 + 1");
  const sections = sampleEquation(equation, origin);
  assert.equal(sections.length, 1);
  const points = sections[0];
  assert.equal(points.length, SAMPLE_COUNT + 1);
  assert.equal(points[0].x, origin.x + DOMAIN_START);
  assert.equal(points.at(-1).x, origin.x + DOMAIN_END);
  assert.deepEqual(points.find((p) => p.x === 4), { x: 4, y: -1, z: COMBAT_Z });
  assert.deepEqual(points.find((p) => p.x === 3), { x: 3, y: 0, z: COMBAT_Z });
});

test("translating the caster translates the preview without changing its shape", () => {
  const a = buildPreview("2sin(1/2 x) - 1", { x: 0, y: 0 });
  const b = buildPreview("2sin(1/2 x) - 1", { x: 2, y: -3 });
  a.sections[0].forEach((point, index) => {
    close(b.sections[0][index].x - point.x, 2);
    close(b.sections[0][index].y - point.y, -3);
  });
});

test("invalid input reports errors instead of escaping or crashing", () => {
  for (const text of ["", "(x+1", "x+)", "2+", "sin()", "foo(x)", "y", "x=2",
    "globalThis", "alert(1)", "Sigma(1,999999,n)", "999999!", "x".repeat(201)]) {
    const preview = buildPreview(text, { x: 0, y: 0 });
    assert.ok(preview.error, text);
    assert.equal(preview.equation, null);
    assert.deepEqual(preview.sections, []);
  }
});

test("partial domains skip undefined samples and fully undefined equations are rejected", () => {
  const preview = buildPreview("sqrt(x)", { x: 0, y: 0 });
  assert.equal(preview.error, "");
  assert.ok(preview.sections.flat().every((point) => point.x >= 0 && Number.isFinite(point.y)));
  assert.ok(buildPreview("sqrt(-1)", { x: 0, y: 0 }).error);
  assert.ok(buildPreview("1/(x-x)", { x: 0, y: 0 }).error);
});

test("reciprocal poles, including between-sample poles, create separate branches", () => {
  for (const pole of [0, 0.023]) {
    const preview = buildPreview("1/(x-" + pole + ")", { x: 0, y: 0 });
    assert.equal(preview.error, "");
    assert.ok(preview.sections.length >= 2);
    for (const section of preview.sections) {
      assert.ok(section.every((point) => point.x < pole) ||
        section.every((point) => point.x > pole));
    }
  }
});

test("tangent asymptotes and floor steps are not joined by line segments", () => {
  const tangent = buildPreview("tan(x)", { x: 0, y: 0 });
  for (const section of tangent.sections) {
    for (let i = 1; i < section.length; i += 1) {
      const a = Math.floor((section[i - 1].x + Math.PI / 2) / Math.PI);
      const b = Math.floor((section[i].x + Math.PI / 2) / Math.PI);
      assert.equal(a, b);
    }
  }
  const steps = buildPreview("floor(x)", { x: 0, y: 0 });
  assert.ok(steps.sections.length > 1);
  for (const section of steps.sections) {
    assert.ok(section.every((point) => point.y === section[0].y));
  }
});
