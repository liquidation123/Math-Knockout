// Read the fighter saved by the character creator (see src/character-geometry.js).
// With no id this returns the latest drawing; with an id it returns that exact one.
export function loadSavedCharacter(id) {
  const text = sessionStorage.getItem(id ? `outMathedCharacter:${id}` : "outMathedCharacter");
  return text ? JSON.parse(text) : null;
}

export async function readSavedMask() {
  const saved = loadSavedCharacter();
  if (!saved?.image) return null;
  const image = new Image();
  image.src = saved.image;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 80;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, 128, 80);
  const pixels = context.getImageData(0, 0, 128, 80).data;
  return Array.from({ length: 10240 }, (_, index) => pixels[index * 4 + 3] > 127 ? "1" : "0").join("");
}
