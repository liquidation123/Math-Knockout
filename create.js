const MAX_INK = 20;
const WIDTH = 720;
const HEIGHT = 440;
const COLOR = '#073b96';

// One liter paints 1% of the board. Transparent pixels cost nothing;
// painting over existing pixels only costs the newly covered fraction.
export function litersUsed(pixels) {
  let coverage = 0;
  for (let i = 3; i < pixels.length; i += 4) coverage += pixels[i] / 255;
  return 100 * coverage / (pixels.length / 4);
}

export function secondsLeft(deadline, now) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

// Four-way flood fill: the drawn pixels form the walls of the bucket.
export function fillArea(pixels, width, height, x, y) {
  const start = y * width + x;
  if (pixels[start * 4 + 3] !== 0) return false;
  const queue = [start];
  pixels[start * 4] = 7; pixels[start * 4 + 1] = 59;
  pixels[start * 4 + 2] = 150; pixels[start * 4 + 3] = 255;
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head];
    const neighbors = [n - 1, n + 1, n - width, n + width];
    for (const next of neighbors) {
      if (next < 0 || next >= width * height) continue;
      if ((next === n - 1 && n % width === 0) || (next === n + 1 && n % width === width - 1)) continue;
      const i = next * 4;
      if (pixels[i + 3] !== 0) continue;
      pixels[i] = 7; pixels[i + 1] = 59; pixels[i + 2] = 150; pixels[i + 3] = 255;
      queue.push(next);
    }
  }
  return true;
}

if (typeof document !== 'undefined') {
  const canvas = document.querySelector('#drawing');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const seconds = document.querySelector('#seconds');
  const liters = document.querySelector('#liters');
  const liquid = document.querySelector('#ink-liquid');
  const status = document.querySelector('#status');
  const buttons = [...document.querySelectorAll('[data-tool]')];
  const undo = document.querySelector('#undo');
  const clear = document.querySelector('#clear');
  const arena = document.querySelector('#arena-link');
  const history = [];
  let tool = 'pencil';
  let active = null;
  let deadline = 0;
  let timer = 0;
  let locked = false;

  const snapshot = () => ctx.getImageData(0, 0, WIDTH, HEIGHT);
  const used = () => litersUsed(snapshot().data);
  const say = message => { status.textContent = message; };

  function updateInk() {
    const remaining = Math.max(0, MAX_INK - used());
    liters.textContent = `${remaining.toFixed(2)}L`;
    liquid.style.height = `${remaining / MAX_INK * 100}%`;
  }

  function lock() {
    if (locked) return;
    locked = true;
    clearInterval(timer);
    seconds.textContent = '0';
    if (active?.changed) history.push(active.before);
    active = null;
    canvas.classList.add('locked');
    [...buttons, undo, clear].forEach(button => { button.disabled = true; });
    const character = { image: canvas.toDataURL('image/png'), inkUsed: used(), width: WIDTH, height: HEIGHT };
    window.outMathedCharacter = character;
    try {
      sessionStorage.setItem('outMathedCharacter', JSON.stringify(character));
      say('Time! Your character is locked and saved for the future battle system.');
    } catch {
      say('Time! Your character is locked. Browser storage is unavailable.');
    }
    arena.hidden = false;
  }

  function startClock() {
    if (deadline) return;
    deadline = Date.now() + 10000;
    seconds.textContent = '10';
    say('Draw quickly — the clock is running!');
    timer = setInterval(() => {
      seconds.textContent = secondsLeft(deadline, Date.now());
      if (Date.now() >= deadline) lock();
    }, 100);
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(WIDTH - 1, Math.floor((event.clientX - rect.left) * WIDTH / rect.width))),
      y: Math.max(0, Math.min(HEIGHT - 1, Math.floor((event.clientY - rect.top) * HEIGHT / rect.height)))
    };
  }

  function stroke(from, to) {
    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    if (from.x === to.x && from.y === to.y) {
      ctx.beginPath(); ctx.arc(from.x, from.y, 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function keepIfAffordable(before) {
    if (used() <= MAX_INK + 0.000001) { updateInk(); return true; }
    ctx.putImageData(before, 0, 0);
    updateInk();
    say('Not enough ink for that mark. Try a smaller shape or undo.');
    return false;
  }

  canvas.addEventListener('pointerdown', event => {
    if (deadline && Date.now() >= deadline) lock();
    if (locked || event.button !== 0) return;
    startClock();
    const at = point(event);
    const before = snapshot();
    if (tool === 'fill') {
      const filled = snapshot();
      if (!fillArea(filled.data, WIDTH, HEIGHT, at.x, at.y)) return;
      ctx.putImageData(filled, 0, 0);
      if (keepIfAffordable(before)) history.push(before);
      return;
    }
    active = { before, start: at, last: at, tool, changed: false, pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
    if (tool === 'pencil') {
      stroke(at, at);
      active.changed = keepIfAffordable(before);
    }
  });

  canvas.addEventListener('pointermove', event => {
    if (deadline && Date.now() >= deadline) lock();
    if (!active || active.pointerId !== event.pointerId || locked) return;
    const at = point(event);
    const before = active.tool === 'line' ? active.before : snapshot();
    if (active.tool === 'line') ctx.putImageData(before, 0, 0);
    stroke(active.tool === 'line' ? active.start : active.last, at);
    if (keepIfAffordable(before)) {
      active.changed = true;
      active.last = at;
    }
  });

  function endStroke(event) {
    if (deadline && Date.now() >= deadline) lock();
    if (!active || active.pointerId !== event.pointerId) return;
    if (!locked && active.tool === 'line') {
      ctx.putImageData(active.before, 0, 0);
      stroke(active.start, point(event));
      active.changed = keepIfAffordable(active.before);
    }
    if (active.changed) history.push(active.before);
    active = null;
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', event => {
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.tool === 'line') ctx.putImageData(active.before, 0, 0);
    else if (active.changed) history.push(active.before);
    active = null;
    updateInk();
  });

  buttons.forEach(button => button.addEventListener('click', () => {
    if (locked) return;
    tool = button.dataset.tool;
    canvas.dataset.tool = tool;
    buttons.forEach(item => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', selected);
    });
    say(`${button.getAttribute('aria-label')} selected. ${deadline ? 'Keep drawing!' : 'Draw to start the timer.'}`);
  }));
  undo.addEventListener('click', () => {
    if (locked || !history.length) return;
    ctx.putImageData(history.pop(), 0, 0);
    updateInk();
    say('Last action undone.');
  });
  clear.addEventListener('click', () => {
    if (locked || used() === 0) return;
    history.push(snapshot());
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    updateInk();
    say('Canvas cleared. Your ink is back.');
  });
  updateInk();
}
