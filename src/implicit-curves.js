import { compileExpression } from "./equations.js";

// Marching triangles: split each grid square, then join its zero crossings.
// This is a bounded numerical contour, not a symbolic equation solver.
export const IMPLICIT_LIMIT = 16;
export const IMPLICIT_CELLS = 128;
export const IMPLICIT_STEP = 2 * IMPLICIT_LIMIT / IMPLICIT_CELLS;

function compileImplicit(expression) {
  const sides = expression.split("=");
  if (sides.length > 2) throw new Error("Use F(x,y) or a single equation: left = right.");
  const left = compileExpression(sides[0], ["x", "y"]);
  const right = compileExpression(sides.length === 2 ? sides[1] : "0", ["x", "y"]);
  return (point) => left.evaluate(point) - right.evaluate(point);
}

export function traceImplicit(expression) {
  const evaluate = compileImplicit(expression);
  const vertices = [];
  for (let row = 0; row <= IMPLICIT_CELLS; row += 1) {
    for (let col = 0; col <= IMPLICIT_CELLS; col += 1) {
      const point = { x: -IMPLICIT_LIMIT + col * IMPLICIT_STEP, y: -IMPLICIT_LIMIT + row * IMPLICIT_STEP };
      vertices.push({ ...point, id: vertices.length, value: evaluate(point) });
    }
  }
  if (vertices.every((point) => point.value === 0)) {
    throw new Error("This equation describes an area, not a one-dimensional curve.");
  }
  const nodes = new Map();
  const edgeRoots = new Map();
  const edges = new Set();
  const edgeKey = (a, b) => [a, b].sort().join(":");
  function node(id, point) {
    if (!nodes.has(id)) nodes.set(id, { point: { x: point.x, y: point.y }, neighbors: new Set() });
    return id;
  }
  function root(a, b) {
    if (a.value === 0) return node("v" + a.id, a);
    if (b.value === 0) return node("v" + b.id, b);
    if (Math.sign(a.value) === Math.sign(b.value)) return null;
    const key = edgeKey(a.id, b.id);
    if (edgeRoots.has(key)) return edgeRoots.get(key);
    let low = a;
    let high = b;
    let best = Math.abs(a.value) < Math.abs(b.value) ? a : b;
    for (let step = 0; step < 20; step += 1) {
      const point = { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2 };
      point.value = evaluate(point);
      if (!Number.isFinite(point.value)) break;
      if (Math.abs(point.value) < Math.abs(best.value)) best = point;
      if (point.value === 0) break;
      if (Math.sign(point.value) === Math.sign(low.value)) low = point;
      else high = point;
    }
    // A sign change across a pole or step is NOT necessarily a zero.
    const tolerance = Math.max(Math.abs(a.value), Math.abs(b.value)) * 0.00001;
    const result = Math.abs(best.value) <= tolerance ? node("e" + key, best) : null;
    edgeRoots.set(key, result);
    return result;
  }
  function triangle(points) {
    if (points.some((point) => !Number.isFinite(point.value)) || points.every((point) => point.value === 0)) return;
    const crossings = new Set();
    for (let index = 0; index < 3; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % 3];
      if (a.value === 0 && b.value === 0) {
        crossings.add(node("v" + a.id, a));
        crossings.add(node("v" + b.id, b));
      } else {
        const id = root(a, b);
        if (id !== null) crossings.add(id);
      }
    }
    if (crossings.size !== 2) return;
    const [a, b] = [...crossings];
    edges.add(edgeKey(a, b));
    nodes.get(a).neighbors.add(b);
    nodes.get(b).neighbors.add(a);
  }
  for (let row = 0; row < IMPLICIT_CELLS; row += 1) {
    for (let col = 0; col < IMPLICIT_CELLS; col += 1) {
      const index = row * (IMPLICIT_CELLS + 1) + col;
      const a = vertices[index], b = vertices[index + 1];
      const c = vertices[index + IMPLICIT_CELLS + 1], d = vertices[index + IMPLICIT_CELLS + 2];
      triangle([a, b, d]);
      triangle([a, d, c]);
    }
  }
  if (edges.size > 12000) throw new Error("Too many contour segments. Try a simpler or less oscillatory equation.");
  const visited = new Set();
  const branches = [];
  function walk(start, next) {
    const points = [nodes.get(start).point];
    let previous = start;
    let current = next;
    while (true) {
      visited.add(edgeKey(previous, current));
      points.push(nodes.get(current).point);
      if (current === start || nodes.get(current).neighbors.size !== 2) break;
      const following = [...nodes.get(current).neighbors].find((id) => id !== previous);
      if (visited.has(edgeKey(current, following))) break;
      previous = current;
      current = following;
    }
    if (points.length > 1) branches.push({ points, closed: current === start });
  }
  // Stop at intersections rather than guessing which arm of a junction to take.
  for (const [id, entry] of nodes) {
    if (entry.neighbors.size === 2) continue;
    for (const next of entry.neighbors) if (!visited.has(edgeKey(id, next))) walk(id, next);
  }
  for (const [id, entry] of nodes) {
    for (const next of entry.neighbors) if (!visited.has(edgeKey(id, next))) walk(id, next);
  }
  if (!branches.length) throw new Error("No traceable curve in −16 ≤ x,y ≤ 16. Tiny loops and isolated zeros may be missed.");
  if (branches.length > 128) throw new Error("Too many separate branches. Try a simpler equation.");
  return { type: "implicit", branches, equation: { name: expression, color: 0xffcd6b },
    warning: "Numerical contour: 0.25-unit grid in [−16,16]². Click a branch to choose its launch point; junctions stop the path." };
}

export function implicitPath(model, selection = {}) {
  const branch = Math.max(0, Math.min(model.branches.length - 1, selection.branch || 0));
  const chosen = model.branches[branch];
  const points = chosen.closed ? chosen.points.slice(0, -1) : chosen.points;
  let start = Math.max(0, Math.min(points.length - 1, selection.start || 0));
  if (selection.cardinal && selection.cardinal !== "custom") {
    const axis = ["left", "right"].includes(selection.cardinal) ? "x" : "y";
    const sign = ["right", "top"].includes(selection.cardinal) ? 1 : -1;
    start = points.reduce((best, point, index) => point[axis] * sign > points[best][axis] * sign ? index : best, 0);
  }
  let path;
  if (chosen.closed) {
    // Signed polygon area tells us whether the stored loop is counterclockwise.
    const area = points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0);
    const desiredSign = selection.direction === "reverse" ? -1 : 1;
    const step = Math.sign(area) === desiredSign ? 1 : -1;
    path = Array.from({ length: points.length + 1 }, (_, index) =>
      points[(start + step * index + points.length) % points.length]);
  } else {
    path = selection.direction === "reverse" ? points.slice(0, start + 1).reverse() : points.slice(start);
  }
  return { branch, start, path, anchor: points[start], closed: chosen.closed };
}
