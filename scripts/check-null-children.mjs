#!/usr/bin/env node
// `element.append(node, ok ? note(…) : null)` prints the word "null" on the page.
//
//   node scripts/check-null-children.mjs              # report
//   node scripts/check-null-children.mjs --strict     # exit 1 on any site
//   node scripts/check-null-children.mjs --selftest   # prove it can see the bug and the fix
//
// Why this exists: el() drops a null child — `el('div', {}, a, cond ? b : null)` is a normal thing
// to write here, and it works. The DOM's own append(), prepend() and replaceChildren() do not drop
// it. Their argument is "Node or DOMString", and null converts to the DOMString "null", so the page
// gains a text node that literally says null. Eight panels did this, and the word appeared under a
// result on every page in all thirteen locales — it is not translatable, so no dictionary check could
// see it, and it is a text node, so the placeholder check saw nothing wrong either. It surfaced only
// when the rendered-text audit compared a Chinese panel with the English one and found "null" in both.
//
// lib.js now exports add() and fill(), which are append() and replaceChildren() with el()'s rule put
// back, and that is what the sites use. This check keeps new ones from going back to the raw call.
//
// Limits, stated: comments are stripped before extracting (the doc comment in lib.js describes this
// very bug, and must not be a finding), and the strip is line-based — whole-line `//` and `/* … */` —
// because a scanner that also cut at every `//` would eat the sample URLs in the tools. A trailing
// comment after code on the same line is therefore not stripped. The mutation in --selftest is what
// makes "no findings" mean "no sites", not "no scanning".
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';

const STRICT = process.argv.includes('--strict');
const SELFTEST = process.argv.includes('--selftest');

const rel = p => p.replace(ROOT + '/', '').split('\\').join('/');

// The calls that take children and stringify what they are handed. el() is deliberately absent: it
// filters, which is the point.
const CHILD_CALLS = ['append', 'prepend', 'replaceChildren', 'insertBefore', 'before', 'after'];
const NULL_ARG = /:\s*(null|undefined)\b/g;

const stripComments = src => src
  .split('\n')
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

// Find every `: null` / `: undefined` and ask what call it is an argument of: walk backwards to the
// first unbalanced opening bracket, then read the identifier in front of it.
export function scan(src, name = '') {
  const hits = [];
  const code = stripComments(src);
  for (const m of code.matchAll(NULL_ARG)) {
    let depth = 0, i = m.index;
    for (; i >= 0; i--) {
      const c = code[i];
      if (c === ')' || c === ']' || c === '}') depth++;
      else if (c === '(' || c === '[' || c === '{') { if (depth === 0) break; depth--; }
    }
    const callee = code.slice(Math.max(0, i - 60), i + 1).match(/([A-Za-z_$][\w$]*)\s*\($/)?.[1];
    if (!callee || !CHILD_CALLS.includes(callee)) continue;
    const upto = code.slice(0, m.index);
    hits.push({ file: name, line: upto.split('\n').length, callee, arg: m[1], text: upto.split('\n').pop().trim().slice(0, 90) });
  }
  return hits;
}

const sources = () => {
  const out = [];
  for (const dir of [join(ROOT, 'src', 'scripts'), join(ROOT, 'src', 'scripts', 'tools')]) {
    for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) out.push([join(dir, f), f]);
  }
  return out;
};

// The counter-proof, both directions: the bug must be seen, and the two ways of not having it must
// not be. `want` is a count, so a scanner that stopped matching brackets would fail rather than pass.
const SAMPLES = [
  ['the bug itself', `box.replaceChildren(el('h3', { text: 'x' }), ok ? note(y) : null);`, 1],
  ['append with the same shape', `hits.append(a, ...rows, n > 60 ? note(m) : null);`, 1],
  ['undefined converts to "undefined" just the same', `out.append(a, ok ? note(y) : undefined);`, 1],
  ['add() filters, so null is safe', `add(box, el('h3', { text: 'x' }), ok ? note(y) : null);`, 0],
  ['fill() filters too', `fill(out, a, ok ? note(y) : null);`, 0],
  ['el() always filtered', `const card = el('div', {}, a, ok ? note(y) : null);`, 0],
  ['a ternary that is not a child is not a finding', `const v = ok ? null : 3;`, 0],
  ['a commented-out site is documentation, not code', `  // box.replaceChildren(a, ok ? note(y) : null);\n  const k = 1;`, 0],
  ['a URL inside a string must survive the comment strip', `a.href = 'https://example.com/x'; out.append(note(t));`, 0]
];

function selftest() {
  let bad = 0;
  for (const [name, src, want] of SAMPLES) {
    const got = scan(src, 'sample').length;
    if (got !== want) { bad++; console.log(`  FAIL selftest: ${name} — expected ${want}, got ${got}`); }
  }
  if (!SAMPLES.some(s => s[2])) {
    console.log('  FAIL selftest has no positive case — it cannot fail, so it proves nothing');
    return 1;
  }
  // the mutation that would make this file lie: dropping the callee filter flags every `: null` in
  // the tree, including el() and add() sites, so the samples above have to be able to tell the
  // filtered scanner from the unfiltered one.
  const naive = src => (src.match(NULL_ARG) || []).length;
  const blind = SAMPLES.filter(([_, src]) => naive(src) !== scan(src, 'sample').length);
  if (!blind.length) {
    console.log('  FAIL selftest cannot tell the callee filter from its absence — it is vacuous');
    return 1;
  }
  console.log(`  selftest ok — ${SAMPLES.length} cases, ${SAMPLES.filter(s => s[2]).length} must be caught, `
    + `${SAMPLES.filter(s => !s[2]).length} must stay silent, and ignoring the callee name would change ${blind.length} of them`);
  return bad ? 1 : 0;
}

if (SELFTEST) {
  const rc = selftest();
  if (rc) process.exit(rc);
}

const hits = [];
const files = sources();
for (const [path] of files) hits.push(...scan(readFileSync(path, 'utf8'), rel(path)));

console.log(`scanned ${files.length} files for null handed to a DOM child call`);
if (hits.length) {
  console.log(`  ${hits.length} site(s) — the page would print the word "${hits[0].arg}":`);
  for (const h of hits) console.log(`      ${h.file}:${h.line}  ${h.callee}( … : ${h.arg}   ${h.text}`);
  console.log('  fix: use add()/fill() from lib.js, or el(), which ignore a null child');
  if (STRICT) process.exit(1);
} else {
  console.log('  ok — no conditional null is being handed to append/prepend/replaceChildren');
}
