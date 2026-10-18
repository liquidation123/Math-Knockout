import { buildPreview } from "./equations.js";
import { travelPath, createDuel, lockEquation, launchDuel, updateDuel, inkFromMask, setShapePhysics, bumpDirection } from "./duel.js";
import { insideArena, takeFixedSteps } from "./physics.js";
import { createView } from "./scene.js";
import { readSavedMask } from "./saved-character.js";
import { duelSocketUrl } from "./duel-connection.js";
import { chooseBumpAction, publicBumpState } from "./ai.js";
import { createOpponentUI } from "./opponent-ui.js";
import { equationText } from "./ai-types.js";

const $ = (selector) => document.querySelector(selector);
const opponent = createOpponentUI();
const room = new URL(location.href);
if (!opponent.isAI && !room.searchParams.has("room")) {
  room.searchParams.set("room", crypto.randomUUID().slice(0, 8));
  history.replaceState(null, "", room);
}
const view = createView($("#arena"), $("#hud"), $("#controls"), "bump");
let mountainReady = false;
let startupFailed = false, leaving = false;
let socket;
let state, previewLine, preview, lastKey = "", summitView = false, previewStarted = 0, lastCount = 0;
let soloDuel = null, soloReady = false, soloStartAt = 0, aiPending = false, aiEquation = "";
let previousFrame;
const soloClock = { accumulator: 0 };
$("#invite").hidden = opponent.isAI;
function updateLoading() {
  // A loaded model alone is not enough: the server must assign a real side.
  $("#loading").hidden = mountainReady && !!state && !startupFailed;
  if (!startupFailed) $("#loading-message").textContent = mountainReady ? "Waiting for side assignment…" : "Loading the summit…";
}
function showConnectionError(message, error) {
  if (startupFailed || leaving) return;
  startupFailed = true;
  $("#loading").hidden = false;
  $("#loading-message").textContent = message;
  $("#retry").hidden = false;
  $("#side").textContent = "Connection unavailable";
  $("#phase").textContent = "Could not connect";
  $("#error").textContent = message;
  for (const id of ["#equation", "#lock", "#reset", "#view", "#again"]) $(id).disabled = true;
  document.querySelectorAll("[data-equation]").forEach((button) => { button.disabled = true; });
  console.error("Bump Duel:", message, error || "");
  socket?.close();
}
view.ready.then(() => {
  mountainReady = true;
  updateLoading();
  updateScreen();
}).catch((error) => {
  showConnectionError("The mountain could not load. Check the connection, then retry.", error);
});
view.setViewMode("character");
const localPage = ["localhost", "127.0.0.1", "[::1]"].includes(room.hostname);
const connectionHelp = localPage
  ? "Cannot reach the Bump Duel server. Stop the old server and run npm start again; open the address it prints, then retry."
  : "Online Bump Duel is unavailable. Please retry later or use Change mode to play Projectile Duel.";
try {
  if (!opponent.isAI) socket = new WebSocket(duelSocketUrl(room.href));
} catch (error) {
  showConnectionError(connectionHelp, error);
}

socket?.addEventListener("open", async () => {
  try {
    const mask = await readSavedMask();
    if (mask && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "shape", mask }));
      $("#character-note").firstChild.textContent = "Your drawing is in the duel · ";
    }
  } catch { $("#error").textContent = "Saved drawing could not load; using a starter character."; }
});

function drawPreview() {
  if (startupFailed || !state || state.side == null || state.phase !== "planning" || state.locked[state.side]) return;
  const player = state.players[state.side];
  const direction = bumpDirection(state.players, state.side);
  const key = $("#equation").value + player.position.x + "," + player.position.y + "|" + direction;
  if (key === lastKey) return;
  lastKey = key;
  preview = buildPreview($("#equation").value, player.position, direction);
  if (previewLine) view.removeCurve(previewLine);
  previewLine = null;
  if (preview.error) { $("#error").textContent = preview.error; return; }
  const points = [];
  for (const point of travelPath(preview.path)) {
    if (!insideArena(point.x, point.y)) break;
    points.push(point);
  }
  if (points.length > 1) {
    previewLine = view.drawCurve([points], 0xffffff, true);
    previewStarted = Date.now();
  }
  const end = points.at(-1);
  const edge = end && !insideArena(end.x, end.y, .8);
  $("#location").textContent = end ? `Landing ≈ (${end.x.toFixed(1)}, ${end.y.toFixed(1)})${edge ? " · near the edge!" : ""}` : "No playable path";
  $("#error").textContent = edge ? "Careful: this path ends close to the fall edge." : "Your opponent's hidden path may change the collision.";
}

function updateScreen() {
  if (!state || startupFailed) return;
  const { side, phase, players, locked } = state;
  $("#side").textContent = `You are ${side === 0 ? "Blue" : "Red"} · mass ${players[side].mass.toFixed(2)}×`;
  $("#blue").textContent = `Blue · ${players[0].eliminated ? "OUT" : phase === "finished" ? "survived" : locked[0] ? "ready" : "choosing"}`;
  $("#red").textContent = `Red · ${players[1].eliminated ? "OUT" : phase === "finished" ? "survived" : locked[1] ? "ready" : "choosing"}`;
  $("#phase").textContent = phase === "planning" ? "Choose a path" : phase === "countdown" ? "Launching together" : phase === "finished" ? state.winner === "Draw" ? "Draw" : `${state.winner} wins` : "Duel in motion";
  const canEdit = mountainReady && phase === "planning" && !locked[side];
  $("#equation").disabled = $("#lock").disabled = !canEdit;
  $("#view").disabled = !mountainReady || players[side].eliminated;
  $("#reset").disabled = !mountainReady;
  $("#lock").textContent = locked[side] ? "Locked ✓" : "Lock in";
  $("#result-screen").hidden = phase !== "finished";
  document.querySelectorAll("[data-equation]").forEach((button) => { button.disabled = !canEdit; });
  if (phase === "planning" && locked[side]) $("#error").textContent = opponent.isAI ? "Locked in. Waiting for Red's independent choice." : "Locked in. Waiting for the other player.";
  if (phase === "planning" && !locked[side]) drawPreview();
  if (phase === "finished") {
    const win = state.winner === (side === 0 ? "Blue" : "Red");
    $("#result-title").textContent = state.winner === "Draw" ? "It's a draw" : win ? "You held the summit!" : "You fell from the summit";
    $("#result-detail").textContent = state.winner === "Draw" ? "Both characters went over the edge." : `${state.winner} stayed on top. Try a new path and predict the collision.`;
  }
}

socket?.addEventListener("message", ({ data }) => {
  if (startupFailed || leaving) return;
  let message;
  try { message = JSON.parse(data); }
  catch (error) { showConnectionError("The duel server sent an unreadable message. Restart the server, then retry.", error); return; }
  if (!message || typeof message !== "object") { showConnectionError("The duel server sent an invalid message. Restart it, then retry."); return; }
  if (message.type === "error") { $("#error").textContent = message.error; return; }
  if (message.type === "shape") { view.setPlayerShape(message.side, message.mask); return; }
  if (message.type !== "state") return;
  if (![0, 1].includes(message.side) || !Array.isArray(message.players) || message.players.length !== 2 ||
      !message.players.every((player) => player?.position && Number.isFinite(player.mass)) || !Array.isArray(message.locked)) {
    showConnectionError("The duel server sent an invalid starting state. Restart it, then retry."); return;
  }
  receiveState(message);
});

function receiveState(message) {
  const oldPhase = state?.phase;
  const wasLocalPathLocked = state?.locked?.[message.side];
  state = message;
  updateLoading();
  if (!wasLocalPathLocked && state.locked[state.side]) {
    window.posthog?.capture("bump_path_locked", {
      opponent_type: opponent.isAI ? "ai" : "human",
    });
  }
  if (oldPhase !== "finished" && state.phase === "finished") {
    const localTeam = state.side === 0 ? "Blue" : "Red";
    const opponentType = opponent.isAI ? "ai" : "human";
    const outcome = state.winner === "Draw" ? "draw" : state.winner === localTeam ? "win" : "loss";
    window.posthog?.capture("bump_duel_completed", {
      opponent_type: opponentType,
      outcome,
    });
    window.posthog?.logger?.info("bump duel completed", {
      event: "bump_duel_completed",
      opponent_type: opponentType,
      outcome,
    });
    summitView = true;
    view.setViewMode("summit");
    $("#view").textContent = "First person";
  }
  if (oldPhase !== "planning" && state.phase === "planning") {
    opponent.cancel();
    aiPending = false;
    aiEquation = "";
    summitView = false;
    view.setViewMode("character");
    $("#view").textContent = "Summit view";
    lastKey = "";
    if (previewLine) { view.removeCurve(previewLine); previewLine = null; }
  }
  if (oldPhase !== "countdown" && state.phase === "countdown") {
    view.setViewMode("follow");
    summitView = false;
    // Red's committed equation is revealed only AFTER Blue has also locked.
    if (opponent.isAI && aiEquation) opponent.speak("Red", equationText(aiEquation), opponent.token());
  }
  if (state.phase === "running" && previewLine) { view.removeCurve(previewLine); previewLine = null; }
  updateScreen();
}

function publishSolo() {
  receiveState({ side: 0, phase: soloDuel.phase, players: soloDuel.players,
    locked: [...soloDuel.locked], winner: soloDuel.winner, startAt: soloStartAt });
}
function startCountdown() {
  if (soloDuel.phase === "planning" && soloDuel.locked.every(Boolean)) {
    soloDuel.phase = "countdown";
    soloStartAt = Date.now() + 3000;
  }
  publishSolo();
}
async function startSolo() {
  opponent.cancel();
  aiPending = false;
  soloReady = false;
  soloStartAt = 0;
  soloClock.accumulator = 0;
  soloDuel = createDuel();
  const token = opponent.token();
  try {
    const mask = await readSavedMask();
    if (!opponent.current(token) || leaving) return;
    if (mask && inkFromMask(mask) <= 20.5) {
      setShapePhysics(soloDuel.players[0], mask);
      view.setPlayerShape(0, mask);
      $("#character-note").firstChild.textContent = "Your drawing is in the duel · ";
    }
  } catch (error) { console.warn("Saved drawing unavailable; using a starter character.", error); }
  if (!opponent.current(token) || leaving) return;
  soloReady = true;
  aiEquation = "";
  state = null;
  publishSolo();
}
async function playBumpAi() {
  if (!opponent.isAI || !soloReady || !mountainReady || startupFailed || leaving || aiPending ||
      soloDuel.phase !== "planning" || soloDuel.locked[1] || soloDuel.players[1].eliminated) return;
  aiPending = true;
  const token = opponent.token();
  // Copy public positions/physics NOW. Never pass soloDuel.paths to the AI.
  const publicState = publicBumpState(soloDuel);
  opponent.choosing(true);
  try {
    await opponent.wait(150, token);
    const expression = await chooseBumpAction(publicState, opponent.difficulty, {
      type: opponent.type,
      pause: () => opponent.wait(0, token), cancelled: () => !opponent.current(token) || leaving,
    });
    if (!opponent.current(token) || !expression || leaving || soloDuel.phase !== "planning" || soloDuel.locked[1] || soloDuel.players[1].eliminated) return;
    const error = lockEquation(soloDuel, 1, expression);
    if (error) throw new Error(error);
    aiEquation = expression;
    startCountdown();
  } catch (error) {
    if (opponent.current(token)) showConnectionError("AI could not choose a path. Use Retry to start again.", error);
  } finally {
    if (opponent.current(token)) { aiPending = false; opponent.choosing(false); }
  }
}
socket?.addEventListener("error", (error) => showConnectionError(connectionHelp, error));
socket?.addEventListener("close", (event) => showConnectionError(event.reason || connectionHelp));
window.addEventListener("pagehide", () => { leaving = true; opponent.cancel(); document.exitPointerLock?.(); socket?.close(); });
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
$("#equation").addEventListener("input", drawPreview);
document.querySelectorAll("[data-equation]").forEach((button) => button.addEventListener("click", () => {
  $("#equation").value = button.dataset.equation;
  drawPreview();
  $("#equation").focus();
}));
$("#form").addEventListener("submit", (event) => {
  event.preventDefault();
  drawPreview();
  if (startupFailed || !mountainReady || preview?.error || state?.phase !== "planning") return;
  if (opponent.isAI) {
    const error = lockEquation(soloDuel, 0, $("#equation").value);
    if (error) { $("#error").textContent = error; return; }
    startCountdown();
  } else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "lock", expression: $("#equation").value }));
});
function restart() {
  if (opponent.isAI) { startSolo(); return; }
  if (!startupFailed && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "reset" }));
}
$("#reset").addEventListener("click", restart);
$("#again").addEventListener("click", restart);
$("#invite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    window.posthog?.capture("bump_invite_copied", {
      opponent_type: "human",
    });
    $("#invite").textContent = "Link copied ✓";
    setTimeout(() => $("#invite").textContent = "Invite friend ↗", 1600);
  } catch { $("#error").textContent = "Copy failed. Share the URL in your address bar."; }
});
$("#view").addEventListener("click", () => {
  if (state?.players[state.side].eliminated) return;
  summitView = !summitView;
  view.setViewMode(summitView ? "summit" : "character");
  $("#view").textContent = summitView ? "First person" : "Summit view";
});
function frame(timestamp) {
  const seconds = previousFrame === undefined ? 0 : (timestamp - previousFrame) / 1000;
  previousFrame = timestamp;
  if (soloReady && !startupFailed && !leaving) {
    if (soloDuel.phase === "countdown" && Date.now() >= soloStartAt) launchDuel(soloDuel);
    takeFixedSteps(soloClock, seconds, (dt) => updateDuel(soloDuel, dt));
    publishSolo();
    playBumpAi();
  }
  if (state && !startupFailed) {
    view.drawPlayers(state.players, state.side);
    view.updateCharacterCamera(state.players, state.side);
    const left = Math.ceil((state.startAt - Date.now()) / 1000);
    $("#countdown").hidden = state.phase !== "countdown";
    const count = Math.max(1, left);
    if (count !== lastCount) {
      $("#countdown strong").textContent = count;
      $("#countdown strong").style.animation = "none";
      requestAnimationFrame(() => { $("#countdown strong").style.animation = ""; });
      lastCount = count;
    }
  }
  if (previewLine?.children?.[0]?.isLine) {
    const line = previewLine.children[0];
    const total = line.geometry.getAttribute("position").count;
    line.geometry.setDrawRange(0, Math.max(2, Math.min(total, Math.floor((Date.now() - previewStarted) / 1400 * total))));
  }
  view.render();
  requestAnimationFrame(frame);
}
if (opponent.isAI) startSolo();
requestAnimationFrame(frame);
