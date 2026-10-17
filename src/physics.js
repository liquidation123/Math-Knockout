export const PLAYER_SIZE = 1;
export const ARENA = { halfWidth: 10, depth: 8, top: 0, thickness: 0.6, fallHeight: -5 };
export const FIXED_STEP = 1 / 120;
export const GRAVITY = 12;
export const GROUND_FRICTION = 4;
export const MOVE_SPEED = 3;
export const OBSTACLES = [
  { x: -2, y: 3, width: 1.2, depth: 1, height: 1.4 },
  { x: 0, y: 1, width: 1.2, depth: 0.8, height: 1.4 },
  { x: 2, y: -3, width: 1.2, depth: 1, height: 1.4 },
];

export function createPlayer(name, x, y = 0, z = 3, team = 0) {
  return {
    name,
    team,
    eliminated: false,
    position: { x, y, z },
    velocity: { x: 0, y: 0, z: 0 },
    mass: 1,
    health: 100,
  };
}

export function updatePlayer(player, dt, movement = { x: 0, y: 0 }) {
  if (player.eliminated) return;
  const halfSize = PLAYER_SIZE / 2;
  const previousBottom = player.position.z - halfSize;
  const length = Math.hypot(movement.x, movement.y);
  const walkX = length ? movement.x / length * MOVE_SPEED : 0;
  const walkY = length ? movement.y / length * MOVE_SPEED : 0;

  // Walking adds to knockback; normalize input so diagonal walking is not faster.
  moveAxis(player, "x", (player.velocity.x + walkX) * dt);
  moveAxis(player, "y", (player.velocity.y + walkY) * dt);
  // Z is height. Semi-implicit Euler updates vertical velocity before position.
  player.velocity.z -= GRAVITY * dt;
  player.position.z += player.velocity.z * dt;

  const abovePlatform = Math.abs(player.position.x) <= ARENA.halfWidth &&
    Math.abs(player.position.y) <= ARENA.depth / 2;
  const crossedTop = previousBottom >= ARENA.top &&
    player.position.z - halfSize <= ARENA.top;

  if (abovePlatform && crossedTop && player.velocity.z <= 0) {
    player.position.z = ARENA.top + halfSize;
    player.velocity.z = 0;
    // Reduce the XY speed as one vector, preserving the direction of sliding.
    const speed = Math.hypot(player.velocity.x, player.velocity.y);
    const factor = speed ? Math.max(0, speed - GROUND_FRICTION * dt) / speed : 0;
    player.velocity.x *= factor;
    player.velocity.y *= factor;
  }
}

function moveAxis(player, axis, amount) {
  const other = axis === "x" ? "y" : "x";
  const half = PLAYER_SIZE / 2;
  const start = player.position[axis];
  let end = start + amount;

  // Sweep one axis at a time: even a large step cannot cross a solid rectangle.
  for (const obstacle of OBSTACLES) {
    const size = axis === "x" ? obstacle.width : obstacle.depth;
    const otherSize = axis === "x" ? obstacle.depth : obstacle.width;
    if (Math.abs(player.position[other] - obstacle[other]) >= otherSize / 2 + half) continue;
    const near = obstacle[axis] - size / 2 - half;
    const far = obstacle[axis] + size / 2 + half;
    if (amount > 0 && start <= near && end > near) end = Math.min(end, near);
    if (amount < 0 && start >= far && end < far) end = Math.max(end, far);
  }
  player.position[axis] = end;
  if (end !== start + amount) player.velocity[axis] = 0;
}

export function applyImpulse(player, impulse) {
  // Change in XY velocity = XY impulse / mass. Gravity alone affects Z.
  player.velocity.x += impulse.x / player.mass;
  player.velocity.y += impulse.y / player.mass;
}

export function applyKnockback(attacker, target, strength) {
  const dx = target.position.x - attacker.position.x;
  const dy = target.position.y - attacker.position.y;
  const distance = Math.hypot(dx, dy);
  const directionX = distance === 0 ? 1 : dx / distance;
  const directionY = distance === 0 ? 0 : dy / distance;
  applyImpulse(target, { x: directionX * strength, y: directionY * strength });
}

export function takeFixedSteps(clock, frameSeconds, update) {
  clock.accumulator += Math.min(frameSeconds, 0.25);
  while (clock.accumulator + 1e-12 >= FIXED_STEP) {
    update(FIXED_STEP);
    clock.accumulator -= FIXED_STEP;
  }
}
