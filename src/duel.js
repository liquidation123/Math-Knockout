import { buildPreview } from "./equations.js";
import { ARENA, OBSTACLES, PLAYER_SIZE, applyImpulse, createPlayer, movePlayerXY, updatePlayer } from "./physics.js";
import { bodyContact, bodyFromMask, starterMask } from "./body.js";

const LAUNCH_SPEED = 7.5;
const LAUNCH_FRICTION = 2.25; // Distance = speed²/(2·friction) = 12.5 units.
export const DUEL_RADIUS = 7.8;
export const travelDistance = (mass = 1) => LAUNCH_SPEED ** 2 / (2 * LAUNCH_FRICTION * mass);
export const insideDuel = (x, y, radius) => Math.hypot(x, y) < radius;

export function interceptSlope(own, rival, ownMass, rivalMass, side, radius) {
  const dx = rival.x - own.x, dy = rival.y - own.y;
  if (dx * (side === 0 ? 1 : -1) < .5) return null;
  const forward = side === 0 ? 1 : -1;
  const speed = LAUNCH_SPEED / Math.sqrt(ownMass);
  const rivalSpeed = LAUNCH_SPEED / Math.sqrt(rivalMass);
  // Both launches slow at the same rate. Find the time when our curved-distance
  // travel reaches the rival's straight-line position.
  const distance = (v, time) => {
    const t = Math.min(time, v / LAUNCH_FRICTION);
    return v * t - LAUNCH_FRICTION * t * t / 2;
  };
  const gap = (time) => Math.hypot(Math.abs(dx) - distance(rivalSpeed, time), dy) - distance(speed, time);
  let low = 0, high = speed / LAUNCH_FRICTION;
  if (gap(high) > 0) return null;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (gap(middle) > 0) low = middle; else high = middle;
  }
  const run = Math.abs(dx) - distance(rivalSpeed, high);
  if (run <= 0 || !insideDuel(own.x + forward * run, rival.y, radius - .2)) return null;
  return dy / (forward * run);
}

export function createDuel() {
  const bodies = [bodyFromMask(starterMask(0)), bodyFromMask(starterMask(1))];
  const players = [createPlayer("Blue", -5.6, 0, 0.5, 0), createPlayer("Red", 5.6, 0, 0.5, 1)];
  players.forEach((player, side) => {
    Object.assign(player, { mass: bodies[side].mass, inertia: bodies[side].inertia,
      radius: bodies[side].radius, angle: 0, angularVelocity: 0 });
  });
  return {
    players, bodies,
    paths: [null, null], locked: [false, false], phase: "planning", elapsed: 0, winner: null,
    round: 1, radius: DUEL_RADIUS, replay: [], replayTime: 0, finishAt: 0,
  };
}

export function setDuelBody(duel, side, mask) {
  const body = bodyFromMask(mask);
  duel.bodies[side] = body;
  Object.assign(duel.players[side], { mass: body.mass, inertia: body.inertia, radius: body.radius });
}

export function lockEquation(duel, side, expression) {
  if (duel.phase !== "planning" || duel.locked[side]) return "Already locked.";
  const player = duel.players[side];
  const preview = buildPreview(expression, player.position, side === 0 ? 1 : -1);
  if (preview.error) return preview.error;
  if (preview.path.length < 2) return "Choose a path with room to move.";
  // Equal launch energy: heavier drawings start slower and travel less far.
  duel.paths[side] = { points: safeTravelPath(preview.path, player.mass, duel.radius),
    index: 0, speed: LAUNCH_SPEED / Math.sqrt(player.mass), expression };
  duel.locked[side] = true;
  return "";
}

export function launchDuel(duel) {
  if (!duel.locked.every(Boolean)) return false;
  duel.phase = "running";
  duel.elapsed = 0;
  return true;
}

export function travelPath(points, distanceLimit = travelDistance()) {
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

export function safeTravelPath(points, mass, radius) {
  const safeRadius = radius - .2;
  const path = travelPath(points, travelDistance(mass));
  const safe = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = safe.at(-1), b = path[i];
    if (insideDuel(b.x, b.y, safeRadius)) { safe.push(b); continue; }
    // Intersect this line segment with the safe circle; chosen paths stop here.
    const dx = b.x - a.x, dy = b.y - a.y;
    const dot = a.x * dx + a.y * dy;
    const t = (-dot + Math.sqrt(dot * dot - (dx * dx + dy * dy) *
      (a.x * a.x + a.y * a.y - safeRadius * safeRadius))) / (dx * dx + dy * dy);
    safe.push({ x: a.x + dx * t, y: a.y + dy * t, z: a.z });
    break;
  }
  return safe;
}

function followPath(player, path, dt, radius, obstacles) {
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
      movePlayerXY(player, moveX, moveY, obstacles);
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
  if (path.index >= path.points.length - 1) {
    path.done = true;
    player.velocity.x = player.velocity.y = 0;
  }
}

function collide(duel) {
  const [a, b] = duel.players;
  if (a.eliminated || b.eliminated || Math.abs(a.position.z - b.position.z) > PLAYER_SIZE) return;
  const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
  const distance = Math.hypot(dx, dy);
  const contact = bodyContact(duel.bodies[0], a.position, a.angle,
    duel.bodies[1], b.position, b.angle);
  if (!contact) return;
  const nx = distance ? dx / distance : 1, ny = distance ? dy / distance : 0;
  const closing = (a.velocity.x - b.velocity.x) * nx + (a.velocity.y - b.velocity.y) * ny;
  if (closing <= 0) return;
  duel.paths.forEach((path) => { path.done = true; });
  // Equal-and-opposite impulses use both masks' mass and rotational inertia.
  const ax = contact.x - a.position.x, ay = contact.y - a.position.y;
  const bx = contact.x - b.position.x, by = contact.y - b.position.y;
  const armA = ax * ny - ay * nx, armB = bx * ny - by * nx;
  // Off-centre hits spin the same mask that supplied mass and inertia.
  const impulse = 2.3 * closing / (1 / a.mass + 1 / b.mass +
    armA ** 2 / a.inertia + armB ** 2 / b.inertia);
  applyImpulse(a, { x: -nx * impulse, y: -ny * impulse });
  applyImpulse(b, { x: nx * impulse, y: ny * impulse });
  a.angularVelocity -= armA * impulse / a.inertia;
  b.angularVelocity += armB * impulse / b.inertia;
  a.angularVelocity = Math.max(-8, Math.min(8, a.angularVelocity));
  b.angularVelocity = Math.max(-8, Math.min(8, b.angularVelocity));
  duel.lastImpact = { ...contact };
}

export function updateDuel(duel, dt) {
  if (duel.phase !== "running") return;
  duel.elapsed += dt;
  const obstacles = duel.round >= 3 ? OBSTACLES.slice(0, 2) : [];
  duel.players.forEach((player, side) => {
    const path = duel.paths[side];
    if (!path.done) followPath(player, path, dt, duel.radius, obstacles);
    if (path.done) updatePlayer(player, dt, obstacles, (x, y) => insideDuel(x, y, duel.radius));
    if (player.position.z < ARENA.fallHeight) player.eliminated = true;
    player.angle += player.angularVelocity * dt;
    player.angularVelocity *= Math.max(0, 1 - 1.5 * dt);
  });
  collide(duel);
  duel.replayTime += dt;
  if (duel.replayTime >= .1) {
    duel.replayTime = 0;
    duel.replay.push(duel.players.map((p) => ({ position: { ...p.position }, velocity: { ...p.velocity }, angle: p.angle,
      eliminated: p.eliminated, team: p.team })));
    if (duel.replay.length > 25) duel.replay.shift();
  }
  const alive = duel.players.filter((player) => !player.eliminated);
  if (alive.length < 2) {
    duel.finishAt ||= duel.elapsed + .8; // Let a second falling player finish before naming a winner.
    if (duel.elapsed >= duel.finishAt) {
      duel.phase = "finished";
      duel.winner = alive.length ? alive[0].name : "Draw";
    }
  } else if (duel.elapsed > 8) {
    duel.phase = "planning";
    duel.round += 1;
    duel.radius = Math.max(5.8, DUEL_RADIUS - (duel.round - 1) * .7);
    duel.paths = [null, null];
    duel.locked = [false, false];
    duel.players.forEach((player) => {
      player.velocity.x = player.velocity.y = 0;
      const distance = Math.hypot(player.position.x, player.position.y);
      if (distance > duel.radius - .3) {
        player.position.x *= (duel.radius - .3) / distance;
        player.position.y *= (duel.radius - .3) / distance;
      }
    });
  }
}
