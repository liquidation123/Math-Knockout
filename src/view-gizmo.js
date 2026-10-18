import * as THREE from "three";

// A camera-only inspection tool: it never changes player positions or physics.
export function createViewGizmo(container, canvas, getCamera, setCamera) {
  const camera = new THREE.PerspectiveCamera(55, 1, .1, 180);
  camera.up.set(0, 0, 1);
  const target = new THREE.Vector3(0, 0, -5);
  let yaw = -.9, pitch = .7, distance = 52, dragging = false;
  let lastX = 0, lastY = 0;
  const panel = document.createElement("div");
  panel.className = "view-gizmo";
  panel.innerHTML = '<div class="gizmo-axes" aria-label="Camera axes"><i></i><span data-stem="x"></span><span data-stem="y"></span><span data-stem="z"></span><button type="button" data-axis="x" aria-label="View from X axis">X</button><button type="button" data-axis="y" aria-label="View from Y axis">Y</button><button type="button" data-axis="z" aria-label="View from Z axis">Z</button></div><button type="button" class="inspect-toggle" title="Drag to orbit; scroll to zoom. X, Y and Z snap to different views." aria-pressed="false">Inspect 3D</button>';
  container.append(panel);
  const toggle = panel.querySelector(".inspect-toggle");

  function aim() {
    camera.position.set(target.x + distance * Math.cos(pitch) * Math.cos(yaw),
      target.y + distance * Math.cos(pitch) * Math.sin(yaw),
      target.z + distance * Math.sin(pitch));
    camera.lookAt(target);
  }
  function inspect() {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    aim();
    setCamera(camera);
    toggle.textContent = "Return to game";
    toggle.setAttribute("aria-pressed", "true");
    canvas.style.cursor = "grab";
  }
  function exit() {
    if (getCamera() !== camera) return;
    dragging = false;
    setCamera(null);
    toggle.textContent = "Inspect 3D";
    toggle.setAttribute("aria-pressed", "false");
    canvas.style.cursor = "";
  }
  toggle.addEventListener("click", () => getCamera() === camera ? exit() : inspect());
  panel.querySelectorAll("[data-axis]").forEach((button) => button.addEventListener("click", () => {
    const axis = button.dataset.axis;
    yaw = axis === "x" || axis === "z" ? 0 : Math.PI / 2;
    pitch = axis === "z" ? 1.45 : .12;
    inspect();
  }));
  canvas.addEventListener("pointerdown", (event) => {
    if (getCamera() !== camera) return;
    dragging = true; lastX = event.clientX; lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    yaw -= (event.clientX - lastX) * .006;
    pitch = THREE.MathUtils.clamp(pitch + (event.clientY - lastY) * .006, -1.45, 1.45);
    lastX = event.clientX; lastY = event.clientY;
    aim();
  });
  for (const name of ["pointerup", "pointercancel"]) canvas.addEventListener(name, () => {
    dragging = false;
    if (getCamera() === camera) canvas.style.cursor = "grab";
  });
  canvas.addEventListener("wheel", (event) => {
    if (getCamera() !== camera) return;
    event.preventDefault();
    distance = THREE.MathUtils.clamp(distance * Math.exp(event.deltaY * .001), 16, 100);
    aim();
  }, { passive: false });

  function update(activeCamera) {
    activeCamera.updateMatrixWorld();
    const inverse = activeCamera.quaternion.clone().invert();
    for (const [axis, vector] of Object.entries({ x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) })) {
      const point = vector.applyQuaternion(inverse);
      const button = panel.querySelector(`[data-axis="${axis}"]`);
      button.style.left = `${50 + point.x * 34}%`;
      button.style.top = `${50 - point.y * 34}%`;
      button.style.zIndex = String(Math.round((point.z + 1) * 10));
      const stem = panel.querySelector(`[data-stem="${axis}"]`);
      stem.style.width = `${Math.hypot(point.x, point.y) * 28}px`;
      stem.style.transform = `rotate(${-Math.atan2(point.y, point.x)}rad)`;
    }
  }
  aim();
  return { camera, exit, update, resize(aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); } };
}
