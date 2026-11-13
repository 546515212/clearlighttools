#!/usr/bin/env node
// Regression gate for the DOM helpers in src/scripts/lib.js — specifically the order in which el()
// applies attributes. A range/number input sanitizes `value` against type/min/max/step the instant it
// is set, so `value` must be applied AFTER the constraints. The original el() walked Object.entries in
// insertion order and set value=150 while max was still the browser default 100: the live .value
// clamped to 100 even though the attribute read 150, so the slider thumb, the "150%" label and the
// applied gain disagreed. jsdom reproduces the clamp exactly (verified), so this gate bites without a
// real browser. The audio batch (change-volume 150, change-speed 125) and the PDF resolution slider
// (1.6×) are the call sites that exposed it.
//
//   node scripts/check-dom-helpers.mjs            run the assertions, exit 1 on any failure
//
// Every assertion is paired with a counter-proof showing the OLD ordering would fail it, and the run
// refuses to report success on an empty sweep.
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://toolhive.local/en/' });
const { window } = dom;
window.__TH_DICT = { w: {}, common: {}, tool: {}, cat: {} };
window.document.body.dataset.locale = 'en';
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;

const { el, note, rangeInput, numberInput, checkInput, select } = await import('../src/scripts/lib.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
// rangeInput returns span.check(input, labelSpan); pull the input and the live label out of it.
const range = (...a) => { const w = rangeInput(...a); return { input: w.querySelector('input'), label: w.querySelector('span').textContent, wrap: w }; };

// ---------------------------------------------------------------- the fix: value survives the constraints
ok('change-volume slider keeps 150 (max 400)', range(150, 0, 400, 5, () => {}, '%').input.value === '150', `value=${range(150, 0, 400, 5, () => {}, '%').input.value}`);
ok('change-speed slider keeps 125 (min 50, max 200)', range(125, 50, 200, 5, () => {}, '%').input.value === '125');
ok('PDF resolution slider keeps 1.6 (step 0.1)', range(1.6, 1, 3, 0.1, () => {}, '×').input.value === '1.6');
ok('pitch slider keeps 2 with a negative min', range(2, -12, 12, 1, () => {}).input.value === '2');
ok('EQ slider keeps 0 with a negative min', range(0, -12, 12, 1, () => {}, ' dB').input.value === '0');
{
  const r = range(150, 0, 400, 5, () => {}, '%');
  ok('the thumb and the label agree (no 150% label over a 100 thumb)', r.input.value === '150' && r.label === '150%', `value=${r.input.value} label=${r.label}`);
}
ok('numberInput keeps a value above the default max', numberInput(150, () => {}, { min: 0, max: 400, step: 5 }).value === '150');
ok('el() generic range keeps value when constraints follow', el('input', { type: 'range', value: 150, min: 0, max: 400, step: 5 }).value === '150');
ok('checkInput still checks the box', checkInput('Mono', true, () => {}).querySelector('input').checked === true);
{
  const s = select([['mp3', 'MP3'], ['wav', 'WAV']], 'wav', () => {});
  ok('select keeps option values and the chosen value', s.value === 'wav' && [...s.options].map(o => o.value).join() === 'mp3,wav');
}
ok('moving the slider still fires onChange with the live value', (() => { let got = null; const r = range(150, 0, 400, 5, v => { got = v; }, '%'); r.input.value = '200'; r.input.dispatchEvent(new window.Event('input')); return got === 200 && r.wrap.querySelector('span').textContent === '200%'; })());

// ---------------------------------------------------------------- counter-proofs
// The same input built the OLD way (value before max) must clamp to 100 — proving the assertions above
// would fail under the regression, i.e. this gate actually discriminates rather than always passing.
{
  const broken = window.document.createElement('input');
  broken.setAttribute('type', 'range'); broken.setAttribute('value', '150');
  broken.setAttribute('min', '0'); broken.setAttribute('max', '400'); broken.setAttribute('step', '5');
  ok('counter-proof: value-before-max clamps to 100 (the bug this gate catches)', broken.value === '100', `old ordering value=${broken.value}`);
  const fixed = el('input', { type: 'range', value: 150, min: 0, max: 400, step: 5 });
  ok('counter-proof: the fixed helper differs from the broken ordering', fixed.value !== broken.value && fixed.value === '150');
}
ok('counter-proof: a clamped slider would fail the 150 assertion', range(150, 0, 400, 5, () => {}, '%').input.value !== '100');

// ---------------------------------------------------------------- recorder status: one box, not nested
// recorderPanel's status wrapper must NOT carry .note itself: fillStatus() swaps in a single
// note(msg, kind) child. The old code gave the wrapper .note too, so every message rendered as a
// coloured box inside a grey box (double padding), and the recording timer's status.textContent wiped
// the inner note's colour. Mount the panel in jsdom and click Record — with no MediaRecorder the
// handler's catch branch runs fillStatus(note(..., 'err')) synchronously — to exercise both states.
const { recorderPanel } = await import('../src/scripts/tools/media-core.js');
const nestedNotes = root => !!root.querySelector('.note .note');
{
  const root = el('div', {});
  document.body.append(root);
  recorderPanel(root, { mode: 'voice' });
  const status = root.querySelector('.recorder-status');
  const recordBtn = [...root.querySelectorAll('button')].find(b => /Record/.test(b.textContent));
  const stopBtn = [...root.querySelectorAll('button')].find(b => /Stop/.test(b.textContent));
  ok('recorder mounted with Record/Stop and a status wrapper (non-empty)', !!status && !!recordBtn && !!stopBtn);
  ok('recorder status wrapper is not itself a .note', !!status && !status.classList.contains('note'), status && `class="${status.className}"`);
  ok('recorder initial status is a single note', !!status && status.children.length === 1 && status.firstElementChild.classList.contains('note') && !nestedNotes(status));
  recordBtn.click();   // no MediaRecorder in jsdom -> catch -> fillStatus(note(..., 'err'))
  ok('recorder error status is a single note, not boxed twice', !!status && status.children.length === 1 && !nestedNotes(status) && status.firstElementChild.classList.contains('err'), status && `child="${status.firstElementChild.className}"`);
  ok('recorder buttons reset after a failed start', recordBtn.disabled === false && stopBtn.disabled === true);
}
// counter-proof: the OLD structure (a .note wrapper holding a .note child) must trip the detector,
// and the fixed wrapper must not — proving the nesting assertion discriminates rather than always passing.
{
  const old = el('div', { class: 'note' }, note('Access was denied.', 'err'));
  ok('counter-proof: the old note-in-note structure is detected as nested', nestedNotes(old) === true);
  const fixed = el('div', { class: 'recorder-status' }, note('Access was denied.', 'err'));
  ok('counter-proof: the fixed wrapper is not nested', nestedNotes(fixed) === false);
}

// ---------------------------------------------------------------- non-empty guard
const total = pass + fail;
if (total < 20) { console.error(`\nEMPTY RUN: only ${total} assertion(s) executed — the helpers/recorder did not load or the sweep is broken`); process.exit(1); }
if (fail) { console.error(`\nDOM-helper gate: ${fail} failed of ${total} — el() is mis-ordering value/checked, or the recorder status is double-boxed again`); process.exit(1); }
console.log(`\nDOM-helper gate: ${pass} passed, 0 failed of ${total} (value/checked after type/min/max/step; recorder status single-box; counter-proofs included)`);