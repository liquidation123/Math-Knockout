import { createCurveModel, previewCurveModel } from "./curves.js";
import { projectilePlan } from "./attack-paths.js";

export function createEquationInput(onChange) {
  const field = (id) => document.getElementById(id);
  const type = field("equation-type");
  const branch = field("curve-branch");
  const start = field("launch-point");
  const cardinal = field("launch-cardinal");
  const direction = field("curve-direction");
  let activeField = field("expression");
  let modelKey = "";
  let model;
  let modelError = "";

  function request() {
    if (type.value === "dots") return { type: "dots", expression: field("dots-expression").value, extra: field("dots-extra-x").value };
    if (type.value === "explicit") return { type: type.value, expression: field("expression").value };
    if (type.value === "implicit") return { type: type.value, expression: field("implicit-expression").value };
    const prefix = type.value === "polar" ? "polar" : "parameter";
    return { type: type.value, x: field("parameter-x").value, y: field("parameter-y").value,
      radius: field("polar-radius").value, start: field(prefix + "-start").value, end: field(prefix + "-end").value };
  }
  function selection() {
    return { branch: Number(branch.value), start: Number(start.value), cardinal: cardinal.value, direction: direction.value };
  }
  function syncBranch() {
    const chosen = model?.branches?.[Number(branch.value) || 0];
    if (!chosen || type.value !== "implicit") return;
    start.max = chosen.points.length - (chosen.closed ? 2 : 1);
    field("cardinal-label").hidden = !chosen.closed;
    if (!chosen.closed) cardinal.value = "custom";
    direction.options[0].textContent = chosen.closed ? "↺ Counterclockwise" : "Toward branch end";
    direction.options[1].textContent = chosen.closed ? "↻ Clockwise" : "Toward branch start";
  }
  function resetBranch() {
    cardinal.value = "right";
    syncBranch();
    // An open branch starts in its middle, so either direction has room to travel.
    start.value = model.branches[Number(branch.value) || 0].closed ? 0 : Math.floor(Number(start.max) / 2);
  }
  function preview(origin, teamDirection) {
    const input = request();
    if (input.type === "dots") input.direction = teamDirection;
    const key = JSON.stringify(input);
    if (key !== modelKey) {
      modelKey = key;
      modelError = "";
      model = null;
      try {
        model = createCurveModel(input);
        if (type.value === "implicit") {
          branch.replaceChildren(...model.branches.map((entry, index) => {
            const option = document.createElement("option");
            option.value = index;
            option.textContent = (index + 1) + (entry.closed ? " · closed" : " · open");
            return option;
          }));
          resetBranch();
        }
      } catch (error) { modelError = error.message; }
    }
    if (modelError) {
      field("curve-note").textContent = "";
      return { error: modelError };
    }
    const result = previewCurveModel(model, origin, teamDirection, selection());
    if (result.selection) start.value = result.selection.start;
    const plan = !result.error && projectilePlan(result);
    field("curve-note").textContent = (result.warning ? result.warning + " " : "") + (result.dots ? "Purple dots are isolated teleport destinations."
      : plan.paths?.length > 1
      ? (plan.mode === "parallel" ? "Cyan rings: simultaneous branch bullets. One recoil; one hit per enemy." :
        "Purple rings: teleport arrivals. Gaps do no damage; walls stop the entire bullet.")
      : (type.value === "explicit" ? "" : "Traverse start → end; closed curves stop after one loop."));
    return result;
  }
  type.addEventListener("change", () => {
    document.querySelectorAll("[data-equation-type]").forEach((group) => {
      group.hidden = group.dataset.equationType !== type.value;
      if (!group.hidden) activeField = group.querySelector(".math-input");
    });
    field("circle-options").hidden = !["parametric", "polar"].includes(type.value);
    onChange();
  });
  document.querySelectorAll(".math-input").forEach((input) => {
    input.addEventListener("focus", () => { activeField = input; });
    input.addEventListener("input", onChange);
    input.addEventListener("change", () => { if (modelError) console.warn("Equation rejected:", modelError); });
  });
  document.querySelectorAll("[data-symbol]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      if (activeField.insertSymbol) return activeField.insertSymbol(button.dataset.symbol);
      activeField.setRangeText(button.dataset.symbol, activeField.selectionStart, activeField.selectionEnd, "end");
      activeField.focus();
      activeField.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  document.querySelectorAll("[data-circle-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      const prefix = type.value === "polar" ? "polar" : "parameter";
      const end = field(prefix + "-end");
      end.value = "(" + field(prefix + "-start").value + ")" +
        (button.dataset.circleDirection === "1" ? "+" : "-") + "2π";
      // The input event refreshes the preview and the math box showing this field.
      end.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  start.addEventListener("input", () => { cardinal.value = "custom"; onChange(); });
  branch.addEventListener("change", () => { resetBranch(); onChange(); });
  cardinal.addEventListener("change", onChange);
  direction.addEventListener("change", onChange);

  function selectPoint(point, currentPreview) {
    if (type.value !== "implicit" || currentPreview?.error || !currentPreview?.sections) return;
    let nearest = null;
    currentPreview.sections.forEach((section, branchIndex) => section.forEach((sample, index) => {
      const distance = Math.hypot(sample.x - point.x, sample.y - point.y);
      if (distance < 0.6 && (!nearest || distance < nearest.distance)) nearest = { distance, branchIndex, index };
    }));
    if (!nearest) return;
    branch.value = nearest.branchIndex;
    cardinal.value = "custom";
    syncBranch();
    start.value = Math.min(Number(start.max), nearest.index);
    onChange();
  }
  return { preview, selectPoint, key: () => JSON.stringify([request(), selection()]) };
}
