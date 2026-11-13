#!/usr/bin/env node
// Downloads the third-party libraries the client-side tools need into ./vendor.
// Everything is vendored (no runtime CDN) so the site works offline, loads fast,
// and never leaks a user's file or IP to a third party.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  // PDF merge / split / compress / rotate / watermark
  ['pdf-lib.min.js', 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'],
  // PDF text extraction + PDF -> PNG
  ['pdf.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'],
  ['pdf.worker.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'],
  // QR code (public domain, UMD)
  ['qrcode-generator.min.js', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'],
  // GIF encoder (ESM, worker-free)
  ['gifenc.mjs', 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js'],
  // zip for "download all" bundles
  ['jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'],
  // markdown preview
  ['marked.min.js', 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'],
  // MP3 encoder for the audio tools (WAV is native; MP3 needs LAME). UMD global `lamejs`.
  ['lame.min.js', 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js'],
];

await mkdir(join(root, 'vendor'), { recursive: true });

let failed = [];
for (const [name, url] of FILES) {
  const out = join(root, 'vendor', name);
  await mkdir(dirname(out), { recursive: true });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error(`suspiciously small (${buf.length}B) - probably an error page`);
    await writeFile(out, buf);
    console.log(`ok   ${name.padEnd(26)} ${(buf.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    failed.push(name);
    console.log(`FAIL ${name.padEnd(26)} ${err.message}`);
  }
}
if (failed.length) {
  console.log('\nMissing:', failed.join(', '));
  console.log('Tools that need a missing library show a clear "library unavailable" message instead of breaking silently.');
  process.exitCode = 1;
}
