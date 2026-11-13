#!/usr/bin/env node
// Did a translated shard keep *exactly* the keys the skeleton shipped?
//
//   node scripts/check-shard-parity.mjs --locale fr
//   node scripts/check-shard-parity.mjs --locale fr --layer w
//   node scripts/check-shard-parity.mjs --all --strict            # defects only
//   node scripts/check-shard-parity.mjs --all --strict --complete # a batch must be finished too
//
// Why this exists next to check-translations: the checker proves every key a shard *does* supply is
// real, and the coverage report prints a number — but nothing fails when a translator deletes forty
// lines while pasting. A dropped key silently keeps serving English, the percentage drops, and the
// build stays green. This recomputes the very list `translation-shard.mjs --emit` would have written
// (same loader, same credit for titles.json, same non-empty rule) and compares it with the keys the
// shards actually declare, so "translated the batch" and "shipped the batch" are one statement.
//
// Three verdicts, deliberately separated: `stale` (a key that is not English) and `empty` (a value
// nobody filled in) are defects on their own and fail. A gap is normal mid-sweep — a locale is
// allowed to have finished `w` and not `t`, or half of `w` — so it only fails under `--complete`,
// which is what you pass the moment a batch is meant to be done.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';
import {
  LOCALES_DIR, applySource, leaves, localeSources, normaliseToolsDict, ownLayer, readJsonOr
} from './lib-locale-layers.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const localeArg = opt('locale');
const onlyLayer = opt('layer');
const strict = argv.includes('--strict');
const complete = argv.includes('--complete');
const all = argv.includes('--all');

const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));
const tools = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const toolIds = new Set(tools.map(t => t.id));
const enChrome = JSON.parse(await readFile(join(LOCALES_DIR, 'en.json'), 'utf8'));
const enTools = normaliseToolsDict(await readJsonOr(join(LOCALES_DIR, 'en.tools.json'), null));
const titlesAll = await readJsonOr(join(LOCALES_DIR, 'titles.json'), {});

const english = leaves({ ...enChrome, w: enTools.w || {}, t: enTools.t || {} });
const layerOf = k => (k.startsWith('w.') ? 'w' : k.startsWith('t.') ? 't' : 'c');

async function report(l) {
  const { sources, errors } = await localeSources(l, { toolIds });
  if (errors.length) return { l, errors };
  const shards = sources.filter(s => s.kind === 'shard');
  if (!shards.length) return { l, rows: [], note: 'no shards yet' };

  // what the generator would have asked for: English leaves this locale's NON-shard layers do not
  // supply, plus the titles.json credit the generator also applies
  const base = leaves(ownLayer(sources.filter(s => s.kind !== 'shard')));
  for (const [id, title] of Object.entries(titlesAll[l] || {})) {
    if (title) { base[`t.${id}.title`] = base[`t.${id}.title`] || title; base[`t.${id}.h1`] = base[`t.${id}.h1`] || title; }
  }
  const asked = layer => Object.keys(english)
    .filter(k => String(english[k] ?? '').trim() !== '')
    .filter(k => layerOf(k) === layer)
    .filter(k => !(typeof base[k] === 'string' && String(base[k]).trim() !== ''));

  const rows = [];
  for (const layer of ['w', 't', 'c']) {
    if (onlyLayer && layer !== onlyLayer) continue;
    const files = shards.filter(s => Object.keys(leaves(layer === 'c' ? (s.c || {}) : (s[layer] || {}), layer === 'c' ? '' : layer)).length);
    if (!files.length) continue;
    const supplied = {};
    for (const s of files) {
      const block = layer === 'c' ? s.c : s[layer];
      for (const [k, v] of Object.entries(leaves(block || {}, layer === 'c' ? '' : layer))) supplied[k] = v;
    }
    const want = asked(layer);
    const keys = Object.keys(supplied);
    rows.push({
      layer,
      files: files.map(f => f.file),
      asked: want.length,
      shipped: keys.length,
      gap: want.filter(k => !(k in supplied)),
      stale: keys.filter(k => !english[k]),
      empty: keys.filter(k => String(supplied[k] ?? '').trim() === ''),
      // a shard may legitimately re-supply a key another layer already covers — worth printing, not
      // failing, because the merge order decides the value and check:widgets asserts which one won
      overlap: keys.filter(k => k in base)
    });
  }
  return { l, rows };
}

const targets = all ? cfg.locales.filter(x => x !== cfg.defaultLocale)
  : (localeArg ? localeArg.split(',') : []);
if (!targets.length) {
  console.error('usage: --locale <l>[,<l>…] | --all   [--layer w|t|c] [--complete] [--strict]');
  process.exit(2);
}
let defects = 0, unfinished = 0, layersChecked = 0;
for (const l of targets) {
  const r = await report(l);
  if (r.errors) { console.log(`${l}: BROKEN — ${r.errors.join('; ')}`); defects++; continue; }
  if (r.note) { console.log(`${l}: ${r.note} — parity starts when the first shard is written`); continue; }
  for (const row of r.rows) {
    layersChecked++;
    const bad = row.stale.length + row.empty.length;
    if (bad) defects++;
    if (complete && row.gap.length) unfinished++;
    console.log(`${l} ${row.layer}  ${row.files.join(' + ')} — ${bad ? 'FAIL' : (complete && row.gap.length) ? 'INCOMPLETE' : 'ok'}`
      + `: ${row.shipped} shipped of ${row.asked} asked`
      + (row.gap.length ? `, ${row.gap.length} still English${complete ? ' (batch must be finished)' : ''}` : '')
      + (row.stale.length ? `, ${row.stale.length} not in English` : '')
      + (row.empty.length ? `, ${row.empty.length} left empty` : '')
      + (row.overlap.length ? `, ${row.overlap.length} already covered by an earlier layer` : ''));
    for (const k of row.stale.slice(0, 8)) console.log(`   stale:   ${k}`);
    for (const k of row.empty.slice(0, 8)) console.log(`   empty:   ${k}`);
    for (const k of row.gap.slice(0, 6)) console.log(`   gap:     ${k}  =  ${String(english[k]).slice(0, 64)}`);
    if (row.gap.length > 6) console.log(`   … ${row.gap.length - 6} more still English`);
  }
}
if (!layersChecked && !defects) {
  console.log('FAIL: no shard layer was compared — nothing in src/locales/<lang>/ to check');
  process.exit(1);
}
if (defects || (strict && unfinished)) {
  console.log(`FAIL: ${defects} shard layer(s) with defects, ${unfinished} layer(s) short of a finished batch`);
  process.exit(1);
}
console.log(`${targets.length} locale(s) compared against the list --emit would generate`
  + ` (${layersChecked} shard layer(s), ${defects} defect(s), ${unfinished} unfinished batch(es))`);
