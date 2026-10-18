import { firePreview, selectCharacter, updateRound } from "./combat.js";
import { createDuel, insideDuel, launchDuel, lockEquation, updateDuel } from "./duel.js";
import { forwardDirection, shotDirection } from "./aiming.js";
import { FIXED_STEP, insideArena } from "./physics.js";
import { actionPreview, typeEquations } from "./ai-types.js";

export const AI_LEVELS = {
  easy: { description: "One curve, rough aim and occasional mistakes.", projectileLimit: 1, bumpLimit: 1 },
  medium: { description: "Compares several routes and landing safety.", projectileLimit: 36, bumpLimit: 12 },
  hard: { description: "Simulates more choices, force and survival risks. Not unbeatable.", projectileLimit: 81, bumpLimit: 12 },
};
const copyPlayers = (players) => players.map((player) => ({ ...player,
  position: { ...player.position }, velocity: { ...player.velocity } }));
const bumpDirection = (players, side) => forwardDirection(players[side].position, players[1 - side].position, side === 0 ? 1 : -1);
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

export function projectileCandidates(round, difficulty = "hard", random = Math.random, type = null) {
  const shooters = round.players.map((player, index) => ({ player, index })).filter(({ player }) =>
    player.team === 1 && !player.eliminated && player.health > 0 && Math.abs(player.position.z - 0.5) < 0.05);
  const targets = round.players.filter((player) => player.team === 0 && !player.eliminated && player.health > 0);
  if (!shooters.length || !targets.length) return [];
  if (type) {
    const actions = [];
    const eligible = difficulty === "easy" ? [shooters[Math.floor(random() * shooters.length)]] : shooters;
    for (const { player, index } of eligible) {
      const nearest = [...targets].sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position));
      for (const target of nearest.slice(0, difficulty === "easy" ? 1 : 2)) {
        for (const input of typeEquations(player.position, target.position, shotDirection(round.players, index, round.players.indexOf(target)), type, difficulty, "projectile", random)) {
          actions.push({ playerIndex: index, targetIndex: round.players.indexOf(target), input, aiType: type, expression: typeof input === "string" ? input : "", force: difficulty === "hard" ? 1.8 : 1 });
        }
      }
    }
    const forces = difficulty === "hard" ? [0.5, 3] : [];
    return [...actions, ...forces.flatMap((force) => actions.map((action) => ({ ...action, force })))].slice(0, AI_LEVELS[difficulty].projectileLimit);
  }
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
    actions.push({ playerIndex: index, targetIndex: round.players.indexOf(target), expression: aimedCurve(player.position, target.position, bend), force });
  }
  return actions.slice(0, AI_LEVELS[difficulty].projectileLimit);
}

export function scoreProjectileAction(round, action, difficulty) {
  const trial = { ...round, players: copyPlayers(round.players), selected: [...round.selected], attack: null, result: null, automatic: false };
  const preview = actionPreview(action, trial.players[action.playerIndex].position, shotDirection(trial.players, action.playerIndex, action.targetIndex));
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

export async function chooseProjectileAction(round, difficulty = "hard", options = {}) {
  if (difficulty === "ai") difficulty = "hard"; // Preserve existing AI links.
  const { random = Math.random, pause = wait, cancelled = () => false } = options;
  round = { ...round, players: copyPlayers(round.players), selected: [...round.selected] };
  let best = null, bestScore = -Infinity;
  for (const action of projectileCandidates(round, difficulty, random, options.type)) {
    if (cancelled()) return null;
    const score = difficulty === "easy"
      ? (actionPreview(action, round.players[action.playerIndex].position, shotDirection(round.players, action.playerIndex, action.targetIndex)).error ? -Infinity : 0)
      : scoreProjectileAction(round, action, difficulty);
    if (score > bestScore) { best = action; bestScore = score; }
    // Yield after EVERY candidate rather than pausing the render loop for the whole search.
    await pause();
  }
  return cancelled() ? null : best;
}

export function publicBumpState(duel) {
  // Deliberately exclude paths, expressions, locks and all other hidden planning data.
  return { players: copyPlayers(duel.players), bodies: duel.bodies, radius: duel.radius, round: duel.round };
}

export function bumpCandidates(publicState, difficulty, random = Math.random, type = null) {
  const [blue, red] = publicState.players;
  if (blue.eliminated || red.eliminated) return [];
  if (type === "dot") return []; // Point-only attacks cannot move a Bump character.
  if (type) return typeEquations(red.position, blue.position, bumpDirection(publicState.players, 1), type,
    difficulty, "bump", random).slice(0, AI_LEVELS[difficulty].bumpLimit);
  if (difficulty === "easy") {
    let slope = Math.round(slopeTo(red.position, blue.position) * 4) / 4;
    if (random() < 0.3) slope += 0.3;
    return [`${number(slope)}*x`];
  }
  return [...new Set([
    aimedCurve(red.position, blue.position, 0),
    `${number(slopeTo(red.position, blue.position) + 0.12)}*x`,
    `${number(slopeTo(red.position, blue.position) - 0.12)}*x`,
    aimedCurve(red.position, blue.position, 0.025),
    aimedCurve(red.position, blue.position, -0.025),
    aimedCurve(red.position, blue.position, "wave"),
    aimedCurve(red.position, blue.position, "-wave"),
    aimedCurve(red.position, blue.position, 0.05),
    aimedCurve(red.position, blue.position, -0.05),
    `${number(slopeTo(red.position, blue.position) + 0.25)}*x`,
  ])].slice(0, AI_LEVELS[difficulty].bumpLimit);
}

export function scoreBumpAction(publicState, expression, imaginedBlue) {
  const trial = createDuel();
  trial.players = copyPlayers(publicState.players);
  trial.bodies = publicState.bodies || trial.bodies;
  trial.radius = publicState.radius ?? trial.radius;
  trial.round = publicState.round ?? trial.round;
  if (lockEquation(trial, 0, imaginedBlue) || lockEquation(trial, 1, expression)) return -Infinity;
  launchDuel(trial);
  const startGap = distance(trial.players[0].position, trial.players[1].position);
  let closestGap = startGap;
  for (let step = 0; step < 8.1 / FIXED_STEP && trial.phase === "running"; step += 1) {
    updateDuel(trial, FIXED_STEP);
    closestGap = Math.min(closestGap, distance(trial.players[0].position, trial.players[1].position));
  }
  const [blue, red] = trial.players;
  // Reward closing in and real contact, not retreating to the centre. A trade is
  // preferable to a passive miss, but falling without a hit is still a bad move.
  return (blue.eliminated ? 250 : 0) - (red.eliminated ? 180 : 0)
    + (trial.lastImpact ? 90 : 0) + (startGap - closestGap) * 5 - closestGap * 5
    - (!blue.eliminated && !red.eliminated ? distance(red.position, blue.position) * 2 : 0)
    - (!red.eliminated && !insideDuel(red.position.x, red.position.y, trial.radius - .3) ? 15 : 0);
}

export async function chooseBumpAction(publicState, difficulty, options = {}) {
  const { random = Math.random, pause = wait, cancelled = () => false } = options;
  const [blue, red] = publicState.players;
  // Hypothetical public-state guesses, NEVER the human's chosen equation.
  const guesses = difficulty === "hard"
    ? [...new Set(["0", `${number(slopeTo(blue.position, red.position))}*x`, "0.25*x", "-0.25*x"])] : ["0"];
  let best = null, bestScore = -Infinity;
  for (const expression of bumpCandidates(publicState, difficulty, random, options.type)) {
    const scores = [];
    for (const guess of guesses) {
      if (cancelled()) return null;
      scores.push(difficulty === "easy"
        ? (actionPreview(expression, red.position, bumpDirection(publicState.players, 1)).error ? -Infinity : 0)
        : scoreBumpAction(publicState, expression, guess));
      await pause();
    }
    const score = Math.min(...scores) * 0.2 + scores.reduce((sum, value) => sum + value, 0) / scores.length * 0.8;
    if (score > bestScore) { best = expression; bestScore = score; }
  }
  return cancelled() ? null : best;
}
