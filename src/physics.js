import { ARENA, insideArena } from "./terrain.js";
export { ARENA, insideArena } from "./terrain.js";
export const PLAYER_SIZE = 1;
export const FIXED_STEP = 1 / 120;
export const GRAVITY = 12;
export const GROUND_FRICTION = 4;
export const WALL_BOUNCE = .8; // Keep 80% of speed perpendicular to the wall.
// Every visible box is also one collision rectangle; gaps have no hidden collider.
export const OBSTACLES = [
  // Two central ruins become Bump Duel obstacles from round three.
  { x: -1.5, y: -3, width: 0.8, depth: 2, height: 1.4 },
  { x: 1.5, y: 3, width: 0.8, depth: 2, height: 1.4 },
  // Two open L-shaped walls.
  { x: -3.6, y: 4, width: 0.8, depth: 4, height: 1.4 },
  { x: -2, y: 5.6, width: 4, depth: 0.8, height: 1.4 },
  { x: 3.6, y: -4, width: 0.8, depth: 4, height: 1.4 },
  { x: 2, y: -5.6, width: 4, depth: 0.8, height: 1.4 },
  // Block clusters have 1.6-unit gaps, wider than a character.
  { x: 4.8, y: 5.8, width: 1, depth: 1, height: 1.4 },
  { x: 4.8, y: 3.2, width: 1, depth: 1, height: 1.4 },
  { x: 2.2, y: 5.8, width: 1, depth: 1, height: 1.4 },
  { x: -4.8, y: -5.8, width: 1, depth: 1, height: 1.4 },
  { x: -4.8, y: -3.2, width: 1, depth: 1, height: 1.4 },
  { x: -2.2, y: -5.8, width: 1, depth: 1, height: 1.4 },
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

export function updatePlayer(player, dt, obstacles = OBSTACLES, onPlatform = insideArena) {
  if (player.eliminated) return;
  // Older callers passed a movement object here; it must never move the player.
  if (!Array.isArray(obstacles)) obstacles = OBSTACLES;
  const halfSize = PLAYER_SIZE / 2;
  const previousBottom = player.position.z - halfSize;
  // Only physics velocity moves characters; there is no direct movement input.
  movePlayerXY(player, player.velocity.x * dt, player.velocity.y * dt, obstacles);
  // Z is height. Semi-implicit Euler updates vertical velocity before position.
  player.velocity.z -= GRAVITY * dt;
  player.position.z += player.velocity.z * dt;

  const abovePlatform = onPlatform(player.position.x, player.position.y);
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

export function movePlayerXY(player, dx, dy, obstacles = OBSTACLES) {
  if (separateFromWalls(player, obstacles)) return true;
  const hitX = moveAxis(player, "x", dx, obstacles);
  const hitY = moveAxis(player, "y", dy, obstacles);
  return hitX || hitY;
}

function separateFromWalls(player, obstacles) {
  const half = player.radius || PLAYER_SIZE / 2;
  const overlaps = (point, box) => Math.abs(point.x - box.x) < box.width / 2 + half - 1e-9 &&
    Math.abs(point.y - box.y) < box.depth / 2 + half - 1e-9;
  if (!obstacles.some((box) => overlaps(player.position, box))) return false;
  const origin = player.position;
  let nearest, nearestDistance = Infinity;
  // Check nearby faces and corners, rejecting exits inside another part of an L-wall.
  // This bounded search also handles a wall appearing underneath a character.
  for (const box of obstacles) {
    const left = box.x - box.width / 2 - half - .001, right = box.x + box.width / 2 + half + .001;
    const bottom = box.y - box.depth / 2 - half - .001, top = box.y + box.depth / 2 + half + .001;
    for (const x of [left, origin.x, right]) for (const y of [bottom, origin.y, top]) {
      const point = { x, y }, distance = Math.hypot(x - origin.x, y - origin.y);
      if (distance >= nearestDistance || obstacles.some((part) => overlaps(point, part))) continue;
      nearest = point;
      nearestDistance = distance;
    }
  }
  for (const axis of ["x", "y"]) {
    // Only reverse velocity pointing into the wall, never velocity already escaping.
    if (player.velocity[axis] * (nearest[axis] - origin[axis]) < 0) player.velocity[axis] *= -WALL_BOUNCE;
    player.position[axis] = nearest[axis];
  }
  return true;
}

function moveAxis(player, axis, amount, obstacles) {
  const other = axis === "x" ? "y" : "x";
  const half = player.radius || PLAYER_SIZE / 2;
  const start = player.position[axis];
  let end = start + amount;

  // Sweep one axis at a time: even a large step cannot cross a solid rectangle.
  for (const obstacle of obstacles) {
    const size = axis === "x" ? obstacle.width : obstacle.depth;
    const otherSize = axis === "x" ? obstacle.depth : obstacle.width;
    if (Math.abs(player.position[other] - obstacle[other]) >= otherSize / 2 + half) continue;
    const near = obstacle[axis] - size / 2 - half;
    const far = obstacle[axis] + size / 2 + half;
    if (amount > 0 && start <= near && end > near) end = Math.min(end, near);
    if (amount < 0 && start >= far && end < far) end = Math.max(end, far);
  }
  player.position[axis] = end;
  const hit = end !== start + amount;
  if (hit) player.velocity[axis] *= -WALL_BOUNCE;
  return hit;
}

export function applyImpulse(player, impulse) {
  // Change in XY velocity = XY impulse / mass. Gravity alone affects Z.
  player.velocity.x += impulse.x / player.mass;
  player.velocity.y += impulse.y / player.mass;
}

export function playersAreStill(players, onPlatform = insideArena) {
  return players.every((player) => player.eliminated ||
    (onPlatform(player.position.x, player.position.y) && Math.abs(player.position.z - .5) < .02 &&
      Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z) < .12 &&
      Math.abs(player.angularVelocity || 0) < .2));
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
