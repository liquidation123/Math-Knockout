import * as THREE from "three";
import { ARENA, PLAYER_SIZE } from "./physics.js";
import { createMountain } from "./mountain.js";
import { clipCurveSections } from "./terrain.js";
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

export function createProjectileCamera() {
  // Perspective makes floor and wall depth visible while looking level along XY.
  const camera = new THREE.PerspectiveCamera(65, 1, 0.03, 100);
  camera.up.set(0, 0, 1);
  return camera;
}

export function aimProjectileCamera(camera, attack, point = attack.position) {
  const look = pathLookAhead(attack.path, point, attack.segment, 3);
  camera.position.set(point.x - look.forward.x * 1.6, point.y - look.forward.y * 1.6, point.z);
  // Same height and a direct aim keep the bullet centered without Z tilt.
  camera.lookAt(point.x, point.y, point.z);
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

export function createView(container, hud, controls, mode = "projectile") {
  const scene = new THREE.Scene();

  const birdCamera = createCamera();
  const summitCamera = new THREE.PerspectiveCamera(52, 1, 0.1, 160);
  summitCamera.up.set(0, 0, 1);
  const characterCamera = new THREE.PerspectiveCamera(72, 1, 0.05, 160);
  characterCamera.up.set(0, 0, 1);
  let viewMode = mode === "bump" ? "character" : "map";
  let lookYaw = 0, lookPitch = 0, lookAtIndex = -1;
  const overviewCamera = () => viewMode === "map" ? birdCamera :
    viewMode === "character" ? characterCamera : summitCamera;
  const povCamera = createProjectileCamera();
  let activeCamera = overviewCamera();
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
  renderer.domElement.addEventListener("click", () => {
    if (mode === "bump" && viewMode === "character") renderer.domElement.requestPointerLock?.();
  });
  document.addEventListener("mousemove", (event) => {
    if (mode !== "bump" || document.pointerLockElement !== renderer.domElement) return;
    lookYaw += event.movementX * 0.0025;
    lookPitch = Math.max(-1.2, Math.min(1.2, lookPitch - event.movementY * 0.0025));
  });

  const ready = createMountain(scene);

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
    const projected = new THREE.Vector3(point.x, point.y, 0).project(overviewCamera());
    const x = (projected.x + 1) * container.clientWidth / 2;
    label.style.left = label.classList.contains("coordinate-label")
      ? Math.max(68, Math.min(container.clientWidth - 68, x)) + "px" : x + "px";
    label.style.top = (1 - projected.y) * container.clientHeight / 2 + "px";
  }

  function drawGrid(players, selectedIndex) {
    const shooter = players[selectedIndex];
    const visible = Boolean(shooter && !shooter.eliminated);
    gridLines.visible = gridAxes.visible = visible && activeCamera === overviewCamera() && viewMode !== "character";
    labels.hidden = !visible || activeCamera !== overviewCamera() || viewMode === "character";
    if (!visible) return;
    const origin = shooter.position;
    const key = origin.x + "," + origin.y;
    if (key !== gridKey) {
      gridKey = key;
      const data = buildCartesianGrid(origin);
      for (const [mesh, lines] of [[gridLines, data.lines], [gridAxes, data.axes]]) {
        mesh.geometry.dispose();
        const clipped = clipCurveSections(lines.map((line) => [
          { x: line.x1, y: line.y1, z: 0.02 }, { x: line.x2, y: line.y2, z: 0.02 },
        ]));
        mesh.geometry = new THREE.BufferGeometry().setFromPoints(clipped.flat().map((point) =>
          new THREE.Vector3(point.x, point.y, point.z)));
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
      label.hidden = !player || player.eliminated || (index !== selectedIndex && player.team === shooter.team);
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
  // Reserve space once: setFromPoints cannot grow an existing vertex buffer.
  const trailLength = 12;
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(trailLength * 3), 3));
  trailGeometry.setDrawRange(0, 0);
  const trail = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.8, depthTest: false }),
  );
  trail.renderOrder = 3;
  trail.visible = false;
  scene.add(trail);

  function drawPlayers(players, selectedIndex = null) {
    playerMeshes.forEach((mesh, index) => {
      const player = players[index];
      mesh.visible = Boolean(player && !player.eliminated && !(viewMode === "character" && index === selectedIndex));
      if (!mesh.visible) return;
      const position = player.position;
      mesh.position.set(position.x, position.y, position.z);
      mesh.material.color.setHex(player.team === 0 ? 0x76b7ff : 0xff8c99);
      mesh.children[0].visible = index === selectedIndex;
      if (mesh.userData.drawing) mesh.userData.tilt = -player.velocity.x * 0.08;
    });
  }

  function setPlayerShape(index, mask) {
    const mesh = playerMeshes[index];
    if (mesh.userData.drawing) {
      const drawing = mesh.userData.drawing;
      mesh.remove(drawing);
      drawing.traverse((object) => {
        object.geometry?.dispose();
        object.material?.map?.dispose();
        object.material?.dispose();
      });
      mesh.userData.drawing = null;
    }
    mesh.material.transparent = false;
    mesh.material.opacity = 1;
    mesh.material.depthWrite = true;
    if (!mask?.includes("1")) return;
    const occupied = [];
    for (let i = 0; i < mask.length; i++) if (mask[i] === "1") occupied.push(i);
    const left = Math.min(...occupied.map((i) => i % 128));
    const right = Math.max(...occupied.map((i) => i % 128));
    const top = Math.min(...occupied.map((i) => Math.floor(i / 128)));
    const bottom = Math.max(...occupied.map((i) => Math.floor(i / 128)));
    const width = right - left + 1, height = bottom - top + 1;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    const pixels = context.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const visible = mask[(y + top) * 128 + x + left] === "1";
      pixels.data.set([40, 49, 63, visible ? 255 : 0], (y * width + x) * 4);
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    const color = index < (mode === "bump" ? 1 : 3) ? 0x76b7ff : 0xff8c99;
    const drawing = new THREE.Group();
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.72, 40),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.59, 40),
      new THREE.MeshBasicMaterial({ color: 0xfff8e7, side: THREE.DoubleSide }));
    face.position.z = 0.01;
    const aspect = width / height;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.02 * Math.min(aspect, 1), 1.02 / Math.max(aspect, 1)),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    art.position.z = 0.02;
    drawing.add(badge, face, art);
    mesh.add(drawing);
    mesh.userData.drawing = drawing;
    // Keep the original cube as the click target and physical proxy, while showing the sketch.
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
    mesh.material.depthWrite = false;
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
      if (trailPoints.length > trailLength) trailPoints.shift();
      const positions = trailGeometry.getAttribute("position");
      trailPoints.forEach((point, index) => positions.setXYZ(index, point.x, point.y, point.z));
      positions.needsUpdate = true;
      trailGeometry.setDrawRange(0, trailPoints.length);
      trailGeometry.computeBoundingSphere();
    }
  }

  function beginProjectilePOV(attack) {
    if (!attack) return;
    cinematicAttack = attack;
    cinematicMode = "projectile";
    cinematicTimer = 0;
    impactPoint = null;
    activeCamera = povCamera;
    aimProjectileCamera(povCamera, attack);
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
    activeCamera = overviewCamera();
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
    activeCamera = overviewCamera();
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
      aimProjectileCamera(povCamera, cinematicAttack, impactPoint || cinematicAttack.position);
      if (cinematicTimer > 0.3) {
        finishProjectilePOV();
      }
      return;
    }
    if (!attack || attack.stopped) return;
    aimProjectileCamera(povCamera, attack);
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

  function onCharacterClick(select, selectCurvePoint) {
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
      else if (selectCurvePoint) {
        const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.5), new THREE.Vector3());
        if (point) selectCurvePoint(point);
      }
      renderer.domElement.focus({ preventScroll: true });
    });
  }

  function drawCurve(sections, color, preview = false) {
    const group = new THREE.Group();
    for (const points of clipCurveSections(sections)) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        points.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
      );
      const material = preview
        ? new THREE.LineDashedMaterial({
          color, dashSize: 0.15, gapSize: 0.12,
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
    const distance = Math.max(46, 40 / aspect);
    summitCamera.position.set(0, -distance * 0.8, distance * 0.7);
    summitCamera.lookAt(0, 0, -5);
    summitCamera.aspect = characterCamera.aspect = aspect;
    summitCamera.updateProjectionMatrix();
    characterCamera.updateProjectionMatrix();
    povCamera.aspect = aspect;
    povCamera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  const observer = new ResizeObserver(resize);
  [container, hud, controls].forEach((element) => observer.observe(element));
  resize();

  function setViewMode(mode) {
    viewMode = mode;
    if (mode === "character") lookAtIndex = -1;
    if (document.pointerLockElement === renderer.domElement && mode !== "character") document.exitPointerLock();
    if (activeCamera !== povCamera) activeCamera = overviewCamera();
  }

  function updateCharacterCamera(players, selectedIndex) {
    if (viewMode !== "character" || selectedIndex == null) return;
    const player = players[selectedIndex];
    if (!player || player.eliminated) return;
    if (lookAtIndex !== selectedIndex) {
      lookAtIndex = selectedIndex;
      lookYaw = player.team === 0 ? 0 : Math.PI;
      lookPitch = -0.06;
    }
    characterCamera.position.set(player.position.x, player.position.y, player.position.z + 0.65);
    characterCamera.lookAt(
      player.position.x + Math.cos(lookYaw) * Math.cos(lookPitch),
      player.position.y + Math.sin(lookYaw) * Math.cos(lookPitch),
      player.position.z + 0.65 + Math.sin(lookPitch),
    );
  }

  return {
    ready,
    setViewMode,
    updateCharacterCamera,
    setPlayerShape,
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
    render: () => {
      playerMeshes.forEach((mesh) => {
        if (!mesh.userData.drawing) return;
        mesh.userData.drawing.quaternion.copy(activeCamera.quaternion);
        mesh.userData.drawing.rotateZ(mesh.userData.tilt || 0);
      });
      renderer.render(scene, activeCamera);
    },
  };
}
