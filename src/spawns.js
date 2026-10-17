import { ARENA, PLAYER_SIZE, OBSTACLES, insideArena } from "./physics.js";

export const SPAWN_RULES = {
  edgeMargin: 1.5, minAbsX: 7, teammateSpacing: 2.5,
  obstacleClearance: 0.5, attemptsPerCharacter: 50,
};

export function validSpawn(point, team, teammates = []) {
  const signedX = point.x * (team === 0 ? -1 : 1);
  if (signedX < SPAWN_RULES.minAbsX ||
    signedX > ARENA.halfWidth - SPAWN_RULES.edgeMargin ||
    Math.abs(point.y) > ARENA.depth / 2 - SPAWN_RULES.edgeMargin ||
    !insideArena(point.x, point.y, SPAWN_RULES.edgeMargin)) return false;
  if (teammates.some((other) =>
    Math.hypot(point.x - other.x, point.y - other.y) < SPAWN_RULES.teammateSpacing)) return false;
  const padding = PLAYER_SIZE / 2 + SPAWN_RULES.obstacleClearance;
  return OBSTACLES.every((box) =>
    Math.abs(point.x - box.x) >= box.width / 2 + padding ||
    Math.abs(point.y - box.y) >= box.depth / 2 + padding);
}

export function generateSpawns(random = Math.random) {
  return [0, 1].flatMap((team) => {
    const points = [];
    const sign = team === 0 ? -1 : 1;
    const maxX = ARENA.halfWidth - SPAWN_RULES.edgeMargin;
    const maxY = ARENA.depth / 2 - SPAWN_RULES.edgeMargin;
    for (let character = 0; character < 3; character += 1) {
      let placed = false;
      for (let attempt = 0; attempt < SPAWN_RULES.attemptsPerCharacter; attempt += 1) {
        const point = {
          x: sign * (SPAWN_RULES.minAbsX + random() * (maxX - SPAWN_RULES.minAbsX)),
          y: (random() * 2 - 1) * maxY,
        };
        if (!validSpawn(point, team, points)) continue;
        points.push(point);
        placed = true;
        break;
      }
      // Replace the whole team so fallback slots cannot overlap earlier random picks.
      if (!placed) return [-4.5, 0, 4.5].map((y) => ({ x: sign * 10, y }));
    }
    return points;
  });
}
