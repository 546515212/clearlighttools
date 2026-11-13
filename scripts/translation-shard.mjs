#!/usr/bin/env node
// Skeleton generator for the translation shards — the reason keys cannot be mistyped.
//
// A translator (person or model) who invents the JSON structure will eventually write "tools" where
// the loader wants "t", or "compressPdF" where the id is "compress-pdf", and the locale will quietly
// stay English. So this script writes the structure, fills it with the English, and leaves only the
// values to change. scripts/check-translations.mjs then decides whether the result is a translation.
//
//   node scripts/translation-shard.mjs --locale es                     what is missing, by layer
//   node scripts/translation-shard.mjs --locale es --emit w  --out src/locales/es/10-w.json
//   node scripts/translation-shard.mjs --locale es --emit t  --category pdf --out src/locales/es/20-t-pdf.json
//   node scripts/translation-shard.mjs --locale es --emit c  --out src/locales/es/05-c.json
//   node scripts/translation-shard.mjs --locale es --emit t --all-categories --prefix src/locales/es/2  # one file per category
//
// Already-supplied keys are skipped, so re-running after each batch only asks for what is left. An
// existing file is never overwritten without --force, and an empty request is an error rather than a
// silently empty file.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './lib-node.mjs';
import { leaves, localeSources, normaliseToolsDict, ownLayer, readJson, readJsonOr } from './lib-locale-layers.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const LOCALES = join(ROOT, 'src', 'locales');
const cfg = await readJson(join(ROOT, 'config', 'site.json'));
const tools = await readJson(join(ROOT, 'src', 'data', 'tools.json'));
const TOOL_IDS = new Set(tools.map(t => t.id));

const locale = opt('--locale', null);
if (!locale || !cfg.locales.includes(locale)) {
  console.error(`--locale must be one of ${cfg.locales.join(', ')}`);
  process.exit(1);
}

const enChrome = await readJson(join(LOCALES, 'en.json'));
const enTools = normaliseToolsDict(await readJson(join(LOCALES, 'en.tools.json')));
const titles = (await readJsonOr(join(LOCALES, 'titles.json'), {}))[locale] || {};
const english = leaves({ ...enChrome, w: enTools.w || {}, t: enTools.t || {} });

const { sources } = await localeSources(locale, { toolIds: TOOL_IDS });
const own = leaves(ownLayer(sources));
// titles.json is applied by the build but is not a locale layer, so its tool titles already show on
// the page — start a skeleton from them instead of asking for the same work twice
for (const [id, title] of Object.entries(titles)) {
  if (title) own[`t.${id}.title`] = own[`t.${id}.title`] || title;
  if (title) own[`t.${id}.h1`] = own[`t.${id}.h1`] || title;
}

const missingKeys = Object.keys(english)
  .filter(k => String(english[k] ?? '').trim() !== '')
  .filter(k => !(typeof own[k] === 'string' && own[k].trim() !== ''));

const layerOf = k => (k.startsWith('w.') ? 'w' : k.startsWith('t.') ? 't' : 'c');
const byLayer = { w: [], t: [], c: [] };
for (const k of missingKeys) byLayer[layerOf(k)].push(k);

// ---------------------------------------------------------------- list
if (!flag('--emit')) {
  console.log(`\n${locale}: ${missingKeys.length} of ${Object.keys(english).filter(k => String(english[k] ?? '').trim() !== '').length} English leaves still missing\n`);
  for (const layer of ['c', 'w', 't']) {
    const list = byLayer[layer];
    console.log(`  ${layer}  ${String(list.length).padStart(4)} ${layer === 't' ? 'missing keys by category:' : list.length ? `(${list.slice(0, 3).join(', ')}${list.length > 3 ? ' …' : ''})` : ''}`);
    if (layer === 't') {
      const cats = {};
      for (const k of list) { const id = k.split('.')[1]; const cat = tools.find(t => t.id === id)?.cat || '?'; cats[cat] = (cats[cat] || 0) + 1; }
      for (const [cat, n] of Object.entries(cats)) console.log(`        ${cat.padEnd(6)} ${n}`);
    }
  }
  console.log('\n  emit a skeleton:  --emit t --category pdf --out src/locales/' + `${locale}/20-t-pdf.json\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- emit
const layer = opt('--emit', '');
if (!['c', 'w', 't'].includes(layer)) { console.error(`--emit wants c, w or t (got "${layer}")`); process.exit(1); }
const category = opt('--category', null);
const max = Number(opt('--max', '0'));

let keys = byLayer[layer];
if (layer === 't' && !flag('--all-categories')) {
  if (!category) { console.error('--emit t needs --category <pdf|image|text|calc|media> or --all-categories'); process.exit(1); }
  keys = keys.filter(k => tools.find(t => t.id === k.split('.')[1])?.cat === category);
}
if (max > 0) keys = keys.slice(0, max);
if (!keys.length) { console.error(`EMPTY REQUEST: nothing left to translate for layer "${layer}"${category ? ` in ${category}` : ''}`); process.exit(1); }

// Rebuild the nested object for the requested keys, straight out of the English tables so the shape
// (the steps list, the faq pair objects) arrives correct and a translator only touches values.
const wanted = new Set(keys.map(k => (layer === 'c' ? k : k.slice(layer.length + 1))));
const under = path => { for (const k of wanted) if (k === path || k.startsWith(path + '.')) return true; return false; };
function build(node, path) {
  const out = Array.isArray(node) ? [] : {};
  for (const [k, v] of Object.entries(node ?? {})) {
    const p = path ? `${path}.${k}` : k;
    if (!under(p)) continue;
    out[k] = v && typeof v === 'object' ? build(v, p) : v;
  }
  return out;
}
const wrapped = layer === 'c' ? { c: build(enChrome, '') }
  : layer === 'w' ? { w: build(enTools.w || {}, '') }
    : { t: build(enTools.t || {}, '') };

const emitted = Object.keys(leaves(wrapped)).length;
if (emitted !== keys.length) {
  console.error(`BUILT ${emitted} leaf(ves) for ${keys.length} requested — the skeleton does not match the gap list, refusing to write`);
  process.exit(1);
}

const outPath = opt('--out', null);
if (!outPath) {
  console.log(JSON.stringify(wrapped, null, 2));
  console.error(`\n${keys.length} key(s) for ${locale} layer "${layer}" — write with --out src/locales/${locale}/NN-<layer>.json`);
  process.exit(0);
}
const abs = join(ROOT, outPath);
if (existsSync(abs) && !flag('--force')) { console.error(`REFUSING to overwrite ${outPath} — pass --force`); process.exit(1); }
await mkdir(dirname(abs), { recursive: true });
await writeFile(abs, JSON.stringify(wrapped, null, 2) + '\n');
console.log(`wrote ${keys.length} English key(s) to ${outPath}`);
console.log(`  replace the values, keep the keys, then run: node scripts/check-translations.mjs --locale ${locale}`);
