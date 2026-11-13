#!/usr/bin/env node
// Static check: a dictionary key that JavaScript passes as an *option value* must not be translated.
//
//   node scripts/check-option-tokens.mjs              report, exit 1 on any finding
//   node scripts/check-option-tokens.mjs --selftest   prove the finder fires and is not vacuous
//
// Why this exists: `toLocaleDateString(locale(), { weekday: L('long', 'long'), … })` in the date
// calculator reads like a label — L() with a fallback, so the hardcoded-English sweep wrapped the
// string into the dictionary like any other visible text, and every machine translation dutifully
// turned it into "lang", "largo", "長格式". None of that is display text: it is an enum the Intl API
// validates, and an out-of-range value throws
//
//   RangeError: Value largo out of range for Intl.DateTimeFormat options property weekday
//
// which kills the whole panel, not one word of it. Nothing in the translation loop could see it: the
// value is short (so the copy-paste rule ignores it), it is a real key with a real English twin (so
// the dead-key rule is satisfied), coverage went *up*, and the built HTML is the same page as before
// except for one stat that never renders.
//
// So the rule is stated against the code rather than against the language: every dictionary call that
// sits in the value position of an options object handed to a formatting API is an option token, and
// the built dictionary must supply exactly the fallback the source wrote. The token list is extracted
// from the tool sources at check time, so a second occurrence in a new tool is covered without
// editing this file.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';

const selftest = process.argv.includes('--selftest');

// ---------------------------------------------------------------- source extraction
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    // [ \t\r] only: `\s` matches the newline *before* a comment, which would delete that line break
    // and shift every reported line number away from the source the finding points at
    .replace(/^[ \t\r]*\/\/.*$/gm, '');
}

// Balanced-slice from an open paren to its match, skipping strings and template literals so that a
// `(` or `{` inside text cannot end the slice early.
function sliceCall(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}
function skipString(src, start) {
  const q = src[start];
  for (let j = start + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j;
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') j = skipBraces(src, j + 1);
  }
  return src.length;
}
function skipBraces(src, start) {
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) return j; }
  }
  return src.length;
}

// The APIs that read an option value as an enum. `.format(` and `.formatToParts(` only count when
// they belong to an Intl formatter, so the constructor pattern is matched separately.
const FORMAT_CALL = /(?:\.(?:toLocaleDateString|toLocaleTimeString|toLocaleString)\s*\(|new\s+Intl\s*\.\s*[A-Za-z]+\s*\()/g;
// `weekday: L('long', 'long')` — an identifier key, then a dictionary call, inside that call list.
const OPTION_VALUE = /([A-Za-z][\w]*)\s*:\s*[Lt]\s*\(\s*'(\w+)'\s*,\s*'([^']*)'\s*\)/g;

// One file → the option tokens it uses. Kept as a pure function so the selftest can feed it samples.
function extractTokens(src, file) {
  const clean = stripComments(src);
  const out = [];
  const seen = new Set();
  let m;
  while ((m = FORMAT_CALL.exec(clean))) {
    const open = m.index + m[0].length - 1;
    const args = sliceCall(clean, open);
    for (const [, prop, key, fallback] of args.matchAll(OPTION_VALUE)) {
      const id = `${key}\u0000${fallback}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ key, prop, expected: fallback, file, line: clean.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

async function toolFiles() {
  const dirs = [join(ROOT, 'src', 'scripts'), join(ROOT, 'src', 'scripts', 'tools')];
  const files = [];
  for (const d of dirs) {
    for (const name of (await readdir(d, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name)) {
      if (!name.endsWith('.js')) continue;
      files.push(join(d, name));
    }
  }
  return files;
}

async function extractAll() {
  const tokens = [];
  for (const f of await toolFiles()) {
    tokens.push(...extractTokens(await readFile(f, 'utf8'), f.slice(ROOT.length + 1).replace(/\\/g, '/')));
  }
  return tokens;
}

// ---------------------------------------------------------------- verdict
// Mirrors src/scripts/lib.js `t()`: w → common → tool → cat, first defined value wins. That is the
// runtime's own order, so a token hiding in the chrome layer is found the same way the page finds it.
function resolve(dict, key) {
  for (const layer of ['w', 'common', 'tool', 'cat']) {
    const v = dict?.[layer]?.[key];
    if (v !== undefined && v !== null) return { layer, value: v };
  }
  return null;
}

export function judge({ locales, tokens }) {
  const findings = [];
  let compared = 0;
  for (const { locale, dict } of locales) {
    for (const tk of tokens) {
      const got = resolve(dict, tk.key);
      // a token no locale defines is the source's own fallback at runtime — correct, nothing to check
      if (!got) continue;
      compared++;
      if (String(got.value) !== tk.expected) {
        findings.push({
          locale, key: tk.key, prop: tk.prop, file: tk.file, line: tk.line,
          want: tk.expected, got: got.value, layer: got.layer
        });
      }
    }
  }
  return { findings, compared, tokens: tokens.length };
}

async function builtDict(locale) {
  const p = join(ROOT, 'dist', '_assets', `dict.${locale}.js`);
  if (!existsSync(p)) return null;
  const src = await readFile(p, 'utf8');
  const body = src.replace(/^\s*window\.__TH_DICT\s*=\s*/, '').replace(/;\s*$/, '');
  return new Function(`return (${body});`)();
}

// ---------------------------------------------------------------- selftest
if (selftest) {
  const F = 'x.js';
  const cases = [
    {
      name: 'a translated weekday token is a finding',
      src: `out.append(x.toLocaleDateString(locale(), { weekday: L('long', 'long'), month: L('long', 'long'), day: L('numeric', 'numeric') }));`,
      dict: { w: { long: 'lang', numeric: 'numeric' } }, want: 1
    },
    {
      name: 'the untranslated token is silent',
      src: `out.append(x.toLocaleDateString(locale(), { weekday: L('long', 'long'), day: L('numeric', 'numeric') }));`,
      dict: { w: { long: 'long', numeric: 'numeric' } }, want: 0
    },
    {
      name: 'an Intl constructor option is covered too, not only toLocale*',
      src: `new Intl.NumberFormat(locale(), { style: L('unitStyle', 'unit'), unit: L('unitLen', 'kilobyte') }).format(n)`,
      dict: { w: { unitStyle: 'Einheit', unitLen: 'kilobyte' } }, want: 1
    },
    {
      name: 'a dictionary call in a text position is not an option token',
      src: `el('span', { text: L('width', 'Breite') }); x.toLocaleString(locale());`,
      dict: { w: { width: 'Breite' } }, want: 0
    },
    {
      name: 'the same token inside a comment is not a call site',
      src: `// { weekday: L('long', 'lang') } was the old shape\nout.append(x.toLocaleString(locale()));`,
      dict: { w: { long: 'lang' } }, want: 0
    },
    {
      name: 'a token defined only in the chrome layer is still resolved (lib.js lookup order)',
      src: `x.toLocaleDateString(locale(), { month: L('long', 'long') });`,
      dict: { w: {}, common: { long: 'numérique' } }, want: 1
    },
    {
      name: 'a locale that never defines the token is silent (the fallback in code is used)',
      src: `x.toLocaleDateString(locale(), { month: L('long', 'long') });`,
      dict: { w: {} }, want: 0
    },
    {
      name: 'a brace inside an option value cannot truncate the slice before the token',
      src: `x.toLocaleDateString(locale(), { weekday: L('hint', 'if {0} then'), month: L('long', 'long') });`,
      dict: { w: { long: 'largo' } }, want: 1
    }
  ];
  let bad = 0;
  for (const c of cases) {
    const tokens = extractTokens(c.src, F);
    const r = judge({ locales: [{ locale: 'de', dict: c.dict }], tokens });
    const okCount = r.findings.length === c.want;
    const okCompared = c.want > 0 ? r.compared > 0 : true;
    if (!(okCount && okCompared)) {
      bad++;
      console.log(`  FAIL ${c.name}: expected ${c.want} finding(s), got ${r.findings.length} (${JSON.stringify(r.findings.map(f => f.got))}), tokens=${tokens.map(t => t.key).join(',')} compared=${r.compared}`);
    } else console.log(`  ok   ${c.name}`);
  }
  // a finding nobody can locate is a finding nobody fixes: the reported line has to point at the call
  // site in the *original* file, so validate it against the source rather than a hand-counted number
  const lineSrc = "const a = 1;\n\n// a comment, then a blank line\n\nx.toLocaleDateString(loc, { weekday: L('long', 'long') });\nconst z = 2;\n";
  const lineTok = extractTokens(lineSrc, F);
  const pointedAt = lineTok.length === 1 ? lineSrc.split('\n')[lineTok[0].line - 1] : '(nothing)';
  if (lineTok.length !== 1 || !pointedAt.includes('toLocaleDateString')) {
    bad++;
    console.log(`  FAIL reported line number: expected line 5 (the call site), got ${JSON.stringify(lineTok.map(t => [t.key, t.line]))} which is "${pointedAt}"`);
  } else console.log(`  ok   the finding points at line ${lineTok[0].line}, the line that actually holds the call`);

  // the counter-proof the other checks use: a check that stops working must not be able to report 0
  const real = await extractAll();
  const keys = new Set(real.map(t => t.key));
  if (!real.length) { console.error('  FAIL real extraction found no option token at all — the pattern no longer matches the source'); bad++; }
  if (!keys.has('long') || !keys.has('numeric')) {
    console.error(`  FAIL real extraction lost the known tokens (found: ${[...keys].join(',') || 'none'}) — calc.js no longer matches OPTION_VALUE`);
    bad++;
  }
  const mutated = judge({ locales: [{ locale: 'de', dict: { w: { long: 'long', numeric: 'numeric' } } }], tokens: real });
  const vacuous = judge({ locales: [{ locale: 'de', dict: { w: { long: 'lang', numeric: 'numeric' } } }], tokens: [] });
  if (mutated.findings.length) {
    console.error(`  FAIL the real token list reports a finding against a correct dictionary (${JSON.stringify(mutated.findings)})`); bad++;
  }
  if (vacuous.compared !== 0) {
    console.error('  FAIL an empty token list still compared something'); bad++;
  }
  console.log(`\n  real source: ${real.length} option token(s) [${[...keys].join(', ')}], ${mutated.compared} comparison(s) against a correct dictionary`);
  if (!cases.length) { console.error('EMPTY RUN: the selftest has no cases'); process.exit(1); }
  if (bad) { console.error(`\nselftest: ${bad} case(s) wrong\n`); process.exit(1); }
  console.log(`\nselftest: ${cases.length + 1} case(s) pass and the real extraction still bites\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- run
const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));
const tokens = await extractAll();
if (!tokens.length) {
  console.error('EXTRACTION RETURNED NOTHING: no dictionary call was found in an Intl option position.');
  console.error('Either the pattern is wrong or the tools changed shape; a silent pass here would be a blind check.');
  process.exit(1);
}
const locales = [];
const missing = [];
for (const l of cfg.locales) {
  const dict = await builtDict(l);
  if (!dict) { missing.push(l); continue; }
  locales.push({ locale: l, dict });
}
if (!locales.length) {
  console.error(`NO BUILT DICTIONARIES in dist/_assets (looked for ${cfg.locales.join(', ')}). Run node build.mjs first.`);
  process.exit(1);
}
const { findings, compared } = judge({ locales, tokens });
console.log(`option tokens — ${tokens.length} token(s) [${tokens.map(t => t.key).join(', ')}] read from the tool sources, ${compared} dictionary value(s) compared against ${locales.length} built locale(s)`);
if (missing.length) console.log(`  (no dict for ${missing.join(', ')} — build those before trusting this run)`);
for (const f of findings) {
  console.log(`  FAIL ${f.locale}: ${f.file}:${f.line} passes { ${f.prop}: L('${f.key}', '${f.want}') } but dict.${f.layer}.${f.key} is "${f.got}"`);
}
if (findings.length) {
  console.error(`\n${findings.length} locale(s) would throw RangeError in a formatter. Option values are enum tokens: keep the English fallback in every locale file.`);
  process.exit(1);
}
console.log('  ok — every option value in the built dictionaries is the token the API expects');
