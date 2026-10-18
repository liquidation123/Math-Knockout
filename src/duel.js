import { buildPreview } from "./equations.js";
import { ARENA, PLAYER_SIZE, applyImpulse, createPlayer, insideArena, movePlayerXY, updatePlayer } from "./physics.js";

const LAUNCH_SPEED = 7.5;
const LAUNCH_FRICTION = 2.25; // Distance = speed²/(2·friction) = 12.5 units.

export function createDuel() {
  return {
    players: [createPlayer("Blue", -9.5, 0, 0.5, 0), createPlayer("Red", 9.5, 0, 0.5, 1)],
    paths: [null, null], locked: [false, false], phase: "planning", elapsed: 0, winner: null,
  };
}

export function lockEquation(duel, side, expression) {
  if (duel.phase !== "planning" || duel.locked[side]) return "Already locked.";
  const player = duel.players[side];
  const preview = buildPreview(expression, player.position, side === 0 ? 1 : -1);
  if (preview.error) return preview.error;
  if (preview.path.length < 2) return "Choose a path with room to move.";
  duel.paths[side] = { points: preview.path, index: 0, speed: LAUNCH_SPEED, expression };
  duel.locked[side] = true;
  return "";
}

export function launchDuel(duel) {
  if (!duel.locked.every(Boolean)) return false;
  duel.phase = "running";
  duel.elapsed = 0;
  return true;
}

export function travelPath(points, distanceLimit = LAUNCH_SPEED ** 2 / (2 * LAUNCH_FRICTION)) {
  const visible = [points[0]];
  let distanceLeft = distanceLimit;
  for (let i = 1; i < points.length && distanceLeft > 0; i++) {
    const a = visible.at(-1), b = points[i];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance <= distanceLeft) { visible.push(b); distanceLeft -= distance; }
    else {
      const fraction = distanceLeft / distance;
      visible.push({ x: a.x + (b.x - a.x) * fraction,
        y: a.y + (b.y - a.y) * fraction, z: a.z });
      break;
    }
  }
  return visible;
}

function followPath(player, path, dt) {
  let remaining = path.speed * dt;
  const start = { ...player.position };
  while (remaining > 0 && path.index < path.points.length - 1) {
    const next = path.points[path.index + 1];
    const dx = next.x - player.position.x, dy = next.y - player.position.y;
    const distance = Math.hypot(dx, dy);
    const step = Math.min(distance, remaining);
    if (distance > 0) {
      const before = { ...player.position };
      const moveX = dx * step / distance, moveY = dy * step / distance;
      movePlayerXY(player, moveX, moveY);
      if (Math.abs(player.position.x - before.x - moveX) > 1e-8 ||
        Math.abs(player.position.y - before.y - moveY) > 1e-8) {
        path.done = true;
        player.velocity.x = player.velocity.y = 0;
        return; // A visible stone wall stops a bump launch; it never deals damage.
      }
    }
    remaining -= step;
    if (step >= distance - 1e-8) path.index += 1;
  }
  player.velocity.x = (player.position.x - start.x) / dt;
  player.velocity.y = (player.position.y - start.y) / dt;
  // The dotted preview uses this same friction-limited distance.
  path.speed = Math.max(0, path.speed - LAUNCH_FRICTION * dt);
  if (!path.speed) { player.velocity.x = 0; player.velocity.y = 0; path.done = true; }
  // Once a path leaves the playable top, gravity takes over with its last velocity.
  if (!insideArena(player.position.x, player.position.y) || path.index >= path.points.length - 1) {
    path.done = true;
  }
}

function collide(duel) {
  const [a, b] = duel.players;
  if (a.eliminated || b.eliminated || Math.abs(a.position.z - b.position.z) > PLAYER_SIZE) return;
  const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
  const distance = Math.hypot(dx, dy);
  const touchDistance = (a.radius || PLAYER_SIZE / 2) + (b.radius || PLAYER_SIZE / 2);
  if (distance >= touchDistance) return;
  const nx = distance ? dx / distance : 1, ny = distance ? dy / distance : 0;
  const closing = (a.velocity.x - b.velocity.x) * nx + (a.velocity.y - b.velocity.y) * ny;
  if (closing <= 0) return;
  duel.paths.forEach((path) => { path.done = true; });
  // Equal-and-opposite impulses preserve momentum; boosted force makes edge knockouts possible.
  const impulse = 4.7 * closing / (1 / a.mass + 1 / b.mass);
  applyImpulse(a, { x: -nx * impulse, y: -ny * impulse });
  applyImpulse(b, { x: nx * impulse, y: ny * impulse });
  const overlap = (touchDistance - distance) / 2;
  a.position.x -= nx * overlap; a.position.y -= ny * overlap;
  b.position.x += nx * overlap; b.position.y += ny * overlap;
}

export function updateDuel(duel, dt) {
  if (duel.phase !== "running") return;
  duel.elapsed += dt;
  duel.players.forEach((player, side) => {
    const path = duel.paths[side];
    if (!path.done) followPath(player, path, dt);
    if (path.done) updatePlayer(player, dt);
    if (player.position.z < ARENA.fallHeight) player.eliminated = true;
  });
  collide(duel);
  const alive = duel.players.filter((player) => !player.eliminated);
  if (alive.length < 2) {
    duel.phase = "finished";
    duel.winner = alive.length ? alive[0].name : "Draw";
  } else if (duel.elapsed > 8) {
    duel.phase = "planning";
    duel.paths = [null, null];
    duel.locked = [false, false];
    duel.players.forEach((player) => { player.velocity.x = 0; player.velocity.y = 0; });
  }
}
