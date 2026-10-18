// One 128×80 drawing defines the visible solid and its physical properties.
export const BODY_WIDTH = 128, BODY_HEIGHT = 80, CELL = 0.04;
const CONTACT_SAMPLES = [[.5,.5], [.1,.1], [.9,.1], [.1,.9], [.9,.9]];

export function starterMask(side) {
  const rect = (x, y, left, top, width, height) =>
    x >= left && x < left + width && y >= top && y < top + height;
  const ear = (x, y, left, tip) => y >= 5 && y < 30 &&
    Math.abs(x - (left + (y - 5) * (tip - left) / 25)) < (30 - y) * .25;
  let mask = "";
  for (let y = 0; y < BODY_HEIGHT; y++) for (let x = 0; x < BODY_WIDTH; x++) {
    const common = rect(x, y, 52, 27, 24, 25) || rect(x, y, 46, 33, 6, 14) ||
      rect(x, y, 76, 33, 6, 14) || rect(x, y, 55, 51, 7, 15) || rect(x, y, 66, 51, 7, 15);
    const head = side ? rect(x, y, 54, 21, 20, 11) || ear(x, y, 48, 54) || ear(x, y, 80, 74)
      : rect(x, y, 53, 14, 22, 14) || rect(x, y, 59, 8, 10, 7);
    mask += common || head ? "1" : "0";
  }
  return mask;
}

export function bodyFromMask(mask) {
  if (typeof mask !== "string" || !/^[01]{10240}$/.test(mask)) throw new Error("Invalid character mask.");
  const cells = [], edge = [];
  let sx = 0, sy = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === "1") {
    const x = i % BODY_WIDTH, y = Math.floor(i / BODY_WIDTH);
    cells.push([x, y]); sx += x + .5; sy += y + .5;
    if (x === 0 || x === 127 || y === 0 || y === 79 ||
        mask[i - 1] === "0" || mask[i + 1] === "0" ||
        mask[i - BODY_WIDTH] === "0" || mask[i + BODY_WIDTH] === "0") edge.push([x, y]);
  }
  if (!cells.length) throw new Error("Draw some material first.");
  const cx = sx / cells.length, cy = sy / cells.length;
  const ink = cells.length * 100 / mask.length;
  const mass = .65 + .10 * ink; // 20L is much sturdier, but launches more slowly.
  // Each ink cell contributes equally; the second moment is about the same centre used by the mesh.
  const spread = cells.reduce((sum, [x, y]) => sum + (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2, 0);
  const inertia = mass * CELL ** 2 * (spread / cells.length + 1 / 6);
  const radius = Math.max(...edge.map(([x, y]) => Math.hypot(x + .5 - cx, y + .5 - cy))) * CELL + CELL;
  return { mask, cells, edge, cx, cy, ink, mass, inertia, radius };
}

export function bodyContact(a, aPos, aAngle, b, bPos, bAngle) {
  if (Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y) > a.radius + b.radius) return null;
  let x = 0, y = 0, hits = 0;
  function sample(source, position, angle, target, targetPos, targetAngle) {
    const c = Math.cos(angle), s = Math.sin(angle), tc = Math.cos(targetAngle), ts = Math.sin(targetAngle);
    for (const [col, row] of source.edge) {
      // Centre and near-corners catch thin or rotated ink without filling empty gaps.
      for (const [u, v] of CONTACT_SAMPLES) {
        const lx = (col + u - source.cx) * CELL, ly = (source.cy - row - v) * CELL;
        const wx = position.x + lx * c - ly * s, wy = position.y + lx * s + ly * c;
        const dx = wx - targetPos.x, dy = wy - targetPos.y;
        const tx = Math.floor((dx * tc + dy * ts) / CELL + target.cx);
        const ty = Math.floor(target.cy - (-dx * ts + dy * tc) / CELL);
        if (tx >= 0 && tx < BODY_WIDTH && ty >= 0 && ty < BODY_HEIGHT &&
            target.mask[ty * BODY_WIDTH + tx] === "1") { x += wx; y += wy; hits++; }
      }
    }
  }
  sample(a, aPos, aAngle, b, bPos, bAngle);
  sample(b, bPos, bAngle, a, aPos, aAngle);
  return hits ? { x: x / hits, y: y / hits } : null;
}
