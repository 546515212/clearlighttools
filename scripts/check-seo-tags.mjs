#!/usr/bin/env node
// Technical SEO gate for the ClearLight Tools international site. Reads the BUILT artifacts under
// dist/ (the HTML a crawler fetches + the single sitemap it submits) and asserts the owner's rules:
//
//   1. self-canonical   every page's <link rel="canonical"> is its OWN full URL on
//                       https://clearlighttools.com/<locale>/<path> (root chooser -> /<default>/).
//   2. hreflang set     every page carries one <link rel="alternate" hreflang> per configured locale
//                       (zh ships "zh-Hans", the rest the bare code) PLUS x-default -> the default
//                       locale, each href pointing at that locale's same path. These alternates live
//                       in the HTML <head> ONLY — the sitemap carries loc + lastmod, no hreflang.
//   3. robots meta      contact + 404 are noindex,nofollow; the root chooser is index,follow; every
//                       other page is index,follow,max-image-preview:large.
//   4. sitemap.xml      ONE root sitemap.xml lists every indexable URL across ALL locales (home + 6
//                       categories + all + 78 tools + 5 legal per locale = 91 × 13 = 1183; no root
//                       chooser, no 404, no _assets). Each <loc> is byte-identical to that page's
//                       canonical (owner domain, HTTPS, no www, trailing slash) and carries a
//                       build-date <lastmod> — and NOTHING else (no priority / changefreq / hreflang).
//   5. robots.txt       User-agent:* + Allow:/ + Disallow:/404.html + Disallow:/*/404.html, and a
//                       Sitemap: line pointing at https://clearlighttools.com/sitemap.xml. The old
//                       sitemap-index.xml and per-locale sitemap-<l>.xml must no longer exist.
//
//   node scripts/check-seo-tags.mjs              all locales, exit 1 on any hard finding / build gap
//   node scripts/check-seo-tags.mjs --locale zh  one locale's pages (the sitemap is global, still 1183)
//   node scripts/check-seo-tags.mjs --selftest   in-memory sabotage of every rule + counter-proofs
//
// Every canonical / hreflang / og:url / sitemap URL must sit on https://clearlighttools.com — a stale
// ToolHive domain, a *.pages.dev preview host or a proxy leak is a DOMAIN finding. (The <meta name=
// "keywords"> removal is owned by check-tkd's NK rule; this gate does not duplicate it.)
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = n => argv.includes(n);

const OWNER_BASE = 'https://clearlighttools.com';
const OWNER_BRAND = 'ClearLight Tools';
const LEGAL_SLUGS = ['about', 'privacy', 'terms', 'dmca', 'contact'];
const unescape = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// ---------------------------------------------------------------- parsers (match the real markup)
export const headOf = html => { const i = html.indexOf('</head>'); return i >= 0 ? html.slice(0, i) : html; };
export const canonicalOf = head => { const m = /<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(head); return m ? unescape(m[1]) : null; };
export const robotsOf = head => { const m = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(head); return m ? unescape(m[1]) : null; };
export const ogUrlOf = head => { const m = /<meta\s+property="og:url"\s+content="([^"]*)"/i.exec(head); return m ? unescape(m[1]) : null; };
export const ogSiteNameOf = head => { const m = /<meta\s+property="og:site_name"\s+content="([^"]*)"/i.exec(head); return m ? unescape(m[1]) : null; };
// layout emits <link rel="alternate" hreflang=".." href=".."> (no self-closing slash); root too.
export const alternatesOf = head => {
  const out = []; const re = /<link\s+rel="alternate"\s+hreflang="([^"]*)"\s+href="([^"]*)"\s*>/gi; let m;
  while ((m = re.exec(head))) out.push({ hreflang: unescape(m[1]), href: unescape(m[2]) });
  return out;
};
// sitemap.xml emits <url><loc>..</loc><lastmod>..</lastmod></url> — loc + lastmod only, no alternates.
export const sitemapUrls = xml => {
  const out = []; const re = /<url>([\s\S]*?)<\/url>/g; let m;
  while ((m = re.exec(xml))) {
    const blk = m[1];
    const loc = /<loc>([^<]*)<\/loc>/.exec(blk);
    const lm = /<lastmod>([^<]*)<\/lastmod>/.exec(blk);
    out.push({ loc: loc ? unescape(loc[1]) : null, lastmod: lm ? lm[1].trim() : null });
  }
  return out;
};

// ---------------------------------------------------------------- expected shapes (pure)
export const expectedCanonical = (ctx, p) => p.kind === 'root' ? `${ctx.base}/${ctx.defaultLocale}/` : `${ctx.base}/${p.locale}/${p.path}`;
export const expectedRobots = p => p.kind === 'root' ? 'index,follow' : p.noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large';
export const expectedOgUrl = (ctx, p) => p.kind === 'root' ? null : `${ctx.base}/${p.locale}/${p.path}`;
export function expectedAlternates(ctx, path) {
  // Every page ships one alternate per CONFIGURED locale + x-default, even when the page sweep is
  // narrowed with --locale, so this always uses the full allLocales set (not the sweep subset).
  const alts = ctx.allLocales.map(l => ({ hreflang: ctx.hreflangOf[l], href: `${ctx.base}/${l}/${path}` }));
  alts.push({ hreflang: 'x-default', href: `${ctx.base}/${ctx.defaultLocale}/${path}` });
  return alts;
}
const altMap = alts => Object.fromEntries(alts.map(a => [a.hreflang, a.href]));

// The page set the build writes, reconstructed from the same registry/categories the build uses, so
// the gate asserts dist matches the intended set rather than merely "whatever happens to be there".
export function expectedPages(ctx) {
  const pages = [];
  for (const l of ctx.locales) {
    pages.push({ locale: l, path: '', kind: 'home', file: `${l}/index.html`, noindex: false });
    for (const c of ctx.categories) pages.push({ locale: l, path: `${c}/`, kind: 'category', file: `${l}/${c}/index.html`, noindex: false });
    pages.push({ locale: l, path: 'all/', kind: 'category', file: `${l}/all/index.html`, noindex: false });
    for (const t of ctx.tools) pages.push({ locale: l, path: `${t.cat}/${t.id}/`, kind: 'tool', file: `${l}/${t.cat}/${t.id}/index.html`, noindex: false });
    for (const s of LEGAL_SLUGS) pages.push({ locale: l, path: `${s}/`, kind: 'legal', file: `${l}/${s}/index.html`, noindex: s === 'contact' });
    pages.push({ locale: l, path: '', kind: '404', file: `${l}/404.html`, noindex: true });
  }
  pages.push({ locale: ctx.defaultLocale, path: '', kind: 'root', file: 'index.html', noindex: false });
  pages.push({ locale: ctx.defaultLocale, path: '', kind: '404', file: '404.html', noindex: true });
  return pages;
}
// The single global sitemap's URL set: every indexable page across ALL configured locales (no 404, no
// root chooser). Each loc is built with the SAME formula as expectedCanonical for a non-root page, so
// "loc is in this set" already guarantees "loc == that page's canonical, trailing slash and all".
export function expectedSitemapUrls(ctx) {
  const out = [];
  for (const l of ctx.allLocales) {
    const push = (path, kind) => out.push({ loc: `${ctx.base}/${l}/${path}`, locale: l, path, kind });
    push('', 'home');
    for (const c of ctx.categories) push(`${c}/`, 'category');
    push('all/', 'category');
    for (const t of ctx.tools) push(`${t.cat}/${t.id}/`, 'tool');
    for (const s of LEGAL_SLUGS) push(`${s}/`, 'legal');
  }
  return out;
}

// ---------------------------------------------------------------- judge (pure)
export function judge({ pages, sitemap, robots, legacy, ctx }) {
  const findings = [];
  const counts = { pages: 0, alternates: 0, sitemapUrls: 0 };
  const add = (scope, rule, why, soft = false) => findings.push({ scope, rule, why, soft });

  // ---- HTML <head> contract (canonical / robots meta / og / hreflang) — unchanged ----
  for (const p of pages) {
    const label = `${p.locale}/${p.file}`;
    if (!p.exists) { add(label, 'GAP', 'built page missing'); continue; }
    counts.pages++;
    const wantCanon = expectedCanonical(ctx, p);
    if (p.canonical !== wantCanon) add(label, 'CANON', `canonical "${p.canonical}" != self "${wantCanon}"`);
    const wantRobots = expectedRobots(p);
    if (p.robots !== wantRobots) add(label, 'ROBOTS', `robots "${p.robots}" != "${wantRobots}"`);
    const wantOg = expectedOgUrl(ctx, p);
    if (wantOg !== null && p.ogUrl !== wantOg) add(label, 'OGURL', `og:url "${p.ogUrl}" != "${wantOg}"`);
    if (wantOg !== null && p.ogSiteName !== ctx.brand) add(label, 'OGBRAND', `og:site_name "${p.ogSiteName}" != "${ctx.brand}"`);
    // hreflang alternates: exact code set + exact hrefs
    const want = expectedAlternates(ctx, p.path), got = p.alternates || [];
    counts.alternates += got.length;
    const wm = altMap(want), gm = altMap(got);
    for (const k of Object.keys(wm)) if (!(k in gm)) add(label, 'ALTSET', `missing hreflang "${k}"`);
    for (const k of Object.keys(gm)) if (!(k in wm)) add(label, 'ALTSET', `unexpected hreflang "${k}"`);
    for (const k of Object.keys(wm)) if (k in gm && gm[k] !== wm[k]) add(label, 'ALTHREF', `hreflang "${k}" -> "${gm[k]}" != "${wm[k]}"`);
    if (Object.keys(gm).length !== got.length) add(label, 'ALTSET', 'duplicate hreflang code in the alternate set');
    // every SEO URL on the owner domain
    const urls = [p.canonical, p.ogUrl, ...got.map(a => a.href)].filter(Boolean);
    for (const u of urls) if (!u.startsWith(`${ctx.base}/`)) add(label, 'DOMAIN', `SEO URL off the owner domain: "${u}"`);
  }

  // ---- the single root sitemap.xml ----
  const SM = 'sitemap.xml';
  if (!sitemap || !sitemap.exists) add(SM, 'GAP', 'sitemap.xml missing');
  else {
    const want = expectedSitemapUrls(ctx);
    const got = sitemap.urls || [];
    counts.sitemapUrls = got.length;
    const byLoc = new Map(got.map(u => [u.loc, u]));
    const wantLocs = new Set(want.map(u => u.loc));
    for (const w of want) if (!byLoc.has(w.loc)) add(SM, 'SMSET', `missing URL "${w.loc}"`);
    for (const g of got) if (!wantLocs.has(g.loc)) add(SM, 'SMSET', `unexpected URL "${g.loc}" (root/404/assets must not be indexed)`);
    if (got.length !== want.length) add(SM, 'SMCOUNT', `${got.length} URLs, expected ${want.length}`);
    if (byLoc.size !== got.length) add(SM, 'SMDUP', `${got.length - byLoc.size} duplicate <loc> entr${got.length - byLoc.size === 1 ? 'y' : 'ies'}`);
    for (const g of got) {
      if (!g.loc || !g.loc.startsWith(`${ctx.base}/`)) add(SM, 'DOMAIN', `sitemap URL off the owner domain: "${g.loc}"`);
      if (!g.loc || !g.loc.endsWith('/')) add(SM, 'SMSLASH', `sitemap URL missing trailing slash (canonical mismatch): "${g.loc}"`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(g.lastmod || '')) add(SM, 'SMLASTMOD', `missing/invalid <lastmod> for "${g.loc}"`);
    }
    // owner wants loc + lastmod ONLY — flag any richer field that crept back into the markup
    const raw = sitemap.raw || '';
    if (/<priority>/i.test(raw)) add(SM, 'SMFIELD', 'sitemap carries <priority> — owner wants loc + lastmod only');
    if (/<changefreq>/i.test(raw)) add(SM, 'SMFIELD', 'sitemap carries <changefreq> — owner wants loc + lastmod only');
    if (/<xhtml:link/i.test(raw)) add(SM, 'SMFIELD', 'sitemap carries hreflang alternates — those belong in the HTML head only');
  }

  // ---- robots.txt ----
  const RB = 'robots.txt';
  if (!robots || !robots.exists) add(RB, 'GAP', 'robots.txt missing');
  else {
    const t = robots.text;
    if (!/^User-agent:[ \t]*\*[ \t]*$/m.test(t)) add(RB, 'ROBOTS', 'missing "User-agent: *"');
    if (!/^Allow:[ \t]*\/[ \t]*$/m.test(t)) add(RB, 'ROBOTS', 'missing "Allow: /"');
    if (!/^Disallow:[ \t]*\/404\.html[ \t]*$/m.test(t)) add(RB, 'ROBOTS', 'missing "Disallow: /404.html"');
    if (!/^Disallow:[ \t]*\/\*\/404\.html[ \t]*$/m.test(t)) add(RB, 'ROBOTS', 'missing "Disallow: /*/404.html"');
    const smLine = /^Sitemap:[ \t]*(\S+)[ \t]*$/m.exec(t);
    if (!smLine) add(RB, 'ROBOTS', 'missing "Sitemap:" line');
    else if (smLine[1] !== `${ctx.base}/sitemap.xml`) add(RB, 'ROBOTS', `Sitemap "${smLine[1]}" != "${ctx.base}/sitemap.xml"`);
    if (/sitemap-index\.xml/.test(t)) add(RB, 'ROBOTS', 'robots.txt still references the removed sitemap-index.xml');
  }

  // ---- the old multi-file sitemap must be gone ----
  if (legacy && legacy.index) add('sitemap-index.xml', 'LEGACY', 'old sitemap-index.xml still present — the single sitemap.xml replaces it');
  for (const name of (legacy && legacy.perLocale) || []) add(name, 'LEGACY', `old per-locale ${name} still present — removed in favour of sitemap.xml`);

  return { findings, counts };
}

// config-level guard: the owner domain + brand are not negotiable, and zh must ship zh-Hans.
export function judgeConfig({ cfg, hreflangOf }) {
  const findings = [];
  const base = String(cfg.baselineUrl || '').replace(/\/$/, '');
  if (base !== OWNER_BASE) findings.push({ rule: 'CFG', why: `baselineUrl "${base}" != owner domain "${OWNER_BASE}"` });
  if (cfg.brand !== OWNER_BRAND) findings.push({ rule: 'CFG', why: `brand "${cfg.brand}" != "${OWNER_BRAND}"` });
  for (const l of cfg.locales) {
    const code = hreflangOf[l];
    if (!String(code || '').trim()) findings.push({ rule: 'CFG', why: `no hreflang code for ${l}` });
  }
  const codes = cfg.locales.map(l => hreflangOf[l]);
  if (new Set(codes).size !== codes.length) findings.push({ rule: 'CFG', why: 'two locales share one hreflang code' });
  if (cfg.locales.includes('zh') && hreflangOf.zh !== 'zh-Hans') findings.push({ rule: 'CFG', why: `zh hreflang is "${hreflangOf.zh}", expected "zh-Hans"` });
  return { findings };
}

// ---------------------------------------------------------------- selftest
async function selftest() {
  const ctx = {
    base: OWNER_BASE, defaultLocale: 'en', brand: OWNER_BRAND,
    locales: ['en', 'zh', 'fr'], allLocales: ['en', 'zh', 'fr'],
    categories: ['pdf', 'image'],
    tools: [{ id: 'compress-pdf', cat: 'pdf' }, { id: 'merge-pdf', cat: 'pdf' }],
    hreflangOf: { en: 'en', zh: 'zh-Hans', fr: 'fr' }
  };
  const SM_COUNT = expectedSitemapUrls(ctx).length; // 3 locales × 11 indexable pages = 33
  // a fully correct built page row
  const goodPage = (locale, path, kind, noindex = false) => ({
    locale, path, kind, file: `${locale}/${path || ''}index.html`, noindex, exists: true,
    canonical: expectedCanonical(ctx, { locale, path, kind }),
    robots: expectedRobots({ kind, noindex }),
    ogUrl: expectedOgUrl(ctx, { locale, path, kind }),
    ogSiteName: kind === 'root' ? null : OWNER_BRAND,
    alternates: expectedAlternates(ctx, path)
  });
  const goodSitemap = () => {
    const urls = expectedSitemapUrls(ctx).map(u => ({ loc: u.loc, lastmod: '2026-11-13' }));
    return { exists: true, urls, raw: `<urlset>${urls.map(u => `<url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('')}</urlset>` };
  };
  const goodRobots = () => ({ exists: true, text: `User-agent: *\nAllow: /\n\nDisallow: /404.html\nDisallow: /*/404.html\n\nSitemap: ${ctx.base}/sitemap.xml\n` });
  const base = () => ({
    pages: [goodPage('en', '', 'home'), goodPage('zh', 'pdf/compress-pdf/', 'tool'), goodPage('fr', 'contact/', 'legal', true), goodPage('en', '', '404', true), { ...goodPage('en', '', 'root'), file: 'index.html', ogUrl: null, ogSiteName: null }],
    sitemap: goodSitemap(), robots: goodRobots(), legacy: { index: false, perLocale: [] }, ctx
  });
  const run = mut => { const b = base(); mut(b); return judge(b); };
  const has = (r, rule) => r.findings.some(f => f.rule === rule);

  const cases = [
    ['a correct build is silent', b => {}, r => r.findings.length === 0 && r.counts.pages === 5 && r.counts.sitemapUrls === SM_COUNT],
    // --- HTML head rules (unchanged) ---
    ['a canonical pointing at another locale fires CANON', b => { b.pages[1].canonical = `${ctx.base}/en/pdf/compress-pdf/`; }, r => has(r, 'CANON')],
    ['a canonical on the old ToolHive domain fires DOMAIN', b => { b.pages[0].canonical = 'https://toolhive.com/en/'; }, r => has(r, 'DOMAIN')],
    ['a canonical on a pages.dev preview host fires DOMAIN', b => { b.pages[0].canonical = 'https://clearlight.pages.dev/en/'; }, r => has(r, 'DOMAIN')],
    ['a missing hreflang fires ALTSET', b => { b.pages[1].alternates = b.pages[1].alternates.filter(a => a.hreflang !== 'fr'); }, r => has(r, 'ALTSET')],
    ['a bare zh instead of zh-Hans fires ALTSET', b => { b.pages[1].alternates = b.pages[1].alternates.map(a => a.hreflang === 'zh-Hans' ? { ...a, hreflang: 'zh' } : a); }, r => has(r, 'ALTSET')],
    ['an hreflang pointing at the wrong path fires ALTHREF', b => { b.pages[1].alternates = b.pages[1].alternates.map(a => a.hreflang === 'fr' ? { ...a, href: `${ctx.base}/fr/` } : a); }, r => has(r, 'ALTHREF')],
    ['x-default pointing at zh fires ALTHREF', b => { b.pages[1].alternates = b.pages[1].alternates.map(a => a.hreflang === 'x-default' ? { ...a, href: `${ctx.base}/zh/pdf/compress-pdf/` } : a); }, r => has(r, 'ALTHREF')],
    ['an indexable contact page fires ROBOTS', b => { b.pages[2].robots = 'index,follow,max-image-preview:large'; }, r => has(r, 'ROBOTS')],
    ['a noindex home fires ROBOTS', b => { b.pages[0].robots = 'noindex,nofollow'; }, r => has(r, 'ROBOTS')],
    ['the root chooser must be index,follow (not the full directive)', b => { b.pages[4].robots = 'index,follow,max-image-preview:large'; }, r => has(r, 'ROBOTS')],
    ['an og:url on the wrong domain fires DOMAIN', b => { b.pages[0].ogUrl = 'https://routify.example/en/'; }, r => has(r, 'DOMAIN')],
    ['an old-brand og:site_name fires OGBRAND', b => { b.pages[0].ogSiteName = 'ToolHive'; }, r => has(r, 'OGBRAND')],
    ['a missing built page fires GAP', b => { b.pages[1].exists = false; }, r => has(r, 'GAP')],
    // --- single sitemap.xml rules ---
    ['a sitemap missing a tool URL fires SMSET', b => { b.sitemap.urls = b.sitemap.urls.filter(u => !u.loc.endsWith('compress-pdf/')); }, r => has(r, 'SMSET')],
    ['a 404 leaked into the sitemap fires SMSET', b => { b.sitemap.urls.push({ loc: `${ctx.base}/en/404.html`, lastmod: '2026-11-13' }); }, r => has(r, 'SMSET')],
    ['the root chooser leaked into the sitemap fires SMSET', b => { b.sitemap.urls.push({ loc: `${ctx.base}/`, lastmod: '2026-11-13' }); }, r => has(r, 'SMSET')],
    ['an off-domain sitemap URL fires DOMAIN', b => { b.sitemap.urls[0].loc = 'https://toolhive.com/en/'; }, r => has(r, 'DOMAIN')],
    ['a sitemap URL without a trailing slash fires SMSLASH', b => { b.sitemap.urls[0].loc = b.sitemap.urls[0].loc.replace(/\/$/, ''); }, r => has(r, 'SMSLASH')],
    ['a missing lastmod fires SMLASTMOD', b => { b.sitemap.urls[0].lastmod = null; }, r => has(r, 'SMLASTMOD')],
    ['a malformed lastmod fires SMLASTMOD', b => { b.sitemap.urls[0].lastmod = '13/11/2026'; }, r => has(r, 'SMLASTMOD')],
    ['a duplicate loc fires SMDUP', b => { b.sitemap.urls.push({ ...b.sitemap.urls[0] }); }, r => has(r, 'SMDUP')],
    ['a wrong URL count fires SMCOUNT', b => { b.sitemap.urls.pop(); }, r => has(r, 'SMCOUNT')],
    ['a <priority> in the sitemap fires SMFIELD', b => { b.sitemap.raw += '<priority>1.0</priority>'; }, r => has(r, 'SMFIELD')],
    ['a <changefreq> in the sitemap fires SMFIELD', b => { b.sitemap.raw += '<changefreq>weekly</changefreq>'; }, r => has(r, 'SMFIELD')],
    ['an hreflang alternate in the sitemap fires SMFIELD', b => { b.sitemap.raw += `<xhtml:link rel="alternate" hreflang="en" href="${ctx.base}/en/"/>`; }, r => has(r, 'SMFIELD')],
    ['a missing sitemap.xml fires GAP', b => { b.sitemap = { exists: false, urls: [], raw: '' }; }, r => has(r, 'GAP')],
    // --- robots.txt rules ---
    ['robots pointing at the old index fires ROBOTS', b => { b.robots.text = b.robots.text.replace('/sitemap.xml', '/sitemap-index.xml'); }, r => has(r, 'ROBOTS')],
    ['robots missing the /404.html Disallow fires ROBOTS', b => { b.robots.text = b.robots.text.replace('Disallow: /404.html\n', ''); }, r => has(r, 'ROBOTS')],
    ['robots missing the /*/404.html Disallow fires ROBOTS', b => { b.robots.text = b.robots.text.replace('Disallow: /*/404.html\n', ''); }, r => has(r, 'ROBOTS')],
    ['robots missing Allow fires ROBOTS', b => { b.robots.text = b.robots.text.replace('Allow: /\n', ''); }, r => has(r, 'ROBOTS')],
    ['robots missing the Sitemap line fires ROBOTS', b => { b.robots.text = b.robots.text.replace(/^Sitemap:.*\n?/m, ''); }, r => has(r, 'ROBOTS')],
    ['a missing robots.txt fires GAP', b => { b.robots = { exists: false, text: '' }; }, r => has(r, 'GAP')],
    // --- legacy multi-file sitemap must be gone ---
    ['a leftover sitemap-index.xml fires LEGACY', b => { b.legacy.index = true; }, r => has(r, 'LEGACY')],
    ['a leftover per-locale sitemap fires LEGACY', b => { b.legacy.perLocale = ['sitemap-en.xml']; }, r => has(r, 'LEGACY')],
    ['an empty sweep is not a pass', b => { b.pages = []; b.sitemap = { exists: false, urls: [], raw: '' }; b.robots = { exists: false, text: '' }; b.legacy = { index: false, perLocale: [] }; }, r => r.counts.pages === 0 && has(r, 'GAP')]
  ];
  let bad = 0;
  for (const [name, mut, ok] of cases) {
    const r = run(mut); const pass = ok(r);
    if (!pass) bad++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` -> ${JSON.stringify(r.findings.slice(0, 3))}`}`);
  }

  // counter-proof: the domain rule is really the owner host (look-alike rejected, real one passes)
  const domProof = (() => {
    const on = run(b => { b.pages[0].canonical = `${OWNER_BASE}/en/`; });
    const off = run(b => { b.pages[0].canonical = 'https://clearlighttools.com.evil.example/en/'; });
    return !has(on, 'DOMAIN') && has(off, 'DOMAIN');
  })();
  if (!domProof) bad++;
  console.log(`  ${domProof ? 'ok  ' : 'FAIL'} counter-proof: a look-alike domain (clearlighttools.com.evil.example) is rejected, the real one passes`);
  // counter-proof: the expected sitemap set is exactly the indexable pages — no root, no 404, all
  // owner-domain + trailing slash, 11 per locale (home + 2 cat + all + 2 tools + 5 legal).
  const smProof = (() => {
    const u = expectedSitemapUrls(ctx);
    const perLocale = ctx.allLocales.every(l => u.filter(x => x.locale === l).length === 11);
    const noRoot = !u.some(x => x.loc === `${ctx.base}/`);
    const no404 = !u.some(x => /404\.html$/.test(x.loc));
    const shaped = u.every(x => x.loc.startsWith(`${ctx.base}/`) && x.loc.endsWith('/'));
    return u.length === SM_COUNT && perLocale && noRoot && no404 && shaped;
  })();
  if (!smProof) bad++;
  console.log(`  ${smProof ? 'ok  ' : 'FAIL'} counter-proof: expected sitemap set is ${SM_COUNT} indexable URLs (11/locale), no root/404, owner domain + trailing slash`);
  // the hreflang set must be exactly locales + x-default, no more no less
  const altProof = (() => {
    const a = expectedAlternates(ctx, 'pdf/compress-pdf/');
    const codes = a.map(x => x.hreflang).sort();
    return JSON.stringify(codes) === JSON.stringify(['en', 'fr', 'x-default', 'zh-Hans'].sort()) && a.every(x => x.href.startsWith(`${OWNER_BASE}/`));
  })();
  if (!altProof) bad++;
  console.log(`  ${altProof ? 'ok  ' : 'FAIL'} counter-proof: alternate set is exactly the locale codes + x-default on the owner domain`);

  // config judge: owner domain/brand/zh-Hans enforced, with a counter-proof
  const goodCfg = judgeConfig({ cfg: { baselineUrl: OWNER_BASE, brand: OWNER_BRAND, locales: ctx.locales }, hreflangOf: ctx.hreflangOf });
  const badCfg = judgeConfig({ cfg: { baselineUrl: 'https://toolhive.com', brand: 'ToolHive', locales: ctx.locales }, hreflangOf: { en: 'en', zh: 'zh', fr: 'fr' } });
  const cfgOk = goodCfg.findings.length === 0 && badCfg.findings.length >= 3;
  if (!cfgOk) bad++;
  console.log(`  ${cfgOk ? 'ok  ' : 'FAIL'} config judge: clean config silent, old domain+brand+bare-zh all named (${badCfg.findings.length} findings)`);

  // parsers against the real markup shapes (layout head vs sitemap url)
  const layoutHead = '<link rel="canonical" href="https://clearlighttools.com/zh/pdf/compress-pdf/">\n  <link rel="alternate" hreflang="zh-Hans" href="https://clearlighttools.com/zh/pdf/compress-pdf/">\n  <link rel="alternate" hreflang="x-default" href="https://clearlighttools.com/en/pdf/compress-pdf/">\n<meta name="robots" content="index,follow,max-image-preview:large">';
  const pOk = canonicalOf(layoutHead) === `${OWNER_BASE}/zh/pdf/compress-pdf/` && alternatesOf(layoutHead).length === 2 && robotsOf(layoutHead) === 'index,follow,max-image-preview:large';
  if (!pOk) bad++;
  console.log(`  ${pOk ? 'ok  ' : 'FAIL'} parsers read the layout head (canonical, 2 alternates, robots)`);
  const smXml = '<url><loc>https://clearlighttools.com/en/</loc><lastmod>2026-11-13</lastmod></url>';
  const smParsed = sitemapUrls(smXml);
  const smOk = smParsed.length === 1 && smParsed[0].loc === `${OWNER_BASE}/en/` && smParsed[0].lastmod === '2026-11-13';
  if (!smOk) bad++;
  console.log(`  ${smOk ? 'ok  ' : 'FAIL'} parsers read a sitemap <url> (loc + lastmod, no alternates)`);

  // live read: a real built page head must parse, or the template moved underneath this gate
  let live = null;
  for (const f of ['en/index.html', 'en/pdf/compress-pdf/index.html', 'zh/index.html']) {
    const p = join(ROOT, 'dist', f);
    if (existsSync(p)) { const head = headOf(await readFile(p, 'utf8')); live = { f, canon: canonicalOf(head), alts: alternatesOf(head).length }; break; }
  }
  if (!live || !live.canon) { console.log('  FAIL no built page head could be read — dist/ missing or markup moved (run `node build.mjs`)'); bad++; }
  else console.log(`  ok   live head parses: ${live.f} canonical=${live.canon} alternates=${live.alts}`);
  // live read: the real sitemap.xml must parse into loc + lastmod, or the build moved underneath us
  const smPath = join(ROOT, 'dist', 'sitemap.xml');
  if (!existsSync(smPath)) { console.log('  FAIL dist/sitemap.xml missing — run `node build.mjs`'); bad++; }
  else {
    const u = sitemapUrls(await readFile(smPath, 'utf8'));
    if (!u.length || !u[0].loc || !u[0].lastmod) { console.log('  FAIL live sitemap.xml did not parse into loc + lastmod'); bad++; }
    else console.log(`  ok   live sitemap.xml parses: ${u.length} URLs, first=${u[0].loc} lastmod=${u[0].lastmod}`);
  }

  if (!cases.length) { console.error('EMPTY RUN: no selftest cases'); process.exit(1); }
  if (bad) { console.error(`\nselftest: ${bad} case(s) wrong — this gate would not see a technical-SEO defect`); process.exit(1); }
  console.log(`\nselftest: ${cases.length} cases + 3 counter-proofs + config judge + parsers + live reads all pass\n`);
}

// ---------------------------------------------------------------- main
if (flag('--selftest')) { await selftest(); process.exit(0); }

const cfg = JSON.parse(await readFile(join(ROOT, 'config', 'site.json'), 'utf8'));
const tools = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const categories = Object.keys(JSON.parse(await readFile(join(ROOT, 'src', 'data', 'categories.json'), 'utf8')));
const only = opt('locale');                         // opt() prepends "--", so pass the bare name
const locales = only ? [only] : cfg.locales;          // page sweep may be narrowed to one locale
const base = String(cfg.baselineUrl).replace(/\/$/, '');

if (!existsSync(join(ROOT, 'dist'))) {
  console.error('\ndist/ is missing — run `node build.mjs` first: this gate reads the built pages + sitemap');
  process.exit(1);
}

// hreflang codes come from the built client dicts — the SAME meta.hreflang the template head used.
const hreflangOf = {}; const dictGaps = [];
for (const l of cfg.locales) {
  try {
    const raw = (await readFile(join(ROOT, 'dist', '_assets', `dict.${l}.js`), 'utf8')).replace(/^window\.__TH_DICT\s*=/, '').replace(/;\s*$/, '');
    hreflangOf[l] = (JSON.parse(raw).meta || {}).hreflang || l;
  } catch (e) { hreflangOf[l] = l; dictGaps.push(`dict.${l}.js: ${String(e.message || e).split('\n')[0]}`); }
}
// allLocales is ALWAYS the full configured set: the sitemap is one global file, even under --locale.
const ctx = { base, defaultLocale: cfg.defaultLocale, brand: cfg.brand, locales, allLocales: cfg.locales, categories, tools, hreflangOf };

const cfgJudge = judgeConfig({ cfg: { ...cfg, locales }, hreflangOf });

// collect built pages
const pages = [];
for (const p of expectedPages(ctx)) {
  const fp = join(ROOT, 'dist', p.file);
  if (!existsSync(fp)) { pages.push({ ...p, exists: false }); continue; }
  const head = headOf(await readFile(fp, 'utf8'));
  pages.push({ ...p, exists: true, canonical: canonicalOf(head), robots: robotsOf(head), ogUrl: ogUrlOf(head), ogSiteName: ogSiteNameOf(head), alternates: alternatesOf(head) });
}
// collect the single sitemap.xml + robots.txt
const smPath = join(ROOT, 'dist', 'sitemap.xml');
let sitemap = { exists: false, urls: [], raw: '' };
if (existsSync(smPath)) { const raw = await readFile(smPath, 'utf8'); sitemap = { exists: true, urls: sitemapUrls(raw), raw }; }
const rbPath = join(ROOT, 'dist', 'robots.txt');
let robots = { exists: false, text: '' };
if (existsSync(rbPath)) robots = { exists: true, text: await readFile(rbPath, 'utf8') };
// the old multi-file sitemap must no longer exist anywhere in dist/
const legacy = {
  index: existsSync(join(ROOT, 'dist', 'sitemap-index.xml')),
  perLocale: cfg.locales.filter(l => existsSync(join(ROOT, 'dist', `sitemap-${l}.xml`))).map(l => `sitemap-${l}.xml`)
};

const { findings, counts } = judge({ pages, sitemap, robots, legacy, ctx });
const all = [...cfgJudge.findings.map(f => ({ scope: 'config', ...f })), ...findings];
const hard = all.filter(f => !f.soft);

console.log(`\ntechnical SEO tags — ${counts.pages} built page(s), ${counts.alternates} hreflang alternates, ${counts.sitemapUrls} sitemap URL(s) in one sitemap.xml (${ctx.allLocales.length} locales)`);
console.log(`  owner domain ${base}  brand "${cfg.brand}"  zh hreflang "${hreflangOf.zh}"`);
for (const g of dictGaps.slice(0, 5)) console.log(`  DICT GAP ${g}`);
const byRule = {};
for (const f of hard) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
if (hard.length) {
  console.log(`\n  HARD FINDINGS: ${hard.length}  ${Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  for (const f of hard.slice(0, 50)) console.log(`    [${f.rule}] ${f.scope}: ${f.why}`);
  if (hard.length > 50) console.log(`    … ${hard.length - 50} more`);
}

// non-empty guard: a moved dist / renamed markup / narrowed locale list must not report a comfy 0
const wantPages = expectedPages(ctx).length;
const wantSmUrls = expectedSitemapUrls(ctx).length;
if (!counts.pages) { console.error('\nEMPTY RUN: not one built page head was read'); process.exit(1); }
if (counts.pages < wantPages * 0.9) { console.error(`\nEMPTY RUN: only ${counts.pages}/${wantPages} pages read — dist/ incomplete`); process.exit(1); }
if (counts.sitemapUrls < wantSmUrls * 0.9) { console.error(`\nEMPTY RUN: only ${counts.sitemapUrls}/${wantSmUrls} sitemap URLs read — sitemap.xml missing or incomplete`); process.exit(1); }
if (hard.length || dictGaps.length) { console.error(`\n${hard.length} hard finding(s) + ${dictGaps.length} dict gap(s).`); process.exit(1); }
console.log(`\n  ok — canonicals, hreflang+x-default, robots meta, the single sitemap.xml and robots.txt all match the owner contract (${counts.pages} pages, ${counts.sitemapUrls} sitemap URLs)\n`);