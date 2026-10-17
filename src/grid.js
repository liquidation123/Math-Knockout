import { ARENA } from "./physics.js";

export function relativeCoordinates(point, origin) {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

export function coordinateText(point, origin) {
  const relative = relativeCoordinates(point, origin);
  // Round only the label; physics and equation points keep their full precision.
  const number = (value) => String(Number(value.toFixed(1)));
  return "(" + number(relative.x) + ", " + number(relative.y) + ")";
}

export function buildCartesianGrid(origin) {
  const lines = [];
  const axes = [];
  const labels = [];
  const left = -ARENA.halfWidth;
  const right = ARENA.halfWidth;
  const bottom = -ARENA.depth / 2;
  const top = ARENA.depth / 2;
  // Integer local coordinates give exactly one physics unit per grid square.
  for (let x = Math.ceil(left - origin.x); x <= Math.floor(right - origin.x); x += 1) {
    lines.push({ x1: origin.x + x, y1: bottom, x2: origin.x + x, y2: top });
    if (x !== 0 && x % 2 === 0 && origin.y >= bottom && origin.y <= top) {
      labels.push({ text: String(x), x: origin.x + x, y: origin.y, kind: "x-number" });
    }
  }
  for (let y = Math.ceil(bottom - origin.y); y <= Math.floor(top - origin.y); y += 1) {
    lines.push({ x1: left, y1: origin.y + y, x2: right, y2: origin.y + y });
    if (y !== 0 && y % 2 === 0 && origin.x >= left && origin.x <= right) {
      labels.push({ text: String(y), x: origin.x, y: origin.y + y, kind: "y-number" });
    }
  }
  if (origin.y >= bottom && origin.y <= top) {
    axes.push({ x1: left, y1: origin.y, x2: right, y2: origin.y });
    labels.push({ text: "+X", x: right - 0.25, y: origin.y, kind: "x-title" });
  }
  if (origin.x >= left && origin.x <= right) {
    axes.push({ x1: origin.x, y1: bottom, x2: origin.x, y2: top });
    labels.push({ text: "+Y", x: origin.x, y: top - 0.25, kind: "y-title" });
  }
  return { lines, axes, labels };
}
