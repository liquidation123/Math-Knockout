import { createVictoryScreen } from "./victory.js";
import { createEquationInput } from "./curve-input.js";
import { readSavedMask } from "./saved-character.js";
import { createView } from "./scene.js";
import { takeFixedSteps } from "./physics.js";
import { createRound, updateRound, firePreview, selectCharacter, TEAM_NAMES } from "./combat.js";
import { buildPreview } from "./equations.js";
import { chooseProjectileAction } from "./ai.js";
import { createOpponentUI } from "./opponent-ui.js";

const opponent = createOpponentUI();
let aiPending = false, aiFailed = false, leaving = false;
window.addEventListener("pagehide", () => { leaving = true; opponent.cancel(); });

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
    for (let index = 0; index < 3; index += 1) view.setPlayerShape(index, mask);
    document.querySelector("#character-note").firstChild.textContent = "Blue uses your drawing; Red has its own characters · ";
  }
}).catch((error) => console.warn("Saved drawing unavailable; using starter characters.", error));
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
document.querySelector(".controls-side").insertBefore(resultView, status);
const resultPerspective = resultView.querySelector("select");
const teamParam = new URLSearchParams(location.search).get("team");
resultPerspective.value = TEAM_NAMES.find((name) => name.toLowerCase() === teamParam?.toLowerCase()) || (opponent.isAI ? "Blue" : "");
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
let roundStartedAt = 0;
let roundEndedAt = null;
let shotsFired = [0, 0];
const roundTime = document.querySelector("#round-time");
const equationInput = createEquationInput(() => { previewKey = ""; refreshPreview(); });
// Desmos-style equation boxes. If MathLive cannot load, the plain text boxes still work.
import("./math-field.js").then((module) => module.upgradeMathInputs())
  .catch((error) => console.warn("Math boxes unavailable; using plain text inputs.", error));

function resetRound() {
  opponent.cancel();
  aiPending = false;
  aiFailed = false;
  round = createRound();
  clock = { accumulator: 0 };
  previousTime = undefined;
  reportedEliminations = new Set();
  observedAttack = null;
  roundStartedAt = Date.now();
  roundEndedAt = null;
  shotsFired = [0, 0];
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
  preview = round.result || (opponent.isAI && round.currentTeam === 1) ? null : equationInput.preview(origin, player.team === 0 ? 1 : -1);
  if (previewCurve) view.removeCurve(previewCurve);
  if (branchCurve) view.removeCurve(branchCurve);
  branchCurve = preview?.selection ? view.drawCurve(preview.sections, 0x71849e, true) : null;
  previewCurve = preview && !preview.error ? view.drawCurve([preview.path], 0xfff26c, "aim") : null;
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
  if (round.result || (opponent.isAI && round.currentTeam === 1)) return;
  if (selectCharacter(round, index)) {
    console.info("Selected", round.players[index].name);
  } else {
    round.message = "Choose a surviving " + TEAM_NAMES[round.currentTeam] + " character.";
  }
  refreshPreview();
  updateReadout();
}, (point) => {
  if (!round.result && !round.attack && !(opponent.isAI && round.currentTeam === 1)) equationInput.selectPoint(point, preview);
});
fire.addEventListener("click", () => {
  if (opponent.isAI && round.currentTeam === 1) return;
  refreshPreview();
  if (firePreview(round, round.selected[round.currentTeam], preview, Number(forceSlider.value))) {
    window.posthog?.capture("projectile_attack_fired", {
      opponent_type: opponent.isAI ? "ai" : "human",
      force: Number(forceSlider.value),
    });
    console.info("Fired", round.players[round.attack.attackerIndex].name, round.attack.equation.name);
    view.canvas.focus({ preventScroll: true });
    updateReadout();
  }
});

async function playAiTurn() {
  if (!opponent.isAI || leaving || aiPending || aiFailed || !mountainReady || round.currentTeam !== 1 || round.attack || round.result) return;
  if (!round.players.some((player) => player.team === 1 && !player.eliminated && Math.abs(player.position.z - 0.5) < 0.05)) return;
  aiPending = true;
  const token = opponent.token();
  const activeRound = round;
  opponent.choosing(true);
  try {
    await opponent.wait(150, token);
    const action = await chooseProjectileAction(activeRound, opponent.difficulty, {
      pause: () => opponent.wait(0, token), cancelled: () => !opponent.current(token),
    });
    if (!opponent.current(token) || !action || round.result || round.currentTeam !== 1 || round.attack) return;
    opponent.choosing(false);
    const player = round.players[action.playerIndex];
    if (player.eliminated || Math.abs(player.position.z - 0.5) > 0.05) return;
    if (!selectCharacter(round, action.playerIndex)) return;
    if (!await opponent.speak(player.name, `y = ${action.expression} · Force ${action.force}×`, token)) return;
    if (!opponent.current(token) || player.eliminated || round.result) return;
    const aim = buildPreview(action.expression, player.position, -1);
    firePreview(round, action.playerIndex, aim, action.force);
  } catch (error) {
    if (opponent.current(token)) { aiFailed = true; round.message = "AI could not choose. Restart to retry."; console.error("Projectile AI:", error); }
  } finally {
    if (opponent.current(token)) { aiPending = false; opponent.choosing(false); }
  }
}

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
    shotsFired[round.players[round.attack.attackerIndex].team] += 1; // Human and AI shots both count.
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
    const properties = { winner: round.result.winner.toLowerCase(), opponent_type: opponent.isAI ? "ai" : "human" };
    window.posthog?.capture("projectile_round_completed", properties);
    window.posthog?.logger?.info("projectile round completed", {
      event: "projectile_round_completed", ...properties,
    });
    opponent.cancel();
    aiPending = false;
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
    document.querySelector("#" + id + "-shots").textContent = shotsFired[team] + (shotsFired[team] === 1 ? " shot" : " shots");
    renderMembers(document.querySelector("#" + id + "-characters"), members);
  });
  const selected = round.players[round.selected[round.currentTeam]];
  document.querySelector("#turn").textContent = round.result ? "Round complete" : TEAM_NAMES[round.currentTeam] + "'s turn";
  document.querySelector("#caster").textContent = round.result ? "" : selected.name + " selected";
  fire.disabled = Boolean(!mountainReady || !preview || preview.error || round.result || round.attack ||
    selected.eliminated || Math.abs(selected.position.z - 0.5) > 0.05 || (opponent.isAI && round.currentTeam === 1));
  document.querySelectorAll(".math-input, math-field, #equation-type, #force, #symbols button, #implicit-options select, #launch-point").forEach((input) => {
    input.disabled = opponent.isAI && round.currentTeam === 1;
  });
  if (status.textContent !== round.message) status.textContent = round.message;
  showRoundTime();
  if (round.result) victory.show(round);
}

// Time taken this round as m:ss. The clock stops when the round has a result.
function showRoundTime() {
  if (round.result && roundEndedAt === null) roundEndedAt = Date.now();
  const seconds = Math.floor(((roundEndedAt ?? Date.now()) - roundStartedAt) / 1000);
  const text = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  if (roundTime.textContent !== text) roundTime.textContent = text;
}

// One chip per character: name, HP and a small health bar. This runs every
// frame, so the chips are rebuilt only when something actually changes.
function renderMembers(list, members) {
  const selected = round.result ? null : round.players[round.selected[round.currentTeam]];
  const key = members.map((player) => player.name + player.health + player.eliminated + (player === selected)).join("|");
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.replaceChildren(...members.map((player) => {
    const chip = document.createElement("span");
    chip.className = "member" + (player === selected ? " selected" : "") + (player.eliminated ? " out" : "");
    chip.style.setProperty("--hp", player.eliminated ? 0 : player.health / 100);
    if (player === selected) chip.setAttribute("aria-current", "true");
    const label = document.createElement("b");
    label.textContent = player.name;
    const hp = document.createElement("span");
    hp.textContent = player.eliminated ? "OUT" : player.health + " HP";
    chip.append(label, hp, document.createElement("i"));
    return chip;
  }));
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
  playAiTurn();
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
