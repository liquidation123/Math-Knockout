import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createDuel, launchDuel, lockEquation, setDuelBody, updateDuel } from "./src/duel.js";
import { takeFixedSteps } from "./src/physics.js";

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
const inkFromMask = (mask) => (mask.match(/1/g) || []).length * 100 / 10240;
function publish(room) {
  room.clients.forEach((socket, side) => send(socket, {
    type: "state", side, players: room.duel.players, phase: room.duel.phase,
    locked: room.duel.locked, winner: room.duel.winner, startAt: room.startAt,
    room: room.id, bot: room.bot, botAt: room.botAt, round: room.duel.round, radius: room.duel.radius,
    token: room.tokens[side],
  }));
}

function countdown(room) {
  if (!room.duel.locked.every(Boolean)) return;
  room.duel.phase = "countdown";
  room.startAt = Date.now() + 3000;
  room.countdownTimer = setTimeout(() => {
    if (room.duel.phase === "countdown") { launchDuel(room.duel); publish(room); }
  }, 3000);
}

function resetRoom(room) {
  clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  room.duel = createDuel();
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
  const room = rooms.get(id) || { id, quick, bot: false, clients: [null, null], tokens: [null, null],
    graceTimers: [null, null], masks: [null, null], duel: createDuel(), startAt: 0 };
  const side = resume ? room.tokens.indexOf(resume)
    : room.clients.findIndex((client, index) => !client && !room.tokens[index] && !(room.bot && index === 1));
  if (side < 0) return socket.close(1008, resume ? "Reconnect expired. Start a new duel." : "This room is full. Start a new duel.");
  if (room.clients[side]) room.clients[side].close();
  clearTimeout(room.graceTimers[side]);
  room.tokens[side] ||= randomUUID();
  rooms.set(id, room);
  room.clients[side] = socket;
  if (side === 0 && quick && !room.bot && !room.botTimer) {
    room.botAt = Date.now() + 10000;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (room.clients[0] && !room.clients[1]) {
        room.bot = true;
        if (room.duel.locked[0]) { lockEquation(room.duel, 1, "0"); countdown(room); }
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
    if (message.type === "lock") {
      const error = lockEquation(room.duel, side, String(message.expression || ""));
      if (error) return send(socket, { type: "error", error });
      // A weak server bot chooses the straight route; no client can fake its turn.
      if (room.bot) lockEquation(room.duel, 1, "0");
      countdown(room);
      publish(room);
    } else if (message.type === "shape" && room.duel.phase === "planning" && !room.duel.locked[side]) {
      const mask = message.mask;
      if (typeof mask !== "string" || !/^[01]{10240}$/.test(mask)) return;
      const ink = inkFromMask(mask);
      if (ink > 20.5) return send(socket, { type: "error", error: "This drawing exceeds 20L." });
      if (!ink) return;
      room.masks[side] = mask;
      setDuelBody(room.duel, side, mask);
      room.clients.forEach((client) => send(client, { type: "shape", side, mask }));
      publish(room);
    } else if (message.type === "reset") {
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
      } else {
        room.clients.forEach((client) => send(client, { type: "shape", side, mask: null }));
        resetRoom(room); publish(room);
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
});
server.listen(port, host);
