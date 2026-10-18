import { buildPreview } from "./equations.js";
import { firePreview, selectCharacter, updateRound } from "./combat.js";
import { FIXED_STEP, insideArena } from "./physics.js";

export const AI_LEVELS = { ai: { description: "Simulates shots using the same physics as you." } };
const copyPlayers = (players) => players.map((player) => ({ ...player,
  position: { ...player.position }, velocity: { ...player.velocity } }));
const number = (value) => Number(value.toFixed(4));
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

function aimedCurve(from, to, bend) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const slope = (dy - (bend === "wave" ? 2 * Math.sin(dx / 3) : 0)) /
    (Math.abs(dx) < .1 ? -.1 : dx);
  if (bend === "wave") return `${number(slope)}*x+2*sin(x/3)`;
  return bend ? `(${bend})*x^2+(${number(slope - bend * dx)})*x` : `${number(slope)}*x`;
}

export function projectileCandidates(round) {
  const shooters = round.players.map((player, index) => ({ player, index })).filter(({ player }) =>
    player.team === 1 && !player.eliminated && player.health > 0 && Math.abs(player.position.z - .5) < .05);
  const targets = round.players.filter((player) => player.team === 0 && !player.eliminated && player.health > 0);
  const choices = [[0, .5], [0, 1.8], [0, 3], [.045, 1], [-.045, 1], ["wave", 1]];
  return choices.flatMap(([bend, force]) => shooters.flatMap(({ player, index }) => targets.map((target) => ({
    playerIndex: index, expression: aimedCurve(player.position, target.position, bend), force,
  }))));
}

export function scoreProjectileAction(round, action) {
  const trial = { ...round, players: copyPlayers(round.players), selected: [...round.selected], attack: null, result: null, automatic: false };
  const preview = buildPreview(action.expression, trial.players[action.playerIndex].position, -1);
  if (!selectCharacter(trial, action.playerIndex) || !firePreview(trial, action.playerIndex, preview, action.force)) return -Infinity;
  // Test each candidate with the real fixed-step physics; never change the live round.
  for (let step = 0; step < 6 / FIXED_STEP; step++) updateRound(trial, FIXED_STEP);
  let score = 0;
  trial.players.forEach((player, index) => {
    const before = round.players[index];
    if (before.eliminated) return;
    const loss = before.health - player.health + (player.eliminated ? 120 : 0);
    score += player.team === 0 ? loss : -1.5 * loss;
    if (player.team === 1 && !player.eliminated && !insideArena(player.position.x, player.position.y, .8)) score -= 12;
  });
  return score;
}

export async function chooseProjectileAction(round, _difficulty = "ai", options = {}) {
  const { pause = wait, cancelled = () => false } = options;
  round = { ...round, players: copyPlayers(round.players), selected: [...round.selected] };
  let best = null, bestScore = -Infinity;
  for (const action of projectileCandidates(round)) {
    if (cancelled()) return null;
    const score = scoreProjectileAction(round, action);
    if (score > bestScore) { best = action; bestScore = score; }
    await pause(); // Yield between trials so the browser keeps rendering.
  }
  return cancelled() ? null : best;
}
