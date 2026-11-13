#!/usr/bin/env node
// Translation gap report.
// Reads config/site.json + src/locales/*.json the same way build.mjs does, then lists, per
// locale, which English leaf strings still have no local value. Run it with `npm run check`
// or on its own:  node scripts/i18n-report.mjs            -> summary + first gaps
//                 node scripts/i18n-report.mjs --all      -> every missing key
//                 node scripts/i18n-report.mjs --csv      -> locale,key,english  (spreadsheet)
//                 node scripts/i18n-report.mjs --locale zh --all
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leaves, localeSources, normaliseToolsDict, ownLayer, readJsonOr } from './lib-locale-layers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => join(ROOT, ...a);
const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const cfg = JSON.parse(await readFile(P('config', 'site.json'), 'utf8'));
const toolsData = JSON.parse(await readFile(P('src', 'data', 'tools.json'), 'utf8'));
const TOOL_IDS = new Set(toolsData.map(t => t.id));
const L = f => P('src', 'locales', f);

// The English tables, flattened the way the build and the checker flatten them. Leaves are walked
// down to their sentences — an array (the how-to steps) or an object (the faq pairs) is many strings
// to a translator, not one blob.
const en = await readJsonOr(L('en.json'), {});
const enTools = normaliseToolsDict(await readJsonOr(L('en.tools.json'), {}));
const enLeaves = leaves({ ...en, t: enTools.t, w: enTools.w });
// an English value that is empty or only whitespace has nothing to translate
const keys = Object.keys(enLeaves).filter(k => String(enLeaves[k] ?? '').trim() !== '');

const titles = await readJsonOr(L('titles.json'), {});
const TARGET = opt('--locale', null);
const locales = TARGET ? [TARGET] : cfg.locales;

const rows = [];
const summary = [];

for (const l of locales) {
  // every layer the locale owns — <l>.json, <l>.tools.json and the src/locales/<l>/ shards — loaded
  // through the same table build.mjs uses, so a shard always moves this number
  const { sources, errors } = await localeSources(l, { toolIds: TOOL_IDS });
  if (errors.length) console.error(`  ${l}: ${errors.join('; ')}`);
  const ownLeaves = leaves(ownLayer(sources));
  // only a non-empty string counts as translated: a key that exists with "" or null is a hole,
  // not a translation (that is what the comment above promises)
  const have = new Set(Object.keys(ownLeaves).filter(k => typeof ownLeaves[k] === 'string' && ownLeaves[k].trim() !== ''));
  // titles.json only covers the visible headline/title pair; count those as translated,
  // because that is exactly what the built page shows for the rest of the tool copy.
  const ov = titles[l] || {};
  for (const id of Object.keys(enTools.t)) if (ov[id]) have.add(`t.${id}.title`).add(`t.${id}.h1`);

  const missing = keys.filter(k => !have.has(k));
  const pct = Math.round(((keys.length - missing.length) / keys.length) * 100);
  summary.push({ locale: l, name: cfg.localeNames[l] || l, total: keys.length, done: keys.length - missing.length, pct, missing });
  for (const k of missing) rows.push([l, k, String(enLeaves[k] ?? '')]);
}

const worst = [...summary].sort((a, b) => a.pct - b.pct);
console.log(`\nTranslation gaps — ${keys.length} English strings per locale\n`);
console.log('  lang  name              done  total   pct   missing chrome / missing tool copy');
for (const s of summary) {
  const chrome = s.missing.filter(k => !k.startsWith('t.') && !k.startsWith('w.')).length;
  const tools = s.missing.length - chrome;
  const bar = '█'.repeat(Math.round(s.pct / 5)).padEnd(20, '·');
  console.log(`  ${s.locale.padEnd(4)}  ${(s.name || '').padEnd(16)}  ${String(s.done).padStart(4)}  ${s.total}  ${String(s.pct).padStart(3)}%  ${String(chrome).padStart(4)} / ${String(tools).padStart(4)}   ${bar}`);
}

if (flag('--csv')) {
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  console.log('\nlocale,key,english');
  for (const [l, k, v] of rows) console.log([l, k, v].map(esc).join(','));
} else if (flag('--all')) {
  for (const s of worst) {
    if (!s.missing.length) continue;
    console.log(`\n${s.locale} (${s.name}) — ${s.missing.length} missing`);
    for (const k of s.missing) console.log(`  ${k}  =  ${enLeaves[k]}`);
  }
} else {
  const first = worst.find(s => s.missing.length);
  if (first) {
    console.log(`\nNext up: ${first.locale} (${first.name}) — ${first.missing.length} strings still English.`);
    for (const k of first.missing.slice(0, 12)) console.log(`  ${k}  =  ${enLeaves[k]}`);
    if (first.missing.length > 12) console.log(`  … ${first.missing.length - 12} more, use --all or --csv`);
  } else {
    console.log('\nEvery locale is complete.');
  }
  console.log('\nTip: a full chrome dictionary is src/locales/<lang>.json + <lang>.tools.json.');
  console.log('     src/locales/titles.json is the cheap layer (tool title + h1 only).\n');
}

// --strict makes CI fail while the weakest locale is still only a headline layer
const floor = flag('--strict') ? Number(opt('--strict', '60')) : 0;
if (Number.isFinite(floor) && floor > 0) {
  const bad = summary.filter(s => s.pct < floor);
  if (bad.length) {
    console.error(`\n--strict ${floor}%: ${bad.map(b => `${b.locale} ${b.pct}%`).join(', ')}\n`);
    process.exitCode = 1;
  }
}
