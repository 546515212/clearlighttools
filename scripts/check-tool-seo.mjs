#!/usr/bin/env node
// Gate for the ClearLight Tools per-locale tool SEO seed (src/seo/tool-seo/<locale>.json).
// Reads the seed + the authoritative localized names (_names.json, extracted from the built dict)
// and re-derives every tool's <title>/<description>/<h1> with the SAME pure composers the build
// uses (src/seo/compose.mjs), then asserts the owner's length contract:
//   EN tool title 50-60 cps (<=60 hard; <50 is a soft note for long-name fallbacks)
//   CJK tool title <=30 cps;  EN tool desc 135-158;  CJK tool desc 70-85;  other desc <=160
//   brand 'ClearLight Tools' verbatim in every title; verb in the locale's own script.
//
//   node scripts/check-tool-seo.mjs                 all locales present in config
//   node scripts/check-tool-seo.mjs --locale zh     one locale (translators self-check with this)
//   node scripts/check-tool-seo.mjs --selftest      in-memory cases + counter-proofs
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';
import { CJK, cps, toolTitle, toolDesc, toolH1, plainTitle, lengthVerdict, TITLE_MAX, EN_TOOL_DESC, CJK_TOOL_DESC, OTHER_DESC_MAX } from '../src/seo/compose.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = n => argv.includes(n);

const SCRIPT = { zh: /[\u4e00-\u9fff]/, ja: /[\u3040-\u30ff\u4e00-\u9fff]/, ko: /[\uac00-\ud7af]/, ru: /[\u0400-\u04ff]/, hi: /[\u0900-\u097f]/ };
const FIXED_KEYS = ['free', 'freeOnline', 'conn', 'tail', 'homeH1'];

// judge one already-composed tool row. Split out so the selftest can feed a sabotaged title
// (e.g. one that dropped the brand) without going through the composer that always appends it.
export function judgeToolRow({ locale, id, title, desc, verb, brand }) {
  const findings = [];
  const add = (rule, why, soft = false) => findings.push({ locale, id, rule, why, soft });
  const v = lengthVerdict(locale, title, desc);
  if (!title.includes(brand)) add('BRAND', `title does not carry "${brand}": ${title}`);
  if (!v.titleOk) add('TLEN', v.notes.find(n => n.startsWith('title')) || `title ${v.tl} over budget`);
  else if (v.notes.some(n => n.startsWith('title'))) add('TLEN', v.notes.find(n => n.startsWith('title')), true);
  if (!v.descOk) add('DLEN', v.notes.find(n => n.startsWith('desc')) || `desc ${v.dl} outside budget`);
  else if (v.notes.some(n => n.startsWith('desc'))) add('DLEN', v.notes.find(n => n.startsWith('desc')), true);
  const re = SCRIPT[locale];
  if (re && verb && !re.test(verb)) add('SCRIPT', `verb has no ${locale} script char (Latin leak?): ${verb}`);
  return findings;
}

// judge one locale's seed against its names. Pure so the selftest can sabotage every rule.
export function judgeLocale({ locale, seed, names, tools, brand }) {
  const findings = [];
  const add = (id, rule, why, soft = false) => findings.push({ locale, id, rule, why, soft });
  const fx = seed.fixed || {};
  for (const k of FIXED_KEYS) if (!String(fx[k] ?? '').trim()) add('*', 'FIX', `fixed.${k} missing/empty`);
  const seenVerb = new Map();
  for (const t of tools) {
    const entry = (seed.tools || {})[t.id];
    const name = names[t.id] || t.id;
    if (!entry) { add(t.id, 'MISS', 'no seed entry for this tool'); continue; }
    if (!String(entry.verb ?? '').trim()) add(t.id, 'VERB', 'verb missing/empty');
    if (!String(entry.action ?? '').trim() && !CJK.has(locale)) add(t.id, 'ACT', 'action missing/empty');
    const title = toolTitle(name, locale, entry, fx, brand);
    const desc = toolDesc(name, entry, fx, locale);
    findings.push(...judgeToolRow({ locale, id: t.id, title, desc, verb: entry.verb, brand }));
    // Descriptions are auto-unique (each embeds the tool's own name); the lazy-translation risk is a
    // reused VERB across tools, so that is what DUP watches. Soft note, not a hard block.
    const vb = String(entry.verb || '').trim();
    if (vb && seenVerb.has(vb)) add(t.id, 'DUP', `verb identical to ${seenVerb.get(vb)}`, true);
    else if (vb) seenVerb.set(vb, t.id);
  }
  return { findings, tools: tools.length };
}

// ---------------------------------------------------------------- selftest
async function selftest() {
  const brand = 'ClearLight Tools';
  const enFx = { free: 'Free', freeOnline: 'Free Online', conn: ' with our free online ', tail: '. 100% browser-based, fast, and private—no login or file uploads required.', homeH1: 'Free Online Tools & Fast Browser Utilities' };
  const zhFx = { free: '免费', freeOnline: '免费在线', conn: '：', tail: '。100% 浏览器本地运行，免登录、不上传文件。', homeH1: '免费在线工具与快速浏览器实用工具' };
  let bad = 0;
  const ok = (name, cond, extra = '') => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' -> ' + extra}`); };

  // formula pins
  ok('EN rich title pin', toolTitle('Merge PDF', 'en', { action: 'join files' }, enFx, brand) === 'Free Online Merge PDF - join files - ClearLight Tools');
  ok('EN long-name fallback pin', toolTitle('Percentage Calculator', 'en', { action: 'find %' }, enFx, brand) === 'Free Percentage Calculator - ClearLight Tools');
  ok('CJK title keeps free + brand, drops action, compact sep', toolTitle('PDF 压缩', 'zh', { action: '压缩' }, zhFx, brand) === '免费PDF 压缩｜ClearLight Tools');
  ok('CJK over-30 drops the free prefix, keeps brand', toolTitle('一个非常长的中文工具名称超过限制', 'zh', { action: 'x' }, zhFx, brand) === '一个非常长的中文工具名称超过限制｜ClearLight Tools');
  ok('CJK titleName override shortens a long name to fit 30', toolTitle('Base64 エンコード / デコード', 'ja', { action: 'x', titleName: 'Base64 変換' }, { free: '無料', freeOnline: '無料オンライン' }, brand) === '無料Base64 変換｜ClearLight Tools' && cps(toolTitle('Base64 エンコード / デコード', 'ja', { action: 'x', titleName: 'Base64 変換' }, { free: '無料' }, brand)) <= 30);
  ok('non-CJK third tier drops free when name+brand alone is near 60', toolTitle('CSS-Schatten- und Grid-Generator', 'de', { action: 'x' }, { free: 'Kostenlos', freeOnline: 'Kostenlos Online' }, brand) === 'CSS-Schatten- und Grid-Generator - ClearLight Tools');
  ok('EN desc composes verb+conn+name+tail', toolDesc('Merge PDF', { verb: 'Join PDF files' }, enFx, 'en') === 'Join PDF files with our free online Merge PDF. 100% browser-based, fast, and private—no login or file uploads required.');
  ok('CJK desc composes freeOnline+name+conn+verb+tail', toolDesc('PDF 压缩', { verb: '压缩文件' }, zhFx, 'zh') === '免费在线PDF 压缩：压缩文件。100% 浏览器本地运行，免登录、不上传文件。');
  ok('EN h1 pin', toolH1('Merge PDF', 'en', enFx) === 'Free Online Merge PDF');
  ok('CJK h1 joins without space', toolH1('PDF 压缩', 'zh', zhFx) === '免费在线PDF 压缩');
  ok('plain title pin', plainTitle('Privacy Policy', brand) === 'Privacy Policy - ClearLight Tools');

  // length verdict bites, with counter-proofs (same string flips when the budget moves)
  const enDesc146 = 'x'.repeat(146);
  ok('EN desc 146 passes', lengthVerdict('en', 'Free Online X - y - ClearLight Tools', enDesc146).descOk);
  ok('EN desc 134 fails (below 135)', !lengthVerdict('en', 't', 'x'.repeat(134)).descOk);
  ok('EN desc 159 fails (above 158)', !lengthVerdict('en', 't', 'x'.repeat(159)).descOk);
  ok('CJK desc 80 passes', lengthVerdict('zh', '免费X - ClearLight Tools', 'x'.repeat(80)).descOk);
  ok('CJK desc 86 fails', !lengthVerdict('zh', 't', 'x'.repeat(86)).descOk);
  ok('CJK desc 69 fails', !lengthVerdict('zh', 't', 'x'.repeat(69)).descOk);
  ok('CJK title 31 fails', !lengthVerdict('zh', 'x'.repeat(31), 'x'.repeat(80)).titleOk);
  ok('other desc 161 fails', !lengthVerdict('fr', 't', 'x'.repeat(161)).descOk);
  ok('other desc 160 passes', lengthVerdict('fr', 't', 'x'.repeat(160)).descOk);
  // counter-proof: the EN desc verdict is really driven by the 135-158 window, not decorative
  ok('mutation: 158 ok / 159 not', lengthVerdict('en', 't', 'x'.repeat(158)).descOk && !lengthVerdict('en', 't', 'x'.repeat(159)).descOk);
  ok('mutation: CJK 85 ok / 86 not', lengthVerdict('zh', 't', 'x'.repeat(85)).descOk && !lengthVerdict('zh', 't', 'x'.repeat(86)).descOk);

  // judgeLocale: a clean EN seed is silent; sabotage each rule
  const tools = [{ id: 'merge-pdf' }, { id: 'split-pdf' }];
  const names = { 'merge-pdf': 'Merge PDF', 'split-pdf': 'Split PDF' };
  const goodSeed = { fixed: enFx, tools: {
    'merge-pdf': { action: 'join files', verb: 'Merge several PDF files into one document' },
    'split-pdf': { action: 'extract pages', verb: 'Split a PDF into separate pages or ranges' }
  } };
  const clean = judgeLocale({ locale: 'en', seed: goodSeed, names, tools, brand });
  ok('clean EN seed is silent', clean.findings.length === 0, JSON.stringify(clean.findings));
  ok('missing entry fires MISS', judgeLocale({ locale: 'en', seed: { fixed: enFx, tools: { 'merge-pdf': goodSeed.tools['merge-pdf'] } }, names, tools, brand }).findings.some(f => f.rule === 'MISS'));
  ok('empty verb fires VERB', judgeLocale({ locale: 'en', seed: { fixed: enFx, tools: { ...goodSeed.tools, 'merge-pdf': { action: 'join files', verb: '' } } }, names, tools, brand }).findings.some(f => f.rule === 'VERB'));
  ok('over-long EN desc fires DLEN hard', judgeLocale({ locale: 'en', seed: { fixed: enFx, tools: { ...goodSeed.tools, 'merge-pdf': { action: 'join files', verb: 'x'.repeat(120) } } }, names, tools, brand }).findings.some(f => f.rule === 'DLEN' && !f.soft));
  ok('Latin verb on zh fires SCRIPT', judgeLocale({ locale: 'zh', seed: { fixed: zhFx, tools: { 'merge-pdf': { action: '合并', verb: 'Merge PDF files' }, 'split-pdf': { action: '拆分', verb: '拆分PDF文件' } } }, names: { 'merge-pdf': 'PDF 合并', 'split-pdf': 'PDF 拆分' }, tools, brand }).findings.some(f => f.rule === 'SCRIPT'));
  ok('duplicate desc fires DUP', judgeLocale({ locale: 'en', seed: { fixed: enFx, tools: { 'merge-pdf': goodSeed.tools['merge-pdf'], 'split-pdf': goodSeed.tools['merge-pdf'] } }, names, tools, brand }).findings.some(f => f.rule === 'DUP'));
  // counter-proof: brand presence is really checked, on a pre-composed title (the composer always
  // appends the brand it is handed, so a brand-less title can only be fed to judgeToolRow directly).
  const brandlessRow = { locale: 'en', id: 'merge-pdf', title: 'Free Online Merge PDF - join files', desc: enDesc146, verb: 'Merge several PDF files into one document', brand };
  ok('title without brand fires BRAND', judgeToolRow(brandlessRow).some(f => f.rule === 'BRAND'));
  ok('title with brand is silent on BRAND', !judgeToolRow({ ...brandlessRow, title: 'Free Online Merge PDF - join files - ClearLight Tools' }).some(f => f.rule === 'BRAND'));

  if (bad) { console.error(`\nselftest: ${bad} case(s) wrong`); process.exit(1); }
  console.log('\nselftest: formula pins + length verdicts + counter-proofs + judge sabotage all pass\n');
}

// ---------------------------------------------------------------- main
if (flag('--selftest')) { await selftest(); process.exit(0); }

const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));
const tools = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const brand = cfg.brand;
const names = JSON.parse(await readFile(join(ROOT, 'src', 'seo', 'tool-seo', '_names.json'), 'utf8'));
const only = opt('locale');
const locales = only ? [only] : cfg.locales;

const all = [];
const missingLocale = [];
for (const l of locales) {
  const p = join(ROOT, 'src', 'seo', 'tool-seo', `${l}.json`);
  if (!existsSync(p)) { missingLocale.push(l); continue; }
  const seed = JSON.parse(await readFile(p, 'utf8'));
  const r = judgeLocale({ locale: l, seed, names: names[l] || {}, tools, brand });
  all.push(...r.findings);
  const hard = r.findings.filter(f => !f.soft), soft = r.findings.filter(f => f.soft);
  console.log(`  ${l.padEnd(3)} tools ${String(r.tools).padStart(2)}  hard ${String(hard.length).padStart(2)}  soft ${String(soft.length).padStart(2)}`);
}
if (missingLocale.length) console.log(`  MISSING seed files: ${missingLocale.join(', ')}`);

const hard = all.filter(f => !f.soft), soft = all.filter(f => f.soft);
if (soft.length) {
  console.log(`\n  soft notes: ${soft.length}`);
  for (const f of soft.slice(0, 12)) console.log(`    ${f.locale} ${f.id} [${f.rule}] ${f.why}`);
  if (soft.length > 12) console.log(`    … ${soft.length - 12} more`);
}
if (hard.length) {
  console.log(`\n  HARD FINDINGS: ${hard.length}`);
  for (const f of hard.slice(0, 60)) console.log(`    ${f.locale} ${f.id} [${f.rule}] ${f.why}`);
  if (hard.length > 60) console.log(`    … ${hard.length - 60} more`);
}
if (!locales.length || (!all.length && missingLocale.length === locales.length)) { console.error('\nEMPTY RUN: no seed file was read'); process.exit(1); }
if (missingLocale.length || hard.length) { console.error(`\n${missingLocale.length} missing locale(s) + ${hard.length} hard finding(s).`); process.exit(1); }
console.log(`\n  ok — tool SEO seed fits the contract for ${locales.length} locale(s)\n`);