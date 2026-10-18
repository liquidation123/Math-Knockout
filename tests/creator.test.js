import test from 'node:test';
import assert from 'node:assert/strict';
import { fillArea, formatLitres, litersUsed, secondsLeft } from '../create.js';

test('ink counts painted area, including partially transparent edges', () => {
  const pixels = new Uint8ClampedArray(100 * 4);
  pixels[3] = 255;
  pixels[7] = 128;
  assert.ok(Math.abs(litersUsed(pixels) - 1.50196) < 0.0001);
  pixels[3] = 255; // Drawing over an opaque pixel does not raise the total.
  assert.ok(Math.abs(litersUsed(pixels) - 1.50196) < 0.0001);
});

test('bucket fills only the enclosed blank area', () => {
  const pixels = new Uint8ClampedArray(5 * 5 * 4);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    if (x === 0 || x === 4 || y === 0 || y === 4) pixels[(y * 5 + x) * 4 + 3] = 255;
  }
  assert.equal(fillArea(pixels, 5, 5, 2, 2), true);
  assert.equal(litersUsed(pixels), 100);
  assert.equal(fillArea(pixels, 5, 5, 2, 2), false);
});

test('countdown rounds up and stops at zero', () => {
  assert.equal(secondsLeft(10000, 0), 10);
  assert.equal(secondsLeft(10000, 1), 10);
  assert.equal(secondsLeft(10000, 9001), 1);
  assert.equal(secondsLeft(10000, 10000), 0);
});

test('ink label rounds down to tenths and drops a trailing .0', () => {
  assert.equal(formatLitres(20), '20L');
  assert.equal(formatLitres(19.97), '19.9L');
  assert.equal(formatLitres(15), '15L');
  assert.equal(formatLitres(0.04), '0L');
});

test('canvas tools, ink cap, undo, clear, lock, and saved character', async () => {
  const width = 720, height = 440;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const element = (extra = {}) => ({
    textContent: '', style: {}, disabled: false, hidden: true, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, fn) { this[`on${name}`] = fn; },
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return name === 'aria-label' ? this.label : ''; },
    fire(name, event = {}) { this[`on${name}`]?.(event); },
    ...extra
  });
  const canvas = element({
    getContext() { return ctx; },
    getBoundingClientRect() { return { left: 0, top: 0, width, height }; },
    setPointerCapture() {},
    toDataURL() { return `data:image/png;base64,${pixels[3]}`; }
  });
  const ctx = {
    getImageData() { return { data: new Uint8ClampedArray(pixels) }; },
    putImageData(image) { pixels.set(image.data); },
    clearRect() { pixels.fill(0); },
    beginPath() { this.path = []; },
    moveTo(x, y) { this.path.push({ x, y }); },
    lineTo(x, y) { this.path.push({ x, y }); },
    arc(x, y) { this.path.push({ x, y }); },
    stroke() {
      const [a, b] = this.path;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
      for (let step = 0; step <= steps; step++) {
        const x = Math.round(a.x + (b.x - a.x) * step / Math.max(1, steps));
        const y = Math.round(a.y + (b.y - a.y) * step / Math.max(1, steps));
        for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
          if (dx * dx + dy * dy > 25 || x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
          pixels[((y + dy) * width + x + dx) * 4 + 3] = 255;
        }
      }
    },
    fill() { this.path.push(this.path[0]); this.stroke(); }
  };
  const buttons = ['pencil', 'line', 'fill'].map(name => element({ dataset: { tool: name }, label: name }));
  const nodes = {
    '#drawing': canvas, '#seconds': element(), '#liters': element(), '#ink-liquid': element(),
    '#status': element(), '#undo': element(), '#clear': element(), '#arena-link': element()
  };
  const original = { document: globalThis.document, window: globalThis.window, sessionStorage: globalThis.sessionStorage,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, now: Date.now };
  let now = 0, tick;
  const saved = {};
  try {
    globalThis.document = { querySelector: selector => nodes[selector], querySelectorAll: () => buttons,
      addEventListener(name, fn) { this[`on${name}`] = fn; } };
    globalThis.window = { location: { assign(url) { this.destination = url; } } };
    globalThis.sessionStorage = { setItem(key, value) { saved[key] = value; } };
    globalThis.setInterval = fn => { tick = fn; return 1; };
    globalThis.clearInterval = () => {};
    Date.now = () => now;
    await import(`../create.js?ui-test=${Math.random()}`);
    const pointer = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y });
    const level = () => Number.parseFloat(nodes['#ink-liquid'].style.height);
    assert.equal(nodes['#liters'].textContent, '20L');
    canvas.fire('pointerdown', pointer(40, 40));
    canvas.fire('pointermove', pointer(100, 40));
    canvas.fire('pointerup', pointer(100, 40));
    const pencilInk = level();
    assert.ok(pencilInk < 100);
    assert.equal(nodes['#seconds'].textContent, '10');
    buttons[1].fire('click');
    assert.equal(canvas.dataset.tool, 'line');
    canvas.fire('pointerdown', pointer(40, 80));
    canvas.fire('pointermove', pointer(100, 80));
    canvas.fire('pointerup', pointer(100, 80));
    assert.ok(level() < pencilInk);
    nodes['#undo'].fire('click');
    assert.equal(level(), pencilInk);
    nodes['#clear'].fire('click'); // One tap only arms Clear.
    assert.equal(level(), pencilInk);
    assert.match(nodes['#status'].textContent, /Tap clear again/);
    nodes['#clear'].fire('click');
    assert.equal(nodes['#liters'].textContent, '20L');
    nodes['#undo'].fire('click');
    assert.equal(level(), pencilInk);
    buttons[2].fire('click');
    assert.equal(canvas.dataset.tool, 'fill');
    const beforeFill = new Uint8ClampedArray(pixels);
    canvas.fire('pointerdown', pointer(500, 300)); // Whole board exceeds 20L.
    assert.deepEqual(pixels, beforeFill);
    assert.match(nodes['#status'].textContent, /Not enough ink/);
    now = 10001;
    tick();
    assert.equal(nodes['#seconds'].textContent, '0');
    assert.equal(canvas.classList.add !== undefined, true);
    assert.ok(buttons.every(button => button.disabled));
    assert.equal(nodes['#arena-link'].hidden, false);
    const character = JSON.parse(saved.outMathedCharacter);
    assert.equal(saved[`outMathedCharacter:${character.id}`], saved.outMathedCharacter);
    assert.ok(character.inkUsed > 0);
    assert.equal(character.physics.massKg, character.inkUsed);
    assert.equal(character.mask.runs.reduce((sum, run) => sum + run, 0), width * height);
    canvas.fire('pointerdown', pointer(150, 150));
    assert.deepEqual(pixels, beforeFill);
    document.onkeydown({ key: 'Enter', repeat: false, target: canvas, preventDefault() {} });
    assert.equal(window.location.destination, nodes['#arena-link'].href);
  } finally {
    globalThis.document = original.document;
    globalThis.window = original.window;
    globalThis.sessionStorage = original.sessionStorage;
    globalThis.setInterval = original.setInterval;
    globalThis.clearInterval = original.clearInterval;
    Date.now = original.now;
  }
});
