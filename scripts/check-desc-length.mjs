#!/usr/bin/env node
// How long is the SERP snippet, in the owner's per-script window? Every tool page puts a composed
// description in <meta name="description">. The ClearLight Tools contract is NOT one uniform cut-off:
//   EN tool desc      135-158 code points  (the owner's verb-opening copy, both bounds hard)
//   CJK tool desc      70-85 code points   (zh/ja/ko — keyword-first, both bounds hard)
//   other tool desc   <=160 code points    (es/fr/de/pt/ru/vi/ms/id/hi; <120 is a soft "short" note)
// A translation that arrives honest but 200 characters long is not a wrong translation, it is a
// description the search result never finishes; a CJK snippet at 120 is far past what a SERP shows.
//
//   node scripts/check-desc-length.mjs              all built locales, exit 1 outside the window
//   node scripts/check-desc-length.mjs --locale fr  one locale
//   node scripts/check-desc-length.mjs --selftest   in-memory rows, one case per verdict + counter-proofs
//
// The window is single-sourced from src/seo/compose.mjs (lengthVerdict) — the SAME function the build
// and check-tkd use — so this gate cannot drift from what the template actually composes. There is no
// --limit override: the windows are the owner's contract, not a tunable. Length is counted in code
// points, not UTF-16 units, so a Devanagari or CJK character counts once.
//
// This reads the built pages under `dist/`, not the source seeds, for the same reason the widget-label
// and locale checks do: the HTML a crawler fetches is the artifact that has to fit. Reading the seed
// would miss a build-time rewrite, an entity that inflates the attribute, or a locale never generated.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';
import { cps, CJK, lengthVerdict, EN_TOOL_DESC, CJK_TOOL_DESC, OTHER_DESC_MAX } from '../src/seo/compose.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = n => argv.includes(n);

// The attribute is HTML-escaped; a snippet is measured the way a crawler renders it.
const unescape = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Human-readable window for the report header, derived from the same constants the verdict uses.
export const windowLabel = l => CJK.has(l)
  ? `${CJK_TOOL_DESC.min}-${CJK_TOOL_DESC.max}`
  : l === 'en' ? `${EN_TOOL_DESC.min}-${EN_TOOL_DESC.max}` : `<=${OTHER_DESC_MAX}`;

// judge is pure: each row carries the locale + the built title/desc, and the verdict comes from the
// shared composer. Only the DESCRIPTION verdict is acted on here — title length is owned by check-tkd
// (T2) and check-tool-seo (TLEN); this gate is the dedicated SERP-snippet ruler with per-locale stats.
export function judge({ rows }) {
  const findings = [];
  for (const r of rows) {
    const v = lengthVerdict(r.locale, r.title, r.desc);
    const descNote = v.notes.find(n => n.startsWith('desc'));
    if (!v.descOk) findings.push({ locale: r.locale, tool: r.tool, len: v.dl, text: r.desc, why: descNote || `desc ${v.dl} outside the ${r.locale} window (${windowLabel(r.locale)})` });
    else if (descNote) findings.push({ locale: r.locale, tool: r.tool, len: v.dl, text: r.desc, soft: true, why: descNote });
  }
  return { findings, rows: rows.length };
}

export function metaDescription(html) {
  const m = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html);
  return m ? unescape(m[1]) : null;
}
export function pageTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return m ? unescape(m[1]).trim() : null;
}

/** Every built tool page that carries a description, with the title (for the verdict) and its length. */
export async function collect({ cfg, tools, locales }) {
  const rows = [];
  const missing = [];
  for (const l of locales) {
    for (const t of tools) {
      const p = join(ROOT, 'dist', l, t.cat, t.id, 'index.html');
      if (!existsSync(p)) { missing.push(`${l}/${t.cat}/${t.id}`); continue; }
      const html = await readFile(p, 'utf8');
      const desc = metaDescription(html);
      if (desc === null || !desc.trim()) { missing.push(`${l}/${t.cat}/${t.id} (no description)`); continue; }
      rows.push({ locale: l, tool: t.id, title: pageTitle(html) || '', desc, len: cps(desc) });
    }
  }
  return { rows, missing };
}

// ---------------------------------------------------------------- selftest
// The judge runs on in-memory rows, so a case can be wrong without touching a built page — and the
// parser runs on real HTML, because a changed attribute order in the template is exactly the failure
// that would otherwise turn this check green while it read nothing.
async function selftest() {
  // Build a row whose description is exactly `len` code points of `filler`, in `locale`.
  const row = (locale, len, filler = 'x', i = 0) => {
    const desc = filler.repeat(len);
    return { locale, tool: `t${i}`, title: 'Free Online X - y - ClearLight Tools', desc, len: cps(desc) };
  };
  const count = (locale, len, filler) => judge({ rows: [row(locale, len, filler)] });
  const hardOf = r => r.findings.filter(f => !f.soft).length;
  const softOf = r => r.findings.filter(f => f.soft).length;

  const cases = [
    { name: 'EN desc inside 135-158 is silent', rows: [row('en', 135), row('en', 146), row('en', 158)], hard: 0, soft: 0 },
    { name: 'EN desc below 135 / above 158 is hard', rows: [row('en', 134), row('en', 159)], hard: 2, soft: 0 },
    { name: 'CJK desc inside 70-85 is silent', rows: [row('zh', 70), row('ja', 77), row('ko', 85)], hard: 0, soft: 0 },
    { name: 'CJK desc below 70 / above 85 is hard', rows: [row('zh', 69), row('ja', 86)], hard: 2, soft: 0 },
    { name: 'other desc <=160 is silent', rows: [row('fr', 120), row('de', 140), row('ru', 160)], hard: 0, soft: 0 },
    { name: 'other desc >160 is hard', rows: [row('fr', 161), row('de', 204)], hard: 2, soft: 0 },
    { name: 'other desc <120 is a soft short note, not a failure', rows: [row('fr', 100), row('es', 119)], hard: 0, soft: 2 },
    { name: 'code points, not UTF-16: 160 Devanagari is 160 (fits), 161 is over', rows: [row('hi', 160, 'अ'), row('hi', 161, 'अ')], hard: 1, soft: 0 },
    { name: '…and an emoji really is one code point: 160 fits other', rows: [row('fr', 160, '🙂')], hard: 0, soft: 0 },
    { name: 'an empty sweep compares nothing', rows: [], hard: 0, soft: 0, wantRows: 0 }
  ];
  let bad = 0;
  for (const c of cases) {
    // fixture integrity: the filler must actually produce the intended code-point count
    for (const r of c.rows) if (cps(r.desc) !== r.len) { console.log(`  FAIL ${c.name}: fixture ${cps(r.desc)} != ${r.len}`); bad++; }
    const res = judge({ rows: c.rows });
    const hard = hardOf(res), soft = softOf(res);
    const wantRows = c.wantRows === undefined ? c.rows.length : c.wantRows;
    const ok = hard === c.hard && soft === c.soft && res.rows === wantRows;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.name}  → hard=${hard} soft=${soft} rows=${res.rows}, want hard=${c.hard} soft=${c.soft} rows=${wantRows}`);
  }

  // Counter-proofs: the per-script routing is real, not one uniform number in disguise. The SAME
  // length must land differently across scripts, and each boundary must flip on the next character.
  const proofs = [
    ['100 cps: EN hard (<135), CJK hard (>85), other soft (<120)',
      hardOf(count('en', 100)) === 1 && hardOf(count('zh', 100)) === 1 && softOf(count('fr', 100)) === 1 && hardOf(count('fr', 100)) === 0],
    ['150 cps: EN ok (135-158), CJK hard (>85), other ok (<=160)',
      hardOf(count('en', 150)) === 0 && hardOf(count('ja', 150)) === 1 && hardOf(count('de', 150)) === 0],
    ['EN boundary 158 ok / 159 hard', hardOf(count('en', 158)) === 0 && hardOf(count('en', 159)) === 1],
    ['EN boundary 135 ok / 134 hard', hardOf(count('en', 135)) === 0 && hardOf(count('en', 134)) === 1],
    ['CJK boundary 85 ok / 86 hard', hardOf(count('zh', 85)) === 0 && hardOf(count('zh', 86)) === 1],
    ['CJK boundary 70 ok / 69 hard', hardOf(count('ko', 70)) === 0 && hardOf(count('ko', 69)) === 1],
    ['other boundary 160 ok / 161 hard', hardOf(count('fr', 160)) === 0 && hardOf(count('fr', 161)) === 1],
    ['other soft floor 120 clean / 119 short', softOf(count('fr', 120)) === 0 && softOf(count('fr', 119)) === 1]
  ];
  for (const [name, ok] of proofs) { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} counter-proof: ${name}`); }

  // the parser, against the markup the template really emits
  const html = '<title>Free Online X &amp; Y - ClearLight Tools</title><meta name="description" content="Compressiez vos PDFs &amp; gardez le texte &lt;sélectable&gt;">';
  const got = metaDescription(html), gotTitle = pageTitle(html);
  const okParse = got === 'Compressiez vos PDFs & gardez le texte <sélectable>' && gotTitle === 'Free Online X & Y - ClearLight Tools';
  if (!okParse) bad++;
  console.log(`  ${okParse ? 'ok  ' : 'FAIL'} the entity-aware parsers read the shipped title + attribute  → ${JSON.stringify(got)}`);
  const okAbsent = metaDescription('<title>nothing here</title>') === null;
  if (!okAbsent) bad++;
  console.log(`  ${okAbsent ? 'ok  ' : 'FAIL'} a page without a description is reported, not measured as ""`);

  // and a live page must still parse, or the template changed underneath this check. This only proves
  // the RULER reads the artifact; the main sweep below is what asserts the owner window on every page.
  let live = null;
  for (const l of ['en', 'fr', 'de', 'zh']) {
    const p = join(ROOT, 'dist', l, 'pdf', 'compress-pdf', 'index.html');
    if (existsSync(p)) { live = { l, desc: metaDescription(await readFile(p, 'utf8')) }; break; }
  }
  if (!live || !live.desc) {
    console.log('  FAIL no built tool page could be read — dist/ is missing or the markup moved (run `node build.mjs`)');
    bad++;
  } else console.log(`  ok   live page parses: ${live.l} compress-pdf description is ${cps(live.desc)} code points`);

  if (!cases.length) { console.error('EMPTY RUN: no selftest cases'); process.exit(1); }
  if (bad) { console.error(`\nselftest: ${bad} case(s) wrong — this ruler would not see a SERP-length defect`); process.exit(1); }
  console.log(`\nselftest: ${cases.length} cases + ${proofs.length} counter-proofs + parsers + live read all pass\n`);
}

// ---------------------------------------------------------------- main
if (flag('--selftest')) { await selftest(); process.exit(0); }

const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));
const tools = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const only = opt('--locale');
const locales = only ? [only] : cfg.locales;

if (!existsSync(join(ROOT, 'dist'))) {
  console.error('\ndist/ is missing — run `node build.mjs` first: this check reads the built pages, not the source seeds');
  process.exit(1);
}
const { rows, missing } = await collect({ cfg, tools, locales });
const { findings } = judge({ rows });

console.log(`\nSERP description length — ${rows.length} built tool page(s) over ${locales.length} locale(s)`
  + `  [EN ${windowLabel('en')}, CJK ${windowLabel('zh')}, other ${windowLabel('fr')} code points]`
  + (missing.length ? `\n  pages with no readable description: ${missing.length} (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''})` : ''));
const byLocale = {};
for (const r of rows) (byLocale[r.locale] ||= []).push(r.len);
const hardByLocale = {};
for (const f of findings.filter(f => !f.soft)) hardByLocale[f.locale] = (hardByLocale[f.locale] || 0) + 1;
for (const [l, a] of Object.entries(byLocale)) {
  const s = [...a].sort((x, y) => x - y);
  console.log(`  ${l.padEnd(3)} pages ${String(a.length).padStart(2)}  min ${String(s[0]).padStart(3)}  med ${String(s[Math.floor(s.length / 2)]).padStart(3)}  max ${String(s[s.length - 1]).padStart(3)}  window ${windowLabel(l).padEnd(7)}  outside ${String(hardByLocale[l] || 0).padStart(2)}`);
}

const hardOnes = findings.filter(f => !f.soft), softOnes = findings.filter(f => f.soft);
if (softOnes.length) {
  console.log(`\n  short-description notes (other scripts <120): ${softOnes.length}`);
  for (const f of softOnes.slice(0, 12)) console.log(`    ${f.locale} ${f.tool}  ${f.why}`);
  if (softOnes.length > 12) console.log(`    … ${softOnes.length - 12} more`);
}
if (hardOnes.length) {
  console.log(`\n  OUTSIDE THE OWNER WINDOW: ${hardOnes.length}`);
  for (const f of hardOnes.slice(0, 40)) {
    console.log(`    ${f.locale} t.${f.tool}.desc  ${f.why}`);
    console.log(`        ${JSON.stringify(f.text.slice(0, 120))}`);
  }
  if (hardOnes.length > 40) console.log(`    … ${hardOnes.length - 40} more`);
}

// The empty-run guard: a renamed template attribute, a moved dist or a narrowed locale list would
// otherwise report a comfortable 0 for the whole sweep.
const expected = locales.length * tools.length;
if (!rows.length) {
  console.error('\nEMPTY RUN: not one built description was measured — the markup or the dist path is not what this check reads');
  process.exit(1);
}
if (rows.length < expected * 0.9) {
  console.error(`\nEMPTY RUN: only ${rows.length} of ${expected} tool pages were read — dist/ is incomplete for the locales listed in config/site.json`);
  process.exit(1);
}
if (hardOnes.length) { console.error(`\n${hardOnes.length} SERP description(s) outside the owner's per-script window.`); process.exit(1); }
console.log(`\n  ok — every built tool description fits its per-script window (${rows.length} measured)\n`);
