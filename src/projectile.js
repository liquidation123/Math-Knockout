import { COMBAT_Z, buildTrajectory } from "./equations.js";
import { ARENA, OBSTACLES, PLAYER_SIZE, applyKnockback } from "./physics.js";

export const DAMAGE = 20;
export const KNOCKBACK = 3.2;
export const ATTACK_DURATION = 0.7;
export const PROJECTILE_SPEED = 60;
export const PROJECTILE_RADIUS = 0.12;

export function createAttack(attackerIndex, players, equation, time, preview = null) {
  const attacker = players[attackerIndex];
  const trajectory = preview || buildTrajectory(equation, attacker.position, attacker.team === 0 ? 1 : -1);
  const origin = trajectory.origin;
  const path = trajectory.path.map((point) => ({ ...point }));
  return {
    attackerIndex, equation, path,
    origin: { x: origin.x, y: origin.y, z: COMBAT_Z },
    position: { x: origin.x, y: origin.y, z: COMBAT_Z },
    segment: 1,
    age: 0,
    expiresAt: time + ATTACK_DURATION,
    didHit: false,
    stopped: false,
    reason: "",
    impactPoint: null,
  };
}

export function segmentCircleHit(start, end, centre, radius) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ox = start.x - centre.x;
  const oy = start.y - centre.y;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (ox * dx + oy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function segmentBoxHit(start, end, box, padding = 0) {
  let entry = 0;
  let exit = 1;
  // Intersect the segment's X and Y time intervals (the slab method).
  for (const axis of ["x", "y"]) {
    const half = (axis === "x" ? box.width : box.depth) / 2 + padding;
    const low = box[axis] - half;
    const high = box[axis] + half;
    const delta = end[axis] - start[axis];
    if (delta === 0) {
      if (start[axis] < low || start[axis] > high) return null;
    } else {
      const a = (low - start[axis]) / delta;
      const b = (high - start[axis]) / delta;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (entry > exit) return null;
    }
  }
  return entry;
}

function boundaryHit(start, end) {
  let first = null;
  for (const [axis, half] of [["x", ARENA.halfWidth], ["y", ARENA.depth / 2]]) {
    const limit = half - PROJECTILE_RADIUS;
    if (Math.abs(start[axis]) > limit) return 0;
    const delta = end[axis] - start[axis];
    let t = null;
    if (delta > 0 && end[axis] >= limit) t = (limit - start[axis]) / delta;
    if (delta < 0 && end[axis] <= -limit) t = (-limit - start[axis]) / delta;
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first;
}

export function firstCollision(start, end, players, attackerIndex) {
  const boundary = boundaryHit(start, end);
  let first = boundary === null ? null : { t: boundary, reason: "Map boundary" };
  function consider(t, reason, playerIndex = null) {
    if (t !== null && (!first || t < first.t)) first = { t, reason, playerIndex };
  }
  for (const obstacle of OBSTACLES) {
    consider(segmentBoxHit(start, end, obstacle, PROJECTILE_RADIUS), "Obstacle");
  }
  players.forEach((player, index) => {
    if (player.eliminated || player.team === players[attackerIndex].team) return;
    if (Math.abs(player.position.z - COMBAT_Z) > PLAYER_SIZE / 2) return;
    consider(segmentCircleHit(start, end, player.position, PLAYER_SIZE / 2 + PROJECTILE_RADIUS),
      "Enemy hit", index);
  });
  return first;
}

function travelSegment(attack, end, players) {
  const start = attack.position;
  const collision = firstCollision(start, end, players, attack.attackerIndex);
  const t = collision ? collision.t : 1;
  attack.position = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: COMBAT_Z,
  };
  if (!collision) return;
  attack.stopped = true;
  attack.reason = collision.reason;
  attack.impactPoint = { ...attack.position };
  if (collision.playerIndex !== null && collision.playerIndex !== undefined) {
    const target = players[collision.playerIndex];
    target.health = Math.max(0, target.health - DAMAGE);
    applyKnockback(players[attack.attackerIndex], target, KNOCKBACK);
    attack.didHit = true;
  }
}

export function updateProjectile(attack, players, dt) {
  const before = attack.age;
  attack.age = Math.min(ATTACK_DURATION, attack.age + dt);
  if (attack.stopped) return;

  // The translated path starts at the shooter: no launch connector or delay.
  if (before === 0) travelSegment(attack, attack.position, players);
  let distance = (attack.age - before) * PROJECTILE_SPEED;

  // Spend distance, not X increments, to maintain speed along curved segments.
  while (distance > 1e-10 && !attack.stopped) {
    const next = attack.path[attack.segment];
    if (!next) {
      attack.stopped = true;
      attack.reason = "End of continuous curve";
      break;
    }
    const dx = next.x - attack.position.x;
    const dy = next.y - attack.position.y;
    const length = Math.hypot(dx, dy);
    const used = Math.min(distance, length);
    const ratio = length ? used / length : 1;
    travelSegment(attack, {
      x: attack.position.x + dx * ratio,
      y: attack.position.y + dy * ratio,
    }, players);
    distance -= used;
    if (used >= length - 1e-10) attack.segment += 1;
  }
  if (attack.age >= ATTACK_DURATION && !attack.stopped) {
    attack.stopped = true;
    attack.reason = "Attack expired";
  }
}
