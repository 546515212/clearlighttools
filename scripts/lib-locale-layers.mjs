// One place that knows how a locale's translated text is assembled.
//
// build.mjs, scripts/i18n-report.mjs and scripts/check-translations.mjs all need the same answer to
// "which files make locale X, in what order, and what shape is each one allowed to be". When that
// knowledge was written down twice, the coverage report and the generator disagreed about zh for a
// whole segment; it is now imported from here instead.
//
// A locale is built up from four kinds of layer, applied in this order (later wins a tie):
//
//   src/locales/<l>.json          chrome: nav, footer, legal, ads, search, and its own `w` block
//   src/locales/<l>.tools.json    the bulk layer for the two locales that have one (zh, hi)
//   src/locales/<l>/*.json        shards — the incremental translation layer, applied last
//
// Shards exist because translating 1450 strings per locale is a job split across many sittings and
// many files: 11 translators editing one 80 KB dictionary is a merge conflict, while a shard per
// category is a reviewable unit that can be added or reverted on its own.
//
// Every layer is classified into the same three buckets before merging:
//
//   w  widget labels  (input/quality/download/… — the strings the tool panels render)
//   t  tool copy      (one object per tool id: title, h1, desc, intro, steps, faq, …)
//   c  chrome         (everything else, merged at the top level of the dictionary)
//
// A shard may also be a bare map of tool ids (`{ "compress-pdf": { … } }`) because that is what a
// translator pastes from an existing dictionary; anything else is rejected loudly rather than
// silently contributing nothing.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './lib-node.mjs';

export const LOCALES_DIR = join(ROOT, 'src', 'locales');
export const localeFile = (...a) => join(LOCALES_DIR, ...a);
export const relLocale = p => relative(ROOT, p).replace(/\\/g, '/');

export const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Copy, never alias. `{ ...base }` and `out[k] = v` both keep the *nested* objects shared, and
// build.mjs's locale loop writes into merged.t[id] — so each locale's titles.json override landed in
// the English table that the next locale starts from. Nine of thirteen locales shipped the
// Indonesian headline "Kompres PDF" as their h1 and <title> this way. A dictionary merge that
// returns references is a bug even when the current caller is careful, because the next caller will
// not be.
export const deepCopy = v => Array.isArray(v) ? v.map(deepCopy)
  : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepCopy(x)]))
    : v;

// null / '' in `over` are skipped: a key a translator left empty must not erase the English sitting
// underneath it, or an unfinished shard silently deletes working copy from the built page.
export function deepMerge(base = {}, over = {}) {
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = deepCopy(v);
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else if (v !== undefined && v !== null && v !== '') out[k] = deepCopy(v);
  }
  return out;
}

// ---------------------------------------------------------------- reading
export async function readJson(path) {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new Error(`${relLocale(path)}: not valid JSON — ${err.message}`);
  }
}

export async function readJsonOr(path, fallback) {
  return existsSync(path) ? readJson(path) : fallback;
}

// Accepts { w, t } or a flat { toolId: {...} } map.
export function normaliseToolsDict(raw) {
  if (!raw) return { w: null, t: null };
  if (raw.w || raw.t) return { w: raw.w || null, t: raw.t || null };
  return { w: null, t: raw };
}

// ---------------------------------------------------------------- classification
// Layer keys a shard is allowed to use. Anything else at the top level of a shard is either a typo
// ("tools" instead of "t") or a nesting mistake, and both look identical to a successful load unless
// something checks.
const LAYER_KEYS = ['w', 't', 'c'];

/**
 * Turn any locale layer into `{ w, t, c }`.
 *
 * @param raw     parsed JSON of the layer
 * @param opts    { toolIds: Set|Array, allowBareToolMap: boolean }
 * @returns {{ w?:object, t?:object, c?:object, asBareToolMap:boolean }}
 * @throws when a shard uses a layer name that does not exist
 */
export function classifyLayer(raw, { toolIds = null, allowBareToolMap = true, name = '' } = {}) {
  if (!isObj(raw)) throw new Error(`${name || 'locale layer'} must be a JSON object`);
  const keys = Object.keys(raw);
  const unknown = keys.filter(k => !LAYER_KEYS.includes(k));
  if (unknown.length && allowBareToolMap && toolIds && unknown.every(k => toolIds.has(k))) {
    // a bare map of tool ids: exactly the shape <l>.tools.json has always used
    return { t: raw, asBareToolMap: true };
  }
  if (unknown.length) {
    const guess = unknown.slice(0, 4).map(k => `"${k}"`).join(', ');
    throw new Error(`${name}: key(s) outside the layers a layer may define — ${guess}. `
      + `Use "w" (widget labels), "t" (tool copy) or "c" (chrome); a bare map of tool ids is also accepted.`);
  }
  return { w: raw.w, t: raw.t, c: raw.c };
}

// ---------------------------------------------------------------- the tool id list
// `classifyLayer` only accepts a bare `{ "compress-pdf": … }` map when it can prove every key is a real
// tool, so every locale reader has to bring the same id list. Six readers load the data file themselves;
// a seventh (the rendered-English audit) called localeSources() with no toolIds at all, and
// hi.tools.json — a bare tool map since the day it was written — came back as
// "key(s) outside the layers a layer may define". A reader whose *optional* argument silently changes
// which valid files it can read is a trap, so the list is resolved here instead of by each caller.
let toolIdsCache = null;

/** Real tool ids from src/data/tools.json, loaded once. */
export async function toolIds() {
  if (!toolIdsCache) {
    const tools = await readJson(join(ROOT, 'src', 'data', 'tools.json'));
    toolIdsCache = new Set(tools.map(t => t.id));
    if (toolIdsCache.size < 40) {
      throw new Error(`src/data/tools.json lists ${toolIdsCache.size} tools — a locale layer that is a bare `
        + 'map of tool ids cannot be classified against a list this short');
    }
  }
  return toolIdsCache;
}

// ---------------------------------------------------------------- the layer list
/**
 * All non-English sources for one locale, in merge order, each classified.
 * A file that is unreadable or malformed is returned in `errors` instead of throwing, so the
 * checker can report every problem in the tree in one pass; build.mjs re-throws them.
 */
export async function localeSources(l, { toolIds: ids = null, dir = LOCALES_DIR } = {}) {
  const toolIdSet = ids ?? await toolIds();
  const sources = [];
  const errors = [];
  const at = (...a) => join(dir, ...a);
  const push = async (path, kind) => {
    if (!existsSync(path)) return;
    let raw;
    try { raw = await readJson(path); } catch (err) { errors.push(err.message); return; }
    try {
      const layer = kind === 'chrome'
        ? { c: raw, asChrome: true }
        : classifyLayer(raw, { toolIds: toolIdSet, allowBareToolMap: true, name: relLocale(path) });
      sources.push({ path, file: relLocale(path), kind, raw, ...layer });
    } catch (err) {
      errors.push(err.message);
    }
  };
  await push(at(`${l}.json`), 'chrome');
  await push(at(`${l}.tools.json`), 'bulk');
  const shardDir = at(l);
  if (existsSync(shardDir) && statSync(shardDir).isDirectory()) {
    let names = [];
    try { names = (await readdir(shardDir)).filter(f => f.endsWith('.json')).sort(); }
    catch (err) { errors.push(`${relLocale(shardDir)}: ${err.message}`); }
    for (const n of names) await push(join(shardDir, n), 'shard');
  }
  return { sources, errors };
}

/**
 * Apply one classified source to a dictionary, in the order the layers are documented: chrome at the
 * top level, then `w`, then `t`. Merging into a single object per source — rather than accumulating
 * the three buckets separately — is what keeps the ordering *between* files honest: <l>.json carries
 * its own `w` block, and a shard's `w` has to beat it, not be flattened under it.
 */
export function applySource(target, src) {
  let out = target;
  if (src.c) out = deepMerge(out, src.c);
  if (src.w) out = deepMerge(out, { w: src.w });
  if (src.t) out = deepMerge(out, { t: src.t });
  return out;
}

/**
 * The locale's OWN contribution, English-free — what a coverage count credits the translator with.
 * Chrome keys stay at the top level, tool copy lands under `t`, widget labels under `w`.
 */
export const ownLayer = sources => sources.reduce(applySource, {});

/** Flatten to dotted leaf paths, exactly the space the report and the checker compare keys in. */
export function leaves(obj, prefix = '', acc = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) leaves(v, key, acc);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (isObj(item)) leaves(item, `${key}.${i}`, acc); else acc[`${key}.${i}`] = item;
    });
    else acc[key] = v;
  }
  return acc;
}
