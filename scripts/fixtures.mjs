#!/usr/bin/env node
// Generates the small real files that browser verification feeds to the tools.
// Everything here is produced from scratch (no test corpus to download), and each generator
// writes a genuinely valid file, because a tool that "works" on a broken fixture proves nothing.
//
//   node scripts/fixtures.mjs            create whatever is missing
//   node scripts/fixtures.mjs --force    overwrite everything
//   node scripts/fixtures.mjs --list     show what is in test-files/
//
// Two fixtures cannot be made in Node and are seeded from the browser once, then kept:
//   photo.jpg  - canvas.toBlob('image/jpeg') of photo.png, POSTed to /__save
//   clip.webm  - MediaRecorder over a canvas stream, POSTed to /__save
// They are listed as optional so a fresh clone still builds a usable set.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'test-files');
const force = process.argv.includes('--force');

// ---------------------------------------------------------------- png
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
// 8-bit RGBA, filter 0 on every row
function png(width, height, pixel) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y, width, height);
      row[1 + x * 4] = r; row[2 + x * 4] = g; row[3 + x * 4] = b; row[4 + x * 4] = a;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
// A recognisable picture rather than noise: diagonal gradient, a solid disc, and a black frame
// with a white cross so resize/crop/rotate results can be eyeballed in seconds.
const photo = png(240, 160, (x, y, w, h) => {
  const edge = x < 4 || y < 4 || x > w - 5 || y > h - 5;
  if (edge) return [16, 24, 40, 255];
  const cx = x - w * 0.3, cy = y - h * 0.5;
  if (cx * cx + cy * cy < 42 * 42) return [236, 92, 64, 255];
  if (Math.abs(x - w * 0.72) < 3 || Math.abs(y - h * 0.42) < 3) return [250, 250, 250, 255];
  return [Math.round(255 * x / w), Math.round(180 + 60 * y / h), Math.round(255 - 200 * x / w), 255];
});
const icon = png(64, 64, (x, y, w, h) => {
  const d = Math.hypot(x - w / 2, y - h / 2);
  if (d > 30) return [0, 0, 0, 0];
  return d > 20 ? [20, 120, 220, 255] : [245, 245, 250, 255];
});

// ---------------------------------------------------------------- wav
// 16-bit PCM mono: a 440 Hz tone with a short attack/decay, so audio tools have real samples to
// cut, encode and measure instead of an empty buffer.
function wav(seconds = 1.2, freq = 440, rate = 44100) {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.02) * Math.min(1, (seconds - t) / 0.08);
    const s = Math.sin(2 * Math.PI * freq * t) * 0.5 * env;
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);            // PCM
  head.writeUInt16LE(1, 22);            // mono
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);     // byte rate
  head.writeUInt16LE(2, 32);            // block align
  head.writeUInt16LE(16, 34);           // bits
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// ---------------------------------------------------------------- pdf
// vendor/pdf-lib.min.js is UMD, and this package is "type": "module", so a plain import would
// parse it as ESM and die on `self`. Evaluating it with module/exports handed in makes the UMD
// wrapper take its CommonJS branch and return the library cleanly.
function loadUmd(file) {
  const src = readFileSync(join(ROOT, 'vendor', file), 'utf8');
  const shim = {};
  const module = { exports: shim };
  new Function('module', 'exports', 'globalThis', 'self', 'window', 'global', 'document', 'navigator', src)
    (module, shim, shim, shim, shim, shim, undefined, undefined);
  const lib = module.exports;
  if (!lib || typeof lib !== 'object') throw new Error(`${file} did not export anything usable`);
  return lib;
}
async function makePdf(label, pages, color) {
  const { PDFDocument, StandardFonts, rgb } = loadUmd('pdf-lib.min.js');
  const doc = await PDFDocument.create();
  doc.setTitle(`${label} fixture`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([420, 560]);
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: height - 74, width, height: 74, color: rgb(color[0], color[1], color[2]) });
    page.drawText(label, { x: 24, y: height - 48, size: 22, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`page ${p + 1} of ${pages}`, { x: 24, y: height - 120, size: 16, font });
    // body copy that pdf-to-text can be checked against, including a non-ASCII run so the
    // text extraction path is not tested with plain latin only
    page.drawText('The quick brown fox jumps over the lazy dog.', { x: 24, y: height - 160, size: 12, font });
    page.drawText('0123456789 - sample figures for extraction', { x: 24, y: height - 180, size: 12, font });
    for (let i = 0; i < 8; i++) {
      page.drawRectangle({ x: 24 + i * 22, y: 120, width: 16, height: 20 + i * 14, color: rgb(0.35, 0.5, 0.85) });
    }
    page.drawText(`${label}-${p + 1}`, { x: width - 110, y: 40, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return doc.save();
}

// ---------------------------------------------------------------- write
const OPTIONAL = new Set(['photo.jpg', 'clip.webm']);
const generators = () => ({
  'photo.png': () => photo,
  'photo-small.png': () => png(80, 60, (x, y, w, h) => [255 * x / w, 120, 255 - 255 * y / h, 255]),
  'icon.png': () => icon,
  'tone.wav': () => wav(),
  'sample-a.pdf': () => makePdf('ALPHA', 3, [0.16, 0.35, 0.6]),
  'sample-b.pdf': () => makePdf('BETA', 3, [0.6, 0.25, 0.16]),
  'sample-long.pdf': () => makePdf('LONG', 12, [0.2, 0.5, 0.3])
});

if (process.argv.includes('--list')) {
  if (existsSync(DIR)) {
    for (const name of readdirSync(DIR).sort()) {
      if (name === 'out') continue;
      console.log(`${String(statSync(join(DIR, name)).size).padStart(9)} B  ${name}`);
    }
    const out = join(DIR, 'out');
    if (existsSync(out)) console.log(`  + ${readdirSync(out).length} captured output(s) in test-files/out/`);
  } else console.log('test-files/ does not exist yet');
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
mkdirSync(join(DIR, 'out'), { recursive: true });

const made = [], kept = [], missing = [];
for (const [name, gen] of Object.entries(generators())) {
  const p = join(DIR, name);
  if (existsSync(p) && !force) { kept.push(name); continue; }
  const bytes = await gen();
  writeFileSync(p, bytes);
  made.push(`${name} (${bytes.length.toLocaleString()} B)`);
}
for (const name of OPTIONAL) if (!existsSync(join(DIR, name))) missing.push(name);

console.log(`fixtures in test-files/: ${kept.length} kept, ${made.length} written`);
for (const m of made) console.log(`  + ${m}`);
if (missing.length) {
  console.log(`  ~ not present (seeded from the browser, optional): ${missing.join(', ')}`);
  console.log('    photo.jpg : open /en/resize-image/, drop photo.png, or canvas.toBlob("image/jpeg") in');
  console.log('                DevTools, then POST the bytes to /__save?name=photo.jpg');
  console.log('    clip.webm : MediaRecorder over canvas.captureStream() in the same page');
}
console.log('\n  dev-server serves them at /__files/<name>, output goes back with POST /__save?name=<file>\n');
