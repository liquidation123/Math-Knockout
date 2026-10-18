import test from "node:test";
import assert from "node:assert/strict";
import { createRound, firePreview, selectCharacter } from "../src/combat.js";
import { buildPreview } from "../src/equations.js";
import { chooseProjectileAction, projectileCandidates, scoreProjectileAction } from "../src/ai.js";
import { createAimGeometry } from "../src/scene.js";

const options = { pause: async () => {} };
function arena() {
  const round = createRound(false, () => .5);
  round.currentTeam = 1;
  round.players.forEach((player, index) => {
    player.position = { x: index < 3 ? -9 : 9, y: (index % 3 - 1) * 2, z: .5 };
  });
  return round;
}

test("the single AI chooses a legal Red shot without changing the live round", async () => {
  const round = arena(), before = structuredClone(round);
  let yields = 0;
  const action = await chooseProjectileAction(round, "ai", { pause: async () => { yields++; } });
  assert.ok(action);
  assert.equal(yields, projectileCandidates(round).length);
  assert.deepEqual(round, before);
  assert.equal(round.players[action.playerIndex].team, 1);
  assert.ok(action.force >= .5 && action.force <= 3);
  const preview = buildPreview(action.expression, round.players[action.playerIndex].position, -1);
  assert.equal(preview.error, "");
  assert.equal(selectCharacter(round, action.playerIndex), true);
  assert.equal(firePreview(round, action.playerIndex, preview, action.force), true);
  assert.deepEqual(round.attack.path, preview.path);
  assert.equal(firePreview(round, action.playerIndex, preview, action.force), false);
});

test("the AI skips eliminated or airborne characters and cancels cleanly", async () => {
  const round = arena();
  round.players.forEach((player, index) => { if (player.team === 1) player.eliminated = index !== 4; });
  assert.equal((await chooseProjectileAction(round, "ai", options)).playerIndex, 4);
  round.players[4].position.z = -3;
  assert.equal(await chooseProjectileAction(round, "ai", options), null);
  let cancelled = false;
  assert.equal(await chooseProjectileAction(arena(), "ai", {
    cancelled: () => cancelled, pause: async () => { cancelled = true; },
  }), null);
});

test("the AI uses the same recoil physics when evaluating edge shots", () => {
  const round = arena();
  round.players.forEach((player, index) => {
    player.eliminated = ![0, 3].includes(index);
    player.position = { x: index === 0 ? -10 : 13.75, y: 0, z: .5 };
  });
  const actions = projectileCandidates(round);
  const safer = actions.find((action) => action.force === .5);
  const stronger = actions.find((action) => action.force === 3);
  assert.ok(scoreProjectileAction(round, safer) > scoreProjectileAction(round, stronger));
});

test("preview ribbons stay centered on their sampled segment", () => {
  const geometry = createAimGeometry([{ x: 0, y: 0, z: .5 }, { x: 3, y: 4, z: .5 }], .18);
  const vertices = geometry.getAttribute("position");
  assert.equal(vertices.count, 6);
  assert.ok(Math.abs((vertices.getX(0) + vertices.getX(1)) / 2) < 1e-7);
  assert.ok(Math.abs(Math.hypot(vertices.getX(0) - vertices.getX(1), vertices.getY(0) - vertices.getY(1)) - .18) < 1e-7);
  geometry.dispose();
});
