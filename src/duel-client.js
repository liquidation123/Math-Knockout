import { buildPreview } from "./equations.js";
import { insideDuel, travelDistance, travelPath } from "./duel.js";
import { createView } from "./scene.js";
import { readSavedMask } from "./saved-character.js";
import { duelSocketUrl } from "./duel-connection.js";

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
const localPage = ["localhost", "127.0.0.1", "[::1]"].includes(room.hostname);
const connectionHelp = localPage
  ? "Cannot reach the Bump Duel server. Stop the old server and run npm start again; open the address it prints, then retry."
  : "Online Bump Duel is unavailable. Please retry later or use Change mode to play Projectile Duel.";
try {
  socket = new WebSocket(duelSocketUrl(room.href));
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
  const points = [];
  for (const point of travelPath(preview.path, travelDistance(player.mass))) {
    if (!insideDuel(point.x, point.y, state.radius)) break;
    points.push(point);
  }
  if (points.length > 1) {
    previewLine = view.drawCurve([points], 0xff2846, "duel");
    previewStarted = Date.now();
  }
  const end = points.at(-1);
  const edge = end && !insideDuel(end.x, end.y, state.radius - .8);
  $("#location").textContent = end ? `Landing ≈ (${end.x.toFixed(1)}, ${end.y.toFixed(1)})${edge ? " · near the edge!" : ""}` : "No playable path";
  $("#error").textContent = edge ? "Near the edge" : "";
}

function suggestPaths() {
  const direct = document.querySelector('[data-aim="direct"]');
  const flank = document.querySelector('[data-aim="flank"]');
  if (!direct?.dataset || !flank?.dataset) return;
  const own = state.players[state.side].position;
  const rival = state.players[1 - state.side].position;
  const dx = rival.x - own.x;
  if (Math.abs(dx) < 0.1) return;
  // The equation is relative to the player's position, so slope = rise / run.
  const slope = (rival.y - own.y) / dx;
  const insideLane = Math.max(-6, Math.min(6, rival.y + (rival.y < 0 ? 2 : -2)));
  direct.dataset.equation = `${slope.toFixed(3)}*x`;
  flank.dataset.equation = `${((insideLane - own.y) / dx).toFixed(3)}*x`;
}

function updateScreen() {
  if (!state || startupFailed) return;
  const { side, phase, players, locked } = state;
  $("#side").textContent = `You are ${side === 0 ? "Blue" : "Red"}${phase === "planning" ? " · choose a path" : ""}`;
  $("#blue").textContent = `Blue · ${players[0].eliminated ? "OUT" : phase === "finished" ? "survived" : locked[0] ? "ready" : "choosing"}`;
  $("#red").textContent = `${state.bot ? "Bot" : "Red"} · ${players[1].eliminated ? "OUT" : phase === "finished" ? "survived" : locked[1] ? "ready" : state.botAt && !state.bot ? `joining in ${Math.max(0, Math.ceil((state.botAt - Date.now()) / 1000))}s` : "choosing"}`;
  $("#stage").textContent = `Round ${state.round} · ${state.round >= 3 ? "ruins appear" : "clear field"}`;
  const canEdit = mountainReady && phase === "planning" && !locked[side];
  $("#equation").disabled = $("#lock").disabled = !canEdit;
  $("#view").disabled = !mountainReady || players[side].eliminated;
  $("#reset").disabled = !mountainReady;
  $("#lock").textContent = locked[side] ? "Locked ✓" : "Lock in";
  $("#result-screen").hidden = phase !== "finished";
  document.querySelectorAll("[data-aim]").forEach((button) => { button.disabled = !canEdit; });
  if (phase === "planning" && locked[side]) $("#error").textContent = "Locked in. Waiting for the other player.";
  if (phase === "planning" && !locked[side]) { suggestPaths(); drawPreview(); }
  if (phase === "finished") {
    const win = state.winner === (side === 0 ? "Blue" : "Red");
    $("#result-title").textContent = state.winner === "Draw" ? "It's a draw" : win ? "You held the summit!" : "You fell from the summit";
    $("#result-detail").textContent = state.winner === "Draw" ? "Both characters went over the edge." : `${state.bot && state.winner === "Red" ? "The bot" : state.winner} stayed on top. Try a new path and predict the collision.`;
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
  const oldPhase = state?.phase;
  state = message;
  if (room.searchParams.get("quick") === "1" && state.room) {
    room.searchParams.delete("quick"); room.searchParams.set("room", state.room);
    history.replaceState(null, "", room);
  }
  view.setDuelRound?.(state.round, state.radius);
  updateLoading();
  if (oldPhase !== "finished" && state.phase === "finished") {
    summitView = true;
    view.setViewMode("summit");
    $("#view").textContent = "First person";
  }
  if (oldPhase !== "planning" && state.phase === "planning") {
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
});
socket?.addEventListener("error", (error) => showConnectionError(connectionHelp, error));
socket?.addEventListener("close", (event) => showConnectionError(event.reason || connectionHelp));
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
  if (!startupFailed && mountainReady && !preview?.error && state?.phase === "planning" && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "lock", expression: $("#equation").value }));
});
function restart() {
  if (!startupFailed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "reset" }));
}
$("#reset").addEventListener("click", restart);
$("#again").addEventListener("click", restart);
$("#invite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
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
  if (previewLine?.children?.[0]?.isPoints) {
    const dots = previewLine.children[0];
    dots.geometry.setDrawRange(0, Math.min(dots.userData.total,
      Math.ceil((Date.now() - previewStarted) / 1800 * dots.userData.total)));
  }
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
