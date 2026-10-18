import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { AI_LEVELS } from "../src/ai.js";
import { AI_TYPES, TYPE_HELP } from "../src/ai-types.js";

const source = (await readFile(new URL("../src/opponent-ui.js", import.meta.url), "utf8"))
  .replace(/^import .+;\n/gm, "").replace("export function", "function");
function setup(pageUrl = "https://game.example/play.html?opponent=hard&room=old-room") {
  const nodes = new Map(), timers = new Map();
  let id = 0, destination;
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: true, textContent: "", value: "", href: "https://game.example/create.html",
      addEventListener(name, fn) { this[name] = fn; } });
    return nodes.get(selector);
  };
  const ui = runInNewContext(source + "\ncreateOpponentUI();", {
    URL, AI_LEVELS, AI_TYPES, TYPE_HELP, location: { href: pageUrl, assign(url) { destination = url; } },
    document: { querySelector: node }, window: { addEventListener() {} },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); },
  });
  async function tick() {
    const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn());
    await Promise.resolve(); await Promise.resolve();
  }
  return { ui, node, timers, tick, destination: () => destination };
}

test("character dialogue types letters quickly and cancellation removes all pending timers", async () => {
  const { ui, node, timers, tick } = setup();
  const pending = ui.speak("Red 2", "y = x", ui.token());
  assert.equal(node("#ai-speaker").textContent, "Red 2 says");
  assert.equal(node("#ai-speech").textContent, "y");
  await tick();
  assert.equal(node("#ai-speech").textContent, "y ");
  ui.cancel();
  assert.equal(await pending, false);
  assert.equal(timers.size, 0);
  assert.equal(node("#ai-dialogue").hidden, true);
  await tick();
  assert.equal(node("#ai-speech").textContent, "");
});

test("Bump links requesting Dot fall back to Normal, while Projectile keeps Dot", () => {
  assert.equal(setup("https://game.example/bump.html?opponent=easy&aiType=dot").ui.type, "normal");
  assert.equal(setup("https://game.example/play.html?opponent=easy&aiType=dot").ui.type, "dot");
});

test("changing opponents invalidates work and navigates to a fresh match, not the old room", async () => {
  const { ui, node, destination, timers } = setup();
  const oldToken = ui.token();
  const pending = ui.wait(100, oldToken);
  node("#opponent").value = "medium";
  node("#opponent").change();
  assert.equal(await pending, false);
  assert.equal(ui.current(oldToken), false);
  assert.equal(timers.size, 0);
  assert.equal(destination(), "https://game.example/play.html?opponent=medium");
});

test("AI type and difficulty are independent and either change cancels pending actions", async () => {
  for (const setting of ["#ai-type", "#difficulty"]) {
    const { ui, node, destination, timers } = setup();
    assert.equal(ui.type, "normal");
    assert.equal(ui.difficulty, "hard");
    node("#ai-type").value = "dot";
    node("#difficulty").value = "easy";
    const pending = ui.wait(100, ui.token());
    node(setting).change();
    assert.equal(await pending, false);
    assert.equal(timers.size, 0);
    assert.equal(destination(), "https://game.example/play.html?opponent=easy&aiType=dot");
  }
});
