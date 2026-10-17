// These 96 rim points match the Blender generator's flat playable summit.
export const ARENA = { halfWidth: 14, depth: 16, power: 2.6, top: 0, thickness: 0.6, fallHeight: -5 };
const outlines = new Map();
export function arenaOutline(padding = 0) {
  if (!outlines.has(padding)) {
    outlines.set(padding, Array.from({ length: 96 }, (_, index) => {
      const angle = index / 96 * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      return { x: (ARENA.halfWidth - padding) * Math.sign(c) * Math.abs(c) ** (2 / ARENA.power),
        y: (ARENA.depth / 2 - padding) * Math.sign(s) * Math.abs(s) ** (2 / ARENA.power) };
    }));
  }
  return outlines.get(padding);
}

export function clipArenaSegment(start, end, padding = 0) {
  const rim = arenaOutline(padding);
  let entry = 0, exit = 1;
  for (let index = 0; index < rim.length; index += 1) {
    const a = rim[index], b = rim[(index + 1) % rim.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    // A counterclockwise edge's cross product is positive on the inside.
    const from = dx * (start.y - a.y) - dy * (start.x - a.x);
    const to = dx * (end.y - a.y) - dy * (end.x - a.x);
    const fromOutside = from < -1e-9, toOutside = to < -1e-9;
    if (fromOutside && toOutside) return null;
    if (fromOutside) entry = Math.max(entry, from / (from - to));
    if (toOutside) exit = Math.min(exit, from / (from - to));
    if (entry > exit) return null;
  }
  return { entry, exit };
}

export function insideArena(x, y, padding = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return clipArenaSegment({ x, y }, { x, y }, padding) !== null;
}

export function clipCurveSections(sections) {
  const result = [];
  for (const points of sections) {
    let section = [];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1], b = points[index];
      const hit = clipArenaSegment(a, b);
      if (hit) {
        const pointAt = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z });
        if (!section.length) section.push(pointAt(hit.entry));
        section.push(pointAt(hit.exit));
      }
      if ((!hit || hit.exit < 1) && section.length) {
        result.push(section);
        section = [];
      }
    }
    if (section.length) result.push(section);
  }
  return result;
}
