import test from "node:test";
import assert from "node:assert/strict";
import { effectKind, pathLookAhead } from "../src/cinematic.js";

test("look-ahead follows a sharp turn instead of only the current segment", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
  ];
  const view = pathLookAhead(path, { x: 0.9, y: 0 }, 1, 1);
  assert.ok(view.forward.y > 0.9);
  assert.ok(Math.abs(view.target.x - 1) < 1e-9);
});

test("impact categories distinguish enemy, obstacle, and non-impact termination", () => {
  assert.equal(effectKind("Enemy hit"), "enemy");
  assert.equal(effectKind("Obstacle"), "obstacle");
  assert.equal(effectKind("Map boundary"), "boundary");
  assert.equal(effectKind("End of continuous curve"), null);
});
