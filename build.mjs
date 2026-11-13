#!/usr/bin/env node
// Static site generator: config + data + dictionaries -> dist/
// Run `npm run build`. Output is plain HTML/CSS/JS, deployable to Vercel,
// Cloudflare Pages, Netlify, S3 or any nginx.
import { readFile, writeFile, mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const P = (...a) => join(ROOT, ...a);
const DIST = P('dist');

const readJson = async p => JSON.parse(await readFile(p, 'utf8'));
const j = (...a) => JSON.stringify(...a);

// ---------------------------------------------------------------- dictionaries
// Everything about how a locale is assembled — which files, in what order, in which shape — lives in
// scripts/lib-locale-layers.mjs, so the generator, the coverage report and the translation checker
// answer from one table instead of three. deepCopy/deepMerge used to be defined right here; read that
// file for why the merge copies instead of aliasing ("Kompres PDF" in nine locales) and why an empty
// value never erases the English sitting underneath it.
import {
  applySource, deepMerge, leaves, localeSources, localeFile, normaliseToolsDict, ownLayer
} from './scripts/lib-locale-layers.mjs';

async function loadDictFile(file) {
  const p = localeFile(file);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf8'));
}

const cfg = await readJson(P('config', 'site.json'));
const categories = await readJson(P('src', 'data', 'categories.json'));
const tools = await readJson(P('src', 'data', 'tools.json'));
// Per-locale SEO data: concise home titles (the home T+D). The old long-tail keyword translations
// that used to fill <meta name="keywords"> are gone — 2026 Google international SEO ignores that tag,
// so no page ships it any more. Home title/desc still come from here; tool/category/legal TKD is
// composed by src/seo/compose.mjs from the per-locale seeds loaded below.
const seo = await readJson(P('src', 'seo', 'keywords.json'));

const enChrome = await loadDictFile('en.json');
const enTools = normaliseToolsDict(await loadDictFile('en.tools.json'));
const titleOverrides = await loadDictFile('titles.json');
const TOOL_IDS = new Set(tools.map(t => t.id));

// Per-locale tool SEO seeds: { fixed:{free,freeOnline,conn,tail,homeH1}, tools:{id:{action,verb,titleName?}} }.
// templates.mjs composes each tool's <title>/<meta description>/<h1> from these via compose.mjs, so the
// build and the check-tool-seo gate answer from the same pure functions. A seed missing any tool would
// compose "undefined" into a live page, so the build refuses to run on an incomplete seed rather than
// silently shipping broken TKD (the authoring step / check-tool-seo fills and validates them first).
const toolSeo = {};
for (const l of cfg.locales) {
  const p = P('src', 'seo', 'tool-seo', `${l}.json`);
  if (!existsSync(p)) throw new Error(`missing tool SEO seed src/seo/tool-seo/${l}.json`);
  const seed = await readJson(p);
  const missing = tools.filter(t => !seed.tools || !seed.tools[t.id]).map(t => t.id);
  if (missing.length) throw new Error(`tool SEO seed "${l}" is missing ${missing.length} tool entries`
    + ` (e.g. ${missing.slice(0, 3).join(', ')}) — author them before building`);
  toolSeo[l] = seed;
}

const dicts = {};
const coverage = {};
const localeErrors = [];

// The English tables are the BASE every locale starts from.
const mergedEnglish = deepMerge(enChrome, { w: enTools.w || {}, t: enTools.t || {} });

for (const l of cfg.locales) {
  const { sources, errors } = await localeSources(l, { toolIds: TOOL_IDS });
  if (errors.length) localeErrors.push(...errors.map(e => `${l}: ${e}`));
  // chrome (<l>.json, and the `w` block it carries), then the bulk layer (<l>.tools.json), then the
  // shards in src/locales/<l>/ — in that order, so a shard is an edit and an edit wins.
  let merged = mergedEnglish;
  // The English tables used to be merged *over* the locale's own layer, which silently deleted the
  // 56 widget labels (width, height, format, quality, download, preview, …) that <locale>.json
  // carries in its `w` block: 54 of the 56 keys also exist in en.tools.json, so 11 of 13 locales
  // shipped English field labels on otherwise translated pages. Only zh escaped, because its widget
  // strings live in zh.tools.json and were re-applied by the bulk layer.
  for (const src of sources) merged = applySource(merged, src);
  // titles.json = cheap partial layer (nav label + h1) for locales without a full dictionary
  const ov = titleOverrides?.[l];
  if (ov && l !== 'en') {
    for (const [id, title] of Object.entries(ov)) {
      if (!title) continue;
      merged.t[id] = { ...merged.t[id], title, h1: merged.t[id]?.h1 && merged.t[id].h1 !== (enTools.t[id] || {}).h1 ? merged.t[id].h1 : title };
    }
  }
  // h1 falls back to the localised title, so a translated title never leaves an English headline
  for (const id of Object.keys(merged.t)) {
    const e = enTools.t[id] || {};
    const d = merged.t[id];
    if (!d.h1 || d.h1 === e.h1) d.h1 = d.title && d.title !== e.title ? d.title : (d.h1 || e.h1);
  }
  dicts[l] = merged;

  // A leaf counts as translated only when one of the locale's own layers supplied a non-empty string
  // that is not simply the English again. The denominator is every non-empty English leaf — chrome,
  // tool copy and widget labels — which is the same table scripts/i18n-report.mjs prints.
  // A leaf counts as translated when one of the locale's own layers supplies a non-empty string, and
  // the denominator is every non-empty English leaf — chrome, tool copy and widget labels. That is
  // the same table scripts/i18n-report.mjs prints, now shared instead of restated. A string that is
  // identical to English still counts (French "Minimum" is correct French); the copy-paste case is
  // what scripts/check-translations.mjs looks for separately.
  const own = leaves(ownLayer(sources));
  const all = Object.entries(leaves(mergedEnglish)).filter(([, v]) => String(v ?? '').trim() !== '');
  const translated = all.filter(([k]) => typeof own[k] === 'string' && own[k].trim() !== '').length;
  coverage[l] = { total: all.length, translated, pct: Math.round((translated / all.length) * 100) };
}
if (localeErrors.length) {
  for (const e of localeErrors) console.error(`  BROKEN locale layer: ${e}`);
  throw new Error(`${localeErrors.length} locale layer file(s) could not be read or classified — the build would`
    + ' silently serve English for them, so it stops here instead.');
}

// ---------------------------------------------------------------- dist
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const adsForTemplates = {
  clientId: cfg.ads.clientId || '',
  slots: Object.fromEntries(Object.entries(cfg.ads.slots).map(([k, v]) => [k, { ...v, slotId: cfg.ads.slotIds?.[k] || '' }])),
  enabled: !!cfg.ads.enabled
};

const ctxCfg = {
  ...cfg,
  __categories: categories,
  __tools: tools,
  __seo: seo,
  __toolSeo: toolSeo,
  __dicts: Object.fromEntries(Object.entries(dicts).map(([l, d]) => [l, { ...d, __ads: adsForTemplates }]))
};
// templates read dict.__ads for slot rendering
for (const l of cfg.locales) ctxCfg.__dicts[l].__ads = adsForTemplates;

const T = await import(pathToFileURL(P('src', 'templates.mjs')).href);

let written = 0;
const write = async (path, html) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html);
  written++;
};

for (const l of cfg.locales) {
  const dict = ctxCfg.__dicts[l];
  // The sitemap is scanned from the finished dist/ tree below, so no in-memory URL registry is kept
  // here — every index.html that ships is one indexable URL, and the scan is the single source of truth.
  await write(P('dist', l, 'index.html'), T.homePage({ cfg: ctxCfg, dict, locale: l }));
  for (const cat of Object.keys(categories)) {
    await write(P('dist', l, cat, 'index.html'), T.categoryPage({ cfg: ctxCfg, dict, locale: l, cat }));
  }
  await write(P('dist', l, 'all', 'index.html'), T.categoryPage({ cfg: ctxCfg, dict, locale: l, cat: null }));
  for (const t of tools) {
    await write(P('dist', l, t.cat, t.id, 'index.html'), T.toolPage({ cfg: ctxCfg, dict, locale: l, tool: t }));
  }
  for (const slug of ['about', 'privacy', 'terms', 'dmca', 'contact']) {
    await write(P('dist', l, slug, 'index.html'), T.legalPage({ cfg: ctxCfg, dict, locale: l, slug }));
  }
  await write(P('dist', l, '404.html'), T.notFoundPage({ cfg: ctxCfg, dict, locale: l }));
}

await write(P('dist', 'index.html'), T.rootRedirectPage(ctxCfg));
// Vercel, Netlify and Cloudflare Pages all look for the site-wide error page at the output root,
// so the default-locale 404 is duplicated there. It links back to /<defaultLocale>/, the same
// English home the root / always opens (no geo guess).
await write(P('dist', '404.html'), T.notFoundPage({ cfg: ctxCfg, dict: ctxCfg.__dicts[cfg.defaultLocale], locale: cfg.defaultLocale }));

// ---------------------------------------------------------------- assets
const copy = async (from, to) => { await mkdir(dirname(P('dist', to)), { recursive: true }); await copyFile(P(from), P('dist', to)); };
await copy('src/styles/site.css', '_assets/site.css');
await copy('src/scripts/lib.js', '_assets/lib.js');
await copy('src/scripts/i18n.js', '_assets/i18n.js');
await copy('src/scripts/runtime.js', '_assets/runtime.js');
await copy('src/scripts/router.js', '_assets/router.js');
for (const b of ['pdf', 'image', 'text', 'calc', 'audio', 'video', 'media-core']) await copy(`src/scripts/tools/${b}.js`, `_assets/tools/${b}.js`);
for (const f of await readdir(P('vendor'))) await copy(join('vendor', f), `_assets/vendor/${f}`);
// anything you drop in src/assets (og.png, app icons, an about photo) is copied as-is
const ASSETS = P('src', 'assets');
const assetFiles = existsSync(ASSETS) ? await readdir(ASSETS) : [];
for (const f of assetFiles) await copy(join('src', 'assets', f), `_assets/${f}`);
if (!assetFiles.includes('og.png'))
  console.log('  note: src/assets/og.png is missing — every page points og:image there (1200x630). Add one before sharing links.');

// per-locale dictionary for the client (labels only, so a page stays small)
for (const l of cfg.locales) {
  const d = dicts[l];
  const payload = {
    w: d.w, common: d.common, tool: d.tool, cat: d.cat, nav: d.nav, ads: d.ads, meta: d.meta,
    search: Object.fromEntries(tools.map(x => [x.id, { title: d.t[x.id]?.title || x.id, desc: d.t[x.id]?.desc || '' }]))
  };
  await write(P('dist', '_assets', `dict.${l}.js`), `window.__TH_DICT=${j(payload)};\n`);
}

// shared config for runtime / router / edge functions
const routingData = {
  locales: cfg.locales,
  defaultLocale: cfg.defaultLocale,
  countryToLocales: cfg.routing.countryToLocales,
  timezoneToLocale: cfg.routing.timezoneToLocale,
  localeNames: cfg.localeNames,
  ads: adsForTemplates,
  consent: cfg.consent,
  paths: { root: '/' }
};
await write(P('dist', '_assets', 'state.js'), `window.__TH_CONFIG=${j(routingData)};\n`);
await write(P('dist', '_assets', 'i18n.json'), j(routingData));
await write(P('dist', '_assets', 'tools.json'), j(tools));

// ---------------------------------------------------------------- sitemap / robots / rss
const base = cfg.baselineUrl.replace(/\/$/, '');
// robots.txt — owner-specified format. Allow everything, block the error pages (root + per-locale
// 404.html), and point at the single canonical root sitemap. ${base} is the owner domain with no
// trailing slash, so this renders exactly "Sitemap: https://clearlighttools.com/sitemap.xml".
await write(P('dist', 'robots.txt'), `User-agent: *
Allow: /

# 禁止爬虫抓取无意义的错误页、内部组件或废弃目录（如有对应路径请同步匹配）
Disallow: /404.html
Disallow: /*/404.html

# 指向最终规范的主域名地图
Sitemap: ${base}/sitemap.xml
`);
// AdSense will not serve on a host that has no ads.txt, and the file has to exist on every hostname
// you monetise.
if (cfg.ads.enabled && cfg.ads.clientId) {
  await write(P('dist', 'ads.txt'), `google.com, ${cfg.ads.clientId}, DIRECT, f08c47fec0942fa0\n`);
} else if (cfg.ads.enabled) {
  console.log('  note: ads.clientId is empty — no ads.txt written. AdSense review fails without it.');
}
await write(P('dist', 'llms.txt'), `# ${cfg.brand}\n\n${cfg.productName}. ${cfg.locales.length} languages. Every tool runs client-side; no file is uploaded.\n\n` +
  tools.map(t => `- [${dicts.en.t[t.id].title}] ${base}/en/${T.toolPath(t)}`).join('\n') + '\n');

const today = new Date().toISOString().slice(0, 10);
// Single root sitemap.xml, built by scanning the FINISHED dist/ tree — not an in-memory registry — so
// it can only list pages that actually shipped. Rules:
//   • every index.html is one indexable URL (home + categories + all + tools + 5 legal, all locales);
//   • the root chooser (dist/index.html) is skipped — it is only a redirect shell, /en/ and /zh/ are
//     listed directly; 404.html is never named index.html so it is naturally excluded; _assets/ holds
//     static slices, not pages, so it is not walked;
//   • each <loc> is written exactly like that page's own <link rel="canonical">: owner domain, HTTPS,
//     no www, trailing slash — and carries a build-date <lastmod>. Nothing else (no hreflang /
//     changefreq / priority): the hreflang alternates live in each page's <head>, unchanged.
const walkPages = async dir => {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== '_assets') out.push(...await walkPages(full)); }
    else if (ent.isFile() && ent.name === 'index.html') out.push(full);
  }
  return out;
};
// dist/<locale>/<path>/index.html -> "<locale>/<path>" (POSIX slashes); root index.html -> "" (dropped).
const relDirOf = abs => abs.slice(DIST.length + 1).split(/[\\/]/).slice(0, -1).join('/');
const sitemapLocs = (await walkPages(DIST))
  .map(relDirOf)
  .filter(rel => rel !== '')
  .map(rel => `${base}/${rel}/`)
  .sort();
const sitemapBody = sitemapLocs.map(loc => `  <url><loc>${escXml(loc)}</loc><lastmod>${today}</lastmod></url>`).join('\n');
await write(P('dist', 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapBody}\n</urlset>\n`);
console.log(`  sitemap         dist/sitemap.xml — ${sitemapLocs.length} URLs scanned from dist/ (root + 404 + _assets excluded)`);

// tool changelog feed (new tools added to the registry)
await write(P('dist', 'tools-rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n  <title>${cfg.brand} — new tools</title>\n  <link>${base}/en/</link>\n  <description>${cfg.productName}</description>\n${tools.slice(0, 20).map(t => `  <item><title>${escXml(dicts.en.t[t.id].title)}</title><link>${base}/en/${T.toolPath(t)}</link><description>${escXml(dicts.en.t[t.id].desc)}</description></item>`).join('\n')}\n</channel></rss>\n`);

// ---------------------------------------------------------------- platform files
// vercel.json in the repo root carries the header rules for Vercel; Cloudflare Pages reads the
// same policy from a _headers file inside the output directory. Keeping both in sync by hand is
// how you end up serving immutable HTML, so the CF one is generated from the same intent here.
await write(P('dist', '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Cache-Control: public, max-age=0, must-revalidate

/_assets/*
  Cache-Control: public, max-age=0, must-revalidate

/_assets/vendor/*
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/_assets/tools/*
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400
`);

// Cloudflare Pages / Netlify read _redirects. The root always opens the English home with a true
// 301, so users and Googlebot get one stable permanent hop that no cookie / IP / browser / timezone
// signal can change. Vercel does the same from vercel.json's redirects block (308 permanent).
// src/scripts/router.js is the client-side fallback for hosts that honour neither file.
await write(P('dist', '_redirects'), `/ /${cfg.defaultLocale}/ 301\n`);

// ---------------------------------------------------------------- report
function escXml(s = '') { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

const vendorMissing = [];
for (const t of tools) {
  for (const lib of t.needs || []) {
    const file = { 'pdf-lib': 'pdf-lib.min.js', 'pdf.js': 'pdf.min.js', 'qrcode-generator': 'qrcode-generator.min.js', 'gifenc': 'gifenc.mjs', 'jszip': 'jszip.min.js', 'marked': 'marked.min.js', 'lamejs': 'lame.min.js' }[lib];
    if (file && !existsSync(P('vendor', file))) vendorMissing.push(`${t.id} -> ${file}`);
  }
}

const pages = written;
console.log(`\n${cfg.brand} build`);
console.log(`  pages written   ${pages}  (${tools.length} tools × ${cfg.locales.length} locales + categories + legal)`);
console.log(`  output          dist/`);
console.log(`  ads             ${!adsForTemplates.enabled ? 'disabled (ENABLE_ADS off — no ad DOM on any page)' : adsForTemplates.clientId ? 'live AdSense units' : 'enabled but unconfigured — no ad DOM (set ads.clientId + ads.slotIds)'}`);
if (vendorMissing.length) console.log(`  missing vendor    ${vendorMissing.join(', ')}  ->  npm run vendor`);
console.log('\n  translation coverage (chrome + tool copy, English leaves replaced)');
for (const l of cfg.locales) {
  const c = coverage[l];
  const bar = '█'.repeat(Math.round(c.pct / 5)).padEnd(20, '·');
  console.log(`  ${l.padEnd(3)} ${bar} ${String(c.pct).padStart(3)}%  ${c.translated}/${c.total}${l === cfg.defaultLocale ? '  source language' : ''}`);
}
await write(P('dist', '_assets', 'i18n-coverage.json'), j({ generated: today, coverage }));
console.log('');
export { coverage, tools, dicts, cfg };
