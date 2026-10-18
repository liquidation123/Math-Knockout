// Desmos-style equation boxes. Typing ^ makes a real superscript, / makes a
// fraction, and "sqrt", "pi" or "theta" turn into √, π and θ.
//
// Each plain <input class="math-input"> stays in the page (hidden) and keeps the
// plain-text equation, so the rest of the game reads input.value exactly as before.
import { MathfieldElement, convertAsciiMathToLatex, convertLatexToAsciiMath } from "mathlive";
import { tidyAsciiMath } from "./math-text.js";

const SYMBOL_LATEX = { "θ": "\\theta", "π": "\\pi", "*": "\\cdot", "/": "\\frac{#@}{#?}" };
MathfieldElement.soundsDirectory = null;

export function upgradeMathInputs() {
  for (const input of document.querySelectorAll(".math-input")) {
    const field = new MathfieldElement();
    field.className = "math-field";
    field.smartFence = true;
    field.value = convertAsciiMathToLatex(input.value);
    field.setAttribute("aria-label", input.labels?.[0]?.textContent.trim() || input.id);
    input.hidden = true;
    input.after(field);

    // Math box → plain text: x^{2} becomes x^2, \frac{1}{x} becomes (1)/(x).
    let typing = false;
    function copyToInput() {
      typing = true;
      input.value = tidyAsciiMath(convertLatexToAsciiMath(field.value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      typing = false;
    }
    field.addEventListener("input", copyToInput);
    field.addEventListener("change", () => input.dispatchEvent(new Event("change")));
    field.addEventListener("focus", () => input.dispatchEvent(new Event("focus")));
    // Plain text → math box, for buttons that set input.value (e.g. "↺ CCW").
    input.addEventListener("input", () => { if (!typing) field.value = convertAsciiMathToLatex(input.value); });

    // Used by the θ π ^ × ÷ buttons and by code that focuses the equation.
    input.insertSymbol = (symbol) => {
      if (symbol === "^") field.executeCommand("moveToSuperscript");
      else field.insert(SYMBOL_LATEX[symbol] ?? symbol);
      field.focus();
      copyToInput();
    };
    input.focus = () => field.focus();
  }
}
