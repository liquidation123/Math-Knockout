import { buildPreview, parseEquation, compileExpression, COMBAT_Z, SAMPLE_COUNT } from "./equations.js";
import { traceImplicit, implicitPath } from "./implicit-curves.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (point) => Number.isFinite(point.x) && Number.isFinite(point.y);

function completesLoop(path, point) {
  if (path.length < 16) return false;
  const first = path[0], previous = path.at(-1);
  const dx = point.x - previous.x, dy = point.y - previous.y;
  const length = Math.hypot(dx, dy);
  const initialX = path[1].x - first.x, initialY = path[1].y - first.y;
  const initialLength = Math.hypot(initialX, initialY);
  if (!length || !initialLength) return false;
  const fraction = ((first.x - previous.x) * dx + (first.y - previous.y) * dy) / (length * length);
  if (fraction < 0 || fraction > 1) return distance(point, first) < 1e-8;
  const near = { x: previous.x + fraction * dx, y: previous.y + fraction * dy };
  // Return near the launch point in the original direction: finish one loop.
  return distance(near, first) < Math.max(1e-8, length * 0.01) &&
    (dx * initialX + dy * initialY) / (length * initialLength) > 0.95;
}

export function readBound(expression) {
  const value = compileExpression(expression, []).evaluate();
  if (!Number.isFinite(value) || Math.abs(value) > 1000) {
    throw new Error("Parameter bounds must be finite numbers between −1000 and 1000.");
  }
  return value;
}

function hasBreak(a, b, middle) {
  if (!finite(middle)) return true;
  return ["x", "y"].some((axis) => {
    const error = Math.abs(middle[axis] - (a[axis] + b[axis]) / 2);
    const outside = middle[axis] < Math.min(a[axis], b[axis]) || middle[axis] > Math.max(a[axis], b[axis]);
    const step = Math.abs(a[axis] - b[axis]) > 0.1 &&
      (middle[axis] === a[axis] || middle[axis] === b[axis]);
    return (error > 0.1 && outside) || step;
  });
}

export function sampleParameter(evaluate, start, end) {
  if (start === end || Math.abs(end - start) > 128 * Math.PI) {
    throw new Error("Use different bounds, at most 128π apart.");
  }
  const anchor = evaluate(start);
  if (!finite(anchor)) throw new Error("The curve is undefined at the chosen start. Change the start value.");
  const branches = [];
  let path = [anchor];
  let warning = "";
  let closed = false;
  for (let index = 1; index <= SAMPLE_COUNT; index += 1) {
    const before = start + (end - start) * (index - 1) / SAMPLE_COUNT;
    const after = start + (end - start) * index / SAMPLE_COUNT;
    const point = evaluate(after);
    // Midpoint tests catch common poles and steps instead of bridging them.
    const middle = evaluate((before + after) / 2);
    const valid = finite(point) && Math.abs(point.x - anchor.x) <= 1000 && Math.abs(point.y - anchor.y) <= 1000;
    const gap = !valid || (path.length && hasBreak(path.at(-1), point, middle));
    if (gap || !finite(middle)) {
      if (path.length) branches.push({ points: path, closed: false });
      path = [];
      warning = "Detected breaks split the trajectory. Bump characters use only the launch branch.";
    }
    if (!valid) continue;
    if (!branches.length && completesLoop(path, point)) {
      path.push({ ...anchor });
      closed = true;
      break;
    }
    path.push(point);
  }
  // A closed parameter interval makes one ordered pass; repeat no extra endpoint.
  closed ||= !branches.length && path.length === SAMPLE_COUNT + 1 && distance(path[0], path.at(-1)) < 1e-7;
  if (closed) path[path.length - 1] = { ...path[0] };
  if (path.length) branches.push({ points: path, closed });
  return { branches, warning };
}

export function createCurveModel(request) {
  if (request.type === "explicit") return { type: "explicit", expression: request.expression };
  if (request.type === "dots") {
    const equation = parseEquation(request.expression);
    const direction = request.direction === -1 ? -1 : 1;
    const branches = [];
    // The domain is explicitly discrete, not a guess from near-asymptote samples.
    const domain = Array.from({ length: 17 }, (_, index) => direction * index * 2);
    const targetX = request.extra?.trim() ? readBound(request.extra) : request.targetX;
    if (targetX !== undefined) {
      if (!Number.isFinite(targetX) || targetX * direction < 0 || Math.abs(targetX) > 32) {
        throw new Error("Extra dot x must be within 32 units in your firing direction.");
      }
      domain.push(targetX);
    }
    for (const x of [...new Set(domain)].sort((a, b) => direction * (a - b))) {
      const y = equation.evaluate(x);
      if (Number.isFinite(y)) branches.push({ points: [{ x, y }], closed: false });
    }
    if (!branches.length) throw new Error("No finite points in this discrete domain.");
    return { type: "dots", branches, equation: { ...equation, name: equation.name + " · discrete x", rational: false } };
  }
  if (request.type === "implicit") return traceImplicit(request.expression);
  const start = readBound(request.start);
  const end = readBound(request.end);
  let evaluate;
  let name;
  if (request.type === "parametric") {
    const x = compileExpression(request.x, ["t"]);
    const y = compileExpression(request.y, ["t"]);
    evaluate = (t) => ({ x: x.evaluate({ t }), y: y.evaluate({ t }) });
    name = "(x(t), y(t)) = (" + request.x + ", " + request.y + ")";
  } else if (request.type === "polar") {
    const radius = compileExpression(request.radius, ["theta"]);
    evaluate = (theta) => {
      const r = radius.evaluate({ theta });
      return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    };
    name = "r = " + request.radius;
  } else {
    throw new Error("Choose a supported equation type.");
  }
  return { type: request.type, equation: { name, color: 0xffcd6b }, ...sampleParameter(evaluate, start, end) };
}

export function translatePath(points, anchor, origin) {
  return points.map((point) => ({
    x: origin.x + point.x - anchor.x,
    y: origin.y + point.y - anchor.y,
    z: COMBAT_Z,
  }));
}

export function previewCurveModel(model, origin, direction = 1, selection = {}) {
  if (model.type === "explicit") return buildPreview(model.expression, origin, direction);
  const chosen = model.type === "implicit" ? implicitPath(model, selection) : null;
  const points = chosen ? chosen.path : model.branches[0].points;
  const anchor = points[0];
  const path = translatePath(points, anchor, origin);
  const sections = model.branches.map((branch) => translatePath(branch.points, anchor, origin));
  // Implicit branches use their displayed index order after the chosen launch branch.
  const remaining = model.type === "implicit"
    ? model.branches.filter((_, index) => index !== chosen.branch).map((branch) =>
      translatePath(selection.direction === "reverse" ? [...branch.points].reverse() : branch.points, anchor, origin))
    : sections.slice(1);
  return { equation: model.equation, origin: { x: origin.x, y: origin.y },
    path, sections, travelSections: [path, ...remaining], dots: model.type === "dots",
    anchor, selection: chosen, warning: model.warning, error: "" };
}

export function buildCurvePreview(input, origin, direction = 1) {
  if (typeof input === "string") return buildPreview(input, origin, direction);
  try {
    return previewCurveModel(createCurveModel(input.type === "dots" ? { ...input, direction } : input), origin, direction, input.selection);
  } catch (error) { return { error: error.message, sections: [], path: [] }; }
}
