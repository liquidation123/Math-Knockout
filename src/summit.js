import * as THREE from "three";
import { ARENA, OBSTACLES } from "./physics.js";

// All terrain is made once in the browser. Only the flat green top supports players.
export function createSummit(scene) {
  const width = ARENA.halfWidth * 2;
  const depth = ARENA.depth;
  const grass = new THREE.PlaneGeometry(width, depth, 28, 16);
  const colors = [];
  const green = new THREE.Color();
  for (let i = 0; i < grass.attributes.position.array.length; i += 3) {
    const x = grass.attributes.position.array[i];
    const y = grass.attributes.position.array[i + 1];
    const patch = Math.sin(x * 1.7 + y * 2.3) * Math.cos(y * 1.9 - x * 0.8);
    green.setHSL(0.23 + patch * 0.018, 0.58, 0.46 + patch * 0.07);
    colors.push(green.r, green.g, green.b);
  }
  grass.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const top = new THREE.Mesh(grass, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  top.position.z = ARENA.top;
  top.receiveShadow = true;
  scene.add(top);

  // The upper cliff ring uses the exact four physics edges; lower rings widen into a mountain.
  const positions = [];
  const rockColors = [];
  const stone = new THREE.Color();
  const sides = 16;
  const edgePoint = (side, t) => {
    if (side === 0) return [-ARENA.halfWidth + width * t, -depth / 2];
    if (side === 1) return [ARENA.halfWidth, -depth / 2 + depth * t];
    if (side === 2) return [ARENA.halfWidth - width * t, depth / 2];
    return [-ARENA.halfWidth, depth / 2 - depth * t];
  };
  const edge = (i) => edgePoint(Math.floor(i / sides), (i % sides) / sides);
  const ring = (i, level) => {
    const index = i % (sides * 4);
    const [x, y] = edge(index);
    if (level === 0) return [x, y, -0.04];
    const jag = Math.sin(index * 11.7) * 0.65 + Math.sin(index * 3.1) * 0.35;
    const spread = level === 1 ? 1.4 + jag * 0.5 : 5.2 + jag;
    const side = Math.floor(index / sides);
    const outward = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
    return [x + outward[0] * spread, y + outward[1] * spread,
      level === 1 ? -3.3 + jag * 0.4 : -10 + jag];
  };
  function triangle(a, b, c, shade) {
    positions.push(...a, ...b, ...c);
    stone.setHSL(0.105, 0.31, shade);
    for (let n = 0; n < 3; n += 1) rockColors.push(stone.r, stone.g, stone.b);
  }
  for (let level = 0; level < 2; level += 1) {
    for (let i = 0; i < sides * 4; i += 1) {
      const a = ring(i, level), b = ring(i + 1, level);
      const c = ring(i, level + 1), d = ring(i + 1, level + 1);
      const shade = 0.56 + 0.07 * Math.sin(i * 7.8 + level);
      triangle(a, c, b, shade);
      triangle(b, c, d, shade - 0.045);
    }
  }
  const cliff = new THREE.BufferGeometry();
  cliff.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  cliff.setAttribute("color", new THREE.Float32BufferAttribute(rockColors, 3));
  cliff.computeVertexNormals();
  scene.add(new THREE.Mesh(cliff, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide,
  })));

  // Broken stones mark the actual fall edge; the gaps keep the boundary readable.
  const rim = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.25, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xf2dfb5, roughness: 1 }), 48,
  );
  const marker = new THREE.Object3D();
  for (let i = 0; i < 48; i += 1) {
    const side = Math.floor(i / 12);
    const t = (i % 12 + 0.5) / 12;
    const [x, y] = edgePoint(side, t);
    marker.position.set(x, y, 0.015);
    marker.rotation.z = side % 2 ? Math.PI / 2 : 0;
    marker.scale.set((side % 2 ? depth : width) / 12 * 0.84, 1, 1);
    marker.updateMatrix();
    rim.setMatrixAt(i, marker.matrix);
  }
  scene.add(rim);

  const shrubs = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x518d31, flatShading: true, roughness: 1 }), 64,
  );
  for (let i = 0; i < 64; i += 1) {
    const [x, y] = edge(i);
    marker.position.set(x * 1.045, y * 1.08, -0.24);
    marker.rotation.z = i * 2.3;
    const size = 0.32 + (Math.sin(i * 9.7) + 1) * 0.19;
    marker.scale.set(size * 1.4, size, size * 0.6);
    marker.updateMatrix();
    shrubs.setMatrixAt(i, marker.matrix);
  }
  scene.add(shrubs);

  // Existing obstacle boxes retain their exact collision dimensions.
  const stones = [0xe9d6a7, 0xd9c496, 0xf2dfb1];
  OBSTACLES.forEach((box, i) => {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(box.width, box.depth, box.height),
      new THREE.MeshStandardMaterial({ color: stones[i % stones.length], roughness: 1 }),
    );
    block.position.set(box.x, box.y, box.height / 2);
    block.castShadow = true;
    block.receiveShadow = true;
    scene.add(block);
  });

  // A few shared low-poly cloud meshes give depth without an image or network request.
  const cloudShape = new THREE.IcosahedronGeometry(1, 1);
  const cloudWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.87, depthWrite: false });
  for (const [x, y, z, scale] of [[-23, -13, -4, 2.5], [24, -7, -6, 2.8], [-17, 18, -7, 3], [19, 17, -5, 2.4]]) {
    for (let i = 0; i < 4; i += 1) {
      const puff = new THREE.Mesh(cloudShape, cloudWhite);
      puff.position.set(x + i * scale * 0.65, y + Math.sin(i * 2) * scale * 0.3, z + Math.sin(i) * 0.5);
      puff.scale.set(scale, scale * 0.65, scale * 0.5);
      scene.add(puff);
    }
  }
}
