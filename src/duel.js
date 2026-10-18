import { buildPreview } from "./equations.js";
import { ARENA, OBSTACLES, PLAYER_SIZE, applyImpulse, createPlayer, movePlayerXY, playersAreStill, updatePlayer } from "./physics.js";
import { forwardDirection } from "./aiming.js";
import { bodyContact, bodyFromMask, starterMask } from "./body.js";

const LAUNCH_SPEED = 7.5;
const LAUNCH_FRICTION = 2.25; // Distance = speed²/(2·friction) = 12.5 units.
export const DUEL_RADIUS = 8.25;
export const DUEL_NAMES = ["Blue", "Red", "Green", "Gold"];
export const DUEL_COLORS = [0x2889ff, 0xff6b86, 0x36c88b, 0xffc444];
const launchSpeed = (mass, force) => LAUNCH_SPEED * force / Math.sqrt(mass);
export const travelDistance = (mass = 1, force = 1) => LAUNCH_SPEED ** 2 * force ** 2 / (2 * LAUNCH_FRICTION * mass);
export const insideDuel = (x, y, radius) => Math.hypot(x, y) < radius;
export const duelObstacles = (round, radius) => round < 3 ? [] : OBSTACLES.slice(0, 2).filter((box) =>
  Math.hypot(Math.abs(box.x) + box.width / 2, Math.abs(box.y) + box.depth / 2) < radius);

export function interceptSlope(own, rival, ownMass, rivalMass, side, radius, force = 1) {
  const dx = rival.x - own.x, dy = rival.y - own.y;
  if (Math.abs(dx) < .5) return null;
  const forward = forwardDirection(own, rival, side === 0 ? 1 : -1);
  const speed = launchSpeed(ownMass, force);
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

export function chooseBotEquation(duel, random = Math.random) {
  const [human, bot] = duel.players;
  // The bot sees positions, never the human's hidden equation.
  const forward = forwardDirection(bot.position, human.position, -1);
  let away = Math.sign(bot.position.y - human.position.y) || (random() < .5 ? -1 : 1);
  if (Math.abs(bot.position.y) > duel.radius * .4) away = -Math.sign(bot.position.y);
  const slope = (forward * away * (.75 + Math.floor(random() * 4) * .2)).toFixed(2);
  return random() < .3 ? `${slope}*x+0.15*sin(1.5*x)` : `${slope}*x`;
}

export function duelTarget(players, side) {
  const own = players[side];
  let target = null, closest = Infinity;
  players.forEach((player, index) => {
    if (index === side || player.eliminated) return;
    const distance = Math.hypot(player.position.x - own.position.x, player.position.y - own.position.y);
    if (distance < closest) { closest = distance; target = index; }
  });
  return target;
}

export const duelReady = (duel) => duel.players.filter((p) => !p.eliminated).length >= 2 &&
  duel.players.every((player, side) => player.eliminated || duel.locked[side]);

export function createDuel(count = 2) {
  const spawns = [[-5.2, 0], [5.2, 0], [0, 5.2], [0, -5.2]];
  const bodies = Array.from({ length: count }, (_, side) => bodyFromMask(starterMask(side % 2)));
  const players = bodies.map((_, side) => createPlayer(DUEL_NAMES[side], ...spawns[side], .5, side));
  players.forEach((player, side) => {
    Object.assign(player, { mass: bodies[side].mass, inertia: bodies[side].inertia,
      radius: bodies[side].radius, angle: 0, angularVelocity: 0 });
  });
  return {
    players, bodies,
    paths: Array(count).fill(null), locked: Array(count).fill(false), phase: "planning", elapsed: 0, winner: null, resignedBy: null,
    round: 1, radius: DUEL_RADIUS, replay: [], replayTime: 0,
  };
}

export function resignDuel(duel, side) {
  if (duel.phase === "finished" || duel.phase === "lobby" || !duel.players[side] || duel.players[side].eliminated) return false;
  duel.players[side].eliminated = true;
  duel.locked[side] = true;
  const alive = duel.players.filter((player) => !player.eliminated);
  if (alive.length < 2) {
    duel.phase = "finished";
    duel.winner = alive[0]?.name || "Draw";
    duel.resignedBy = side;
  }
  return true;
}

export function setDuelBody(duel, side, mask) {
  const body = bodyFromMask(mask);
  duel.bodies[side] = body;
  Object.assign(duel.players[side], { mass: body.mass, inertia: body.inertia, radius: body.radius });
}

export function lockEquation(duel, side, expression, force = 1) {
  if (duel.phase !== "planning" || !duel.players[side] || duel.players[side].eliminated || duel.locked[side]) return "Already locked.";
  if (!Number.isFinite(force) || force < .5 || force > 3) return "Choose Force between 0.5 and 3.";
  const player = duel.players[side];
  const target = duelTarget(duel.players, side);
  if (target === null) return "Wait for an opponent.";
  const direction = forwardDirection(player.position, duel.players[target].position, side % 2 === 0 ? 1 : -1);
  const preview = buildPreview(expression, player.position, direction);
  if (preview.error) return preview.error;
  if (preview.path.length < 2) return "Choose a path with room to move.";
  // Force multiplies forward speed; heavier drawings still start slower.
  // Capture force and points now so later slider changes cannot move a locked path.
  duel.paths[side] = { points: safeTravelPath(preview.path, player.mass, duel.radius, force),
    index: 0, speed: launchSpeed(player.mass, force), expression, force };
  duel.locked[side] = true;
  return "";
}

export function launchDuel(duel) {
  if (!duelReady(duel)) return false;
  duel.phase = "running";
  duel.elapsed = 0;
  duel.settledFor = 0;
  duel.eroding = false;
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

export function safeTravelPath(points, mass, radius, force = 1) {
  const safeRadius = radius - .2;
  const path = travelPath(points, travelDistance(mass, force));
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
      const moveX = dx * step / distance, moveY = dy * step / distance;
      player.velocity.x = dx / distance * path.speed;
      player.velocity.y = dy / distance * path.speed;
      if (movePlayerXY(player, moveX, moveY, obstacles)) {
        path.done = true;
        return; // Leave the equation path and let normal physics carry the wall bounce.
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

function collide(duel, first, second) {
  const a = duel.players[first], b = duel.players[second];
  if (a.eliminated || b.eliminated || Math.abs(a.position.z - b.position.z) > PLAYER_SIZE) return;
  const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
  const distance = Math.hypot(dx, dy);
  const contact = bodyContact(duel.bodies[first], a.position, a.angle,
    duel.bodies[second], b.position, b.angle);
  if (!contact) return;
  const nx = distance ? dx / distance : 1, ny = distance ? dy / distance : 0;
  const closing = (a.velocity.x - b.velocity.x) * nx + (a.velocity.y - b.velocity.y) * ny;
  if (closing <= 0) return;
  duel.paths[first].done = duel.paths[second].done = true;
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
  const obstacles = duelObstacles(duel.round, duel.radius);
  duel.players.forEach((player, side) => {
    if (player.eliminated) return;
    const path = duel.paths[side];
    if (!path.done) followPath(player, path, dt, duel.radius, obstacles);
    else updatePlayer(player, dt, obstacles, (x, y) => insideDuel(x, y, duel.radius));
    if (player.position.z < ARENA.fallHeight) player.eliminated = true;
    player.angle += player.angularVelocity * dt;
    player.angularVelocity *= Math.max(0, 1 - 1.5 * dt);
  });
  for (let first = 0; first < duel.players.length; first++) {
    for (let second = first + 1; second < duel.players.length; second++) collide(duel, first, second);
  }
  duel.replayTime += dt;
  if (duel.replayTime >= .1) {
    duel.replayTime = 0;
    duel.replay.push(duel.players.map((p) => ({ position: { ...p.position }, velocity: { ...p.velocity }, angle: p.angle,
      eliminated: p.eliminated, team: p.team })));
    if (duel.replay.length > 25) duel.replay.shift();
  }
  const alive = duel.players.filter((player) => !player.eliminated);
  if (alive.length < 2) {
    // Do not declare a still-falling survivor the winner of a simultaneous fall.
    const still = playersAreStill(duel.players, (x, y) => insideDuel(x, y, duel.radius));
    duel.settledFor = still ? (duel.settledFor || 0) + dt : 0;
    if (!alive.length || duel.settledFor >= .15) {
      duel.phase = "finished";
      duel.winner = alive.length ? alive[0].name : "Draw";
    }
  } else {
    const still = duel.players.every((player, side) => player.eliminated || duel.paths[side].done || duel.paths[side].speed < .12) &&
      playersAreStill(duel.players, (x, y) => insideDuel(x, y, duel.radius));
    duel.settledFor = still ? (duel.settledFor || 0) + dt : 0;
    if (duel.settledFor < .15) return;
    if (!duel.eroding) {
      duel.round += 1;
      const nextRadius = Math.max(2.8, DUEL_RADIUS - (duel.round - 1) * .7);
      const distances = alive.map((player) => Math.hypot(player.position.x, player.position.y)).sort((a, b) => a - b);
      // If everyone would fall, keep the closest survivor supported until the others fall.
      duel.radius = Math.min(duel.radius, distances[0] >= nextRadius && distances[1] - distances[0] > .05
        ? (distances[0] + distances[1]) / 2 : nextRadius);
    }
    duel.players.forEach((player) => {
      player.velocity.x = player.velocity.y = 0;
    });
    // Keep physics running while unsupported characters fall, rather than deleting them.
    duel.eroding = alive.some((player) => !insideDuel(player.position.x, player.position.y, duel.radius));
    if (duel.eroding) {
      duel.paths.forEach((path) => { if (path) path.done = true; });
    } else {
      duel.phase = "planning";
      duel.paths = duel.players.map(() => null);
      duel.locked = duel.players.map((player) => player.eliminated);
    }
  }
}
