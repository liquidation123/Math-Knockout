import { EQUATIONS, sampleEquation, buildPreview } from "./equations.js";
import { createView } from "./scene.js";
import { createPlayer, updatePlayer, applyKnockback, takeFixedSteps } from "./physics.js";
import { createRound, updateRound, firePreview, selectCharacter, TEAM_NAMES } from "./combat.js";

const iteration = Number(new URLSearchParams(location.search).get("iteration") || 3);
const view = createView(document.querySelector("#arena"), iteration);
const status = document.querySelector("#status");
const expression = document.querySelector("#expression");
const automatic = document.querySelector("#automatic");
const fire = document.querySelector("#fire");
const errorLabel = document.querySelector("#equation-error");
const keys = new Set();
let players;
let clock;
let time;
let kicked;
let round;
let activeCurve = null;
let drawnAttack = null;
let previewCurve = null;
let preview = null;
let previewKey = "";
let previousTime;

document.querySelector("#equation-controls").hidden = iteration !== 3;
if (iteration === 1) {
  players = [createPlayer("Blue", -6, 0, 0.5, 0), createPlayer("Red", 6, 0, 0.5, 1)];
  EQUATIONS.forEach((equation) => {
    view.drawCurve(sampleEquation(equation, players[0].position), equation.color);
  });
  document.querySelector("#explanation").textContent =
    "Local (x, f(x)) maps to (playerX + x, playerY + f(x), 0.5). " +
    "There is no scaling or mirroring. Domain: −24 ≤ x ≤ 24.";
} else {
  document.querySelector("#restart").hidden = false;
  document.querySelector("#restart").addEventListener("click", resetDemo);
  document.querySelector("#stage").textContent = iteration === 2
    ? "Iteration 2 · XY physics and Z height" : "Iteration 3 · Three vs three";
  document.querySelector("#explanation").textContent = iteration === 2
    ? "Gravity acts along −Z. Blue applies one diagonal XY impulse after landing."
    : "Dashed white = harmless firing path. The glowing ball alone deals damage. " +
      "Blue traverses toward +X and Red toward −X, without mirroring f(x).";
  if (iteration === 2) document.querySelector("#restart").textContent = "Replay physics";
  resetDemo();
}

function resetDemo() {
  round = iteration === 3 ? createRound(automatic.checked) : null;
  players = round ? round.players :
    [createPlayer("Blue", -6, -1, 3, 0), createPlayer("Red", 6, 1, 3, 1)];
  clock = { accumulator: 0 };
  time = 0;
  kicked = false;
  previousTime = undefined;
  keys.clear();
  if (activeCurve) view.removeCurve(activeCurve);
  if (previewCurve) view.removeCurve(previewCurve);
  activeCurve = null;
  drawnAttack = null;
  previewCurve = null;
  previewKey = "";
  document.querySelector("#result").hidden = true;
  refreshPreview();
  updateReadout();
}

function refreshPreview() {
  if (iteration !== 3) return;
  const index = round.selected[round.currentTeam];
  const player = players[index];
  const origin = player.position;
  const key = expression.value + "|" + index + "|" + origin.x + "," + origin.y + "|" + Boolean(round.result);
  if (key === previewKey) return;
  previewKey = key;
  preview = round.result ? null : buildPreview(expression.value, origin, player.team === 0 ? 1 : -1);
  if (previewCurve) view.removeCurve(previewCurve);
  previewCurve = preview && !preview.error ? view.drawCurve([preview.path], 0xffffff, true) : null;
  expression.setAttribute("aria-invalid", String(Boolean(preview?.error)));
  errorLabel.textContent = preview?.error || "";
  document.querySelector("#preview-summary").textContent = !preview || preview.error ? "" :
    player.name + " · origin (" + origin.x.toFixed(2) + ", " + origin.y.toFixed(2) +
    ") · local x = 0 toward " + (player.team === 0 ? "+X" : "−X");
}

expression.addEventListener("input", refreshPreview);
view.onCharacterClick((index) => {
  if (!round || round.automatic || round.result) return;
  if (!selectCharacter(round, index)) {
    round.message = "Choose a surviving " + TEAM_NAMES[round.currentTeam] + " character.";
  }
  refreshPreview();
  updateReadout();
});
automatic.addEventListener("change", () => {
  if (!round) return;
  round.automatic = automatic.checked;
  round.nextCastAt = round.time + 1.2;
  round.message = automatic.checked ? "Automatic demonstration enabled." : "Manual team turns.";
  keys.clear();
});

fire.addEventListener("click", () => {
  refreshPreview();
  if (firePreview(round, round.selected[round.currentTeam], preview)) {
    view.canvas.focus();
    updateReadout();
  }
});

function updateSimulation(dt) {
  if (iteration === 2) {
    time += dt;
    players.forEach((player) => updatePlayer(player, dt));
    if (time >= 1.2 && !kicked) {
      applyKnockback(players[0], players[1], 3.2);
      kicked = true;
    }
  } else {
    const movement = [];
    if (!round.automatic) {
      const blue = round.currentTeam === 0;
      movement[round.selected[round.currentTeam]] = {
        x: Number(keys.has(blue ? "d" : "arrowright")) - Number(keys.has(blue ? "a" : "arrowleft")),
        y: Number(keys.has(blue ? "w" : "arrowup")) - Number(keys.has(blue ? "s" : "arrowdown")),
      };
    }
    const teamBefore = round.currentTeam;
    updateRound(round, dt, movement);
    if (teamBefore !== round.currentTeam) keys.clear();
  }
}

function updateReadout() {
  TEAM_NAMES.forEach((name, team) => {
    const members = players.filter((player) => player.team === team);
    const alive = members.filter((player) => !player.eliminated);
    const id = name.toLowerCase();
    const health = document.querySelector("#" + id + "-health");
    health.max = members.length * 100;
    health.value = alive.reduce((sum, player) => sum + player.health, 0);
    document.querySelector("#" + id + "-stats").textContent = alive.length + "/" + members.length + " surviving";
    document.querySelector("#" + id + "-characters").textContent = members.map((player) =>
      player.name + ": " + (player.eliminated ? "OUT" : player.health + " HP") +
      (round && players[round.selected[round.currentTeam]] === player && !round.result ? " ◀ selected" : ""),
    ).join("\n");
  });
  let message;
  if (iteration === 2) {
    message = kicked ? "One diagonal XY impulse applied." : "Players fall along −Z and land on z = 0.";
  } else if (iteration === 3) {
    message = round.message;
    const attack = round.attack;
    const selected = players[round.selected[round.currentTeam]];
    document.querySelector("#turn").textContent = round.result ? "Round complete" : TEAM_NAMES[round.currentTeam] + "'s turn";
    document.querySelector("#caster").textContent = round.result ? "" : selected.name;
    document.querySelector("#cast").textContent =
      "Time " + round.time.toFixed(1) + " s · Casts " + round.castCount +
      (attack ? " · " + players[attack.attackerIndex].name + ": " + attack.equation.name +
        " · " + (attack.stopped ? attack.reason : "Projectile travelling")
        : round.result ? " · Round complete" : " · Ready");
    fire.disabled = Boolean(!preview || preview.error || round.result || round.attack ||
      round.automatic || selected.eliminated || Math.abs(selected.position.z - 0.5) > 0.05);
    if (round.result) {
      document.querySelector("#result").hidden = false;
      document.querySelector("#winner").textContent =
        round.result.winner === "Draw" ? "Draw" : round.result.winner + " wins";
      document.querySelector("#finish-reason").textContent = round.result.reason;
    }
  }
  if (message && status.textContent !== message) status.textContent = message;
}

function drawAttack() {
  if (round.attack === drawnAttack) return;
  if (activeCurve) view.removeCurve(activeCurve);
  activeCurve = round.attack ? view.drawCurve([round.attack.path], round.attack.equation.color) : null;
  drawnAttack = round.attack;
}

function animate(timestamp) {
  const seconds = previousTime === undefined ? 0 : (timestamp - previousTime) / 1000;
  previousTime = timestamp;
  if (iteration !== 1) takeFixedSteps(clock, seconds, updateSimulation);
  if (iteration === 3) {
    drawAttack();
    refreshPreview();
  }
  view.drawPlayers(players, round && !round.result ? round.selected[round.currentTeam] : null);
  view.drawProjectile(round?.attack);
  updateReadout();
  view.render();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
