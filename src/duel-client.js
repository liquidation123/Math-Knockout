import { buildPreview } from "./equations.js";
import { travelPath } from "./duel.js";
import { insideArena } from "./physics.js";
import { createView } from "./scene.js";
import { readSavedMask } from "./saved-character.js";

const $ = (selector) => document.querySelector(selector);
const room = new URL(location.href);
if (!room.searchParams.has("room")) {
  room.searchParams.set("room", crypto.randomUUID().slice(0, 8));
  history.replaceState(null, "", room);
}
const view = createView($("#arena"), $("#hud"), $("#controls"), "bump");
let mountainReady = false;
view.ready.then(() => {
  mountainReady = true;
  $("#loading").hidden = true;
  updateScreen();
}).catch((error) => {
  $("#loading").textContent = "Mountain failed to load. Reload to retry.";
  console.error("Mountain load failed:", error);
});
view.setViewMode("character");
const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/?room=${room.searchParams.get("room")}`);
let state, previewLine, preview, lastKey = "", summitView = false;

socket.addEventListener("open", async () => {
  try {
    const mask = await readSavedMask();
    if (mask && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "shape", mask }));
      $("#character-note").firstChild.textContent = "Your drawing is in the duel · ";
    }
  } catch { $("#error").textContent = "Saved drawing could not load; using a cube."; }
});

function drawPreview() {
  if (!state || state.side == null || state.phase !== "planning" || state.locked[state.side]) return;
  const player = state.players[state.side];
  const key = $("#equation").value + player.position.x + "," + player.position.y;
  if (key === lastKey) return;
  lastKey = key;
  preview = buildPreview($("#equation").value, player.position, state.side === 0 ? 1 : -1);
  if (previewLine) view.removeCurve(previewLine);
  previewLine = null;
  if (preview.error) { $("#error").textContent = preview.error; return; }
  const points = [];
  for (const point of travelPath(preview.path)) {
    if (!insideArena(point.x, point.y)) break;
    points.push(point);
  }
  if (points.length > 1) previewLine = view.drawCurve([points], 0xffffff, true);
  const end = points.at(-1);
  $("#location").textContent = end ? `Projected stop: (${end.x.toFixed(1)}, ${end.y.toFixed(1)})` : "No playable path";
  $("#error").textContent = "Your opponent's hidden path may change the collision.";
}

function updateScreen() {
  if (!state) return;
  const { side, phase, players, locked } = state;
  $("#side").textContent = `You are ${side === 0 ? "Blue" : "Red"} · mass ${players[side].mass.toFixed(2)}×`;
  $("#blue").textContent = `Blue · ${players[0].eliminated ? "OUT" : phase === "finished" ? "survived" : locked[0] ? "ready" : "choosing"}`;
  $("#red").textContent = `Red · ${players[1].eliminated ? "OUT" : phase === "finished" ? "survived" : locked[1] ? "ready" : "choosing"}`;
  $("#phase").textContent = phase === "planning" ? "Choose a path" : phase === "countdown" ? "Launching together" : phase === "finished" ? state.winner === "Draw" ? "Draw" : `${state.winner} wins` : "Duel in motion";
  const canEdit = mountainReady && phase === "planning" && !locked[side];
  $("#equation").disabled = $("#lock").disabled = !canEdit;
  $("#view").disabled = players[side].eliminated;
  $("#lock").textContent = locked[side] ? "Locked ✓" : "Lock in";
  if (phase === "planning" && locked[side]) $("#error").textContent = "Locked in. Waiting for the other player.";
  if (phase === "planning" && !locked[side]) drawPreview();
  if (phase === "finished") $("#error").textContent = state.winner === "Draw" ? "Both players fell." : `${state.winner} stayed on the summit.`;
}

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === "error") { $("#error").textContent = message.error; return; }
  if (message.type === "shape") { view.setPlayerShape(message.side, message.mask); return; }
  const oldPhase = state?.phase;
  state = message;
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
  if (state.phase === "running" && previewLine) { view.removeCurve(previewLine); previewLine = null; }
  updateScreen();
});
socket.addEventListener("close", () => { $("#phase").textContent = "Disconnected"; });
window.addEventListener("pagehide", () => { document.exitPointerLock?.(); socket.close(); });
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
$("#equation").addEventListener("input", drawPreview);
$("#form").addEventListener("submit", (event) => {
  event.preventDefault();
  drawPreview();
  if (!preview?.error && state?.phase === "planning") socket.send(JSON.stringify({ type: "lock", expression: $("#equation").value }));
});
$("#reset").addEventListener("click", () => socket.send(JSON.stringify({ type: "reset" })));
$("#invite").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  $("#invite").textContent = "Copied!";
  setTimeout(() => $("#invite").textContent = "Copy invite link", 1600);
});
$("#view").addEventListener("click", () => {
  if (state?.players[state.side].eliminated) return;
  summitView = !summitView;
  view.setViewMode(summitView ? "summit" : "character");
  $("#view").textContent = summitView ? "First person" : "Summit view";
});
function frame() {
  if (state) {
    view.drawPlayers(state.players, state.side);
    view.updateCharacterCamera(state.players, state.side);
    const left = Math.ceil((state.startAt - Date.now()) / 1000);
    $("#countdown").hidden = state.phase !== "countdown";
    $("#countdown").textContent = Math.max(1, left);
  }
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
