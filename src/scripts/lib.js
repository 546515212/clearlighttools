// Shared helpers for every tool. No build step, no framework: ES modules only.
export const D = window.__TH_DICT || { w: {}, common: {}, tool: {} };

// ---------------------------------------------------------------- i18n for widgets
export function t(key, fallback) {
  const v = D.w?.[key] ?? D.common?.[key] ?? D.tool?.[key] ?? D.cat?.[key];
  return v || fallback || key;
}
export const locale = () => document.body.dataset.locale || 'en';
// A missing argument is left as {0} rather than quietly becoming the word "undefined": the tool then
// shows its own placeholder, which scripts/smoke.mjs reads off the mounted panel and reports.
export const fmt = (s, ...args) => s.replace(/\{(\d+)\}/g, (_, i) => (args[i] === undefined ? `{${i}}` : args[i]));

// ---------------------------------------------------------------- dom
export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  const set = (k, v) => {
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  };
  // `value` and `checked` are sanitized against type/min/max/step the instant they are set, so they
  // must come last. A range input given value=150 while max is still the browser default 100 clamps
  // its live value to 100 even though the attribute reads 150 — the thumb, the label and the applied
  // gain then disagree. Setting them after the constraints keeps all three in sync.
  for (const [k, v] of Object.entries(attrs)) if (k !== 'value' && k !== 'checked') set(k, v);
  for (const k of ['value', 'checked']) if (k in attrs) set(k, attrs[k]);
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------- add / fill
// el() ignores a null child. The DOM's own append() and replaceChildren() do not: their argument is
// "Node or DOMString", and null becomes the DOMString "null" — a text node reading `null`, in every
// language, because it never passes through the dictionary. That is how eight panels ended with a
// stray "null" under the result: `box.replaceChildren(a, ok ? note(…) : null)`.
// add() and fill() are those two calls with el()'s rule put back.
const real = kids => kids.flat().filter(k => k !== null && k !== undefined && k !== false);
export function add(node, ...kids) { node.append(...real(kids)); return node; }
export function fill(node, ...kids) { node.replaceChildren(...real(kids)); return node; }

export function field(label, input, note) {
  return el('label', { class: 'field' }, el('span', { text: label }), input, note ? el('span', { class: 'note', text: note }) : null);
}
export function select(options, value, onChange) {
  // A bare string means "the value is the label". Without this, Object.keys(PRESETS) reached the
  // mapping below as strings and o[0]/o[1] indexed the *characters* of the name: every option was
  // labelled with its second letter ("m" for Email) and carried the first as its value, so choosing
  // a preset could never be looked up again. The Examples dropdown was silently dead in every locale,
  // and no dictionary check could see it because the page never rendered an English word.
  const pairs = options.map(o => (typeof o === 'string' ? [o, o] : o));
  const s = el('select', {}, ...pairs.map(o => el('option', { value: o[0], selected: o[0] === value }, o[1])));
  s.addEventListener('change', () => onChange?.(s.value, s));
  return s;
}
export function numberInput(value, onChange, { min, max, step } = {}) {
  const i = el('input', { type: 'number', value, min, max, step });
  i.addEventListener('input', () => onChange?.(i.value === '' ? '' : Number(i.value), i));
  return i;
}
export function textInput(value, onChange, type = 'text') {
  const i = el('input', { type, value });
  i.addEventListener('input', () => onChange?.(i.value, i));
  return i;
}
export function rangeInput(value, min, max, step, onChange, unit = '') {
  const out = el('span', { text: `${value}${unit}` });
  const i = el('input', { type: 'range', value, min, max, step, oninput: () => { out.textContent = `${i.value}${unit}`; onChange?.(Number(i.value)); } });
  return el('span', { class: 'check' }, i, out);
}
export function checkInput(label, value, onChange) {
  const c = el('input', { type: 'checkbox', checked: value });
  c.addEventListener('change', () => onChange?.(c.checked));
  return el('label', { class: 'check' }, c, label);
}
export function button(label, onClick, { kind = 'primary', disabled = false, type = 'button' } = {}) {
  return el('button', { class: `btn ${kind === 'ghost' ? 'ghost' : ''}`, onClick, disabled, type }, label);
}
export function note(text, kind = '') { return el('div', { class: `note ${kind}`, text }); }
export function stat(label, value, extra) {
  return el('div', { class: 'stat' }, el('span', { class: 'lbl', text: label }), el('b', { text: value }), extra ? el('span', { class: 'delta', text: extra }) : null);
}
export function card(...kids) { return el('div', { class: 'result-card' }, ...kids); }

let toastTimer;
export function toast(msg) {
  const box = el('div', { class: 'toast', text: msg });
  document.body.append(box);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.remove(), 2200);
}

// navigator.clipboard only exists in a secure context, so plain http (a LAN test, an old
// corporate proxy) leaves it undefined. Fall back to a hidden textarea + execCommand, which
// still needs a real user gesture but works everywhere that has one.
export async function copyText(value) {
  const s = String(value ?? '');
  if (!s) { toast(D.common.errorGeneric || 'Nothing to copy'); return false; }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      toast(D.common.copied || 'Copied');
      return true;
    }
  } catch { /* permission denied or the page lost focus: use the fallback */ }
  try {
    const ta = el('textarea', { 'aria-hidden': 'true', readonly: true });
    ta.value = s;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, s.length);
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? (D.common.copied || 'Copied') : (D.common.notSupported || 'This browser blocks copying'));
    return ok;
  } catch {
    toast(D.common.notSupported || 'This browser blocks copying');
    return false;
  }
}

// ---------------------------------------------------------------- format
export function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  // locale(): "1,5 MB" on the German and Spanish pages, "1.5 MB" on the English one — the same
  // reason the dates go through locale(); on a Chinese Windows the /de/ page printed 1.5
  const v = n < 10 && i ? Number(n.toFixed(1)) : Math.round(n);
  return `${v.toLocaleString(locale(), { maximumFractionDigits: 1 })} ${u[i]}`;
}
export function pct(a, b) { return b ? Math.max(0, Math.round((1 - a / b) * 100)) : 0; }
export function num(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return Number(n.toFixed(digits)).toLocaleString(locale(), { maximumFractionDigits: digits });
}
export const pad2 = n => String(n).padStart(2, '0');
export function mmss(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${pad2(m)}:${s.toFixed(2).padStart(5, '0')}`;
}

// ---------------------------------------------------------------- files
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name || 'download' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function downloadZip(files, name = 'archive.zip') {
  // loadLib resolves the vendor global, and for JSZip that global *is* the constructor:
  // window.JSZip, not window.JSZip.JSZip.
  const JSZip = await loadLib('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  // JSZip 3 replaced the callback-style generate() with generateAsync(); the old name still
  // throws "This method has been removed in JSZip 3.0" at runtime.
  download(await zip.generateAsync({ type: 'blob' }), name);
}
export const extOf = (name, next) => name.replace(/\.[^.]+$/, '') + '.' + next;
export const stem = name => name.replace(/\.[^.]+$/, '');
export const readAs = (file, how = 'ArrayBuffer') => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error || new Error('read failed'));
  r[how === 'dataURL' ? 'readAsDataURL' : how === 'text' ? 'readAsText' : 'readAsArrayBuffer'](file);
});
export async function loadCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = url; });
    const c = el('canvas', { width: img.naturalWidth, height: img.naturalHeight });
    c.getContext('2d').drawImage(img, 0, 0);
    return { canvas: c, img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
export function canvasFrom(img, w, h) {
  const c = el('canvas', { width: w, height: h });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}
export function toBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('encode failed')), type, quality));
}
export function outputFor(type) { return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[type] || type; }

// ---------------------------------------------------------------- dropzone + file list
export function fileZone(root, { accept = '', multiple = true, onFiles, hint }) {
  const input = el('input', { type: 'file', accept, multiple, hidden: true });
  const zone = el('div', { class: 'drop', tabindex: 0, role: 'button' },
    el('span', { class: 'big', 'aria-hidden': 'true', text: '📂' }),
    el('span', { text: hint || (multiple ? D.common.uploadFiles || 'Choose files' : D.common.uploadOne || 'Choose a file') }),
    el('span', { class: 'hint', text: accept ? accept.split(',').join(' · ') : '' }),
    input);
  const open = () => input.click();
  zone.addEventListener('click', open);
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  input.addEventListener('change', () => onFiles([...input.files]));
  for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('over'); });
  zone.addEventListener('drop', e => onFiles([...e.dataTransfer.files]));
  root.append(zone);
  // paste support: an image copied to the clipboard lands straight in the tool
  window.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length && root.isConnected) onFiles(files);
  });
  return { zone, input };
}

export function fileList(root, files, { onRemove } = {}) {
  const list = el('div', { class: 'file-list' });
  const render = () => {
    list.replaceChildren(...files.map((f, i) => el('div', { class: 'file-row' },
      f.type?.startsWith('image/') ? el('img', { class: 'thumb', src: URL.createObjectURL(f) }) : null,
      el('span', { class: 'nm', text: f.name }),
      el('span', { class: 'sz', text: bytes(f.size) }),
      onRemove ? el('button', { title: D.common.removeFile || 'Remove', onClick: () => { files.splice(i, 1); render(); onRemove(files); } }, '✕') : null)));
  };
  render();
  root.append(list);
  return { list, render, files };
}

// Order changes use explicit arrows: HTML5 drag-and-drop on a blob list is easy to get
// subtly wrong, and arrows behave the same on touch devices.
export function orderableList(root, files, { onChange, label }) {
  const box = el('div', { class: 'file-list' });
  const draw = () => {
    box.replaceChildren(...files.map((f, i) => el('div', { class: 'file-row' },
      f.type?.startsWith('image/') ? el('img', { class: 'thumb', src: URL.createObjectURL(f) }) : null,
      el('span', { class: 'sz', text: String(i + 1) }),
      el('span', { class: 'nm', text: f.name }),
      el('span', { class: 'sz', text: bytes(f.size) }),
      el('button', { title: '↑', disabled: i === 0, onClick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); onChange(files); } }, '↑'),
      el('button', { title: '↓', disabled: i === files.length - 1, onClick: () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; draw(); onChange(files); } }, '↓'),
      el('button', { title: D.common.removeFile || 'Remove', onClick: () => { files.splice(i, 1); draw(); onChange(files); } }, '✕'))));
  };
  if (label) box.prepend(el('div', { class: 'note', text: label }));
  draw();
  root.append(box);
  return { box, draw };
}

// ---------------------------------------------------------------- progress runner
export async function run(button, fn) {
  const label = button.textContent;
  // run() appends the message to the nearest .panel, falling back to body. Clearing it here, at
  // the start of every attempt rather than only before writing a new one, is what keeps a red
  // error from a failed run sitting on the page next to the successful result that replaced it.
  const box = button.closest('.panel') || document.body;
  box.querySelectorAll('.run-error').forEach(n => n.remove());
  button.disabled = true;
  button.textContent = D.common.processing || 'Working…';
  try {
    await fn(msg => { button.textContent = msg || (D.common.processing || 'Working…'); });
  } catch (err) {
    console.error(err);
    box.append(el('p', { class: 'note err run-error', text: `${D.common.errorGeneric || 'Something went wrong.'} ${err.message || ''}` }));
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ---------------------------------------------------------------- vendor libs
const LIB_FILES = {
  'pdf-lib': ['pdf-lib.min.js', 'PDFLib'],
  'pdf.js': ['pdf.min.js', 'pdfjsLib'],
  'qrcode-generator': ['qrcode-generator.min.js', 'qrcode'],
  'jszip': ['jszip.min.js', 'JSZip'],
  'marked': ['marked.min.js', 'marked'],
  'lamejs': ['lame.min.js', 'lamejs']
};
const cache = {};
export function loadLib(name) {
  if (cache[name]) return cache[name];
  const spec = LIB_FILES[name];
  if (name === 'gifenc') {
    cache[name] = import('/_assets/vendor/gifenc.mjs');
    return cache[name];
  }
  if (!spec) return Promise.reject(new Error(`unknown library ${name}`));
  const [file, globalName] = spec;
  if (window[globalName]) return Promise.resolve(window[globalName]);
  cache[name] = new Promise((res, rej) => {
    const s = el('script', { src: `/_assets/vendor/${file}`, onload: () => res(window[globalName]), onerror: () => rej(new Error(`could not load ${file}`)) });
    document.head.append(s);
  });
  return cache[name];
}
export async function pdfWorker() {
  // data-libs on the page usually preloads pdf.js, but a tool may reach this from a branch that
  // the registry does not declare (compress-pdf only rasterises on the lossy path). Loading on
  // demand keeps that a speed bump rather than a crash.
  const lib = window.pdfjsLib || await loadLib('pdf.js');
  lib.GlobalWorkerOptions.workerSrc = '/_assets/vendor/pdf.worker.min.js';
  return lib;
}

// ---------------------------------------------------------------- crypto / hashing
export async function digest(text, algo) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest(algo, buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function digestFile(file, algo) {
  const hash = await crypto.subtle.digest(algo, await file.arrayBuffer());
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function md5(str) {
  // compact public-domain style MD5 for legacy checksum comparison only
  const rot = (x, n) => (x << n) | (x >>> (32 - n));
  const s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
  const bytes = new TextEncoder().encode(str);
  const bitLen = bytes.length * 8;
  const withOne = [...bytes, 0x80];
  while (withOne.length % 64 !== 56) withOne.push(0);
  const len = new DataView(new ArrayBuffer(8));
  len.setUint32(0, bitLen >>> 0, true); len.setUint32(4, Math.floor(bitLen / 4294967296), true);
  for (let i = 0; i < 8; i++) withOne.push(new Uint8Array(len.buffer)[i]);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let chunk = 0; chunk < withOne.length; chunk += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) {
      const o = chunk + i * 4;
      M[i] = withOne[o] | (withOne[o + 1] << 8) | (withOne[o + 2] << 16) | (withOne[o + 3] << 24);
    }
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rot(F, s[Math.floor(i / 16) * 4 + (i % 4)])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  return [a0, b0, c0, d0].map(x => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, x, true);
    return [...b].map(y => y.toString(16).padStart(2, '0')).join('');
  }).join('');
}

// ---------------------------------------------------------------- text helpers
export function countWords(s) {
  const m = s.trim().match(/[^\s]+/g);
  return m ? m.length : 0;
}
export function parseCsv(text, { delimiter = ',', header = true } = {}) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* ignore */ }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return { header: [], rows: [] };
  if (!header) return { header: rows[0].map((_, i) => `column_${i + 1}`), rows: rows.map(r => Object.fromEntries(r.map((v, i) => [`column_${i + 1}`, v]))) };
  const head = rows.shift();
  return { header: head, rows: rows.map(r => Object.fromEntries(head.map((h, i) => [h || `column_${i + 1}`, r[i] ?? '']))) };
}
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let k = m - 1; k >= 0; k--) dp[i][k] = A[i] === B[k] ? dp[i + 1][k + 1] + 1 : Math.max(dp[i + 1][k], dp[i][k + 1]);
  const out = [];
  let i = 0, k = 0;
  while (i < n && k < m) {
    if (A[i] === B[k]) { out.push({ t: 'same', v: A[i] }); i++; k++; }
    else if (dp[i + 1][k] >= dp[i][k + 1]) { out.push({ t: 'del', v: A[i] }); i++; }
    else { out.push({ t: 'add', v: B[k] }); k++; }
  }
  while (i < n) out.push({ t: 'del', v: A[i++] });
  while (k < m) out.push({ t: 'add', v: B[k++] });
  return out;
}
