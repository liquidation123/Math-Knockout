import { ARENA, createPlayer, updatePlayer } from "./physics.js";
import { generateSpawns } from "./spawns.js";
import { ATTACK_DURATION, createAttack, updateProjectile } from "./projectile.js";
export { DAMAGE, KNOCKBACK, ATTACK_DURATION, createAttack } from "./projectile.js";

export const TURN_INTERVAL = 1.25;
export const TEAM_NAMES = ["Blue", "Red"];
export const AUTO_EQUATIONS = [
  { name: "y = 0", evaluate: () => 0, color: 0xffcd6b },
  { name: "y = sin(x)", evaluate: Math.sin, color: 0x76e5c0 },
  { name: "y = 0.02x²", evaluate: (x) => 0.02 * x * x, color: 0xef95ed },
];

export function createRound(automatic = false, random = Math.random) {
  const players = generateSpawns(random).map((point, index) => {
    const team = Math.floor(index / 3);
    return createPlayer(TEAM_NAMES[team] + " " + (index % 3 + 1), point.x, point.y, 3, team);
  });
  return {
    players, automatic,
    selected: [1, 4],
    currentTeam: 0,
    time: 0,
    castCount: 0,
    nextCastAt: 1.2,
    attack: null,
    result: null,
    message: "Blue's turn. Click a blue character, preview an equation, then Fire.",
  };
}

export function selectCharacter(round, index) {
  const player = round.players[index];
  if (round.result || !player || player.eliminated || player.health <= 0 ||
    player.team !== round.currentTeam) return false;
  round.selected[player.team] = index;
  return true;
}

function startAttack(round, attackerIndex, equation, preview = null) {
  round.attack = createAttack(attackerIndex, round.players, equation, round.time, preview);
  round.castCount += 1;
  round.nextCastAt = round.time + TURN_INTERVAL;
  round.message = round.players[attackerIndex].name + " fires " + equation.name + ".";
}

export function firePreview(round, attackerIndex, preview) {
  const player = round.players[attackerIndex];
  if (round.result || round.attack || round.automatic || !preview || preview.error ||
    !player || player.eliminated || player.health <= 0 || player.team !== round.currentTeam ||
    Math.abs(player.position.z - 0.5) > 0.05 ||
    attackerIndex !== round.selected[round.currentTeam]) return false;
  try {
    startAttack(round, attackerIndex, preview.equation, preview);
    return true;
  } catch (error) {
    round.message = error.message;
    return false;
  }
}

function checkEliminations(round) {
  round.players.forEach((player) => {
    if (player.health <= 0 || player.position.z < ARENA.fallHeight) player.eliminated = true;
  });
  for (let team = 0; team < 2; team += 1) {
    if (round.players[round.selected[team]].eliminated) {
      const next = round.players.findIndex((player) => player.team === team && !player.eliminated);
      if (next >= 0) round.selected[team] = next;
    }
  }
  const survivingTeams = TEAM_NAMES.map((_, team) =>
    round.players.some((player) => player.team === team && !player.eliminated),
  );
  if (survivingTeams.every(Boolean)) return;
  round.result = {
    winner: survivingTeams.every((alive) => !alive) ? "Draw" : TEAM_NAMES[survivingTeams[0] ? 0 : 1],
    reason: "All opposing characters eliminated",
  };
  round.message = round.result.winner === "Draw" ? "Round ended in a draw." :
    round.result.winner + " wins the round.";
}

function automaticEquation(round, index) {
  const attacker = round.players[index];
  const enemies = round.players.filter((player) => player.team !== attacker.team && !player.eliminated);
  const target = enemies.reduce((best, player) =>
    Math.abs(player.position.y - attacker.position.y) < Math.abs(best.position.y - attacker.position.y)
      ? player : best);
  const base = AUTO_EQUATIONS[Math.floor(round.castCount / 2) % AUTO_EQUATIONS.length];
  const dx = target.position.x - attacker.position.x;
  const dy = target.position.y - attacker.position.y;
  const slope = dx === 0 ? 0 : (dy - base.evaluate(dx)) / dx;
  return {
    name: base.name + " + (" + slope.toFixed(4) + ")x",
    evaluate: (x) => base.evaluate(x) + slope * x,
    color: base.color,
  };
}

export function updateRound(round, dt) {
  if (round.result) return;
  round.time += dt;
  round.players.forEach((player) => updatePlayer(player, dt));
  checkEliminations(round);
  if (round.result) return;

  if (round.attack) {
    updateProjectile(round.attack, round.players, dt);
    if (round.attack.stopped) round.message = round.attack.reason + ".";
    checkEliminations(round);
    if (round.result) return;
    if (round.attack.age >= ATTACK_DURATION) {
      round.attack = null;
      round.currentTeam = 1 - round.currentTeam;
      round.message = TEAM_NAMES[round.currentTeam] + "'s turn. Choose a surviving character.";
    }
  }

  if (round.automatic && !round.attack && round.time >= round.nextCastAt) {
    const index = round.selected[round.currentTeam];
    const equation = automaticEquation(round, index);
    startAttack(round, index, equation);
  }
}
