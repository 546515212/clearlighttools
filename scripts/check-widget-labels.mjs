#!/usr/bin/env node
// Does every authored widget label actually reach the built dictionary?
//
//   node scripts/check-widget-labels.mjs            # report
//   node scripts/check-widget-labels.mjs --strict   # exit 1 on any loss
//   node scripts/check-widget-labels.mjs --selftest # prove the check can see a loss
//
// Why this exists: build.mjs layers three sources for each locale — en.json (chrome), en.tools.json
// (the 418-key English widget `w` + per-tool `t`), and the locale's own files. The English widget
// table used to be merged *over* the locale layer, so 54 of the 56 field labels a locale authors in
// <locale>.json (`w`: width, height, format, quality, download, preview, …) were replaced by their
// English twins. Eleven of thirteen locales shipped "Width" / "Download" inside otherwise
// translated tool panels, and neither the coverage report (which counts chrome + tool copy, never
// the `w` layer) nor check-locale-leak.mjs (which compares titles and h1s) could see it.
//
// This is the general rule behind both bugs, stated once: whatever a locale author writes down must
// be what the built dictionary says. It compares the authored source files against dist/, so it
// fails on the merge order, not on a re-implementation of it.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localeSources } from './lib-locale-layers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const selftest = process.argv.includes('--selftest');

const read = async (...p) => JSON.parse(await readFile(join(ROOT, ...p), 'utf8'));
const cfg = await read('config', 'site.json');
// localeSources needs to tell a shard's `{ "compress-pdf": {…} }` bare tool map from a typo'd layer
// name; without the id list it can only reject.
const TOOL_IDS = new Set((await read('src', 'data', 'tools.json')).map(t => t.id));

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Flatten a dictionary layer to leaf paths, so "w.download" and "t.compressPdf.title" compare as
// strings and a nested object that got replaced wholesale shows up as one loss per leaf.
function leaves(obj, prefix = '', acc = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) leaves(v, key, acc);
    else acc[key] = v;
  }
  return acc;
}

// The layers the build reads for a locale — imported, not restated. This check used to carry its own
// two-file list (`<l>.json`, `<l>.tools.json`), which silently stopped covering every label supplied
// by a src/locales/<l>/ shard: the count stayed at 1012 with a shard added and without it. Only `w`
// is compared here: the titles/`t` layer is already asserted at page level by
// check-locale-leak.mjs, and this check exists because *nothing* watched the widget layer — the
// coverage report counts chrome + tool copy and never a single `w` key.
async function authoredLayers(locale, dir) {
  const { sources, errors } = await localeSources(locale, { toolIds: TOOL_IDS, dir });
  // the loader reports a broken shard instead of throwing, so that build.mjs can print every locale
  // problem in one pass — here a broken layer means the authored set is incomplete, and comparing an
  // incomplete set would look like a pass
  if (errors.length) throw new Error(`${locale}: ${errors.join('; ')}`);
  const out = [];
  for (const s of sources) {
    // a chrome layer keeps its widget labels in its own `w` block; a bulk layer or shard declares
    // them as the `w` key of the layer, which classifyLayer already lifted for us
    const widget = s.kind === 'chrome' ? s.raw.w : s.w;
    if (widget && Object.keys(widget).length) out.push({ file: s.file, widget });
  }
  return out;
}

// built dict file is `window.__TH_DICT = {…};` — evaluate it the way the page does rather than
// re-parsing, so a shape change in build.mjs surfaces as a comparison failure, not a crash
async function readBuilt(locale) {
  const p = join(ROOT, 'dist', '_assets', `dict.${locale}.js`);
  if (!existsSync(p)) return null;
  const src = await readFile(p, 'utf8');
  const body = src.replace(/^\s*window\.__TH_DICT\s*=\s*/, '').replace(/;\s*$/, '');
  return new Function(`return (${body});`)();
}

// One locale's verdict, computed from (authored widget blocks, built table) so the selftest can feed
// it a sabotage instead of trusting the real dist.
function judgeLocale({ locale, authored, built, enBase }) {
  // Fold the authored layers in build order into the table the built dictionary should equal. Two
  // files defining the same widget key is a tie the build resolves later-wins, so the expectation
  // has to resolve it the same way — otherwise the check would flag a correct build.
  const expected = new Map();
  for (const layer of authored) {
    for (const [key, value] of Object.entries(leaves(layer.widget))) {
      expected.set(key, { value, file: layer.file });
    }
  }
  const got = leaves(built?.w);
  const losses = [];
  const checked = [];
  for (const [key, { value, file }] of expected) {
    // a label identical to the English base is not a loss, but it is also not proof that the
    // merge worked — report the split so a locale that "translated" nothing still shows up
    const sameAsEnglish = String(enBase?.w?.[key] ?? '') === String(value);
    checked.push({ key, file, value, sameAsEnglish });
    if (got[key] === undefined) {
      losses.push({ key: `w.${key}`, why: 'missing from the built dictionary', expected: value, file });
    } else if (String(got[key]) !== String(value)) {
      losses.push({ key: `w.${key}`, why: 'the built dictionary says something else', expected: value, got: got[key], file });
    }
  }
  return { locale, losses, checked };
}

async function collect() {
  const enToolsRaw = existsSync(join(ROOT, 'src', 'locales', 'en.tools.json'))
    ? await read('src', 'locales', 'en.tools.json') : {};
  const enBase = { w: enToolsRaw.w ?? {} };
  const out = [];
  for (const locale of cfg.locales) {
    if (locale === 'en') continue;                     // English authored == English built, by definition
    const built = await readBuilt(locale);
    const verdict = judgeLocale({ locale, authored: await authoredLayers(locale), built, enBase });
    verdict.built = built;
    out.push(verdict);
  }
  return out;
}

// ---------------------------------------------------------------- selftest
// The check is worthless unless it fires. Feed it tables where a locale's own string loses, and
// require it to notice; then require it to stay quiet when nothing lost.
if (selftest) {
  const enBase = { w: { width: 'Width', download: 'Download' } };
  const authored = [{ file: 'de.json', widget: { width: 'Breite', download: 'Herunterladen' } }];
  const cases = [
    ['an English label that stamped over the locale is a loss',
      judgeLocale({ locale: 'de', authored, built: { w: { width: 'Width', download: 'Herunterladen' } }, enBase }),
      r => r.losses.length === 1 && r.losses[0].key === 'w.width' && r.losses[0].got === 'Width'],
    ['a label dropped entirely is a loss',
      judgeLocale({ locale: 'de', authored, built: { w: { width: 'Breite' } }, enBase }),
      r => r.losses.length === 1 && r.losses[0].why.includes('missing')],
    ['a clean merge passes',
      judgeLocale({ locale: 'de', authored, built: { w: { width: 'Breite', download: 'Herunterladen' } }, enBase }),
      r => r.losses.length === 0 && r.checked.length === 2],
    ['the check counts what it compared, so an empty table cannot look like a pass',
      judgeLocale({ locale: 'de', authored: [{ file: 'de.json', widget: {} }], built: { w: { width: 'Width' } }, enBase }),
      r => r.checked.length === 0],
    ['a locale that authored the same word as English is still compared, not skipped silently',
      judgeLocale({ locale: 'de', authored: [{ file: 'de.json', widget: { width: 'Width' } }], built: { w: { width: 'Width' } }, enBase }),
      r => r.losses.length === 0 && r.checked[0].sameAsEnglish === true],
    ['the last layer in the build order wins its tie, and the check knows that',
      judgeLocale({ locale: 'zh',
        authored: [{ file: 'zh.json', widget: { width: '宽', download: '下载' } },
                   { file: 'zh.tools.json', widget: { width: '宽度' } }],
        built: { w: { width: '宽度', download: '下载' } }, enBase }),
      r => r.losses.length === 0 && r.checked.length === 2],
    ['so the earlier layer is not mistaken for the answer',
      judgeLocale({ locale: 'zh',
        authored: [{ file: 'zh.json', widget: { width: '宽', download: '下载' } },
                   { file: 'zh.tools.json', widget: { width: '宽度' } }],
        built: { w: { width: '宽', download: '下载' } }, enBase }),
      r => r.losses.length === 1 && r.losses[0].key === 'w.width' && r.losses[0].expected === '宽度']
  ];
  let bad = 0;
  for (const [name, got, ok] of cases) {
    const pass = ok(got);
    if (!pass) bad++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` -> ${JSON.stringify(got.losses)}`}`);
  }
  // The mutation this whole file was written against: a label supplied by a src/locales/<l>/ shard is
  // authored text too, and the old two-file list could not see it — the compared count stayed at 1012
  // whether the shard existed or not. Build a fixture tree (never real src/locales) with one label per
  // layer kind and require all three to arrive.
  const fixture = join(ROOT, 'test-files', 'widgets-selftest', 'locales');
  await rm(fixture, { recursive: true, force: true });
  await mkdir(join(fixture, 'xx'), { recursive: true });
  const wjson = (o, p) => writeFile(p, JSON.stringify(o, null, 2), 'utf8');
  await wjson({ nav: { home: 'Start' }, w: { width: 'Breite' } }, join(fixture, 'xx.json'));
  await wjson({ w: { download: 'Herunterladen' } }, join(fixture, 'xx.tools.json'));
  await wjson({ w: { quality: 'Qualitaet' } }, join(fixture, 'xx', '10-w.json'));
  const layers = await authoredLayers('xx', fixture);
  const seen = layers.flatMap(x => Object.keys(x.widget));
  const want = ['width', 'download', 'quality'];
  const missing = want.filter(k => !seen.includes(k));
  if (missing.length) bad++;
  console.log(`  ${missing.length ? 'FAIL' : 'ok  '} every layer kind contributes its labels (chrome, bulk, shard)`
    + (missing.length ? ` -> ${missing.join(', ')} invisible to the check` : ` -> ${seen.length} label(s) seen`));
  // and the counter-proof of the counter-proof: pointed at an empty locale the same call must see
  // nothing, or "all three arrived" would just mean "the fixture path is hardcoded"
  const none = await authoredLayers('yy', fixture);
  if (none.length) { bad++; console.log('  FAIL the fixture leaked into a locale that has no files'); }
  else console.log('  ok  a locale with no authored files contributes nothing');
  await rm(join(ROOT, 'test-files', 'widgets-selftest'), { recursive: true, force: true });
  if (bad) { console.log(`selftest: ${bad} case(s) failed — this widget-label check cannot be trusted`); process.exit(1); }
  console.log(`selftest ok — ${cases.length + 2} cases: overwritten label, dropped label, clean merge, empty table, `
    + 'same-as-English, tie order both ways, and every layer kind (chrome / bulk / shard) reaching the comparison');
  // no exit: --selftest gates the real scan, it is not the deliverable
}

const results = await collect();

let losses = 0, compared = 0, englishish = 0, noDict = [];
for (const r of results) {
  compared += r.checked.length;
  losses += r.losses.length;
  englishish += r.checked.filter(c => c.sameAsEnglish).length;
  if (!r.built) noDict.push(r.locale);
  if (r.losses.length) {
    console.log(`${r.locale}: ${r.losses.length} authored label(s) did not survive the build`);
    for (const l of r.losses.slice(0, 6)) {
      console.log(`  ${l.key} (authored in ${l.file}): "${l.expected}" -> ${l.got === undefined ? '(absent)' : `"${l.got}"`}  [${l.why}]`);
    }
    if (r.losses.length > 6) console.log(`  … ${r.losses.length - 6} more`);
  }
}

if (noDict.length) {
  console.log(`FAIL: no built dictionary for ${noDict.join(', ')} — build did not run?`);
  process.exit(1);
}
if (!compared) {
  console.log('FAIL: compared nothing — no locale authored a w/t block, or src/locales moved');
  process.exit(1);
}

console.log(`widget labels — ${results.length} locales, ${compared} authored label(s) compared against dist/ (${englishish} happen to match English)`);
if (losses) {
  console.log(`FAIL: ${losses} authored label(s) lost to the English base layer`);
  if (strict) process.exit(1);
} else {
  console.log('every authored widget label is what the built dictionary says');
}
