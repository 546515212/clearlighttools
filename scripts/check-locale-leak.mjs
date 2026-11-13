#!/usr/bin/env node
// Does every locale page carry its OWN words?
//
//   node scripts/check-locale-leak.mjs            # report
//   node scripts/check-locale-leak.mjs --strict   # exit 1 on any leak or build gap
//   node scripts/check-locale-leak.mjs --selftest # prove the check can see a leak
//
// Why this exists: titles.json is a per-locale override layer that build.mjs merges into the
// English tool dictionary. When that merge shared nested objects instead of copying them, each
// locale's override was written into the table the next locale started from, and nine of the
// thirteen locales built their h1 and <title> from the Indonesian string "Kompres PDF". Nothing
// else looked wrong — the pages were valid, translated, and green in every other check. Only a
// check that compares a page against *its own locale's* expected words can catch that, so this
// asserts against dist/ rather than against a re-implementation of the merge.
//
// Two things are asserted, because two different pieces of code produce them:
//   title — dist/_assets/dict.<locale>.js, `search` namespace (build.mjs renames the internal `t`
//           table to `search` when it emits the dictionary);
//   h1    — dist/<locale>/<category>/<tool>/index.html, i.e. the template's output, which is what
//           a visitor and a search engine actually read. The built dictionary carries no h1 field,
//           so this cannot be checked from the dictionary and has to be read from the page.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

const read = async (...p) => JSON.parse(await readFile(join(ROOT, ...p), 'utf8'));

// judge({ titleMap, toolRows, titles, h1s }) -> { leaks, blind, counts }
// titleMap: { toolId: { locale: overrideString } }  (titles.json, transposed)
// titles:   { locale: { toolId: title } }           (read out of the built dictionaries)
// h1s:      { locale: { toolId: h1 } }              (read out of the built pages)
// Pure, so the selftest can feed it a sabotage of the exact bug this file was written for.
function judge({ titleMap, toolRows = [], titles = {}, h1s = {} }) {
  const leaks = [];
  const blind = [];
  let titleChecks = 0, h1Checks = 0;
  for (const [id, perLocale] of Object.entries(titleMap)) {
    if (!toolRows.some(t => t.id === id)) {
      leaks.push({ id, locale: '*', want: 'registry', why: 'titles.json has a tool that is not in the registry' });
      continue;
    }
    for (const [locale, expected] of Object.entries(perLocale)) {
      if (!expected) continue;
      const want = String(expected).trim();
      const thiefOf = got => Object.entries(perLocale).find(([l, v]) => l !== locale && String(v).trim() === got)?.[0] || null;

      const built = titles[locale]?.[id];
      titleChecks++;
      if (!built) leaks.push({ id, locale, want: 'title', why: `no entry in dist/_assets/dict.${locale}.js` });
      else if (String(built).trim() !== want) {
        leaks.push({ id, locale, want: 'title', expected: want, got: String(built).trim(), thief: thiefOf(String(built).trim()) });
      }

      const h1 = h1s[locale]?.[id];
      if (h1 === undefined) { leaks.push({ id, locale, want: 'h1', why: 'no page to read (built html missing)' }); continue; }
      h1Checks++;
      // An h1 legitimately differs from the title — English keeps a longer SEO headline — so the
      // honest form of the claim is "not another locale's override string".
      const thief = thiefOf(h1);
      if (thief && h1 !== want) leaks.push({ id, locale, want: 'h1', expected: want, got: h1, thief });

      // Two locales that authored the same words: a swap between those two cannot be told apart by
      // value. Report it instead of implying the check is complete for this id. The pair is sorted
      // so de/id and id/de count once.
      const twin = Object.entries(perLocale).find(([l, v]) => l !== locale && String(v).trim() === want);
      if (twin) blind.push(`${id}: ${[locale, twin[0]].sort().join(' and ')} author the same override string`);
    }
  }
  return { leaks, blind: [...new Set(blind)], counts: { titleChecks, h1Checks } };
}

// ---------------------------------------------------------------- selftest
if (process.argv.includes('--selftest')) {
  const toolRows = [{ id: 'compress-pdf', cat: 'pdf' }, { id: 'merge-pdf', cat: 'pdf' }];
  const titleMap = {
    'compress-pdf': { de: 'PDF komprimieren', id: 'Kompres PDF' },
    'merge-pdf': { de: 'PDF zusammenführen', id: 'Gabung PDF' }
  };
  const cleanTitles = {
    de: { 'compress-pdf': 'PDF komprimieren', 'merge-pdf': 'PDF zusammenführen' },
    id: { 'compress-pdf': 'Kompres PDF', 'merge-pdf': 'Gabung PDF' }
  };
  const cleanH1 = {
    de: { 'compress-pdf': 'PDF komprimieren', 'merge-pdf': 'PDF zusammenführen' },
    id: { 'compress-pdf': 'Kompres PDF', 'merge-pdf': 'Gabung PDF' }
  };
  const base = () => ({
    titleMap, toolRows,
    titles: JSON.parse(JSON.stringify(cleanTitles)),
    h1s: JSON.parse(JSON.stringify(cleanH1))
  });

  const swapped = base(); swapped.titles.de['compress-pdf'] = 'Kompres PDF';   // dictionary leak
  const h1Leak = base(); h1Leak.h1s.de['merge-pdf'] = 'Gabung PDF';            // headline leak only
  const noEntry = base(); delete noEntry.titles.de['merge-pdf'];               // dropped from dict
  const noPage = base(); delete noPage.h1s.id['compress-pdf'];                 // page never built
  const twinCase = {
    titleMap: { 'compress-pdf': { de: 'Kompres PDF', id: 'Kompres PDF' } }, toolRows,
    titles: { de: { 'compress-pdf': 'Kompres PDF' }, id: { 'compress-pdf': 'Kompres PDF' } },
    h1s: { de: { 'compress-pdf': 'Kompres PDF' }, id: { 'compress-pdf': 'Kompres PDF' } }
  };
  const cases = [
    ['a correct build has no leak', judge(base()), r => !r.leaks.length && r.counts.titleChecks === 4 && r.counts.h1Checks === 4],
    ['the de-carries-id-string dictionary leak is caught', judge(swapped), r => r.leaks.length === 1
      && r.leaks[0].locale === 'de' && r.leaks[0].want === 'title' && r.leaks[0].thief === 'id'],
    ['a leak that shows only in the h1 is caught', judge(h1Leak), r => r.leaks.length === 1
      && r.leaks[0].want === 'h1' && r.leaks[0].thief === 'id'],
    ['an entry missing from the built dictionary is caught', judge(noEntry),
      r => r.leaks.some(x => x.want === 'title' && /no entry/.test(x.why))],
    ['a page that was never built is caught', judge(noPage),
      r => r.leaks.some(x => x.want === 'h1' && /no page/.test(x.why))],
    ['a titles.json id outside the registry is caught', judge({ ...base(), titleMap: { 'no-such-tool': { de: 'x' } } }),
      r => r.leaks.length === 1 && r.leaks[0].want === 'registry'],
    ['two locales sharing one string are reported as a blind spot', judge(twinCase),
      r => !r.leaks.length && r.blind.length === 1],
    ['an empty override map compares nothing and says so', judge({ ...base(), titleMap: {} }),
      r => !r.leaks.length && !r.blind.length && r.counts.titleChecks === 0],
    ['an empty build is reported as leaks, not as success', judge({ titleMap, toolRows, titles: {}, h1s: {} }),
      r => r.counts.titleChecks === 4 && r.leaks.length === 8]
  ];
  let bad = 0;
  for (const [name, got, ok] of cases) {
    const pass = ok(got);
    if (!pass) bad++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` -> ${JSON.stringify(got.leaks.slice(0, 3))}`}`);
  }
  if (bad) {
    console.log(`selftest: ${bad} case(s) failed — this check would not see a locale leak`);
    process.exit(1);
  }
  if (cases.length < 6) { console.log('selftest: too few cases to mean anything'); process.exit(1); }
  console.log(`selftest ok — ${cases.length} cases: dictionary leak, h1-only leak, missing dict entry, missing page, unregistered id, twin blind spot, empty build`);
  // deliberately no exit here: --selftest gates the real scan (a broken ruler must stop the build),
  // but passing the ruler is not the deliverable — scanning dist/ is.
}

const cfg = await read('config', 'site.json');
const tools = Object.values(await read('src', 'data', 'tools.json'));
// titles.json is keyed locale-first ({ de: { 'compress-pdf': '…' } }); the check wants it
// tool-first so one tool's strings can be compared across the locales that define it
const byLocale = await read('src', 'locales', 'titles.json');
delete byLocale._note;
const titleMap = {};
for (const [locale, blk] of Object.entries(byLocale)) {
  for (const [id, value] of Object.entries(blk)) {
    titleMap[id] ??= {};
    titleMap[id][locale] = value;
  }
}

// dist/_assets/dict.<l>.js is `window.__TH_DICT = {…};` — one assignment; peel it and the semicolon
const dictTitles = {};
const dictErrors = [];
for (const l of cfg.locales) {
  try {
    const raw = (await readFile(join(ROOT, 'dist', '_assets', `dict.${l}.js`), 'utf8'))
      .replace(/^window\.__TH_DICT\s*=/, '').replace(/;\s*$/, '');
    const d = JSON.parse(raw);
    dictTitles[l] = Object.fromEntries(Object.entries(d.search || {}).map(([id, v]) => [id, v.title]));
  } catch (err) {
    dictErrors.push(`dict.${l}.js: ${String(err.message || err).split('\n')[0]}`);
  }
}

const h1s = {};
const pageErrors = [];
for (const l of cfg.locales) {
  h1s[l] = {};
  for (const t of tools) {
    try {
      const html = await readFile(join(ROOT, 'dist', l, t.cat, `${t.id}`, 'index.html'), 'utf8');
      const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      if (!m) { pageErrors.push(`${l}/${t.cat}/${t.id}: no <h1> in the page`); continue; }
      h1s[l][t.id] = m[1].replace(/<[^>]*>/g, '').trim();
    } catch {
      pageErrors.push(`${l}/${t.cat}/${t.id}/index.html: not built`);
    }
  }
}

const { leaks, blind, counts } = judge({ titleMap, toolRows: tools, titles: dictTitles, h1s });

console.log(`locale-leak check — ${Object.keys(dictTitles).length}/${cfg.locales.length} dictionaries, `
  + `${counts.titleChecks} title and ${counts.h1Checks} h1 comparisons`);
for (const e of [...dictErrors, ...pageErrors].slice(0, 8)) console.log(`  BUILD GAP ${e}`);
if (dictErrors.length + pageErrors.length > 8) console.log(`  … and ${dictErrors.length + pageErrors.length - 8} more gaps`);
// the slice being asserted has to be non-empty, or "no leaks" just means "nothing was compared"
if (!counts.titleChecks || !counts.h1Checks) {
  console.log('  FAIL nothing to compare — run `node build.mjs` first; this check proves nothing on an empty build');
  process.exit(1);
}
for (const l of leaks.slice(0, 30)) {
  console.log(`  LEAK ${l.id} [${l.locale}] ${l.want}: ${l.why || `built "${l.got}", expected "${l.expected}"${l.thief ? ` — that is ${l.thief}'s string` : ''}`}`);
}
if (leaks.length > 30) console.log(`  … and ${leaks.length - 30} more`);
console.log(`  ${leaks.length ? `${leaks.length} leak(s)` : 'no cross-locale leaks'}; `
  + `${blind.length} override string(s) are identical in two locales, so a swap between those two is invisible here (harmless: the words are the same)`);
if (strict && (leaks.length || dictErrors.length || pageErrors.length)) process.exit(1);
