import * as THREE from "three";
import { ARENA } from "./terrain.js";

// Bump's playable ground is circular. Keep the painted mountain materials,
// but give its summit and cliff the very same radius used by combat physics.
export function createErodingIsland(root) {
  root.updateMatrixWorld(true);
  const island = new THREE.Group(), decorations = [];
  let top, cliff, cliffPositions;
  root.traverse((object) => {
    if (!object.isMesh || !object.visible) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const mesh = new THREE.Mesh(geometry, object.material);
    mesh.castShadow = object.castShadow;
    mesh.receiveShadow = true;
    object.visible = false;
    if (/Playable.grass.top/i.test(object.name)) {
      geometry.dispose();
      mesh.geometry = new THREE.CircleGeometry(1, 96);
      top = mesh;
    } else if (/Sculpted.limestone.cliff/i.test(object.name)) {
      cliff = mesh;
      cliffPositions = geometry.attributes.position.array.slice();
    } else {
      decorations.push({ mesh, indices: Array.from(geometry.index?.array ||
        Array.from({ length: geometry.attributes.position.count }, (_, i) => i)),
        groups: geometry.groups.map((group) => ({ ...group })) });
    }
    island.add(mesh);
  });
  island.setRadius = (radius) => {
    if (top) {
      top.scale.set(radius, radius, 1);
      const { position, uv } = top.geometry.attributes;
      for (let i = 0; i < uv.count; i++) {
        // Fixed world-space UVs: the meadow is cut away, not stretched smaller.
        uv.setXY(i, (position.getX(i) * radius + ARENA.halfWidth) / (2 * ARENA.halfWidth),
          (position.getY(i) * radius + ARENA.depth / 2) / ARENA.depth);
      }
      uv.needsUpdate = true;
    }
    if (cliff) {
      const positions = cliff.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = cliffPositions[i * 3], y = cliffPositions[i * 3 + 1], z = cliffPositions[i * 3 + 2];
        const distance = Math.hypot(x, y);
        // Convert the original rounded rectangle into a circle, retaining its ridges below the lip.
        const fraction = Math.abs(z) < .02 ? 1 :
          (Math.abs(x / ARENA.halfWidth) ** ARENA.power + Math.abs(y / (ARENA.depth / 2)) ** ARENA.power) ** (1 / ARENA.power);
        const scale = distance ? radius * fraction / distance : 0;
        positions.setXYZ(i, x * scale, y * scale, z);
      }
      positions.needsUpdate = true;
      cliff.geometry.computeVertexNormals();
      cliff.geometry.computeBoundingSphere();
    }
    for (const { mesh, indices, groups } of decorations) {
      const positions = mesh.geometry.attributes.position, kept = [];
      mesh.geometry.clearGroups();
      for (const group of groups.length ? groups : [{ start: 0, count: indices.length, materialIndex: 0 }]) {
        const start = kept.length;
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const triangle = indices.slice(i, i + 3);
          if (triangle.every((index) => Math.hypot(positions.getX(index), positions.getY(index)) < radius)) kept.push(...triangle);
        }
        mesh.geometry.addGroup(start, kept.length - start, group.materialIndex);
      }
      mesh.geometry.setIndex(kept);
    }
  };
  return island;
}
