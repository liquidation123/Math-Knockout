import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCamera, frameCamera } from "../src/scene.js";
import { ARENA } from "../src/physics.js";

test("the orthographic camera looks down -Z with +X right and +Y up", () => {
  const camera = createCamera();
  camera.updateMatrixWorld();
  assert.ok(camera.isOrthographicCamera);
  assert.deepEqual(camera.position.toArray(), [0, 0, 24]);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  assert.deepEqual(direction.toArray().map((value) => value || 0), [0, 0, -1]);
  const centre = new THREE.Vector3(0, 0, 0).project(camera);
  const right = new THREE.Vector3(1, 0, 0).project(camera);
  const up = new THREE.Vector3(0, 1, 0).project(camera);
  assert.ok(right.x > centre.x);
  assert.equal(right.y, centre.y);
  assert.ok(up.y > centre.y);
  assert.equal(up.x, centre.x);
});

test("the complete wider arena stays visible at wide and narrow aspect ratios", () => {
  for (const aspect of [0.5, 1, 1.8, 2.5]) {
    const camera = createCamera();
    frameCamera(camera, aspect);
    camera.updateMatrixWorld();
    for (const x of [-ARENA.halfWidth, ARENA.halfWidth]) {
      for (const y of [-ARENA.depth / 2, ARENA.depth / 2]) {
        const point = new THREE.Vector3(x, y, 0).project(camera);
        assert.ok(Math.abs(point.x) < 1);
        assert.ok(Math.abs(point.y) < 1);
      }
    }
    assert.ok(Math.abs((camera.right - camera.left) / (camera.top - camera.bottom) - aspect) < 1e-10);
  }
});


test("the complete arena fits between top and bottom controls at desktop and phone sizes", () => {
  for (const [width, height, hud, controls] of [
    [1440, 900, 166, 190], [1280, 720, 166, 190], [390, 844, 160, 220],
    [600, 758, 166, 210], [844, 390, 100, 135], [320, 568, 160, 220],
  ]) {
    const camera = createCamera();
    frameCamera(camera, width / height, hud / height, controls / height);
    camera.updateMatrixWorld();
    for (const x of [-ARENA.halfWidth, ARENA.halfWidth]) {
      for (const y of [-ARENA.depth / 2, ARENA.depth / 2]) {
        const point = new THREE.Vector3(x, y, 0).project(camera);
        assert.ok(Math.abs(point.x) < 1);
        assert.ok(point.y < 1 - 2 * hud / height);
        assert.ok(point.y > -1 + 2 * controls / height);
      }
    }
  }
});
