// One-off codemod: wrap every user-facing string literal in the tool code in the dictionary layer,
// so that machine translation has something to translate.
//
// Before this, 100+ messages were plain English literals inside src/scripts/tools/*.js. They never
// appeared in a dictionary file, so no locale could reach them: the page chrome translated, the
// message under the result stayed English, and the coverage report could not even count them.
//
//   node scripts/i18n-wrap.mjs            dry run: print every planned edit + MANUAL list
//   node scripts/i18n-wrap.mjs --apply    rewrite the files and append the keys to en.tools.json
//   node scripts/i18n-wrap.mjs --check    fail if a rendered string still bypasses the dictionary
//   node scripts/i18n-wrap.mjs --adopt    register hand-written keys that the dictionary is missing
//   node scripts/i18n-wrap.mjs --selftest run the rewrite cases against a fixture, touch nothing
//
// --apply and --check are the same code path: plan() is pure, so what the dry run promises is exactly
// what the check measures. Anything the rewrite would have to do by hand is printed as MANUAL, and a
// MANUAL site stays a failure until it is either fixed or listed in ADJUDICATED with its reason.
//
// Only strings in a *rendered* position are touched: note(), toast(), new Error() (run() shows the
// message), area()/button()/checkInput() labels, field()'s hint, stat()'s extra, and the `text:` /
// `placeholder:` / `title:` attributes. Anything already inside L()/t() is left alone, and anything
// that is not prose (mime types, CSS, code samples, selectors) is skipped by rule.
//
// Interpolated template literals become fmt(L('key', 'text {0} more'), expr) — the expressions are
// copied verbatim, so the rendered English cannot change. A literal whose interpolation is nested
// (a template inside ${}) is reported as MANUAL instead of being rewritten.

import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT } from './lib-node.mjs';
import { stillLiteral } from './lib-i18n.mjs';

const apply = process.argv.includes('--apply');
const FILES = ['pdf', 'image', 'text', 'calc', 'audio', 'video', 'media-core'].map(b => join(ROOT, 'src', 'scripts', 'tools', `${b}.js`));
const EN_TOOLS = join(ROOT, 'src', 'locales', 'en.tools.json');
const BACKUP = join(ROOT, 'test-files', 'backup-i18n-wrap');

// Rendered slots that a human has read in context and decided keep their English, with the reason.
// A template the codemod cannot split is not automatically correct to leave alone: most of them are
// sentences that merely look technical, and a translated page shows them as English forever. So
// --check fails on any refusal that is not listed here, and also on a listed entry that no longer
// matches anything, which stops the list from rotting into a place to hide findings.
// `has` is a fragment of the source at the site, chosen so it cannot match a different call.
const ADJUDICATED = [];

// ---------------------------------------------------------------- lexer helpers
// Comments blanked out at the same length, so every offset still maps to the original source.
function blankComments(src) {
  const out = src.split('');
  for (let i = 0; i < out.length - 1; i++) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (let j = i; j < stop; j++) if (out[j] !== '\n') out[j] = ' ';
      i = stop;
    } else if (src[i] === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < out.length && out[j] !== '\n') { if (out[j] !== '\n') out[j] = ' '; j++; }
      i = j;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      i = skipString(src, i); // a // inside a string is not a comment
    }
  }
  return out.join('');
}
// Returns the index of the closing quote (or of the last char if unterminated).
function skipString(src, start) {
  const q = src[start];
  for (let j = start + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === q) return j;
    if (c === '\n' && q !== '`') return j - 1; // an unterminated 'string' cannot span lines
    if (q === '`' && c === '$' && src[j + 1] === '{') j = matchBrace(src, j + 1);
  }
  return src.length - 1;
}
function matchBrace(src, start) {
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) return j; }
  }
  return src.length - 1;
}
// The [innerStart, innerEnd) of a call's or property's first argument, or null.
function argRange(clean, openParen) {
  let depth = 0, i = openParen;
  for (; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(clean, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth < 1) break; }
    else if (c === ',' && depth === 1) break;
  }
  const text = clean.slice(openParen + 1, i);
  const lead = text.length - text.trimStart().length;
  return { start: openParen + 1 + lead, end: openParen + 1 + lead + text.trim().length };
}
function valueRange(clean, colonIndex) {  let j = colonIndex + 1;
  while (j < clean.length && /\s/.test(clean[j])) j++;
  if (!(clean[j] === '"' || clean[j] === "'" || clean[j] === '`')) return null;
  return { start: j, end: skipString(clean, j) + 1 };
}

// Every top-level argument of a call, as {start, end} ranges.
function argSpans(clean, openParen) {
  const out = [];
  let depth = 0, i = openParen, from = openParen + 1;
  for (; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(clean, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth < 1) break; }
    else if (c === ',' && depth === 1) { out.push(trimRange(clean, from, i)); from = i + 1; }
  }
  out.push(trimRange(clean, from, i));
  return out;
}
function trimRange(s, a, b) {
  while (a < b && /\s/.test(s[a])) a++;
  while (b > a && /\s/.test(s[b - 1])) b--;
  return { start: a, end: b };
}

// ---------------------------------------------------------------- literal reading
// A literal is worth translating when it reads like a sentence rather than like code. The test runs
// on the *pattern* of a template (`Showing 8 of {0} rows.`), so the placeholders must not hide the
// words around them — counting real letter tokens is what makes that work.
const NOT_PROSE = /[<>]|\/\/|\{\{|^\s*$|\\u|regex|[;{}]\s*$|^[.#/]/;
const MIMEISH = /^[a-z0-9.+_-]+\/[a-z0-9.+_-]+$/i;
const SCHEMAISH = /^[a-z][a-z0-9]*:\S/i; // data:image/png;base64…, http://…, mailto:…
function isProse(text) {
  const s = String(text).trim();
  if (s.length < 10 || s.length > 320) return false;
  if (!/\s/.test(s)) return false;
  if (NOT_PROSE.test(s) || MIMEISH.test(s) || SCHEMAISH.test(s)) return false;
  const words = (s.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]{1,}/g) || []).filter(w => w.length >= 2);
  return words.length >= 2;
}
// A short label is the other half of what a visitor reads: "Mono", "Keys", "{0} pages", "seconds".
// The sentence rule cannot see them, and one-word English is exactly what stays English after a
// translation pass, so they are matched by vocabulary instead: at least one word that is a normal
// English word rather than a unit, a codec, or a format token that reads the same everywhere.
// WRAP_TECHNICAL lets a reviewer add to that vocabulary without editing the file.
const TECHNICAL = new Set(('px ms pt s sec min wpm rpm fps bpp dpi ppi hz khz mhz kbps mbps kb mb gb tb cm mm km m kg g lb oz ft yd mi mph kph ml l cal kcal kj wh ah ' +
  'jpg jpeg png webp gif bmp svg ico tiff heic avif mp3 wav ogg m4a aac flac mp4 webm mov avi mkv pdf zip txt csv json ' +
  'html css js ts xml yaml utf8 utf-8 iso ascii unicode rgb hsl hsv lab cmyk rgba hsla md5 sha sha1 sha256 sha512 sha3 ' +
  'base64 hex url uri qr ssid wpa wpa2 wep nopass aes gcm cbc pkcs1 pkcs8 rsa ec ed25519 jwt unix epoch utc gmt ist cet ' +
  'l m q h a b c d e f g p v1 v2 v3 v4 v7 v8 em ok id oh doi eeg')
  .split(/\s+/)
  .concat((process.env.WRAP_TECHNICAL || '').split(/\s+/).filter(Boolean))
  .map(w => w.toLowerCase()));
function isLabel(text) {
  const s = String(text).trim();
  if (s.length < 2 || s.length > 320) return false;
  if (NOT_PROSE.test(s) || MIMEISH.test(s) || SCHEMAISH.test(s)) return false;
  // A codec/format token that mixes letters and digits (MP3, M4A, VP9, UTF8) is one technical word,
  // but the letter-run regex below would strip the digit and judge the bare prefix ("MP"), which is
  // not in TECHNICAL — so MP3 was flagged while WAV/JPG passed. Recognise the whole token first.
  const whole = s.toLowerCase().replace(/[\s./_-]+/g, '');
  if (TECHNICAL.has(whole)) return false;
  const words = (s.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]{1,}/g) || []).filter(w => w.length >= 2 && !/^\d+$/.test(w));
  if (!words.length) return false;
  return words.some(w => !TECHNICAL.has(w.toLowerCase()));
}
const isRendered = s => isProse(s) || isLabel(s);
// Split a template literal into static parts (raw source) and expression ranges.
// `end` is the index AFTER the closing backtick, which itself is not part of the text.
function parseTemplate(src, start, afterEnd) {
  const close = afterEnd - 1;
  const parts = [], exprs = [];
  let i = start + 1, buf = start + 1;
  while (i < close) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '$' && src[i + 1] === '{') {
      const br = matchBrace(src, i + 1);
      parts.push([buf, i]);
      // matchBrace returns the index of the closing }, which is NOT part of the expression
      exprs.push([i + 2, br]);
      i = buf = br + 1;
      continue;
    }
    i++;
  }
  parts.push([buf, close]);
  return { parts, exprs };
}
// Every string/template literal inside a source span, as [start, endAfterQuote].
function literalsIn(src, clean, from, to) {
  const out = [];
  for (let i = from; i < to; i++) {
    const c = clean[i];
    if (c === '"' || c === "'" || c === '`') { const e = skipString(clean, i); out.push([i, e + 1]); i = e; continue; }
    if (c === '/' && clean[i + 1] === '/') i = clean.indexOf('\n', i);
  }
  return out;
}
// A dictionary call folded away, so what is left of a slice is only data or untranslated prose.
// Anything still holding a quote is refused: an English phrase parked inside ${} would survive
// every translation pass unnoticed, and that is worse than leaving the site to a human.
// (DICT_CALL / foldNonText / stillLiteral come from lib-i18n.mjs, shared with check-note-literals.mjs
//  so the codemod and the check can never disagree about what counts as translated.)
// Unescape a source slice into the string it actually is. Our own source, so evaluating it is safe.
const cook = raw => { try { return Function(`return ${raw}`)(); } catch { return null; } };const cookStatic = raw => { try { return Function('return `' + raw + '`')(); } catch { return null; } };
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');

// ---------------------------------------------------------------- key naming
function makeKeyFor(table) {
  const byValue = new Map();
  for (const [k, v] of Object.entries(table)) byValue.set(String(v), k);
  const taken = new Set(Object.keys(table));
  return function keyFor(text) {
    if (byValue.has(text)) return byValue.get(text);           // same English → same key
    const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 5);
    let base = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('').slice(0, 40) || 'uiText';
    if (!/^[a-z]/.test(base)) base = 'ui' + base[0].toUpperCase() + base.slice(1);
    let key = base, n = 2;
    while (taken.has(key)) key = base + n++;
    taken.add(key);
    byValue.set(text, key);
    return key;
  };
}

// ---------------------------------------------------------------- collect edits
// plan() is pure: it only reads `src` and records what a rewrite would look like, so the same code
// answers the dry run, the --check mode and the selftest.
function plan(name, src, keyFor, seenRanges) {
  const edits = [], manual = [], newKeys = {};
  const clean = blankComments(src);
  const callSpan = (clean, open) => argRange(clean, open);

  const spans = [];
  for (const fn of ['note', 'toast', 'area', 'button', 'checkInput', 'Error']) {
    for (const m of clean.matchAll(new RegExp(`\\b${fn}\\s*\\(`, 'g'))) {
      const r = callSpan(clean, m.index + m[0].length - 1);
      spans.push({ a: r.start, b: r.end, how: `${fn}() arg 1` });
    }
  }
  // field/stat: the control's own label can be a conditional ('Fat-loss target' : 'Daily target'),
  // and the help line under it is arg 3. Both are prose.
  for (const fn of ['field', 'stat']) {
    for (const m of clean.matchAll(new RegExp(`\\b${fn}\\s*\\(`, 'g'))) {
      const args = argSpans(clean, m.index + m[0].length - 1);
      if (args[0]) spans.push({ a: args[0].start, b: args[0].end, how: `${fn}() arg 1` });
      if (args[2]) spans.push({ a: args[2].start, b: args[2].end, how: `${fn}() arg 3` });
    }
  }
  // the options array carries every <option> label a user reads — and only the label. The first slot
  // of each pair is the value the tool compares against (`mode === 'wifi'`), and wrapping that would
  // make the comparison read a translated word and silently break the tool in every locale but English.
  for (const m of clean.matchAll(/\bselect\s*\(/g)) {
    const args = argSpans(clean, m.index + m[0].length - 1);
    if (!args[0] || clean[args[0].start] !== '[') continue; // an expression, not a literal option list
    for (const item of argSpans(clean, args[0].start)) {
      if (clean[item.start] === '[') {
        const pair = argSpans(clean, item.start);
        const label = pair.length > 1 ? pair[1] : pair[0];
        if (label) spans.push({ a: label.start, b: label.end, how: 'select() option label' });
      } else spans.push({ a: item.start, b: item.end, how: 'select() option label' });
    }
  }
  // resultRow(box, name, size, extra, blob): `name` is a filename (never translated), `extra` is the
  // grey caption next to it ("3 sizes in one file"), which the visitor does read.
  for (const m of clean.matchAll(/\bresultRow\s*\(/g)) {
    const args = argSpans(clean, m.index + m[0].length - 1);
    if (args[3]) spans.push({ a: args[3].start, b: args[3].end, how: 'resultRow() arg 4' });
  }
  // stats(host, [[label, value, extra], …]) — the same three columns stat() renders, written as
  // literal rows, so the labels have to be reached inside the nested arrays
  for (const m of clean.matchAll(/\bstats\s*\(/g)) {
    const args = argSpans(clean, m.index + m[0].length - 1);
    if (!args[1]) continue;
    for (let i = args[1].start; i < args[1].end; i++) {
      if (clean[i] !== '[') continue;
      const row = argSpans(clean, i);
      for (const k of [0, 1, 2]) if (row[k]) spans.push({ a: row[k].start, b: row[k].end, how: `stats() col ${k + 1}` });
      i = argRange(clean, i).end; // skip the row we just read
    }
  }
  // field(label, input, hint) and stat(label, value, extra): the help line under a control
  for (const m of clean.matchAll(/\b(text|placeholder|title|hint)\s*:/g)) {
    const r = valueRange(clean, m.index + m[0].length - 1);
    if (r) spans.push({ a: r.start, b: r.end, how: `${m[1]}: attribute` });
  }
  for (const m of clean.matchAll(/setAttribute\(\s*['"]placeholder['"]\s*,/g)) {
    let i = m.index + m[0].length;
    while (i < clean.length && /\s/.test(clean[i])) i++;
    if (clean[i] === '"' || clean[i] === "'" || clean[i] === '`') spans.push({ a: i, b: skipString(clean, i) + 1, how: 'placeholder' });
  }

  for (const sp of spans) {
    for (const [start, end] of literalsIn(src, clean, sp.a, sp.b)) {
      // two spans can reach the same literal (a note() whose text also carries a `text:` attr);
      // applying the same edit twice would splice with stale offsets
      const rangeKey = `${name}:${start}:${end}`;
      if (seenRanges.has(rangeKey)) continue;
      seenRanges.add(rangeKey);
      const raw = src.slice(start, end);
      if (raw.includes('\n') && raw[0] !== '`') continue;
      // already a dictionary fallback? `L('key', 'text')` — nothing to do. The window has to be
      // wide enough for the longest key, or an already-wrapped sentence looks unwrapped.
      const before = clean.slice(Math.max(0, start - 120), start);
      if (/\b[Lt]\s*\(\s*['"][\w]+['"]\s*,\s*$/.test(before)) continue;
      // the first argument of a dictionary call is the key, not English the visitor reads — without
      // this guard the one-word label rule would re-wrap every key we have already written
      if (/\b[Lt]\s*\(\s*$/.test(before)) continue;
      // an operand of a comparison is the tool's own switch (`goal === 'lose'`, `mode === 'wifi'`):
      // translating it would keep the English page working and break every other locale. The label
      // rules alone cannot tell 'lose' inside a test from 'mono' inside a ternary branch, so the
      // operator sitting in front of the literal is what decides.
      if (/(?:===|!==|==|!=|<=|>=|=(?![=>])|(?<!=)[<>])\s*$/.test(before) || /\bcase\s+$/.test(before)) continue;
      // `D.common.copied || 'Copied'` is the chrome dictionary's own fallback style: the English is
      // already there as a last resort, and a second layer around it would only add a shadow key
      if (/(?:\|\||&&|\?\?)\s*$/.test(before)) continue;
      if (raw[0] === '`') {
        const { parts, exprs } = parseTemplate(src, start, end);
        if (exprs.some(([a, b]) => stillLiteral(src.slice(a, b)))) { manual.push({ name, at: start, how: sp.how, raw: raw.slice(0, 90), why: 'interpolation holds a plain literal (a data value or a sentence) — wrap it by hand' }); continue; }
        let pattern = '', n = 0, ok = true;
        const argList = [];
        for (let k = 0; k < parts.length; k++) {
          const part = src.slice(parts[k][0], parts[k][1]);
          if (part.includes('`') || part.includes('${')) { ok = false; break; }
          const c = part.includes('\\') ? cookStatic(part) : part;
          if (typeof c !== 'string') { ok = false; break; }
          if (/\{\d+\}/.test(c)) { ok = false; break; }               // a literal {0} and fmt() would fight
          pattern += c;
          if (k < exprs.length) { pattern += `{${n++}}`; argList.push(src.slice(exprs[k][0], exprs[k][1]).trim()); }
        }
        if (!ok) { manual.push({ name, at: start, how: sp.how, raw: raw.slice(0, 90), why: 'template could not be split, or already looks like a fmt pattern' }); continue; }
        if (!isRendered(pattern.replace(/\{\d+\}/g, ' n '))) continue;
        const key = keyFor(pattern);
        newKeys[key] = pattern;
        const args = argList.map(a => a.replace(/\s+/g, ' '));
        edits.push({ file: name, start, end, replacement: args.length ? `fmt(L('${key}', '${esc(pattern)}'), ${args.join(', ')})` : `L('${key}', '${esc(pattern)}')`, key, value: pattern, how: sp.how });
        continue;
      }
      const cooked = cook(raw);
      if (typeof cooked !== 'string' || !isRendered(cooked)) continue;
      const key = keyFor(cooked);
      newKeys[key] = cooked;
      edits.push({ file: name, start, end, replacement: `L('${key}', '${esc(cooked)}')`, key, value: cooked, how: sp.how });
    }
  }
  return { edits, manual, newKeys };
}

// ---------------------------------------------------------------- selftest
// Which refusals the list already explains. Kept as a function of its two inputs so the selftest can
// drive it with fixtures instead of trusting the live tree to contain the case.
function partition(manual, adjudicated) {
  const covered = new Set();
  const open = [];
  for (const m of manual) {
    const i = adjudicated.findIndex(a => a.file === m.name && m.raw.includes(a.has));
    if (i < 0 || covered.has(i)) { open.push(m); continue; }
    covered.add(i);
  }
  return { open, stale: adjudicated.filter((a, i) => !covered.has(i)), covered };
}

if (process.argv.includes('--selftest')) {
  // The rewrite must be invisible: the English a visitor reads cannot change, so every expression
  // copied out of a template has to come back byte-for-byte. Run 1 of this codemod lost the last
  // character of every interpolation (`e.message` became `e.messag`) and the tree only failed at
  // runtime, which is exactly what these cases are for.
  const cases = [
    {
      name: 'two interpolations survive intact',
      src: "note(`Showing 8 of ${rows.length} rows out of ${total}`);",
      // the key name is the generator's business; the copied expressions are the part that must not drift
      want: [", rows.length, total)"],
      forbid: ['${']
    },
    {
      name: 'an existing dictionary fallback is left alone, even with a long key',
      src: "note(L('couldNotDecodeThatImageBecauseTheBytesLookWrong', 'Could not decode that image.'));",
      want: ["note(L('couldNotDecodeThatImageBecauseTheBytesLookWrong', 'Could not decode that image.'))"],
      forbid: ['L(\'ui', 'L(L(']
    },
    {
      name: 'a mime type or code string is not prose',
      src: "const m = 'image/jpeg'; const q = 'application/vnd.openxmlformats-officedocument';",
      want: [], forbid: ['L(']
    },
    {
      name: 'a template whose interpolation holds a literal is refused, not rewritten',
      src: "note(`Playback failed: ${e.error || 'unknown'}.`);",
      want: [], forbid: ['fmt(L('], manualWanted: true
    },
    {
      name: "field()'s third argument is reached",
      src: "field(L('pageRange', 'Page range'), input, 'leave empty for every page');",
      want: ["L('leaveEmptyForEveryPage', 'leave empty for every page')"], forbid: []
    },
    {
      name: "stat()'s third argument is reached",
      src: "stat(L('term', 'Term'), value, `${months} months plus a bit`);",
      want: ["'), months)"], forbid: ['${']
    },
    {
      name: 'a conditional label wraps its prose but not its comparison',
      src: "stat(goal === 'lose' ? 'Fat-loss target for this week' : 'Daily target for staying', value, '');",
      want: ["goal === 'lose' ? L('fatLossTargetForThis', 'Fat-loss target for this week')"],
      forbid: ["L('lose'", "goal === L("]
    },
    {
      name: 'the same sentence in two places gets one key, two edits',
      src: "note('Type a pattern to test before anything');\nnote('Type a pattern to test before anything');",
      want: ["L('typeAPatternToTest', 'Type a pattern to test before anything')"], twice: 2, oneKey: true
    },
    {
      name: 'quotes inside the sentence are escaped, not nested',
      src: `note("Click the " + "picture to sample a pixel now");`,
      want: [], forbid: ["''"]
    },
    {
      name: 'select option labels are reached',
      src: "const s = select([[1.2, 'Sedentary — desk work, no exercise'], [1.375, L('light','Light activity')]], 1.2, f);",
      want: ["L('sedentaryDeskWorkNoExercise', 'Sedentary — desk work, no exercise')"], forbid: []
    },
    {
      // under the one-word label rule a literal like 'pages' looks exactly like the English next to it, and
      // without the key guard the codemod would rewrite the key itself into L('uiPages', 'Pages')
      name: 'a dictionary key is never mistaken for the English sitting next to it',
      src: "note(L('pages', 'Add a page break between every two images'));",
      want: ["note(L('pages', 'Add a page break between every two images'));"],
      forbid: ["L('uiPages'", "L('addAPageBreak"], twice: 0
    },
    {
      name: 'a single-word label in a rendered slot is reached',
      src: "resultRow(out, name, blob.size, `${count} pages`, blob);",
      want: [", count)"], forbid: ['${']
    },
    {
      // 'wifi' and 'url' pass the one-word label rule, and the tool compares against them
      // (`mode === 'wifi'`), so only the label slot may be rewritten — a wrapped value would break
      // the tool in every locale whose translation of "wifi" is not the letters w-i-f-i
      name: "select() values stay the tool's own ids",
      src: "select([['wifi', 'Wi‑Fi network'], ['url', 'A plain URL to encode']], mode, setMode);",
      want: ["['wifi'", "['url'"], forbid: ["L('wifi'", "L('url'"], twice: 2
    },
    {
      name: 'a unit or codec token is not turned into a label',
      src: "const a = select([[44100, '44.1 kHz'], ['image/jpeg', 'JPG']], r, f); field('Width', input, 'px'); note('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg');",
      want: ["'44.1 kHz'", "'JPG'", "'px'"], forbid: ["L('khz'", "L('jpg'", "L('px'", "L('dataImage"]
    },
    {
      // MP3 mixes letters and a digit: the whole token is the codec, so it stays literal like WAV/JPG.
      // The counter-proof is the phrase "MP3 file size" — if the exemption were too broad it would also
      // stay literal (0 edits); if too narrow MP3 itself would wrap (2+ edits). Exactly 1 edit means the
      // line is drawn at the right place: a bare codec is code, a sentence built from it is prose.
      name: 'an alphanumeric codec (MP3) is exempt, but a phrase built from it is still translated',
      src: "select([['mp3', 'MP3'], ['wav', 'WAV']], f, set); field('x', input, 'MP3 file size');",
      want: ["'MP3'", "'WAV'", "'MP3 file size'"], twice: 1
    },
    {
      name: 'a chrome-dictionary fallback is not shadowed by a new widget key',
      src: "toast(D.common.copied || 'Copied to the clipboard');",
      want: ["D.common.copied || 'Copied to the clipboard'"], forbid: ["L('copied"], twice: 0
    },
  ];
  let bad = 0;
  for (const c of cases) {
    const keyFor = makeKeyFor({});
    const seen = new Set();
    const { edits, manual, newKeys } = plan('t.js', c.src, keyFor, seen);
    const out = (() => {
      let s = c.src;
      for (const e of edits.slice().sort((a, b) => b.start - a.start)) s = s.slice(0, e.start) + e.replacement + s.slice(e.end);
      return s;
    })();
    const problems = [];
    for (const w of c.want) if (!out.includes(w)) problems.push(`missing ${JSON.stringify(w)}`);
    for (const f of c.forbid || []) if (out.includes(f)) problems.push(`found ${JSON.stringify(f)}`);
    if (c.manualWanted && !manual.length) problems.push('expected a MANUAL refusal');
    if (c.twice !== undefined && edits.length !== c.twice) problems.push(`${edits.length} edit(s), expected ${c.twice}`);
    if (c.oneKey && new Set(edits.map(e => e.key)).size !== 1) problems.push(`keys ${[...new Set(edits.map(e => e.key))]} — one sentence became more than one key`);
    console.log(`  ${problems.length ? 'FAIL' : 'ok  '} ${c.name}${problems.length ? ' — ' + problems.join('; ') : ''}`);
    if (problems.length) { console.log(`       got: ${out}`); bad++; }
  }
  // the adjudication list is a gate, not a log: a refusal it does not explain must stay open, and an
  // excuse whose site has disappeared must be reported as stale
  const mk = (name, raw) => ({ name, raw, at: 0, how: 'note() arg 1', why: 'fixture' });
  const ad = [{ file: 'text.js', has: "'unknown'" }];
  const gate = [];
  const live = partition([mk('text.js', "`Playback failed: ${e.error || 'unknown'}.`"), mk('calc.js', "`${dp} decimal place${dp === 1 ? '' : 's'}`")], ad);
  if (live.open.length !== 1 || live.open[0].name !== 'calc.js') gate.push(`open = ${live.open.map(m => m.name)} — expected only the calc.js refusal`);
  if (live.stale.length) gate.push('a refusal that is still on disk was called stale');
  const gone = partition([], ad);
  if (gone.stale.length !== 1) gate.push(`stale = ${gone.stale.length} — an excuse whose site is gone must be reported`);
  console.log(`  ${gate.length ? 'FAIL' : 'ok  '} an unlisted refusal stays open, an expired excuse goes stale${gate.length ? ' — ' + gate.join('; ') : ''}`);
  if (gate.length) bad++;

  if (bad) { console.error(`selftest: ${bad} case(s) failed — refusing to touch the tree`); process.exit(1); }
  console.log(`selftest: ${cases.length} rewrite case(s) — every interpolation copied byte for byte, non-prose left alone`);
  process.exit(0);
}

// ---------------------------------------------------------------- run
const en = JSON.parse(await readFile(EN_TOOLS, 'utf8'));

// ---------------------------------------------------------------- --adopt
// A key typed by hand — L('qrPayloadPreview', '{0} payload: {1}') — is only translatable once the
// dictionary knows it. Until then every locale silently renders the English fallback and the coverage
// report cannot even count the string, so it looks translated while it is not. --adopt reads the
// English back out of the call and registers the key: the same fact check-label-collisions.mjs
// reports as an orphan, fixed from the source of truth (the call site) rather than by hand-typing
// JSON. A key that carries two different fallbacks is refused instead of guessed at.
if (process.argv.includes('--adopt')) {
  const chrome = JSON.parse(await readFile(join(ROOT, 'src', 'locales', 'en.json'), 'utf8'));
  const dict = { ...(chrome.cat || {}), ...(chrome.tool || {}), ...(chrome.common || {}), ...(en.w || {}) };
  const CALL = /\b[Lt]\(\s*'([a-zA-Z][\w]*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
  const unescape = raw => raw.replace(/\\([nrt'\\"])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);
  const sources = [];
  for (const dir of [join(ROOT, 'src', 'scripts'), join(ROOT, 'src', 'scripts', 'tools')]) {
    for (const f of await readdir(dir)) if (f.endsWith('.js')) sources.push(join(dir, f));
  }
  const missing = new Map();
  let seen = 0;
  for (const file of sources) {
    const src = (await readFile(file, 'utf8')).replace(/^[ \t]*\/\/.*$/gm, ' ');
    for (const m of src.matchAll(CALL)) {
      seen++;
      const [, key, raw] = m;
      if (dict[key] !== undefined) continue;
      const fallback = unescape(raw);
      if (missing.has(key) && missing.get(key) !== fallback) {
        console.error(`REFUSING: "${key}" carries two different fallbacks (${JSON.stringify(missing.get(key))} vs ${JSON.stringify(fallback)}) — pick one in the source first`);
        process.exit(1);
      }
      missing.set(key, fallback);
    }
  }
  if (!seen) { console.error(`EMPTY RUN: no L()/t() call found in ${sources.length} file(s) — nothing was read`); process.exit(1); }
  if (!missing.size) {
    console.log(`adopt: ${seen} call(s) read, every key already in the dictionary (${Object.keys(en.w).length} w keys)`);
    process.exit(0);
  }
  Object.assign(en.w, Object.fromEntries(missing));
  await writeFile(EN_TOOLS, JSON.stringify(en, null, 2) + '\n');
  console.log(`adopt: registered ${missing.size} orphan key(s) from the English at their call sites`);
  for (const [k, v] of missing) console.log(`  ${k.padEnd(24)} ${JSON.stringify(v)}`);
  process.exit(0);
}

const keyFor = makeKeyFor(en.w);
const seenRanges = new Set();
const edits = [], manual = [], newKeys = {};
for (const file of FILES) {
  const src = await readFile(file, 'utf8');
  const name = file.split(/[\\/]/).pop();
  const r = plan(name, src, keyFor, seenRanges);
  edits.push(...r.edits); manual.push(...r.manual); Object.assign(newKeys, r.newKeys);
}

const byFile = {};
for (const e of edits) (byFile[e.file] ||= []).push(e);
console.log(`\ni18n-wrap ${apply ? 'APPLYING' : 'dry run'} — ${Object.keys(newKeys).length} new dictionary key(s)`);
for (const [f, list] of Object.entries(byFile)) {
  console.log(`\n${f}  (${list.length} edit(s))`);
  for (const e of list) console.log(`  ${e.key.padEnd(28)} ${e.how.padEnd(18)} ${JSON.stringify(e.value).slice(0, 78)}`);
}
const { open, stale } = partition(manual, ADJUDICATED);
if (manual.length) {
  console.log(`\nMANUAL — ${manual.length} site(s) the codemod refused to rewrite:`);
  for (const m of manual) {
    console.log(`  ${open.includes(m) ? 'UNRESOLVED ' : 'adjudicated'} ${m.name}@${m.at}  ${m.how}: ${m.why}\n      ${JSON.stringify(m.raw)}`);
  }
}
for (const s of stale) console.log(`\nSTALE — ADJUDICATED entry ${JSON.stringify(s)} no longer matches any refusal: delete the excuse`);

if (process.argv.includes('--check')) {
  const problems = [];
  if (edits.length) problems.push(`${edits.length} rendered string(s) still bypass the dictionary — run: node scripts/i18n-wrap.mjs --apply`);
  if (open.length) problems.push(`${open.length} site(s) refused by the codemod and not adjudicated in ADJUDICATED (fix the source or list the reason)`);
  if (stale.length) problems.push(`${stale.length} ADJUDICATED entry(ies) match nothing any more — the site is gone, delete the excuse`);
  if (problems.length) { for (const p of problems) console.error(`\nFAIL ${p}`); process.exit(1); }
  console.log(`ok — every rendered string in the tool code is a dictionary key (${Object.keys(en.w).length} keys in en.tools.json, ${manual.length} site(s) adjudicated)`);
  process.exit(0);
}

if (!apply) { console.log('\nnothing written — re-run with --apply'); process.exit(0); }
if (!edits.length) { console.error('EMPTY RUN: no edit found — refusing to rewrite anything'); process.exit(1); }

await mkdir(BACKUP, { recursive: true });
for (const file of FILES) {
  const name = file.split(/[\\/]/).pop();
  const target = join(BACKUP, name);
  if (existsSync(target)) { console.error(`REFUSING to overwrite an existing backup: ${target}`); process.exit(1); }
  await copyFile(file, target);
}
for (const file of FILES) {
  const name = file.split(/[\\/]/).pop();
  const list = (byFile[name] || []).slice().sort((a, b) => b.start - a.start);
  if (!list.length) continue;
  let src = await readFile(file, 'utf8');
  for (const e of list) src = src.slice(0, e.start) + e.replacement + src.slice(e.end);
  // fmt() is a new import in the files that gained interpolated strings
  const needsFmt = list.some(e => e.replacement.startsWith('fmt('));
  if (needsFmt && !/\bfmt\b/.test(src.slice(0, src.indexOf('const ') > 0 ? src.indexOf('const ') : 900))) {
    src = src.replace(/^import \{\n/m, 'import {\n  fmt,\n');
  }
  await writeFile(file, src);
  console.log(`wrote ${name}: ${list.length} edit(s)`);
}
const tool = JSON.parse(await readFile(EN_TOOLS, 'utf8'));
Object.assign(tool.w, newKeys);
await writeFile(EN_TOOLS, JSON.stringify(tool, null, 2) + '\n');
console.log(`en.tools.json: ${Object.keys(tool.w).length} w key(s)`);
