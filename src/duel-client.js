import { buildPreview } from "./equations.js";
import { chooseBotEquation, createDuel, insideDuel, interceptSlope, launchDuel, lockEquation, safeTravelPath, setDuelBody, updateDuel } from "./duel.js";
import { takeFixedSteps } from "./physics.js";
import { createView } from "./scene.js";
import { readSavedMask } from "./saved-character.js";
import { BUMP_SERVER_URL, duelSocketUrl } from "./duel-connection.js";

const $ = (selector) => document.querySelector(selector);
const room = new URL(location.href);
if (!room.searchParams.has("room") && room.searchParams.get("quick") !== "1") {
  room.searchParams.set("room", crypto.randomUUID().slice(0, 8));
  history.replaceState(null, "", room);
}
const view = createView($("#arena"), $("#hud"), $("#controls"), "bump");
let mountainReady = false;
let startupFailed = false, leaving = false;
let socket;
let state, previewLine, preview, lastKey = "", summitView = false, previewStarted = 0, lastCount = 0;
let replayFrames = null, replayStarted = 0;
let pathWasLocked = false;
const localPage = ["localhost", "127.0.0.1", "[::1]"].includes(room.hostname);
const solo = !localPage && !BUMP_SERVER_URL;
let duel, soloStartAt = 0, previous = 0;
const soloClock = { accumulator: 0 };
if (solo) $("#invite").hidden = true;
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
  $("#error").textContent = "Offline";
  for (const id of ["#equation", "#lock", "#reset", "#view", "#again"]) $(id).disabled = true;
  document.querySelectorAll("[data-aim]").forEach((button) => { button.disabled = true; });
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
const connectionHelp = localPage
  ? "Cannot reach the Bump Duel server. Stop the old server and run npm start again; open the address it prints, then retry."
  : "Online Bump Duel is unavailable. Please retry later or use Change mode to play Projectile Duel.";
try {
  if (!solo) {
  const address = new URL(duelSocketUrl(room.href));
  const token = room.searchParams.get("room") && sessionStorage.getItem("duel:" + room.searchParams.get("room"));
  if (token) address.searchParams.set("resume", token);
  socket = new WebSocket(address.href);
  }
} catch (error) {
  showConnectionError(connectionHelp, error);
}

socket?.addEventListener("open", async () => {
  try {
    const mask = await readSavedMask();
    if (mask && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "shape", mask }));
    }
  } catch { $("#error").textContent = "Saved drawing could not load; using a starter character."; }
});

function drawPreview() {
  if (startupFailed || !state || state.side == null || state.phase !== "planning" || state.locked[state.side]) return;
  const player = state.players[state.side];
  const key = $("#equation").value + player.position.x + "," + player.position.y + "," + state.radius + "," + player.mass;
  if (key === lastKey) return;
  lastKey = key;
  preview = buildPreview($("#equation").value, player.position, state.side === 0 ? 1 : -1);
  if (previewLine) view.removeCurve(previewLine);
  previewLine = null;
  if (preview.error) { $("#error").textContent = preview.error; return; }
  const points = safeTravelPath(preview.path, player.mass, state.radius);
  if (points.length > 1) {
    previewLine = view.drawCurve([points], 0xff2846, "duel");
    previewStarted = Date.now();
  }
  const end = points.at(-1);
  const edge = end && !insideDuel(end.x, end.y, state.radius - .3);
  $("#location").textContent = end ? `Stop ≈ (${end.x.toFixed(1)}, ${end.y.toFixed(1)})${edge ? " · safe rim" : ""}` : "No playable path";
  $("#error").textContent = edge ? "Path stops at the rim" : "";
}

function suggestPaths() {
  const direct = document.querySelector('[data-aim="direct"]');
  const flank = document.querySelector('[data-aim="flank"]');
  if (!direct?.dataset || !flank?.dataset) return;
  const own = state.players[state.side].position;
  const rival = state.players[1 - state.side].position;
  const slope = interceptSlope(own, rival, state.players[state.side].mass,
    state.players[1 - state.side].mass, state.side, state.radius);
  direct.disabled = flank.disabled = slope === null;
  $(".examples span").textContent = slope === null ? "Rival out of reach; choose a safe path" : "Assuming a straight rival path";
  if (direct.disabled) return;
  direct.dataset.equation = `${slope.toFixed(3)}*x`;
  flank.dataset.equation = `${(slope + (rival.y > own.y ? -.12 : .12)).toFixed(3)}*x`;
}

function updateScreen() {
  if (!state || startupFailed) return;
  const { side, phase, players, locked } = state;
  $("#side").textContent = `You are ${side === 0 ? "Blue" : "Red"}${phase === "planning" ? " · choose a path" : ""}`;
  $("#blue").textContent = `Blue · ${players[0].eliminated ? "OUT" : phase === "finished" ? "survived" : locked[0] ? "ready" : "choosing"}`;
  $("#red").textContent = `${state.bot ? "Bot" : "Red"} · ${players[1].eliminated ? "OUT" : phase === "finished" ? "survived" : locked[1] ? "ready" : state.botAt && !state.bot ? `joining in ${Math.max(0, Math.ceil((state.botAt - Date.now()) / 1000))}s` : "choosing"}`;
  $("#stage").textContent = `Round ${state.round} · ${state.round >= 3 ? "ruins + " : ""}rim shrinks after launch`;
  const canEdit = mountainReady && phase === "planning" && !locked[side];
  $("#equation").disabled = $("#lock").disabled = !canEdit;
  const mathField = document.querySelector("math-field");
  if (mathField) mathField.readOnly = !canEdit;
  $("#view").disabled = !mountainReady || players[side].eliminated;
  $("#reset").disabled = !mountainReady;
  $("#lock").textContent = locked[side] ? "Locked ✓" : "Lock in";
  $("#result-screen").hidden = phase !== "finished" || Boolean(replayFrames);
  document.querySelectorAll("[data-aim]").forEach((button) => { button.disabled = !canEdit; });
  if (phase === "planning" && locked[side]) $("#error").textContent = "Locked in. Waiting for the other player.";
  if (phase === "planning" && !locked[side]) { suggestPaths(); drawPreview(); }
  if (phase === "finished") {
    const win = state.winner === (side === 0 ? "Blue" : "Red");
    $("#result-title").textContent = state.winner === "Draw" ? "It's a draw" : win ? "You held the summit!" : "You fell from the summit";
    $("#result-detail").textContent = state.winner === "Draw" ? "Both characters went over the edge." : `${state.bot && state.winner === "Red" ? "The bot" : state.winner} stayed on top. Try a new path and predict the collision.`;
  }
}

function receiveState(message) {
  const oldPhase = state?.phase;
  state = message;
  if (!pathWasLocked && state.locked[state.side]) {
    window.posthog?.capture("bump_path_locked", { opponent_type: state.bot || solo ? "ai" : "human" });
  }
  pathWasLocked = state.locked[state.side];
  if (state.token && state.room) sessionStorage.setItem("duel:" + state.room, state.token);
  if (room.searchParams.get("quick") === "1" && state.room) {
    room.searchParams.delete("quick"); room.searchParams.set("room", state.room);
    history.replaceState(null, "", room);
  }
  view.setDuelRound?.(state.round, state.radius);
  updateLoading();
  if (oldPhase !== "finished" && state.phase === "finished") {
    const localTeam = state.side === 0 ? "Blue" : "Red";
    const properties = {
      opponent_type: state.bot || solo ? "ai" : "human",
      outcome: state.winner === "Draw" ? "draw" : state.winner === localTeam ? "win" : "loss",
    };
    window.posthog?.capture("bump_duel_completed", properties);
    window.posthog?.logger?.info("bump duel completed", { event: "bump_duel_completed", ...properties });
    summitView = true;
    view.setViewMode("summit");
    $("#view").textContent = "First person";
  }
  if (oldPhase !== "planning" && state.phase === "planning") {
    replayFrames = null;
    summitView = false;
    view.setViewMode("character");
    $("#view").textContent = "Summit view";
    lastKey = "";
    if (previewLine) { view.removeCurve(previewLine); previewLine = null; }
  }
  if (oldPhase !== "countdown" && state.phase === "countdown") {
    view.setViewMode("follow");
    summitView = false;
  }
  if (state.phase === "running" && previewLine) { view.removeCurve(previewLine); previewLine = null; }
  updateScreen();
}

function publishSolo() {
  receiveState({ type: "state", side: 0, players: duel.players, locked: duel.locked,
    phase: duel.phase, winner: duel.winner, round: duel.round, radius: duel.radius,
    startAt: soloStartAt, bot: !!duel.bot, botAt: duel.botAt });
}

async function startSolo() {
  duel = createDuel();
  const current = duel;
  duel.botAt = Date.now() + 10000;
  soloStartAt = 0;
  previous = 0;
  soloClock.accumulator = 0;
  try {
    const mask = await readSavedMask();
    if (current !== duel) return;
    if (mask && /^[01]{10240}$/.test(mask) && (mask.match(/1/g) || []).length <= 2099) {
      setDuelBody(duel, 0, mask); view.setPlayerShape(0, mask);
    }
  } catch { $("#error").textContent = "Saved drawing unavailable; using a starter character."; }
  if (current !== duel) return;
  publishSolo();
}

socket?.addEventListener("message", ({ data }) => {
  if (startupFailed || leaving) return;
  let message;
  try { message = JSON.parse(data); }
  catch (error) { showConnectionError("The duel server sent an unreadable message. Restart the server, then retry.", error); return; }
  if (!message || typeof message !== "object") { showConnectionError("The duel server sent an invalid message. Restart it, then retry."); return; }
  if (message.type === "error") { $("#error").textContent = message.error; return; }
  if (message.type === "shape") { view.setPlayerShape(message.side, message.mask); return; }
  if (message.type === "replay") { replayFrames = message.frames; replayStarted = Date.now(); return; }
  if (message.type !== "state") return;
  if (![0, 1].includes(message.side) || !Array.isArray(message.players) || message.players.length !== 2 ||
      !message.players.every((player) => player?.position && Number.isFinite(player.mass)) || !Array.isArray(message.locked)) {
    showConnectionError("The duel server sent an invalid starting state. Restart it, then retry."); return;
  }
  receiveState(message);
});
socket?.addEventListener("error", (error) => { if (!state) showConnectionError(connectionHelp, error); });
socket?.addEventListener("close", (event) => {
  if (leaving || startupFailed) return;
  if (state?.token && event.code !== 1008) {
    $("#loading").hidden = false;
    $("#loading-message").textContent = "Connection interrupted. Rejoining your duel…";
    setTimeout(() => location.reload(), 900);
  } else showConnectionError(event.reason || connectionHelp);
});
window.addEventListener("pagehide", () => { leaving = true; document.exitPointerLock?.(); socket?.close(); });
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
$("#equation").addEventListener("input", drawPreview);
document.querySelectorAll("[data-aim]").forEach((button) => button.addEventListener("click", () => {
  $("#equation").value = button.dataset.equation;
  drawPreview();
  $("#equation").focus();
}));
$("#form").addEventListener("submit", (event) => {
  event.preventDefault();
  drawPreview();
  if (startupFailed || !mountainReady || preview?.error || state?.phase !== "planning") return;
  if (solo) {
    const error = lockEquation(duel, 0, $("#equation").value);
    if (error) $("#error").textContent = error;
    else publishSolo();
  } else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "lock", expression: $("#equation").value }));
});
function restart() {
  if (solo) startSolo();
  else if (!startupFailed && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "reset" }));
}
$("#reset").addEventListener("click", restart);
$("#again").addEventListener("click", restart);
$("#invite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    window.posthog?.capture("bump_invite_copied", { opponent_type: "human" });
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
function frame() {
  if (solo && duel && mountainReady && !startupFailed) {
    const now = Date.now();
    if (!duel.bot && now >= duel.botAt) { duel.bot = true; duel.botAt = 0; }
    if (duel.bot && duel.phase === "planning" && !duel.locked[1])
      lockEquation(duel, 1, chooseBotEquation(duel));
    if (duel.phase === "planning" && duel.locked.every(Boolean)) {
      duel.phase = "countdown";
      soloStartAt = now + 3000;
    }
    if (duel.phase === "countdown" && now >= soloStartAt) launchDuel(duel);
    if (duel.phase === "running") {
      takeFixedSteps(soloClock, Math.min(.1, (now - (previous || now)) / 1000), (step) => updateDuel(duel, step));
      if (duel.phase === "finished") { replayFrames = [...duel.replay]; replayStarted = now; }
    }
    previous = now;
    publishSolo();
  }
  if (state && !startupFailed) {
    const replayIndex = replayFrames && Math.floor((Date.now() - replayStarted) / 140);
    if (replayFrames && replayIndex >= replayFrames.length) {
      replayFrames = null;
      $("#result-screen").hidden = state.phase !== "finished";
    }
    view.drawPlayers(replayFrames ? replayFrames[replayIndex] : state.players, state.side);
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
  if (previewLine?.children?.[0]?.isPoints) {
    const dots = previewLine.children[0];
    dots.geometry.setDrawRange(0, Math.min(dots.userData.total,
      Math.ceil((Date.now() - previewStarted) / 1800 * dots.userData.total)));
  }
  view.render();
  requestAnimationFrame(frame);
}
if (solo) startSolo();
requestAnimationFrame(frame);
