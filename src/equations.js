import Mexp from "math-expression-evaluator";

export const DOMAIN_START = -32;
export const DOMAIN_END = 32;
export const SAMPLE_COUNT = 1280;
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
  return Number.isFinite(value) ? value : NaN;
}

export function sampleEquation(equation, origin, anchor = { x: 0, y: 0 }) {
  const sections = [];
  let section = [];
  let previous = null;

  function finishSection() {
    if (section.length) sections.push(section);
    section = [];
  }

  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    const x = DOMAIN_START + (DOMAIN_END - DOMAIN_START) * index / SAMPLE_COUNT;
    const y = sampleValue(equation, x) - anchor.y;
    // Apply the display limit after translation, so even y = 10000 anchors correctly.
    if (!Number.isFinite(y) || Math.abs(y) > 1000) {
      finishSection();
      previous = null;
      continue;
    }
    if (previous) {
      const middleY = sampleValue(equation, (previous.x + x) / 2) - anchor.y;
      // Poles overshoot both endpoint values; exact flat-to-flat changes mark steps.
      // A steep but monotone curve (such as 1/x near its anchor) stays connected.
      const error = Math.abs(middleY - (previous.y + y) / 2);
      const overshoot = middleY < Math.min(previous.y, y) || middleY > Math.max(previous.y, y);
      const step = Math.abs(y - previous.y) > 0.1 && (middleY === previous.y || middleY === y);
      const gap = !Number.isFinite(middleY) || (error > 0.1 && overshoot) || step;
      if (gap) finishSection();
    }
    section.push({ x: origin.x + (x - anchor.x), y: origin.y + y, z: COMBAT_Z });
    previous = { x, y };
  }
  finishSection();
  return sections;
}

function findLaunchAnchor(equation, direction) {
  const atZero = sampleValue(equation, 0);
  if (Number.isFinite(atZero)) return { x: 0, y: atZero };
  // Search outward from zero first; use the other side only if this side has no real samples.
  for (const start of [SAMPLE_COUNT / 2 + direction, direction > 0 ? 0 : SAMPLE_COUNT]) {
    for (let index = start; index >= 0 && index <= SAMPLE_COUNT; index += direction) {
      const x = DOMAIN_START + (DOMAIN_END - DOMAIN_START) * index / SAMPLE_COUNT;
      const y = sampleValue(equation, x);
      if (Number.isFinite(y)) return { x, y };
    }
  }
  throw new Error("No finite launch point in −32 ≤ x ≤ 32.");
}

export function buildTrajectory(equation, origin, direction) {
  const anchor = findLaunchAnchor(equation, direction);
  const sections = sampleEquation(equation, origin, anchor);
  const path = getFiringPath(sections, origin, direction);
  return { equation, origin: { x: origin.x, y: origin.y }, anchor, sections, path };
}

export function buildPreview(expression, origin, direction = 1) {
  try {
    return { ...buildTrajectory(parseEquation(expression), origin, direction), error: "" };
  } catch (error) {
    return { equation: null, sections: [], error: error.message };
  }
}

export function getFiringPath(sections, origin, direction) {
  for (const points of sections) {
    const start = points.findIndex((point) => Math.abs(point.x - origin.x) < 1e-8);
    if (start < 0) continue;
    // Reverse traversal for Red, never mirror the equation. A one-point branch can fire and stop.
    return direction > 0 ? points.slice(start) : points.slice(0, start + 1).reverse();
  }
  throw new Error("No finite launch point in −32 ≤ x ≤ 32.");
}
