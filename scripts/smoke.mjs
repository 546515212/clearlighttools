#!/usr/bin/env node
// Headless smoke test: mount every tool in the registry inside a stubbed browser (jsdom) and
// fail loudly if any of them throws while building its UI.
//
//   node scripts/smoke.mjs              -> mount all 60 tools
//   node scripts/smoke.mjs --clicks     -> also click every button once (results are reported,
//                                          not asserted: a click without a real file legitimately
//                                          shows a hint or a .run-error box)
//   node scripts/smoke.mjs --locale zh  -> mount against another dictionary payload
//
// SMOKE_TEXT_DUMP=<file> additionally writes the text every panel rendered (see below); that is what
// scripts/check-residual-english.mjs reads. Normal runs are unaffected.
//
// Canvas, Web Audio, MediaRecorder and the vendor UMD libraries are stubbed, so this checks the
// wiring (imports, helper contracts, DOM building, event binding) — not pixel output. Real media
// behaviour is verified in a browser; see docs/DEPLOY.md -> local testing.
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const locale = (() => {
  const i = process.argv.indexOf('--locale');
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : 'en';
})();
const CLICKS = process.argv.includes('--clicks');

const dictFile = join(ROOT, 'dist', '_assets', `dict.${locale}.js`);
const stateFile = join(ROOT, 'dist', '_assets', 'state.js');
for (const f of [dictFile, stateFile]) {
  if (!existsSync(f)) {
    console.error(`\nMissing ${f.replace(ROOT + '/', '')} — run  node build.mjs  first.\n`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- fake browser
const noise = [];      // jsdom gaps (no navigation, no layout): expected, reported separately
const pageErrors = []; // anything the page itself threw: a real failure
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', err => {
  const m = `${err.message || err}`;
  (/(Not implemented|Could not parse CSS)/.test(m) ? noise : pageErrors).push(m + (err.stack ? '\n       ' + err.stack.split('\n')[1]?.trim() : ''));
});

const dom = new JSDOM('<!doctype html><html lang="en"><body><main id="host"></main></body></html>', {
  url: `https://toolhive.local/${locale}/`,
  pretendToBeVisual: true,
  virtualConsole
});
const { window } = dom;

// dictionaries are plain `window.__TH_X = {...}` payloads, exactly as the pages load them.
// jsdom only gives a real script context with runScripts enabled, and that would drag in a
// full CSP-less VM for no benefit — so hand the payload the window object instead.
const applyPayload = (file, name) => {
  new Function('window', readFileSync(file, 'utf8'))(window);
  if (!window[name]) throw new Error(`${file.replace(ROOT + '/', '')} did not define ${name}`);
};
applyPayload(dictFile, '__TH_DICT');
applyPayload(stateFile, '__TH_CONFIG');
// The real pages set this on <body>, and lib.js's locale() reads it, so without it every Intl call
// in a tool formats in English even when --locale is Japanese — which is exactly the string a
// translation review looks at. Set it, and the harness renders what a visitor sees.
window.document.body.dataset.locale = locale;

// --- canvas 2d: jsdom has no raster backend, so hand it the few methods the tools use
let pixelReads = 0;
const fakeCtx = () => {
  const data = new Uint8ClampedArray(4);
  data.set([18, 120, 220, 255]);
  return {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', filter: 'none', globalAlpha: 1,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high', lineWidth: 1, font: '10px sans-serif',
    drawImage() {}, fillRect() {}, clearRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, fillText() {}, save() {}, restore() {},
    translate() {}, scale() {}, rotate() {}, setTransform() {}, clip() {},
    measureText: () => ({ width: 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    getImageData(x, y, w, h) { pixelReads++; return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }; }
  };
};
window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
  if (!this.__ctx || kind === '2d') { this.__ctx = this.__ctx || fakeCtx(); this.__ctx.canvas = this; }
  return this.__ctx;
};
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
window.HTMLCanvasElement.prototype.toBlob = function toBlob(cb, type) {
  setTimeout(() => cb(new Blob([new Uint8Array(64)], { type: type || 'image/png' })), 0);
};
window.HTMLCanvasElement.prototype.captureStream = () => ({ getTracks: () => [], addEventListener() {} });

// --- web audio
const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, addEventListener() {}, gain: { value: 1 } });
class FakeAudioContext {
  constructor() { this.state = 'running'; this.sampleRate = 44100; this.currentTime = 0; this.destination = node(); this.listener = {}; }
  decodeAudioData(_buf, ok) { const d = { numberOfChannels: 2, length: 44100, sampleRate: 44100, duration: 1, getChannelData: () => new Float32Array(44100) }; if (ok) setTimeout(() => ok(d), 0); return Promise.resolve(d); }
  createGain() { return node(); } createBiquadFilter() { return node(); } createOscillator() { return node(); }
  createBufferSource() { return node(); } createMediaElementSource() { return node(); }
  createMediaStreamDestination() { return { ...node(), stream: { getTracks: () => [] } }; }
  createStereoPanner() { return node(); } createDynamicsCompressor() { return node(); }
  createAnalyser() { return { ...node(), fftSize: 2048, frequencyBinCount: 1024, getByteFrequencyData() {}, getByteTimeDomainData() {} }; }
  createBuffer(ch, len) { return { numberOfChannels: ch, length: len, sampleRate: 44100, duration: len / 44100, getChannelData: () => new Float32Array(len) }; }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
}
window.AudioContext = FakeAudioContext;
window.OfflineAudioContext = FakeAudioContext;

// --- media recorder
window.MediaRecorder = class FakeMediaRecorder {
  static isTypeSupported(t) { return /webm|ogg/.test(String(t)); }
  constructor() { this.state = 'inactive'; this.mimeType = 'video/webm'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
  addEventListener() {}
  pause() {} resume() {}
};

// --- misc surfaces the tools feature-detect
window.EyeDropper = undefined;
window.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null, addEventListener() {} };
window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
window.showOpenFilePicker = undefined;
window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
window.scrollTo = () => {};
window.print = () => {};
window.open = () => ({ document: { write() {}, close() {} }, focus() {}, close() {}, print() {} });
if (!window.crypto || !window.crypto.subtle) Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
window.URL = Object.assign(URL, {
  createObjectURL: () => 'blob:toolhive/' + Math.random().toString(36).slice(2),
  revokeObjectURL: () => {}
});
window.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fakeCtx(); } convertToBlob() { return Promise.resolve(new Blob([])); } };
window.createImageBitmap = () => Promise.reject(new Error('no bitmap backend in the smoke harness'));

// the vendor UMD globals: loadLib() returns these instead of injecting a <script>
window.PDFLib = {
  degrees: d => ({ degrees: d }),
  StandardFonts: { Helvetica: 'Helvetica' },
  PDFDocument: { create: () => fakePdf(), load: () => fakePdf() }
};
window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(fakePdfJs()) }) };
window.qrcode = () => fakeQr();
window.JSZip = class { file() {} generate() { return Promise.resolve(new Blob([])); } };
window.marked = { parse: md => `<p>${String(md).slice(0, 40)}</p>` };
// lamejs is pure JS (no DOM/canvas/worker), so load the REAL vendor encoder instead of a stub: the
// audio tools' MP3 path then runs the actual Mp3Encoder/encodeBuffer/flush the browser will run. The
// UMD declares `function lamejs(){…}lamejs();`, which only becomes a window global in a classic
// script, so assign it explicitly after evaluation (a new Function body is not global scope).
new Function('window', readFileSync(join(ROOT, 'vendor', 'lame.min.js'), 'utf8') + '\n;window.lamejs=lamejs;')(window);
if (typeof window.lamejs?.Mp3Encoder !== 'function') throw new Error('vendor/lame.min.js did not expose lamejs.Mp3Encoder');

function fakePdf() {
  const pages = { count: 0, addPage: () => ({ drawImage() {}, drawText() {} }), removePage() {} };
  return {
    getPageCount: () => 3, getPages: () => pages, addPage: pages.addPage, removePage: () => {},
    registerFont: () => ({ id: 'f' }), getFonts: () => [],
    save: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    embedPng: () => Promise.resolve({ id: 'img' }), embedJpg: () => Promise.resolve({ id: 'img' }), embedPdfPage: () => Promise.resolve({}),
    copyPages: () => Promise.resolve([]), removePageAt: () => {}
  };
}
function fakePdfJs() {
  return { numPages: 2, getPage: n => Promise.resolve({ getViewport: () => ({ width: 600, height: 800 }), render: () => ({ promise: Promise.resolve() }), getTextContent: () => Promise.resolve({ items: [{ str: 'hello' }] }) }) };
}
function fakeQr() {
  const q = {
    addData: () => {}, make: () => {}, getModuleCount: () => 21, isDark: (r, c) => (r + c) % 2 === 0,
    createSvgTag: () => '<svg></svg>', createImgTag: () => '<img>', createDataURL: () => 'data:image/gif;base64,R0lGOD'
  };
  q.CellSize = () => q; q.Margin = () => q; q.typeNumber = () => q; q.errorCorrectionLevel = () => q;
  return q;
}

// ---------------------------------------------------------------- globals for ES modules
// the tool bundles are plain browser modules: they read window/document/navigator directly,
// so expose the jsdom window as the module scope the same way a page would.
const expose = [
  'window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'HTMLInputElement',
  'HTMLCanvasElement', 'Node', 'Element', 'Image', 'Blob', 'File', 'FileReader', 'FileList', 'DataTransfer',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'DOMParser', 'XMLSerializer', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'crypto', 'URL',
  'AudioContext', 'OfflineAudioContext', 'MediaRecorder', 'OffscreenCanvas', 'speechSynthesis',
  'SpeechSynthesisUtterance', 'matchMedia', 'XMLHttpRequest', 'Worker', 'Path2D', 'ImageData', 'Option',
  'AbortController', 'structuredClone', 'CSS', 'MutationObserver'
];
for (const k of expose) {
  if (window[k] === undefined) continue;
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true });
}
globalThis.window = window;
globalThis.document = window.document;
globalThis.self = window;
globalThis.top = window;

// ---------------------------------------------------------------- run
const tools = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const host = window.document.getElementById('host');
const results = [];

// SMOKE_TEXT_DUMP=<file> records, per tool, the text a visitor actually reads, one
// locale\t<tool id>\t<string> row per rendered text node.
//
// Why the harness has to be the one to produce this: every other translation check reads a
// dictionary, and a dictionary read cannot see a string the code never asked the dictionary for.
// Twelve locales shipped "30 days 後" and "Paid in year" for a whole segment because a template
// literal or an array of table headers went straight to the DOM, bypassing L() — keys absent,
// coverage at 100 %, every gate green. Only the rendered panel knows.
// scripts/check-residual-english.mjs runs this dump for all thirteen locales and diffs each against
// English; nothing here judges the output, it just writes what it saw.
const dumpFile = process.env.SMOKE_TEXT_DUMP || null;
const PROBE_TOOL = '__residual_probe__';
const textRows = [];
const renderedText = node => {
  const out = [];
  const walk = window.document.createTreeWalker(node, window.NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const s = t.nodeValue.replace(/\s+/g, ' ').trim();
    if (s) out.push(s);
  }
  return out;
};

// the tool bundles run as Node modules, so their console.error() is Node's — run() uses it to
// log every handled failure. Capture it: those become user-facing .run-error notes, not crashes,
// and leaving them on stderr would bury a genuine failure.
const captured = [];
const realError = console.error;
console.error = (...a) => captured.push(a.map(x => (x instanceof Error
  ? `${x.message} @ ${String(x.stack).split('\n')[1]?.trim().replace('at ', '')}`
  : String(x))).join(' '));

for (const tool of tools) {
  const root = window.document.createElement('div');
  root.className = 'panel';
  host.append(root);
  const errors = [];
  const mark = pageErrors.length;
  const onerror = e => errors.push(e.message || String(e.error || e));
  window.addEventListener('error', onerror);
  try {
    const mod = await import(`../src/scripts/tools/${tool.cat}.js`);
    if (typeof mod.tools?.[tool.id] !== 'function') throw new Error(`bundle ${tool.cat}.js has no tool "${tool.id}"`);
    await mod.tools[tool.id](root);
    if (!root.childNodes.length) throw new Error('mounted an empty panel');
    if (CLICKS) {
      for (const btn of [...root.querySelectorAll('button')]) {
        try { btn.click(); } catch (err) { errors.push(`click "${btn.textContent?.trim().slice(0, 24)}": ${err.message}`); }
      }
      await new Promise(r => setTimeout(r, 60));
    }
    // async handlers report through the virtual console: blame the tool that was on screen
    for (const e of pageErrors.slice(mark)) errors.push(`uncaught: ${e.split('\n')[0]}`);
    // A sentence frame that lost an argument shows its placeholder to the visitor — "Playback
    // failed: {0}." — which every static check would call fine because the dictionary and the call
    // are both individually well-formed. Reading the mounted panel is what catches the pairing.
    const leaked = [...new Set(root.textContent.match(/\{\d+\}/g) || [])];
    if (leaked.length) errors.push(`unfilled placeholder(s) on screen: ${leaked.join(', ')} — a fmt() call and its dictionary value disagree`);
    // SMOKE_DUMP=<tool id> prints what a visitor would read, which is how the placeholder rule above
    // was checked against a panel that really renders it instead of a guessed one.
    if (process.env.SMOKE_DUMP === tool.id) console.log(`\n--- ${tool.id} renders:\n${root.textContent.replace(/\s+/g, ' ').slice(0, 600)}`);
    if (dumpFile) for (const s of renderedText(root)) textRows.push([locale, tool.id, s].join('\t'));
    results.push({ id: tool.id, ok: !errors.length, controls: root.querySelectorAll('input,select,textarea,button').length, errors });
  } catch (err) {
    for (const e of pageErrors.slice(mark)) errors.push(`uncaught: ${e.split('\n')[0]}`);
    results.push({ id: tool.id, ok: false, controls: 0, errors: [`${err.message}${err.stack ? '\n      ' + err.stack.split('\n')[1]?.trim() : ''}`, ...errors] });
  }
  window.removeEventListener('error', onerror);
  pageErrors.length = mark;
  root.remove();
}

const bad = results.filter(r => !r.ok);
if (dumpFile) {
  // SMOKE_RESIDUAL_PROBE: one more panel, deliberately untranslated. check-residual-english runs
  // this under two locales and insists the phrase it planted comes back as a finding — a residual
  // check that silently stopped comparing would otherwise report a clean site forever.
  if (process.env.SMOKE_RESIDUAL_PROBE) {
    const probe = window.document.createElement('div');
    probe.className = 'panel';
    probe.append(window.document.createTextNode(process.env.SMOKE_RESIDUAL_PROBE));
    // A second, deliberate finding on the same panel: `null` handed to a native child call, which is
    // exactly how eight real panels came to print the word null in thirteen locales. The DOM turns it
    // into a text node, so it has to come back in the dump — a checker that reads a planted string
    // with createTextNode() has not proved it can read one the browser made by accident.
    probe.append(null);
    host.append(probe);
    for (const s of renderedText(probe)) textRows.push([locale, PROBE_TOOL, s].join('\t'));
    probe.remove();
  }
  writeFileSync(dumpFile, textRows.join('\n') + '\n', 'utf8');
}
console.error = realError;
console.log(`\nsmoke (${locale}): ${results.length - bad.length}/${results.length} tools mounted` + (CLICKS ? ' with clicks' : '') + `\n      ${pixelReads} canvas pixel reads exercised\n`);
for (const r of results) {
  if (r.ok) continue;
  console.log(`  FAIL ${r.id}`);
  for (const e of r.errors) console.log(`       ${e}`);
}
if (pageErrors.length) {
  console.log(`\n  ${pageErrors.length} uncaught page error(s):`);
  for (const e of [...new Set(pageErrors)].slice(0, 12)) console.log(`   ${e}`);
}
if (CLICKS) {
  const handled = [...new Set(captured)];
  console.log(`\n  ${handled.length} message(s) shown to the user as a note instead of crashing` +
    (handled.length ? `:\n    ${handled.slice(0, 8).map(m => `"${m}"`).join('\n    ')}` : ''));
}
if (noise.length) console.log(`  jsdom gaps ignored (no navigation/layout): ${[...new Set(noise.map(n => n.split('\n')[0]))].length} kind(s)`);
if (!bad.length && !pageErrors.length && CLICKS) console.log('\n  every button fired without an uncaught exception\n');
process.exit(bad.length || pageErrors.length ? 1 : 0);
