// Pure SEO composers for the ClearLight Tools overhaul. Single source of truth shared by
// src/templates.mjs (build), scripts/check-tool-seo.mjs (gate) and the per-locale seed files.
// Nothing here reads the filesystem or the DOM, so every rule can be unit-tested in memory.
//
// Title formulas (brand kept verbatim, length counted in code points):
//   EN / Latin / Cyrillic / Devanagari tool:
//     rich = "<Free Online> <name> - <action> - <brand>"  (used when <= 60 cps)
//     fallback = "<Free> <name> - <brand>"                (when rich would exceed 60)
//   CJK tool (zh/ja/ko), brand alone is 16 cps so the action segment is dropped:
//     rich = "<Free> <name> - <brand>"  (<= 30 cps)  else  "<name> - <brand>"
//   category / legal / all:  "<name> - <brand>"
// Description formula:
//   EN / Latin / Cyrillic / Devanagari:  "<verb><conn><name><tail>"  (verb-opening, owner's copy)
//   CJK (zh/ja/ko):  "<Free Online><name><conn><verb><tail>"  (keyword-first reads naturally in
//     CJK and front-loads the term; conn is a colon, tail carries the selling points). Whole 70-85.
// H1:  "<Free Online> <name>"  (CJK joins without a space).

export const CJK = new Set(['zh', 'ja', 'ko']);
export const cps = s => [...String(s ?? '').trim()].length;

export const TITLE_MAX = { cjk: 30, other: 60 };
export const EN_TOOL_DESC = { min: 135, max: 158 };
export const CJK_TOOL_DESC = { min: 70, max: 85 };
export const OTHER_DESC_MAX = 160;

export function toolTitle(name, locale, entry, fx, brand) {
  if (CJK.has(locale)) {
    // A few localized names are so long that name + 16-cp brand cannot fit 30 even without the free
    // prefix; entry.titleName is a concise keyword form (e.g. "Base64 変換") used for the title only.
    const kn = entry.titleName || name;
    const rich = `${fx.free}${kn}｜${brand}`;
    return cps(rich) <= TITLE_MAX.cjk ? rich : `${kn}｜${brand}`;
  }
  const rich = `${fx.freeOnline} ${name} - ${entry.action} - ${brand}`;
  if (cps(rich) <= TITLE_MAX.other) return rich;
  const mid = `${fx.free} ${name} - ${brand}`;
  // last resort: drop the free modifier too, keep keyword + brand whole (never truncate the brand)
  return cps(mid) <= TITLE_MAX.other ? mid : `${name} - ${brand}`;
}

export function toolDesc(name, entry, fx, locale) {
  if (CJK.has(locale)) return `${fx.freeOnline}${name}${fx.conn}${entry.verb}${fx.tail}`;
  return `${entry.verb}${fx.conn}${name}${fx.tail}`;
}

export function toolH1(name, locale, fx) {
  return CJK.has(locale) ? `${fx.freeOnline}${name}` : `${fx.freeOnline} ${name}`;
}

// category / legal / all pages: plain "[name] - [brand]"
export function plainTitle(name, brand) {
  return `${name} - ${brand}`;
}

// Category / all-page description: the localized free-online keyword anchor + the category name +
// the purpose tagline, with NO long selling-point tail. The home and tool descriptions already carry
// the full "100% browser / no login / no uploads" copy; repeating that 55-72 cps tail here pushed
// category and "all" snippets to 170-229 cps, past Google's ~160-character truncation line. Leading
// with "<Free Online> <name>" front-loads the localized keyword (the title carries it too) and the
// tagline summarises the purpose, so the snippet stays ~90-150 cps and unique per page (both the name
// and the tagline differ). The tagline's trailing period is normalised so the sentence never doubles it.
export function catDesc(name, tagline, fx, locale) {
  const t = String(tagline || '').trim().replace(/[.。]+$/, '');
  if (CJK.has(locale)) return `${fx.freeOnline}${name}：${t}`;
  return `${fx.freeOnline} ${name}: ${t}`;
}

// length verdict for a tool title/description in a given locale. Returns {titleOk, descOk, notes[]}
export function lengthVerdict(locale, title, desc) {
  const tl = cps(title), dl = cps(desc);
  const notes = [];
  let titleOk = true, descOk = true;
  if (CJK.has(locale)) {
    if (tl > TITLE_MAX.cjk) { titleOk = false; notes.push(`title ${tl}>${TITLE_MAX.cjk}`); }
    else if (tl < 20) notes.push(`title ${tl}<20 (short)`);
    if (dl < CJK_TOOL_DESC.min || dl > CJK_TOOL_DESC.max) { descOk = false; notes.push(`desc ${dl} outside ${CJK_TOOL_DESC.min}-${CJK_TOOL_DESC.max}`); }
  } else if (locale === 'en') {
    if (tl > TITLE_MAX.other) { titleOk = false; notes.push(`title ${tl}>${TITLE_MAX.other}`); }
    else if (tl < 50) notes.push(`title ${tl}<50 (long-name fallback)`);
    if (dl < EN_TOOL_DESC.min || dl > EN_TOOL_DESC.max) { descOk = false; notes.push(`desc ${dl} outside ${EN_TOOL_DESC.min}-${EN_TOOL_DESC.max}`); }
  } else {
    if (tl > TITLE_MAX.other) { titleOk = false; notes.push(`title ${tl}>${TITLE_MAX.other}`); }
    if (dl > OTHER_DESC_MAX) { descOk = false; notes.push(`desc ${dl}>${OTHER_DESC_MAX}`); }
    else if (dl < 120) notes.push(`desc ${dl}<120 (short)`);
  }
  return { titleOk, descOk, tl, dl, notes };
}