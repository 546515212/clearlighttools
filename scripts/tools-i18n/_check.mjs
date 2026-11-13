#!/usr/bin/env node
// Per-locale self-check for the second tools batch translations. Mirrors the structural rules in
// gen-tools-batch.mjs validate() plus the two known dictionary traps (pickerDefaultNames must be
// localised; city names must be in the target script for non-Latin locales), so a translator can
// confirm one file before all twelve exist. Not a build gate — the real gates run after the build.
//
//   node scripts/tools-i18n/_check.mjs zh
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib-node.mjs';

const locale = process.argv[2];
if (!locale) { console.error('usage: node scripts/tools-i18n/_check.mjs <locale>'); process.exit(2); }
const dir = join(ROOT, 'scripts', 'tools-i18n');
const src = JSON.parse(readFileSync(join(dir, '_source.json'), 'utf8'));
let d;
try { d = JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8')); }
catch (e) { console.error(`FAIL cannot read/parse ${locale}.json: ${e.message}`); process.exit(1); }

const tok = x => (String(x).match(/\{\d+\}/g) || []).sort().join();
const cps = s => [...String(s ?? '').trim()].length;
const NON_LATIN = /[^\u0000-\u024F\u1E00-\u1EFF]/;   // anything outside Latin extended = CJK/Cyrillic/Devanagari/etc.
const latinWords = s => (String(s).match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]{1,}/g) || []).filter(w => w.length > 1);
const bad = [], warn = [];

if (Object.keys(d).sort().join() !== 'kw,search,t,w') bad.push(`top-level keys must be exactly search,kw,w,t — got ${Object.keys(d).join(',')}`);

// widget keys
for (const k of src.w_keys) {
  if (!(k in (d.w || {}))) { bad.push(`missing w.${k}`); continue; }
  const v = d.w[k];
  if (typeof v !== 'string' || !v.trim()) { bad.push(`w.${k} empty/non-string`); continue; }
  if (tok(v) !== tok(src.en_w[k])) bad.push(`w.${k} placeholders ${tok(v)} != EN ${tok(src.en_w[k])}`);
  const enPct = ((src.en_w[k] || '').match(/\{\d+\}\s*%/g) || []).length;
  if (enPct && (v.match(/%/g) || []).length < enPct) bad.push(`w.${k} lost a % sign`);
}
for (const k of Object.keys(d.w || {})) if (!src.w_keys.includes(k)) bad.push(`extra w.${k} (stale)`);

// the two traps
if (d.w?.pickerDefaultNames === src.en_w.pickerDefaultNames) bad.push('w.pickerDefaultNames is byte-identical to English — replace the six sample names with local names (IDENTICAL gate)');
const nonLatinLocale = ['zh', 'ja', 'ko', 'ru', 'hi'].includes(locale);
if (nonLatinLocale) for (const k of src.w_keys.filter(x => x.startsWith('city'))) {
  if (d.w?.[k] && !NON_LATIN.test(d.w[k])) bad.push(`w.${k}="${d.w[k]}" must be written in the target script for ${locale} (residual-English gate)`);
}

// keywords
for (const p of src.kw_phrases) if (!String(d.kw?.[p] || '').trim()) bad.push(`missing kw "${p}"`);
for (const p of Object.keys(d.kw || {})) if (!src.kw_phrases.includes(p)) bad.push(`extra kw "${p}"`);

// search
if (!String(d.search || '').trim()) bad.push('missing search placeholder');
else if (!/69/.test(d.search)) warn.push(`search "${d.search}" should keep the number 69`);

// tool copy
for (const id of src.newIds) {
  const t = d.t?.[id], e = src.en_t[id];
  if (!t) { bad.push(`missing t.${id}`); continue; }
  if (cps(t.desc) > 170) bad.push(`${id}.desc ${cps(t.desc)}cp >170 HARD`);
  else if (cps(t.desc) > 160) warn.push(`${id}.desc ${cps(t.desc)}cp >160 soft`);
  if (cps(t.title) > 50) bad.push(`${id}.title ${cps(t.title)}cp >50`);
  if (!Array.isArray(t.steps) || t.steps.length !== 4) bad.push(`${id}.steps must be 4`);
  if (!Array.isArray(t.faq) || t.faq.length !== 2) bad.push(`${id}.faq must be 2 {q,a}`);
  const pairs = [['title', t.title, e.title], ['h1', t.h1, e.h1], ['desc', t.desc, e.desc], ['intro', t.intro, e.intro]];
  (t.steps || []).forEach((s, i) => pairs.push([`steps.${i}`, s, e.steps[i]]));
  (t.faq || []).forEach((f, i) => { pairs.push([`faq.${i}.q`, f.q, e.faq[i].q]); pairs.push([`faq.${i}.a`, f.a, e.faq[i].a]); });
  for (const [n, v, en] of pairs) {
    if (typeof v !== 'string' || !v.trim()) { bad.push(`${id}.${n} empty/non-string`); continue; }
    if (tok(v) !== tok(en)) bad.push(`${id}.${n} placeholders ${tok(v)} != EN ${tok(en)}`);
    if (v === en && latinWords(en).length >= 3) bad.push(`${id}.${n} byte-identical to English (IDENTICAL gate)`);
    // a fragment is a stub: prose must carry at least ~40% of the English length (THIN gate is median-based,
    // this is a cheap early warning, not the real rule)
    if (/^(intro|desc|faq)/.test(n) && cps(v) < cps(en) * 0.3) warn.push(`${id}.${n} looks short (${cps(v)} vs EN ${cps(en)}) — translate fully, do not summarise`);
  }
}

for (const w of warn) console.log(`  note ${w}`);
if (bad.length) { console.error(`FAIL ${locale} — ${bad.length} problem(s):`); for (const b of bad) console.error(`  ${b}`); process.exit(1); }
console.log(`OK ${locale} — ${src.w_keys.length} w, ${src.kw_phrases.length} kw, ${src.newIds.length} t, search present (${warn.length} note(s))`);