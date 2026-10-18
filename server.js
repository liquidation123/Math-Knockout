import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { chooseBotEquation, createDuel, duelReady, launchDuel, lockEquation, resignDuel, setDuelBody, updateDuel } from "./src/duel.js";
import { takeFixedSteps } from "./src/physics.js";
import { posthogServerLogger } from "./src/posthog-server-logs.js";

const root = fileURLToPath(new URL(".", import.meta.url));
let port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
let devVersion = process.env.OUT_MATHED_DEV_VERSION;
if (devVersion) process.on("message", (message) => {
  if (message.type === "dev-reload") devVersion = message.version;
});
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".woff2": "font/woff2",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (devVersion && pathname === "/__dev/version") {
    response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    response.end(devVersion);
    return;
  }
  if (pathname === "/posthog-config.json") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({
      projectToken: process.env.POSTHOG_PROJECT_TOKEN,
      host: process.env.POSTHOG_HOST,
    }));
    return;
  }
  const filename = resolve(root, "." + decodeURIComponent(pathname));

  if (!filename.startsWith(root) || filename.slice(root.length).split(sep).some((part) => part.startsWith("."))) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const asset = /\.(glb|jpg|png|js|mjs|woff2|webp|css|svg)$/.test(filename);
    const info = asset && await stat(filename);
    const etag = asset && `"${info.size}-${info.mtimeMs}"`;
    if (etag && request.headers["if-none-match"] === etag) {
      response.writeHead(304, { ETag: etag }).end();
      return;
    }
    let content = await readFile(filename);
    if (devVersion && extname(filename) === ".html") {
      content = content.toString().replace("</body>", '<script type="module" src="/dev/client.js?version=' + devVersion + '"></script></body>');
    }
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
const inkFromMask = (mask) => (mask.match(/1/g) || []).length * 100 / 10240;
function publish(room) {
  room.clients.forEach((socket, side) => send(socket, {
    type: "state", side, players: room.duel.players, phase: room.duel.phase,
    locked: room.duel.locked, winner: room.duel.winner, resignedBy: room.duel.resignedBy, startAt: room.startAt,
    room: room.id, bot: room.bot, botAt: room.botAt, round: room.duel.round, radius: room.duel.radius,
    token: room.tokens[side],
    capacity: room.capacity, connected: room.clients.map((client) => !!client), host: room.clients.findIndex((client) => !!client),
  }));
}

function countdown(room) {
  if (room.duel.phase !== "planning" || !duelReady(room.duel)) return;
  room.duel.phase = "countdown";
  room.startAt = Date.now() + 3000;
  posthogServerLogger.emit({
    severityText: "INFO",
    body: "bump duel countdown started",
    attributes: { event: "bump_duel_countdown_started", player_count: room.duel.players.filter((p) => !p.eliminated).length },
  });
  room.countdownTimer = setTimeout(() => {
    if (room.duel.phase === "countdown") { launchDuel(room.duel); publish(room); }
  }, 3000);
}

function resetRoom(room) {
  clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  room.duel = createDuel(room.capacity);
  if (room.capacity > 2) {
    room.duel.phase = "lobby";
    room.duel.players.forEach((player, side) => { player.eliminated = !room.clients[side]; });
  }
  room.startAt = 0;
  room.masks.forEach((mask, side) => {
    if (mask) setDuelBody(room.duel, side, mask);
  });
}

sockets.on("connection", (socket, request) => {
  const params = new URL(request.url, "http://localhost").searchParams;
  const quick = params.get("quick") === "1";
  const resume = params.get("resume");
  const waiting = quick && [...rooms.values()].find((room) => room.quick && !room.bot && room.clients[0] && !room.clients[1]);
  const id = quick ? waiting?.id || randomUUID().slice(0, 8) : params.get("room");
  if (!/^[a-zA-Z0-9-]{4,32}$/.test(id || "")) return socket.close(1008, "Invalid room link. Return to Change mode and start a new Bump Duel.");
  const capacity = !quick && params.get("players") === "4" ? 4 : 2;
  const room = rooms.get(id) || { id, quick, capacity, bot: false, clients: Array(capacity).fill(null), tokens: Array(capacity).fill(null),
    graceTimers: Array(capacity).fill(null), masks: Array(capacity).fill(null), duel: createDuel(capacity), startAt: 0 };
  if (!rooms.has(id) && capacity > 2) {
    room.duel.phase = "lobby";
    room.duel.players.forEach((player) => { player.eliminated = true; });
  }
  const side = resume ? room.tokens.indexOf(resume)
    : room.clients.findIndex((client, index) => !client && !room.tokens[index] && !(room.bot && index === 1));
  if (side < 0) return socket.close(1008, resume ? "Reconnect expired. Start a new duel." : "This room is full. Start a new duel.");
  if (!resume && room.capacity > 2 && room.duel.phase !== "lobby")
    return socket.close(1008, "This match has started. Ask the host to restart before joining.");
  if (room.clients[side]) room.clients[side].close();
  clearTimeout(room.graceTimers[side]);
  room.tokens[side] ||= randomUUID();
  rooms.set(id, room);
  room.clients[side] = socket;
  if (room.duel.phase === "lobby") room.duel.players[side].eliminated = false;
  if (side === 0 && quick && !room.bot && !room.botTimer) {
    room.botAt = Date.now() + 10000;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (room.clients[0] && !room.clients[1]) {
        room.bot = true;
        if (room.duel.locked[0]) { lockEquation(room.duel, 1, chooseBotEquation(room.duel)); countdown(room); }
        publish(room);
      }
    }, 10000);
  }
  if (side === 1) { clearTimeout(room.botTimer); room.botTimer = null; room.botAt = 0; }
  room.masks.forEach((mask, index) => { if (mask) send(socket, { type: "shape", side: index, mask }); });
  publish(room);

  socket.on("message", (bytes) => {
    let message;
    try { message = JSON.parse(bytes); } catch { return; }
    if (!message || typeof message !== "object") return;
    if (message.type === "start" && room.capacity > 2) {
      if (side !== room.clients.findIndex((client) => !!client) || room.duel.phase !== "lobby") return;
      if (room.clients.filter(Boolean).length < 2) return send(socket, { type: "error", error: "Invite at least one other player before starting." });
      room.duel.players.forEach((player, index) => { player.eliminated = !room.clients[index]; });
      room.duel.locked = room.duel.players.map((player) => player.eliminated);
      room.duel.phase = "planning";
      publish(room);
    } else if (message.type === "lock") {
      const error = lockEquation(room.duel, side, String(message.expression || ""), message.force ?? 1);
      if (error) return send(socket, { type: "error", error });
      // The bot picks from public positions, never the hidden human equation.
      if (room.bot) lockEquation(room.duel, 1, chooseBotEquation(room.duel));
      countdown(room);
      publish(room);
    } else if (message.type === "shape" && ["lobby", "planning"].includes(room.duel.phase) && !room.duel.locked[side]) {
      const mask = message.mask;
      if (typeof mask !== "string" || !/^[01]{10240}$/.test(mask)) return;
      const ink = inkFromMask(mask);
      if (ink > 20.5) return send(socket, { type: "error", error: "This drawing exceeds 20L." });
      if (!ink) return;
      room.masks[side] = mask;
      setDuelBody(room.duel, side, mask);
      room.clients.forEach((client) => send(client, { type: "shape", side, mask }));
      publish(room);
    } else if (message.type === "resign") {
      if (resignDuel(room.duel, side)) {
        if (room.duel.phase === "finished") {
          clearTimeout(room.countdownTimer);
          clearTimeout(room.botTimer);
          room.botTimer = null;
          room.startAt = 0;
        } else countdown(room);
        publish(room);
      }
    } else if (message.type === "reset") {
      if (room.capacity > 2 && side !== room.clients.findIndex((client) => !!client)) return;
      resetRoom(room);
      publish(room);
    }
  });
  socket.on("close", () => {
    if (room.clients[side] !== socket) return;
    room.clients[side] = null;
    // Keep a disconnected player's shape and turn for 15 seconds so a reload can resume.
    room.graceTimers[side] = setTimeout(() => {
      room.tokens[side] = null;
      room.masks[side] = null;
      if (room.clients.every((client) => !client)) {
        clearTimeout(room.countdownTimer); clearTimeout(room.botTimer); rooms.delete(id);
        posthogServerLogger.emit({
          severityText: "INFO",
          body: "bump duel room released",
          attributes: { event: "bump_duel_room_released" },
        });
      } else {
        room.clients.forEach((client) => send(client, { type: "shape", side, mask: null }));
        if (room.capacity > 2) {
          if (room.duel.phase === "lobby") room.duel.players[side].eliminated = true;
          else resignDuel(room.duel, side);
          countdown(room);
        } else resetRoom(room);
        publish(room);
      }
    }, 15000);
  });
});

let previous = Date.now();
const clock = { accumulator: 0 };
setInterval(() => {
  const now = Date.now();
  const dt = (now - previous) / 1000;
  previous = now;
  takeFixedSteps(clock, dt, (step) => {
    rooms.forEach((room) => {
      const before = room.duel.phase;
      updateDuel(room.duel, step);
      if (before === "running" && room.duel.phase === "finished") {
        room.duel.replay.push(room.duel.players.map((p) => ({ position: { ...p.position }, velocity: { ...p.velocity }, angle: p.angle,
          eliminated: p.eliminated, team: p.team })));
        room.clients.forEach((client) => send(client, { type: "replay", frames: room.duel.replay }));
      }
    });
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
