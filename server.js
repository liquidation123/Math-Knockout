import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createDuel, launchDuel, lockEquation, updateDuel, inkFromMask, setShapePhysics } from "./src/duel.js";
import { takeFixedSteps } from "./src/physics.js";
import { posthogServerLogger } from "./src/posthog-server-logs.js";

const root = fileURLToPath(new URL(".", import.meta.url));
let port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (pathname === "/posthog-config.json") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({
      projectToken: process.env.POSTHOG_PROJECT_TOKEN,
      host: process.env.POSTHOG_HOST,
    }));
    return;
  }
  const filename = resolve(root, "." + decodeURIComponent(pathname));

  if (!filename.startsWith(root) || filename.includes(sep + ".git" + sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const asset = /\.(glb|jpg|png|js|css|svg)$/.test(filename);
    const info = asset && await stat(filename);
    const etag = asset && `"${info.size}-${info.mtimeMs}"`;
    if (etag && request.headers["if-none-match"] === etag) {
      response.writeHead(304, { ETag: etag }).end();
      return;
    }
    const content = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": types[extname(filename)] || "application/octet-stream",
      "Cache-Control": asset ? "public, max-age=0, must-revalidate" : "no-store",
      ...(etag && { ETag: etag }),
    });
    response.end(content);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

const sockets = new WebSocketServer({ server, maxPayload: 16000 });
const rooms = new Map();
const send = (socket, message) => socket?.readyState === 1 && socket.send(JSON.stringify(message));

function publish(room) {
  room.clients.forEach((socket, side) => send(socket, {
    type: "state", side, players: room.duel.players, phase: room.duel.phase,
    locked: room.duel.locked, winner: room.duel.winner, startAt: room.startAt,
  }));
}

function resetRoom(room) {
  clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  room.duel = createDuel();
  room.startAt = 0;
  room.masks.forEach((mask, side) => {
    if (mask) setShapePhysics(room.duel.players[side], mask);
  });
}

sockets.on("connection", (socket, request) => {
  const id = new URL(request.url, "http://localhost").searchParams.get("room");
  if (!/^[a-zA-Z0-9-]{4,32}$/.test(id || "")) return socket.close(1008, "Invalid room link. Return to Change mode and start a new Bump Duel.");
  const room = rooms.get(id) || { clients: [null, null], masks: [null, null], duel: createDuel(), startAt: 0 };
  const side = room.clients.findIndex((client) => !client);
  if (side < 0) return socket.close(1008, "This room already has two players. Close an extra tab, then retry.");
  rooms.set(id, room);
  room.clients[side] = socket;
  room.masks.forEach((mask, index) => { if (mask) send(socket, { type: "shape", side: index, mask }); });
  publish(room);

  socket.on("message", (bytes) => {
    let message;
    try { message = JSON.parse(bytes); } catch { return; }
    if (!message || typeof message !== "object") return;
    if (message.type === "lock") {
      const error = lockEquation(room.duel, side, String(message.expression || ""));
      if (error) return send(socket, { type: "error", error });
      if (room.duel.locked.every(Boolean)) {
        room.duel.phase = "countdown";
        room.startAt = Date.now() + 3000;
        posthogServerLogger.emit({
          severityText: "INFO",
          body: "bump duel countdown started",
          attributes: { event: "bump_duel_countdown_started", player_count: 2 },
        });
        room.countdownTimer = setTimeout(() => {
          if (room.duel.phase === "countdown") { launchDuel(room.duel); publish(room); }
        }, 3000);
      }
      publish(room);
    } else if (message.type === "shape" && room.duel.phase === "planning" && !room.duel.locked[side]) {
      const mask = message.mask;
      if (typeof mask !== "string" || !/^[01]{10240}$/.test(mask)) return;
      const ink = inkFromMask(mask);
      if (ink > 20.5) return send(socket, { type: "error", error: "This drawing exceeds 20L." });
      if (!ink) return;
      room.masks[side] = mask;
      setShapePhysics(room.duel.players[side], mask);
      room.clients.forEach((client) => send(client, { type: "shape", side, mask }));
      publish(room);
    } else if (message.type === "reset") {
      resetRoom(room);
      publish(room);
    }
  });
  socket.on("close", () => {
    room.clients[side] = null;
    if (room.clients.every((client) => !client)) {
      clearTimeout(room.countdownTimer);
      rooms.delete(id);
      posthogServerLogger.emit({
        severityText: "INFO",
        body: "bump duel room released",
        attributes: { event: "bump_duel_room_released" },
      });
    }
    else {
      room.masks[side] = null;
      room.clients.forEach((client) => send(client, { type: "shape", side, mask: null }));
      resetRoom(room); publish(room);
    }
  });
});

let previous = Date.now();
const clock = { accumulator: 0 };
setInterval(() => {
  const now = Date.now();
  const dt = (now - previous) / 1000;
  previous = now;
  takeFixedSteps(clock, dt, (step) => {
    rooms.forEach((room) => updateDuel(room.duel, step));
  });
  rooms.forEach(publish);
}, 50);

// ws forwards HTTP server errors here, including an occupied listening port.
sockets.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !process.env.PORT && port < 5182) {
    console.warn("Port " + port + " is busy; trying " + (port + 1) + ".");
    port += 1;
    server.listen(port, host);
    return;
  }
  console.error("Could not start Out-Mathed: " + error.message);
  if (error.code === "EADDRINUSE") {
    console.error("Stop the other server, or choose a free port: PORT=5183 npm start");
  }
  process.exit(1);
});
server.on("listening", () => {
  console.log("Out-Mathed: http://" + host + ":" + server.address().port);
  posthogServerLogger.emit({
    severityText: "INFO",
    body: "websocket server listening",
    attributes: { event: "websocket_server_listening" },
  });
});
server.listen(port, host);
