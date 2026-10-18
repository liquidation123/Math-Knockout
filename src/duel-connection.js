// The static build fills this public URL from BUMP_SERVER_URL. Local play needs no setting.
export const BUMP_SERVER_URL = "";

export function duelSocketUrl(pageUrl, serverUrl = BUMP_SERVER_URL) {
  const page = new URL(pageUrl);
  const server = new URL(serverUrl || page.origin);
  if (!["http:", "https:", "ws:", "wss:"].includes(server.protocol)) {
    throw new Error("BUMP_SERVER_URL must be an HTTP or WebSocket URL.");
  }
  server.protocol = ["https:", "wss:"].includes(server.protocol) ? "wss:" : "ws:";
  if (page.protocol === "https:" && server.protocol !== "wss:") {
    throw new Error("An HTTPS website needs a secure wss:// Bump Duel server.");
  }
  server.hash = "";
  if (page.searchParams.get("quick") === "1") {
    server.searchParams.delete("room");
    server.searchParams.set("quick", "1");
  }
  else {
    server.searchParams.delete("quick");
    server.searchParams.set("room", page.searchParams.get("room") || "");
  }
  if (page.searchParams.get("players") === "4" && page.searchParams.get("quick") !== "1") server.searchParams.set("players", "4");
  else server.searchParams.delete("players");
  return server.href;
}
