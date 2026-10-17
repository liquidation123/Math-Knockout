import { buildPreview } from "./equations.js";
import { createView } from "./scene.js";
import { takeFixedSteps } from "./physics.js";
import { createRound, updateRound, firePreview, selectCharacter, TEAM_NAMES } from "./combat.js";

const view = createView(
  document.querySelector("#arena"), document.querySelector("#hud"), document.querySelector("#controls"),
);
const status = document.querySelector("#status");
const expression = document.querySelector("#expression");
const fire = document.querySelector("#fire");
const errorLabel = document.querySelector("#equation-error");
let round;
let clock;
let previousTime;
let activeCurve = null;
let drawnAttack = null;
let previewCurve = null;
let preview = null;
let previewKey = "";
let reportedEliminations = new Set();

function resetRound() {
  round = createRound();
  clock = { accumulator: 0 };
  previousTime = undefined;
  reportedEliminations = new Set();
  if (activeCurve) view.removeCurve(activeCurve);
  if (previewCurve) view.removeCurve(previewCurve);
  activeCurve = null;
  drawnAttack = null;
  previewCurve = null;
  previewKey = "";
  document.querySelector("#result").hidden = true;
  console.info("New round", round.players.map((player) => ({
    name: player.name, x: player.position.x, y: player.position.y,
  })));
  refreshPreview();
  updateReadout();
}

function refreshPreview() {
  const index = round.selected[round.currentTeam];
  const player = round.players[index];
  const origin = player.position;
  const key = expression.value + "|" + index + "|" + origin.x + "," + origin.y + "|" + Boolean(round.result);
  if (key === previewKey) return;
  previewKey = key;
  preview = round.result ? null : buildPreview(expression.value, origin, player.team === 0 ? 1 : -1);
  if (previewCurve) view.removeCurve(previewCurve);
  previewCurve = preview && !preview.error ? view.drawCurve([preview.path], 0xffffff, true) : null;
  expression.setAttribute("aria-invalid", String(Boolean(preview?.error)));
  errorLabel.textContent = preview?.error || "";
}

expression.addEventListener("input", refreshPreview);
expression.addEventListener("change", () => {
  if (preview?.error) console.warn("Equation rejected:", preview.error);
});
document.querySelector("#restart").addEventListener("click", resetRound);
view.onCharacterClick((index) => {
  if (round.result) return;
  if (selectCharacter(round, index)) {
    console.info("Selected", round.players[index].name);
  } else {
    round.message = "Choose a surviving " + TEAM_NAMES[round.currentTeam] + " character.";
  }
  refreshPreview();
  updateReadout();
});
fire.addEventListener("click", () => {
  refreshPreview();
  if (firePreview(round, round.selected[round.currentTeam], preview)) {
    console.info("Fired", round.players[round.attack.attackerIndex].name, round.attack.equation.name);
    view.canvas.focus({ preventScroll: true });
    updateReadout();
  }
});

function updateSimulation(dt) {
  if (round.result) return;
  const teamBefore = round.currentTeam;
  const attack = round.attack;
  const wasStopped = attack?.stopped;
  updateRound(round, dt);
  if (attack?.stopped && !wasStopped) console.info("Projectile stopped:", attack.reason);
  round.players.forEach((player, index) => {
    if (player.eliminated && !reportedEliminations.has(index)) {
      reportedEliminations.add(index);
      console.info("Eliminated", player.name);
    }
  });
  if (round.result) console.info("Round complete", round.result);
  else if (teamBefore !== round.currentTeam) console.info("Turn:", TEAM_NAMES[round.currentTeam]);
}

function updateReadout() {
  TEAM_NAMES.forEach((name, team) => {
    const members = round.players.filter((player) => player.team === team);
    const alive = members.filter((player) => !player.eliminated);
    const id = name.toLowerCase();
    document.querySelector("#" + id + "-health").value = alive.reduce((sum, player) => sum + player.health, 0);
    document.querySelector("#" + id + "-stats").textContent = alive.length + "/3 surviving";
    document.querySelector("#" + id + "-characters").textContent = members.map((player) =>
      player.name + ": " + (player.eliminated ? "OUT" : player.health + " HP") +
      (round.players[round.selected[round.currentTeam]] === player && !round.result ? " ◀" : ""),
    ).join("\n");
  });
  const selected = round.players[round.selected[round.currentTeam]];
  document.querySelector("#turn").textContent = round.result ? "Round complete" : TEAM_NAMES[round.currentTeam] + "'s turn";
  document.querySelector("#caster").textContent = round.result ? "" : selected.name + " selected";
  fire.disabled = Boolean(!preview || preview.error || round.result || round.attack ||
    selected.eliminated || Math.abs(selected.position.z - 0.5) > 0.05);
  if (status.textContent !== round.message) status.textContent = round.message;
  if (round.result) {
    document.querySelector("#result").hidden = false;
    document.querySelector("#winner").textContent =
      round.result.winner === "Draw" ? "Draw" : round.result.winner + " wins";
    document.querySelector("#finish-reason").textContent = round.result.reason;
  }
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
  takeFixedSteps(clock, seconds, updateSimulation);
  drawAttack();
  refreshPreview();
  const selectedIndex = !round.result ? round.selected[round.currentTeam] : null;
  view.drawGrid(round.players, selectedIndex);
  view.drawPlayers(round.players, selectedIndex);
  view.drawProjectile(round.attack);
  updateReadout();
  view.render();
  requestAnimationFrame(animate);
}
resetRound();
requestAnimationFrame(animate);
