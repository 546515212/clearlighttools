#!/usr/bin/env node
// One-pass generator for the second tools batch (9 new tools + the loan-calculator equal-principal
// enhancement). Writes the English tool copy, the per-locale chrome (search count only — no new
// categories, the 9 tools slot into calc/pdf/image/text), the per-locale translation shards (t copy +
// the 195 new widget labels) and the keyword source. It validates SERP lengths and placeholder
// integrity BEFORE writing, so a too-long description or a dropped {0} is caught here rather than by
// a red gate after the build. Re-runnable: it merges into existing files.
//
//   node scripts/gen-tools-batch.mjs --emit-source   write the authoritative English source for translators
//   node scripts/gen-tools-batch.mjs --dry           validate the per-locale data, write nothing
//   node scripts/gen-tools-batch.mjs                 validate + write everything
//
// Unlike the media batch there is NO category or home-title change: every new tool belongs to an
// existing category, and the home title is left exactly as it is (the user asked for the SEO to be
// written once, not revised twice). Only the search placeholder count moves 60 -> 69.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';

const DRY = process.argv.includes('--dry');
const EMIT_SOURCE = process.argv.includes('--emit-source');
const L = (...a) => join(ROOT, 'src', 'locales', ...a);
const readJ = p => JSON.parse(readFileSync(p, 'utf8'));
const writeJ = (p, o) => { if (!DRY) writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8'); };
const cps = s => [...String(s ?? '').trim()].length;

// The 9 new tools, grouped by the category they belong to (the bundle that renders them).
const CALC_NEW = ['shoe-size-converter', 'rmb-uppercase', 'world-clock', 'pomodoro-timer', 'random-picker'];
const PDF_NEW = ['invoice-generator'];
const IMAGE_NEW = ['signature-pad', 'id-photo-maker'];
const TEXT_NEW = ['contract-generator'];
const NEW_IDS = [...CALC_NEW, ...PDF_NEW, ...IMAGE_NEW, ...TEXT_NEW];

// ---------------------------------------------------------------- English tool copy (the SEO source)
// title = the short nav label and the base of the Google SEO title (<=50cp). h1 = the keyword-rich
// page heading. desc = the meta description (<=160cp soft, <=170 hard). intro/steps[4]/faq[2] = the
// on-page copy. Every desc is written to stay inside the SERP budget in English; the per-locale
// validate() enforces the same budget on the translations.
const EN_T = {
  'shoe-size-converter': {
    title: 'Shoe Size Converter',
    h1: 'Shoe size converter — US, EU, UK and CN',
    desc: 'Convert shoe sizes between US, EU, UK and CN for men and women. Enter a size or foot length and see every system at once — free and instant.',
    intro: 'This converter maps a shoe size or a foot length in centimetres across the US, EU, UK and CN systems, for both men’s and women’s fits. Type a size in any system, or measure your foot heel-to-toe, and it shows the equivalent in all the others plus the foot length in cm and inches. Conversions are approximate retail standards and vary by brand and last.',
    steps: ['Choose men’s or women’s fit.', 'Pick the size system you know (US, EU, UK, CN or cm).', 'Enter your size or foot length.', 'Read the equivalent sizes in every system.'],
    faq: [
      { q: 'How do I measure my foot for the right size?', a: 'Stand on paper in the evening, mark the heel and the longest toe, and measure the distance in centimetres. Enter that length in the cm system; measure both feet and use the larger one.' },
      { q: 'Are these conversions exact?', a: 'They are approximate retail standards. Brands and shoe lasts differ, so always check the maker’s own size chart and choose the larger size when you fall between two.' }
    ]
  },
  'rmb-uppercase': {
    title: 'RMB Uppercase Converter',
    h1: 'Convert an amount to Chinese uppercase RMB',
    desc: 'Convert a number to the Chinese uppercase RMB amount used on cheques and invoices. Handles yuan, jiao and fen. Free, instant, no upload.',
    intro: 'Type an amount and the converter writes it in the financial Chinese uppercase form (daxie) used on cheques, invoices and contracts to prevent tampering. It handles yuan, jiao and fen, marks an exact whole amount correctly, and works up to just under one trillion. The calculation uses integer cents to avoid floating-point errors.',
    steps: ['Enter the amount, for example 1234.56.', 'The uppercase RMB amount appears instantly.', 'Check the yuan, jiao and fen parts.', 'Copy the result for your cheque or invoice.'],
    faq: [
      { q: 'What is the Chinese uppercase amount for?', a: 'It is the tamper-resistant financial form (daxie) required on cheques, invoices and contracts in China, where ordinary digits could be altered. Each digit has a complex character that is hard to forge.' },
      { q: 'How are decimals handled?', a: 'The first decimal place is jiao and the second is fen. An exact whole amount ends with a character marking “no cents”, so 100 and 100.00 are both written correctly.' }
    ]
  },
  'world-clock': {
    title: 'World Clock',
    h1: 'World clock — time zones and meeting planner',
    desc: 'See the live time in 12 world cities, compare time zones and plan a meeting across them, with business-hours highlights. Free, no sign-up.',
    intro: 'The world clock shows the live time in twelve major cities, each with its date and a green dot during local business hours (09:00–18:00). Drag the planner to line up a meeting across time zones and see what time it lands in each city, with a badge when a city is on a different calendar day. Times are shown against your own time zone.',
    steps: ['See the live time in twelve world cities.', 'Note the green business-hours dots and day badges.', 'Drag the planner to set a meeting time.', 'Read the local time in each city.'],
    faq: [
      { q: 'Does it account for daylight saving time?', a: 'Yes. Times are computed with your browser’s time-zone database, so daylight saving transitions are applied automatically for each city.' },
      { q: 'How do I plan a meeting across time zones?', a: 'Drag the planner slider to a time in your own zone; every city card updates to show its local time, and a badge marks any city that falls on a different day.' }
    ]
  },
  'pomodoro-timer': {
    title: 'Pomodoro Timer',
    h1: 'Pomodoro focus timer with breaks',
    desc: 'A Pomodoro timer for focused work: 25-minute sessions, short and long breaks, a session counter and an optional chime. Free, in-browser.',
    intro: 'The Pomodoro technique alternates focused work with short breaks, and a longer break after a few rounds. Set the focus, short-break and long-break lengths, start the timer, and it counts down with a session counter and an optional chime at each phase change. Fullscreen mode keeps a large countdown visible while you work. The timer runs while the tab is open.',
    steps: ['Set your focus and break lengths.', 'Press Start to begin a focus session.', 'Work until the chime, then take a break.', 'Repeat; a long break comes after a few rounds.'],
    faq: [
      { q: 'What are the default Pomodoro lengths?', a: 'The classic cycle is 25 minutes of focus, a 5-minute short break, and a 15-minute long break after four focus sessions. You can change all three lengths and the number of rounds.' },
      { q: 'Does it stay accurate if I switch tabs?', a: 'The timer counts against the clock rather than decrementing, so it stays accurate even when the browser throttles a background tab. Keep the tab open, or use fullscreen for a large countdown.' }
    ]
  },
  'random-picker': {
    title: 'Random Picker',
    h1: 'Random name picker and spin-the-wheel',
    desc: 'Spin a wheel to pick a random name, or draw a winner instantly. Add one name per line, remove winners and pick a whole team. Free, no upload.',
    intro: 'Type one name per line, spin the wheel, and a winner is chosen with crypto.getRandomValues() so every name has an equal chance. Remove the winner after each draw to pick a whole team in order, or use Quick draw for an instant result without the animation. Reset to start again. Everything runs locally in your browser.',
    steps: ['Enter one name per line.', 'Press Spin the wheel (or Quick draw).', 'Read the winner.', 'Remove the winner to draw again, or reset.'],
    faq: [
      { q: 'Is the pick truly random?', a: 'Yes. It uses the browser’s crypto.getRandomValues(), a cryptographically secure random source, so each name has an equal chance and the result is not predictable.' },
      { q: 'Can I pick several winners without repeats?', a: 'Yes. Use “Remove winner” after each draw to take that name out of the wheel, so you can pick a whole team in order. Reset restores all the names.' }
    ]
  },
  'invoice-generator': {
    title: 'Invoice Generator',
    h1: 'Free invoice generator — create a PDF invoice',
    desc: 'Create a professional invoice in your browser. Add your details, line items, tax and discount, then download a PDF or PNG. Free, no upload.',
    intro: 'Fill in the seller and client details, add line items with quantities and prices, set a discount and tax rate, and the generator lays out a clean invoice with totals. Preview it, then export a one-page PDF or a PNG image. Everything is drawn locally in your browser, so your financial details never leave your device.',
    steps: ['Enter your details and the client’s details.', 'Add line items with quantity and unit price.', 'Set the currency, discount and tax rate.', 'Generate, then download the PDF or PNG.'],
    faq: [
      { q: 'Is my invoice data uploaded anywhere?', a: 'No. The invoice is rendered on a canvas in your browser and exported locally as a PDF or PNG. Nothing is sent to a server, so your figures stay private.' },
      { q: 'Can I use my own currency and tax rate?', a: 'Yes. Pick from eight currencies and set any discount percentage and tax rate; the subtotal, discount, tax and total are calculated for you.' }
    ]
  },
  'signature-pad': {
    title: 'Signature Pad',
    h1: 'Draw your signature online — transparent PNG',
    desc: 'Draw your signature with a mouse, finger or stylus and download a transparent PNG. Undo, clear and trim empty space. Free, no upload.',
    intro: 'Sign on the canvas with a mouse, touch screen or stylus, choose a pen colour and width, and download a PNG with a transparent background so it drops cleanly onto a contract or form. Undo strokes, clear the pad, or trim the empty space around your signature. Nothing is uploaded — the drawing stays in your browser.',
    steps: ['Draw your signature on the pad.', 'Adjust the pen colour and width if needed.', 'Undo or clear to fix mistakes; trim empty space.', 'Download the transparent PNG.'],
    faq: [
      { q: 'Why is the background transparent?', a: 'The PNG is exported with an alpha channel, so only your strokes are opaque. That lets you place the signature over a document without a white box around it.' },
      { q: 'Can I sign on a phone or tablet?', a: 'Yes. The pad uses pointer events, so a finger or stylus works just like a mouse. Draw, then download the PNG to your device.' }
    ]
  },
  'id-photo-maker': {
    title: 'ID Photo Maker',
    h1: 'Passport and ID photo maker online',
    desc: 'Make passport, visa and ID photos at home. Crop to the right size, set the dpi, and replace the background with white, blue or red. Free.',
    intro: 'Upload a portrait, choose a preset (China 1-inch, China 2-inch, passport/visa or US passport) or a custom size in millimetres, and set the print resolution. Zoom and shift to frame the head, then optionally replace a plain background with white, blue or red. The photo is processed locally and downloaded as a JPEG ready to print.',
    steps: ['Upload a clear, front-facing portrait.', 'Pick a size preset or set a custom width and height.', 'Zoom and adjust the position; optionally replace the background.', 'Make the photo and download the JPEG.'],
    faq: [
      { q: 'Will this photo be accepted for my passport?', a: 'It produces a correctly sized, high-resolution photo, but acceptance depends on your issuing authority’s rules for pose, lighting and background. Always check the official requirements before printing.' },
      { q: 'How does background replacement work?', a: 'It keys out the colour in the top-left corner of your photo, so start with a plain, evenly lit backdrop. Adjust the tolerance to remove more or less of the old background.' }
    ]
  },
  'contract-generator': {
    title: 'Contract Generator',
    h1: 'Free NDA and service agreement generator',
    desc: 'Generate a mutual NDA or a service agreement from a simple template. Fill in the parties, purpose and terms, then download or print. Free.',
    intro: 'Choose a mutual non-disclosure agreement or a service agreement, fill in the parties, the effective date, the purpose or scope, the term and the governing law, and the generator assembles a plain-language draft. Download it as a text file or print it. The draft is created in your browser and never uploaded. This is a general template, not legal advice — have a qualified lawyer review it before signing.',
    steps: ['Choose NDA or service agreement.', 'Enter the parties, date and key terms.', 'Generate the draft and read it over.', 'Download the .txt or print it.'],
    faq: [
      { q: 'Is this a legally binding contract?', a: 'It is a general template to start from, not legal advice. Laws differ by country and situation, so have a qualified lawyer review and adapt it before anyone signs.' },
      { q: 'What can I customise?', a: 'The parties, effective date, purpose or scope of services, fee, term and governing law. Delete clauses that do not apply and add the details specific to your deal.' }
    ]
  }
};

const EN_SEARCH = 'Search 69 free tools…';

// ---------------------------------------------------------------- the 195 new widget keys
// Read from the file extracted out of en.tools.json after `i18n-wrap --adopt`, so the key set is the
// one the build actually reads — never hand-copied. Order is preserved (loan, shoe, rmb, city, clock,
// pomo, picker, sign, id, invoice, contract).
const NEW_KEYS_FILE = join(ROOT, 'scripts', 'tools-i18n', '_newkeys.json');
const EN_W = readJ(NEW_KEYS_FILE);
const W_KEYS = Object.keys(EN_W);

// ---------------------------------------------------------------- the new keyword phrases
// Computed from the real registry: every kw phrase of the 9 new tools plus loan-calculator, minus the
// phrases the SEO source already carries (loan's original "emi calculator"/"monthly payment"/"interest").
// This is exactly the set toolLongTail() will demand a translation for, so a missing one fails here.
const LOCALES = ['zh', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'ru', 'vi', 'ms', 'id', 'hi'];
const I18N_DIR = join(ROOT, 'scripts', 'tools-i18n');
const exists = p => { try { readFileSync(p); return true; } catch { return false; } };

function newPhrases() {
  const tools = readJ(join(ROOT, 'src', 'data', 'tools.json'));
  const seo = readJ(join(ROOT, 'src', 'seo', 'keywords.json'));
  const ids = [...NEW_IDS, 'loan-calculator'];
  const all = [...new Set(ids.flatMap(id => {
    const t = tools.find(x => x.id === id);
    if (!t) throw new Error(`registry has no tool "${id}"`);
    return t.kw || [];
  }))];
  const have = new Set(Object.keys(seo.kw.zh || {}));
  return all.filter(p => !have.has(p));
}
const PHRASES = newPhrases();

const DATA = {};
for (const l of LOCALES) {
  const p = join(I18N_DIR, `${l}.json`);
  if (exists(p)) DATA[l] = readJ(p);
}

// ---------------------------------------------------------------- emit the English source
function validateEnglish() {
  const problems = [];
  const enW = readJ(L('en.tools.json')).w || {};
  for (const k of W_KEYS) if (!(k in enW)) problems.push(`W_KEY "${k}" is not in en.tools.json w (run i18n-wrap --adopt first)`);
  for (const id of NEW_IDS) {
    const t = EN_T[id];
    if (!t) { problems.push(`missing EN_T for ${id}`); continue; }
    if (cps(t.title) > 50) problems.push(`EN ${id}.title is ${cps(t.title)}cp (>50)`);
    if (cps(t.desc) > 160) problems.push(`EN ${id}.desc is ${cps(t.desc)}cp (>160 soft)`);
    if (!Array.isArray(t.steps) || t.steps.length !== 4) problems.push(`EN ${id}.steps has ${t.steps?.length}, need 4`);
    if (!Array.isArray(t.faq) || t.faq.length !== 2) problems.push(`EN ${id}.faq has ${t.faq?.length}, need 2`);
  }
  return problems;
}

function emitSource() {
  const problems = validateEnglish();
  if (problems.length) { for (const p of problems) console.error(`  FAIL ${p}`); console.error(`\n${problems.length} English problem(s) — source not written.`); process.exit(1); }
  const src = {
    _note: 'Authoritative English source for the second tools batch (9 new tools + loan-calculator equal-principal enhancement). Translate every value into the target language; keep every key, every {0}/{1}/{2} placeholder and every % sign. Do not summarise — a fragment is a stub, not a translation. desc must be <=160 code points (hard fail >170); title <=50; home is NOT changed. Output scripts/tools-i18n/<locale>.json with exactly: search, kw{28}, w{195}, t{9 tools each title/h1/desc/intro/steps[4]/faq[2]{q,a}}. SPECIAL: (1) w.pickerDefaultNames is six sample names separated by \\n — replace them with six common names in the target language/script (keeping it byte-identical to English fails the IDENTICAL gate). (2) The city* keys (cityLosAngeles … citySaoPaulo) MUST be written in the target script for zh/ja/ko/ru/hi (e.g. 洛杉矶/纽约/伦敦); Latin-script locales may keep the English city name. (3) rmb-uppercase EN copy is intentionally English/pinyin only — the Chinese uppercase characters are produced by the code at runtime, not stored in the dictionary; translate the labels and prose, keep "daxie/jiao/fen" as romanised terms or the local equivalent. (4) contract-generator must keep the "not legal advice" disclaimer prominent in intro/faq. loan-calculator t prose is unchanged — only its 10 new loan* widget keys and the "mortgage calculator" kw phrase are new.',
    locales: LOCALES,
    newIds: NEW_IDS,
    en_search: EN_SEARCH,
    w_keys: W_KEYS,
    en_w: EN_W,
    kw_phrases: PHRASES,
    en_t: EN_T
  };
  mkdirSync(I18N_DIR, { recursive: true });
  writeFileSync(join(I18N_DIR, '_source.json'), JSON.stringify(src, null, 2) + '\n', 'utf8');
  console.log(`wrote scripts/tools-i18n/_source.json — ${W_KEYS.length} widget keys, ${PHRASES.length} keyword phrases, ${NEW_IDS.length} tools, ${LOCALES.length} target locales`);
  console.log(`English desc lengths: ${NEW_IDS.map(id => `${id}=${cps(EN_T[id].desc)}`).join(', ')}`);
}

// ---------------------------------------------------------------- validation + write
const PH = /\{\d+\}/g;
const tokens = s => (String(s).match(PH) || []).sort();
function validate() {
  const problems = validateEnglish();
  const enW = readJ(L('en.tools.json')).w || {};
  const locales = Object.keys(DATA);
  if (locales.length !== 12) problems.push(`expected 12 locale data blocks, have ${locales.length}: ${locales.join(',')}`);
  for (const l of locales) {
    const d = DATA[l];
    for (const id of NEW_IDS) {
      const t = d.t?.[id];
      if (!t) { problems.push(`${l}: missing t.${id}`); continue; }
      if (cps(t.desc) > 170) problems.push(`${l} ${id}.desc is ${cps(t.desc)}cp (>170 HARD)`);
      else if (cps(t.desc) > 160) problems.push(`NOTE ${l} ${id}.desc is ${cps(t.desc)}cp (>160 soft)`);
      if (cps(t.title) > 50) problems.push(`${l} ${id}.title is ${cps(t.title)}cp (>50, risks T2)`);
      if (!Array.isArray(t.steps) || t.steps.length !== 4) problems.push(`${l} ${id}.steps must be 4 strings`);
      if (!Array.isArray(t.faq) || t.faq.length !== 2) problems.push(`${l} ${id}.faq must be 2 {q,a}`);
      // placeholder parity against English for every prose leaf
      const pairs = [['title', t.title, EN_T[id].title], ['h1', t.h1, EN_T[id].h1], ['desc', t.desc, EN_T[id].desc], ['intro', t.intro, EN_T[id].intro]];
      (t.steps || []).forEach((s, i) => pairs.push([`steps.${i}`, s, EN_T[id].steps[i]]));
      (t.faq || []).forEach((f, i) => { pairs.push([`faq.${i}.q`, f.q, EN_T[id].faq[i].q]); pairs.push([`faq.${i}.a`, f.a, EN_T[id].faq[i].a]); });
      for (const [name, val, en] of pairs) {
        if (typeof val !== 'string' || !val.trim()) { problems.push(`${l} ${id}.${name} empty/non-string`); continue; }
        if (tokens(val).join() !== tokens(en).join()) problems.push(`${l} ${id}.${name} placeholders ${tokens(val)} != EN ${tokens(en)}`);
      }
    }
    // widget keys: exactly the 195, placeholders + % preserved
    const wk = Object.keys(d.w || {});
    for (const k of W_KEYS) {
      if (!(k in (d.w || {}))) { problems.push(`${l}: missing w.${k}`); continue; }
      if (typeof d.w[k] !== 'string' || !d.w[k].trim()) { problems.push(`${l} w.${k} empty/non-string`); continue; }
      if (tokens(d.w[k]).join() !== tokens(enW[k] || '').join()) problems.push(`${l} w.${k} placeholders differ from EN`);
      const enPct = ((enW[k] || '').match(/\{\d+\}\s*%/g) || []).length;
      if (enPct && (d.w[k].match(/%/g) || []).length < enPct) problems.push(`${l} w.${k} lost a % sign`);
    }
    for (const k of wk) if (!W_KEYS.includes(k)) problems.push(`${l}: extra w.${k} not in W_KEYS (would be stale)`);
    // keywords: exactly the 28 new phrases
    for (const p of PHRASES) if (!String(d.kw?.[p] || '').trim()) problems.push(`${l}: missing kw "${p}"`);
    for (const p of Object.keys(d.kw || {})) if (!PHRASES.includes(p)) problems.push(`${l}: extra kw "${p}" not in the new phrase set`);
    if (!String(d.search || '').trim()) problems.push(`${l}: missing search placeholder`);
  }
  return problems;
}

function main() {
  const problems = validate();
  const hard = problems.filter(p => !p.startsWith('NOTE'));
  for (const p of problems) console.log(`  ${p.startsWith('NOTE') ? 'note' : 'FAIL'} ${p}`);
  if (hard.length) { console.error(`\n${hard.length} validation problem(s) — nothing written. Fix the data and re-run.`); process.exit(1); }
  console.log(`\nvalidation clean (${problems.length} soft note(s)). ${DRY ? 'DRY RUN — writing nothing.' : 'Writing files…'}`);
  if (DRY) return;

  // English tool copy + widget keys (the w keys were adopted already; re-merge to keep them exact).
  const enTools = readJ(L('en.tools.json'));
  enTools.t = { ...enTools.t, ...EN_T };
  enTools.w = { ...enTools.w, ...EN_W };
  writeJ(L('en.tools.json'), enTools);
  // English chrome: only the search count moves; categories and home title are untouched.
  const enChrome = readJ(L('en.json'));
  enChrome.nav = { ...enChrome.nav, searchPlaceholder: EN_SEARCH };
  writeJ(L('en.json'), enChrome);
  // SEO source: the 28 new keyword phrases per locale (no en — toolLongTail returns en verbatim).
  const seo = readJ(join(ROOT, 'src', 'seo', 'keywords.json'));
  for (const l of Object.keys(DATA)) seo.kw[l] = { ...(seo.kw[l] || {}), ...DATA[l].kw };
  writeJ(join(ROOT, 'src', 'seo', 'keywords.json'), seo);
  // per-locale chrome (search only) + the two new shards, sorted after 50-w-media so they win the merge.
  for (const l of Object.keys(DATA)) {
    const d = DATA[l];
    const chrome = readJ(L(`${l}.json`));
    chrome.nav = { ...chrome.nav, searchPlaceholder: d.search };
    writeJ(L(`${l}.json`), chrome);
    const dir = L(l); mkdirSync(dir, { recursive: true });
    writeJ(join(dir, '60-t-tools-batch.json'), { t: Object.fromEntries(NEW_IDS.map(id => [id, d.t[id]])) });
    writeJ(join(dir, '61-w-tools-batch.json'), { w: Object.fromEntries(W_KEYS.map(k => [k, d.w[k]])) });
  }
  console.log(`  wrote en.tools.json (${NEW_IDS.length} t + ${W_KEYS.length} w), en.json (nav.search), keywords.json (${Object.keys(DATA).length}×${PHRASES.length} kw)`);
  console.log(`  wrote ${Object.keys(DATA).length} locales × (chrome nav.search + 60-t-tools-batch + 61-w-tools-batch)`);
}
if (EMIT_SOURCE) { emitSource(); } else { main(); }