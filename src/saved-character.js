export async function readSavedMask() {
  const saved = JSON.parse(sessionStorage.getItem("outMathedCharacter"));
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
