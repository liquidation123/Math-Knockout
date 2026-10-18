import { AI_LEVELS } from "./ai.js";
import { AI_TYPES, TYPE_HELP } from "./ai-types.js";

export function createOpponentUI() {
  const page = new URL(location.href);
  const selector = document.querySelector("#opponent");
  const typeSelector = document.querySelector("#ai-type");
  const levelSelector = document.querySelector("#difficulty");
  const difficulty = AI_LEVELS[page.searchParams.get("opponent")] ? page.searchParams.get("opponent") : "human";
  const requestedType = page.searchParams.get("aiType");
  const type = AI_TYPES[requestedType] && !(page.pathname === "/bump.html" && requestedType === "dot") ? requestedType : "normal";
  if (typeSelector) { typeSelector.value = type; typeSelector.disabled = difficulty === "human"; }
  if (levelSelector) { levelSelector.value = difficulty === "human" ? "medium" : difficulty; levelSelector.disabled = difficulty === "human"; }
  if (document.querySelector("#ai-type-help")) document.querySelector("#ai-type-help").textContent = TYPE_HELP[type];
  selector.value = difficulty === "human" ? "human" : "ai";
  const drawingLink = document.querySelector("#character-note a");
  if (drawingLink) {
    const drawingPage = new URL(drawingLink.href, page);
    drawingPage.searchParams.set("opponent", difficulty);
    drawingPage.searchParams.set("aiType", type);
    drawingLink.href = drawingPage.href;
  }
  document.querySelector("#opponent-help").textContent = AI_LEVELS[difficulty]?.description || "Play against another person using the existing controls.";
  const dialogue = document.querySelector("#ai-dialogue");
  const speech = document.querySelector("#ai-speech");
  const thinking = document.querySelector("#ai-thinking");
  let generation = 0;
  const timers = new Set();
  function cancel() {
    generation += 1;
    timers.forEach((timer) => { clearTimeout(timer.id); timer.resolve(false); });
    timers.clear();
    dialogue.hidden = thinking.hidden = true;
    speech.textContent = "";
  }
  function wait(milliseconds, token) {
    if (token !== generation) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = { resolve, id: setTimeout(() => {
        timers.delete(timer);
        resolve(token === generation);
      }, milliseconds) };
      timers.add(timer);
    });
  }
  async function speak(name, text, token) {
    document.querySelector("#ai-speaker").textContent = name + " says";
    dialogue.hidden = false;
    speech.textContent = "";
    for (let end = 1; end <= text.length; end += 1) {
      if (token !== generation) return false;
      speech.textContent = text.slice(0, end);
      if (!await wait(12, token)) return false;
    }
    return true;
  }
  selector.addEventListener("change", () => {
    cancel();
    page.searchParams.set("opponent", selector.value === "ai" ? levelSelector.value : selector.value);
    page.searchParams.delete("room"); // A different opponent always gets a fresh match.
    location.assign(page.href);
  });
  for (const setting of [typeSelector, levelSelector].filter(Boolean)) setting.addEventListener("change", () => {
    cancel();
    page.searchParams.set("opponent", levelSelector.value);
    page.searchParams.set("aiType", typeSelector.value);
    page.searchParams.delete("room");
    location.assign(page.href);
  });
  window.addEventListener("pagehide", cancel);
  return { difficulty, type, isAI: difficulty !== "human", cancel, wait, speak,
    token: () => generation, current: (token) => token === generation,
    choosing: (active) => { thinking.hidden = !active; },
  };
}
