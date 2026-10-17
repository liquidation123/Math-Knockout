import * as THREE from "three";
import { ARENA, PLAYER_SIZE, OBSTACLES } from "./physics.js";
import { PROJECTILE_RADIUS } from "./projectile.js";
import { buildCartesianGrid, coordinateText } from "./grid.js";
import { effectKind, pathLookAhead } from "./cinematic.js";

export function createCamera() {
  const camera = new THREE.OrthographicCamera(-12, 12, 6, -6, 0.1, 100);
  camera.position.set(0, 0, 24);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function frameCamera(camera, aspect, topInset = 0, bottomInset = 0) {
  // Insets are fractions of viewport height occupied by the gameplay controls.
  const usableHeight = Math.max(0.1, 1 - topInset - bottomInset);
  const halfHeight = Math.max(
    (ARENA.depth / 2 + 1) / usableHeight, (ARENA.halfWidth + 1) / aspect,
  );
  const shift = (topInset - bottomInset) * halfHeight;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = shift + halfHeight;
  camera.bottom = shift - halfHeight;
  camera.updateProjectionMatrix();
}

export function createView(container, hud, controls) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x152032);

  const birdCamera = createCamera();
  // An orthographic POV keeps the same mathematical scale as the bird's-eye map.
  const povCamera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 100);
  povCamera.up.set(0, 0, 1);
  let activeCamera = birdCamera;
  let cinematicMode = "bird";
  let cinematicAttack = null;
  let cinematicTimer = 0;
  let impactPoint = null;
  let trailAttack = null;
  let trailPoints = [];
  const effects = [];

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.localClippingEnabled = true;
  const curveBounds = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), ARENA.halfWidth),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), ARENA.halfWidth),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), ARENA.depth / 2),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), ARENA.depth / 2),
  ];
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "Select a character in the combat arena");
  container.prepend(renderer.domElement);

  const ambient = new THREE.HemisphereLight(0xe9f3ff, 0x344259, 2);
  ambient.position.set(0, 0, 1);
  scene.add(ambient);
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(-4, 8, 10);
  light.castShadow = true;
  light.shadow.camera.left = -18;
  light.shadow.camera.right = 18;
  light.shadow.camera.top = 12;
  light.shadow.camera.bottom = -12;
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


  const gridLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xa8bbd1, transparent: true, opacity: 0.22 }),
  );
  const gridAxes = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xe7eef8, transparent: true, opacity: 0.8 }),
  );
  scene.add(gridLines, gridAxes);
  const labels = document.createElement("div");
  labels.className = "cartesian-labels";
  container.append(labels);
  const axisLabels = document.createElement("div");
  labels.append(axisLabels);
  const characterLabels = Array.from({ length: 6 }, () => {
    const label = document.createElement("div");
    label.className = "coordinate-label";
    labels.append(label);
    return label;
  });
  let gridKey = "";
  let ticks = [];

  function positionLabel(label, point) {
    const projected = new THREE.Vector3(point.x, point.y, 0).project(birdCamera);
    const x = (projected.x + 1) * container.clientWidth / 2;
    label.style.left = label.classList.contains("coordinate-label")
      ? Math.max(68, Math.min(container.clientWidth - 68, x)) + "px" : x + "px";
    label.style.top = (1 - projected.y) * container.clientHeight / 2 + "px";
  }

  function drawGrid(players, selectedIndex) {
    const shooter = players[selectedIndex];
    const visible = Boolean(shooter && !shooter.eliminated);
    gridLines.visible = gridAxes.visible = visible && activeCamera === birdCamera;
    labels.hidden = !visible || activeCamera !== birdCamera;
    if (!visible) return;
    const origin = shooter.position;
    const key = origin.x + "," + origin.y;
    if (key !== gridKey) {
      gridKey = key;
      const data = buildCartesianGrid(origin);
      for (const [mesh, lines] of [[gridLines, data.lines], [gridAxes, data.axes]]) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.BufferGeometry().setFromPoints(lines.flatMap((line) => [
          new THREE.Vector3(line.x1, line.y1, 0.02), new THREE.Vector3(line.x2, line.y2, 0.02),
        ]));
      }
      axisLabels.replaceChildren();
      ticks = data.labels.map((tick) => {
        const label = document.createElement("span");
        label.className = "axis-label " + tick.kind;
        label.textContent = tick.text;
        label.setAttribute("aria-hidden", "true");
        axisLabels.append(label);
        return { ...tick, label };
      });
    }
    ticks.forEach((tick) => positionLabel(tick.label, tick));
    const placedLabels = [];
    characterLabels.forEach((label, index) => {
      const player = players[index];
      label.hidden = player.eliminated || (index !== selectedIndex && player.team === shooter.team);
      if (label.hidden) return;
      label.textContent = player.name + " " + coordinateText(player.position, origin);
      label.className = "coordinate-label " + (index === selectedIndex ? "shooter-coordinate" : "enemy-coordinate");
      positionLabel(label, player.position);
      // Move only the text upward if nearby characters' labels would cover each other.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const rect = label.getBoundingClientRect();
        const overlaps = placedLabels.some((other) =>
          rect.left < other.right + 3 && rect.right + 3 > other.left &&
          rect.top < other.bottom + 3 && rect.bottom + 3 > other.top);
        if (!overlaps) break;
        label.style.top = Number.parseFloat(label.style.top) - rect.height - 3 + "px";
      }
      placedLabels.push(label.getBoundingClientRect());
    });
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
  const trail = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.8, depthTest: false }),
  );
  trail.renderOrder = 3;
  trail.visible = false;
  scene.add(trail);

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
    trail.visible = Boolean(attack);
    if (!attack) {
      trailAttack = null;
      trailPoints = [];
      return;
    }
    projectile.position.set(attack.position.x, attack.position.y, attack.position.z);
    if (attack !== trailAttack) {
      trailAttack = attack;
      trailPoints = [];
    }
    const last = trailPoints[trailPoints.length - 1];
    if (!last || last.distanceTo(projectile.position) > 0.03) {
      trailPoints.push(projectile.position.clone());
      if (trailPoints.length > 12) trailPoints.shift();
      if (trailPoints.length >= 2) trail.geometry.setFromPoints(trailPoints);
    }
  }

  function projectileViewTarget(attack, atImpact = false) {
    const point = atImpact && impactPoint ? impactPoint : attack.position;
    const look = pathLookAhead(attack.path, point, attack.segment, 3);
    const forward = new THREE.Vector3(look.forward.x, look.forward.y, 0);
    const height = point.z + 0.6;
    // Equal camera and target heights keep the viewing direction entirely in XY.
    const target = new THREE.Vector3(look.target.x, look.target.y, height);
    const desired = new THREE.Vector3(point.x, point.y, height);
    desired.addScaledVector(forward, -1.6);
    return { desired, target };
  }

  function beginProjectilePOV(attack) {
    if (!attack) return;
    cinematicAttack = attack;
    cinematicMode = "projectile";
    cinematicTimer = 0;
    impactPoint = null;
    activeCamera = povCamera;
    const view = projectileViewTarget(attack);
    povCamera.position.copy(view.desired);
    povCamera.lookAt(view.target);
  }

  function notifyProjectileStopped(attack) {
    if (!attack || attack !== cinematicAttack) return;
    const kind = effectKind(attack.reason);
    if (kind) {
      impactPoint = attack.impactPoint || attack.position;
      cinematicMode = "impact";
      cinematicTimer = 0;
    } else {
      finishProjectilePOV();
    }
  }

  function finishProjectilePOV() {
    activeCamera = birdCamera;
    cinematicMode = "bird";
    cinematicAttack = null;
    cinematicTimer = 0;
    impactPoint = null;
  }

  function setProjectilePOVEnabled(enabled) {
    if (!enabled) {
      finishProjectilePOV();
      trail.visible = false;
    }
  }

  function resetCinematic() {
    activeCamera = birdCamera;
    cinematicMode = "bird";
    cinematicAttack = null;
    impactPoint = null;
    trailAttack = null;
    trailPoints = [];
    trail.visible = false;
    clearEffects();
  }

  function updateCinematic(attack, dt, enabled) {
    if (!enabled) return;
    if (attack && !attack.stopped && attack !== cinematicAttack) beginProjectilePOV(attack);
    if (!cinematicAttack) return;
    if (cinematicMode === "impact") {
      cinematicTimer += dt;
      const view = projectileViewTarget(cinematicAttack, true);
      povCamera.position.copy(view.desired);
      povCamera.lookAt(view.target);
      if (cinematicTimer > 0.3) {
        finishProjectilePOV();
      }
      return;
    }
    if (!attack || attack.stopped) return;
    const view = projectileViewTarget(attack);
    povCamera.position.copy(view.desired);
    povCamera.lookAt(view.target);
    cinematicMode = "projectile";
  }

  function createImpact(reason, point) {
    const kind = effectKind(reason);
    if (!kind || !point) return;
    const enemy = kind === "enemy";
    const color = enemy ? 0x9fffea : 0xffa34f;
    const group = new THREE.Group();
    group.position.set(point.x, point.y, point.z || 0.5);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(enemy ? 0.28 : 0.18, 12, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false }),
    );
    group.add(flash);
    let ring = null;
    if (enemy) {
      ring = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.25, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
      );
      ring.position.z = 0.05;
      group.add(ring);
    }
    const particles = [];
    const count = enemy ? 12 : 7;
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      const speed = (enemy ? 2.2 : 1.5) * (0.75 + (index % 3) * 0.12);
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(enemy ? 0.055 : 0.045, 6, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false }),
      );
      group.add(particle);
      particles.push({ mesh: particle, velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 0.5 + (index % 2) * 0.4) });
    }
    group.renderOrder = 6;
    scene.add(group);
    effects.push({ group, flash, ring, particles, age: 0, duration: enemy ? 0.5 : 0.32 });
  }

  function updateEffects(dt) {
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      const effect = effects[index];
      effect.age += dt;
      const progress = Math.min(1, effect.age / effect.duration);
      effect.flash.scale.setScalar(1 + progress * (effect.ring ? 2.5 : 1.3));
      effect.flash.material.opacity = 1 - progress;
      if (effect.ring) {
        effect.ring.scale.setScalar(1 + progress * 4);
        effect.ring.material.opacity = 0.9 * (1 - progress);
      }
      effect.particles.forEach((particle) => {
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.velocity.z -= 3 * dt;
        particle.mesh.material.opacity = 1 - progress;
      });
      if (progress >= 1) {
        scene.remove(effect.group);
        effect.group.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) object.material.dispose();
        });
        effects.splice(index, 1);
      }
    }
  }

  function clearEffects() {
    effects.splice(0).forEach((effect) => {
      scene.remove(effect.group);
      effect.group.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
    });
  }

  function onCharacterClick(select) {
    const raycaster = new THREE.Raycaster();
    renderer.domElement.addEventListener("pointerdown", (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const point = new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1,
      );
      if (activeCamera !== birdCamera) return;
      raycaster.setFromCamera(point, birdCamera);
      const hit = raycaster.intersectObjects(playerMeshes.filter((mesh) => mesh.visible), false)[0];
      if (hit) select(hit.object.userData.playerIndex);
      renderer.domElement.focus({ preventScroll: true });
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
      // Only the part inside the map is visible; sampling and firing share the same path.
      material.clippingPlanes = curveBounds;
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
    frameCamera(birdCamera, aspect, (hud.offsetHeight + 24) / height, (controls.offsetHeight + 24) / height);
    const povHalfHeight = 5;
    povCamera.left = -povHalfHeight * aspect;
    povCamera.right = povHalfHeight * aspect;
    povCamera.top = povHalfHeight;
    povCamera.bottom = -povHalfHeight;
    povCamera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  const observer = new ResizeObserver(resize);
  [container, hud, controls].forEach((element) => observer.observe(element));
  resize();

  return {
    canvas: renderer.domElement,
    drawPlayers,
    drawGrid,
    drawProjectile,
    onCharacterClick,
    drawCurve,
    removeCurve,
    beginProjectilePOV,
    notifyProjectileStopped,
    finishProjectilePOV,
    setProjectilePOVEnabled,
    resetCinematic,
    updateCinematic,
    createImpact,
    updateEffects,
    render: () => renderer.render(scene, activeCamera),
  };
}
