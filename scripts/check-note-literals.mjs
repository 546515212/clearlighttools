// Static check: every note(...) — the one-line message a tool shows under its panel — must take its
// text from the dictionary. note('English sentence') is invisible to every translation layer: the
// page chrome is localised, the disclaimer under the result stays English, and no coverage report
// can see it because the string never existed in a dictionary file.
//
// The rule is precise rather than heuristic: the first argument of note() must be a call that
// resolves through the dictionary (L/t/fmt) or a variable. A bare 'string', "string" or
// `template` literal is a finding. note() is the only message helper in src/scripts/tools.
//
//   node scripts/check-note-literals.mjs              report only
//   node scripts/check-note-literals.mjs --strict     exit 1 on a finding
//   node scripts/check-note-literals.mjs --selftest   prove the finder fires and is not vacuous

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';
import { DICT_CALL, foldNonText, stillLiteral } from './lib-i18n.mjs';

const strict = process.argv.includes('--strict');
const selftest = process.argv.includes('--selftest');

// ---------------------------------------------------------------- the finder
// Comments are stripped first: `// note('see above')` in a prose comment is not a call site.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    // [ \t\r] rather than \s: \s matches the newline *before* a comment, so the line break goes with
    // it and every reported line number drifts above the call site the finding points at
    .replace(/^[ \t\r]*\/\/.*$/gm, '');
}

// Args are split at the call's own depth so note(`a, b`) and note(f(g(1), 2)) are read correctly.
function firstArg(src, open) {
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth < 1) break; }
    else if (c === ',' && depth === 1) break;
  }
  return src.slice(open + 1, i).trim();
}
function skipString(src, start) {
  const q = src[start];
  for (let j = start + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j;
    // a template literal's ${...} may itself contain a quote
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') j = skipBraces(src, j + 1);
  }
  return src.length;
}
function skipBraces(src, start) {
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) return j; }
  }
  return src.length;
}

const DICTIONARY_CALL = /^(?:L|t|fmt|tr|translate)\s*\(/;
// L('key', 'fallback') and quoted code folded away: what remains of the argument is either data or
// English nobody translated. A template that only interpolates dictionary calls — `${L('download',
// 'Download')} PNG` — is localised text plus a format name, and must not be reported as a hardcoded
// literal. The same fold the codemod uses, from lib-i18n.mjs, so the two cannot disagree.
function classify(arg) {
  if (DICTIONARY_CALL.test(arg)) return null;
  if (/^[A-Za-z_$][\w$.]*$/.test(arg)) return null;                    // a variable: the caller's business
  const collapsed = foldNonText(arg.replace(DICT_CALL, 'D'));
  if (/^["'`]/.test(collapsed) && !collapsed.includes('D')) return 'hardcoded string literal';
  let body = collapsed;
  if (body[0] === '`' && body[body.length - 1] === '`') body = body.slice(1, -1);
  if (stillLiteral(body)) return 'text does not come from the dictionary';
  return null;
}

function findFindings(src) {
  const clean = stripComments(src);
  const out = [];
  const re = /\bnote\s*\(/g;
  let m;
  while ((m = re.exec(clean))) {
    const open = m.index + m[0].length - 1;
    const arg = firstArg(clean, open);
    if (!arg) { out.push({ at: m.index, arg, why: 'note() called with no text' }); continue; }
    const why = classify(arg);
    if (why) out.push({ at: m.index, arg, why });
  }
  return out.map(f => ({ ...f, line: clean.slice(0, f.at).split('\n').length }));
}

// ---------------------------------------------------------------- selftest
if (selftest) {
  const cases = [
    { name: 'plain single-quoted sentence is a finding', src: `x.append(note('Enter a price.'));`, want: 1 },
    { name: 'template literal is a finding', src: 'out.append(note(`${a}: done`));', want: 1 },
    { name: 'L() wrapped is clean', src: `out.append(note(L('waitingInput', 'Waiting for input.')));`, want: 0 },
    { name: 'fmt(L()) wrapped is clean', src: `out.append(note(fmt(L('saving', 'about {0} more'), v), 'err'));`, want: 0 },
    { name: 'variable is clean', src: `out.append(note(label));`, want: 0 },
    { name: 'a note() inside a comment is not a call site', src: `// note('old copy, kept for reference')\nreal();`, want: 0 },
    { name: 'a block comment is not a call site either', src: `/* note('stale') */\nreal();`, want: 0 },
    { name: 'a comma inside a template literal does not split the arg', src: 'note(`${a}, ${b} frames · done`);', want: 1 },
    { name: 'a dictionary call with a nested quote still parses', src: `note(L('x', 'He said "hi"'));`, want: 0 },
    { name: 'the second argument kind is not mistaken for text', src: `note('ok', 'err');`, want: 1 },
    { name: 'a template of only dictionary calls is localised text', src: "note(`${L('download', 'Download')} PNG`);", want: 0 },
    { name: 'fmt() around a dictionary call is localised text', src: `note(fmt(L('showing', 'Showing {0} of {1}'), a, b), 'err');`, want: 0 },
    { name: 'an English phrase parked inside ${} is still a finding', src: "note(`${mode === 'wifi' ? 'Wi-Fi' : 'Text'} payload: ${data}`);", want: 1 },
  ];
  let bad = 0;
  for (const c of cases) {
    const got = findFindings(c.src).length;
    const ok = got === c.want;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.name} — expected ${c.want}, found ${got}`);
  }
  if (bad) { console.error(`selftest: ${bad} case(s) failed — the finder does not match the source rules`); process.exit(1); }
  console.log(`selftest: ${cases.length} cases — finder fires on literals, ignores dictionary calls and comments`);
}

// ---------------------------------------------------------------- real tree
const dirs = [join(ROOT, 'src', 'scripts'), join(ROOT, 'src', 'scripts', 'tools')];
const files = [];
for (const dir of dirs) for (const f of await readdir(dir)) if (f.endsWith('.js')) files.push(join(dir, f));

const report = [];
let noteCalls = 0;
for (const f of files) {
  const src = await readFile(f, 'utf8');
  const found = findFindings(src);
  const total = (src.match(/\bnote\s*\(/g) || []).length;
  noteCalls += total;
  if (found.length) report.push({ file: f.replace(ROOT + '\\', '').replace(ROOT + '/', ''), found });
}

const n = report.reduce((a, r) => a + r.found.length, 0);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report.map(r => ({ file: r.file, found: r.found.map(f => ({ line: f.line, why: f.why, arg: f.arg })) })), null, 1));
} else {
  console.log(`\nnote() text sources — ${files.length} file(s), ${noteCalls} note() call(s) scanned`);
  if (!report.length && !n) console.log('  every note() takes its text from the dictionary or a variable');
  for (const r of report) {
    console.log(`\n  ${r.file}`);
    for (const f of r.found) console.log(`    line ${String(f.line).padStart(4)}  ${f.why}: ${f.arg.slice(0, 72)}`);
  }
  console.log(`\nfindings: ${n}`);
}

if (!noteCalls) { console.error('EMPTY RUN: no note() call found in the tree — the check proves nothing'); process.exit(1); }
if (strict && n) process.exit(1);
