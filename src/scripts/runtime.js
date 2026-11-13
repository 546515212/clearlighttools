// Chrome + tool loader. Runs on every page as an ES module.
import { el, $, D, t, fill } from './lib.js';
import { geoCountry, writeCookie } from './i18n.js';

const cfg = window.__TH_CONFIG;
const body = document.body;
const here = body.dataset.locale;
const path = body.dataset.path || '';
const noads = new URLSearchParams(location.search).has('noads');

if (noads) document.documentElement.classList.add('noads');
if (noads) {
  const s = el('style', { text: '.ad-slot{display:none!important}' });
  document.head.append(s);
}

// ---------------------------------------------------------------- ad units
if (cfg.ads.enabled && cfg.ads.clientId && !noads) {
  requestAnimationFrame(() => {
    document.querySelectorAll('ins.adsbygoogle').forEach(ins => {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { console.warn('ad blocked', e); }
    });
  });
}

// ---------------------------------------------------------------- tool loader
const root = $('#tool-root');
if (root) {
  const { tool, bundle, libs } = root.dataset;
  (async () => {
    try {
      await Promise.all((libs ? libs.split(',') : []).map(l => import('./lib.js').then(m => m.loadLib(l.trim()))));
      const mod = await import(`./tools/${bundle}.js`);
      const fn = (mod.tools || mod)[tool];
      if (!fn) throw new Error(`tool ${tool} missing from ${bundle}.js`);
      root.replaceChildren();
      await fn(root, { cfg, dict: D, locale: here, t });
    } catch (err) {
      console.error(err);
      root.replaceChildren(el('p', { class: 'note err', text: `${D.common.libMissing || 'This tool could not start.'} ${err.message || ''}` }));
    }
  })();
}

// ---------------------------------------------------------------- language menu
const langBtn = $('#btn-lang');
const langMount = $('#lang-mount');
if (langBtn && langMount) {
  let open = false;
  const close = () => { open = false; langMount.replaceChildren(); langBtn.setAttribute('aria-expanded', 'false'); };
  const menu = () => {
    const items = cfg.locales.map(l => el('button', {
      onClick: () => { writeCookie(l); location.href = `/${l}/${path}`; },
      'aria-current': l === here ? 'true' : null
    }, el('span', { text: names()[l] || l }), el('span', { text: l === here ? '✓' : '' })));
    return el('div', { class: 'lang-menu', role: 'menu' },
      ...items,
      el('div', { class: 'why', text: D.tool.langHint || 'The site opens in English by default. Choose your language here.' }));
  };
  const names = () => cfg.localeNames;
  langBtn.addEventListener('click', () => {
    open = !open;
    langBtn.setAttribute('aria-expanded', String(open));
    fill(langMount, open ? menu() : null);
  });
  document.addEventListener('click', e => { if (open && !langMount.contains(e.target) && e.target !== langBtn) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

// ---------------------------------------------------------------- search
const searchBtn = $('#btn-search');
const searchMount = $('#search-mount');
if (searchBtn && searchMount) {
  let index = null;
  let open = false;
  const load = async () => {
    if (index) return index;
    const [tools] = await Promise.all([fetch('/_assets/tools.json').then(r => r.json())]);
    index = tools.map(x => ({ ...x, title: D.search?.[x.id]?.title || x.id, desc: D.search?.[x.id]?.desc || '' }));
    return index;
  };
  // Category order is the order the tools appear in tools.json, which is the order categories.json
  // declares — deriving it here keeps the panel from hardcoding a fourth list that can drift.
  const groups = list => {
    const out = [];
    for (const item of list) {
      let g = out.find(x => x.cat === item.cat);
      if (!g) out.push(g = { cat: item.cat, items: [] });
      g.items.push(item);
    }
    return out;
  };
  const catHead = g => el('a', { class: 'search-cat', href: `/${here}/${g.cat}/` },
    el('b', { text: D.cat?.[g.cat] || g.cat }),
    el('span', { text: String(g.items.length) }));
  // An empty query used to be `list.slice(0, 12)`: the first twelve rows of tools.json, which are
  // all PDF, with no headings — on a phone that is five rows and no way to reach the other 37 tools.
  // It is now the whole catalogue, grouped, and a search shows every match instead of the first 14.
  const row = (item, withDesc) => el('a', { href: `/${here}/${item.cat}/${item.id}/` },
    el('b', { text: item.title }),
    withDesc && item.desc ? el('small', { text: item.desc }) : null);
  const results = (list, q) => {
    if (!list.length) return el('div', { class: 'search-empty', text: D.common.noResults || 'No tool matches that search.' });
    const browsing = !q.trim();
    return el('div', { class: browsing ? 'search-browse' : 'search-matched' },
      ...groups(list).flatMap(g => [catHead(g), ...g.items.map(i => row(i, !browsing))]));
  };
  const match = (list, q) => {
    const n = q.toLowerCase().trim();
    if (!n) return list;
    return list.filter(i => `${i.title} ${i.desc} ${i.id} ${(i.kw || []).join(' ')} ${D.cat?.[i.cat] || ''}`
      .toLowerCase().includes(n));
  };
  const panel = async () => {
    const list = await load();
    const draw = q => box.replaceChildren(results(match(list, q), q));
    const input = el('input', { type: 'search', placeholder: D.nav.searchPlaceholder || 'Search tools…', autofocus: true,
      oninput: () => draw(input.value),
      onkeydown: e => { if (e.key === 'Escape') close(); } });
    const box = el('div', { class: 'search-results' });
    draw('');
    const panelEl = el('div', { class: 'search-box' }, input, box);
    const wrap = el('div', { class: 'search-panel', onClick: e => { if (e.target === wrap) close(); } }, panelEl);
    setTimeout(() => input.focus(), 30);
    return wrap;
  };
  const toggle = async () => {
    if (open) { close(); return; }
    open = true;
    searchMount.append(await panel());
  };
  const close = () => { open = false; searchMount.replaceChildren(); };
  searchBtn.addEventListener('click', toggle);
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); toggle(); }
    if (e.key === 'Escape' && open) close();
  });
}

// ---------------------------------------------------------------- mobile nav
const nav = $('#header-nav');
if (nav && matchMedia('(max-width:1000px)').matches) {
  const btn = el('button', { class: 'icon-btn', text: '☰', 'aria-label': D.nav.menu, onClick: () => nav.classList.toggle('open') });
  $('.header-right').prepend(btn);
}

// ---------------------------------------------------------------- consent (GDPR)
// Language is never suggested or switched from the visitor's IP/region: the site opens in English
// and the only way to change language is the manual header menu below. geoCountry() is kept solely
// to decide whether the AdSense consent banner must show (EU/EEA/GB/CH), which is unrelated to i18n.
(async () => {
  const stored = localStorage.getItem('th_consent');
  const country = await geoCountry();
  // cookie banner for GDPR regions (AdSense requires consent before personalised ads)
  if (!stored && cfg.consent?.enabled && isEu(country)) {
    const bar = $('#consent');
    if (bar) {
      bar.hidden = false;
      bar.querySelectorAll('[data-consent]').forEach(b => b.addEventListener('click', () => {
        localStorage.setItem('th_consent', b.dataset.consent);
        bar.remove();
      }));
    }
  }
})();

function isEu(cc) {
  const eu = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS NO LI GB UK'.split(' ');
  return eu.includes((cc || '').toUpperCase());
}
