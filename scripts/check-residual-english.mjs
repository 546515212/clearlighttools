#!/usr/bin/env node
// English that a visitor reads on a page that is not in English.
//
//   node scripts/check-residual-english.mjs            # report every finding
//   node scripts/check-residual-english.mjs --strict   # exit 1 on any finding
//   node scripts/check-residual-english.mjs --selftest # prove the check can still see English
//   node scripts/check-residual-english.mjs --only zh,ja
//
// Why this exists, in the words of the bug that produced it: twelve locales shipped the date
// calculator as `30 days 後`, the loan table with a header reading `Paid in year`, the contrast tool
// grading a colour `fails WCAG`, and the password meter printing `very strong` — in Russian, in
// Japanese, in Malayalam. Every gate said 100 %. Coverage said 1450/1450. The placeholder, markup and
// parity checks all read dictionaries, and these strings were in no dictionary: they were template
// literals and array literals in the tool bundles, sent straight to the DOM without ever asking L().
// A string the code never requests from the translation layer is invisible to a check that only
// inspects the translation layer.
//
// So this reads the other artefact: what the page renders. scripts/smoke.mjs is asked, per locale, to
// dump every text node of every mounted panel (SMOKE_TEXT_DUMP), and the twelve non-English dumps are
// compared against the English one, tool by tool. A rendered string is a finding when the English page
// prints the same string, prints it with only its numbers written the local way, has the same Latin
// words sitting inside otherwise-translated text, or has an English value poured into a sentence the
// locale did translate. And the locale's own dictionary cannot account for it.
//
// The five rules exist because the first four holes were found one after another, each by a different
// locale: whole-string equality saw "Paid in year" but not "30 days 後"; the mixed-script rule saw
// "30 days 後" but not a German BMI band reading "Healthy 18,5 – 24,9", where the only difference from
// English is a comma instead of a dot; and neither saw "Basiseinheit: meter", where the sentence came
// from the dictionary and the word inside it came from the code.
//
// The fifth rule is not about English. It is the reason this sweep reads *rendered* strings at all: a
// panel that prints `null`, `NaN` or `[object Object]` is not a translation problem, it is a value that
// never existed reaching the DOM, and no dictionary, coverage bar or HTML-validity check can see it —
// `null` is a perfectly legal text node. Eight panels did this before it was fixed (see
// scripts/check-null-children.mjs), and they did it identically in all thirteen locales, which is
// exactly why comparing locales against each other missed it: the finding is not "different from
// English", it is "not a word in any language". So it is checked on the English page too.
//
// The dictionary is what makes this a check instead of a guess. If a word appears anywhere in the
// locale's shipped values — as a label, in prose, in an FAQ — the translators have accepted it as part
// of that language, so it is not residue: `Local` on the Spanish page, `Unix` in a Japanese timestamp
// line. What is left is English the code put there. KEEP_ENGLISH below covers the residue that is
// *meant* to stay: machine tokens, format names and MIME types that would be broken by translating
// them, each with the reason written down. It removes tokens from a string, never whole strings, so no
// entry here can hush a sentence.
//
// Known limits, stated rather than papered over:
//   - it judges rendered strings, so a string only reachable after the visitor supplies something real
//     (a file open, a checkbox ticked) is not on screen and is not checked here; the fixtures and the
//     browser report cover those paths;
//   - jsdom has no layout, so text inside a collapsed <details> is counted too — the safe direction;
//   - the panels are mounted from src/scripts/tools/*.js with the dictionaries built into
//     dist/_assets/dict.<l>.js, so a stale build means the *words* being judged are yesterday's.
//     `npm run check` builds first.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';
import { localeSources, ownLayer, leaves } from './lib-locale-layers.mjs';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const STRICT = has('--strict');
const SELFTEST = has('--selftest');

// The empty-run guard. A dump with fewer rows than this did not mount the panels — the smoke script
// moved, dist is stale, or a child died before writing — and a comparison against an empty site is
// trivially clean.
const MIN_ROWS = Number(opt('min-rows') || 700);
const MIN_TOOLS = Number(opt('min-tools') || 40);
// How many findings one locale prints. Reporting is unaffected; only the printout is capped, and
// triage wants the whole list, so the cap is a flag rather than a constant.
const LIMIT = Number(opt('limit') || 25);

// Planted by smoke.mjs under SMOKE_RESIDUAL_PROBE, in every locale the probe runs in. Nothing on a
// real page says this, so a run that does not report it is a run that stopped comparing.
const PROBE_TEXT = 'residue probe marker';
const PROBE_TOOL = '__residual_probe__';

// ---------------------------------------------------------------- what may stay English
// Matched against the string before its words are counted: the token is removed, and whatever English
// survives around it is still judged.
const KEEP_ENGLISH = [
  { why: 'all-caps abbreviations and codes: WCAG, RGB, CMYK, AAA, PDF, UTC', re: /\b[A-Z]{2,}\b/g },
  { why: 'hex: colour values, hashes, digests. Needs a digit inside, or "decade" and "facade" would be hushed as digests', re: /\b(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{6,}\b/g },
  { why: 'the support address in the privacy note', re: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g },
  { why: 'MIME and accept strings the tool hands the browser verbatim', re: /\b[a-z]+\/[a-z0-9.*+-]+/gi },
  { why: 'file extensions', re: /\.[A-Za-z0-9]{2,4}\b/g },
  { why: 'IANA timezone ids, printed as the platform reports them', re: /\b[A-Z][a-z]+(?:_[A-Z][a-z]+)*\/[A-Z][a-z]+(?:_[A-Z][a-z]+)*\b/g },
  { why: 'the code-style names the case converter demonstrates', re: /\b[a-z]+(?:_[a-z0-9]+)+\b|\b[a-z]+(?:-[a-z0-9]+)+\b/g },
  { why: 'the same names when they are mixed or upper case: PascalCase, CONSTANT_CASE — a programmer reads the format name, not the language', re: /\b(?:PascalCase|camelCase|CONSTANT_CASE|TitleCase|kebabCase|snake_case)\b/g },
  { why: 'the HTTP-date / RFC 1123 form the timestamp tool quotes back: the protocol spells the weekday and month in English, so a translator changing it breaks the answer', re: /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?=,| \d| \d{4})/g },
  { why: 'container, codec and markup names, shown as the format list', re: /\b(?:MP4|WebM|MOV|MKV|AVI|M4A|MP3|WAV|OGG|Opus|FLAC|AAC|GIF|PNG|JPEG|JPG|SVG|WEBP|TIFF|ICO|HEIC|BMP|[Bb]ase64|Markdown|HTML|JavaScript|TypeScript|JSON|CSS|QR|URL|GMT|UTF-8|ASCII|Wi-?Fi)\b/g },
  { why: 'an unfilled placeholder belongs to the other check', re: /\{\d+\}|\{[a-z]+\}/gi },
  { why: 'CSS colour functions, offered because they can be pasted into CSS verbatim', re: /\b(?:rgba?|hsla?|hwb|cmyk|lab|lch|oklch)\s*\([^)]*\)/gi },
  { why: 'the CSS named colour the picker answers with — the answer is a CSS keyword, not prose', re: /\b(?:black|white|silver|gray|grey|red|maroon|orange|gold|yellow|olive|lime|green|teal|cyan|blue|navy|purple|violet|pink|brown)\b/g },
  { why: 'sample rates and bitrates: kHz and kbps are written the same in every locale', re: /\b(?:kHz|MHz|GHz|kbps|Mbps|Gbps|dpi|ppi|fps)\b/gi },
  { why: 'named HTML entities, which the entity tool exists to show', re: /&[A-Za-z][A-Za-z0-9]{1,10};/g },
  { why: 'unit symbols the converter lists: ISO 80000 makes a symbol language-neutral, so psi, kcal, mmHg, tbsp, nmi stay as written', re: /\b(?:nmi|acre|knot|mph|min|cal|kcal|Wh|kWh|BTU|bar|atm|psi|mmHg|inHg|kgf|deg|rad|grad|turn|arcmin|arcsec|bit|kB|MB|GB|TB|KiB|MiB|GiB|TiB|cup|gal|fl|oz|qt|pt|tbsp|tsp|ha)\b/gi }
];
const stripKeep = s => KEEP_ENGLISH.reduce((acc, k) => acc.replace(k.re, ' '), s);

// A Latin word worth flagging: three letters or more, so "h", "MP" and "30" never qualify.
const WORD_RE = /[A-Za-z][A-Za-z'’-]{2,}/g;
const words = s => (stripKeep(s).match(WORD_RE) || []).map(w => w.toLowerCase());
// The same sentence with its numbers written the local way. A German BMI band reads
// "Healthy 18,5 – 24,9" where the English page reads "Healthy 18.5 – 24.9": whole-string equality
// cannot see it, because the decimal separator is different, and the mixed-script rule cannot see it
// either, because German is Latin. Reducing both to "healthy # – #" is what makes an untranslated
// label visible in a Latin-script language.
const skeleton = s => s.replace(/\d+(?:[.,]\d+)*/g, '#').replace(/\s+/g, ' ').trim();
// Any script that is not Latin: CJK, Cyrillic, Devanagari, Arabic, Thai, Greek, Hangul, Hebrew.
// \p{sc=Latin} is what makes Vietnamese ơ and Turkish ə count as Latin, which the old
// "code point below U+0250" version did not, and \p{sc=Common} keeps digits, % and the ellipsis from
// looking like a second alphabet.
const NON_LATIN = /[^\p{sc=Latin}\p{sc=Common}\s\p{P}\p{S}]/u;

// ---------------------------------------------------------------- the five rules
// rows: [{ tool, text }] for one locale; enByTool: the English dump, grouped by tool;
// supplied: the locale's dictionary matchers (exact values + {0} patterns);
// localeWords: every Latin word the locale ships somewhere.

// R5 — a value that does not exist, printed as if it were a word. Deliberately an exact whole-string
// match: `null` inside "nullable" or a "0 – null" range is not this bug, and a substring rule would
// hush or shout depending on prose. Anything a real UI legitimately shows stays out of the list.
const NOT_A_WORD = new Set(['null', 'undefined', 'NaN', 'Infinity', '-Infinity', '[object Object]', '[object Module]', '[object Array]']);
const NOT_A_WORD_RULE = 'a value, not a word';

/** R5 on its own, so the English page — which no other rule reads — is covered too. */
export const brokenValues = rows => rows
  .filter(r => NOT_A_WORD.has(String(r.text).trim()))
  .map(r => ({ tool: r.tool, text: r.text, rule: NOT_A_WORD_RULE, because: [String(r.text).trim()] }));

export function judge({ rows, enByTool, supplied, localeWords }) {
  const findings = [];
  for (const { tool, text } of rows) {
    const broken = brokenValues([{ tool, text }]);
    if (broken.length) { findings.push(...broken); continue; }
    const ws = words(text);
    if (!ws.length) continue;                                       // nothing Latin in it at all
    const enTexts = enByTool.texts.get(tool);
    const unexplained = () => ws.filter(w => !localeWords.has(w));
    // The translators shipped this exact string. It cannot be residue whatever it looks like.
    if (supplied.exact.has(text)) continue;
    // R1 — the panel prints the exact string the English page prints.
    // R3 — or the same string with its numbers written the local way, which is what an untranslated
    // label looks like in a language that uses a comma decimal separator.
    if (enTexts?.has(text) || enByTool.skeletons.get(tool)?.has(skeleton(text))) {
      const un = unexplained();
      if (un.length) {
        findings.push({ tool, text, rule: enTexts?.has(text) ? 'shown in English' : 'English apart from its numbers', because: un });
        continue;
      }
    }
    // R2 — English inside an otherwise translated sentence: "30 days 後". Only possible when the node
    // is not pure Latin, so this rule cannot fire on a language whose answer to "days" simply is
    // "days" — that case is R1's, and R1 needs the locale's dictionary to be silent about it.
    if (NON_LATIN.test(text)) {
      const enWords = enByTool.words.get(tool) || new Set();
      const inside = ws.filter(w => enWords.has(w) && !localeWords.has(w));
      if (inside.length) { findings.push({ tool, text, rule: 'English inside translated text', because: inside }); continue; }
    }
    // R4 — the sentence came from the dictionary but the value poured into {0} came from the code, and
    // the code had not been translated. The surrounding text is correct, so no rule above can see it.
    const hit = supplied.patterns.find(p => p.re.test(text));
    if (hit) {
      for (const arg of (text.match(hit.re) || []).slice(1)) {
        if (!arg || !enTexts?.has(arg)) continue;                   // not a chunk the English page shows
        const aw = words(arg).filter(w => !localeWords.has(w));
        if (aw.length) {
          findings.push({ tool, text, rule: 'English poured into a translated string', because: aw });
          break;
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------- reading the dumps
const parseDump = file => {
  const rows = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf('\t'), j = line.indexOf('\t', i + 1);
    if (j < 0) continue;
    rows.push({ tool: line.slice(i + 1, j), text: line.slice(j + 1) });
  }
  return rows;
};

const group = rows => {
  const texts = new Map();
  const byWord = new Map();
  const skeletons = new Map();
  for (const r of rows) {
    if (!texts.has(r.tool)) { texts.set(r.tool, new Set()); byWord.set(r.tool, new Set()); skeletons.set(r.tool, new Set()); }
    texts.get(r.tool).add(r.text);
    skeletons.get(r.tool).add(skeleton(r.text));
    for (const w of r.text.match(WORD_RE) || []) byWord.get(r.tool).add(w.toLowerCase());
  }
  return { texts, words: byWord, skeletons, size: texts.size, count: rows.length };
};

// A dictionary value is a pattern: "{0} 天" supplies "30 天". Read out of the locale's own built
// dictionary, never from a re-implementation of the layer merge.
//
// The patterns keep their capture groups on purpose. A value like "基本単位は{0}" is translated, and
// the checker is right to accept the sentence — but the thing poured into {0} comes from the code, and
// if the code hands it "meter" the visitor still reads one English word. So the match has to give the
// arguments back, not just say "this string came from a dictionary".
const valueMatchers = values => {
  const exact = new Set(values);
  const patterns = values.filter(v => /\{\d+\}/.test(v)).map(v => {
    const re = new RegExp('^' + v.split(/(\{\d+\})/)
      .map(part => /^\{\d+\}$/.test(part) ? '([\\s\\S]{1,80}?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('') + '$');
    return { value: v, re };
  });
  const test = text => exact.has(text) || patterns.some(p => p.re.test(text));
  return { exact, patterns, test };
};

// The locale's own contribution, from src/locales — deliberately NOT the built dist/_assets/dict.<l>.js.
// The built file is the merge of English under the locale, so every key a locale has not translated yet
// still carries its English value there; using it as the suppression source would hush exactly the
// finding this audit exists to make (it did: the first version of this file reported "0 English" on a
// German page whose BMI band still read "Healthy 18.5 – 24.9"). ownLayer() from lib-locale-layers.mjs is
// the same reader build.mjs and the coverage report use, so this is not a second implementation of the
// merge order — it is that merge order, stopped from falling through to English.
const dictCache = new Map();
async function readDict(locale) {
  if (dictCache.has(locale)) return dictCache.get(locale);
  const { sources, errors } = await localeSources(locale);
  if (errors.length) throw new Error(`${locale}: locale layers did not load — ${errors.join('; ')}`);
  const values = Object.values(leaves(ownLayer(sources))).filter(v => typeof v === 'string' && v);
  if (!values.length) throw new Error(`src/locales has no ${locale} strings at all — the audit would have `
    + 'nothing to suppress findings with, so every translated label would look like residue');
  const dict = {
    supplied: valueMatchers(values),
    words: new Set(values.flatMap(v => (v.match(WORD_RE) || []).map(w => w.toLowerCase())))
  };
  dictCache.set(locale, dict);
  return dict;
}

function dump(locale, probe = null) {
  const dir = mkdtempSync(join(tmpdir(), 'th-residual-'));
  const file = join(dir, `${locale}.tsv`);
  const env = { ...process.env, SMOKE_TEXT_DUMP: file };
  if (probe) env.SMOKE_RESIDUAL_PROBE = probe;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'smoke.mjs'), '--clicks', '--locale', locale],
    { encoding: 'utf8', env });
  if (r.status !== 0 || !existsSync(file)) {
    throw new Error(`smoke.mjs --locale ${locale} failed (exit ${r.status}) — the residual audit cannot `
      + `judge a site that will not mount:\n${(r.stdout || '') + (r.stderr || '')}`);
  }
  const rows = parseDump(file);
  rmSync(dir, { recursive: true, force: true });
  return rows;
}

// ---------------------------------------------------------------- counter-proof
// The rule is pure, so the sabotage can be synthetic and exact, and both directions are asserted: a
// real regression must be reported, and a correctly translated page must stay quiet.
const EN_ROWS = [
  { tool: 'calc', text: 'Paid in year' },
  { tool: 'calc', text: '30 days' },
  { tool: 'calc', text: 'Healthy 18.5 – 24.9' },
  { tool: 'calc', text: 'meter' },
  { tool: 'calc', text: 'Local' },
  { tool: 'calc', text: 'image/png' },
  { tool: 'calc', text: 'UTC' },
  { tool: 'text', text: 'Indent' }
];
const ZH = ['{0} 天', '已支付', '本地时间', '余额', '选择文件'];

// [what it proves, the locale's rendered rows, the locale's dictionary values, findings expected]
const SELFTEST_SAMPLES = [
  ['an untranslated label the English page also prints', [{ tool: 'calc', text: 'Paid in year' }], ZH, 1],
  ['the word null handed to the DOM, on a translated page', [{ tool: 'calc', text: 'null' }], ZH, 1],
  ['NaN where a number never computed', [{ tool: 'calc', text: 'NaN' }], ZH, 1],
  ['letters that merely spell null inside a word are not a null node', [{ tool: 'calc', text: 'nullable columns' }], ZH, 0],
  ['English inside a translated sentence', [{ tool: 'calc', text: '30 days 後' }], ZH, 1],
  ['the same label with a comma decimal separator, on a Latin-script page', [{ tool: 'calc', text: 'Healthy 18,5 – 24,9' }], ZH, 1],
  ['an English value poured into a translated string, in a Latin-script language', [{ tool: 'calc', text: 'Basiseinheit: meter' }], ['Basiseinheit: {0}'], 1],
  ['a correctly translated label', [{ tool: 'calc', text: '已支付' }], ZH, 0],
  ['a correctly translated label in a Latin-script language', [{ tool: 'calc', text: 'Gesund 18,5 – 24,9' }], ['Gesund {0} – {1}'], 0],
  ['a value the locale ships as a word, poured into a translated string', [{ tool: 'calc', text: 'Basiseinheit: meter' }], ['Basiseinheit: {0}', 'Meter'], 0],
  ['a string the locale chose to keep, because its dictionary supplies it', [{ tool: 'calc', text: 'Local' }], ['Local'], 0],
  ['a word the locale ships somewhere else', [{ tool: 'calc', text: '30 days 後' }], ['{0} days 後'], 0],
  ['an English word the locale also ships, poured in as a value', [{ tool: 'calc', text: '基本単位は Local' }], ['基本単位は{0}', 'Local'], 0],
  ['digits and units are not English', [{ tool: 'calc', text: '25.5 %' }], ZH, 0],
  ['a machine token is not English', [{ tool: 'calc', text: 'image/png' }], ZH, 0],
  ['an abbreviation is not English', [{ tool: 'calc', text: 'UTC 时间' }], ZH, 0],
  ['an unfilled placeholder belongs to the other check', [{ tool: 'calc', text: '{0} days' }], ZH, 0]
];

const runCase = (rows, values) => judge({
  rows,
  enByTool: group(EN_ROWS),
  supplied: valueMatchers(values),
  localeWords: new Set(values.flatMap(v => (v.match(WORD_RE) || []).map(w => w.toLowerCase())))
});

function selftest() {
  let bad = 0;
  let fired = 0;
  for (const [name, rows, values, want] of SELFTEST_SAMPLES) {
    const got = runCase(rows, values);
    if (got.length !== want) {
      bad++;
      console.log(`  FAIL selftest: ${name} — expected ${want} finding(s), got ${got.length}`
        + (got.length ? ` (${got.map(f => `${f.rule}: "${f.text}"`).join('; ')})` : ''));
    }
    if (got.length) fired++;
  }
  if (!fired) {
    console.log('  FAIL selftest reports nothing at all — a run that never fires proves nothing');
    return 1;
  }
  // The mutations this file was written for, one per rule. A judge that only compared whole strings
  // would report "Paid in year" and miss five of the cases above, so each of the other four rules has to
  // be credited by name with the finding it made. The counts alone cannot do that: two of these rules
  // overlap on purpose, so a sample that still reports "1 finding" may be answered by the wrong one.
  const byRule = [
    ['English inside translated text', [{ tool: 'calc', text: '30 days 後' }], ZH],
    ['English apart from its numbers', [{ tool: 'calc', text: 'Healthy 18,5 – 24,9' }], ZH],
    ['English poured into a translated string', [{ tool: 'calc', text: 'Basiseinheit: meter' }], ['Basiseinheit: {0}']],
    ['a value, not a word', [{ tool: 'calc', text: '[object Object]' }], ZH]
  ];
  for (const [rule, rows, values] of byRule) {
    const got = runCase(rows, values);
    if (got.length !== 1 || got[0].rule !== rule) {
      console.log(`  FAIL "${rule}" is not caught by the rule it exists for (got `
        + `${got.length ? got.map(f => f.rule).join(' + ') : 'nothing'})`);
      return 1;
    }
  }
  // brokenValues() is the same rule seen from the other side of the comparison: it is what reads the
  // English page, which no other rule in this file looks at. If it quietly stopped working, the base
  // language could print "null" on every panel and the twelve translated sweeps would all report clean.
  const enSide = brokenValues([{ tool: 'calc', text: 'null' }, { tool: 'calc', text: 'not null at all' }]);
  if (enSide.length !== 1 || enSide[0].text !== 'null') {
    console.log(`  FAIL the English-side value scan returned ${enSide.length} finding(s) from a page that `
      + 'prints one null and one honest sentence');
    return 1;
  }
  console.log(`  selftest ok — ${SELFTEST_SAMPLES.length} cases, ${fired} must fire and ${SELFTEST_SAMPLES.length - fired} `
    + 'must stay silent; each of the five rules is credited with its own case: whole-string equality catches '
    + '"Paid in year", the mixed-script rule "30 days 後", the number skeleton "Healthy 18,5 – 24,9", the '
    + 'placeholder-argument rule "Basiseinheit: meter" and the not-a-word rule "[object Object]"');
  return bad ? 1 : 0;
}

if (SELFTEST) {
  // measure with the ruler only after proving the ruler
  const rc = selftest();
  if (rc) process.exit(rc);
}

// ---------------------------------------------------------------- run
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'site.json'), 'utf8'));
const picked = (opt('only') || '').split(',').filter(Boolean);
const targets = cfg.locales.filter(l => l !== 'en' && (!picked.length || picked.includes(l)));
if (!targets.length) {
  console.log('  FAIL no locale matched --only, so nothing would be checked');
  process.exit(1);
}

const enRows = dump('en');
const base = group(enRows);
if (base.count < MIN_ROWS || base.size < MIN_TOOLS) {
  console.log(`  FAIL the English dump is ${base.count} row(s) over ${base.size} tool(s); expected at least `
    + `${MIN_ROWS} over ${MIN_TOOLS}. Nothing is being compared, so nothing could be reported.`);
  process.exit(1);
}
// The base language is compared against nothing, so the one rule that does not need a comparison is
// run on it directly: a page printing "null" is broken in English too, and the twelve locale sweeps
// would each find the string "identical to English" and stay silent about it.
const enBroken = brokenValues(enRows);
if (enBroken.length) {
  console.log(`  FAIL the English pages render ${enBroken.length} value(s) that are not words: `
    + enBroken.map(f => `${f.tool} "${f.text}"`).join(', '));
  if (STRICT) process.exit(1);
}

// End-to-end proof on the real pipeline: plant the phrase, require the report to name it. Two extra
// mounts is cheap, and it is the only thing here that separates "clean site" from "the comparison
// stopped working" — the row guard above cannot see that, because a stale dump can still be long.
// The probe panel plants a second thing: a literal `null` handed to a native child call, which is how
// the eight broken panels did it. Both halves have to come back, on both sides of the comparison.
const probeTarget = targets[0];
const enProbeRows = dump('en', PROBE_TEXT);
const probeEn = group(enProbeRows);
const probeDict = await readDict(probeTarget);
const probeRows = dump(probeTarget, PROBE_TEXT);
const probeFindings = judge({
  rows: probeRows,
  enByTool: probeEn,
  supplied: probeDict.supplied,
  localeWords: probeDict.words
});
const planted = probeFindings.filter(f => f.tool === PROBE_TOOL && f.text === PROBE_TEXT);
if (!planted.length) {
  console.log(`  FAIL the planted English ("${PROBE_TEXT}") was not reported on the ${probeTarget} page — `
    + 'this audit is blind today, whatever the numbers below say');
  process.exit(1);
}
const plantedNull = probeFindings.filter(f => f.tool === PROBE_TOOL && f.rule === NOT_A_WORD_RULE);
if (plantedNull.length !== 1) {
  console.log(`  FAIL the panel that appends a null to itself reported ${plantedNull.length} not-a-word `
    + 'finding(s) on the ' + probeTarget + ' probe; it must report exactly one, and `null` is the only '
    + 'thing the probe panel appends that is not a string');
  process.exit(1);
}
const enProbeNull = brokenValues(enProbeRows);
if (enProbeNull.length !== 1) {
  console.log('  FAIL the English-side value scan did not see the planted null either '
    + `(${enProbeNull.length} finding(s) from the probe mount) — the base language is unchecked`);
  process.exit(1);
}

let total = enBroken.length;
const lines = [];
for (const locale of targets) {
  const rows = dump(locale);
  if (rows.length < MIN_ROWS) {
    lines.push(`  FAIL ${locale}: ${rows.length} rendered string(s), below the ${MIN_ROWS} this audit needs `
      + 'to mean anything');
    total++;
    continue;
  }
  const dict = await readDict(locale);
  const findings = judge({ rows, enByTool: base, supplied: dict.supplied, localeWords: dict.words });
  const uniq = [...new Map(findings.map(f => [`${f.tool}\u0000${f.text}`, f])).values()];
  total += uniq.length;
  const notWords = uniq.filter(f => f.rule === NOT_A_WORD_RULE).length;
  lines.push(`  ${locale.padEnd(3)} ${String(rows.length).padStart(4)} rendered string(s), `
    + `${uniq.length - notWords} still English`
    + (notWords ? `, ${notWords} rendered value(s) that are not words` : ''));
  for (const f of uniq.slice(0, LIMIT)) {
    lines.push(`      ${f.tool} · ${f.rule} · "${f.text}"  [${f.because.join(', ')}]`);
  }
  if (uniq.length > LIMIT) lines.push(`      … ${uniq.length - LIMIT} more (${locale})`);
}

console.log(lines.join('\n'));
console.log(`\nchecked ${targets.length} locale(s) against ${base.count} English strings; both planted `
  + `findings (English and a null child) reported as expected on ${probeTarget} and on the English page`);
if (total) {
  console.log(`\n  ${total} finding(s): English on a translated page, or a value that is not a word (${enBroken.length} on the English page).`);
  if (STRICT) process.exit(1);
} else {
  console.log('  ok — every rendered string on a translated page is its own language or a machine token, '
    + 'and no page in any locale renders null / NaN / [object Object]');
}
