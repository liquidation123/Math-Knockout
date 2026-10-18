import test from "node:test";
import assert from "node:assert/strict";
import { convertLatexToAsciiMath } from "../node_modules/mathlive/mathlive-ssr.min.mjs";
import { tidyAsciiMath } from "../src/math-text.js";
import { parseEquation } from "../src/equations.js";

// What the game sees when a player types into a math box: LaTeX → ASCII → tidy → parser.
function equationFromMathBox(latex) {
  return parseEquation(tidyAsciiMath(convertLatexToAsciiMath(latex)));
}

test("Desmos-style math boxes produce equations the parser evaluates correctly", () => {
  const cases = [
    ["x^{2}", 3, 9],
    ["x^{10}", 2, 1024],
    ["\\frac{1}{x+1}", 1, 0.5],
    ["\\left|x\\right|", -4, 4],
    ["2\\left|x-1\\right|+\\left|x\\right|", -1, 5],
    ["\\sqrt{x}", 9, 3],
    ["\\sqrt[3]{x}", 8, 2],
    ["\\arctan\\left(x\\right)", 1, Math.PI / 4],
    ["2\\sin\\left(x\\right)", Math.PI / 2, 2],
    ["x\\cdot x", 5, 25],
    ["e^{-x}", 0, 1],
  ];
  for (const [latex, x, expected] of cases) {
    assert.ok(Math.abs(equationFromMathBox(latex).evaluate(x) - expected) < 1e-9, latex);
  }
});

test("tidyAsciiMath rewrites bars, nth roots and arc functions", () => {
  assert.equal(tidyAsciiMath("2 |x-1| + |x|"), "2abs(x-1)+abs(x)");
  assert.equal(tidyAsciiMath("root(3)(x+1)"), "(x+1)^(1/(3))");
  assert.equal(tidyAsciiMath("arcsin (x)"), "asin(x)");
});
