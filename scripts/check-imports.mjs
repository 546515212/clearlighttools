// Static check: a shared helper called without being imported is a ReferenceError at run time, and
// inside a tool it usually gets swallowed by a try/catch and comes out as a friendly message that
// blames the user's input. That is how markdown-to-html shipped: its code called loadLib() but the
// import list at the top of text.js never included it, and the catch reported "the Markdown library
// could not be loaded" — a sentence pointing at the vendor file instead of at the missing import.
//
// Scope is deliberately narrow. The name list is exactly what lib.js exports, so the only thing this
// can flag is a real cross-module mistake; it never guesses at parameters, destructured bindings or
// regex literals, and a check that cries wolf gets ignored within a week. What it cannot see is a
// typo'd *local* helper (outputBox vs outputbox) — that needs the module to actually run, which is
// what npm run smoke and the browser sweep are for.
//
//   node scripts/check-imports.mjs            report only
//   node scripts/check-imports.mjs --strict   exit 1 on a finding

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ROOT } from './lib-node.mjs';

const strict = process.argv.includes('--strict');

// ---------------------------------------------------------------- what lib.js offers
const libSrc = await readFile(join(ROOT, 'src', 'scripts', 'lib.js'), 'utf8');
const exports_ = new Set();
for (const m of libSrc.matchAll(/^export\s+(?:async\s+)?function\s+([\w$]+)/gm)) exports_.add(m[1]);
for (const m of libSrc.matchAll(/^export\s+(?:const|let|var)\s+([\w$]+)/gm)) exports_.add(m[1]);
for (const m of libSrc.matchAll(/^export\s*\{([^}]*)\}/gm)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name) exports_.add(name);
  }
}
exports_.delete('default');
if (exports_.size < 20) {
  console.error(`lib.js export list looks wrong (${exports_.size} names) — the parser stopped matching, not the code`);
  process.exit(2);
}

// ---------------------------------------------------------------- every other script in src
const files = [];
const walk = async dir => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
};
await walk(join(ROOT, 'src', 'scripts'));

const findings = [];
for (const path of files) {
  if (path.endsWith(`${join('scripts', 'lib.js')}`)) continue;
  const src = await readFile(path, 'utf8');
  // drop comments so a helper name mentioned in prose is not read as a call
  const code = src.replace(/^[ \t]*\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

  const imported = new Set();
  for (const m of code.matchAll(/import\s*(?:\*\s*as\s*)?\{?([^};]*)\}?\s*from\s*['"][^'"]+['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }
  // declared in this file: the reason a name may be used without an import
  const isDeclared = name =>
    new RegExp(`\\b(?:function|class)\\s+${name}\\s*[({]`).test(code) ||
    new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(code) ||
    // a destructured binding or parameter that shadows the helper: ({ run, el } = opts)
    new RegExp(`[({,\\s]${name}\\s*(?:[:,=}]|\\)|,)`).test(code.replace(/import[\s\S]*?from\s*['"][^'"]+['"]/g, ' '));

  const missing = new Set();
  for (const name of exports_) {
    if (imported.has(name)) continue;
    // a call site that is not a property access: `m.loadLib(...)` after a dynamic import('./lib.js')
    // is a legitimate use, and runtime.js does exactly that
    if (!new RegExp(`(^|[^\\w$.])${name}\\s*\\(`).test(code)) continue;   // never called directly
    if (isDeclared(name)) continue;                               // has its own local version
    const line = src.split('\n').findIndex(l => new RegExp(`(^|[^\\w$.])${name}\\s*\\(`).test(l)) + 1;
    missing.add(`${name} (called on line ${line || '?'})`);
  }
  if (missing.size) findings.push({ file: relative(ROOT, path).replace(/\\/g, '/'), names: [...missing] });
  // deliberately not checking the reverse (imported but unused): telling that apart reliably needs
  // a real parser, and half a regex is how a check starts lying
}

console.log(`checked ${files.length} scripts against ${exports_.size} lib.js exports`);
let bad = 0;
for (const f of findings) {
  if (f.names.length) { console.log(`  FAIL ${f.file}: called but not imported — ${f.names.join(', ')}`); bad++; }
}
if (!bad) console.log('  ok — every shared helper a file calls is imported or declared there');
if (bad && strict) process.exit(1);
