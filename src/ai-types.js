import { buildCurvePreview } from "./curves.js";

export const AI_TYPES = {
  normal: "Normal AI", parametric: "Parametric AI", polar: "Polar AI", absolute: "Absolute AI",
  trig: "Trig AI", rational: "Rational AI", dot: "Dot AI",
};
export const TYPE_HELP = {
  normal: "Compares all supported equation families.", parametric: "Uses x(t) and y(t) paths only.",
  polar: "Uses circles and cardioids in polar form.", absolute: "Uses genuine absolute-value bends.",
  trig: "Uses curved trigonometric waves.", rational: "Uses variable denominators; projectile branches launch together.",
  dot: "Projectile-only: isolated equation points, with collision-free teleports between dots.",
};
const n = (value) => Number(value.toFixed(4));

export function equationText(input) {
  if (typeof input === "string") return "y = " + input;
  if (input.type === "dots") return `y = ${input.expression}; x ∈ {0, ${input.direction * 2}, …, ${input.direction * 32}, ${input.targetX}}`;
  if (input.type === "explicit") return "y = " + input.expression;
  if (input.type === "parametric") return `x(t) = ${input.x}; y(t) = ${input.y}; t: ${input.start} → ${input.end}`;
  if (input.type === "polar") return `r(θ) = ${input.radius}; θ: ${input.start} → ${input.end}`;
  return input.expression;
}

export function actionPreview(action, origin, direction) {
  const preview = buildCurvePreview(action.type ? action : action.input || action.expression || action, origin, direction);
  if (action.aiType === "dot") preview.teleport = true;
  return preview;
}

// Each template has a nonzero shape term. No decorative 0*sin(x) or 0*abs(x).
export function typeEquations(from, target, direction, type, difficulty, mode, random = Math.random) {
  const horizontalGap = target.x - from.x;
  const dx = Math.abs(horizontalGap) < 0.1 ? direction * 0.1 : horizontalGap;
  const dy = target.y - from.y;
  let slope = dy / dx;
  let angle = Math.atan2(dy, dx);
  if (difficulty === "easy") {
    slope = Math.round(slope * 4) / 4;
    angle = Math.round(angle * 8) / 8;
    if (random() < 0.3) { slope += 0.25; angle += 0.15; }
  }
  const aimed = (term, offset) => `${n(slope - offset / dx)}*x+${term}`;
  const kink = dx * 0.45;
  const absolute = [0.3, -0.3, 0.65].map((a) => aimed(
    `(${a})*abs(x-(${n(kink)}))`, a * (Math.abs(dx - kink) - Math.abs(kink))));
  const trig = [1, -2, 3].map((a) => aimed(`(${a})*sin(x/3)`, a * Math.sin(dx / 3)));
  const rational = [mode === "bump" ? -direction * 3 : dx * 0.45, -direction * 3, dx * 0.7].map((pole) =>
    aimed(`0.6/(x-(${n(pole)}))`, 0.6 / (dx - pole) + 0.6 / pole));
  const dot = [`${n(slope)}*x`, aimed("0.025*x^2", 0.025 * dx * dx), trig[0]]
    .map((expression) => ({ type: "dots", expression, direction, targetX: n(dx) }));
  const parametric = [1, -1, 2].map((bend) => {
    const t = dx / direction;
    return { type: "parametric", x: `${direction}*t`,
      y: `${n((slope * dx - bend * Math.sin(t / 3)) / t)}*t+(${bend})*sin(t/3)`, start: "0", end: "32" };
  });
  const radius = Math.max(0.4, Math.hypot(dx, dy) / 2);
  const start = n(angle + Math.PI);
  const smallRadius = n(Math.max(0.4, radius / 2));
  const polar = [
    { type: "polar", radius: String(smallRadius), start: String(start), end: `(${start})+2pi` },
    { type: "polar", radius: `${smallRadius}*(1+cos(theta-(${n(angle)})))`, start: String(start), end: `(${start})+2pi` },
    { type: "polar", radius: `${smallRadius}*(1+cos(theta-(${n(angle)})))`, start: String(start), end: `(${start})-2pi` },
    { type: "polar", radius: String(n(radius)), start: String(start), end: `(${start})+2pi` },
    { type: "polar", radius: String(n(radius)), start: String(start), end: `(${start})-2pi` },
    { type: "polar", radius: `${n(radius)}*(1+cos(theta-(${n(angle)})))`, start: String(start), end: `(${start})+2pi` },
  ];
  const families = { absolute, trig, rational, dot, parametric, polar };
  let inputs;
  if (type !== "normal") inputs = families[type];
  else {
    inputs = [`${n(slope)}*x`, ...absolute.slice(0, 1), ...trig.slice(0, 1), ...rational.slice(0, 1),
      ...parametric.slice(0, 1), ...polar.slice(0, 1),
      { type: "implicit", expression: `y-(${n(slope)}*x+0.02*x*(x-(${n(dx)})))=0` },
      aimed("0.02*x^2", 0.02 * dx * dx), aimed("0.1*(exp(x/12)-1)", 0.1 * Math.expm1(dx / 12)),
      aimed("ln(1+x^2)", Math.log1p(dx * dx)), aimed("sqrt(1+x^2)", Math.sqrt(1 + dx * dx) - 1)];
  }
  if (difficulty === "easy") inputs = [inputs[0]];
  if (difficulty === "medium" && type !== "normal") inputs = inputs.slice(0, 2);
  return inputs;
}
