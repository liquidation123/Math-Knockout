import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createErodingIsland } from "../src/erosion.js";
import { insideDuel } from "../src/duel.js";
import { createPlayer, FIXED_STEP, updatePlayer } from "../src/physics.js";

test("actual mountain summit and cliff lip follow the authoritative collision radius", async () => {
  const bytes = await readFile(new URL("../assets/mountain.glb", import.meta.url));
  const size = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + size));
  const root = new THREE.Group();
  root.rotation.x = Math.PI / 2;
  await MeshoptDecoder.ready;
  for (const name of ["Playable grass top", "Sculpted limestone cliff"]) {
    const mesh = gltf.meshes.find((m) => m.name === name);
    const accessor = gltf.accessors[mesh.primitives[0].attributes.POSITION];
    const buffer = gltf.bufferViews[accessor.bufferView];
    const compression = buffer.extensions.EXT_meshopt_compression;
    const decoded = new Uint8Array(compression.count * compression.byteStride);
    MeshoptDecoder.decodeGltfBuffer(decoded, compression.count, compression.byteStride,
      bytes.subarray(28 + size + compression.byteOffset,
        28 + size + compression.byteOffset + compression.byteLength), compression.mode, compression.filter);
    const data = new DataView(decoded.buffer), points = [];
    for (let i = 0; i < accessor.count; i++) {
      for (let axis = 0; axis < 3; axis++) points.push(data.getFloat32(
        i * compression.byteStride + (accessor.byteOffset || 0) + axis * 4, true));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    object.name = name;
    root.add(object);
  }
  const island = createErodingIsland(root);
  const [top, cliff] = island.children;
  const geometry = top.geometry;
  for (const radius of [8.25, 7.55, 5.45, 2.8, 8.25]) {
    island.setRadius(radius);
    assert.equal(top.scale.x, radius);
    assert.equal(top.scale.y, radius);
    assert.equal(top.geometry, geometry, "rounds reuse the same surface geometry");
    const positions = cliff.geometry.attributes.position;
    let rimPoints = 0;
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getZ(i)) > .02) continue;
      rimPoints++;
      assert.ok(Math.abs(Math.hypot(positions.getX(i), positions.getY(i)) - radius) < .00001);
    }
    assert.ok(rimPoints >= 96);
    for (const offset of [-.01, .01]) {
      const player = createPlayer("edge", radius + offset, 0, .5);
      for (let i = 0; i < 120; i++) updatePlayer(player, FIXED_STEP, [], (x, y) => insideDuel(x, y, radius));
      assert.equal(player.position.z === .5, offset < 0);
    }
  }
});

test("eroded decoration disappears, restores on restart, and does not accumulate geometry", () => {
  const root = new THREE.Group();
  const decoration = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2), new THREE.MeshStandardMaterial());
  decoration.position.x = 6;
  root.add(decoration);
  const island = createErodingIsland(root);
  island.setRadius(8.25);
  const count = island.children[0].geometry.index.count;
  island.setRadius(5);
  assert.equal(island.children[0].geometry.index.count, 0);
  island.setRadius(8.25);
  assert.equal(island.children[0].geometry.index.count, count);
  assert.equal(island.children.length, 1);
});
