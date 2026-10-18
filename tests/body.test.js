import test from "node:test";
import assert from "node:assert/strict";
import { BODY_WIDTH, CELL, bodyContact, bodyFromMask, starterMask } from "../src/body.js";
import { createBodyMesh } from "../src/body-mesh.js";

test("one mask supplies the 3D top, mass, centre, inertia, and collision footprint", () => {
  const pixels = Array(10240).fill("0");
  pixels[40 * BODY_WIDTH + 63] = pixels[40 * BODY_WIDTH + 65] = "1";
  const body = bodyFromMask(pixels.join(""));
  assert.equal(body.cells.length, 2);
  assert.equal(body.cx, 64.5);
  assert.equal(body.cy, 40.5);
  assert.ok(body.mass > 0 && body.inertia > 0);
  const mesh = createBodyMesh(body, 0x2889ff);
  assert.equal(mesh.children.length, 2);
  assert.equal(mesh.children[0].geometry.getAttribute("position").count, 12); // Two top quads.
  assert.ok(bodyContact(body, { x: 0, y: 0 }, 0, body, { x: 0, y: 0 }, 0));
  assert.equal(bodyContact(body, { x: 0, y: 0 }, 0, body, { x: CELL * 8, y: 0 }, 0), null);
});

test("starter characters obey the same 20L mask budget as hand drawings", () => {
  for (const side of [0, 1]) assert.ok(bodyFromMask(starterMask(side)).ink <= 20);
});
