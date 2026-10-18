import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { OBSTACLES } from "./physics.js";

export function createMountain(scene) {
  scene.background = null;
  const ambient = new THREE.HemisphereLight(0xfffaf0, 0xb4a47a, 1.5);
  ambient.position.set(0, 0, 1);
  scene.add(ambient);
  const light = new THREE.DirectionalLight(0xfff5db, 2.3);
  light.position.set(-4, 8, 10);
  light.castShadow = true;
  Object.assign(light.shadow.camera, { left: -18, right: 18, top: 12, bottom: -12 });
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);
  // Reuse the original combat boxes, dressed as stone. No invisible old walls.
  const barriers = OBSTACLES.map((box) => {
    const block = new THREE.Mesh(new THREE.BoxGeometry(box.width, box.depth, box.height),
      new THREE.MeshStandardMaterial({ color: 0xe9d6a7, roughness: 1 }));
    block.position.set(box.x, box.y, box.height / 2);
    block.castShadow = block.receiveShadow = true;
    scene.add(block);
    return block;
  });
  return new Promise((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load("/assets/mountain.glb", (gltf) => {
      gltf.scene.rotation.x = Math.PI / 2; // Imported Blender axes → Z-up gameplay.
      gltf.scene.traverse((object) => {
        if (object.isMesh) object.castShadow = object.receiveShadow = true;
        if (object.name.toLowerCase().includes("limestone") && object.material.map) {
          barriers.forEach((block) => { block.material.map = object.material.map; block.material.needsUpdate = true; });
        }
        if (object.name.toLowerCase().includes("cloud")) {
          object.material = new THREE.MeshBasicMaterial({ map: object.material.map,
            transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
          object.castShadow = object.receiveShadow = false;
        }
      });
      scene.add(gltf.scene);
      resolve();
    }, undefined, reject);
  });
}
