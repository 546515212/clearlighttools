// Static check: t(key, fallback) takes the dictionary value when the key exists and the fallback
// only when it does not. So a call whose fallback says something different from the dictionary is a
// label that is quietly wrong on screen — the author of markdown-to-html wrote L('inputText',
// 'Markdown') and users read "Text to hash", because the shared key already meant that for
// hash-generator. This finds every one of those by comparing the two strings.
//
// A key used with several different fallbacks inside the tools is the same bug seen from the other
// side, so it is reported too.
//
//   node scripts/check-label-collisions.mjs            report only
//   node scripts/check-label-collisions.mjs --strict   exit 1 on a finding

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ROOT } from './lib-node.mjs';

const strict = process.argv.includes('--strict');

const en = JSON.parse(await readFile(join(ROOT, 'src', 'locales', 'en.json'), 'utf8'));
const enTools = JSON.parse(await readFile(join(ROOT, 'src', 'locales', 'en.tools.json'), 'utf8'));

// exactly the lookup order lib.js t() uses — w first, because that is the layer that wins on screen
const dict = { ...(en.cat || {}), ...(enTools.tool || {}), ...(en.common || {}), ...(enTools.w || {}) };

const files = [];
for (const dir of [join(ROOT, 'src', 'scripts'), join(ROOT, 'src', 'scripts', 'tools')]) {
  for (const f of await readdir(dir)) if (f.endsWith('.js')) files.push(join(dir, f));
}

const byKey = new Map();
const perFile = new Map();
for (const path of files) {
  const src = await readFile(path, 'utf8');
  const code = src.replace(/^[ \t]*\/\/.*$/gm, ' ');
  let hits = 0;
  for (const m of code.matchAll(/\b[Lt]\(\s*'([a-zA-Z][\w]*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) {
    const [, key, raw] = m;
    hits++;
    // the fallback in the source is escaped text ('a\nb'), the dictionary holds the string itself
    // ('a' newline 'b'), so comparing them raw called every multiline label a mismatch
    const fallback = raw.replace(/\\([nrt'\\"])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);
    const line = src.slice(0, src.indexOf(m[0], m.index)).split('\n').length;
    const entry = byKey.get(key) || [];
    entry.push({ file: relative(ROOT, path).replace(/\\/g, '/'), line, fallback });
    byKey.set(key, entry);
  }
  perFile.set(relative(ROOT, path).replace(/\\/g, '/'), hits);
}
// The four tool files are where the labels live. If one of them yields no call at all, the extractor
// has stopped matching the real source (a quoting change, a CRLF surprise) and every "ok" below it
// would be an empty run.
const silent = [...perFile].filter(([f, n]) => /tools\//.test(f) && n === 0);
if (silent.length) {
  console.error(`EMPTY RUN: no L()/t() call found in ${silent.map(([f]) => f).join(', ')} — the extractor is not matching the source`);
  process.exit(1);
}

const mismatch = [];
const orphan = [];
const shared = [];
for (const [key, uses] of byKey) {
  const value = dict[key];
  // A key the dictionary has never heard of renders its fallback forever, in every locale: the
  // string is invisible to the translation pass and silently stays English on the page. That is the
  // same bug as a mismatched fallback, only quieter, so it is a finding rather than a skip.
  if (value === undefined) { orphan.push({ key, uses }); continue; }
  const differs = uses.filter(u => u.fallback !== value);
  if (differs.length) mismatch.push({ key, value, uses: differs });
  const distinct = new Set(uses.map(u => u.fallback));
  if (distinct.size > 1) shared.push({ key, value, uses });
}

console.log(`checked ${byKey.size} dictionary keys used by the tools against ${Object.keys(dict).length} English strings`);
for (const o of orphan) {
  console.log(`  FAIL "${o.key}" is used but missing from the dictionary — it can never be translated:`);
  for (const u of o.uses) console.log(`         ${u.file}:${u.line}  fallback "${u.fallback}"`);
}
for (const m of mismatch) {
  console.log(`  FAIL "${m.key}" means "${m.value}" in the dictionary, but these call sites expect something else:`);
  for (const u of m.uses) console.log(`         ${u.file}:${u.line}  fallback "${u.fallback}"`);
}
for (const s of shared) {
  if (mismatch.some(m => m.key === s.key)) continue;
  console.log(`  note "${s.key}" is used with ${new Set(s.uses.map(u => u.fallback)).size} different fallbacks (${s.uses.map(u => `"${u.fallback}"`).join(', ')})`);
}
if (!mismatch.length && !shared.length && !orphan.length) console.log('  ok — every fallback agrees with the dictionary value');
if ((mismatch.length || orphan.length || (strict && shared.length)) && strict) process.exit(1);
