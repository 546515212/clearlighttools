#!/usr/bin/env node
// Mount and click every tool in every built locale, not just English.
//
//   node scripts/smoke-all.mjs              all 12 non-English locales (~1 min)
//   node scripts/smoke-all.mjs --only de,ja two locales
//   node scripts/smoke-all.mjs --selftest   prove a broken locale dictionary is reported as a failure
//
// Why this exists: `npm run smoke` mounts 49 tools against `dist/_assets/dict.en.js` and calls that
// the browser gate. It is a fine English test and a poor translation test. A locale can pass every
// static check — shape, keys, placeholders, coverage up, widget labels all reaching dist — and still
// crash a page, because a dictionary value is not always prose. The date calculator reads
// `{ weekday: L('long', 'long') }` from the dictionary as an Intl option, twelve machine translations
// dutifully translated it, and the tool threw RangeError as soon as it rendered: valid HTML, correct
// coverage, dead calculator. Only running the page with that dictionary sees it.
//
// So this is the execution half of the translation gate: one real mount per locale, and the smoke
// script's own exit code as the verdict. It never edits a source file; the only dist it touches is
// the temporary sabotage the selftest needs, and it puts those bytes back.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib-node.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const selftest = argv.includes('--selftest');
const only = (opt('only') || '').split(',').filter(Boolean);

const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));
const dictPath = l => join(ROOT, 'dist', '_assets', `dict.${l}.js`);

// One locale: mount, click, and keep the lines a human needs when it fails.
function runLocale(locale) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'smoke.mjs'), '--clicks', '--locale', locale], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const mounted = (out.match(/smoke \([a-z-]+\): (\d+)\/(\d+) tools mounted/) || []).slice(1);
  const fails = out.split('\n').filter(l => /^\s*FAIL\b/.test(l)).map(l => l.trim());
  const err = out.split('\n').filter(l => /Error:/.test(l)).slice(0, 3);
  // a run that never printed its mount count is not a pass: the tally line moved, and an unreadable
  // smoke script would report twelve silent greens
  const code = r.status === 0 && (!mounted[0] || !mounted[1]) ? 1 : r.status;
  return { locale, code, secs: (Date.now() - t0) / 1000, got: mounted[0] || '?', want: mounted[1] || '?', fails, err };
}

function line(res) {
  const head = `  ${res.locale}  ${res.code === 0 ? 'ok   ' : 'FAIL '} ${res.got}/${res.want} tools  ${res.secs.toFixed(1)}s`;
  return res.code === 0 ? head
    : head + '\n' + [...res.fails.slice(0, 8), ...res.err.slice(0, 3)].map(l => `        ${l}`).join('\n');
}

async function run(locales) {
  const results = [];
  for (const l of locales) {
    if (!existsSync(dictPath(l))) { console.log(`  ${l}  SKIP — dist/_assets/dict.${l}.js missing (run node build.mjs)`); results.push({ locale: l, code: 2 }); continue; }
    const res = runLocale(l);
    console.log(line(res));
    results.push(res);
  }
  return results;
}

// ---------------------------------------------------------------- selftest
// A green gate that cannot go red is not a gate. Sabotage one built dictionary the way a machine
// translation really does — a correct key with a value the code cannot use — and require the runner
// to report that locale as failed, then restore the file byte for byte.
if (selftest) {
  const locale = (cfg.locales.find(l => l !== 'en') || null);
  if (!locale) { console.error('EMPTY RUN: no non-English locale to sabotage'); process.exit(1); }
  if (!existsSync(dictPath(locale))) { console.error(`EMPTY RUN: ${dictPath(locale)} missing — run node build.mjs first`); process.exit(1); }
  const original = await readFile(dictPath(locale), 'utf8');
  let bad = 0;
  try {
    const clean = runLocale(locale);
    if (clean.code !== 0) { bad++; console.log(`  FAIL the honest run for ${locale} did not pass: ${JSON.stringify(clean.fails)}`); }
    else console.log(`  ok   ${locale} passes with its real dictionary (${clean.got}/${clean.want} tools)`);
    const marker = '"long":"long"';
    if (!original.includes(marker)) {
      bad++;
      console.log(`  FAIL cannot build the sabotage: ${marker} is not in dict.${locale}.js — the dictionary format moved`);
    } else {
      await writeFile(dictPath(locale), original.replace(marker, '"long":"lang"'), 'utf8');
      const sabotaged = runLocale(locale);
      if (sabotaged.code === 0) {
        bad++;
        console.log(`  FAIL ${locale} passed with a translated Intl option — the smoke run is not executing that code path`);
      } else {
        console.log(`  ok   ${locale} fails with the sabotaged option (${sabotaged.got}/${sabotaged.want} mounted, exit ${sabotaged.code})`);
      }
    }
  } finally {
    await writeFile(dictPath(locale), original, 'utf8');
    const back = await readFile(dictPath(locale), 'utf8');
    if (back !== original) { console.error('  FAIL the sabotaged dictionary could not be restored — dist is dirty'); process.exit(1); }
    console.log(`  ok   dict.${locale}.js restored byte for byte`);
  }
  if (bad) { console.error(`\nselftest: ${bad} case(s) wrong\n`); process.exit(1); }
  console.log('\nselftest: the locale sweep really runs the pages and really notices a broken dictionary\n');
  process.exit(0);
}

// ---------------------------------------------------------------- run
const targets = only.length ? only : cfg.locales.filter(l => l !== 'en');
if (!targets.length) { console.error('EMPTY RUN: no locale to mount'); process.exit(1); }
console.log(`locale smoke — ${targets.length} locale(s), every tool mounted and clicked against its own dictionary`);
const results = await run(targets);
const failed = results.filter(r => r.code !== 0);
if (results.length < targets.length) { console.error(`\nonly ${results.length} of ${targets.length} locales ran`); process.exit(1); }
if (failed.length) {
  console.error(`\n${failed.length} locale(s) failed: ${failed.map(f => f.locale).join(', ')}`);
  process.exit(1);
}
console.log(`\n  ok — ${results.length} locales, ${results.reduce((a, r) => a + Number(r.got || 0), 0)} tool mounts, no locale-specific crash`);
