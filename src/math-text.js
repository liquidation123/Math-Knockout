// The equation boxes show pretty math (LaTeX, like Desmos), but our parser reads
// plain text such as "x^2" or "(1)/(x)". MathLive converts LaTeX to ASCII math;
// this file fixes the few spots where that text differs from what the parser accepts.

export function tidyAsciiMath(text) {
  const compact = text.replace(/\s+/g, "").replace(/arc(sin|cos|tan)/g, "a$1");
  return nthRootsToPowers(absoluteBarsToAbs(compact));
}

// |x| → abs(x). A bar opens when nothing is open yet or it follows an operator
// or "(", e.g. 2|x-1|+|y| → 2abs(x-1)+abs(y); otherwise it closes the last one.
function absoluteBarsToAbs(text) {
  let result = "";
  let open = 0;
  for (const char of text) {
    if (char !== "|") result += char;
    else if (open === 0 || "(+-*/^=,".includes(result.at(-1) ?? "(")) {
      result += "abs(";
      open += 1;
    } else {
      result += ")";
      open -= 1;
    }
  }
  return result;
}

// root(n)(x) → (x)^(1/(n)), because the nth root of x equals x to the power 1/n.
function nthRootsToPowers(text) {
  let start = text.indexOf("root(");
  while (start !== -1) {
    const indexEnd = matchingParen(text, start + 4);
    const radicandEnd = text[indexEnd + 1] === "(" ? matchingParen(text, indexEnd + 1) : -1;
    if (indexEnd === -1 || radicandEnd === -1) break;
    const index = text.slice(start + 5, indexEnd);
    const radicand = text.slice(indexEnd + 2, radicandEnd);
    text = text.slice(0, start) + "(" + radicand + ")^(1/(" + index + "))" + text.slice(radicandEnd + 1);
    start = text.indexOf("root(", start + 1);
  }
  return text;
}

// Position of the ")" that closes the "(" at openIndex, or -1 if it is missing.
function matchingParen(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")" && --depth === 0) return index;
  }
  return -1;
}
