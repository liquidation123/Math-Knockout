import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { OBSTACLES } from "./physics.js";

export function createMountain(scene, mode = "projectile") {
  // A solid sky surrounds every camera direction without extra skybox images.
  scene.background = new THREE.Color(0x78c8fb);
  // XY is horizontal; keep the sea below the cliff and out of gameplay physics.
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    // Repeating sine bands give the water subtle ripples without an image download.
    const wave = Math.cos((y + 2 * Math.sin(x * Math.PI / 32)) * Math.PI / 8);
    const shade = wave > 0.96 ? 255 : 220;
    pixels.set([shade, shade, shade, 255], (y * 64 + x) * 4);
  }
  const ripples = new THREE.DataTexture(pixels, 64, 64);
  ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
  ripples.repeat.set(80, 80);
  ripples.magFilter = THREE.LinearFilter;
  ripples.minFilter = THREE.LinearMipmapLinearFilter;
  ripples.generateMipmaps = ripples.needsUpdate = true;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardMaterial({ color: 0x218eb5, map: ripples, roughness: 0.35, metalness: 0.1 }));
  water.name = "Water below mountain";
  water.position.z = -22;
  scene.add(water);
  const ambient = new THREE.HemisphereLight(0xfffaf0, 0xb4a47a, 1.5);
  ambient.position.set(0, 0, 1);
  scene.add(ambient);
  const light = new THREE.DirectionalLight(0xfff5db, 2.3);
  light.position.set(-4, 8, 10);
  light.castShadow = true;
  Object.assign(light.shadow.camera, { left: -18, right: 18, top: 12, bottom: -12 });
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);
  // Only Projectile Duel has walls; Bump Duel is an open summit.
  const barriers = (mode === "bump" ? [] : OBSTACLES).map((box) => {
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
        if (mode === "bump" && object.name.toLowerCase().includes("ruins")) object.visible = false;
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
