#!/usr/bin/env node
// Generates the raster brand assets the <head> points at: og.png (1200x630 social card),
// apple-touch-icon.png (180), favicon-16/32.png, favicon.ico (16/32/48) and favicon.svg.
// Dependency-free: PNGs are encoded by hand (zlib deflate + CRC32), the .ico wraps PNG entries.
// Output goes to src/assets/ which build.mjs copies verbatim into dist/_assets/.
//   node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'assets');

// ---------------------------------------------------------------- png encoding
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function pngEncode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const canvas = (w, h) => ({ w, h, px: Buffer.alloc(w * h * 4) });
const set = (c, x, y, [r, g, b, a = 255]) => { if (x < 0 || y < 0 || x >= c.w || y >= c.h) return; const i = (y * c.w + x) * 4; c.px[i] = r; c.px[i + 1] = g; c.px[i + 2] = b; c.px[i + 3] = a; };
const rect = (c, x, y, w, h, col) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(c, i, j, col); };
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function gradient(c, c1, c2) { for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const t = (x / c.w + y / c.h) / 2; set(c, x, y, [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]); } }
function line(c, x0, y0, x1, y1, th, col) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2; for (let i = 0; i <= n; i++) { const t = i / n; const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t); rect(c, x - (th >> 1), y - (th >> 1), th, th, col); } }
// The brand "M" mark (matches the inline SVG favicon), drawn with thick strokes.
function mark(c, cx, cy, s, col) { const t = Math.max(2, Math.round(s * 0.16)); const L = cx - s / 2, R = cx + s / 2, T = cy - s / 2, B = cy + s / 2; line(c, L, B, L, T, t, col); line(c, L, T, cx, cy + s * 0.12, t, col); line(c, cx, cy + s * 0.12, R, T, t, col); line(c, R, T, R, B, t, col); }
function roundTile(c, x, y, w, h, r, col) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const dx = Math.max(r - i, i - (w - 1 - r), 0), dy = Math.max(r - j, j - (h - 1 - r), 0); if (dx * dx + dy * dy <= r * r) set(c, x + i, y + j, col); } }

// ---------------------------------------------------------------- 5x7 bitmap font
const F = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#....', '#....', '#####'], F: ['#####', '#....', '####.', '#....', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'], H: ['#...#', '#...#', '#####', '#...#', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'], J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#', '#...#', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'], N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], R: ['####.', '#...#', '#...#', '####.', '#..#.', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'], X: ['#...#', '.#.#.', '..#..', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'], ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
function text(c, x, y, str, sc, col) { let cx = x; for (const ch of str.toUpperCase()) { const g = F[ch] || F[' ']; for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q] === '#') rect(c, cx + q * sc, y + r * sc, sc, sc, col); cx += 6 * sc; } return cx; }

const BLUE = [47, 109, 246], VIOLET = [124, 77, 255], WHITE = [255, 255, 255];

// ---------------------------------------------------------------- assets
await mkdir(OUT, { recursive: true });

// og.png 1200x630 — gradient, white mark tile, brand + tagline + domain
{
  const c = canvas(1200, 630); gradient(c, BLUE, VIOLET);
  roundTile(c, 90, 215, 200, 200, 44, WHITE); mark(c, 190, 315, 110, BLUE);
  text(c, 340, 235, 'CLEARLIGHT', 10, WHITE);
  text(c, 340, 330, 'TOOLS', 10, WHITE);
  text(c, 342, 440, 'FREE ONLINE TOOLS', 4, [234, 240, 255]);
  text(c, 342, 480, 'CLEARLIGHTTOOLS.COM', 4, [234, 240, 255]);
  await writeFile(join(OUT, 'og.png'), pngEncode(c.w, c.h, c.px));
}
// apple-touch-icon 180
{ const c = canvas(180, 180); gradient(c, BLUE, VIOLET); mark(c, 90, 90, 96, WHITE); await writeFile(join(OUT, 'apple-touch-icon.png'), pngEncode(c.w, c.h, c.px)); }
// favicon png 16 / 32
for (const s of [16, 32]) { const c = canvas(s, s); gradient(c, BLUE, VIOLET); mark(c, s / 2, s / 2, s * 0.62, WHITE); await writeFile(join(OUT, `favicon-${s}.png`), pngEncode(c.w, c.h, c.px)); }
// favicon.ico wrapping 16/32/48 PNGs
{
  const sizes = [16, 32, 48]; const imgs = [];
  for (const s of sizes) { const c = canvas(s, s); gradient(c, BLUE, VIOLET); mark(c, s / 2, s / 2, s * 0.62, WHITE); imgs.push({ s, buf: pngEncode(s, s, c.px) }); }
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(imgs.length, 4);
  let offset = 6 + imgs.length * 16; const entries = []; const blobs = [];
  for (const { s, buf } of imgs) { const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e[2] = 0; e[3] = 0; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12); entries.push(e); blobs.push(buf); offset += buf.length; }
  await writeFile(join(OUT, 'favicon.ico'), Buffer.concat([header, ...entries, ...blobs]));
}
// favicon.svg — vector twin of the inline data-URI icon
await writeFile(join(OUT, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6df6"/><stop offset="1" stop-color="#7c4dff"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M20 44V20h8l4 12 4-12h8v24h-6V30l-4 12h-4l-4-12v14z" fill="white"/></svg>\n`);

console.log('icons written to src/assets/: og.png apple-touch-icon.png favicon-16.png favicon-32.png favicon.ico favicon.svg');