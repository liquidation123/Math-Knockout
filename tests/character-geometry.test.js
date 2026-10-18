import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INK_THICKNESS_M, METRES_PER_PIXEL, createCharacterRecord, decodeRuns, encodeRuns, inkLitresFromAlpha,
  measureCharacter, occupancyMask
} from '../src/character-geometry.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} ≈ ${expected}`);

function paint(width, height, x0, y0, x1, y1, alpha = 255, pixels = new Uint8Array(width * height)) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels[y * width + x] = alpha;
  return pixels;
}

test('a solid square matches the textbook plate formulas', () => {
  // 10 × 10 pixels on a 100 × 100 board covers 1% → 1 L → 1 kg.
  const shape = measureCharacter(paint(100, 100, 20, 30, 30, 40), 100, 100);
  close(shape.inkLitres, 1);
  close(shape.massKg, 1);
  assert.deepEqual([shape.centreOfMass.x, shape.centreOfMass.y], [25, 35]);
  const side = 10 * METRES_PER_PIXEL;
  close(shape.momentOfInertiaKgM2, shape.massKg * side * side / 6); // Square plate: I = M·L²/6.
  assert.deepEqual(shape.bounds, { minX: 20, minY: 30, maxX: 29, maxY: 39 });
});

test('centre of mass moves toward the heavier part (lever rule)', () => {
  const pixels = paint(100, 10, 0, 0, 10, 10);   // 100 px block on the left
  paint(100, 10, 80, 0, 100, 10, 255, pixels);   // 200 px block on the right
  const { centreOfMass } = measureCharacter(pixels, 100, 10);
  close(centreOfMass.x, (100 * 5 + 200 * 90) / 300);
});

test('repainting covered pixels costs no extra ink', () => {
  const pixels = paint(50, 50, 0, 0, 10, 10);
  const before = inkLitresFromAlpha(pixels);
  paint(50, 50, 0, 0, 10, 10, 255, pixels);
  assert.equal(inkLitresFromAlpha(pixels), before);
});

test('on the real canvas, mass = density × area × thickness', () => {
  const shape = measureCharacter(paint(720, 440, 100, 100, 300, 200));
  close(shape.massKg, 1000 * shape.areaM2 * INK_THICKNESS_M); // Ink density 1000 kg/m³.
});

test('an empty drawing has no mass and no centre', () => {
  const shape = measureCharacter(new Uint8Array(400), 20, 20);
  assert.equal(shape.massKg, 0);
  assert.equal(shape.centreOfMass, null);
});

test('saved record round-trips its occupancy mask and keeps legacy fields', () => {
  const alpha = paint(40, 20, 5, 5, 15, 10, 255);
  alpha[0] = 100; // Faint anti-aliased pixel: costs ink, but is not solid.
  const record = createCharacterRecord({ id: 'char-test', alpha, width: 40, height: 20, image: 'data:image/png;base64,' });
  assert.equal(record.id, 'char-test');
  assert.deepEqual([record.width, record.height, record.image], [40, 20, 'data:image/png;base64,']);
  assert.equal(record.inkUsed, record.physics.inkLitres);
  assert.deepEqual(decodeRuns(record.mask.runs, 800), occupancyMask(alpha));
  assert.deepEqual(encodeRuns(Uint8Array.from([1, 1, 0])), [0, 2, 1]);
  assert.equal(JSON.parse(JSON.stringify(record)).mask.runs.length, record.mask.runs.length);
});
