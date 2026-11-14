#!/usr/bin/env node
// Internal-linking contract for every tool detail page (78 tools × 13 locales). The owner asked for
// a breadcrumb (UI + JSON-LD) and a same-category "related tools" matrix on each tool page; this gate
// proves both shipped correctly on the BUILT dist/ artifacts, in every locale, and keeps them correct.
//
//   node scripts/check-internal-links.mjs            # scan every built tool page, report
//   node scripts/check-internal-links.mjs --strict   # exit 1 on any finding
//   node scripts/check-internal-links.mjs --selftest # prove each rule can see a regression
//
//   B1  visible <nav class="breadcrumb" aria-label="Breadcrumb"> with exactly three levels:
//       Home (link /<loc>/), Category (link /<loc>/<cat>/), current tool (span aria-current="page",
//       NO link). Every href keeps the page's OWN locale prefix; every name is non-empty.
//   B2  exactly one BreadcrumbList JSON-LD: 3 ListItem, position 1/2/3, each with a non-empty name and
//       an ABSOLUTE item on the owner domain with a SINGLE locale prefix — paths /<loc>/, /<loc>/<cat>/,
//       /<loc>/<cat>/<id>/, INCLUDING the current tool (level 3). Names equal the visible nav names.
//       This is the rule that catches the old /en//en/ double-prefix bug and the missing level-3 item.
//   R1  a related-tools card grid <section id="related"> BELOW the tool panel, with exactly min(6, N-1)
//       (=> 4–6) <a class="tool-card"> links, ALL in the page's own category (data-cat), NONE pointing
//       at the current tool, every href locale-prefixed /<loc>/<cat>/<otherId>/, each card carrying a
//       localized name <b> AND a short description <small>. No duplicate targets.
// Every rule is paired with a mutation in --selftest that must flip its verdict, so a check that
// silently stops comparing is refused. Pure judge: the HTML travels in, the selftest hands it sabotage.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';

const strict = process.argv.includes('--strict');
const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));
const tools = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const BASE = String(cfg.baselineUrl).replace(/\/$/, '');

const unescape = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// ids of the OTHER tools in the same category — the only legal related targets, self excluded.
const sameCatOf = cat => tools.filter(t => t.cat === cat).map(t => t.id);
function ctxFor(loc, tool) {
  const sameCat = sameCatOf(tool.cat).filter(id => id !== tool.id);
  return { loc, cat: tool.cat, id: tool.id, base: BASE, sameCat, expect: Math.min(6, sameCat.length) };
}

// Pure: hand it a page's HTML and its context; it returns findings. The selftest reuses this verbatim
// on sabotaged copies, so the rules cannot drift from what is actually scanned.
export function judgeToolPage(html, ctx) {
  const fails = [];
  let cases = 0;
  const { loc, cat, id, base, sameCat, expect } = ctx;
  const tag = `${loc}/${cat}/${id}`;
  const src = String(html || '');
  if (!src.trim()) return { fails: [`${tag}: blank page (non-empty guard)`], cases: 1 };

  const paths = ['', `${cat}/`, `${cat}/${id}/`];
  const wantItems = paths.map(p => `${base}/${loc}/${p}`);

  // ---- B1 visible breadcrumb -----------------------------------------------------------------
  cases++;
  const navM = src.match(/<nav class="breadcrumb"([^>]*)>([\s\S]*?)<\/nav>/);
  const navNames = [null, null, null];
  if (!navM) {
    fails.push(`B1 ${tag}: no <nav class="breadcrumb"> (blank or removed?)`);
  } else {
    if (!/aria-label="Breadcrumb"/.test(navM[1])) fails.push(`B1 ${tag}: breadcrumb nav missing aria-label="Breadcrumb"`);
    const inner = navM[2];
    const l0 = inner.match(/^\s*<a href="([^"]+)">([^<]*)<\/a>/);
    const l1 = inner.match(/<span><a href="([^"]+)">([^<]*)<\/a><\/span>/);
    const l2 = inner.match(/<span aria-current="page">([\s\S]*?)<\/span>/);
    if (!l0 || l0[1] !== `/${loc}/`) fails.push(`B1 ${tag}: level-1 Home link is not /${loc}/ (got ${l0 ? l0[1] : 'none'})`);
    if (!l1 || l1[1] !== `/${loc}/${cat}/`) fails.push(`B1 ${tag}: level-2 Category link is not /${loc}/${cat}/ (got ${l1 ? l1[1] : 'none'})`);
    if (!l2) fails.push(`B1 ${tag}: level-3 current tool is not <span aria-current="page">`);
    else if (/<a\b/.test(l2[1])) fails.push(`B1 ${tag}: level-3 current tool must NOT be a link`);
    navNames[0] = l0 ? unescape(l0[2]).trim() : '';
    navNames[1] = l1 ? unescape(l1[2]).trim() : '';
    navNames[2] = l2 ? unescape(l2[1].replace(/<[^>]*>/g, '')).trim() : '';
    navNames.forEach((n, i) => { if (!n) fails.push(`B1 ${tag}: level-${i + 1} name is empty`); });
  }

  // ---- B2 BreadcrumbList JSON-LD -------------------------------------------------------------
  cases++;
  const lds = [];
  for (const m of src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { lds.push(JSON.parse(m[1])); }
    catch (e) { fails.push(`B2 ${tag}: a JSON-LD block does not parse: ${e.message}`); }
  }
  const bcs = lds.filter(o => o && o['@type'] === 'BreadcrumbList');
  if (bcs.length !== 1) {
    fails.push(`B2 ${tag}: expected exactly 1 BreadcrumbList, found ${bcs.length}`);
  } else {
    const list = Array.isArray(bcs[0].itemListElement) ? bcs[0].itemListElement : [];
    if (list.length !== 3) fails.push(`B2 ${tag}: BreadcrumbList has ${list.length} items, expected 3`);
    list.forEach((it, i) => {
      if (!it || it['@type'] !== 'ListItem') { fails.push(`B2 ${tag}: item ${i + 1} is not a ListItem`); return; }
      if (it.position !== i + 1) fails.push(`B2 ${tag}: item ${i + 1} position is ${it.position}, expected ${i + 1}`);
      const nm = String(it.name || '').trim();
      if (!nm) fails.push(`B2 ${tag}: item ${i + 1} name is empty`);
      else if (navNames[i] && nm !== navNames[i]) fails.push(`B2 ${tag}: item ${i + 1} name "${nm}" != nav name "${navNames[i]}"`);
      if (it.item !== wantItems[i]) fails.push(`B2 ${tag}: item ${i + 1} item is "${it.item}", expected "${wantItems[i]}" (absolute, single locale prefix, level 3 included)`);
    });
  }

  // ---- R1 related-tools card grid ------------------------------------------------------------
  cases++;
  const secM = src.match(/<section class="prose" id="related">([\s\S]*?)<\/section>/);
  if (!secM) {
    fails.push(`R1 ${tag}: no <section id="related"> related-tools grid`);
  } else {
    const sec = secM[1];
    const head = sec.match(/<h2>([^<]*)<\/h2>/);
    if (!head || !unescape(head[1]).trim()) fails.push(`R1 ${tag}: related grid heading is empty`);
    const cards = [...sec.matchAll(/<a class="tool-card" href="([^"]+)"[^>]*data-cat="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    if (cards.length !== expect) fails.push(`R1 ${tag}: related grid has ${cards.length} cards, expected ${expect} (4–6, same category, self excluded)`);
    if (expect < 4 || expect > 6) fails.push(`R1 ${tag}: expected related count ${expect} is outside 4–6 (category too small?)`);
    const seen = new Set();
    for (const c of cards) {
      const href = c[1], dcat = c[2], body = c[3];
      const hm = href.match(new RegExp(`^/${loc}/${cat}/([^/]+)/$`));
      if (dcat !== cat) fails.push(`R1 ${tag}: related card data-cat="${dcat}" != page category "${cat}"`);
      if (!hm) fails.push(`R1 ${tag}: related href "${href}" is not /${loc}/${cat}/<id>/ (locale/category prefix broken)`);
      else {
        const oid = hm[1];
        if (oid === id) fails.push(`R1 ${tag}: related grid links to the current tool (${oid}) — self must be excluded`);
        else if (!sameCat.includes(oid)) fails.push(`R1 ${tag}: related target "${oid}" is not a same-category tool`);
        if (seen.has(href)) fails.push(`R1 ${tag}: duplicate related target ${href}`);
        seen.add(href);
      }
      const nm = body.match(/<b>([^<]*)<\/b>/);
      const ds = body.match(/<small>([^<]*)<\/small>/);
      if (!nm || !unescape(nm[1]).trim()) fails.push(`R1 ${tag}: related card ${href} has no name`);
      if (!ds || !unescape(ds[1]).trim()) fails.push(`R1 ${tag}: related card ${href} has no short description`);
    }
    // placement: the grid sits BELOW the interactive panel, not above it
    const relIdx = src.indexOf('id="related"');
    const panelIdx = src.indexOf('id="tool-panel"');
    if (panelIdx >= 0 && relIdx >= 0 && relIdx < panelIdx) fails.push(`R1 ${tag}: related grid is above the tool panel, must be below main content`);
  }

  return { fails, cases };
}

async function readPage(loc, tool) {
  const f = join(ROOT, 'dist', loc, tool.cat, tool.id, 'index.html');
  if (!existsSync(f)) return null;
  return readFile(f, 'utf8');
}

// ---------------------------------------------------------------- selftest
if (process.argv.includes('--selftest')) {
  const probe = tools.find(t => t.cat === 'image' && t.id === 'compress-image') || tools[0];
  const loc = cfg.defaultLocale;
  const ctx = ctxFor(loc, probe);
  const realHtml = await readPage(loc, probe);
  if (realHtml == null) { console.log('  FAIL dist tool page missing — run `node build.mjs` first'); process.exit(1); }
  const selfHref = `/${loc}/${probe.cat}/${probe.id}/`;
  const firstCardHref = (realHtml.match(/<section class="prose" id="related">[\s\S]*?<a class="tool-card" href="([^"]+)"/) || [])[1];
  const secOuter = realHtml.match(/<section class="prose" id="related">[\s\S]*?<\/section>/)[0];

  const cases = [
    ['the real page passes every rule', h => h, r => !r.fails.length && r.cases >= 3],
    ['a blanked page fails the non-empty guard', () => '', r => r.fails.some(f => /non-empty guard/.test(f))],
    ['a wrong aria-label is caught', h => h.replace('aria-label="Breadcrumb"', 'aria-label="Home"'), r => r.fails.some(f => /B1.*aria-label/.test(f))],
    ['a linked current-tool level is caught', h => h.replace(/<span aria-current="page">([^<]*)<\/span>/, `<span aria-current="page"><a href="${selfHref}">$1</a></span>`), r => r.fails.some(f => /B1.*must NOT be a link/.test(f))],
    ['a Home link that drops the locale is caught', h => h.replace('<nav class="breadcrumb" aria-label="Breadcrumb">\n      <a href="/' + loc + '/">', '<nav class="breadcrumb" aria-label="Breadcrumb">\n      <a href="/">'), r => r.fails.some(f => /B1.*level-1 Home/.test(f))],
    ['a double-locale JSON-LD item is caught', h => h.replace(`"item":"${BASE}/${loc}/${probe.cat}/"`, `"item":"${BASE}/${loc}/${loc}/${probe.cat}/"`), r => r.fails.some(f => /B2.*item 2 item/.test(f))],
    ['a missing level-3 JSON-LD item is caught', h => h.replace(`,"item":"${BASE}/${loc}/${probe.cat}/${probe.id}/"`, ''), r => r.fails.some(f => /B2.*item 3 item/.test(f))],
    ['a wrong JSON-LD position is caught', h => h.replace('"position":2', '"position":9'), r => r.fails.some(f => /B2.*position/.test(f))],
    ['a self-link in the related grid is caught', h => h.replace(`class="tool-card" href="${firstCardHref}"`, `class="tool-card" href="${selfHref}"`), r => r.fails.some(f => /R1.*self must be excluded/.test(f))],
    ['a wrong-category related card is caught', h => h.replace(`data-cat="${probe.cat}"`, 'data-cat="pdf"'), r => r.fails.some(f => /R1.*data-cat/.test(f))],
    ['a related card without a description is caught', h => h.replace(/(<section class="prose" id="related">[\s\S]*?)<small>[^<]*<\/small>/, '$1'), r => r.fails.some(f => /R1.*no short description/.test(f))],
    ['too few related cards are caught', h => {
      const kept = [...secOuter.matchAll(/<a class="tool-card"[\s\S]*?<\/a>/g)].slice(0, 3).join('\n        ');
      const rebuilt = secOuter.replace(/(<div class="related-grid">)[\s\S]*?(<\/div>)/, `$1\n        ${kept}\n      $2`);
      return h.replace(secOuter, rebuilt);
    }, r => r.fails.some(f => /R1.*expected/.test(f))],
    ['a related grid moved above the panel is caught', h => {
      const without = h.replace(secOuter, '');
      const at = without.indexOf('<div class="panel tool-panel"');
      return without.slice(0, at) + secOuter + '\n' + without.slice(at);
    }, r => r.fails.some(f => /R1.*above the tool panel/.test(f))]
  ];
  let bad = 0;
  for (const [name, mutate, ok] of cases) {
    const got = judgeToolPage(mutate(realHtml), ctx);
    const pass = ok(got);
    if (!pass) bad++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` -> ${JSON.stringify((got.fails || []).slice(0, 3))}`}`);
  }
  if (bad) { console.log(`selftest: ${bad} case(s) failed — this internal-links check cannot be trusted`); process.exit(1); }
  console.log(`selftest ok — ${cases.length} cases: blank guard, aria-label, linked current level, locale drop, double-prefix item, missing level-3 item, position, self-link, wrong category, missing desc, too few, placement`);
  // no exit: --selftest gates the real scan, it is not the deliverable
}

// ---------------------------------------------------------------- real scan
if (!tools.length) { console.log('  FAIL tools.json is empty (non-empty guard)'); process.exit(1); }
let scanned = 0, missing = 0, ruleCases = 0;
const fails = [];
for (const loc of cfg.locales) {
  for (const tool of tools) {
    const html = await readPage(loc, tool);
    if (html == null) { missing++; fails.push(`MISSING dist/${loc}/${tool.cat}/${tool.id}/index.html`); continue; }
    scanned++;
    const r = judgeToolPage(html, ctxFor(loc, tool));
    ruleCases += r.cases;
    for (const f of r.fails) fails.push(f);
  }
}
if (!scanned) { console.log('  FAIL no tool pages scanned — run `node build.mjs` first'); process.exit(1); }

console.log(`internal-links check — ${scanned} tool pages (${tools.length} tools × ${cfg.locales.length} locales), ${ruleCases} rule cases (B1 breadcrumb UI · B2 BreadcrumbList JSON-LD · R1 related matrix)`);
for (const f of fails.slice(0, 40)) console.log(`  FAIL ${f}`);
if (fails.length > 40) console.log(`  … ${fails.length - 40} more`);
console.log(fails.length ? `  ${fails.length} internal-link finding(s)${missing ? `, ${missing} missing page(s)` : ''}` : '  every tool page: 3-level breadcrumb (locale-kept links + absolute 3-item JSON-LD) and a 4–6 same-category related matrix (self excluded, name + description)');
if (strict && fails.length) process.exit(1);