import test from "node:test";
import assert from "node:assert/strict";
import { ARENA } from "../src/physics.js";
import { buildCartesianGrid, relativeCoordinates, coordinateText } from "../src/grid.js";
import { buildPreview } from "../src/equations.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, a + " != " + b);

test("the grid has one-unit spacing, spans the platform, and numbers relative to a fractional origin", () => {
  const origin = { x: -9.3, y: 2.7 };
  const grid = buildCartesianGrid(origin);
  const vertical = grid.lines.filter((line) => line.x1 === line.x2);
  const horizontal = grid.lines.filter((line) => line.y1 === line.y2);
  for (let i = 1; i < vertical.length; i += 1) close(vertical[i].x1 - vertical[i - 1].x1, 1);
  for (let i = 1; i < horizontal.length; i += 1) close(horizontal[i].y1 - horizontal[i - 1].y1, 1);
  for (const line of vertical) {
    assert.equal(line.y1, -ARENA.depth / 2);
    assert.equal(line.y2, ARENA.depth / 2);
    assert.ok(line.x1 >= -ARENA.halfWidth && line.x1 <= ARENA.halfWidth);
  }
  for (const line of horizontal) {
    assert.equal(line.x1, -ARENA.halfWidth);
    assert.equal(line.x2, ARENA.halfWidth);
  }
  assert.deepEqual(grid.axes[0], { x1: -14, y1: 2.7, x2: 14, y2: 2.7 });
  assert.deepEqual(grid.axes[1], { x1: -9.3, y1: -ARENA.depth / 2, x2: -9.3, y2: ARENA.depth / 2 });
  for (const tick of grid.labels.filter((label) => label.kind.endsWith("number"))) {
    const relative = relativeCoordinates(tick, origin);
    close(tick.kind === "x-number" ? relative.x : relative.y, Number(tick.text));
    assert.ok(Number(tick.text) % 2 === 0);
  }
});

test("enemy coordinates change correctly after selecting or moving either character", () => {
  const enemy = { x: 8.2, y: -2.5 };
  const shooter = { x: -10.1, y: 1.5 };
  assert.equal(coordinateText(shooter, shooter), "(0, 0)");
  assert.equal(coordinateText(enemy, shooter), "(18.3, -4)");
  assert.equal(coordinateText(enemy, { x: -7.5, y: -1 }), "(15.7, -1.5)");
  enemy.x += 1.25;
  enemy.y -= 0.75;
  const coordinates = relativeCoordinates(enemy, shooter);
  close(coordinates.x, 19.55);
  close(coordinates.y, -4.75);
  const moved = buildCartesianGrid({ x: shooter.x + 0.5, y: shooter.y + 0.25 });
  close(moved.axes[1].x1 - buildCartesianGrid(shooter).axes[1].x1, 0.5);
  close(moved.axes[0].y1 - buildCartesianGrid(shooter).axes[0].y1, 0.25);
});

test("grid coordinates and translated equation samples use the same units and signs", () => {
  const origin = { x: 3.25, y: -2.75 };
  for (const direction of [-1, 1]) {
    const preview = buildPreview("x+6", origin, direction);
    for (const point of preview.path) {
      const relative = relativeCoordinates(point, origin);
      close(relative.y, relative.x);
      assert.ok(direction * relative.x >= -1e-10);
    }
  }
});
