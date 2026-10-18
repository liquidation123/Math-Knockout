import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { OBSTACLES } from "./physics.js";

export function createMountain(scene) {
  scene.background = null;
  const ambient = new THREE.HemisphereLight(0xfffaf0, 0xb4a47a, 0.9);
  ambient.position.set(0, 0, 1);
  scene.add(ambient);
  const light = new THREE.DirectionalLight(0xfff5db, 2.7);
  light.position.set(-4, 8, 10);
  light.castShadow = true;
  Object.assign(light.shadow.camera, { left: -18, right: 18, top: 12, bottom: -12 });
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);
  // Rounded stone courses share one draw call; their outer edges match each collision box.
  const stoneTexture = typeof document === "undefined" ? null :
    new THREE.TextureLoader().load("/assets/limestone.jpg");
  if (stoneTexture) stoneTexture.colorSpace = THREE.SRGBColorSpace;
  const stones = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, .06),
    new THREE.MeshStandardMaterial({ map: stoneTexture, roughness: 1 }), OBSTACLES.length * 12);
  stones.material.color.setRGB(1.6, 1.55, 1.4);
  const dummy = new THREE.Object3D();
  OBSTACLES.forEach((box, index) => {
    const alongX = box.width > box.depth;
    for (let row = 0; row < 3; row++) for (let piece = 0; piece < 4; piece++) {
      dummy.position.set(box.x + (alongX ? (piece - 1.5) * box.width / 4 : 0),
        box.y + (alongX ? 0 : (piece - 1.5) * box.depth / 4), (row + .5) * box.height / 3);
      dummy.scale.set(alongX ? box.width / 4 - .012 : box.width - .012,
        alongX ? box.depth - .012 : box.depth / 4 - .012, box.height / 3 - .012);
      dummy.updateMatrix();
      const i = index * 12 + row * 4 + piece;
      stones.setMatrixAt(i, dummy.matrix);
      stones.setColorAt(i, new THREE.Color([0xffffff, 0xf2f2e9, 0xe9e9e3][(row * 3 + piece + index) % 3]));
    }
  });
  stones.instanceMatrix.needsUpdate = true;
  stones.instanceColor.needsUpdate = true;
  stones.castShadow = stones.receiveShadow = true;
  scene.add(stones);
  return new Promise((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load("/assets/mountain.glb", (gltf) => {
      gltf.scene.rotation.x = Math.PI / 2; // Imported Blender axes → Z-up gameplay.
      scene.userData.atmosphere = [];
      gltf.scene.traverse((object) => {
        if (object.isMesh) object.castShadow = object.receiveShadow = true;
        if (/cloud|grass|flower|foliage/i.test(object.name)) object.castShadow = false;
        if (/cloud/i.test(object.name)) object.receiveShadow = false;
        if (object.name.toLowerCase().includes("atmosphere")) {
          scene.userData.atmosphere.push(object);
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
