#!/usr/bin/env node
// Full-width punctuation in UI strings.
//
// Why this exists: two strings shipped with a U+FF0B fullwidth plus instead of an ASCII one — a
// label rendered as "standard 200.00 ＋ 50.00 extra" and a field called "＋ inches". They come from
// typing a label in an IME, and they are invisible in a screenshot: it looks like a plus.
//
// The rule is deliberately narrow. In Chinese, Japanese and Korean text ，。：；（） are correct
// typography and must not be flagged; in the other ten locales they are the same IME slip. The
// arithmetic-looking ones (＋ － ＝ ％) are wrong in every locale, including zh/ja/ko.
//
// Known limit, stated rather than papered over: this is a line scan, not a parser, so a
// full-width character inside a // comment counts too. That is acceptable because the fix is the
// same either way. Note this file itself is deliberately NOT scanned — the tables and the samples
// below have to contain the literal characters to detect them. --selftest is what keeps an empty
// bug list from meaning "nothing is checked any more".
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const ALWAYS = { '＋': 'U+FF0B fullwidth +', '－': 'U+FF0D fullwidth -', '＝': 'U+FF1D fullwidth =', '％': 'U+FF05 fullwidth %' };
const CJK_ONLY = { '：': 'U+FF1A fullwidth :', '；': 'U+FF1B fullwidth ;', '（': 'U+FF08 fullwidth (', '）': 'U+FF09 fullwidth )', '，': 'U+FF0C fullwidth ,' };

// names, not raw characters, so a caller reports what it found rather than printing it
function scannerFor(cjkLangs) {
  return function scanLine(line, lang) {
    const chars = lang && cjkLangs.has(lang) ? ALWAYS : { ...ALWAYS, ...CJK_ONLY };
    return Object.entries(chars).filter(([ch]) => line.includes(ch)).map(([, name]) => name);
  };
}
const CJK_LANGS = new Set(['zh', 'ja', 'ko']);
const scanLine = scannerFor(CJK_LANGS);

function sources() {
  const files = [];
  for (const f of readdirSync(join(ROOT, 'src', 'locales')).filter(f => f.endsWith('.json'))) {
    files.push({ path: join(ROOT, 'src', 'locales', f), lang: f.replace(/\..*$/, '') });
  }
  for (const dir of ['', 'tools']) {
    for (const f of readdirSync(join(ROOT, 'src', 'scripts', dir)).filter(f => f.endsWith('.js'))) {
      files.push({ path: join(ROOT, 'src', 'scripts', dir, f), lang: null });
    }
  }
  return files;
}

// The counter-proof. A checker whose bug list is empty has either fixed everything or stopped
// looking, and from the outside those are the same thing, so the samples below assert it bites.
const SAMPLES = [
  ['zh', '"inchesPlus": "+ 英寸"', []],                       // control: correct zh stays silent
  ['ja', '"a": "（テスト）：、"', []],                          // control: CJK punctuation is typography
  ['en', '"inchesPlus": "+ inches"', []],                     // control: ASCII is fine anywhere
  ['zh', '"inchesPlus": "＋ 英寸"', ['U+FF0B fullwidth +']],   // the real regression, in zh
  ['en', '"x": "＝ inches"', ['U+FF1D fullwidth =']],
  ['en', '"x": "Size（big）"', ['U+FF08 fullwidth (', 'U+FF09 fullwidth )']],  // only this one notices "en" going CJK-blind
  ['es', '"x": "pulgadas： más"', ['U+FF1A fullwidth :']],
  ['ko', '"x": "100％"', ['U+FF05 fullwidth %']]
];

function selftest() {
  let bad = 0;
  for (const [lang, line, want] of SAMPLES) {
    const got = scanLine(line, lang);
    const ok = want.every(w => got.includes(w)) && got.filter(g => !want.includes(g)).length === 0;
    if (!ok) { bad++; console.log(`  FAIL selftest [${lang}] expected [${want}] got [${got}]`); }
  }
  if (!SAMPLES.some(s => s[2].length)) {
    console.log('  FAIL selftest has no positive case — it cannot fail, so it proves nothing');
    return 1;
  }
  // The mutation that actually happened here: with 'en' added to the CJK list the scanner starts
  // ignoring fullwidth brackets in English and every original sample still passed, so the list
  // above was blind to its own main switch. A selftest must be able to see that.
  const blind = scannerFor(new Set(['en', 'zh', 'ja', 'ko']));
  const diffs = SAMPLES.filter(([lang, line]) => blind(line, lang).join() !== scanLine(line, lang).join());
  if (!diffs.length) {
    console.log('  FAIL selftest cannot tell the CJK/locale switch from its opposite — it is vacuous');
    return 1;
  }
  const caught = diffs.some(([lang, line]) => blind(line, lang).length < scanLine(line, lang).length);
  if (!caught) {
    console.log('  FAIL the mutation only adds findings; nothing asserts the locale switch narrows them');
    return 1;
  }
  console.log(`  selftest ok — ${SAMPLES.length} cases, ${SAMPLES.filter(s => s[2].length).length} must be caught, `
    + `and treating English as CJK-blind changes ${diffs.length} of them (so the switch is really tested)`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--selftest')) {
  // measure with the ruler only after proving the ruler: if the samples do not discriminate, a
  // clean scan means nothing, so stop there instead of printing a green line nobody can trust
  const rc = selftest();
  if (rc) process.exit(rc);
}

const strict = process.argv.includes('--strict');
const hits = [];
const files = sources();
for (const { path, lang } of files) {
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    for (const name of scanLine(line, lang)) {
      hits.push(`${path.replace(ROOT + '/', '')}:${i + 1}  ${name}  ${line.trim().slice(0, 80)}`);
    }
  });
}
console.log(`scanned ${files.length} source files for full-width punctuation`);
if (hits.length) {
  console.log(`  ${hits.length} hit(s):`);
  for (const h of hits) console.log('  ' + h);
  if (strict) process.exit(1);
} else {
  console.log('  ok — no full-width punctuation where an ASCII operator belongs');
}
