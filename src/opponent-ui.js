import { AI_LEVELS } from "./ai.js";

export function createOpponentUI() {
  const page = new URL(location.href);
  const selector = document.querySelector("#opponent");
  const difficulty = AI_LEVELS[page.searchParams.get("opponent")] ? page.searchParams.get("opponent") : "human";
  selector.value = difficulty;
  const drawingLink = document.querySelector("#character-note a");
  if (drawingLink) {
    const drawingPage = new URL(drawingLink.href, page);
    drawingPage.searchParams.set("opponent", difficulty);
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
    page.searchParams.set("opponent", selector.value);
    page.searchParams.delete("room"); // A different opponent always gets a fresh match.
    location.assign(page.href);
  });
  window.addEventListener("pagehide", cancel);
  return { difficulty, isAI: difficulty !== "human", cancel, wait, speak,
    token: () => generation, current: (token) => token === generation,
    choosing: (active) => { thinking.hidden = !active; },
  };
}
