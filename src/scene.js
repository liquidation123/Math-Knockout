import * as THREE from "three";
import { ARENA, PLAYER_SIZE } from "./physics.js";
import { createMountain } from "./mountain.js";
import { clipCurveSections } from "./terrain.js";
import { PROJECTILE_RADIUS } from "./projectile.js";
import { buildCartesianGrid, coordinateText } from "./grid.js";
import { effectKind, pathLookAhead } from "./cinematic.js";
import { projectilePlan } from "./attack-paths.js";

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
  const look = pathLookAhead(attack.lookPath || attack.path, point, attack.lookPath ? 1 : attack.segment, 3);
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

function starterMask(index, mode) {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 80;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "white";
  const red = index >= (mode === "bump" ? 1 : 3);
  // Simple, distinct silhouettes for players who have not drawn a character.
  ctx.fillRect(48, 26, 32, 30);
  ctx.fillRect(42, 32, 7, 17); ctx.fillRect(79, 32, 7, 17);
  ctx.fillRect(51, 55, 9, 18); ctx.fillRect(68, 55, 9, 18);
  if (red) {
    ctx.beginPath();
    ctx.moveTo(48, 29); ctx.lineTo(42, 5); ctx.lineTo(60, 20);
    ctx.lineTo(68, 20); ctx.lineTo(86, 5); ctx.lineTo(80, 29);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(48, 22, 32, 15);
  } else {
    ctx.fillRect(49, 12, 30, 19);
    ctx.fillRect(57, 4, 14, 9);
    ctx.fillRect(54, 29, 6, 7); ctx.fillRect(68, 29, 6, 7);
  }
  const pixels = ctx.getImageData(0, 0, 128, 80).data;
  return Array.from({ length: 10240 }, (_, i) => pixels[i * 4 + 3] ? "1" : "0").join("");
}

export function createAimGeometry(points, width) {
  const vertices = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1], b = points[index];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!length) continue;
    // A flat ribbon gives real width; WebGL's ordinary lines are usually one pixel.
    const nx = -dy / length * width / 2, ny = dx / length * width / 2;
    const leftA = [a.x + nx, a.y + ny, a.z], rightA = [a.x - nx, a.y - ny, a.z];
    const leftB = [b.x + nx, b.y + ny, b.z], rightB = [b.x - nx, b.y - ny, b.z];
    vertices.push(...leftA, ...rightA, ...leftB, ...leftB, ...rightA, ...rightB);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

export function createDotPreview(paths) {
  const group = new THREE.Group();
  group.renderOrder = 10; // Draw after transparent mountain art, like a visible aiming overlay.
  for (const points of paths) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xe6a5ff, transparent: true, opacity: 1,
        depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    dot.position.set(points[0].x, points[0].y, points[0].z);
    dot.renderOrder = 10;
    group.add(dot);
  }
  return group;
}

export function createView(container, hud, controls, mode = "projectile") {
  const scene = new THREE.Scene();

  const birdCamera = createCamera();
  const summitCamera = new THREE.PerspectiveCamera(52, 1, 0.1, 160);
  summitCamera.up.set(0, 0, 1);
  const followCamera = new THREE.PerspectiveCamera(62, 1, 0.1, 160);
  followCamera.up.set(0, 0, 1);
  const characterCamera = new THREE.PerspectiveCamera(72, 1, 0.05, 160);
  characterCamera.up.set(0, 0, 1);
  let viewMode = mode === "bump" ? "character" : "map";
  let lookYaw = 0, lookPitch = 0, lookAtIndex = -1;
  const overviewCamera = () => viewMode === "map" ? birdCamera :
    viewMode === "character" ? characterCamera : viewMode === "follow" ? followCamera : summitCamera;
  const povCamera = createProjectileCamera();
  let activeCamera = overviewCamera();
  let cinematicMode = "bird";
  let cinematicAttack = null;
  let cinematicTimer = 0;
  let impactPoint = null;
  let trailAttack = null;
  const effects = [];

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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

  const ready = createMountain(scene, mode);

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
    label.style.top = (1 - projected.y) * container.clientHeight / 2 -
      (label.classList.contains("coordinate-label") ? 24 : 0) + "px";
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
    mesh.castShadow = false;
    mesh.userData.playerIndex = index;
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
  const bulletViews = [{ projectile, trail, geometry: trailGeometry, points: [], teleportCount: 0 }];

  function clearBulletViews() {
    for (const extra of bulletViews.splice(1)) {
      scene.remove(extra.projectile, extra.trail);
      extra.geometry.dispose();
    }
    projectile.visible = trail.visible = false;
    bulletViews[0].points = [];
    bulletViews[0].teleportCount = 0;
    trailGeometry.setDrawRange(0, 0);
    trailAttack = null;
  }

  function drawPlayers(players, selectedIndex = null) {
    playerMeshes.forEach((mesh, index) => {
      const player = players[index];
      mesh.visible = Boolean(player && !player.eliminated && !(viewMode === "character" && index === selectedIndex));
      if (!mesh.visible) return;
      const position = player.position;
      const target = new THREE.Vector3(position.x, position.y, position.z);
      if (!mesh.userData.ready || mesh.position.distanceTo(target) > 4) mesh.position.copy(target);
      else mesh.position.lerp(target, 0.35); // Smooth 20 Hz snapshots for display only.
      mesh.userData.ready = true;
      mesh.material.color.setHex(player.team === 0 ? 0x76b7ff : 0xff8c99);
      if (mesh.userData.drawing) {
        mesh.userData.drawing.scale.setScalar(index === selectedIndex ? 1.12 : 1);
        mesh.userData.tilt = -player.velocity.x * 0.08;
      }
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
    mask = mask?.includes("1") ? mask : starterMask(index, mode);
    const occupied = [];
    for (let i = 0; i < mask.length; i++) if (mask[i] === "1") occupied.push(i);
    const left = Math.max(0, Math.min(...occupied.map((i) => i % 128)) - 4);
    const right = Math.min(127, Math.max(...occupied.map((i) => i % 128)) + 4);
    const top = Math.max(0, Math.min(...occupied.map((i) => Math.floor(i / 128))) - 4);
    const bottom = Math.min(79, Math.max(...occupied.map((i) => Math.floor(i / 128))) + 4);
    const width = right - left + 1, height = bottom - top + 1;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    const pixels = context.createImageData(width, height);
    function hasInk(x, y, radius) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const px = x + left + dx, py = y + top + dy;
        if (px >= 0 && px < 128 && py >= 0 && py < 80 && mask[py * 128 + px] === "1") return true;
      }
      return false;
    }
    const color = index < (mode === "bump" ? 1 : 3) ? [24, 112, 245] : [240, 48, 88];
    const outline = color.map((channel) => Math.round(channel * 0.55));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const filled = hasInk(x, y, 2);
      const outlined = filled || hasInk(x, y, 4);
      const u = x / width, v = y / height;
      const edge = filled && (x < 2 || y < 2 || x >= width - 2 || y >= height - 2 ||
        !hasInk(x - 4, y, 2) || !hasInk(x + 4, y, 2) || !hasInk(x, y - 4, 2) || !hasInk(x, y + 4, 2));
      const glint = Math.exp(-(((u - 0.3) / 0.12) ** 2 + ((v - 0.22) / 0.08) ** 2));
      const sheen = Math.exp(-(((u - 0.46) / 0.43) ** 2 + ((v - 0.18) / 0.23) ** 2));
      const light = Math.min(0.9, glint * 0.85 + sheen * 0.24 + (edge ? 0.12 : 0));
      const fill = color.map((channel) => Math.round(channel * (1.05 - v * 0.18) + (255 - channel) * light));
      const alpha = filled ? Math.round(Math.min(245, 140 + glint * 95 + sheen * 28 + (edge ? 80 : 0))) : outlined ? 255 : 0;
      pixels.data.set([...(filled ? fill : outline), alpha], (y * width + x) * 4);
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    const drawing = new THREE.Group();
    const aspect = width / height;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(3.1 * Math.min(aspect, 1), 3.1 / Math.max(aspect, 1)),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.01, depthWrite: false, side: THREE.DoubleSide }));
    drawing.add(art);
    mesh.add(drawing);
    mesh.userData.drawing = drawing;
    // The transparent proxy preserves click selection and the existing physics hitbox.
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
    mesh.material.depthWrite = false;
  }

  playerMeshes.forEach((_, index) => setPlayerShape(index, null));

  function drawProjectile(attack) {
    if (!attack) {
      if (trailAttack) clearBulletViews();
      return;
    }
    if (attack !== trailAttack) {
      clearBulletViews();
      trailAttack = attack;
    }
    (attack.bullets || [attack]).forEach((bullet, index) => {
      if (!bulletViews[index]) {
        const mesh = projectile.clone(true);
        const geometry = trailGeometry.clone();
        geometry.setDrawRange(0, 0);
        const line = new THREE.Line(geometry, trail.material);
        line.renderOrder = trail.renderOrder;
        scene.add(mesh, line);
        bulletViews.push({ projectile: mesh, trail: line, geometry, points: [], teleportCount: 0 });
      }
      const visual = bulletViews[index];
      visual.projectile.position.set(bullet.position.x, bullet.position.y, bullet.position.z);
      visual.projectile.visible = attack.dots
        ? !bullet.inGap || bullet.flashUntil - attack.age > 0.08
        : !(bullet.flashUntil - attack.age > 0.07);
      visual.trail.visible = !attack.dots;
      // Reset rather than drawing a luminous connector through a teleport gap.
      if (visual.teleportCount !== bullet.teleportCount) visual.points = [];
      visual.teleportCount = bullet.teleportCount;
      const last = visual.points.at(-1);
      if (!last || last.distanceTo(visual.projectile.position) > 0.03) {
        visual.points.push(visual.projectile.position.clone());
        if (visual.points.length > trailLength) visual.points.shift();
        const positions = visual.geometry.getAttribute("position");
        visual.points.forEach((point, i) => positions.setXYZ(i, point.x, point.y, point.z));
        positions.needsUpdate = true;
        visual.geometry.setDrawRange(0, visual.points.length);
        visual.geometry.computeBoundingSphere();
      }
    });
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
    clearBulletViews();
    clearEffects();
  }

  function updateCinematic(attack, dt, enabled) {
    attack = attack?.bullets?.[0] || attack; // Never switch to a different rational branch.
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
    const color = kind === "teleport" ? 0xcf8aff : enemy ? 0x9fffea : 0xffa34f;
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
      if (preview === "aim") {
        for (const [width, tint, order] of [[0.42, 0x10283c, 2], [0.22, color, 3]]) {
          const material = new THREE.MeshBasicMaterial({ color: tint, side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
          material.clippingPlanes = curveBounds;
          const ribbon = new THREE.Mesh(createAimGeometry(points, width), material);
          ribbon.renderOrder = order;
          group.add(ribbon);
        }
        continue;
      }
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

  function drawAttackPreview(preview) {
    const plan = projectilePlan(preview);
    const group = preview.dots ? createDotPreview(plan.paths) : drawCurve(plan.paths, 0xfff26c, "aim");
    if (preview.dots) {
      scene.add(group);
      return group;
    }
    for (const points of plan.paths.slice(1)) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 20),
        new THREE.MeshBasicMaterial({ color: plan.mode === "teleport" ? 0xcf8aff : 0x67e5ff,
          side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
      ring.position.set(points[0].x, points[0].y, points[0].z + 0.02);
      ring.renderOrder = 4;
      group.add(ring);
    }
    return group;
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;
    frameCamera(birdCamera, aspect, (hud.offsetHeight + 24) / height, (controls.offsetHeight + 24) / height);
    const distance = Math.max(46, Math.min(58, 40 / aspect));
    summitCamera.position.set(0, -distance * 0.8, distance * 0.7);
    summitCamera.lookAt(0, 0, -5);
    summitCamera.aspect = characterCamera.aspect = followCamera.aspect = aspect;
    summitCamera.updateProjectionMatrix();
    characterCamera.updateProjectionMatrix();
    followCamera.updateProjectionMatrix();
    povCamera.aspect = aspect;
    povCamera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  const observer = new ResizeObserver(resize);
  [container, hud, controls].forEach((element) => observer.observe(element));
  resize();

  function setViewMode(mode) {
    if (mode === "follow" && viewMode !== "follow") followCamera.position.copy(characterCamera.position);
    viewMode = mode;
    if (mode === "character") lookAtIndex = -1;
    if (document.pointerLockElement === renderer.domElement && mode !== "character") document.exitPointerLock();
    if (activeCamera !== povCamera) activeCamera = overviewCamera();
  }

  function updateCharacterCamera(players, selectedIndex) {
    if ((viewMode !== "character" && viewMode !== "follow") || selectedIndex == null) return;
    const player = players[selectedIndex];
    if (!player || player.eliminated) return;
    if (lookAtIndex !== selectedIndex) {
      lookAtIndex = selectedIndex;
      lookYaw = player.team === 0 ? 0 : Math.PI;
      lookPitch = -0.06;
    }
    if (viewMode === "follow") {
      const facing = player.team === 0 ? 1 : -1;
      followCamera.position.lerp(new THREE.Vector3(player.position.x - facing * 5,
        player.position.y - 3, player.position.z + 3.4), 0.075);
      followCamera.lookAt(player.position.x + facing * 1.6, player.position.y, player.position.z + .4);
      return;
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
    drawAttackPreview,
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
