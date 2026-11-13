import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
const src = readFileSync('vendor/pdf-lib.min.js', 'utf8');
const shim = {}; const module = { exports: shim };
new Function('module', 'exports', 'globalThis', 'self', 'window', 'global', 'document', 'navigator', src)(module, shim, shim, shim, shim, shim, undefined, undefined);
const { PDFDocument } = module.exports;
for (const f of ['sample-a.pdf', 'sample-b.pdf', 'sample-long.pdf']) {
  const b = readFileSync('test-files/' + f);
  const d = await PDFDocument.load(b);
  const sizes = d.getPageIndices().map(i => d.getPage(i).getSize());
  const raw = d.getTitle();
  const title = raw == null ? '' : typeof raw === 'string' ? raw : raw.asString();
  console.log(f, 'pages=' + d.getPageCount(), 'title=' + JSON.stringify(title), 'bytes=' + b.length, 'p1=' + sizes[0].width + 'x' + sizes[0].height);
}
for (const f of ['photo.png', 'photo-small.png', 'icon.png']) {
  const b = readFileSync('test-files/' + f);
  const sig = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  let idat = Buffer.alloc(0), p = 8;
  while (p + 8 <= b.length) {
    const len = b.readUInt32BE(p), t = b.subarray(p + 4, p + 8).toString('latin1');
    if (t === 'IDAT') idat = Buffer.concat([idat, b.subarray(p + 8, p + 8 + len)]);
    p += 12 + len;
  }
  const raw = inflateSync(idat);
  console.log(f, 'sig=' + sig, 'dims=' + w + 'x' + h, 'depth=' + b[24], 'ct=' + b[25], 'pixels=' + raw.length, 'ok=' + (raw.length === h * (1 + w * 4)));
}
const a = readFileSync('test-files/tone.wav');
console.log('tone.wav', a.subarray(0, 4).toString() + '/' + a.subarray(8, 12).toString(), 'fmt=' + a.readUInt16LE(20), 'ch=' + a.readUInt16LE(22), 'rate=' + a.readUInt32LE(24), 'bits=' + a.readUInt16LE(34), 'dur=' + ((a.length - 44) / 2 / 44100).toFixed(2) + 's', 'riff=' + (a.readUInt32LE(4) === a.length - 8), 'data=' + (a.readUInt32LE(40) === a.length - 44));
