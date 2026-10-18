// Small, testable helpers shared by the projectile camera and its effects.
export function pathLookAhead(path, position, segment = 1, distance = 3) {
  const points = path || [];
  let current = { x: position.x, y: position.y };
  let remaining = distance;
  let index = Math.max(1, segment);
  let lastDirection = { x: 1, y: 0 };
  while (remaining > 0 && points[index]) {
    const next = points[index];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-8) {
      index += 1;
      continue;
    }
    lastDirection = { x: dx / length, y: dy / length };
    if (length >= remaining) {
      return {
        forward: lastDirection,
        target: { x: current.x + dx * remaining / length, y: current.y + dy * remaining / length },
      };
    }
    remaining -= length;
    current = { x: next.x, y: next.y };
    index += 1;
  }
  return {
    forward: lastDirection,
    target: { x: current.x + lastDirection.x * distance, y: current.y + lastDirection.y * distance },
  };
}

export function effectKind(reason) {
  if (reason === "Teleport") return "teleport";
  if (reason === "Enemy hit") return "enemy";
  if (reason === "Obstacle") return "obstacle";
  if (reason === "Map boundary") return "boundary";
  return null;
}
