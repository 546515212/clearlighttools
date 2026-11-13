// Node-only helpers shared by the fixture generator, the fixture checker and the browser
// report, so "is this byte sequence really a PNG/PDF/WAV" is written down exactly once.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- crc32 (PNG chunks, zip)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// ---------------------------------------------------------------- UMD in a "type": "module" package
// vendor/pdf-lib.min.js is UMD and this package is ESM, so a plain import parses it as ESM and
// dies on `self`. Evaluating it with module/exports handed in makes the UMD wrapper take its
// CommonJS branch and return the library cleanly.
export function loadUmd(file) {
  const src = readFileSync(join(ROOT, 'vendor', file), 'utf8');
  const shim = {};
  const module = { exports: shim };
  new Function('module', 'exports', 'globalThis', 'self', 'window', 'global', 'document', 'navigator', src)
    (module, shim, shim, shim, shim, shim, undefined, undefined);
  const lib = module.exports;
  // a UMD bundle may hand back a class (JSZip) rather than a namespace object
  if (!lib || (typeof lib !== 'object' && typeof lib !== 'function'))
    throw new Error(`${file} did not export anything usable`);
  return lib;
}

// ---------------------------------------------------------------- format probes
// Each probe answers one question: could a real viewer open this? It looks at the bytes, never at
// the file name, because a tool that mislabels its output is exactly the bug being tested for.
export function pngInfo(buf) {
  const sig = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!sig) return { ok: false, info: hex(buf, 8), why: 'not a PNG signature' };
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  let p = 8, idat = 0, ended = false, badCrc = 0;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.slice(p + 4, p + 8).toString('latin1');
    const data = buf.slice(p + 8, p + 8 + len);
    if (crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) !== buf.readUInt32BE(p + 8 + len)) badCrc++;
    if (type === 'IDAT') idat += data.length;
    if (type === 'IEND') { ended = true; break; }
    p += 12 + len;
  }
  // canvas.toBlob('image/png') writes filter-0..4 rows; the inflated byte count is not fixed, so
  // only the structural facts are asserted here.
  return {
    ok: ended && badCrc === 0 && idat > 0,
    info: `${w}x${h} idat=${idat} crcErrors=${badCrc}`,
    why: !ended ? 'no IEND chunk' : badCrc ? `${badCrc} chunk(s) with a bad CRC` : idat ? '' : 'no image data'
  };
}

export function jpegInfo(buf) {
  const soi = buf[0] === 0xff && buf[1] === 0xd8;
  const eoi = buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  let w = 0, h = 0;
  for (let p = 2; p + 9 < buf.length;) {
    if (buf[p] !== 0xff) { p++; continue; }
    const marker = buf[p + 1], len = buf.readUInt16BE(p + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      h = buf.readUInt16BE(p + 5); w = buf.readUInt16BE(p + 7); break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    p += 2 + len;
  }
  return {
    ok: soi && eoi && w > 0 && h > 0,
    info: `${w}x${h}`,
    why: !soi ? 'no SOI' : !eoi ? 'no EOI' : !w ? 'no SOF with dimensions' : ''
  };
}

export function wavInfo(buf) {
  const riff = buf.slice(0, 4).toString('latin1') === 'RIFF';
  const wave = buf.slice(8, 12).toString('latin1') === 'WAVE';
  if (!riff || !wave) return { ok: false, info: hex(buf, 12), why: 'not RIFF/WAVE' };
  // RIFF chunk sizes are little-endian. This scanner used to read them as big-endian, which turns
  // a 16-byte "fmt " chunk into 268435456 bytes, walks the cursor past the end of the buffer and
  // made the probe throw RangeError instead of reporting anything — a check that crashes is worse
  // than a check that lies, because it gets deleted.
  const declared = buf.readUInt32LE(4);
  let d = 12, fmtAt = -1, dataAt = -1, dataSize = 0;
  while (d + 8 <= buf.length) {
    const id = buf.slice(d, d + 4).toString('latin1');
    const size = buf.readUInt32LE(d + 4);
    if (size > buf.length) break;                       // corrupt header: stop, do not run off the end
    if (id === 'fmt ') fmtAt = d + 8;
    else if (id === 'data') { dataAt = d + 8; dataSize = size; break; }
    d += 8 + size + (size % 2);                          // chunks are word-aligned
  }
  if (fmtAt < 0 || dataAt < 0) {
    return { ok: false, info: `declared=${declared}`, why: `no ${fmtAt < 0 ? 'fmt ' : 'data'} chunk` };
  }
  const audioFormat = buf.readUInt16LE(fmtAt);
  const channels = buf.readUInt16LE(fmtAt + 2);
  const rate = buf.readUInt32LE(fmtAt + 4);
  const bits = buf.readUInt16LE(fmtAt + 14);
  const ok = audioFormat === 1 && dataAt + dataSize <= buf.length && declared === buf.length - 8;
  const dur = channels && rate && bits ? dataSize / (channels * rate * bits / 8) : 0;
  return {
    ok,
    info: `ch=${channels} rate=${rate} bits=${bits} data=${dataSize} dur=${dur.toFixed(2)}s`,
    why: audioFormat !== 1 ? `format ${audioFormat} is not PCM`
      : declared !== buf.length - 8 ? `RIFF size ${declared} != ${buf.length - 8}`
      : dataAt + dataSize > buf.length ? 'data chunk runs past the end' : ''
  };
}

export function zipInfo(buf, inflate) {
  const local = buf.slice(0, 4).toString('latin1') === 'PK\x03\x04';
  const e = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (!local || e < 0) return { ok: false, info: hex(buf, 8), why: 'not a zip (no local header / no end record)' };
  const entries = buf.readUInt16LE(e + 10);
  const names = [];
  for (let p = 0; p + 30 <= e; p++) {
    if (!(buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x03 && buf[p + 3] === 0x04)) continue;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26), elen = buf.readUInt16LE(p + 28);
    names.push(buf.slice(p + 30, p + 30 + nlen).toString('utf8'));
    if (names.length === 1 && inflate) {
      const data = buf.slice(p + 30 + nlen + elen, p + 30 + nlen + elen + csize);
      try { if (method === 8) inflate(data); else if (method !== 0) return { ok: true, info: `entries=${entries} first=${names[0]} method=${method}`, why: '' }; }
      catch (err) { return { ok: false, info: `entries=${entries} first=${names[0]}`, why: `first entry will not inflate: ${err.message}` }; }
    }
  }
  return {
    ok: entries === names.length && names.length > 0,
    info: `entries=${entries} [${names.slice(0, 3).join(', ')}${names.length > 3 ? ' …' : ''}]`,
    why: entries !== names.length ? `directory claims ${entries}, found ${names.length}` : names.length ? '' : 'no entries'
  };
}

export async function pdfInfo(buf, PDFDocument) {
  if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return { ok: false, info: hex(buf, 8), why: 'no %PDF header' };
  try {
    const doc = await PDFDocument.load(buf);
    const pages = doc.getPageCount();
    const one = doc.getPage(0).getSize();
    return { ok: pages > 0, info: `pages=${pages} p1=${Math.round(one.width)}x${Math.round(one.height)}`, why: pages ? '' : 'zero pages' };
  } catch (err) {
    return { ok: false, info: `${buf.length}B`, why: `pdf-lib refuses it: ${err.message}` };
  }
}

export function webpInfo(buf) {
  const ok = buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
  return { ok, info: `${buf.slice(12, 16).toString('latin1')} ${buf.readUInt32LE(4)}`, why: ok ? '' : 'not RIFF/WEBP' };
}

export function gifInfo(buf) {
  const sig = buf.slice(0, 6).toString('latin1');
  const ok = /^GIF8[79]a$/.test(sig) && buf[buf.length - 1] === 0x3b;
  // frames: every image block starts 0x2C, and the trailer 0x3B ends the stream. Counting them is
  // what proves a multi-frame encode really wrote the frames it was given.
  let frames = 0;
  for (let i = 13; i < buf.length - 1; i++) if (buf[i] === 0x21 && buf[i + 1] === 0xf9) frames++;
  return {
    ok,
    info: `${sig} ${buf.readUInt16LE(6)}x${buf.readUInt16LE(8)} frames=${frames}`,
    why: ok ? '' : 'bad GIF signature or missing 0x3B trailer'
  };
}

export function icoInfo(buf) {
  const reserved = buf.readUInt16LE(0), type = buf.readUInt16LE(2), n = buf.readUInt16LE(4);
  return { ok: reserved === 0 && type === 1 && n > 0, info: `${n} image(s)`, why: reserved !== 0 || type !== 1 ? 'not an ICO header' : n ? '' : 'no images' };
}

export function textInfo(buf, name, { json = /\.json$/i, html = /\.html?$/i } = {}) {
  const s = buf.toString('utf8');
  const bad = (s.match(/\uFFFD/g) || []).length;
  const info = `${s.length} chars${bad ? ` ${bad} replacement char(s)` : ''}`;
  if (bad) return { ok: false, info, why: 'not valid UTF-8' };
  if (json.test(name)) {
    try { JSON.parse(s); return { ok: true, info: `${info} valid json`, why: '' }; }
    catch (err) { return { ok: false, info, why: `not valid json: ${err.message}` }; }
  }
  if (html.test(name)) return { ok: /<(html|body|h1|p|!doctype)/i.test(s), info, why: 'no html markup' };
  return { ok: s.trim().length > 0, info, why: s.trim().length ? '' : 'empty text' };
}

export const hex = (buf, n = 12) => [...buf.slice(0, n)].map(x => x.toString(16).padStart(2, '0')).join(' ');

// content first, name never: a JPEG saved as .png is still a JPEG, and that is a real bug
export async function probe(buf, name, { PDFDocument, inflate } = {}) {
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return PDFDocument ? pdfInfo(buf, PDFDocument) : { ok: true, info: 'pdf', why: '' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return pngInfo(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegInfo(buf);
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WAVE') return wavInfo(buf);
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return webpInfo(buf);
  if (buf.slice(0, 2).toString('latin1') === 'PK') return zipInfo(buf, inflate);
  if (buf.slice(0, 6).toString('latin1').startsWith('GIF8')) return gifInfo(buf);
  if (buf.length > 32 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) return icoInfo(buf);
  return textInfo(buf, name);
}
