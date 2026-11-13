// Page templates. Plain functions returning HTML strings; build.mjs writes them to dist/.
// Nothing here runs a framework: what you see in these strings is what lands in the .html files,
// which is what makes the pages crawlable and lets the tools work with JavaScript disabled shells.
//
// TKD (title / description / h1) is composed by the pure functions in src/seo/compose.mjs from the
// per-locale seed src/seo/tool-seo/<locale>.json (loaded into cfg.__toolSeo by build.mjs). The site
// ships NO <meta name="keywords"> on any page (owner request, 2026 Google norms). Every page carries
// a self-canonical and a full hreflang set + x-default, all on https://clearlighttools.com.
import { toolTitle, toolDesc, toolH1, plainTitle, catTitle, catDesc, CJK } from './seo/compose.mjs';

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const attr = (s = '') => esc(s).replace(/\n/g, ' ');

// ---------------------------------------------------------------------------
// urls
// ---------------------------------------------------------------------------
export function toolPath(tool) { return `${tool.cat}/${tool.id}/`; }

export function pageHref(locale, path) { return `/${locale}/${path}`; }

// ---------------------------------------------------------------------------
// seo composition
// ---------------------------------------------------------------------------
// Title / description / h1 come from src/seo/compose.mjs (imported above): toolTitle / toolDesc /
// toolH1 for tool pages, plainTitle / catDesc for category, all and legal pages. The per-locale
// building blocks live in src/seo/tool-seo/<locale>.json (cfg.__toolSeo). The site ships NO
// <meta name="keywords"> anywhere — the old kwJoin / toolLongTail / seoTitle composers were removed.

// ---------------------------------------------------------------------------
// ads — one native renderer, injected by the build into every page template.
// Master switch: config/site.json -> ads.enabled (ENABLE_ADS). When it is off, or when the AdSense
// client/slot ids are still empty (pre-approval / local testing), this returns '' so the page ships
// ZERO ad DOM — never an empty placeholder box. A real <ins> unit renders only once the switch is on
// AND both ids are filled. No popups/interstitials exist (runtime.js only pushes display units).
// Density is capped at the call sites below: tool/home/category keep <=2 slots, legal keeps 1.
// ---------------------------------------------------------------------------
export function adSlot(name, { dict, label = true, fold = false }) {
  const cfg = dict.__ads;
  if (!cfg || !cfg.enabled) return '';            // ENABLE_ADS off → no DOM at all
  const spec = cfg.slots[name];
  if (!spec) return '';
  const client = cfg.clientId;
  const slotId = spec.slotId || '';
  if (!client || !slotId) return '';              // unconfigured → no DOM, no placeholder box
  const [, h] = String(spec.size).split('x');
  const minH = fold ? Math.min(280, Math.max(90, Number(h) || 120)) : Math.max(90, Number(h) || 120);
  const tag = label ? `<p class="ad-tag">${esc(dict.ads?.label || 'Advertisement')}</p>` : '';
  const cls = `ad-slot ad-${name}${fold ? ' ad-fold' : ''}`;
  return `<div class="${cls}" style="--ad-h:${minH}px;" data-ad="${name}">
  ${tag}
  <ins class="adsbygoogle" style="display:block;min-height:var(--ad-h)" data-ad-client="${attr(client)}" data-ad-slot="${attr(slotId)}" data-ad-format="${attr(spec.format)}" data-full-width-responsive="true"></ins>
</div>`;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------
export function layout({ cfg, dict, locale, title, desc, path, kind = 'page', noindex = false, jsonLd = [], body, headExtra = '', ogType = 'website', activeCat = null }) {
  const base = cfg.baselineUrl.replace(/\/$/, '');
  const url = `${base}/${locale}/${path}`;
  const alts = cfg.locales.map(l => `  <link rel="alternate" hreflang="${attr(dictFor(l).meta.hreflang || l)}" href="${base}/${l}/${path}">`).join('\n');
  const home = pageHref(locale, '');
  const ogImg = `${base}/_assets/og.png`;
  const gtag = cfg.analytics?.gtagId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${attr(cfg.analytics.gtagId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${attr(cfg.analytics.gtagId)}');</script>` : '';
  const adclient = cfg.ads.enabled && cfg.ads.clientId ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${attr(cfg.ads.clientId)}" crossorigin="anonymous"></script>` : '';
  const ld = jsonLd.map(o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n');

  return `<!doctype html>
<html lang="${attr(dict.meta.langTag)}" dir="${attr(dict.meta.dir || 'ltr')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${base}/${locale}/${path}">
${alts}
  <link rel="alternate" hreflang="x-default" href="${base}/${cfg.defaultLocale}/${path}">
<meta name="robots" content="${noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large'}">
<meta property="og:type" content="${attr(ogType)}">
<meta property="og:site_name" content="${attr(cfg.brand)}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:url" content="${attr(url)}">
<meta property="og:image" content="${attr(ogImg)}">
<meta property="og:locale" content="${attr(dict.meta.ogLocale)}">
${cfg.locales.filter(l => l !== locale).map(l => `<meta property="og:locale:alternate" content="${attr(dictFor(l).meta.ogLocale)}">`).join('\n')}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(desc)}">
<meta name="twitter:image" content="${attr(ogImg)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="theme-color" content="#2f6df6">
<link rel="icon" href="/_assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/_assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/_assets/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/_assets/apple-touch-icon.png" sizes="180x180">
<link rel="stylesheet" href="/_assets/site.css">
${ld}
${headExtra}
${adclient}
${gtag}
</head>
<body data-locale="${attr(locale)}" data-path="${attr(path)}" data-kind="${attr(kind)}">
<a class="skip" href="#main">${esc(dict.common.skipToContent || 'Skip to content')}</a>
${header({ cfg, dict, locale, home, activeCat })}
<main id="main">
${body}
</main>
${footer({ cfg, dict, locale })}
${consent({ cfg, dict, locale })}
<script src="/_assets/dict.${attr(locale)}.js"></script>
<script src="/_assets/state.js"></script>
<script type="module" src="/_assets/runtime.js"></script>
</body>
</html>`;

  function dictFor(l) { return cfg.__dicts[l]; }
}

// ---------------------------------------------------------------------------
// chrome
// ---------------------------------------------------------------------------
function header({ cfg, dict, locale, home, activeCat }) {
  const cats = cfg.__categories;
  const catLinks = Object.keys(cats).sort((a, b) => cats[a].order - cats[b].order)
    .map(c => `<a href="${pageHref(locale, `${c}/`)}"${activeCat === c ? ' aria-current="page"' : ''}>${esc(dict.cat[c])}</a>`).join('');
  return `<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="${home}"><span class="logo-mark" aria-hidden="true">⌘</span>${esc(cfg.brand)}</a>
    <nav class="header-nav" id="header-nav" aria-label="${attr(dict.nav.categories)}">${catLinks}</nav>
    <div class="header-right">
      <button class="icon-btn" id="btn-search" aria-haspopup="dialog">🔍 <span class="sr-hide">${esc(dict.nav.search)}</span></button>
      <button class="icon-btn" id="btn-lang" aria-haspopup="true" aria-expanded="false">🌐 ${esc(dict.meta.localeName)}</button>
    </div>
  </div>
</header>
<div id="lang-mount"></div>
<div id="search-mount"></div>`;
}

function footer({ cfg, dict, locale }) {
  const cats = cfg.__categories;
  const catLinks = Object.keys(cats).sort((a, b) => cats[a].order - cats[b].order)
    .map(c => `<a href="${pageHref(locale, `${c}/`)}">${esc(dict.cat[c])}</a>`).join('');
  return `<footer class="site-footer">
  <div class="wrap foot-cols">
    <div>
      <a class="logo" href="${pageHref(locale, '')}"><span class="logo-mark" aria-hidden="true">⌘</span>${esc(cfg.brand)}</a>
      <p style="margin-top:10px;max-width:38ch;color:var(--ink-2)">${esc(dict.footer.tagline)}</p>
    </div>
    <div><h4>${esc(dict.nav.categories)}</h4>${catLinks}</div>
    <div><h4>${esc(dict.nav.allTools)}</h4>
      ${cfg.__tools.slice(0, 6).map(t => `<a href="${pageHref(locale, toolPath(t))}">${esc(dict.t[t.id]?.title || t.id)}</a>`).join('')}
      <a href="${pageHref(locale, 'all/')}">${esc(dict.nav.allTools)}</a>
    </div>
    <div><h4>${esc(dict.footer.about)}</h4>
      <a href="${pageHref(locale, 'about/')}">${esc(dict.footer.about)}</a>
      <a href="${pageHref(locale, 'privacy/')}">${esc(dict.footer.privacy)}</a>
      <a href="${pageHref(locale, 'terms/')}">${esc(dict.footer.terms)}</a>
      <a href="${pageHref(locale, 'dmca/')}">${esc(dict.footer.dmca)}</a>
      <a href="${pageHref(locale, 'contact/')}">${esc(dict.footer.contact)}</a>
    </div>
  </div>
  <div class="wrap foot-note">
    <span>© ${new Date().getFullYear()} ${esc(cfg.brand)}. ${esc(dict.footer.rights)}</span>
    <span>${esc(dict.footer.disclaimer)}</span>
  </div>
</footer>`;
}

function consent({ cfg, dict, locale }) {
  if (!cfg.consent?.enabled) return '';
  return `<div class="consent-bar" id="consent" hidden>
  <div><strong>${esc(dict.consent.title)}</strong></div>
  <p>${esc(dict.consent.body)} <a href="${pageHref(locale, 'privacy/')}">${esc(dict.consent.policy)}</a></p>
  <button class="btn ghost" data-consent="reject">${esc(dict.consent.reject)}</button>
  <button class="btn" data-consent="accept">${esc(dict.consent.accept)}</button>
</div>`;
}

// ---------------------------------------------------------------------------
// tool cards
// ---------------------------------------------------------------------------
export function toolCard(tool, dict, locale, withDesc = true) {
  const c = dict.t[tool.id] || {};
  return `<a class="tool-card" href="${pageHref(locale, toolPath(tool))}" data-search="${attr(`${c.title || tool.id} ${c.desc || ''} ${tool.kw.join(' ')} ${tool.id}`)}" data-cat="${attr(tool.cat)}">
  <span class="ico" aria-hidden="true">${cfgIcon(tool)}</span>
  <span><b>${esc(c.title || tool.id)}</b>${withDesc ? `<small>${esc(c.desc || '')}</small>` : ''}</span>
  ${tool.hot ? `<span class="hot">${esc(dict.nav.popular)}</span>` : ''}
</a>`;
}

function cfgIcon(tool) {
  const icons = { pdf: '📄', image: '🖼️', audio: '🎵', video: '🎬', text: '🔤', calc: '🧮' };
  return icons[tool.cat] || '🧰';
}

// ---------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------
export function homePage({ cfg, dict, locale }) {
  const cats = cfg.__categories;
  const hot = cfg.__tools.filter(t => t.hot).slice(0, 8);
  const blocks = Object.keys(cats).sort((a, b) => cats[a].order - cats[b].order).map((c) => {
    const list = cfg.__tools.filter(t => t.cat === c);
    return `<section class="cat-block" id="${attr(c)}">
  <div class="section-head"><h2>${esc(dict.cat[c])}</h2><a href="${pageHref(locale, `${c}/`)}">${esc(dict.home.byCategoryTitle)} →</a></div>
  <p class="cat-tag">${esc(dict.cat[`${c}.tagline`])}</p>
  <div class="grid">${list.map(t => toolCard(t, dict, locale)).join('\n  ')}</div>
</section>`;
  }).join('\n');

  const faqs = [1, 2, 3, 4].map(n => dict.home[`faq${n}Q`] && `<details class="faq-item"><summary>${esc(dict.home[`faq${n}Q`])}</summary><p>${esc(dict.home[`faq${n}A`])}</p></details>`).join('');
  const jsonLd = [{
    '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.brand, url: `${cfg.baselineUrl}/${locale}/`,
    potentialAction: { '@type': 'SearchAction', target: `${cfg.baselineUrl}/${locale}/all/?q={search_term_string}`, 'query-input': 'required name=search_term_string' }
  }, {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [1, 2, 3, 4].map(n => dict.home[`faq${n}Q`] && ({ '@type': 'Question', name: dict.home[`faq${n}Q`], acceptedAnswer: { '@type': 'Answer', text: dict.home[`faq${n}A`] } })).filter(Boolean)
  }];

  // The home <h1> is owner-specified per locale (EN: "Free Online Tools & Fast Browser Utilities"),
  // carried in the tool-seo seed's fixed.homeH1; heroTitle is only a fallback if the seed is absent.
  const homeH1 = (cfg.__toolSeo && cfg.__toolSeo[locale] && cfg.__toolSeo[locale].fixed && cfg.__toolSeo[locale].fixed.homeH1) || dict.home.heroTitle;

  const body = `<div class="wrap">
  ${adSlot('header', { dict })}
  <section class="hero">
    <h1>${esc(homeH1)}</h1>
    <p class="sub">${esc(dict.home.heroSubtitle)}</p>
    <div class="hero-cta"><a class="btn big" href="#pdf">${esc(dict.home.heroCta)}</a></div>
    <div class="trust">
      <span>🔒 ${esc(dict.common.private)}</span><span>🆓 ${esc(dict.common.free)}</span><span>⚡ ${esc(dict.common.offlineCapable)}</span>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>${esc(dict.home.popularTitle)}</h2></div>
    <div class="grid">${hot.map(t => toolCard(t, dict, locale)).join('\n  ')}</div>
  </section>

  <section class="home-cols">
    <div>${blocks}</div>
    <aside class="side">
      <div class="panel">
        <h3 class="side-title">${esc(dict.home.whyTitle)}</h3>
        <div class="why-list">
          ${[1, 2, 3].map(n => `<div class="why-item"><h3>${esc(dict.home[`why${n}Title`])}</h3><p>${esc(dict.home[`why${n}Body`])}</p></div>`).join('\n          ')}
        </div>
      </div>
    </aside>
  </section>

  <section class="section">
    <div class="section-head"><h2>${esc(dict.home.faqTitle)}</h2></div>
    <div class="prose">${faqs}</div>
  </section>
  ${adSlot('inContent', { dict })}
</div>`;

  // Home-page TKD is owner-specified: a concise per-locale <title> and meta description carrying the
  // brand (ClearLight Tools), translated from the owner's English copy. NO page ships meta keywords.
  // homeTitle/homeDesc come from src/seo/keywords.json; heroSubtitle is only a fallback description.
  const seo = cfg.__seo || {};
  const homeTitle = (seo.homeTitle && seo.homeTitle[locale]) || `${dict.home.heroTitle} - ${cfg.brand}`;
  const homeDesc = (seo.homeDesc && seo.homeDesc[locale]) || dict.home.heroSubtitle;

  return layout({ cfg, dict, locale, kind: 'home', path: '', title: homeTitle, desc: homeDesc, jsonLd, body, ogType: 'website' });
}

// ---------------------------------------------------------------------------
// tool page
// ---------------------------------------------------------------------------
export function toolPage({ cfg, dict, locale, tool }) {
  const c = dict.t[tool.id] || {};
  const en = cfg.__dicts.en.t[tool.id] || {};
  const title = c.title || en.title || tool.id;   // localized name: breadcrumb, JSON-LD, section heads
  const tseo = (cfg.__toolSeo && cfg.__toolSeo[locale]) || null;
  const fx = tseo && tseo.fixed;
  const entry = (tseo && tseo.tools && tseo.tools[tool.id]) || {};
  const seoTitleStr = fx ? toolTitle(title, locale, entry, fx, cfg.brand) : `${title} - ${cfg.brand}`;
  const h1 = fx ? toolH1(title, locale, fx) : (c.h1 || title);
  const desc = fx ? toolDesc(title, entry, fx, locale) : (c.desc || en.desc || '').slice(0, 200);
  const steps = (c.steps && c.steps.length ? c.steps : en.steps || []).filter(Boolean);
  const faq = (c.faq && c.faq.length ? c.faq : en.faq || []).filter(Boolean);
  const intro = c.intro || en.intro || '';
  const related = cfg.__tools.filter(t => t.cat === tool.cat && t.id !== tool.id).slice(0, 6);
  const others = cfg.__tools.filter(t => t.cat !== tool.cat && t.hot).slice(0, 4);
  const needsNotice = (dict.w && Object.keys(dict.w).length) || locale === 'en' || locale === 'zh' ? '' : `<p class="note">${esc(dict.tool.translationNotice)}</p>`;
  const bundle = { pdf: 'pdf', image: 'image', audio: 'audio', video: 'video', text: 'text', calc: 'calc' }[tool.cat];

  const crumb = [
    { name: dict.nav.home, url: pageHref(locale, '') },
    { name: dict.cat[tool.cat], url: pageHref(locale, `${tool.cat}/`) },
    { name: title, url: null }
  ];
  const breadcrumbLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumb.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: item.url ? `${cfg.baselineUrl}/${locale}/${item.url}` : undefined })).map(o => (o.item ? o : (delete o.item, o)))
  };
  const appLd = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: title, url: `${cfg.baselineUrl}/${locale}/${toolPath(tool)}`,
    applicationCategory: { pdf: 'UtilitiesApplication', image: 'MultimediaApplication', audio: 'MultimediaApplication', video: 'MultimediaApplication', text: 'DeveloperApplication', calc: 'UtilitiesApplication' }[tool.cat],
    operatingSystem: 'Any', browserRequirements: 'Requires JavaScript', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: desc, inLanguage: dict.meta.langTag, featureList: steps.slice(0, 4)
  };
  const jsonLd = [breadcrumbLd, appLd];
  if (steps.length) jsonLd.push({
    '@context': 'https://schema.org', '@type': 'HowTo', name: dict.tool.howToTitle.replace('{title}', title),
    step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.split(/[.:]/)[0].slice(0, 70), itemListElement: [{ '@type': 'HowToDirection', text: s }] }))
  });
  if (faq.length) jsonLd.push({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  });

  const panel = `<div class="panel tool-panel" id="tool-panel">
  <div id="tool-root" data-tool="${attr(tool.id)}" data-bundle="${attr(bundle)}" data-libs="${attr((tool.needs || []).join(','))}" data-type="${attr(tool.type)}">
    <p class="skeleton">${esc(dict.common.loading || 'Loading tool…')}</p>
  </div>
</div>`;

  const body = `<div class="wrap tool-layout">
  <div class="tool-main">
    ${adSlot('header', { dict })}
    <nav class="breadcrumb" aria-label="${attr(dict.nav.home)}">
      <a href="${crumb[0].url}">${esc(crumb[0].name)}</a><span><a href="${crumb[1].url}">${esc(crumb[1].name)}</a></span><span>${esc(crumb[2].name)}</span>
    </nav>
    <div class="tool-head">
      <h1>${esc(h1)}</h1>
      ${intro ? `<p class="lede">${esc(intro)}</p>` : ''}
      <div class="badges">
        <span class="badge">🔒 ${esc(dict.tool.introBadgeLocal)}</span>
        <span class="badge">🆓 ${esc(dict.tool.introBadgeFree)}</span>
        <span class="badge">⚡ ${esc(dict.tool.introBadgeFast)}</span>
      </div>
    </div>
    ${panel}
    ${needsNotice}
    ${adSlot('inContent', { dict })}

    ${steps.length ? `<section class="prose" id="how-to"><h2>${esc(dict.tool.howToTitle.replace('{title}', title))}</h2>
      <ol class="steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>` : ''}

    ${faq.length ? `<section class="prose" id="faq"><h2>${esc(dict.tool.faqTitle.replace('{title}', title))}</h2>
      ${faq.map(f => `<details class="faq-item" open><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</section>` : ''}

    <section class="prose" id="overview">
      <h2>${esc(dict.tool.aboutTitle.replace('{title}', title))}</h2>
      <p>${esc(desc)}</p>
      <p>${esc((dict.tool.overview || {})[tool.cat] || '')}</p>
      <p>${esc(dict.tool.privacyLine)} ${esc((dict.tool.tip || {})[tool.cat] || '')}</p>
    </section>

    <section class="prose" id="about">
      <h2>${esc(dict.tool.allToolsTitle)}</h2>
      <div class="related-grid">
        ${others.map(t => toolCard(t, dict, locale, false)).join('\n        ')}
      </div>
    </section>
  </div>

  <aside class="side">
    <div class="panel">
      <h3 class="side-title">${esc(dict.tool.relatedTitle)}</h3>
      <div class="side-list">
        ${related.map(t => `<a href="${pageHref(locale, toolPath(t))}">${esc(dict.t[t.id]?.title || t.id)}</a>`).join('\n        ')}
      </div>
    </div>
    <div class="panel">
      <h3 class="side-title">${esc(dict.nav.categories)}</h3>
      <div class="side-list">
        ${Object.keys(cfg.__categories).map(cc => `<a href="${pageHref(locale, `${cc}/`)}"${cc === tool.cat ? ' aria-current="page"' : ''}>${esc(dict.cat[cc])}</a>`).join('\n        ')}
      </div>
    </div>
  </aside>
</div>`;

  return layout({
    cfg, dict, locale, kind: 'tool', path: toolPath(tool),
    title: seoTitleStr, desc, jsonLd, body, ogType: 'website', activeCat: tool.cat
  });
}

// ---------------------------------------------------------------------------
// category / all
// ---------------------------------------------------------------------------
export function categoryPage({ cfg, dict, locale, cat }) {
  const list = cat ? cfg.__tools.filter(t => t.cat === cat) : cfg.__tools;
  const label = cat ? dict.cat[cat] : dict.nav.allTools;   // short nav label — breadcrumb only
  const seo = cfg.__toolSeo && cfg.__toolSeo[locale];
  const fx = seo && seo.fixed;
  // Long-tail category seoName (modifier + secondary intent, e.g. "Image Tools & Converters") from the
  // per-locale seed's cats block — NOT the bare nav label. Drives the <title>, <h1> and meta description
  // so every listing page carries a precise, localized long-tail keyword. build.mjs validates that cats
  // covers all six categories + "all"; the label fallback only guards a hypothetically absent seed.
  const seoName = (seo && seo.cats && seo.cats[cat || 'all']) || label;
  // The "all" listing uses the concise footer tagline for its meta description: the hero subtitle is a
  // longer marketing sentence (109-143 cps) that pushed the "all" snippet to 170-229 cps. The visible
  // on-page subtitle below still uses the richer heroSubtitle — length only matters for the SERP tag.
  const tagline = cat ? dict.cat[`${cat}.tagline`] : dict.footer.tagline;
  const desc = fx ? catDesc(seoName, tagline, fx, locale) : `${tagline} ${cfg.brand}`;
  const h1 = fx ? toolH1(seoName, locale, fx) : label;
  const title = fx ? catTitle(seoName, locale, fx, cfg.brand) : plainTitle(label, cfg.brand);
  const body = `<div class="wrap">
  ${adSlot('header', { dict })}
  <nav class="breadcrumb"><a href="${pageHref(locale, '')}">${esc(dict.nav.home)}</a><span>${esc(label)}</span></nav>
  <section class="hero" style="padding-bottom:6px">
    <h1>${esc(h1)}</h1>
    <p class="sub">${esc(cat ? dict.cat[`${cat}.tagline`] : dict.home.heroSubtitle)}</p>
  </section>
  <section class="section">
    <div class="grid" id="cat-grid">${list.map(t => toolCard(t, dict, locale)).join('\n  ')}</div>
  </section>
  ${adSlot('inContent', { dict })}
</div>`;
  return layout({ cfg, dict, locale, kind: 'category', path: cat ? `${cat}/` : 'all/', title, desc, body, activeCat: cat });
}

// ---------------------------------------------------------------------------
// legal / static
// ---------------------------------------------------------------------------
export function legalPage({ cfg, dict, locale, slug }) {
  const map = {
    about: { h: dict.footer.about, key: null },
    privacy: { h: dict.legal.privacyH1, key: 'privacyIntro' },
    terms: { h: dict.legal.termsH1, key: 'termsIntro' },
    dmca: { h: dict.legal.dmcaH1, key: 'dmcaIntro' },
    contact: { h: dict.footer.contact, key: null }
  };
  const m = map[slug];
  const paras = {
    about: [dict.footer.tagline, dict.home.why1Body, dict.home.why2Body, dict.home.why3Body],
    privacy: [dict.legal.privacyIntro, dict.home.faq2A, dict.consent.body, 'We keep no copy of any file. Analytics are aggregate and cookie consent is respected for EU/EEA/UK visitors. Contact: ' + cfg.supportEmail],
    terms: [dict.legal.termsIntro, dict.footer.disclaimer, 'Tools are provided free of charge. Automated use that overloads the site is not permitted. Trademarks of third parties mentioned on the site belong to their owners.'],
    dmca: [dict.legal.dmcaIntro, 'If you believe a linked resource infringes your rights, write to ' + cfg.supportEmail + ' with the URL, a description of the work and a contact address. We respond within two business days.'],
    contact: [dict.legal.contactIntro]
  }[slug] || [];
  // The contact page's call to action is the mailbox itself: a clickable mailto button, not a
  // plain-text address. (It used to print a stray WordPress setup note here — removed.)
  const contactBlock = slug === 'contact'
    ? `\n      <p class="contact-mail"><a class="btn" href="mailto:${esc(cfg.supportEmail)}">${esc(cfg.supportEmail)}</a></p>`
    : '';
  const body = `<div class="wrap">
  <nav class="breadcrumb"><a href="${pageHref(locale, '')}">${esc(dict.nav.home)}</a><span>${esc(m.h)}</span></nav>
  <div class="prose legal-prose">
    <h1>${esc(m.h)}</h1>
    ${paras.filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('\n    ')}${contactBlock}
    <p class="note">${esc(dict.common.private)}.</p>
  </div>
  ${adSlot('inContent', { dict })}
</div>`;
  return layout({ cfg, dict, locale, kind: 'legal', path: `${slug}/`, title: plainTitle(m.h, cfg.brand), desc: paras[0] || dict.footer.tagline, body, noindex: slug === 'contact' });
}

// ---------------------------------------------------------------------------
// 404 + root redirect
// ---------------------------------------------------------------------------
export function notFoundPage({ cfg, dict, locale }) {
  const body = `<div class="wrap" style="padding:60px 16px 80px">
  <h1>${esc(dict['404'].title)}</h1>
  <p class="sub">${esc(dict['404'].body)}</p>
  <p><a class="btn" href="${pageHref(locale, '')}">${esc(dict['404'].home)}</a></p>
  <div class="grid" style="margin-top:26px">${cfg.__tools.filter(t => t.hot).slice(0, 8).map(t => toolCard(t, dict, locale, false)).join('\n  ')}</div>
</div>`;
  return layout({ cfg, dict, locale, kind: '404', path: '', title: plainTitle(dict['404'].title, cfg.brand), desc: dict['404'].body, body, noindex: true });
}

export function rootRedirectPage(cfg) {
  const list = cfg.locales.map(l => `<a href="/${l}/" hreflang="${attr(cfg.__dicts[l].meta.hreflang || l)}">${esc(cfg.__dicts[l].meta.localeName)}</a>`).join(' ');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.brand)} — choose your language</title>
<meta name="description" content="${esc(cfg.productName)}">
<link rel="canonical" href="${cfg.baselineUrl}/${cfg.defaultLocale}/">
<meta name="robots" content="index,follow">
${cfg.locales.map(l => `<link rel="alternate" hreflang="${attr(cfg.__dicts[l].meta.hreflang || l)}" href="${cfg.baselineUrl}/${l}/">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${cfg.baselineUrl}/${cfg.defaultLocale}/">
<link rel="icon" href="/_assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/_assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/_assets/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/_assets/apple-touch-icon.png" sizes="180x180">
<link rel="stylesheet" href="/_assets/site.css">
</head>
<body data-locale="" data-path="" data-kind="root">
<main id="main" class="wrap" style="padding:48px 16px">
  <noscript><p>${list}</p></noscript>
  <div id="root-msg" hidden>
    <p style="color:var(--ink-3)">${esc(cfg.brand)} — ${esc(cfg.productName)}</p>
    <p>${list}</p>
  </div>
  <footer class="wrap" style="padding:0 16px 40px;font-size:14px;display:flex;gap:14px;flex-wrap:wrap">
    <a href="/${cfg.defaultLocale}/privacy/">${esc(cfg.__dicts[cfg.defaultLocale].footer.privacy)}</a>
    <a href="/${cfg.defaultLocale}/terms/">${esc(cfg.__dicts[cfg.defaultLocale].footer.terms)}</a>
    <a href="/${cfg.defaultLocale}/about/">${esc(cfg.__dicts[cfg.defaultLocale].footer.about)}</a>
    <a href="/${cfg.defaultLocale}/contact/">${esc(cfg.__dicts[cfg.defaultLocale].footer.contact)}</a>
  </footer>
</main>
<script src="/_assets/state.js"></script>
<script type="module" src="/_assets/router.js"></script>
</body></html>`;
}
