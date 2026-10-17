import Mexp from "math-expression-evaluator";

export const DOMAIN_START = -24;
export const DOMAIN_END = 24;
export const SAMPLE_COUNT = 960;
export const COMBAT_Z = 0.5;

const parser = new Mexp();
parser.math.isDegree = false;
parser.addToken([
  { token: "x", show: "x", type: Mexp.TOKEN_TYPES.CONSTANT, value: "x" },
  ...["sqrt", "abs", "exp", "floor", "ceil", "round"].map((name) => ({
    token: name, show: name, type: Mexp.TOKEN_TYPES.FUNCTION_WITH_ONE_ARG, value: Math[name],
  })),
]);
const names = new Set([
  "x", "e", "pi", "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh", "sqrt", "root", "abs", "exp",
  "ln", "log", "floor", "ceil", "round",
]);

export const EQUATIONS = [
  { name: "y = x", evaluate: (x) => x, color: 0xffcd6b },
  { name: "y = x²", evaluate: (x) => x * x, color: 0xef95ed },
  { name: "y = sin(x)", evaluate: (x) => Math.sin(x), color: 0x76e5c0 },
];

export function parseEquation(input) {
  const expression = input.trim();
  if (!expression) throw new Error("Enter an expression for f(x).");
  if (expression.length > 200) throw new Error("Keep the expression under 200 characters.");
  if (!/^[0-9a-z+\-*/^().\s]+$/.test(expression)) {
    throw new Error("Use numbers, x, parentheses, powers, and supported math functions.");
  }
  for (const name of expression.match(/[a-z]+/g) || []) {
    if (!names.has(name)) throw new Error("Unknown name: " + name + ".");
  }
  let balance = 0;
  for (const character of expression) {
    if (character === "(") balance += 1;
    if (character === ")") balance -= 1;
    if (balance < 0) throw new Error("Check the parentheses.");
  }
  if (balance !== 0) throw new Error("Check the parentheses.");

  let postfix;
  try {
    postfix = parser.toPostfix(parser.lex(expression));
    parser.postfixEval(postfix, { x: 0 }); // Also catch incomplete operator syntax.
  } catch {
    throw new Error("Invalid expression. Check the operators and function arguments.");
  }
  return {
    expression,
    name: "y = " + expression,
    color: 0xffcd6b,
    evaluate(x) {
      try {
        return parser.postfixEval(postfix, { x });
      } catch {
        return NaN;
      }
    },
  };
}

function sampleValue(equation, x) {
  const value = equation.evaluate(x);
  // Far-offscreen values are omitted, never rescaled or clamped into the arena.
  return Number.isFinite(value) && Math.abs(value) <= 1000 ? value : NaN;
}

export function sampleEquation(equation, origin) {
  const sections = [];
  let section = [];
  let previous = null;

  function finishSection() {
    if (section.length > 1) sections.push(section);
    section = [];
  }

  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    const x = DOMAIN_START + (DOMAIN_END - DOMAIN_START) * index / SAMPLE_COUNT;
    const y = sampleValue(equation, x);
    if (!Number.isFinite(y)) {
      finishSection();
      previous = null;
      continue;
    }
    if (previous) {
      const middleY = sampleValue(equation, (previous.x + x) / 2);
      // Avoid bridging poles, holes, or sharp jumps between finite samples.
      const gap = !Number.isFinite(middleY) || Math.abs(y - previous.y) > 8 ||
        Math.abs(middleY - (previous.y + y) / 2) > 0.1;
      if (gap) finishSection();
    }
    section.push({ x: origin.x + x, y: origin.y + y, z: COMBAT_Z });
    previous = { x, y };
  }
  finishSection();
  return sections;
}

export function buildPreview(expression, origin, direction = null) {
  try {
    const equation = parseEquation(expression);
    const sections = sampleEquation(equation, origin);
    if (!sections.length) throw new Error("No drawable real values in −24 ≤ x ≤ 24.");
    const path = direction === null ? null : getFiringPath(sections, origin, direction);
    return { equation, origin: { x: origin.x, y: origin.y }, sections, path, error: "" };
  } catch (error) {
    return { equation: null, sections: [], error: error.message };
  }
}

export function getFiringPath(sections, origin, direction) {
  for (const points of sections) {
    const start = points.findIndex((point) => Math.abs(point.x - origin.x) < 1e-8);
    if (start < 0) continue;
    // Reverse traversal for Red, not the equation's coordinates or its shape.
    const path = direction > 0 ? points.slice(start) : points.slice(0, start + 1).reverse();
    if (path.length < 2) break;
    return path;
  }
  throw new Error("No continuous firing path from local x = 0 in this direction.");
}
