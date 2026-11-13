#!/usr/bin/env node
// Reads the browser sweep results (test-files/out/sweep-all.json) and checks the bytes the
// browser actually wrote there. The page says "I produced X"; this proves X is a real file.
//
//   node dev-server.mjs &                          # serves /__script/drive.mjs
//   node scripts/browser-report.mjs                # read whatever has been captured so far
//   node scripts/browser-report.mjs --strict       # exit 1 unless the sweep finished all green
//   node scripts/browser-report.mjs --json         # machine-readable
//
// The sweep runs in the browser (scripts/browser/drive.mjs + sweep-plan.json) because only a
// browser has canvas, Web Audio and pdf.js. This script closes the loop from the Node side.
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { ROOT, loadUmd, probe } from './lib-node.mjs';

const OUT = join(ROOT, 'test-files', 'out');
const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');
// --file=sweep-run2.json for a specific run. With no flag, the newest sweep-*.json wins: reruns
// get a timestamped name, and reading a stale one by default is how an old failure gets reported
// as current (or, worse, an old green hides a new break).
let SWEEP_FILE = (process.argv.find(a => a.startsWith('--file=')) || '').slice(7);
if (!SWEEP_FILE) {
  const names = (await readdir(OUT).catch(() => [])).filter(n => /^sweep-.*\.json$/.test(n));
  const stamped = await Promise.all(names.map(async n => [n, (await readFile(join(OUT, n), 'utf8')).match(/"startedAt":\s*"([^"]+)"/)?.[1] || ''] ));
  stamped.sort((a, b) => b[1].localeCompare(a[1]));
  SWEEP_FILE = stamped[0]?.[0] || 'sweep-all.json';
  if (stamped.length > 1) console.log(`reading the newest of ${stamped.length} sweep files: ${SWEEP_FILE} (started ${stamped[0][1] || 'unknown'})`);
}

let sweep;
try {
  sweep = JSON.parse(await readFile(join(OUT, SWEEP_FILE), 'utf8'));
} catch {
  console.error(`no sweep results in ${OUT}/${SWEEP_FILE} yet — start the browser sweep first (see docs/TESTING.md)`);
  process.exit(1);
}

const { PDFDocument } = loadUmd('pdf-lib.min.js');
const files = await readdir(OUT).catch(() => []);
const rows = [];
let pass = 0, fail = 0;

for (const r of sweep.rows) {
  const checks = [];
  for (const claim of r.bytes || []) {
    // drive.mjs records "<saved file> | <bytes> | <mime>"
    const [savedName, sizeClaim, mimeClaim] = String(claim).split(' | ');
    const hit = files.includes(savedName) ? savedName : null;
    if (!hit) { checks.push({ name: savedName, ok: false, info: '-', why: 'never reached test-files/out/' }); continue; }
    const buf = await readFile(join(OUT, hit));
    const p = await probe(buf, hit, { PDFDocument, inflate: d => inflateSync(d) });
    const sizeOk = sizeClaim === undefined || Number(sizeClaim) === buf.length;
    checks.push({
      name: savedName,
      file: hit,
      ok: p.ok && sizeOk,
      info: `${buf.length}B ${p.info}${mimeClaim && mimeClaim !== '-' ? ` mime=${mimeClaim}` : ''}`,
      why: !sizeOk ? `page said ${sizeClaim}B` : p.why
    });
  }
  const ok = r.ok && checks.every(c => c.ok);
  ok ? pass++ : fail++;
  rows.push({ ...r, checks, ok });
}

const pending = sweep.planned.length - sweep.rows.length;

if (asJson) {
  console.log(JSON.stringify({ done: sweep.done, pass, fail, pending, rows }, null, 1));
} else {
  console.log(`\nBrowser sweep — ${sweep.done ? 'finished' : 'still running'} (${sweep.rows.length}/${sweep.planned.length} tools)\n`);
  for (const r of rows) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${String(r.tool).padEnd(24)} ${String(r.ms || 0).padStart(5)}ms  ${r.why || ''}`);
    for (const c of r.checks) console.log(`       ${c.ok ? '+' : '!'} ${c.file?.padEnd(30) || c.name.padEnd(30)} ${c.info}${c.why ? `  <- ${c.why}` : ''}`);
    if (r.output?.length) console.log(`        > ${r.output.join(' // ').slice(0, 160)}`);
  }
  const notRun = sweep.planned.filter(p => !sweep.rows.some(r => r.tool === p));
  if (notRun.length) console.log(`\nnot swept yet (${notRun.length}): ${notRun.join(', ')}`);
  console.log(`\n  ${pass} passed, ${fail} failed${sweep.done ? '' : `, ${pending} still in the queue`}`);
  console.log('  compress-video is deliberately absent: no video fixture exists.\n');
}

if (strict && (!sweep.done || fail || pending)) process.exitCode = 1;
