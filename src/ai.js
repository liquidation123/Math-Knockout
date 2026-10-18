import { buildPreview } from "./equations.js";
import { firePreview, selectCharacter, updateRound } from "./combat.js";
import { createDuel, launchDuel, lockEquation, updateDuel } from "./duel.js";
import { FIXED_STEP, insideArena } from "./physics.js";

export const AI_LEVELS = {
  easy: { description: "Simple lines, rough aim and occasional mistakes.", projectileLimit: 1, bumpLimit: 1 },
  medium: { description: "Compares several routes, obstacles and landing safety.", projectileLimit: 36, bumpLimit: 7 },
  hard: { description: "Simulates more choices, force and survival risks. Not unbeatable.", projectileLimit: 81, bumpLimit: 10 },
};
const copyPlayers = (players) => players.map((player) => ({
  name: player.name, team: player.team, eliminated: player.eliminated,
  health: player.health, mass: player.mass, radius: player.radius,
  position: { ...player.position }, velocity: { ...player.velocity },
}));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const number = (value) => Number(value.toFixed(4));
const slopeTo = (from, to) => (to.y - from.y) / (Math.abs(to.x - from.x) < 0.1 ? -0.1 : to.x - from.x);
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

function aimedCurve(from, to, bend) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (bend === "wave" || bend === "-wave") {
    const amplitude = bend === "wave" ? 2 : -2;
    const slope = (dy - amplitude * Math.sin(dx / 3)) / (Math.abs(dx) < 0.1 ? -0.1 : dx);
    return `${number(slope)}*x+(${amplitude})*sin(x/3)`;
  }
  const slope = slopeTo(from, to) - bend * dx;
  return bend === 0 ? `${number(slope)}*x` : `(${bend})*x^2+(${number(slope)})*x`;
}

export function projectileCandidates(round, difficulty, random = Math.random) {
  const shooters = round.players.map((player, index) => ({ player, index })).filter(({ player }) =>
    player.team === 1 && !player.eliminated && player.health > 0 && Math.abs(player.position.z - 0.5) < 0.05);
  const targets = round.players.filter((player) => player.team === 0 && !player.eliminated && player.health > 0);
  if (!shooters.length || !targets.length) return [];
  if (difficulty === "easy") {
    const shooter = shooters[Math.floor(random() * shooters.length)];
    const target = [...targets].sort((a, b) => distance(a.position, shooter.player.position) - distance(b.position, shooter.player.position))[0];
    let slope = Math.round(slopeTo(shooter.player.position, target.position) * 5) / 5;
    if (random() < 0.3) slope += random() < 0.5 ? -0.25 : 0.25;
    return [{ playerIndex: shooter.index, expression: `${number(slope)}*x`, force: 1 }];
  }
  const choices = difficulty === "hard"
    ? [[0, 0.5], [0, 1.8], [0, 3], [0.045, 1.8], [-0.045, 1.8], ["wave", 1.8], ["-wave", 1.8], [0.09, 3], [-0.09, 3]]
    : [[0, 1], [0.045, 1], [-0.045, 1], ["wave", 1]];
  const actions = [];
  for (const [bend, force] of choices) for (const { player, index } of shooters) for (const target of targets) {
    actions.push({ playerIndex: index, expression: aimedCurve(player.position, target.position, bend), force });
  }
  return actions.slice(0, AI_LEVELS[difficulty].projectileLimit);
}

export function scoreProjectileAction(round, action, difficulty) {
  const trial = { ...round, players: copyPlayers(round.players), selected: [...round.selected], attack: null, result: null, automatic: false };
  const preview = buildPreview(action.expression, trial.players[action.playerIndex].position, -1);
  if (!selectCharacter(trial, action.playerIndex) || !firePreview(trial, action.playerIndex, preview, action.force)) return -Infinity;
  // These are the same fixed physics steps, swept collisions, piercing and recoil as gameplay.
  const seconds = difficulty === "hard" ? 8 : 6;
  for (let step = 0; step < seconds / FIXED_STEP; step += 1) updateRound(trial, FIXED_STEP);
  let score = 0;
  trial.players.forEach((player, index) => {
    const before = round.players[index];
    if (before.eliminated) return;
    const loss = before.health - player.health + (player.eliminated ? 120 : 0);
    score += player.team === 0 ? loss : -loss * (difficulty === "hard" ? 1.8 : 1.2);
    if (player.team === 1 && !player.eliminated && !insideArena(player.position.x, player.position.y, 0.8)) score -= 12;
  });
  return score;
}

export async function chooseProjectileAction(round, difficulty, options = {}) {
  const { random = Math.random, pause = wait, cancelled = () => false } = options;
  round = { ...round, players: copyPlayers(round.players), selected: [...round.selected] };
  let best = null, bestScore = -Infinity;
  for (const action of projectileCandidates(round, difficulty, random)) {
    if (cancelled()) return null;
    const score = difficulty === "easy"
      ? (buildPreview(action.expression, round.players[action.playerIndex].position, -1).error ? -Infinity : 0)
      : scoreProjectileAction(round, action, difficulty);
    if (score > bestScore) { best = action; bestScore = score; }
    // Yield after EVERY candidate rather than pausing the render loop for the whole search.
    await pause();
  }
  return cancelled() ? null : best;
}

export function publicBumpState(duel) {
  // Deliberately exclude paths, expressions, locks and all other hidden planning data.
  return { players: copyPlayers(duel.players) };
}

export function bumpCandidates(publicState, difficulty, random = Math.random) {
  const [blue, red] = publicState.players;
  if (blue.eliminated || red.eliminated) return [];
  if (difficulty === "easy") {
    let slope = Math.round(slopeTo(red.position, blue.position) * 4) / 4;
    if (random() < 0.3) slope += 0.3;
    return [`${number(slope)}*x`];
  }
  return [...new Set([
    aimedCurve(red.position, blue.position, 0),
    aimedCurve(red.position, { x: 0, y: 0 }, 0),
    "0", "0.2*x", "-0.2*x",
    aimedCurve(red.position, blue.position, 0.045),
    aimedCurve(red.position, blue.position, -0.045),
    aimedCurve(red.position, blue.position, "wave"),
    aimedCurve(red.position, blue.position, "-wave"),
    `${number(slopeTo(red.position, { x: 0, y: 0 }) + 0.4)}*x`,
  ])].slice(0, AI_LEVELS[difficulty].bumpLimit);
}

export function scoreBumpAction(publicState, expression, imaginedBlue) {
  const trial = createDuel();
  trial.players = copyPlayers(publicState.players);
  if (lockEquation(trial, 0, imaginedBlue) || lockEquation(trial, 1, expression)) return -Infinity;
  launchDuel(trial);
  for (let step = 0; step < 8.1 / FIXED_STEP && trial.phase === "running"; step += 1) updateDuel(trial, FIXED_STEP);
  const [blue, red] = trial.players;
  // A safe central landing matters more than chasing a collision over the cliff.
  return (blue.eliminated ? 120 : 0) - (red.eliminated ? 200 : 0)
    - (insideArena(red.position.x, red.position.y, 1) ? 0 : 15)
    - distance(red.position, { x: 0, y: 0 }) - distance(red.position, blue.position) * 0.15;
}

export async function chooseBumpAction(publicState, difficulty, options = {}) {
  const { random = Math.random, pause = wait, cancelled = () => false } = options;
  const [blue, red] = publicState.players;
  // Hypothetical public-state guesses, NEVER the human's chosen equation.
  const guesses = difficulty === "hard"
    ? [...new Set(["0", `${number(slopeTo(blue.position, red.position))}*x`, "0.25*x", "-0.25*x"])] : ["0"];
  let best = null, bestScore = -Infinity;
  for (const expression of bumpCandidates(publicState, difficulty, random)) {
    const scores = [];
    for (const guess of guesses) {
      if (cancelled()) return null;
      scores.push(difficulty === "easy"
        ? (buildPreview(expression, red.position, -1).error ? -Infinity : 0)
        : scoreBumpAction(publicState, expression, guess));
      await pause();
    }
    const score = Math.min(...scores) * 0.6 + scores.reduce((sum, value) => sum + value, 0) / scores.length * 0.4;
    if (score > bestScore) { best = expression; bestScore = score; }
  }
  return cancelled() ? null : best;
}
