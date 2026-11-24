// Pure SEO composers for the ClearLight Tools overhaul. Single source of truth shared by
// src/templates.mjs (build), scripts/check-tool-seo.mjs (gate) and the per-locale seed files.
// Nothing here reads the filesystem or the DOM, so every rule can be unit-tested in memory.
//
// Title formulas (brand kept verbatim, length counted in code points). The brand separator is a
// pipe " | " (full-width "｜" for CJK) on every page type, per the owner's long-tail title spec.
//   Tool <title> — owner's uniform spec, e.g. "免费在线Word压缩工具｜ClearLight Tools": a free-online
//   modifier + the keyword + a tool noun + the brand. The old "- <action>" long-tail segment is dropped
//   in EVERY locale (the action field is retained in the seed but no longer composed into the title).
//   EN / Latin / Cyrillic / Devanagari tool (kn = titleName || name):
//     rich = "<Free Online> <kn> | <brand>"  (used when <= 65 cps)
//     mid  = "<Free> <kn> | <brand>"         (when rich would exceed 65)
//     last = "<kn> | <brand>"                (when mid would still exceed 65)
//   CJK tool (zh/ja/ko): rich = "<Free Online><kn><toolWord>｜<brand>" (免费在线…工具). toolWord comes
//     from seed.fixed (工具 / ツール / 도구) and is suppressed when kn already ends in a tool noun, so
//     "图片压缩器" never becomes "图片压缩器工具". zh/ja tighten the stylistic Latin↔CJK space (Word压缩,
//     PDF合并); ko keeps natural Hangul spacing. Brand alone is 16 cps and the ceiling is 30, so long
//     names shed tiers — drop toolWord, then 在线, then 免费, then both — never truncating the brand.
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

// CJK tool-noun morphemes (器/机/機 = zh/ja "device", 기 = ko "machine"). When the keyword already ends
// in one — or in the toolWord itself — appending 工具/ツール/도구 would read redundantly, so it is skipped.
const TOOL_NOUN_END = /[器机機기]$/;
// Tighten the stylistic space between a Latin/digit token and an adjacent CJK token (zh/ja only): the
// owner's spec writes "Word压缩" / "PDF合并", not "Word 压缩". Latin↔Latin spaces (Lorem Ipsum) are kept.
const CJK_JOIN = '\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af';
const tightenCjk = s => String(s)
  .replace(new RegExp(`([A-Za-z0-9])\\s+([${CJK_JOIN}])`, 'g'), '$1$2')
  .replace(new RegExp(`([${CJK_JOIN}])\\s+([A-Za-z0-9])`, 'g'), '$1$2');

export function toolTitle(name, locale, entry, fx, brand) {
  // entry.titleName is an optional concise noun-form keyword (e.g. "Image Compressor" for the
  // "Compress Image" tool) used for the <title> ONLY, in any locale; the H1/nav keep the display name.
  const kn0 = entry.titleName || name;
  if (CJK.has(locale)) {
    const kn = locale === 'ko' ? kn0 : tightenCjk(kn0);   // ko keeps natural Hangul spacing
    const tw = fx.toolWord || '';
    const full = tw && !kn.endsWith(tw) && !TOOL_NOUN_END.test(kn) ? kn + tw : kn;
    // Owner pattern "<Free Online><kn><tool>｜<brand>". Ceiling 30 with a 16-cp brand, so long names
    // shed the tool suffix, then 在线, then 免费, then both — the brand is never truncated.
    const tiers = [
      `${fx.freeOnline}${full}｜${brand}`,
      `${fx.freeOnline}${kn}｜${brand}`,
      `${fx.free}${full}｜${brand}`,
      `${fx.free}${kn}｜${brand}`,
      `${full}｜${brand}`,
      `${kn}｜${brand}`,
    ];
    for (const t of tiers) if (cps(t) <= TITLE_MAX.cjk) return t;
    return tiers[tiers.length - 1];
  }
  // Non-CJK mirrors the same shape minus the CJK tool noun: "<Free Online> <kn> | <brand>". The old
  // "- <action>" long-tail segment is dropped per the owner's uniform title spec.
  const kn = kn0;
  const tiers = [
    `${fx.freeOnline} ${kn} | ${brand}`,
    `${fx.free} ${kn} | ${brand}`,
    `${kn} | ${brand}`,
  ];
  for (const t of tiers) if (cps(t) <= TITLE_MAX.other) return t;
  return tiers[tiers.length - 1];   // last resort: keep keyword + brand whole (never truncate the brand)
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
    else if (tl < 40) notes.push(`title ${tl}<40 (short)`);   // uniform spec drops the action: 40-58 is normal
    if (dl < EN_TOOL_DESC.min || dl > EN_TOOL_DESC.max) { descOk = false; notes.push(`desc ${dl} outside ${EN_TOOL_DESC.min}-${EN_TOOL_DESC.max}`); }
  } else {
    if (tl > TITLE_MAX.other) { titleOk = false; notes.push(`title ${tl}>${TITLE_MAX.other}`); }
    if (dl > OTHER_DESC_MAX) { descOk = false; notes.push(`desc ${dl}>${OTHER_DESC_MAX}`); }
    else if (dl < 120) notes.push(`desc ${dl}<120 (short)`);
  }
  return { titleOk, descOk, tl, dl, notes };
}