import * as THREE from "three";
import { ARENA, PLAYER_SIZE, OBSTACLES } from "./physics.js";
import { PROJECTILE_RADIUS } from "./projectile.js";

export function createCamera() {
  const camera = new THREE.OrthographicCamera(-12, 12, 6, -6, 0.1, 100);
  camera.position.set(0, 0, 24);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function frameCamera(camera, aspect) {
  const halfHeight = Math.max(ARENA.depth / 2 + 2, (ARENA.halfWidth + 2) / aspect);
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

export function createView(container, iteration) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x152032);

  const camera = createCamera();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "Game movement area");
  container.prepend(renderer.domElement);

  const ambient = new THREE.HemisphereLight(0xe9f3ff, 0x344259, 2);
  ambient.position.set(0, 0, 1);
  scene.add(ambient);
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(-4, 8, 10);
  light.castShadow = true;
  light.shadow.camera.left = -14;
  light.shadow.camera.right = 14;
  light.shadow.camera.top = 10;
  light.shadow.camera.bottom = -10;
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);

  // The ground is scenery only. Falling below z = -5 ends the round.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x18263b, roughness: 1 }),
  );
  ground.position.z = -5.8;
  ground.receiveShadow = true;
  scene.add(ground);
  const groundGrid = new THREE.GridHelper(40, 40, 0x405979, 0x293e59);
  groundGrid.rotation.x = Math.PI / 2;
  groundGrid.position.z = -5.79;
  scene.add(groundGrid);

  // The platform's upper face lies on the XY plane at z = 0.
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA.halfWidth * 2, ARENA.depth, ARENA.thickness),
    new THREE.MeshStandardMaterial({ color: 0x53647d, roughness: 0.9 }),
  );
  platform.position.z = ARENA.top - ARENA.thickness / 2;
  platform.castShadow = true;
  platform.receiveShadow = true;
  scene.add(platform);

  OBSTACLES.forEach((obstacle) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(obstacle.width, obstacle.depth, obstacle.height),
      new THREE.MeshStandardMaterial({ color: 0xdca25a, roughness: 0.8 }),
    );
    mesh.position.set(obstacle.x, obstacle.y, obstacle.height / 2);
    mesh.castShadow = true;
    scene.add(mesh);
  });

  // The rendering iteration shows an XY grid to explain equation coordinates.
  if (iteration === 1) {
    const grid = new THREE.GridHelper(24, 24, 0x3c516e, 0x26384f);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.02;
    scene.add(grid);
  }

  const cubeGeometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
  const playerMeshes = Array.from({ length: 6 }, (_, index) => {
    const color = index < 3 ? 0x76b7ff : 0xff8c99;
    const mesh = new THREE.Mesh(
      cubeGeometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
    );
    mesh.castShadow = true;
    mesh.userData.playerIndex = index;
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(cubeGeometry),
      new THREE.LineBasicMaterial({ color: 0xffef8b, depthTest: false }),
    );
    outline.scale.setScalar(1.2);
    outline.renderOrder = 3;
    mesh.add(outline);
    scene.add(mesh);
    return mesh;
  });

  const projectile = new THREE.Mesh(
    new THREE.SphereGeometry(PROJECTILE_RADIUS, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xfff6cf, emissive: 0xffdc68, emissiveIntensity: 5,
      toneMapped: false, depthTest: false,
    }),
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(PROJECTILE_RADIUS * 2.5, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0xffdc68, transparent: true, opacity: 0.2, depthWrite: false, depthTest: false,
    }),
  );
  projectile.add(halo);
  projectile.renderOrder = 4;
  projectile.visible = false;
  scene.add(projectile);

  function drawPlayers(players, selectedIndex = null) {
    playerMeshes.forEach((mesh, index) => {
      const player = players[index];
      mesh.visible = Boolean(player && !player.eliminated);
      if (!mesh.visible) return;
      const position = player.position;
      mesh.position.set(position.x, position.y, position.z);
      mesh.material.color.setHex(player.team === 0 ? 0x76b7ff : 0xff8c99);
      mesh.children[0].visible = index === selectedIndex;
    });
  }

  function drawProjectile(attack) {
    projectile.visible = Boolean(attack);
    if (attack) projectile.position.set(attack.position.x, attack.position.y, attack.position.z);
  }

  function onCharacterClick(select) {
    const raycaster = new THREE.Raycaster();
    renderer.domElement.addEventListener("pointerdown", (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const point = new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1,
      );
      raycaster.setFromCamera(point, camera);
      const hit = raycaster.intersectObjects(playerMeshes.filter((mesh) => mesh.visible), false)[0];
      if (hit) select(hit.object.userData.playerIndex);
      renderer.domElement.focus();
    });
  }

  function drawCurve(sections, color, preview = false) {
    const group = new THREE.Group();
    for (const points of sections) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        points.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
      );
      const material = preview
        ? new THREE.LineDashedMaterial({
          color: 0xffffff, dashSize: 0.15, gapSize: 0.12,
          transparent: true, opacity: 0.6, depthTest: false,
        })
        : new THREE.LineBasicMaterial({ color, depthTest: false });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.renderOrder = preview ? 1 : 2;
      group.add(line);
    }
    scene.add(group);
    return group;
  }

  function removeCurve(group) {
    scene.remove(group);
    group.children.forEach((line) => {
      line.geometry.dispose();
      line.material.dispose();
    });
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;
    frameCamera(camera, aspect);
    renderer.setSize(width, height);
  }

  new ResizeObserver(resize).observe(container);
  resize();

  return {
    canvas: renderer.domElement,
    drawPlayers,
    drawProjectile,
    onCharacterClick,
    drawCurve,
    removeCurve,
    render: () => renderer.render(scene, camera),
  };
}
