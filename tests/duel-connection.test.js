import test from "node:test";
import assert from "node:assert/strict";
import { duelSocketUrl } from "../src/duel-connection.js";

test("local play keeps the current host and port with the same room", () => {
  assert.equal(duelSocketUrl("http://127.0.0.1:5173/bump.html?room=77164621"),
    "ws://127.0.0.1:5173/?room=77164621");
});

test("secure backends preserve their endpoint path and replace the room per invite", () => {
  for (const protocol of ["https:", "wss:"]) {
    assert.equal(duelSocketUrl("https://game.example.com/bump.html?room=new-room", protocol + "//duel.example.com/api/ws?room=old-room#fragment"),
      "wss://duel.example.com/api/ws?room=new-room");
  }
});

test("invalid protocols and insecure sockets on HTTPS pages are rejected", () => {
  for (const endpoint of ["file:///tmp/server", "ftp://example.com", "ws://example.com", "http://example.com"]) {
    assert.throws(() => duelSocketUrl("https://game.example.com/bump.html?room=test-room", endpoint));
  }
});
