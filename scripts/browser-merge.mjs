#!/usr/bin/env node
// Merge batched browser sweeps into one report file.
//
//   node scripts/browser-merge.mjs                      # uses sweep-b*.json in test-files/out
//   node scripts/browser-merge.mjs --files=a.json,b.json
//   node scripts/browser-merge.mjs --out=sweep-merged.json
//   node scripts/browser-merge.mjs --selftest           # prove the merge can see its own gaps
//
// Why batches exist: the driver tab is hidden, and after a few minutes Chrome aligns nested
// timers to once a minute, so a 49-row sweep started in one page never finishes (it stalled at
// row 26 for 261 s in run 4). The workaround is several short sweeps, each on a fresh navigation.
// That leaves several files, and scripts/browser-report.mjs reads one — this turns them back into
// one, in plan order, so a missing row is a visible "not run" instead of a silent absence.
//
// Rows are matched to plan slots by tool id, and each batch row is used once: pdf-to-jpg and
// split-pdf each appear twice in the plan (different fixtures/options), so "some row for this
// tool" is not enough to say the plan was covered.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test-files', 'out');

const plan = (await readFile(join(ROOT, 'scripts', 'browser', 'sweep-plan.json'), 'utf8'));
const planned = JSON.parse(plan).tools;

// newest row wins, so a re-run after a fix replaces the failed attempt instead of sitting next to it
function rowsNewestFirst(files) {
  return files
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
    .flatMap(f => (f.rows || []).map(r => ({ ...r, _from: f.__name })));
}

// One plan slot -> one batch row, and each batch row is consumed once: the newest attempt wins
// (rowsNewestFirst put it first), and a tool that appears twice in the plan needs two rows.
function merge(planTools, batchFiles) {
  const rows = rowsNewestFirst(batchFiles);
  const used = new Set();
  const merged = [];
  const missing = [];
  for (const slot of planTools) {
    const i = rows.findIndex((r, idx) => !used.has(idx) && r.tool === slot.tool);
    if (i < 0) {
      missing.push(slot);
      merged.push({ tool: slot.tool, ok: false, why: 'not run by any batch' });
      continue;
    }
    used.add(i);
    // keep which batch file answered this slot: "49/49 covered" has to be auditable, otherwise a
    // merged report cannot tell a fresh green from an old one that was simply never re-run
    merged.push({ ...rows[i], _from: rows[i]._from });
  }
  return { merged, missing };
}

// ---------------------------------------------------------------- selftest
// The merge's only job is to say which plan slots are covered. A merge that reported "all
// covered" while a tool was missing would be worse than no merge at all, so the check that
// claims coverage has to be able to fail. Deliberately under-fed batch files must produce exactly
// the gaps that were created.
if (process.argv.includes('--selftest')) {
  const mk = (tool, ok = true) => ({ tool, ok, why: ok ? null : 'forced', bytes: [], output: [] });
  const three = [{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }];
  const full = [{ __name: 'x', startedAt: '2026-01-02', rows: [mk('a'), mk('b'), mk('c')] }];
  const dropped = [{ __name: 'y', startedAt: '2026-01-02', rows: [mk('a'), mk('b')] }];
  const dup = [
    { __name: 'p', startedAt: '2026-01-01', rows: [mk('a')] },
    { __name: 'q', startedAt: '2026-01-03', rows: [mk('a', false)] }
  ];
  const dupPlan = [{ tool: 'a' }, { tool: 'a' }];
  const cases = [
    ['complete input is fully covered', merge(three, full), m => m.missing.length === 0 && m.merged.every(r => r.ok)],
    ['a dropped tool is reported missing', merge(three, dropped), m => m.missing.length === 1 && m.missing[0].tool === 'c'
      && m.merged.some(r => r.why === 'not run by any batch')],
    ['the newest attempt wins', merge([{ tool: 'a' }], dup), m => m.merged.length === 1 && m.merged[0].why === 'forced'],
    ['a tool listed twice needs two rows', merge(dupPlan, full), m => m.missing.length === 1 && m.merged[1].why === 'not run by any batch'],
    ['an empty batch list leaves every slot missing', merge(three, []), m => m.missing.length === 3]
  ];
  let bad = 0;
  for (const [name, got, judge] of cases) {
    const ok = judge(got);
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (bad) {
    console.log(`selftest: ${bad} case(s) failed — the merge cannot be trusted to report coverage`);
    process.exit(1);
  }
  console.log(`selftest ok — ${cases.length} cases, the merge sees a dropped tool, a stale attempt and an empty input`);
  process.exit(0);
}

const argFiles = (process.argv.find(a => a.startsWith('--files=')) || '').slice(7);
let names = argFiles ? argFiles.split(',').map(s => s.trim()).filter(Boolean)
  : (await readdir(OUT)).filter(n => /^sweep-b\d+.*\.json$/.test(n) && !/control/.test(n));
// b11 is the pdf-to-jpg attempt made before the rAF shim existed; it is the negative control for
// that fix and must not be merged as if it were a current result
names = names.filter(n => n !== 'sweep-b11.json');
if (!names.length) {
  console.error(`no batch files in ${OUT} (expected sweep-b1.json …) — run the batches first, see docs/TESTING.md`);
  process.exit(1);
}
const files = [];
for (const n of names) {
  const j = JSON.parse(await readFile(join(OUT, n), 'utf8'));
  j.__name = n;
  files.push(j);
}
const { merged, missing } = merge(planned, files);
const outName = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6) || 'sweep-merged.json';
const doc = {
  mergedFrom: files.map(f => `${f.__name} (${(f.rows || []).length} rows${f.done ? '' : ', incomplete'})`),
  startedAt: files.map(f => f.startedAt).filter(Boolean).sort().pop(),
  finishedAt: new Date().toISOString(),
  done: true,
  planned: planned.map(p => p.tool),
  rows: merged
};
await writeFile(join(OUT, outName), JSON.stringify(doc, null, 1));
console.log(`merged ${files.length} batch files -> test-files/out/${outName}: ${merged.length}/${planned.length} plan slots filled`);
for (const f of doc.mergedFrom) console.log(`  ${f}`);
const failed = merged.filter(r => !r.ok);
if (failed.length) console.log(`rows not green: ${failed.map(r => `${r.tool}${r.why ? ` (${String(r.why).slice(0, 60)})` : ''}`).join(', ')}`);
// provenance, so a merged green can be read as "this run" and not "some run"
const byBatch = {};
for (const r of merged) if (r._from) byBatch[r._from] = (byBatch[r._from] || 0) + 1;
console.log(`slots answered by: ${Object.entries(byBatch).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} (${n})`).join(', ')}`);
if (missing.length) {
  console.log(`\n${missing.length} plan slot(s) never ran: ${missing.map(m => m.tool).join(', ')}`);
  process.exit(1);
}
console.log('every plan slot is backed by a batch row');
