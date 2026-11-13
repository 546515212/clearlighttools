#!/usr/bin/env node
// Is every page's TKD (Title, Description, h1) present, search-shaped, in the page's OWN language,
// and does the site ship the 2026 international-SEO tag contract?
//
//   node scripts/check-tkd.mjs              # scan every built page, exit 1 on any hard finding
//   node scripts/check-tkd.mjs --locale zh  # one locale
//   node scripts/check-tkd.mjs --selftest   # in-memory cases, one per rule, each with a counter-proof
//
// The owner's overhaul changed the contract this gate enforces:
//   * NO page ships <meta name="keywords"> any more (Google ignores it; owner request). The old K1-K7
//     rules are gone; NK now fires if ANY page still carries the tag — including home.
//   * Tool <title>/<description>/<h1> are composed by src/seo/compose.mjs from the per-locale seed
//     src/seo/tool-seo/<locale>.json. This gate re-derives them with the SAME pure functions and the
//     SAME name source the template uses (the built client dict's search[id].title), so a build that
//     borrowed another locale's seed, or a regression to the bare navigation label, is a T4/D3/H1
//     finding. Length is the owner's per-script window: EN title 50-65 (<=65 hard, <50 soft long-name
//     fallback), CJK title <=30; EN desc 135-158, CJK desc 70-85, other desc <=160 (<120 soft).
//   * Home title/desc are owner-specified per locale in src/seo/keywords.json (homeTitle/homeDesc);
//     home h1 is the seed's fixed.homeH1. The home description is exempt from the tool length window
//     (it is a different page type, owner-exact) but still gated for presence/brand/distinctness.
//   * Category/all titles are catTitle(seoName, locale, fx, brand) and their h1 is toolH1(seoName),
//     where seoName is the long-tail category name from the seed's cats block (NOT the bare nav label);
//     the desc is catDesc(seoName, tagline). A regression to plainTitle(label) is a T4/H1/D3 finding.
//     Legal/404 titles are plainTitle(label, brand) = "<label> | <brand>" (built title = "<h1> | <brand>").
//   * Brand is "ClearLight Tools" verbatim in every title. Length is counted in code points.
//   * Length budgets are SERP-truncation rules, so they bind only INDEXABLE pages. A noindex page
//     (404, contact) never appears in results; its title/desc length is exempt (isIndexable), while
//     brand, exact-form, script and no-keywords rules still apply. check-seo-tags guarantees those
//     pages really are noindex, so the exemption cannot mask an indexable over-length regression.
//
// The technical tag structure (self-canonical, full hreflang + x-default, the single sitemap.xml, domain)
// is gated separately by scripts/check-seo-tags.mjs; this file owns the TKD content contract.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';
import { CJK, cps, toolTitle, toolDesc, toolH1, plainTitle, catTitle, catDesc, lengthVerdict } from '../src/seo/compose.mjs';
import { localeSources, applySource, localeFile } from './lib-locale-layers.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = n => argv.includes(n);

// Generic SERP budgets for NON-tool pages (home/category/all/legal/404/root). Tool pages use the
// owner's stricter per-script window in compose.mjs lengthVerdict instead. The non-CJK title ceiling
// is 65 (was 60) to match compose.mjs TITLE_MAX.other and the owner's richer long-tail category titles.
const TITLE_MAX_CJK = 30, TITLE_MAX_OTHER = 65;
const DESC_SOFT = 160, DESC_HARD = 170;
const HOME_DESC_HARD = 200;   // owner-specified home desc: a sanity cap, not the tool window
const unescape = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// The script a non-tool page's title must contain. Latin-script locales share an alphabet, so script
// cannot tell them apart — for those the exact re-derivation and brand rules carry the weight.
const SCRIPT = {
  zh: /[\u4e00-\u9fff]/,
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/,
  ko: /[\uac00-\ud7af]/,
  ru: /[\u0400-\u04ff]/,
  hi: /[\u0900-\u097f]/
};

export function metaContent(html, name) {
  const m = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i').exec(html);
  return m ? unescape(m[1]) : null;
}
export function pageTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return m ? unescape(m[1]).trim() : null;
}
export function pageH1(html) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? unescape(m[1].replace(/<[^>]*>/g, '')).trim() : null;
}
export function hasKeywords(html) { return /<meta\s+name="keywords"/i.test(html); }
export function robotsOf(html) {
  const m = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(html);
  return m ? unescape(m[1]) : null;
}
// A page is indexable unless its robots meta says noindex. The SERP-truncation length budgets below
// bind only indexable pages: a noindex page (404, contact) never appears in search results, so an
// over-length title/description there is not a truncation defect. check-seo-tags.mjs separately
// guarantees 404/contact really are noindex, so this exemption cannot hide an indexable regression.
export const isIndexable = robots => !/noindex/i.test(robots || '');

// judge is pure so the selftest can feed it a sabotage of every rule without touching a built page.
// Each row: { locale, kind, path, title, desc, h1, keywordsPresent, expectedTitle?, expectedDesc?, expectedH1? }.
export function judge({ rows, brand }) {
  const findings = [];
  const add = (r, rule, why, soft = false) => findings.push({ locale: r.locale, kind: r.kind, path: r.path, rule, why, soft });
  for (const r of rows) {
    const isTool = r.kind === 'tool';
    const isHome = r.kind === 'home';
    const indexable = r.indexable !== false;   // default true for in-memory rows; noindex pages exempt from length
    // ---- NK: no page ships meta keywords (the K of TKD was removed site-wide, home included)
    if (r.keywordsPresent) add(r, 'NK', 'page ships <meta name="keywords"> — removed site-wide (2026 Google norms)');
    // ---- Title
    if (!r.title || !r.title.trim()) add(r, 'T1', 'no <title> on the page');
    else {
      // Length is a SERP-truncation budget: it binds only indexable pages (see isIndexable above).
      if (indexable) {
        if (isTool) {
          const v = lengthVerdict(r.locale, r.title, r.desc || '');
          if (!v.titleOk) add(r, 'T2', v.notes.find(n => n.startsWith('title')) || `title ${v.tl} over budget`);
          else if (v.notes.some(n => n.startsWith('title'))) add(r, 'T2', v.notes.find(n => n.startsWith('title')), true);
        } else {
          const tl = cps(r.title), max = CJK.has(r.locale) ? TITLE_MAX_CJK : TITLE_MAX_OTHER;
          if (tl > max) add(r, 'T2', `title is ${tl} characters, over the ${max} limit`);
        }
      }
      if (!r.title.includes(brand)) add(r, 'T3', `title does not carry the brand "${brand}"`);
      // Exact re-derivation: the built title must be what THIS locale's name + seed + brand compose to.
      if (r.expectedTitle !== undefined && r.title !== r.expectedTitle)
        add(r, 'T4', `title is not this locale's SEO form: built "${r.title}", expected "${r.expectedTitle}"`);
      // A non-tool page in an unambiguous-script locale must actually carry that script (catches a
      // Latin/English leak on category/legal/home titles). Tool titles are exact-checked instead.
      const re = SCRIPT[r.locale];
      if (!isTool && r.kind !== 'root' && re && !re.test(r.title))
        add(r, 'SCRIPT', `title carries no ${r.locale} script character — likely an English/Latin leak`);
    }
    // ---- Description
    if (!r.desc || !r.desc.trim()) add(r, 'D1', 'no meta description on the page');
    else {
      if (indexable) {
        if (isTool) {
          const v = lengthVerdict(r.locale, r.title || '', r.desc);
          if (!v.descOk) add(r, 'D2', v.notes.find(n => n.startsWith('desc')) || `desc ${v.dl} outside budget`);
          else if (v.notes.some(n => n.startsWith('desc'))) add(r, 'D2', v.notes.find(n => n.startsWith('desc')), true);
        } else if (!isHome) {
          const dl = cps(r.desc);
          if (dl > DESC_HARD) add(r, 'D2', `description is ${dl} characters, over the ${DESC_HARD} limit`);
          else if (dl > DESC_SOFT) add(r, 'D2', `description is ${dl} characters, past the ~${DESC_SOFT} truncation line`, true);
        }
      }
      // home desc is owner-specified per locale: length-exempt here (judgeData caps it at HOME_DESC_HARD)
      if (r.expectedDesc !== undefined && r.desc !== r.expectedDesc)
        add(r, 'D3', `description is not this locale's composed form: built "${r.desc.slice(0, 80)}", expected "${r.expectedDesc.slice(0, 80)}"`);
    }
    // ---- H1 (the root language chooser has no h1 by design)
    if (r.kind !== 'root') {
      if (!r.h1 || !r.h1.trim()) add(r, 'H1', 'no <h1> on the page');
      else if (r.expectedH1 !== undefined && r.h1 !== r.expectedH1)
        add(r, 'H1', `h1 is not the composed form: built "${r.h1}", expected "${r.expectedH1}"`);
    }
  }
  return { findings, rows: rows.length };
}

// The home TKD source (src/seo/keywords.json) must cover every locale with a concise, branded,
// distinct title and a present, distinct description. Tool seeds are gated by check-tool-seo.mjs.
export function judgeData({ seo, locales, brand }) {
  const findings = [];
  const homeBrand = seo.homeBrand || brand;
  for (const l of locales) {
    const ht = seo.homeTitle?.[l];
    if (!String(ht ?? '').trim()) findings.push({ rule: 'DATA', why: `homeTitle missing for ${l}` });
    else {
      const max = CJK.has(l) ? TITLE_MAX_CJK : TITLE_MAX_OTHER;
      if (cps(ht) > max) findings.push({ rule: 'DATA', why: `homeTitle for ${l} is ${cps(ht)} characters, over ${max}` });
      if (!ht.includes(homeBrand)) findings.push({ rule: 'DATA', why: `homeTitle for ${l} does not carry the home brand "${homeBrand}"` });
      if (l !== 'en' && seo.homeTitle.en && ht === seo.homeTitle.en) findings.push({ rule: 'DATA', why: `homeTitle for ${l} is a copy of the English title` });
    }
    const hd = seo.homeDesc?.[l];
    if (!String(hd ?? '').trim()) findings.push({ rule: 'DATA', why: `homeDesc missing for ${l}` });
    else {
      if (cps(hd) > HOME_DESC_HARD) findings.push({ rule: 'DATA', why: `homeDesc for ${l} is ${cps(hd)} characters, over the ${HOME_DESC_HARD} sanity cap` });
      if (l !== 'en' && seo.homeDesc.en && hd === seo.homeDesc.en) findings.push({ rule: 'DATA', why: `homeDesc for ${l} is a copy of the English description` });
    }
  }
  return { findings };
}

// ---------------------------------------------------------------- selftest
async function selftest() {
  const brand = 'ClearLight Tools';
  const enFx = { free: 'Free', freeOnline: 'Free Online', conn: ' with our free online ', tail: '. 100% browser-based, fast, and private—no login or file uploads required.', homeH1: 'Free Online Tools & Fast Browser Utilities' };
  const zhFx = { free: '免费', freeOnline: '免费在线', conn: '：', tail: '。100% 浏览器本地运行，免登录、不上传文件。', homeH1: '免费在线工具与快速浏览器实用工具' };
  let bad = 0;
  const ok = (name, cond, extra = '') => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' -> ' + extra}`); };

  // A clean tool row: real composed title/h1, a length-appropriate description filler (the desc copy
  // itself is gated by check-tool-seo; here we exercise the judge's length/exact/brand rules).
  const enTitle = toolTitle('Merge PDF', 'en', { action: 'join files' }, enFx, brand);
  const enH1 = toolH1('Merge PDF', 'en', enFx);
  const enDesc = 'x'.repeat(146);
  const cleanEnTool = { locale: 'en', kind: 'tool', path: 'en/pdf/merge-pdf/', title: enTitle, desc: enDesc, h1: enH1, keywordsPresent: false, expectedTitle: enTitle, expectedDesc: enDesc, expectedH1: enH1 };
  const zhTitle = toolTitle('PDF 压缩', 'zh', { action: '压缩' }, zhFx, brand);
  const zhH1 = toolH1('PDF 压缩', 'zh', zhFx);
  const zhDesc = 'x'.repeat(80);
  const cleanZhTool = { locale: 'zh', kind: 'tool', path: 'zh/pdf/compress-pdf/', title: zhTitle, desc: zhDesc, h1: zhH1, keywordsPresent: false, expectedTitle: zhTitle, expectedDesc: zhDesc, expectedH1: zhH1 };
  const homeTitleEn = 'Free Online Tools & Daily Web Utilities - ClearLight Tools';
  const cleanHome = { locale: 'en', kind: 'home', path: 'en/', title: homeTitleEn, desc: 'x'.repeat(163), h1: enFx.homeH1, keywordsPresent: false, expectedTitle: homeTitleEn, expectedDesc: 'x'.repeat(163), expectedH1: enFx.homeH1 };
  // A clean category row composes from the seed's long-tail cats seoName (NOT the bare nav label):
  // title = catTitle(seoName), h1 = toolH1(seoName), desc = catDesc(seoName, tagline). Real zh pdf seoName.
  const catSeoName = 'PDF工具与编辑器';
  const catTagline = '合并、拆分、压缩 PDF 文件';
  const catTitleZh = catTitle(catSeoName, 'zh', zhFx, brand);
  const catH1Zh = toolH1(catSeoName, 'zh', zhFx);
  const catDescZh = catDesc(catSeoName, catTagline, zhFx, 'zh');
  const cleanCat = { locale: 'zh', kind: 'category', path: 'zh/pdf/', title: catTitleZh, desc: catDescZh, h1: catH1Zh, keywordsPresent: false, expectedTitle: catTitleZh, expectedDesc: catDescZh, expectedH1: catH1Zh };

  ok('clean EN tool page is silent', judge({ rows: [cleanEnTool], brand }).findings.length === 0, JSON.stringify(judge({ rows: [cleanEnTool], brand }).findings));
  ok('clean CJK tool page is silent', judge({ rows: [cleanZhTool], brand }).findings.length === 0, JSON.stringify(judge({ rows: [cleanZhTool], brand }).findings));
  ok('clean home page (owner desc 163, no keywords) is silent', judge({ rows: [cleanHome], brand }).findings.length === 0, JSON.stringify(judge({ rows: [cleanHome], brand }).findings));
  ok('clean category page is silent', judge({ rows: [cleanCat], brand }).findings.length === 0, JSON.stringify(judge({ rows: [cleanCat], brand }).findings));

  // NK: the tag is forbidden on EVERY page, home included (inverse of the old home exemption).
  ok('keywords on a tool page fire NK', judge({ rows: [{ ...cleanEnTool, keywordsPresent: true }], brand }).findings.some(f => f.rule === 'NK'));
  ok('keywords on the HOME page fire NK too (no exemption)', judge({ rows: [{ ...cleanHome, keywordsPresent: true }], brand }).findings.some(f => f.rule === 'NK'));
  ok('absent keywords are silent on NK', !judge({ rows: [cleanEnTool], brand }).findings.some(f => f.rule === 'NK'));

  // T1 / T2 / T3 / T4
  ok('missing title fires T1', judge({ rows: [{ ...cleanEnTool, title: '' }], brand }).findings.some(f => f.rule === 'T1'));
  const longEn = 'Free Online ' + 'x'.repeat(55) + ' - ' + brand;
  ok('over-65 EN tool title fires T2 hard', judge({ rows: [{ ...cleanEnTool, title: longEn, expectedTitle: longEn }], brand }).findings.some(f => f.rule === 'T2' && !f.soft));
  const longZh = '免费' + 'x'.repeat(20) + '｜' + brand;   // 39 cps > 30
  ok('over-30 CJK tool title fires T2 hard', judge({ rows: [{ ...cleanZhTool, title: longZh, expectedTitle: longZh }], brand }).findings.some(f => f.rule === 'T2' && !f.soft));
  const shortEn = toolTitle('Percentage Calculator', 'en', { action: 'calculate percentages' }, enFx, brand);  // rich 76>65 -> mid "Free Percentage Calculator | brand" 45 cps (<50 soft)
  ok('EN long-name fallback title (<50) is a SOFT note, not hard', judge({ rows: [{ ...cleanEnTool, title: shortEn, expectedTitle: shortEn }], brand }).findings.some(f => f.rule === 'T2' && f.soft) && !judge({ rows: [{ ...cleanEnTool, title: shortEn, expectedTitle: shortEn }], brand }).findings.some(f => f.rule === 'T2' && !f.soft));
  ok('title without the brand fires T3', judge({ rows: [{ ...cleanEnTool, title: 'Free Online Merge PDF - join files', expectedTitle: 'Free Online Merge PDF - join files' }], brand }).findings.some(f => f.rule === 'T3'));
  ok('bare-label title (regression) fires T4', judge({ rows: [{ ...cleanEnTool, title: plainTitle('Merge PDF', brand) }], brand }).findings.some(f => f.rule === 'T4'));
  ok('title wearing another locale modifier fires T4', judge({ rows: [{ ...cleanEnTool, title: enTitle.replace('Free Online', 'Gratis Online') }], brand }).findings.some(f => f.rule === 'T4'));

  // D1 / D2 / D3
  ok('missing description fires D1', judge({ rows: [{ ...cleanEnTool, desc: '' }], brand }).findings.some(f => f.rule === 'D1'));
  ok('EN tool desc 159 fires D2 hard', judge({ rows: [{ ...cleanEnTool, desc: 'x'.repeat(159), expectedDesc: 'x'.repeat(159) }], brand }).findings.some(f => f.rule === 'D2' && !f.soft));
  ok('EN tool desc 134 fires D2 hard (below 135)', judge({ rows: [{ ...cleanEnTool, desc: 'x'.repeat(134), expectedDesc: 'x'.repeat(134) }], brand }).findings.some(f => f.rule === 'D2' && !f.soft));
  ok('CJK tool desc 86 fires D2 hard', judge({ rows: [{ ...cleanZhTool, desc: 'x'.repeat(86), expectedDesc: 'x'.repeat(86) }], brand }).findings.some(f => f.rule === 'D2' && !f.soft));
  ok('CJK tool desc 69 fires D2 hard', judge({ rows: [{ ...cleanZhTool, desc: 'x'.repeat(69), expectedDesc: 'x'.repeat(69) }], brand }).findings.some(f => f.rule === 'D2' && !f.soft));
  const frTool = { ...cleanEnTool, locale: 'fr', title: 'x'.repeat(40) + ' - ' + brand, expectedTitle: 'x'.repeat(40) + ' - ' + brand };
  ok('other-locale tool desc 161 fires D2 hard', judge({ rows: [{ ...frTool, desc: 'x'.repeat(161), expectedDesc: 'x'.repeat(161) }], brand }).findings.some(f => f.rule === 'D2' && !f.soft));
  ok('other-locale tool desc 100 is a SOFT note (<120)', judge({ rows: [{ ...frTool, desc: 'x'.repeat(100), expectedDesc: 'x'.repeat(100) }], brand }).findings.some(f => f.rule === 'D2' && f.soft));
  ok('tool desc that is not the composed form fires D3', judge({ rows: [{ ...cleanEnTool, desc: 'y'.repeat(146) }], brand }).findings.some(f => f.rule === 'D3'));
  // counter-proof: the home desc length exemption is home-only. The SAME 163-char desc on an EN tool
  // MUST fire D2 hard — otherwise the exemption leaked to every page.
  ok('mutation: 163-char desc is exempt on home but HARD on a tool', !judge({ rows: [cleanHome], brand }).findings.some(f => f.rule === 'D2') && judge({ rows: [{ ...cleanEnTool, desc: 'x'.repeat(163), expectedDesc: 'x'.repeat(163) }], brand }).findings.some(f => f.rule === 'D2' && !f.soft));

  // H1
  ok('missing h1 fires H1', judge({ rows: [{ ...cleanEnTool, h1: '' }], brand }).findings.some(f => f.rule === 'H1'));
  ok('tool h1 that is not the composed form fires H1', judge({ rows: [{ ...cleanEnTool, h1: 'Merge PDF' }], brand }).findings.some(f => f.rule === 'H1'));
  ok('home h1 that is not the seed homeH1 fires H1', judge({ rows: [{ ...cleanHome, h1: 'Some Other Headline' }], brand }).findings.some(f => f.rule === 'H1'));
  ok('root chooser needs no h1', judge({ rows: [{ locale: 'en', kind: 'root', path: 'index.html', title: `${brand} — choose your language`, desc: 'x'.repeat(80), h1: null, keywordsPresent: false, expectedTitle: `${brand} — choose your language` }], brand }).findings.length === 0);

  // SCRIPT on non-tool pages
  ok('a zh category title written in Latin fires SCRIPT', judge({ rows: [{ ...cleanCat, title: `PDF Tools - ${brand}`, expectedTitle: `PDF Tools - ${brand}` }], brand }).findings.some(f => f.rule === 'SCRIPT'));
  ok('a zh category title with Han is silent on SCRIPT', !judge({ rows: [cleanCat], brand }).findings.some(f => f.rule === 'SCRIPT'));

  // Category contract regression: the listing title/h1/desc must be the long-tail catTitle/toolH1/
  // catDesc(seoName), NOT the old bare plainTitle(label)/label/tagline-less desc. Each regression fires.
  ok('category bare-label title (regression) fires T4', judge({ rows: [{ ...cleanCat, title: plainTitle('PDF 工具', brand) }], brand }).findings.some(f => f.rule === 'T4'));
  ok('category bare-label h1 (regression) fires H1', judge({ rows: [{ ...cleanCat, h1: 'PDF 工具' }], brand }).findings.some(f => f.rule === 'H1'));
  ok('category desc that is not catDesc(seoName) fires D3', judge({ rows: [{ ...cleanCat, desc: 'x'.repeat(100) }], brand }).findings.some(f => f.rule === 'D3'));

  // Non-tool 65-cp ceiling counter-proof: the budget binds category/all/legal too, not just tools.
  // 65 cps is within budget (fully silent); 66 cps fires T2 hard. Proves TITLE_MAX_OTHER=65 really bites.
  const catEn65 = { locale: 'en', kind: 'category', path: 'en/image/', title: 'x'.repeat(46) + ' | ' + brand, desc: 'x'.repeat(100), h1: 'Image Tools', keywordsPresent: false };
  catEn65.expectedTitle = catEn65.title;
  ok('non-tool title 65 cps is within budget (silent)', judge({ rows: [catEn65], brand }).findings.length === 0, JSON.stringify(judge({ rows: [catEn65], brand }).findings));
  ok('non-tool title 66 cps fires T2 hard (65 ceiling bites)', judge({ rows: [{ ...catEn65, title: 'x'.repeat(47) + ' | ' + brand, expectedTitle: 'x'.repeat(47) + ' | ' + brand }], brand }).findings.some(f => f.rule === 'T2' && !f.soft));

  // counter-proof: the per-script budgets really bite via lengthVerdict (the tool-path ruler).
  ok('mutation: lengthVerdict CJK title 30 ok / 31 not', lengthVerdict('zh', 'x'.repeat(30), 'x'.repeat(80)).titleOk && !lengthVerdict('zh', 'x'.repeat(31), 'x'.repeat(80)).titleOk);
  ok('mutation: lengthVerdict EN desc 158 ok / 159 not', lengthVerdict('en', 't', 'x'.repeat(158)).descOk && !lengthVerdict('en', 't', 'x'.repeat(159)).descOk);

  // ---- noindex length exemption: SERP-truncation budgets bind only indexable pages. A noindex 404
  // (or contact) never appears in results, so an over-length title/desc there is not a truncation
  // defect — but the SAME string on an indexable page still fires, and brand/keywords/exact still bite.
  const koH1 = '도구를 찾을 수 없습니다';                 // 13 cps
  const ko404Title = plainTitle(koH1, brand);            // 32 cps > the 30 CJK cap
  const noindex404 = { locale: 'ko', kind: '404', path: 'ko/404.html', title: ko404Title, desc: 'x'.repeat(40), h1: koH1, keywordsPresent: false, indexable: false, expectedTitle: ko404Title };
  ok('noindex 404 with a 32cps CJK title is exempt from T2 length', !judge({ rows: [noindex404], brand }).findings.some(f => f.rule === 'T2'));
  ok('the SAME 32cps title on an INDEXABLE page fires T2 hard', judge({ rows: [{ ...noindex404, indexable: true }], brand }).findings.some(f => f.rule === 'T2' && !f.soft));
  ok('noindex 404 with a 180cps desc is exempt from D2 length', !judge({ rows: [{ ...noindex404, desc: 'x'.repeat(180) }], brand }).findings.some(f => f.rule === 'D2'));
  ok('the SAME 180cps desc on an INDEXABLE non-tool page fires D2 hard', judge({ rows: [{ ...noindex404, desc: 'x'.repeat(180), indexable: true }], brand }).findings.some(f => f.rule === 'D2' && !f.soft));
  ok('noindex 404 still fires T3 when the brand is missing', judge({ rows: [{ ...noindex404, title: koH1, expectedTitle: koH1 }], brand }).findings.some(f => f.rule === 'T3'));
  ok('noindex 404 still fires NK when keywords ship', judge({ rows: [{ ...noindex404, keywordsPresent: true }], brand }).findings.some(f => f.rule === 'NK'));
  ok('isIndexable: noindex -> false, index -> true, absent -> true', isIndexable('noindex,nofollow') === false && isIndexable('index,follow,max-image-preview:large') === true && isIndexable(null) === true);

  // ---- judgeData: home TKD source
  const fullSeo = { homeBrand: brand, homeTitle: { en: homeTitleEn, zh: `免费在线工具 - ${brand}` }, homeDesc: { en: 'Access clean, fast, and free online tools for everyday life and office work on ClearLight Tools—no login required.', zh: '面向日常与办公的免费在线工具，纯浏览器本地运行，免登录。' } };
  ok('data judge is silent on a complete home source', judgeData({ seo: fullSeo, locales: ['en', 'zh'], brand }).findings.length === 0, JSON.stringify(judgeData({ seo: fullSeo, locales: ['en', 'zh'], brand }).findings));
  ok('data judge names a missing homeTitle', judgeData({ seo: { ...fullSeo, homeTitle: { en: homeTitleEn } }, locales: ['en', 'zh'], brand }).findings.some(f => /homeTitle missing for zh/.test(f.why)));
  ok('data judge names a copied homeTitle', judgeData({ seo: { ...fullSeo, homeTitle: { en: homeTitleEn, zh: homeTitleEn } }, locales: ['en', 'zh'], brand }).findings.some(f => /homeTitle for zh is a copy/.test(f.why)));
  ok('data judge names an over-length CJK homeTitle', judgeData({ seo: { ...fullSeo, homeTitle: { ...fullSeo.homeTitle, zh: 'x'.repeat(31) + brand } }, locales: ['en', 'zh'], brand }).findings.some(f => /homeTitle for zh is \d+ characters, over 30/.test(f.why)));
  ok('data judge names a homeTitle without the brand', judgeData({ seo: { ...fullSeo, homeTitle: { en: 'Free Online Tools', zh: `免费在线工具 - ${brand}` } }, locales: ['en', 'zh'], brand }).findings.some(f => /does not carry the home brand/.test(f.why)));
  ok('data judge names a missing homeDesc', judgeData({ seo: { ...fullSeo, homeDesc: { en: fullSeo.homeDesc.en } }, locales: ['en', 'zh'], brand }).findings.some(f => /homeDesc missing for zh/.test(f.why)));
  ok('data judge names a copied homeDesc', judgeData({ seo: { ...fullSeo, homeDesc: { en: 'Same.', zh: 'Same.' } }, locales: ['en', 'zh'], brand }).findings.some(f => /homeDesc for zh is a copy/.test(f.why)));
  ok('data judge names an over-cap homeDesc', judgeData({ seo: { ...fullSeo, homeDesc: { ...fullSeo.homeDesc, zh: 'x'.repeat(HOME_DESC_HARD + 1) } }, locales: ['en', 'zh'], brand }).findings.some(f => /homeDesc for zh is \d+ characters, over/.test(f.why)));
  ok('data judge accepts the owner-exact 163-char EN home desc', !judgeData({ seo: { ...fullSeo, homeDesc: { ...fullSeo.homeDesc, en: 'x'.repeat(163) } }, locales: ['en'], brand }).findings.some(f => /homeDesc for en/.test(f.why)));

  // ---- parsers, against the markup the template really emits (entity-encoded attribute)
  const html = '<title>免费PDF 压缩｜ClearLight Tools</title><meta name="description" content="压缩PDF &amp; 保留排版"><h1>免费在线PDF 压缩</h1>';
  ok('parser reads the entity-encoded title', pageTitle(html) === '免费PDF 压缩｜ClearLight Tools');
  ok('parser reads the entity-encoded description', metaContent(html, 'description') === '压缩PDF & 保留排版');
  ok('parser reads the h1', pageH1(html) === '免费在线PDF 压缩');
  ok('parser reports an absent description as null', metaContent('<title>none</title>', 'description') === null);
  ok('hasKeywords detects the tag', hasKeywords('<meta name="keywords" content="a, b">') === true);
  ok('hasKeywords is false when absent', hasKeywords('<title>none</title>') === false);
  ok('robotsOf reads the noindex value', robotsOf('<meta name="robots" content="noindex,nofollow">') === 'noindex,nofollow');
  ok('robotsOf reads the index value', robotsOf('<meta name="robots" content="index,follow,max-image-preview:large">') === 'index,follow,max-image-preview:large');
  ok('robotsOf absent is null', robotsOf('<title>none</title>') === null);

  // ---- a live built page must still parse and re-derive, or the template moved underneath this check.
  // Conditional: --selftest proves the ruler in memory even before dist/ exists; the main sweep requires it.
  let liveChecked = false;
  if (existsSync(join(ROOT, 'dist'))) {
    for (const l of ['en', 'zh', 'ja']) {
      const p = join(ROOT, 'dist', l, 'pdf', 'compress-pdf', 'index.html');
      const seedP = join(ROOT, 'src', 'seo', 'tool-seo', `${l}.json`);
      const dictP = join(ROOT, 'dist', '_assets', `dict.${l}.js`);
      if (existsSync(p) && existsSync(seedP) && existsSync(dictP)) {
        const html2 = await readFile(p, 'utf8');
        const seed = JSON.parse(await readFile(seedP, 'utf8'));
        const d = JSON.parse((await readFile(dictP, 'utf8')).replace(/^window\.__TH_DICT\s*=/, '').replace(/;\s*$/, ''));
        const name = d.search?.['compress-pdf']?.title || 'compress-pdf';
        const entry = seed.tools?.['compress-pdf'] || {};
        const want = toolTitle(name, l, entry, seed.fixed, brand);
        const got = pageTitle(html2);
        ok(`live page re-derives: ${l} compress-pdf title`, got === want, `built "${got}", expected "${want}"`);
        ok(`live ${l} compress-pdf ships no keywords`, !hasKeywords(html2));
        liveChecked = true;
        break;
      }
    }
  }
  if (!liveChecked) console.log('  note: no built tool page to re-derive yet (run `node build.mjs`); in-memory ruler proofs above still ran');

  if (bad) { console.error(`\nselftest: ${bad} case(s) wrong — this check would not see a TKD defect`); process.exit(1); }
  console.log('\nselftest: NK/T/D/H1/SCRIPT rule cases + counter-proofs + data judge + parsers all pass and the judge still bites\n');
}

// ---------------------------------------------------------------- main
if (flag('--selftest')) { await selftest(); process.exit(0); }

const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));
const tools = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const categories = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'categories.json'), 'utf8'));
const seo = JSON.parse(await readFile(join(ROOT, 'src', 'seo', 'keywords.json'), 'utf8'));
const only = opt('locale');
const locales = only ? [only] : cfg.locales;
const brand = cfg.brand;

if (!existsSync(join(ROOT, 'dist'))) {
  console.error('\ndist/ is missing — run `node build.mjs` first: this check reads the built pages, not the source');
  process.exit(1);
}

// The built client dictionaries carry the authoritative localized tool/category/nav strings (the same
// name source the template uses). Tool TKD is re-derived from these + the per-locale seed with the
// template's own composers, so T4/D3/H1 are exact comparisons against what THIS locale should produce.
const dicts = {};
const seeds = {};
for (const l of locales) {
  const raw = (await readFile(join(ROOT, 'dist', '_assets', `dict.${l}.js`), 'utf8'))
    .replace(/^window\.__TH_DICT\s*=/, '').replace(/;\s*$/, '');
  dicts[l] = JSON.parse(raw);
  const sp = join(ROOT, 'src', 'seo', 'tool-seo', `${l}.json`);
  seeds[l] = existsSync(sp) ? JSON.parse(await readFile(sp, 'utf8')) : null;
}

// The "all" listing's meta description is catDesc(seoName, footer.tagline). Unlike the category
// taglines (shipped in the client dict's `cat` block), footer.tagline is NOT in window.__TH_DICT — it
// only exists in the build-time merged dictionary. Re-derive it through the SAME layer merge build.mjs
// uses (chrome <l>.json over the English base, then bulk, then shards) so this gate answers from the
// build's authority instead of a second copy that could drift if a shard later overrides the tagline.
const enChrome = JSON.parse(await readFile(localeFile('en.json'), 'utf8'));
const footerTagline = {};
for (const l of locales) {
  const { sources } = await localeSources(l);
  let merged = enChrome;                       // applySource deep-copies, so the base is never mutated
  for (const src of sources) merged = applySource(merged, src);
  footerTagline[l] = merged.footer?.tagline;
}

const rows = [];
const gaps = [];
const readPage = async (l, rel, kind, ref = null) => {
  const p = join(ROOT, 'dist', l, rel);
  if (!existsSync(p)) { gaps.push(`${l}/${rel}`); return; }
  const html = await readFile(p, 'utf8');
  const d = dicts[l];
  const seed = seeds[l];
  const fx = seed && seed.fixed;
  const row = {
    locale: l, kind, path: `${l}/${rel}`,
    title: pageTitle(html), desc: metaContent(html, 'description'), h1: pageH1(html),
    keywordsPresent: hasKeywords(html), indexable: isIndexable(robotsOf(html))
  };
  if (kind === 'tool' && ref) {
    const name = d.search?.[ref]?.title || ref;
    const entry = (seed && seed.tools && seed.tools[ref]) || {};
    if (fx) {
      row.expectedTitle = toolTitle(name, l, entry, fx, brand);
      row.expectedDesc = toolDesc(name, entry, fx, l);
      row.expectedH1 = toolH1(name, l, fx);
    }
  } else if (kind === 'home') {
    row.expectedTitle = seo.homeTitle?.[l];
    row.expectedDesc = seo.homeDesc?.[l];
    row.expectedH1 = fx && fx.homeH1;
  } else if (kind === 'category' && ref) {
    // The listing <title>/<h1>/desc compose from the seed's long-tail cats seoName, not the nav label.
    const seoName = seed?.cats?.[ref];
    const tagline = d.cat?.[`${ref}.tagline`];
    if (fx && seoName !== undefined) {
      row.expectedTitle = catTitle(seoName, l, fx, brand);
      row.expectedH1 = toolH1(seoName, l, fx);
      row.expectedDesc = catDesc(seoName, tagline, fx, l);
    } else {
      const label = d.cat?.[ref];
      row.expectedTitle = label !== undefined ? plainTitle(label, brand) : plainTitle(row.h1, brand);
      row.expectedH1 = label;
    }
  } else if (kind === 'all') {
    const seoName = seed?.cats?.all;
    if (fx && seoName !== undefined) {
      row.expectedTitle = catTitle(seoName, l, fx, brand);
      row.expectedH1 = toolH1(seoName, l, fx);
      row.expectedDesc = catDesc(seoName, footerTagline[l], fx, l);
    } else {
      const label = d.nav?.allTools;
      row.expectedTitle = label !== undefined ? plainTitle(label, brand) : plainTitle(row.h1, brand);
      row.expectedH1 = label;
    }
  } else if (kind === 'legal' || kind === '404') {
    // label source (legal/footer/404) is not in the client dict; the plainTitle invariant ties the
    // built title to the built h1, and SCRIPT catches a Latin leak on the title.
    row.expectedTitle = row.h1 ? plainTitle(row.h1, brand) : undefined;
  } else if (kind === 'root') {
    row.expectedTitle = `${brand} — choose your language`;
  }
  rows.push(row);
};

for (const l of locales) {
  await readPage(l, 'index.html', 'home');
  for (const cat of Object.keys(categories)) await readPage(l, `${cat}/index.html`, 'category', cat);
  await readPage(l, 'all/index.html', 'all');
  for (const t of tools) await readPage(l, `${t.cat}/${t.id}/index.html`, 'tool', t.id);
  for (const slug of ['about', 'privacy', 'terms', 'dmca', 'contact']) await readPage(l, `${slug}/index.html`, 'legal');
  await readPage(l, '404.html', '404');
}
// the root language chooser is an English page; it ships no keywords either
if (!only && existsSync(join(ROOT, 'dist', 'index.html'))) {
  const html = await readFile(join(ROOT, 'dist', 'index.html'), 'utf8');
  rows.push({ locale: 'en', kind: 'root', path: 'index.html', title: pageTitle(html), desc: metaContent(html, 'description'), h1: pageH1(html), keywordsPresent: hasKeywords(html), indexable: isIndexable(robotsOf(html)), expectedTitle: `${brand} — choose your language` });
}

const dataRes = judgeData({ seo, locales, brand });
const { findings } = judge({ rows, brand });
const hard = findings.filter(f => !f.soft), soft = findings.filter(f => f.soft);

console.log(`\nTKD audit — ${rows.length} built page(s) over ${locales.length} locale(s); brand "${brand}", NO meta keywords on any page`);
console.log(`  tool budgets: EN title 50-65 / desc 135-158; CJK title <=30 / desc 70-85; other title <=65 / desc <=160 (code points)`);
if (gaps.length) console.log(`  BUILD GAP: ${gaps.length} page(s) missing: ${gaps.slice(0, 6).join(', ')}${gaps.length > 6 ? ' …' : ''}`);

const byLocale = {};
for (const r of rows) (byLocale[r.locale] ||= { n: 0, kw: 0 }).n++, byLocale[r.locale].kw += r.keywordsPresent ? 1 : 0;
for (const [l, o] of Object.entries(byLocale)) console.log(`  ${l.padEnd(3)} pages ${String(o.n).padStart(2)}  with keywords ${String(o.kw).padStart(2)} (must be 0)`);

for (const f of dataRes.findings) console.log(`  DATA ${f.why}`);
if (soft.length) {
  console.log(`\n  past the soft budget (notes): ${soft.length}`);
  for (const f of soft.slice(0, 10)) console.log(`    ${f.locale} ${f.kind} ${f.path}  ${f.why}`);
  if (soft.length > 10) console.log(`    … ${soft.length - 10} more`);
}
if (hard.length) {
  console.log(`\n  HARD FINDINGS: ${hard.length}`);
  for (const f of hard.slice(0, 40)) console.log(`    ${f.locale} ${f.kind} ${f.path}  [${f.rule}] ${f.why}`);
  if (hard.length > 40) console.log(`    … ${hard.length - 40} more`);
}

// Empty-run guard: a moved dist, a renamed attribute or a narrowed locale list must not report a
// comfortable 0. Every listed locale must contribute its full page set, plus the root chooser.
const perLocale = 1 + Object.keys(categories).length + 1 + tools.length + 5 + 1;
const expected = locales.length * perLocale + (only ? 0 : 1);
if (!rows.length) { console.error('\nEMPTY RUN: not one built page was read — the markup or the dist path is not what this check reads'); process.exit(1); }
if (rows.length < expected * 0.9) { console.error(`\nEMPTY RUN: only ${rows.length} of ${expected} pages were read — dist/ is incomplete for the locales in config/site.json`); process.exit(1); }
if (dataRes.findings.length || hard.length || gaps.length) {
  console.error(`\n${dataRes.findings.length} data + ${hard.length} page hard finding(s) + ${gaps.length} build gap(s).`);
  process.exit(1);
}
console.log(`\n  ok — every built page carries a search-shaped title, description and h1 in its own language, with no meta keywords (${rows.length} measured)\n`);
