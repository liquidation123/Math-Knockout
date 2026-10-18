import { COMBAT_Z, buildTrajectory } from "./equations.js";
import { OBSTACLES, PLAYER_SIZE, applyKnockback } from "./physics.js";
import { clipArenaSegment } from "./terrain.js";
import { shotDirection } from "./aiming.js";
import { projectilePlan } from "./attack-paths.js";

export const DAMAGE = 20;
// Make even the lowest Force visibly move a one-unit cube against ground friction.
export const KNOCKBACK = 6.4;
export const RECOIL = 1.6;
export const MIN_FORCE = 0.5;
export const MAX_FORCE = 3;
export const DEFAULT_FORCE = 1;
// Keep the impact visible briefly; flight itself has no time limit.
export const ATTACK_DURATION = 0.7;
export const PROJECTILE_SPEED = 10;
export const PROJECTILE_RADIUS = 0.12;

export function createAttack(attackerIndex, players, equation, time, preview = null, force = DEFAULT_FORCE) {
  const attacker = players[attackerIndex];
  const trajectory = preview || buildTrajectory(equation, attacker.position, shotDirection(players, attackerIndex));
  const origin = trajectory.origin;
  const path = trajectory.path.map((point) => ({ ...point }));
  const plan = projectilePlan(trajectory);
  const paths = plan.paths.map((points) => points.map((point) => ({ ...point })));
  const bullets = (plan.mode === "parallel" ? paths : [paths[0]]).map((points) => ({
    path: points, position: { ...points[0] }, segment: 1, stopped: false, reason: "",
    impactPoint: null, branch: 0, teleportCount: 0, flashUntil: 0, gapRemaining: null, inGap: false,
  }));
  if (trajectory.dots) bullets[0].lookPath = [paths[0][0], paths[1]?.[0] ||
    { x: origin.x + (attacker.team === 0 ? 1 : -1), y: origin.y }];
  const capturedForce = Number.isFinite(force)
    ? Math.max(MIN_FORCE, Math.min(MAX_FORCE, force)) : DEFAULT_FORCE;
  return {
    attackerIndex, equation, path, paths, bullets, mode: plan.mode, dots: Boolean(trajectory.dots),
    force: capturedForce,
    hitEnemies: new Set(),
    hits: [],
    impacts: [], teleports: [],
    origin: { x: origin.x, y: origin.y, z: COMBAT_Z },
    position: { x: origin.x, y: origin.y, z: COMBAT_Z },
    segment: 1,
    age: 0,
    stoppedAt: null,
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
  const clipped = clipArenaSegment(start, end, PROJECTILE_RADIUS);
  if (!clipped || clipped.entry > 0) return 0;
  return clipped.exit < 1 ? clipped.exit : null;
}

export function firstCollision(start, end, players, attackerIndex, hitEnemies = new Set()) {
  const boundary = boundaryHit(start, end);
  let first = boundary === null ? null : { t: boundary, reason: "Map boundary" };
  function consider(t, reason, playerIndex = null) {
    if (t !== null && (!first || t < first.t)) first = { t, reason, playerIndex };
  }
  for (const obstacle of OBSTACLES) {
    consider(segmentBoxHit(start, end, obstacle, PROJECTILE_RADIUS), "Obstacle");
  }
  players.forEach((player, index) => {
    if (player.eliminated || player.team === players[attackerIndex].team || hitEnemies.has(index)) return;
    if (Math.abs(player.position.z - COMBAT_Z) > PLAYER_SIZE / 2) return;
    consider(segmentCircleHit(start, end, player.position, PLAYER_SIZE / 2 + PROJECTILE_RADIUS),
      "Enemy hit", index);
  });
  return first;
}

function travelSegment(attack, bullet, end, players) {
  // Recheck the remaining segment after each enemy, so a nearer wall always wins.
  while (!bullet.stopped) {
    const start = bullet.position;
    const collision = firstCollision(start, end, players, attack.attackerIndex, attack.hitEnemies);
    const t = collision ? collision.t : 1;
    bullet.position = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: COMBAT_Z,
    };
    if (!collision) return;
    if (collision.reason !== "Enemy hit") {
      bullet.stopped = true;
      bullet.reason = collision.reason;
      bullet.impactPoint = { ...bullet.position };
      attack.impacts.push({ reason: collision.reason, position: { ...bullet.position } });
      return;
    }
    attack.hitEnemies.add(collision.playerIndex);
    const target = players[collision.playerIndex];
    target.health = Math.max(0, target.health - DAMAGE);
    applyKnockback(players[attack.attackerIndex], target, KNOCKBACK * attack.force);
    attack.didHit = true;
    // Save collision points for cosmetic effects; they never apply damage.
    attack.hits.push({ playerIndex: collision.playerIndex, position: { ...bullet.position } });
  }
}

function updateBullet(attack, bullet, players, dt, firstStep) {
  if (bullet.stopped) return;
  if (firstStep) travelSegment(attack, bullet, bullet.position, players);
  let distance = dt * PROJECTILE_SPEED;

  // Spend distance, not X increments, to maintain speed along curved segments.
  while (distance > 1e-10 && !bullet.stopped) {
    const next = bullet.path[bullet.segment];
    if (!next) {
      if (attack.mode === "teleport" && attack.paths[bullet.branch + 1]) {
        if (attack.dots) {
          const destination = attack.paths[bullet.branch + 1][0];
          // Spend the usual speed budget invisibly. Never sweep or draw this gap.
          bullet.gapRemaining ??= Math.hypot(destination.x - bullet.position.x, destination.y - bullet.position.y);
          const used = Math.min(distance, bullet.gapRemaining);
          bullet.gapRemaining -= used;
          distance -= used;
          bullet.inGap = bullet.gapRemaining > 1e-10;
          if (bullet.inGap) break;
          bullet.gapRemaining = null;
        }
        const from = { ...bullet.position };
        bullet.branch += 1;
        bullet.path = attack.paths[bullet.branch];
        bullet.position = { ...bullet.path[0] };
        bullet.segment = 1;
        bullet.teleportCount += 1;
        bullet.flashUntil = attack.age + 0.12;
        attack.teleports.push({ from, to: { ...bullet.position } });
        // No swept gap: only the destination itself can collide during teleport.
        travelSegment(attack, bullet, bullet.position, players);
        continue;
      }
      bullet.stopped = true;
      bullet.reason = attack.dots ? "End of discrete curve" : "End of continuous curve";
      break;
    }
    const dx = next.x - bullet.position.x;
    const dy = next.y - bullet.position.y;
    const length = Math.hypot(dx, dy);
    const used = Math.min(distance, length);
    const ratio = length ? used / length : 1;
    travelSegment(attack, bullet, {
      x: bullet.position.x + dx * ratio,
      y: bullet.position.y + dy * ratio,
    }, players);
    distance -= used;
    if (used >= length - 1e-10) bullet.segment += 1;
  }
}

export function updateProjectile(attack, players, dt) {
  const firstStep = attack.age === 0;
  attack.age += dt;
  if (attack.stopped) return;
  for (const bullet of attack.bullets) updateBullet(attack, bullet, players, dt, firstStep);
  const primary = attack.bullets[0];
  if (attack.dots) {
    const previous = attack.paths[Math.max(0, primary.branch - 1)][0];
    const next = attack.paths[primary.branch + 1]?.[0];
    primary.lookPath = [primary.position, next || {
      x: primary.position.x + (primary.position.x - previous.x || (players[attack.attackerIndex].team === 0 ? 1 : -1)),
      y: primary.position.y + primary.position.y - previous.y,
    }];
  }
  // Keep the original single-bullet readouts for existing camera/game code.
  attack.position = primary.position;
  attack.segment = primary.segment;
  attack.stopped = attack.bullets.every((bullet) => bullet.stopped);
  if (attack.stopped) {
    attack.reason = attack.bullets.find((bullet) => bullet.impactPoint)?.reason || primary.reason;
    attack.impactPoint = primary.impactPoint;
    attack.stoppedAt = attack.age;
  }
}
