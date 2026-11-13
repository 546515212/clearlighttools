#!/usr/bin/env node
// Does the root path / open the English home, stably, for everyone — and is the old environment
// auto-detection really gone?
//
//   node scripts/check-routing.mjs            # report
//   node scripts/check-routing.mjs --strict   # exit 1 on any mismatch
//   node scripts/check-routing.mjs --selftest # prove the check can see a regression
//
// The contract changed: the site no longer guesses a language from the visitor's cookie, IP,
// browser language or timezone. The root always resolves to /<defaultLocale>/ (= /en/). This gate
// asserts that on the real source AND the built dist/ artifacts, plus the production server
// redirects and the root page's SEO head:
//   R1  router.js (src + dist) redirects with location.replace to cfg.defaultLocale and contains no
//       auto-detection token; a blanked router fails the non-empty guard.
//   R2  i18n.js (src + dist) no longer exports detectLocale / fromCountry / fromBrowser / supported /
//       readCookie, and still exports the kept writeCookie / geoCountry.
//   R3  runtime.js (src + dist) has no IP language-suggestion bar (fromCountry / langSuggested /
//       th_lang_dismissed) and still has the manual menu (writeCookie(l) + location.href).
//   R4  vercel.json carries a permanent redirect / -> /en/.
//   R5  dist/_redirects carries "/ /en/ 301" (Cloudflare Pages / Netlify).
//   R6  dist/index.html canonical and x-default point at /en/, and every hreflang alternate carries
//       a locale prefix.
//   T   the retained country table is well-formed data (every named locale is built) and the emitted
//       state.js table equals the source table. The table no longer drives routing; it is kept only
//       as data, so this is hygiene, not a routing-behaviour test.
// Every rule is paired with a mutation in --selftest that must flip its verdict, so a check that
// silently stops comparing is refused.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));

let pageCfg;
try {
  pageCfg = JSON.parse((await readFile(join(ROOT, 'dist', '_assets', 'state.js'), 'utf8'))
    .replace(/^window\.__TH_CONFIG\s*=/, '').replace(/;\s*$/, ''));
} catch {
  console.log('  FAIL dist/_assets/state.js is missing — run `node build.mjs` first');
  process.exit(1);
}

// Strip JS comments before token checks so a comment that names a removed helper (the i18n.js
// header explains what was deleted) cannot masquerade as live code. Normalise CRLF first; guard
// :// so a URL inside a string is not mistaken for a line comment.
function stripComments(src) {
  return String(src).replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const DET_TOKENS = ['detectLocale', 'fromCountry', 'fromBrowser', 'readCookie', 'geoCountry',
  'navigator.language', 'timezoneToLocale', 'countryToLocales', 'Intl.DateTimeFormat'];

// Pure: the artifacts travel in, so the selftest can hand it a sabotaged copy and the same rules
// must then fire.
function judgeRoot(a) {
  const fails = [];
  let cases = 0;
  const dl = a.defaultLocale;

  // R1 — router fixed to the default locale, no detection
  for (const [label, src] of [['router.js', a.routerSrc], ['dist router.js', a.routerDist]]) {
    cases++;
    const code = stripComments(src);
    if (!/location\s*\.\s*replace/.test(code)) { fails.push(`R1 ${label}: no location.replace redirect (blank or rewritten?)`); continue; }
    if (!code.includes('defaultLocale')) fails.push(`R1 ${label}: redirect target is not cfg.defaultLocale`);
    for (const tok of DET_TOKENS) if (code.includes(tok)) fails.push(`R1 ${label}: auto-detection token "${tok}" present — root must not guess language`);
  }
  // R2 — the auto-detection helpers are retired, the kept ones survive
  for (const [label, src] of [['i18n.js', a.i18nSrc], ['dist i18n.js', a.i18nDist]]) {
    cases++;
    const code = stripComments(src);
    if (!/export\s+function\s+writeCookie/.test(code) || !/export\s+async\s+function\s+geoCountry/.test(code)) {
      fails.push(`R2 ${label}: kept helpers writeCookie/geoCountry missing (blank?)`);
    }
    const dead = code.match(/export\s+(?:async\s+)?function\s+(detectLocale|fromCountry|fromBrowser|supported|readCookie)\b/g);
    if (dead) fails.push(`R2 ${label}: auto-detection helper still exported: ${dead.join(', ')}`);
  }
  // R3 — no IP language nudge; the manual menu remains
  for (const [label, src] of [['runtime.js', a.runtimeSrc], ['dist runtime.js', a.runtimeDist]]) {
    cases++;
    const code = stripComments(src);
    for (const tok of ['fromCountry', 'langSuggested', 'th_lang_dismissed']) {
      if (code.includes(tok)) fails.push(`R3 ${label}: IP language-suggestion token "${tok}" present`);
    }
    if (!/writeCookie\s*\(\s*l\s*\)/.test(code) || !code.includes('location.href')) {
      fails.push(`R3 ${label}: manual language menu (writeCookie(l) + location.href) missing`);
    }
  }
  // R4 — Vercel permanent redirect
  cases++;
  const vr = Array.isArray(a.vercel?.redirects) ? a.vercel.redirects : [];
  if (!vr.some(r => r.source === '/' && r.destination === `/${dl}/` && r.permanent === true)) {
    fails.push(`R4 vercel.json: no permanent redirect / -> /${dl}/`);
  }
  // R5 — Cloudflare / Netlify _redirects
  cases++;
  const rl = String(a.redirects || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!rl.includes(`/ /${dl}/ 301`)) fails.push(`R5 dist/_redirects: missing "/ /${dl}/ 301"`);
  // R6 — root page SEO head
  cases++;
  const html = String(a.rootHtml || '');
  const canon = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (!canon || canon[1] !== `${a.baseline}/${dl}/`) fails.push(`R6 root canonical is not ${a.baseline}/${dl}/ (got ${canon ? canon[1] : 'none'})`);
  const xdef = html.match(/<link rel="alternate" hreflang="x-default" href="([^"]+)"/);
  if (!xdef || xdef[1] !== `${a.baseline}/${dl}/`) fails.push(`R6 root x-default is not ${a.baseline}/${dl}/`);
  const altHrefs = [...html.matchAll(/<link rel="alternate" hreflang="[^"]+" href="([^"]+)"/g)].map(m => m[1]);
  if (altHrefs.length < a.locales.length + 1) fails.push(`R6 root hreflang alternates ${altHrefs.length} < ${a.locales.length + 1}`);
  for (const h of altHrefs) if (!/^https?:\/\/[^/]+\/[a-z]{2}(?:-[A-Za-z]+)?\//.test(h)) fails.push(`R6 root alternate href lacks a locale prefix: ${h}`);

  return { fails, cases };
}

// The retained country table is data hygiene now, not a routing driver.
function judgeTable(table, locales) {
  const fails = [];
  const entries = Object.entries(table || {});
  if (!entries.length) fails.push('routing table is empty');
  for (const [country, list] of entries) {
    if (!Array.isArray(list) || !list.length) { fails.push(`${country}: candidate list is empty`); continue; }
    if (!list.some(l => locales.includes(l))) fails.push(`${country}: lists only unbuilt locales (${list.join('/')})`);
  }
  return { fails, cases: entries.length };
}

async function readArtifacts() {
  const rd = p => readFile(join(ROOT, p), 'utf8');
  let vercel;
  try { vercel = JSON.parse(await rd('vercel.json')); }
  catch { console.log('  FAIL vercel.json missing or invalid'); process.exit(1); }
  let redirects;
  try { redirects = await rd('dist/_redirects'); }
  catch { console.log('  FAIL dist/_redirects is missing — run `node build.mjs` first'); process.exit(1); }
  return {
    routerSrc: await rd('src/scripts/router.js'),
    routerDist: await rd('dist/_assets/router.js'),
    i18nSrc: await rd('src/scripts/i18n.js'),
    i18nDist: await rd('dist/_assets/i18n.js'),
    runtimeSrc: await rd('src/scripts/runtime.js'),
    runtimeDist: await rd('dist/_assets/runtime.js'),
    vercel,
    redirects,
    rootHtml: await rd('dist/index.html'),
    baseline: cfg.baselineUrl.replace(/\/$/, ''),
    defaultLocale: cfg.defaultLocale,
    locales: cfg.locales
  };
}

// ---------------------------------------------------------------- selftest
if (process.argv.includes('--selftest')) {
  const real = await readArtifacts();
  const both = (a, key, extra) => ({ ...a, [key]: a[key] + extra, [key.replace('Src', 'Dist')]: a[key.replace('Src', 'Dist')] + extra });
  const cases = [
    ['the real artifacts pass every rule', a => a, r => !r.fails.length && r.cases >= 9],
    ['a router that auto-detects is caught', a => both(a, 'routerSrc', '\nconst x = detectLocale(cfg);'), r => r.fails.some(f => /R1.*detectLocale/.test(f))],
    ['a router redirected to a non-default locale is caught', a => ({ ...a, routerSrc: "location.replace('/zh/');", routerDist: "location.replace('/zh/');" }), r => r.fails.some(f => /R1.*defaultLocale/.test(f))],
    ['a blanked router fails the non-empty guard', a => ({ ...a, routerSrc: '', routerDist: '' }), r => r.fails.some(f => /R1.*location\.replace/.test(f))],
    ['i18n still exporting detectLocale is caught', a => both(a, 'i18nSrc', '\nexport function detectLocale(){}'), r => r.fails.some(f => /R2.*detectLocale/.test(f))],
    ['a runtime with the IP suggestion bar is caught', a => both(a, 'runtimeSrc', '\nfromCountry(cfg, country);'), r => r.fails.some(f => /R3.*fromCountry/.test(f))],
    ['vercel without the root redirect is caught', a => ({ ...a, vercel: { ...a.vercel, redirects: [] } }), r => r.fails.some(f => /R4/.test(f))],
    ['_redirects without the 301 is caught', a => ({ ...a, redirects: '' }), r => r.fails.some(f => /R5/.test(f))],
    ['a root canonical pointing at /zh/ is caught', a => ({ ...a, rootHtml: a.rootHtml.replace('/en/"', '/zh/"') }), r => r.fails.some(f => /R6 root canonical/.test(f))],
    ['a table naming only unbuilt locales is caught', () => null, () => judgeTable({ DE: ['dk', 'sv'] }, cfg.locales).fails.some(f => /only unbuilt locales/.test(f))],
    ['an empty table is caught', () => null, () => judgeTable({}, cfg.locales).fails.some(f => /empty/.test(f))]
  ];
  let bad = 0;
  for (const [name, mutate, ok] of cases) {
    const got = mutate(real) === null ? { fails: [] } : judgeRoot(mutate(real));
    const pass = ok(got);
    if (!pass) bad++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` -> ${JSON.stringify((got.fails || []).slice(0, 3))}`}`);
  }
  if (bad) { console.log(`selftest: ${bad} case(s) failed — this routing check cannot be trusted`); process.exit(1); }
  console.log(`selftest ok — ${cases.length} cases: auto-detection, wrong/blank redirect, retired helper, IP bar, missing 301, root SEO, table hygiene`);
  // no exit: --selftest gates the real scan, it is not the deliverable
}

// ---------------------------------------------------------------- real scan
const real = await readArtifacts();
const root = judgeRoot(real);
const table = judgeTable(cfg.routing.countryToLocales, cfg.locales);
const fails = [...root.fails, ...table.fails];

// the fixed-English contract: the default locale must be en, and production must agree with it
if (cfg.defaultLocale !== 'en') fails.push(`defaultLocale is "${cfg.defaultLocale}", the root contract requires "en"`);
if (JSON.stringify(pageCfg.countryToLocales) !== JSON.stringify(cfg.routing.countryToLocales)) {
  fails.push('emitted routing table differs from the source table');
}
if (pageCfg.defaultLocale !== cfg.defaultLocale) fails.push('emitted defaultLocale differs from config');

console.log(`routing check — root fixed to /${cfg.defaultLocale}/: ${root.cases} artifact rules (R1–R6) + ${table.cases} country rows of data hygiene`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `  ${fails.length} routing mismatch(es)` : '  root opens /en/ for everyone; no environment auto-detection remains; production 301 + root SEO aligned');
if (strict && fails.length) process.exit(1);