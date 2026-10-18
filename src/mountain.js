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
  // Six stone courses per collision box, drawn in one GPU call.
  const stones = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xf4e4c4, roughness: 1 }), OBSTACLES.length * 6);
  const dummy = new THREE.Object3D();
  OBSTACLES.forEach((box, index) => {
    const alongX = box.width > box.depth;
    for (let row = 0; row < 2; row++) for (let piece = 0; piece < 3; piece++) {
      dummy.position.set(box.x + (alongX ? (piece - 1) * box.width / 3 : 0),
        box.y + (alongX ? 0 : (piece - 1) * box.depth / 3), (row + .5) * box.height / 2);
      dummy.scale.set(alongX ? box.width / 3 - .025 : box.width,
        alongX ? box.depth : box.depth / 3 - .025, box.height / 2 - .025);
      dummy.updateMatrix();
      const i = index * 6 + row * 3 + piece;
      stones.setMatrixAt(i, dummy.matrix);
      stones.setColorAt(i, new THREE.Color((row + piece) % 3 === 0 ? 0xcab693 : 0xe1cfab));
    }
  });
  stones.castShadow = stones.receiveShadow = true;
  scene.add(stones);
  return new Promise((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load("/assets/mountain.glb", (gltf) => {
      gltf.scene.rotation.x = Math.PI / 2; // Imported Blender axes → Z-up gameplay.
      gltf.scene.traverse((object) => {
        if (object.isMesh) object.castShadow = object.receiveShadow = true;
        if (object.name.toLowerCase().includes("cloud")) object.castShadow = object.receiveShadow = false;
        if (object.name.toLowerCase().includes("atmosphere")) {
          object.material = new THREE.MeshBasicMaterial({ map: object.material.map,
            transparent: true, depthWrite: false, side: THREE.DoubleSide });
          object.castShadow = object.receiveShadow = false;
        }
      });
      scene.add(gltf.scene);
      resolve();
    }, undefined, reject);
  });
}
