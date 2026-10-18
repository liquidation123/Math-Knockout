import * as THREE from "three";
import { BODY_WIDTH, BODY_HEIGHT, CELL } from "./body.js";

export function createBodyMesh(body, color) {
  const top = [], sides = [], height = .55;
  const xAt = (x) => (x - body.cx) * CELL;
  const yAt = (y) => (body.cy - y) * CELL;
  const quad = (list, a, b, c, d) => list.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let y = 0; y < BODY_HEIGHT; y++) {
    for (let x = 0; x < BODY_WIDTH;) {
      if (body.mask[y * BODY_WIDTH + x] === "0") { x++; continue; }
      const start = x;
      while (x < BODY_WIDTH && body.mask[y * BODY_WIDTH + x] === "1") x++;
      quad(top, [xAt(start), yAt(y), 0], [xAt(start), yAt(y+1), 0],
        [xAt(x), yAt(y+1), 0], [xAt(x), yAt(y), 0]);
    }
  }
  for (const [x, y] of body.edge) {
    const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dy] of neighbors) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < BODY_WIDTH && ny >= 0 && ny < BODY_HEIGHT &&
          body.mask[ny * BODY_WIDTH + nx] === "1") continue;
      const a = dx ? [xAt(x + (dx > 0 ? 1 : 0)), yAt(y), 0]
        : [xAt(x), yAt(y + (dy > 0 ? 1 : 0)), 0];
      const b = dx ? [a[0], yAt(y+1), 0] : [xAt(x+1), a[1], 0];
      quad(sides, a, b, [b[0], b[1], -height], [a[0], a[1], -height]);
    }
  }
  function surface(vertices, tint) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: tint,
      roughness: .72, metalness: .08, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
  const group = new THREE.Group();
  group.add(surface(top, color), surface(sides, new THREE.Color(color).multiplyScalar(.55)));
  return group;
}
