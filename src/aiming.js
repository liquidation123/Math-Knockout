// Explicit equations travel along +X or -X, not along a team-fixed direction.
export function forwardDirection(shooter, target, fallback = 1) {
  const dx = target.x - shooter.x;
  // A small dead zone keeps directly vertical targets from flipping the shot.
  return Math.abs(dx) < .1 ? fallback : Math.sign(dx);
}

export function shotTarget(players, shooterIndex, preferredIndex) {
  const shooter = players[shooterIndex];
  const enemies = players.filter((player) => player.team !== shooter.team &&
    !player.eliminated && player.health > 0);
  if (enemies.includes(players[preferredIndex])) return players[preferredIndex];
  // Preserve the automatic game's existing rule: closest enemy row, stable ties.
  return enemies.reduce((best, player) => !best ||
    Math.abs(player.position.y - shooter.position.y) < Math.abs(best.position.y - shooter.position.y)
    ? player : best, null);
}

export function shotDirection(players, shooterIndex, preferredIndex) {
  const shooter = players[shooterIndex];
  const target = shotTarget(players, shooterIndex, preferredIndex);
  const fallback = shooter.team === 0 ? 1 : -1;
  return target ? forwardDirection(shooter.position, target.position, fallback) : fallback;
}
