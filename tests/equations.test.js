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
        close(point.y, expected(point.x + 2) - expected(0));
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
  const line = sampleEquation(parseEquation("x"), origin)[0];
  assert.equal(line.length, SAMPLE_COUNT + 1);
  assert.equal(line[0].x, origin.x + DOMAIN_START);
  assert.equal(line.at(-1).x, origin.x + DOMAIN_END);
  // The enlarged domain reaches values above the existing |f(x)| <= 1000 cap.
  assert.ok(points.length < line.length);
  assert.ok(points.every((point) => point.y - origin.y <= 1000));
  assert.ok(equation.evaluate(points[0].x - origin.x - 0.05) > 1000);
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
      assert.ok(section.every((point) => point.x + preview.anchor.x < pole) ||
        section.every((point) => point.x + preview.anchor.x > pole));
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


test("all anchor examples preserve shape in both firing directions and retain the input", () => {
  const origin = { x: -7.3, y: 2.4 };
  for (const [text, translated] of [
    ["6", () => 0], ["x+6", (x) => x], ["e^x", (x) => Math.exp(x) - 1],
    ["(x-1)^2 + 1", (x) => (x - 1) ** 2 - 1],
    ["2sin(1/2 x) - 1", (x) => 2 * Math.sin(x / 2)], ["10000", () => 0],
  ]) {
    for (const direction of [1, -1]) {
      const preview = buildPreview(text, origin, direction);
      assert.equal(preview.error, "", text);
      assert.equal(preview.equation.expression, text);
      assert.deepEqual(preview.path[0], { ...origin, z: COMBAT_Z });
      for (const point of preview.path) {
        close(point.y - origin.y, translated(point.x - origin.x));
        assert.ok(direction * (point.x - origin.x) >= -1e-10);
      }
    }
  }
});

test("horizontal shifts retain their shape and vertex while anchoring both teams", () => {
  const origin = { x: -3.2, y: 1.7 };
  for (const [expression, shifted, vertexX] of [
    ["(x-2)^2+6", (x) => (x - 2) ** 2 - 4, 2],
    ["(x+2)^2-3", (x) => (x + 2) ** 2 - 4, -2],
    ["sin(x-1)", (x) => Math.sin(x - 1) - Math.sin(-1), null],
  ]) {
    for (const direction of [1, -1]) {
      const preview = buildPreview(expression, origin, direction);
      assert.equal(preview.error, "");
      assert.deepEqual(preview.path[0], { ...origin, z: COMBAT_Z });
      for (const point of preview.path) close(point.y - origin.y, shifted(point.x - origin.x));
      if (vertexX !== null) {
        const vertex = preview.sections.flat().find((point) => Math.abs(point.x - origin.x - vertexX) < 1e-8);
        assert.ok(vertex);
        close(vertex.y - origin.y, -4);
      }
    }
  }
});

test("undefined zero uses the first finite sample in the firing direction, translating X and Y", () => {
  const origin = { x: 3.1, y: -1.7 };
  for (const [text, direction, expectedX] of [
    ["1/x", 1, 0.05], ["1/x", -1, -0.05], ["ln(x)", 1, 0.05],
    ["sqrt(x-1)", 1, 1], ["sqrt(-x-1)", -1, -1],
    ["sqrt(x-1)", -1, 32], ["ln(-x)", 1, -32],
  ]) {
    const preview = buildPreview(text, origin, direction);
    assert.equal(preview.error, "", text);
    close(preview.anchor.x, expectedX);
    assert.deepEqual(preview.path[0], { ...origin, z: COMBAT_Z });
    assert.ok(preview.path.length > 1, "A steep continuous launch must not become an artificial gap.");
    for (const point of preview.path) {
      const originalX = point.x - origin.x + preview.anchor.x;
      close(point.y - origin.y, preview.equation.evaluate(originalX) - preview.anchor.y);
    }
  }
});

test("single-point real branches may fire, while no real launch point reports an error", () => {
  for (const text of ["sqrt(0-x^2)", "sqrt(x)"]) {
    const preview = buildPreview(text, { x: 0, y: 0 }, -1);
    assert.equal(preview.error, "");
    assert.equal(preview.path.length, 1);
  }
  for (const text of ["sqrt(-1)", "1/(x-x)", "sqrt(x-33)"]) {
    assert.match(buildPreview(text, { x: 0, y: 0 }).error, /No finite launch point/);
  }
});
