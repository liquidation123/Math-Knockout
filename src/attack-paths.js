import { insideArena } from "./terrain.js";

// Keep the original translation. A later branch starts at its first playable
// sample, not at the shooter. Leaving the arena still stops that bullet.
function playableStart(points) {
  const start = points.findIndex((point) => insideArena(point.x, point.y, 0.12));
  return start < 0 ? [] : points.slice(start);
}

export function projectilePlan(preview) {
  const rational = preview.equation?.rational && !preview.teleport && !preview.dots;
  const sections = (rational ? preview.rationalSections : preview.travelSections) || [preview.path];
  const paths = [preview.path, ...sections.slice(1).map(playableStart).filter((path) => path.length > 1 || (preview.dots && path.length === 1))];
  const mode = paths.length < 2 ? "single" : rational ? "parallel" : "teleport";
  return { mode, paths };
}
