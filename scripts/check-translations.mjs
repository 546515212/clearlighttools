#!/usr/bin/env node
// Translation checker: the gate the machine-translation sweep needs to be trustworthy.
//
// Filling src/locales/<l>/*.json shard by shard, by hand or by model, is exactly the situation where
// a silent mistake becomes a permanent English string on a live page. Five ways that happens, all of
// which look like success when you only eyeball the built page:
//
//   LAYER       a shard is not valid JSON, or nests its keys under a name the loader does not know
//               ("tools" instead of "t"), so it contributes nothing and the locale stays English
//   EMPTY-SHARD a shard parsed fine but supplied no leaf the build asked for — the shape is right and
//               the keys are wrong
//   DEAD-KEY    a key nobody reads: a typo ("compressPdF"), a key that was renamed in English, or a
//               layer put in the wrong namespace. Worse than a missing key, because it masks one
//   PLACEHOLDER "{0} pages" translated as "{1} pages" / "{0} page" / dropped entirely — the tool then
//               interpolates into a hole and the visitor sees "{0}" or "undefined"
//   TYPE        English holds a string and the locale holds an object or array: the template renders
//               "[object Object]"
//   IDENTICAL   a shard copied the English instead of translating it (only reported when the string
//               is a 3+ word phrase, because "Minimum"/"URL"/"Mode" are the same word in several
//               languages and are correct as written)
//   THIN        a sentence was answered with a fragment: the key is there, the language is right, the
//               placeholders survived — the translator just summarised instead of translating, so the
//               SEO description becomes four words and the intro one. Judged against the locale's OWN
//               median length (see the rule below), not against an absolute number.
//
// Usage:
//   node scripts/check-translations.mjs                all locales, exit 1 on any finding
//   node scripts/check-translations.mjs --locale es    one locale
//   node scripts/check-translations.mjs --selftest     fixture tree, one deliberately broken case per rule
//   node scripts/check-translations.mjs --permissive   findings become notes (coverage work in progress)
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';
import {
  leaves, localeSources, normaliseToolsDict, ownLayer, readJson, readJsonOr
} from './lib-locale-layers.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

// ---------------------------------------------------------------- rules
// A real tag: "<p>", "<br>", "<link rel=\"icon\" …>". NOT "<, >", which is how the html-entities
// description spells the two characters it escapes — matching that as markup demanded the translation
// reproduce a punctuation pair it had every right to reorder.
const TAG = /<\/?[a-zA-Z][^>]*>/g;
const PLACEHOLDER = /\{\d+\}/g;
const sorted = a => [...a].sort();
const multiset = (s, re) => sorted((String(s).match(re) || []));
// {0}/{1} are positional in English but a translator may legitimately reorder a sentence, so the
// comparison is a multiset of the tokens ("the same arguments must be present", not the same order).
const sameTokens = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// A word that carries meaning to be translated. Numbers, units, codec names and format tokens are
// filtered out because they stay English in every locale, and a phrase made only of them is not
// evidence of an untranslated string.
// The list is deliberately explicit: an early draft opened with a generic `[a-z][a-z0-9]*`
// alternative, which quietly matched every ordinary lowercase word — "files", "order", "choose" —
// and so made translatableWords() return nothing and the IDENTICAL rule never fire on any input.
// A rule that cannot fire is worse than no rule, because it reads as a pass.
const TECHNICAL_TOKEN = new Set(('px pt em rem ms sec min hr hz khz mhz ghz rpm fps wpm bpp dpi ppi kb mb gb tb kbps mbps kbps '
  + 'cm mm km m kg g mg lb oz t ft yd in mi mph kph ml cl dl l cal kcal kj wh whr ah va db nm '
  + 'jpg jpeg png webp gif bmp svg ico tiff tif heic avif raw psd webm mp4 mov avi mkv m4v m4a mp3 wav ogg oga opus flac aac amr '
  + 'pdf zip rar tar gz 7z txt csv tsv json xml yaml yml html htm css js ts md rtf epub mobi srt vtt '
  + 'utf-8 utf8 iso-8601 iso ascii unicode rgb rgba hsl hsla hsv lab cmyk hex base64 md5 sha sha1 sha2 sha256 sha512 sha3 crc '
  + 'url uri iri qr barcode ssid wpa wpa2 wep wep aes gcm cbc ctr pkcs1 pkcs8 rsa ecc ec ed25519 jwt uuid guid nanoid '
  + 'unix epoch utc gmt ist cet cest cet eest png8 gif87a gif89a lorem lorem ipsum ok id doi eeg cpu gpu ram rom srgb adobe-rgb p3 '
  + 'v1 v2 v3 v4 v7 v8 l m q h a b c d e f g p s t x y z w k j i o u').split(/\s+/));
export function translatableWords(s) {
  return (String(s).match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]{1,}/g) || [])
    .filter(w => w.length > 1 && !TECHNICAL_TOKEN.has(w.toLowerCase()) && !/^\d+[a-z]*$/i.test(w));
}

const CODE_ONLY = /<[a-zA-Z/][^>]*>|https?:\/\/|\{\{\{|\{\{|\bcode\b|node_module/i;

// ---------------------------------------------------------------- the THIN rule
// A stub is not a translation, and every rule above lets it through: the key exists, the value is in
// the right script, the placeholders are intact — the sentence was simply summarised. The only signal
// left is how much text arrived per unit of English, and that signal is language-shaped, so the
// threshold is each locale's own median rather than a constant. Measured over this dictionary:
// zh 0.31, ja 0.53, ko 0.56 (CJK really does carry an English sentence in half the characters),
// es/fr/de/pt/ru/vi/ms/id 1.05-1.23. An absolute cut at, say, 0.4 would have flagged 63 honest
// Chinese strings and added nothing; the median cut flags 0 in eleven locales and 85 in the one that
// was stubbed. The floor below is the counterweight: a median measured over a locale whose translations
// are *all* fragments would happily compare fragments with fragments, so a locale translating at under
// a fifth of English length is reported whole, whatever its own distribution says.
const PROSE = /\.(desc|intro|steps\.\d+|faq\.\d+\.[qa])$/;   // sentence-shaped keys only
const PROSE_WORDS = 8;      // English must be a sentence or more before its length means anything
const THIN_RATIO = 0.35;    // a leaf at a third of this locale's typical density is a fragment
const THIN_CAP = 0.45;      // …but never demand more than 45 % of English length
const THIN_FLOOR = 0.18;    // a locale whose median sits here is stubbed all the way down
const MIN_PROSE = 12;       // below this the sample is a partly translated locale, not a verdict
const clen = s => [...String(s ?? '').trim()].length;

/**
 * Compare one locale's supplied leaves against the English tree.
 * @returns findings: [{code, key, file, why, en, value}]
 */
export function verifyLocale({ english, own, sources, locale }) {
  const findings = [];
  const add = (code, key, file, why, en, value) => findings.push({ code, key, file, why, en, value, locale });

  // A file that could not be parsed or classified arrives as a LAYER finding from the loader, before
  // this function is called; here every layer that did load still has to prove it landed somewhere.
  for (const s of sources || []) {
    if (s.contributes === 0) {
      add('EMPTY-SHARD', s.file, s.file,
        `parsed, but none of its ${s.supplied} key(s) exist in the English dictionary — a wrong shape, an empty file or a wrong key name`, '', '');
    }
  }

  let supplied = 0;
  const prose = [];
  for (const [key, value] of Object.entries(own)) {
    const en = english[key];
    if (en === undefined) continue;                      // reported by the dead-key pass over keysOf(own)
    if (typeof value === 'string' && value.trim() === '') continue;   // a hole, not a translation: English shows
    supplied++;
    const file = sources?.find(s => s.has?.has(key))?.file || '';
    if (typeof en !== 'string') continue;               // both flattened the same way; nothing to compare

    if (PROSE.test(key) && translatableWords(en).length >= PROSE_WORDS) {
      const e = clen(en);
      prose.push({ key, en, value, file, ratio: e ? clen(value) / e : 1 });
    }

    const want = multiset(en, PLACEHOLDER), got = multiset(value, PLACEHOLDER);
    if (!sameTokens(want, got)) {
      add('PLACEHOLDER', key, file, `the English passes ${want.length ? want.join(' ') : 'no arguments'} and this string has ${got.length ? got.join(' ') : 'none'}`, en, value);
    }

    const wantTags = multiset(en, TAG), gotTags = multiset(value, TAG);
    const missingTags = wantTags.filter(t => !gotTags.includes(t));
    const extraTags = gotTags.filter(t => !wantTags.includes(t));
    if (missingTags.length || extraTags.length) {
      add('MARKUP', key, file, `${missingTags.length ? 'missing ' + missingTags.join(' ') + ' ' : ''}${extraTags.length ? 'added ' + extraTags.join(' ') : ''}(literal markup is code, not prose)`, en, value);
    }

    // A computed percentage ("{0}% of all words") that lost its % sign shows the visitor a bare
    // number as if it were a count. Only the placeholder-attached form is checked: "100% free" is
    // legitimately 完全免费 in Japanese, and demanding the glyph there was a false positive the very
    // first run found.
    const enPct = (en.match(/\{\d+\}\s*%/g) || []).length;
    if (enPct && (value.match(/%/g) || []).length < enPct) {
      add('PLACEHOLDER', key, file, `the English interpolates ${enPct} percentage(s) with a % sign and this string has ${(value.match(/%/g) || []).length}`, en, value);
    }

    if (value === en && translatableWords(en).length >= 3 && !CODE_ONLY.test(en)) {
      add('IDENTICAL', key, file, 'byte-identical to the English: the shard copied it instead of translating it', en, value);
    }
  }

  //                                            the THIN verdict
  // One pass over the locale's own prose to find its typical density, then one comparison per leaf.
  const ratios = prose.map(p => p.ratio).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = !ratios.length ? 0
    : ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  if (prose.length >= MIN_PROSE) {
    if (median < THIN_FLOOR) {
      add('THIN', `${locale}: whole locale`, '',
        `this locale translates at ${median.toFixed(2)} of English length across ${prose.length} sentence-shaped keys — that is not a language, it is stubs; a locale whose own median sits here can never be judged by its own median, so the floor ${THIN_FLOOR} is what caught it`, '', '');
    }
    const cut = Math.min(THIN_CAP, median * THIN_RATIO);
    for (const p of prose) {
      if (p.ratio >= cut) continue;
      add('THIN', p.key, p.file,
        `${clen(p.value)} characters where the English has ${clen(p.en)} (${(p.ratio * 100).toFixed(0)} %), and this locale's own median is ${(median * 100).toFixed(0)} % of English: the sentence was summarised, not translated`,
        p.en, p.value);
    }
  }

  // Keys the shard claims that English does not have. Two very different mistakes look the same from
  // here, so they are separated by shape: a supplied key that sits *on top of* English leaves
  // (t.merge-pdf.steps vs steps.0, steps.1) or *under* one is a nesting error — the template then
  // renders a string where it wants a list, or "[object Object]" where it wants a sentence. Anything
  // else is a key nobody reads.
  const enKeys = Object.keys(english);
  for (const key of Object.keys(own)) {
    if (english[key] !== undefined) continue;
    const file = sources?.find(s => s.has?.has(key))?.file || '';
    const child = enKeys.find(k => k.startsWith(key + '.'));
    const parent = enKeys.find(k => key.startsWith(k + '.'));
    if (child) add('TYPE', key, file, `English has a list or object here (${child}), this locale supplied one string`, child, own[key]);
    else if (parent) add('TYPE', key, file, `English has a single string at "${parent}", this locale put another layer under it`, parent, own[key]);
    else add('DEAD-KEY', key, file, 'no English string has this key, so no page ever reads it', '', own[key]);
  }
  return { findings, supplied, prose: { count: prose.length, median } };
}

/** Keys a locale layer claims, in the same dotted space as the English leaves. */
function sourceIndex(src, englishKeys) {
  const supplied = leaves({ ...(src.c ? { c: src.c } : {}), ...(src.w ? { w: src.w } : {}), ...(src.t ? { t: src.t } : {}) });
  const keys = Object.keys(supplied).map(k => k.replace(/^c\./, ''));
  const has = new Set(keys);
  src.has = has;
  src.supplied = keys.length;
  src.contributes = keys.filter(k => englishKeys.has(k)).length;
  return src;
}

// A did-you-mean for a typo'd key: same namespace, closest by shared prefix then length difference.
function suggest(key, englishKeys) {
  const ns = key.split('.').slice(0, 2).join('.');
  const pool = [...englishKeys].filter(k => k.startsWith(ns + '.') || k.split('.')[0] === key.split('.')[0]);
  if (!pool.length) return '';
  const target = key.toLowerCase();
  let best = pool[0], bestScore = -1;
  for (const cand of pool) {
    const c = cand.toLowerCase();
    let i = 0; while (i < Math.min(c.length, target.length) && c[i] === target[i]) i++;
    const score = i * 10 - Math.abs(c.length - target.length);
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

// ---------------------------------------------------------------- run
export async function run({ localesDir, cfg, localeFilter = null, toolIds = null } = {}) {
  const enChrome = await readJsonOr(join(localesDir, 'en.json'), {});
  const enTools = normaliseToolsDict(await readJsonOr(join(localesDir, 'en.tools.json'), {}));
  const english = leaves({ ...enChrome, w: enTools.w || {}, t: enTools.t || {} });
  const englishKeys = new Set(Object.keys(english).filter(k => String(english[k] ?? '').trim() !== ''));
  const translatable = [...englishKeys];

  const report = [];
  const allFindings = [];
  for (const l of (localeFilter ? [localeFilter] : cfg.locales).filter(x => x !== 'en')) {
    const { sources, errors } = await localeSources(l, { toolIds, dir: localesDir });
    const indexed = sources.map(s => sourceIndex(s, englishKeys));
    if (errors.length) for (const e of errors) {
      // every loader message is "path: reason" (see lib-locale-layers), so the finding carries the
      // file and the reason separately instead of printing the same sentence twice
      const at = e.indexOf(': ');
      allFindings.push({ code: 'LAYER', key: '', file: at > 0 ? e.slice(0, at) : '', why: at > 0 ? e.slice(at + 2) : e, en: '', value: '', locale: l });
    }
    const own = leaves(ownLayer(indexed));
    const { findings, supplied, prose } = verifyLocale({ english, own, sources: indexed, locale: l });
    report.push({ locale: l, sources: indexed.map(s => ({ file: s.file, kind: s.kind, contributes: s.contributes, supplied: s.supplied })), supplied, total: translatable.length, prose, findings });
    allFindings.push(...findings);
  }
  return { english, translatable, report, findings: allFindings };
}

// ---------------------------------------------------------------- selftest
// One fixture locale per rule, each broken on purpose. A rule that never fires on its own fixture is
// a rule that is not wired up, which is the only way any of this stays honest.
async function selftest() {
  const DIR = join(ROOT, 'test-files', 'translations-selftest', 'locales');
  await rm(join(ROOT, 'test-files', 'translations-selftest'), { recursive: true, force: true });
  await mkdir(DIR, { recursive: true });
  const put = async (p, o) => { await mkdir(join(DIR, p).replace(/[\\/][^\\/]*$/, ''), { recursive: true }); await writeFile(join(DIR, p), JSON.stringify(o, null, 2)); };

  await put('en.json', { nav: { home: 'Home' }, common: { pages: 'Pages', free: '100% free', rights: 'All rights reserved.' } });

  // Three tools whose every prose leaf is a real sentence, so the THIN rule has a sample to take a
  // median over: desc + intro + 2 steps + 2 faq lines = 6 leaves each, 18 in total.
  const PROSE_EN = {
    title: 'Merge several documents into one file',
    desc: 'Combine several separate documents into one single file in the order you choose yourself.',
    intro: 'Merging copies the page objects of each file into one document without rasterising them, so text stays selectable.',
    steps: ['Drop the files you want to work with into the panel on the left', 'Choose the order they should appear in and press the button'],
    faq: [
      { q: 'Does the merged file keep the original bookmarks and links?', a: 'Yes, both sets of references are rewritten so they still point at the right page.' },
    ],
  };
  const proseTools = {};
  for (const id of ['prose-a', 'prose-b', 'prose-c']) proseTools[id] = JSON.parse(JSON.stringify(PROSE_EN));

  // A value that is exactly `ratio` of the English length — the fixtures need to *be* a certain
  // density on purpose, not to read like prose.
  const fill = (en, ratio) => {
    const want = Math.max(4, Math.round([...String(en).trim()].length * ratio));
    return 'parola '.repeat(Math.ceil(want / 7)).slice(0, want).trim();
  };
  const proseShard = (ratios, { thinIndex = -1, thinRatio = 0.12 } = {}) => {
    const t = {};
    let i = 0;
    for (const id of ['prose-a', 'prose-b', 'prose-c']) {
      const e = proseTools[id];
      t[id] = {
        title: 'Unisc i file',
        desc: i++ === thinIndex ? fill(e.desc, thinRatio) : fill(e.desc, ratios[0]),
        intro: i++ === thinIndex ? fill(e.intro, thinRatio) : fill(e.intro, ratios[0]),
        steps: [i++ === thinIndex ? fill(e.steps[0], thinRatio) : fill(e.steps[0], ratios[1]),
          i++ === thinIndex ? fill(e.steps[1], thinRatio) : fill(e.steps[1], ratios[1])],
        faq: [{ q: i++ === thinIndex ? fill(e.faq[0].q, thinRatio) : fill(e.faq[0].q, ratios[2]),
          a: i++ === thinIndex ? fill(e.faq[0].a, thinRatio) : fill(e.faq[0].a, ratios[2]) }],
      };
    }
    return t;
  };

  await put('en.tools.json', {
    w: { pages: 'Pages', clipInfo: '{0} clip · {1} Hz', iconHint: 'Add <link rel="icon" href="a.png"> now', rate: 'Rate', percent: '{0}% versus {1}%' },
    t: { 'merge-pdf': {
      title: 'Merge PDF',
      intro: 'Combine several files in the order you chose.',
      steps: ['Drop the files you want to merge into the panel', 'Reorder them in whatever order you like'],
      faq: [{ q: 'Does the file leave my computer?', a: 'No. Everything runs in your browser.' }]
    }, ...proseTools }
  });

  const cases = [
    { name: 'LAYER: a shard that is not valid JSON at all', dir: 'badjson', raw: '{ "w": { "pages": "Pagina", }, }', want: { LAYER: 1 }, data: null },
    { name: 'a clean shard passes', dir: 'ok', want: {}, data: { t: { 'merge-pdf': { title: 'Joindre PDF', intro: 'Combinez plusieurs fichiers dans l’ordre choisi.' } }, w: { pages: 'Paginas', clipInfo: '{1}片段 · {0} Hz', iconHint: 'Ajoutez <link rel="icon" href="a.png"> maintenant', rate: 'Debit', percent: '{0}% versus {1}%' } } },
    { name: 'LAYER: a shard nested under a name the loader does not know', dir: 'shapelayer', want: { LAYER: 1 }, data: { tools: { 'merge-pdf': { title: 'x' } } } },
    { name: 'EMPTY-SHARD: right shape, every key misspelled', dir: 'emptyshard', want: { 'EMPTY-SHARD': 1, 'DEAD-KEY': 2 }, data: { t: { 'mergePdF': { title: 'x', intro: 'y' } } } },
    { name: 'DEAD-KEY: a key that does not exist in English', dir: 'deadkey', want: { 'DEAD-KEY': 1, 'EMPTY-SHARD': 0 }, data: { w: { pages: 'Seiten', noSuchLabel: 'Nicht hier' } } },
    { name: 'PLACEHOLDER: a dropped argument', dir: 'placeholder', want: { PLACEHOLDER: 1 }, data: { w: { clipInfo: 'clip of {0}', pages: 'P', rate: 'R', percent: '{0}% vs {1}%', iconHint: '<link rel="icon" href="a.png">' }, t: { 'merge-pdf': { title: 'T', intro: 'I' } } } },
    { name: 'PLACEHOLDER: an invented one', dir: 'placeholder2', want: { PLACEHOLDER: 1 }, data: { w: { clipInfo: '{0} {1} {2} clip', pages: 'P', rate: 'R', percent: '{0}% vs {1}%', iconHint: '<link rel="icon" href="a.png">' }, t: { 'merge-pdf': { title: 'T', intro: 'I' } } } },
    { name: 'MARKUP: the literal tag vanished', dir: 'markup', want: { MARKUP: 1 }, data: { w: { clipInfo: '{0} {1}', pages: 'P', rate: 'R', percent: '{0}% vs {1}%', iconHint: 'Ajoutez le lien maintenant' }, t: { 'merge-pdf': { title: 'T', intro: 'I' } } } },
    { name: 'PLACEHOLDER: an interpolated percent sign vanished', dir: 'percent', want: { PLACEHOLDER: 1 }, data: { w: { clipInfo: '{0} {1}', pages: 'P', rate: 'R', percent: '{0} versus {1}', iconHint: '<link rel="icon" href="a.png">' }, t: { 'merge-pdf': { title: 'T', intro: 'I' } } } },
    { name: 'PLACEHOLDER: a bare "100% free" may legitimately lose its % sign', dir: 'percentok', want: { PLACEHOLDER: 0, MARKUP: 0 }, data: { c: { common: { free: '完全無料' } } } },
    { name: 'TYPE: a string where English keeps the list of steps', dir: 'type', want: { TYPE: 1 }, data: { w: { clipInfo: '{0} {1}', pages: 'P', rate: 'R', percent: '{0}% vs {1}%', iconHint: '<link rel="icon" href="a.png">' }, t: { 'merge-pdf': { title: 'T', intro: 'I', steps: 'Déposez les fichiers puis fusionnez-les' } } } },
    { name: 'TYPE: an extra layer under a key that is a plain string in English', dir: 'type2', want: { TYPE: 1 }, data: { w: { clipInfo: '{0} {1}', pages: 'P', rate: 'R', percent: '{0}% vs {1}%', iconHint: '<link rel="icon" href="a.png">' }, t: { 'merge-pdf': { title: { text: 'T' }, intro: 'I' } } } },
    { name: 'IDENTICAL: a copied sentence, but not a copied unit', dir: 'identical', want: { IDENTICAL: 1 }, data: { w: { clipInfo: '{0} clip · {1} Hz', pages: 'Pages', rate: 'Rate', percent: '{0}% versus {1}%', iconHint: 'Add <link rel="icon" href="a.png"> now' }, t: { 'merge-pdf': { title: 'Merge PDF', intro: 'Combine several files in the order you chose.' } } } },
    { name: 'a value identical to English that is only units or markup is not a finding', dir: 'identicalok', want: { IDENTICAL: 0 }, data: { w: { clipInfo: '{0} clip · {1} Hz', pages: 'Pages', rate: 'Rate', percent: '{0}% versus {1}%', iconHint: 'Add <link rel="icon" href="a.png"> now' }, t: { 'merge-pdf': { title: 'Merge PDF', intro: 'Regroupez plusieurs fichiers dans l’ordre choisi.' } } } },
    { name: 'the array step of a tool is reachable', dir: 'arraystep', want: { IDENTICAL: 1, PLACEHOLDER: 0 }, data: { w: { clipInfo: '{0} {1}', pages: 'P', rate: 'R', percent: '{0}% {1}%', iconHint: '<link rel="icon" href="a.png">' }, t: { 'merge-pdf': { title: 'T', intro: 'I', steps: ['Déposez les fichiers dans le panneau', 'Reorder them in whatever order you like'] } } } },

    // THIN: one baseline that must stay silent and the mutation of it that must be caught. The pair is
    // the point — silence on its own cannot tell "nothing is stubbed" from "the rule is not wired up",
    // which is why every one of these also declares how many prose leaves it expects to have compared.
    { name: 'THIN baseline: a locale that translated every sentence at its normal density', dir: 'thinok', want: { THIN: 0 }, wantProse: 18, data: { t: proseShard([1.10, 1.05, 1.15]) } },
    { name: 'THIN: one sentence of the same locale answered with a fragment', dir: 'thin', want: { THIN: 1 }, wantProse: 18, data: { t: proseShard([1.10, 1.05, 1.15], { thinIndex: 4 }) } },
    { name: 'THIN: a compact language (0.30 of English everywhere) is not a finding', dir: 'thincjk', want: { THIN: 0 }, wantProse: 18, data: { t: proseShard([0.30, 0.28, 0.32]) } },
    { name: 'THIN: a locale stubbed all the way down is caught by the floor, not its own median', dir: 'thinall', want: { THIN: 1 }, wantProse: 18, data: { t: proseShard([0.10, 0.10, 0.10]) } },
    { name: 'THIN: a locale with too few sentences supplied is not judged at all', dir: 'thinfew', want: { THIN: 0 }, wantProse: 6, data: { t: { 'prose-a': proseShard([1.10, 1.05, 1.15])['prose-a'] } } },
  ];

  const toolIds = new Set(['merge-pdf', 'prose-a', 'prose-b', 'prose-c']);
  let bad = 0;
  for (const c of cases) {
    const l = c.dir;
    await mkdir(join(DIR, l), { recursive: true });
    if (c.raw !== undefined) await writeFile(join(DIR, l, '01-test.json'), c.raw);
    else await put(`${l}/01-test.json`, c.data);
    const { report, findings } = await run({ localesDir: DIR, cfg: { locales: [l] }, localeFilter: null, toolIds });
    const counts = {};
    for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
    const prose = report[0]?.prose?.count ?? 0;
    const okProse = c.wantProse === undefined || prose === c.wantProse;
    const ok = okProse && Object.entries(c.want).every(([code, n]) => (counts[code] || 0) === n);
    const unexpected = Object.entries(counts).filter(([code]) => !(code in c.want));
    if (!ok || unexpected.length) bad++;
    console.log(`  ${ok && !unexpected.length ? 'ok  ' : 'FAIL'} ${c.name}`
      + `\n        found ${JSON.stringify(counts)} want ${JSON.stringify(c.want)} prose=${prose}${c.wantProse !== undefined ? `(want ${c.wantProse})` : ''}${unexpected.length ? ` unexpected ${JSON.stringify(unexpected)}` : ''}`);
  }
  if (!cases.length) { console.error('EMPTY RUN: the selftest has no cases'); process.exit(1); }

  // The same rule against the real dictionary: proof that the pattern it reads is the shape the
  // project actually ships, not the shape the fixtures happen to invent. If a rename ever takes PROSE
  // off the real keys the count drops to zero and this fails, even though every fixture still passes.
  const realCfg = await readJson(join(ROOT, 'config', 'site.json'));
  const realTools = await readJson(join(ROOT, 'src', 'data', 'tools.json'));
  const { report: realReport } = await run({
    localesDir: join(ROOT, 'src', 'locales'), cfg: realCfg,
    toolIds: new Set(realTools.map(t => t.id)),
  });
  const realProse = realReport.reduce((n, r) => n + (r.prose?.count || 0), 0);
  const medians = realReport.map(r => `${r.locale} ${r.prose.median.toFixed(2)}`);
  if (!realProse) {
    console.error('  FAIL real dictionary: not one sentence-shaped key was compared — THIN is blind to the tree it polices');
    bad++;
  } else {
    console.log(`  ok   real dictionary: ${realProse} prose leaves compared across ${realReport.length} locale(s)`);
    console.log(`        medians (of English length): ${medians.join(', ')}`);
  }

  if (bad) { console.error(`\nselftest: ${bad} case(s) wrong\n`); process.exit(1); }
  console.log(`\nselftest: ${cases.length} fixture case(s), every rule fires on its own broken input\n`);
}

// ---------------------------------------------------------------- main
if (flag('--selftest')) { await selftest(); process.exit(0); }

const cfg = await readJson(join(ROOT, 'config', 'site.json'));
const toolsData = await readJson(join(ROOT, 'src', 'data', 'tools.json'));
const { report, findings, translatable } = await run({
  localesDir: join(ROOT, 'src', 'locales'), cfg, localeFilter: opt('--locale', null), toolIds: new Set(toolsData.map(t => t.id))
});

const permissive = flag('--permissive');
console.log(`\nTranslation check — ${translatable.length} English leaves, ${report.length} locale(s) inspected\n`);
for (const r of report) {
  const shards = r.sources.filter(s => s.kind === 'shard');
  console.log(`  ${r.locale}  ${String(r.supplied).padStart(4)}/${r.total} supplied  `
    + `${r.sources.length} layer file(s)` + (shards.length ? `, ${shards.length} shard(s)` : '')
    + `  prose ${String(r.prose?.count ?? 0).padStart(3)} @ ${(r.prose?.median ?? 0).toFixed(2)}×`
    + `  ${r.findings.length ? r.findings.length + ' FINDING(S)' : 'clean'}`);
  for (const s of r.sources) if (s.kind === 'shard') console.log(`           ${s.file}  ${s.contributes}/${s.supplied} keys land on a real English string`);
}

const byCode = {};
for (const f of findings) (byCode[f.code] ||= []).push(f);
for (const code of ['LAYER', 'EMPTY-SHARD', 'DEAD-KEY', 'TYPE', 'PLACEHOLDER', 'MARKUP', 'IDENTICAL', 'THIN']) {
  const list = byCode[code];
  if (!list) continue;
  console.log(`\n  ${code} — ${list.length}`);
  for (const f of list.slice(0, 40)) {
    console.log(`    ${f.locale} ${f.key}${f.file ? `  (${f.file})` : ''}`);
    console.log(`        ${f.why}`);
    if (f.en) console.log(`        en    ${JSON.stringify(String(f.en).slice(0, 110))}`);
    if (f.value !== '' && f.code !== 'DEAD-KEY') console.log(`        local ${JSON.stringify(String(f.value).slice(0, 110))}`);
    if (code === 'DEAD-KEY') { const s = suggest(f.key, new Set(translatable)); if (s) console.log(`        closest English key: ${s}`); }
  }
  if (list.length > 40) console.log(`    … ${list.length - 40} more`);
}

// The empty-run guard: a checker that inspected nothing is not a green light.
const inspected = report.length;
const layersSeen = report.reduce((n, r) => n + r.sources.length, 0);
const proseSeen = report.reduce((n, r) => n + (r.prose?.count || 0), 0);
if (!translatable.length) { console.error('\nEMPTY RUN: no English leaves were read — the dictionary path is wrong'); process.exit(1); }
if (!inspected) { console.error('\nEMPTY RUN: no locale was inspected'); process.exit(1); }
// THIN is the one rule that reads the *shape* of the data instead of single keys, so it can go blind
// two ways: no prose keys at all, or a key name change that stops PROSE from matching. Either leaves
// the count at zero while every other number keeps printing.
if (!proseSeen) { console.error('\nEMPTY RUN: no sentence-shaped key (.desc/.intro/.steps.N/.faq.N.q) was compared — the THIN rule is not reading the dictionary it is supposed to police'); process.exit(1); }
if (findings.length && !permissive) {
  console.error(`\n${findings.length} translation finding(s) in ${new Set(findings.map(f => f.locale)).size} locale(s).`);
  process.exit(1);
}
if (findings.length) console.log(`\n(${findings.length} finding(s) reported as notes because of --permissive)`);
else console.log('\n  ok — every locale layer is well-formed, every key lands on a real English string, and every placeholder and tag survived translation\n');
