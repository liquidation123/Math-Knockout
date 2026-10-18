// Character geometry and physics for drawn fighters.
// Every function here is pure (no DOM), so the creator, tests, server and game
// engine all get exactly the same numbers from the same drawing.

export const CANVAS_WIDTH = 720;
export const CANVAS_HEIGHT = 440;
export const MAX_INK_LITRES = 20;

// Game rule: 1 litre of ink covers 1% of the canvas, so 20 L covers 20%.
export const LITRES_PER_FULL_CANVAS = 100;

// Physical scale: each pixel is a 2.5 mm square, so the canvas is 1.8 m × 1.1 m.
export const METRES_PER_PIXEL = 0.0025;

// Ink density: 1 kg per litre (the same as water).
export const INK_DENSITY_KG_PER_LITRE = 1;

// Because 1 L always covers 1% of the canvas, the ink layer has a fixed thickness:
// thickness = volume / area = 0.001 m³ / (1% of 1.98 m²) ≈ 0.0505 m.
// A 3D version can extrude the 2D shape by exactly this amount.
const CANVAS_AREA_M2 = CANVAS_WIDTH * CANVAS_HEIGHT * METRES_PER_PIXEL ** 2;
export const INK_THICKNESS_M = 0.001 / (CANVAS_AREA_M2 / LITRES_PER_FULL_CANVAS);

// Pixels at least this opaque count as solid in the occupancy mask.
export const MASK_ALPHA_THRESHOLD = 128;

// Copy every 4th byte (the alpha channel) out of canvas RGBA pixels.
export function alphaChannel(rgba) {
  const alpha = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return alpha;
}

// Ink is charged by coverage: a fully opaque pixel is 1, a soft anti-aliased edge
// pixel is a fraction. Painting over a covered pixel cannot increase coverage, so
// overlapping ink is never charged twice.
export function inkLitresFromAlpha(alpha) {
  let coverage = 0;
  for (let i = 0; i < alpha.length; i++) coverage += alpha[i] / 255;
  return LITRES_PER_FULL_CANVAS * coverage / alpha.length;
}

// Treat the drawing as a thin plate made of tiny square pixels, each with mass
// proportional to its ink coverage.
//   mass            M = density × volume (volume in litres = ink used)
//   centre of mass  x̄ = Σ mᵢxᵢ / M,  ȳ = Σ mᵢyᵢ / M
//   inertia (spin)  I = Σ mᵢ(rᵢ² + s²/6), where rᵢ is the distance to the centre
//                   of mass and s²/6 is one square pixel's own spin inertia.
export function measureCharacter(alpha, width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
  if (alpha.length !== width * height) throw new Error('Alpha data does not match the drawing size.');
  const inkLitres = inkLitresFromAlpha(alpha);
  const massKg = INK_DENSITY_KG_PER_LITRE * inkLitres;

  // Pass 1: total coverage, coverage-weighted position sums, and solid bounds.
  let coverage = 0, sumX = 0, sumY = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x];
      if (!a) continue;
      const w = a / 255;
      coverage += w;
      sumX += w * (x + 0.5); // Use the pixel's centre.
      sumY += w * (y + 0.5);
      if (a >= MASK_ALPHA_THRESHOLD) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (coverage === 0) {
    return { inkLitres: 0, areaM2: 0, massKg: 0, centreOfMass: null, momentOfInertiaKgM2: 0, bounds: null };
  }
  const comX = sumX / coverage;
  const comY = sumY / coverage;
  const kgPerCoverage = massKg / coverage; // Mass of one fully covered pixel.

  // Pass 2: spin inertia about the centre of mass, first in pixel² units.
  let spin = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x];
      if (!a) continue;
      const dx = x + 0.5 - comX, dy = y + 0.5 - comY;
      spin += (a / 255) * (dx * dx + dy * dy + 1 / 6);
    }
  }

  const s = METRES_PER_PIXEL;
  return {
    inkLitres,
    areaM2: coverage * s * s,
    massKg,
    centreOfMass: { x: comX, y: comY, u: comX / width, v: comY / height, xM: comX * s, yM: comY * s },
    momentOfInertiaKgM2: kgPerCoverage * spin * s * s,
    bounds: maxX < 0 ? null : { minX, minY, maxX, maxY }
  };
}

// 1 = solid, 0 = empty, stored row by row (row-major).
export function occupancyMask(alpha, threshold = MASK_ALPHA_THRESHOLD) {
  const mask = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) mask[i] = alpha[i] >= threshold ? 1 : 0;
  return mask;
}

// Run-length encoding: alternating run lengths, always starting with empty (0)
// cells. Example: [0,0,1,1,1,0] → [2, 3, 1].
export function encodeRuns(mask) {
  const runs = [];
  let value = 0, length = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === value) { length++; continue; }
    runs.push(length);
    value = mask[i];
    length = 1;
  }
  runs.push(length);
  return runs;
}

export function decodeRuns(runs, size) {
  const mask = new Uint8Array(size);
  let index = 0;
  runs.forEach((length, run) => {
    if (run % 2 === 1) mask.fill(1, index, index + length);
    index += length;
  });
  if (index !== size) throw new Error('Mask runs do not match the drawing size.');
  return mask;
}

export function makeCharacterId() {
  if (globalThis.crypto?.randomUUID) return `char-${globalThis.crypto.randomUUID()}`;
  return `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// The saved fighter record that the battle system reads (format version 1).
// `image`, `inkUsed`, `width` and `height` keep the original saved fields so
// existing game code that reads them still works.
export function createCharacterRecord({ id = makeCharacterId(), alpha, width = CANVAS_WIDTH, height = CANVAS_HEIGHT, image = '', createdAt = new Date().toISOString() }) {
  const physics = measureCharacter(alpha, width, height);
  return {
    format: 'out-mathed-character',
    version: 1,
    id,
    createdAt,
    image,
    inkUsed: physics.inkLitres,
    width,
    height,
    mask: { encoding: 'rle-row-major-start-empty', threshold: MASK_ALPHA_THRESHOLD, runs: encodeRuns(occupancyMask(alpha)) },
    material: {
      maxInkLitres: MAX_INK_LITRES,
      densityKgPerLitre: INK_DENSITY_KG_PER_LITRE,
      thicknessM: INK_THICKNESS_M,
      metresPerPixel: METRES_PER_PIXEL
    },
    physics
  };
}
