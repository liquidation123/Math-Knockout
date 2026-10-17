import { createVictoryScreen } from "./victory.js";
import { createEquationInput } from "./curve-input.js";
import { readSavedMask } from "./saved-character.js";
import { createView } from "./scene.js";
import { takeFixedSteps } from "./physics.js";
import { createRound, updateRound, firePreview, selectCharacter, TEAM_NAMES } from "./combat.js";

const view = createView(
  document.querySelector("#arena"), document.querySelector("#hud"), document.querySelector("#controls"),
);
const status = document.querySelector("#status");
let mountainReady = false;
view.ready.then(() => {
  mountainReady = true;
  document.querySelector("#loading").hidden = true;
}).catch((error) => {
  document.querySelector("#loading").textContent = "Mountain failed to load. Reload to retry.";
  console.error("Mountain load failed:", error);
});
readSavedMask().then((mask) => {
  if (mask) {
    for (let index = 0; index < 6; index += 1) view.setPlayerShape(index, mask);
    document.querySelector("#character-note").firstChild.textContent = "Your drawing is in the arena · ";
  }
}).catch((error) => console.warn("Saved drawing unavailable; using cubes.", error));
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
const expression = document.querySelector("#expression");
const fire = document.querySelector("#fire");
const errorLabel = document.querySelector("#equation-error");
const povToggle = document.querySelector("#projectile-pov");
const forceSlider = document.querySelector("#force");
const forceValue = document.querySelector("#force-value");
// Add the result controls here so play.html stays identical to main.
const resultView = document.createElement("label");
resultView.className = "result-view";
resultView.innerHTML = 'View result as <select id="result-perspective">' +
  '<option value="">Spectator</option><option value="Blue">Blue</option><option value="Red">Red</option></select>';
document.querySelector("#controls").insertBefore(resultView, status);
const resultPerspective = resultView.querySelector("select");
const teamParam = new URLSearchParams(location.search).get("team");
resultPerspective.value = TEAM_NAMES.find((name) => name.toLowerCase() === teamParam?.toLowerCase()) || "";
const victory = createVictoryScreen(() => {
  resetRound();
  expression.focus();
}, () => resultPerspective.value || null);
let round;
let clock;
let previousTime;
let activeCurve = null;
let drawnAttack = null;
let previewCurve = null;
let branchCurve = null;
let preview = null;
let previewKey = "";
let reportedEliminations = new Set();
let observedAttack = null;
const equationInput = createEquationInput(() => { previewKey = ""; refreshPreview(); });

function resetRound() {
  round = createRound();
  clock = { accumulator: 0 };
  previousTime = undefined;
  reportedEliminations = new Set();
  observedAttack = null;
  view.resetCinematic();
  if (activeCurve) view.removeCurve(activeCurve);
  if (previewCurve) view.removeCurve(previewCurve);
  if (branchCurve) view.removeCurve(branchCurve);
  activeCurve = null;
  drawnAttack = null;
  previewCurve = null;
  branchCurve = null;
  previewKey = "";
  document.querySelector("#result").hidden = true;
  victory.hide();
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
  const key = equationInput.key() + "|" + index + "|" + origin.x + "," + origin.y + "|" + Boolean(round.result);
  if (key === previewKey) return;
  previewKey = key;
  preview = round.result ? null : equationInput.preview(origin, player.team === 0 ? 1 : -1);
  if (previewCurve) view.removeCurve(previewCurve);
  if (branchCurve) view.removeCurve(branchCurve);
  branchCurve = preview?.selection ? view.drawCurve(preview.sections, 0x71849e, true) : null;
  previewCurve = preview && !preview.error ? view.drawCurve([preview.path], 0xffffff, true) : null;
  document.querySelectorAll(".math-input").forEach((input) => input.setAttribute("aria-invalid",
    String(Boolean(preview?.error) && !input.closest("[data-equation-type]").hidden)));
  errorLabel.textContent = preview?.error || "";
}

forceSlider.addEventListener("input", () => {
  forceValue.textContent = Number(forceSlider.value).toFixed(1) + "×";
});
document.querySelector("#restart").addEventListener("click", resetRound);
povToggle.addEventListener("change", () => {
  view.setProjectilePOVEnabled(povToggle.checked);
});
view.onCharacterClick((index) => {
  if (round.result) return;
  if (selectCharacter(round, index)) {
    console.info("Selected", round.players[index].name);
  } else {
    round.message = "Choose a surviving " + TEAM_NAMES[round.currentTeam] + " character.";
  }
  refreshPreview();
  updateReadout();
}, (point) => {
  if (!round.result && !round.attack) equationInput.selectPoint(point, preview);
});
fire.addEventListener("click", () => {
  refreshPreview();
  if (firePreview(round, round.selected[round.currentTeam], preview, Number(forceSlider.value))) {
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
  const hitsBefore = attack?.hits.length || 0;
  updateRound(round, dt);
  for (const hit of attack?.hits.slice(hitsBefore) || []) {
    view.createImpact("Enemy hit", hit.position);
    console.info("Enemy hit:", round.players[hit.playerIndex].name);
  }
  if (round.attack && round.attack !== observedAttack) {
    observedAttack = round.attack;
    if (povToggle.checked) view.beginProjectilePOV(round.attack);
  }
  if (attack?.stopped && !wasStopped) console.info("Projectile stopped:", attack.reason);
  if (attack?.stopped && !wasStopped) {
    view.createImpact(attack.reason, attack.impactPoint || attack.position);
    view.notifyProjectileStopped(attack);
  }
  round.players.forEach((player, index) => {
    if (player.eliminated && !reportedEliminations.has(index)) {
      reportedEliminations.add(index);
      console.info("Eliminated", player.name);
    }
  });
  if (round.result) {
    console.info("Round complete", round.result);
    view.finishProjectilePOV();
  } else if (teamBefore !== round.currentTeam) console.info("Turn:", TEAM_NAMES[round.currentTeam]);
  if (!round.attack && observedAttack) {
    view.finishProjectilePOV();
    observedAttack = null;
  }
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
  fire.disabled = Boolean(!mountainReady || !preview || preview.error || round.result || round.attack ||
    selected.eliminated || Math.abs(selected.position.z - 0.5) > 0.05);
  if (status.textContent !== round.message) status.textContent = round.message;
  if (round.result) victory.show(round);
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
  view.updateCinematic(round.result ? null : round.attack, seconds, povToggle.checked);
  const selectedIndex = !round.result ? round.selected[round.currentTeam] : null;
  view.drawGrid(round.players, selectedIndex);
  view.drawPlayers(round.players, selectedIndex);
  view.drawProjectile(round.attack);
  view.updateEffects(seconds);
  updateReadout();
  view.render();
  requestAnimationFrame(animate);
}
resetRound();
requestAnimationFrame(animate);
