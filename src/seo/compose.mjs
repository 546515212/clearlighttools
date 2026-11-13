// Pure SEO composers for the ClearLight Tools overhaul. Single source of truth shared by
// src/templates.mjs (build), scripts/check-tool-seo.mjs (gate) and the per-locale seed files.
// Nothing here reads the filesystem or the DOM, so every rule can be unit-tested in memory.
//
// Title formulas (brand kept verbatim, length counted in code points). The brand separator is a
// pipe " | " (full-width "｜" for CJK) on every page type, per the owner's long-tail title spec.
//   EN / Latin / Cyrillic / Devanagari tool:
//     rich = "<Free Online> <name> - <action> | <brand>"  (used when <= 65 cps)
//     mid  = "<Free> <name> | <brand>"                    (when rich would exceed 65)
//     last = "<name> | <brand>"                           (when mid would still exceed 65)
//   CJK tool (zh/ja/ko), brand alone is 16 cps so the action segment is dropped:
//     rich = "<Free> <name>｜<brand>"  (<= 30 cps)  else  "<name>｜<brand>"
//   category / all (long-tail, owner spec — modifiers + secondary intent, NOT a bare "Image tools"):
//     rich = "<Free Online> <seoName> | <brand>"  (<= 65)  else "<Free> <seoName> | <brand>"
//            else "<seoName> | <brand>";  CJK: "<Free><seoName>｜<brand>" (<= 30) else "<seoName>｜<brand>"
//     seoName is the per-locale long-tail category name from the seed's cats block, e.g.
//     "Image Tools & Converters" / "PDF Utilities & Editors". <name> may be a concise noun-form
//     keyword (entry.titleName) that differs from the on-page display name, in ANY locale.
//   legal / 404:  "<name> | <brand>"
// The 65-cp non-CJK title ceiling (was 60) accommodates the owner's richer long-tail example
// "Free Online Image Compressor - Reduce Size | ClearLight Tools" (61 cps) while staying near the
// SERP truncation line; the composer still falls back so a title never exceeds it.
// Description formula:
//   EN / Latin / Cyrillic / Devanagari:  "<verb><conn><name><tail>"  (verb-opening, owner's copy)
//   CJK (zh/ja/ko):  "<Free Online><name><conn><verb><tail>"  (keyword-first reads naturally in
//     CJK and front-loads the term; conn is a colon, tail carries the selling points). Whole 70-85.
// H1:  "<Free Online> <name>"  (CJK joins without a space). Category/all H1 reuses toolH1(seoName).

export const CJK = new Set(['zh', 'ja', 'ko']);
export const cps = s => [...String(s ?? '').trim()].length;

export const TITLE_MAX = { cjk: 30, other: 65 };
export const EN_TOOL_DESC = { min: 135, max: 158 };
export const CJK_TOOL_DESC = { min: 70, max: 85 };
export const OTHER_DESC_MAX = 160;

export function toolTitle(name, locale, entry, fx, brand) {
  // entry.titleName is an optional concise noun-form keyword (e.g. "Image Compressor" for the
  // "Compress Image" tool) used for the <title> ONLY, in any locale; the H1/nav keep the display name.
  const kn = entry.titleName || name;
  if (CJK.has(locale)) {
    // A few localized names are so long that name + 16-cp brand cannot fit 30 even without the free
    // prefix; the titleName override (e.g. "Base64 変換") shortens them.
    const rich = `${fx.free}${kn}｜${brand}`;
    return cps(rich) <= TITLE_MAX.cjk ? rich : `${kn}｜${brand}`;
  }
  const rich = `${fx.freeOnline} ${kn} - ${entry.action} | ${brand}`;
  if (cps(rich) <= TITLE_MAX.other) return rich;
  const mid = `${fx.free} ${kn} | ${brand}`;
  // last resort: drop the free modifier too, keep keyword + brand whole (never truncate the brand)
  return cps(mid) <= TITLE_MAX.other ? mid : `${kn} | ${brand}`;
}

export function toolDesc(name, entry, fx, locale) {
  if (CJK.has(locale)) return `${fx.freeOnline}${name}${fx.conn}${entry.verb}${fx.tail}`;
  return `${entry.verb}${fx.conn}${name}${fx.tail}`;
}

export function toolH1(name, locale, fx) {
  return CJK.has(locale) ? `${fx.freeOnline}${name}` : `${fx.freeOnline} ${name}`;
}

// Category / all-page <title>: the owner's long-tail form "<Free Online> <seoName> | <brand>", where
// seoName carries a modifier + secondary intent ("Image Tools & Converters", "PDF Utilities &
// Editors") instead of a bare broad label. Same 3-tier length fallback as toolTitle so the brand is
// never truncated; CJK uses "<Free><seoName>｜<brand>" (<= 30) else "<seoName>｜<brand>". seoName comes
// from the per-locale seed's cats block (localized, natural — not a stiff literal translation).
export function catTitle(seoName, locale, fx, brand) {
  const name = String(seoName ?? '').trim();
  if (CJK.has(locale)) {
    const rich = `${fx.free}${name}｜${brand}`;
    return cps(rich) <= TITLE_MAX.cjk ? rich : `${name}｜${brand}`;
  }
  const rich = `${fx.freeOnline} ${name} | ${brand}`;
  if (cps(rich) <= TITLE_MAX.other) return rich;
  const mid = `${fx.free} ${name} | ${brand}`;
  return cps(mid) <= TITLE_MAX.other ? mid : `${name} | ${brand}`;
}

// legal / 404 pages: plain "[name] | [brand]" (same pipe separator as the rest of the site)
export function plainTitle(name, brand) {
  return `${name} | ${brand}`;
}

// Category / all-page description: the localized free-online keyword anchor + the long-tail category
// seoName + the purpose tagline, with NO long selling-point tail. The home and tool descriptions
// already carry the full "100% browser / no login / no uploads" copy; repeating that 55-72 cps tail
// here pushed category and "all" snippets to 170-229 cps, past Google's ~160-character truncation
// line. Leading with "<Free Online> <seoName>" front-loads the localized long-tail keyword (the title
// carries it too) and the tagline summarises the purpose, so the snippet stays ~90-150 cps and unique
// per page (both the seoName and the tagline differ). The tagline's trailing period is normalised so
// the sentence never doubles it.
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