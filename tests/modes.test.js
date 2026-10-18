import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createMountain } from "../src/mountain.js";
import { arenaOutline, clipArenaSegment, clipCurveSections, insideArena } from "../src/terrain.js";
import { ARENA, FIXED_STEP, OBSTACLES, createPlayer, updatePlayer } from "../src/physics.js";
import { createRound, updateRound } from "../src/combat.js";
import { createDuel, lockEquation, launchDuel, updateDuel } from "../src/duel.js";
import { firstCollision, PROJECTILE_RADIUS } from "../src/projectile.js";
const source = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("homepage offers both modes, with separate entry points and relevant controls", async () => {
  const home = await source("index.html");
  assert.match(home, /create\.html\?mode=projectile/);
  assert.match(home, /create\.html\?mode=bump/);
  assert.match(home, /Projectile Duel/);
  assert.match(home, /Bump Duel/);
  const projectile = await source("play.html");
  const bump = await source("bump.html");
  assert.match(projectile, /src\/main\.js/);
  assert.match(projectile, /id="force"/);
  assert.match(projectile, /id="equation-type"/);
  assert.doesNotMatch(projectile, /duel-client\.js/);
  assert.match(projectile, /location\.replace\("\/bump\.html" \+ location\.search\)/);
  assert.match(bump, /src\/duel-client\.js/);
  assert.doesNotMatch(bump, /id="force"|id="fire"|src\/main\.js/);
  assert.match(projectile, /href="\/">Change mode/);
  assert.match(bump, /<a href="\/">out-mathed<\/a>/);
  const drawing = await source("create.js");
  assert.match(drawing, /mode === 'bump' \? `\/bump\.html/);
  assert.match(await source("src/scene.js"), /createMountain\(scene\)/);
  assert.match(await source("src/duel-client.js"), /createView\(.+, "bump"\)/);
});

test("shared mountain uses the branch asset, lighting, and exact stone collision boxes", async () => {
  const original = GLTFLoader.prototype.load;
  const scene = new THREE.Scene();
  let asset;
  try {
    GLTFLoader.prototype.load = (url, complete) => { asset = url; complete({ scene: new THREE.Group() }); };
    await createMountain(scene);
  } finally { GLTFLoader.prototype.load = original; }
  assert.equal(asset, "/assets/mountain.glb");
  assert.equal(scene.background, null); // Transparent renderer shows the CSS sky.
  assert.ok(scene.children.some((object) => object.isHemisphereLight && object.intensity === 0.9));
  assert.ok(scene.children.some((object) => object.isDirectionalLight && object.intensity === 2.7));
  const stones = scene.children.find((object) => object.isInstancedMesh);
  assert.equal(stones.count, OBSTACLES.length * 12);
  const matrix = new THREE.Matrix4(), center = new THREE.Vector3();
  OBSTACLES.forEach((box, index) => {
    center.set(0, 0, 0);
    for (let piece = 0; piece < 12; piece++) {
      stones.getMatrixAt(index * 12 + piece, matrix);
      center.add(new THREE.Vector3().setFromMatrixPosition(matrix));
    }
    center.divideScalar(12);
    assert.ok(center.distanceTo(new THREE.Vector3(box.x, box.y, box.height / 2)) < 1e-6);
  });
});

test("physics rim matches the actual GLB grass mesh, not its rectangular bounding box", async () => {
  const bytes = await readFile(new URL("../assets/mountain.glb", import.meta.url));
  const jsonSize = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const mesh = gltf.meshes.find((entry) => entry.name === "Playable grass top");
  const accessor = gltf.accessors[mesh.primitives[0].attributes.POSITION];
  assert.equal(accessor.componentType, 5126); // Float32 positions in the GLB binary chunk.
  const buffer = gltf.bufferViews[accessor.bufferView];
  const compression = buffer.extensions.EXT_meshopt_compression;
  await MeshoptDecoder.ready;
  const decoded = new Uint8Array(compression.count * compression.byteStride);
  const binaryStart = 28 + jsonSize;
  MeshoptDecoder.decodeGltfBuffer(decoded, compression.count, compression.byteStride,
    bytes.subarray(binaryStart + compression.byteOffset,
      binaryStart + compression.byteOffset + compression.byteLength), compression.mode, compression.filter);
  const positions = new DataView(decoded.buffer);
  const vertices = Array.from({ length: accessor.count }, (_, index) => {
    const start = index * compression.byteStride + (accessor.byteOffset || 0);
    return { x: positions.getFloat32(start, true), y: -positions.getFloat32(start + 8, true), z: positions.getFloat32(start + 4, true) };
  });
  assert.ok(vertices.every((point) => Math.abs(point.z) < 1e-7));
  for (const point of arenaOutline()) {
    // Meshopt quantizes positions to about 0.004 world units in this export.
    assert.ok(vertices.some((vertex) => Math.hypot(vertex.x - point.x, vertex.y - point.y) < 0.005));
    assert.ok(insideArena(point.x, point.y));
    assert.equal(insideArena(point.x * 1.001, point.y * 1.001), false);
  }
  assert.equal(insideArena(13, 7), false);
  assert.equal(insideArena(0, 0), true);
});

test("rounded terrain clips preview segments and stops projectiles before a corner enemy", () => {
  const sections = clipCurveSections([[{ x: -30, y: 0, z: 0.5 }, { x: 30, y: 0, z: 0.5 }]]);
  assert.equal(sections.length, 1);
  assert.ok(Math.abs(sections[0][0].x + 14) < 1e-8);
  assert.ok(Math.abs(sections[0][1].x - 14) < 1e-8);
  const players = [createPlayer("Blue", 8, 4, 0.5, 0), createPlayer("Red", 13, 7, 0.5, 1)];
  const start = players[0].position, end = { x: 14, y: 8 };
  const hit = firstCollision(start, end, players, 0);
  assert.equal(hit.reason, "Map boundary");
  const clipped = clipArenaSegment(start, end, PROJECTILE_RADIUS);
  assert.ok(Math.abs(hit.t - clipped.exit) < 1e-9);
  assert.ok(hit.t > 0 && hit.t < 1);
});

test("both modes spawn and land on playable ground and still fall off the summit", () => {
  const round = createRound();
  const duel = createDuel();
  for (const player of [...round.players, ...duel.players]) {
    assert.ok(insideArena(player.position.x, player.position.y, 0.5));
    for (let tick = 0; tick < 180; tick += 1) updatePlayer(player, FIXED_STEP);
    assert.equal(player.position.z, 0.5);
    player.position = { x: 13, y: 7, z: 0.5 };
    for (let tick = 0; tick < 180; tick += 1) updatePlayer(player, FIXED_STEP);
    assert.ok(player.position.z < ARENA.fallHeight);
  }
});

test("Projectile Duel has no contact damage or contact impulse", () => {
  const round = createRound();
  round.players.forEach((player) => { player.position = { x: 0, y: 0, z: 0.5 }; });
  for (let tick = 0; tick < 120; tick += 1) updateRound(round, FIXED_STEP);
  assert.equal(round.attack, null);
  for (const player of round.players) {
    assert.equal(player.health, 100);
    assert.equal(player.velocity.x, 0);
    assert.equal(player.velocity.y, 0);
  }
});

test("Bump Duel keeps contact knockback without projectile damage and stops at stone walls", () => {
  const duel = createDuel();
  duel.round = 3; // Ruins enter the arena only from the third launch.
  duel.players[0].position = { x: -4, y: -3, z: 0.5 };
  duel.players[1].position = { x: 4, y: -3, z: 0.5 };
  lockEquation(duel, 0, "0"); lockEquation(duel, 1, "0"); launchDuel(duel);
  for (let tick = 0; tick < 180; tick += 1) updateDuel(duel, FIXED_STEP);
  assert.ok(Math.abs(duel.players[0].position.x + 2.4) < 1e-8);
  assert.equal(duel.paths[0].done, true);
  assert.ok(duel.players.every((player) => player.health === 100));
  const collision = createDuel();
  lockEquation(collision, 0, "0"); lockEquation(collision, 1, "0"); launchDuel(collision);
  for (let tick = 0; tick < 1200 && collision.phase === "running"; tick += 1) updateDuel(collision, FIXED_STEP);
  assert.equal(collision.phase, "finished");
  assert.ok(collision.players.every((player) => player.health === 100 && player.eliminated));
  assert.equal("attack" in collision, false);
});

test("fresh games do not share attacks, health, locks, velocities or results", () => {
  const projectile = createRound(), bump = createDuel();
  projectile.players[0].health = 0;
  projectile.players[0].velocity.x = 99;
  projectile.result = { winner: "Red" };
  lockEquation(bump, 0, "x");
  const freshProjectile = createRound(), freshBump = createDuel();
  assert.ok(freshProjectile.players.every((player) => player.health === 100 && player.velocity.x === 0));
  assert.equal(freshProjectile.attack, null);
  assert.equal(freshProjectile.result, null);
  assert.deepEqual(freshBump.locked, [false, false]);
  assert.deepEqual(freshBump.paths, [null, null]);
  assert.equal(freshBump.phase, "planning");
});
