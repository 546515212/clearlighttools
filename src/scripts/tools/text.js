// Text and code tools. Everything is computed in the page: no text ever leaves the browser.
import {
  fmt,
  el, D, t, countWords, parseCsv, diffLines, digest, digestFile, md5, download,
  note, stat, toast, select, numberInput, textInput, checkInput, rangeInput, button, field, run, copyText, loadLib, locale, add, fill
} from '../lib.js';

const L = (k, fb) => t(k, fb);

function area(placeholder = '', min = '170px') {
  const a = el('textarea', { spellcheck: 'false', placeholder, style: `min-height:${min}` });
  return a;
}

function copyBtn(get) {
  return button(L('copy', 'Copy'), () => copyText(get()), { kind: 'ghost' });
}

function stats(host, rows) {
  let box = host.querySelector('.stat-row');
  if (!box) { box = el('div', { class: 'out stat-row' }); host.append(box); }
  box.replaceChildren(...rows.map(([l, v, x]) => stat(l, v, x)));
  return box;
}

// UTF-8 safe base64
const b64encode = s => {
  const u8 = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = s => {
  const clean = s.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (clean.length % 4 === 1) throw new Error(L('characterCountIsNotValid', 'character count is not valid base64'));
  const bin = atob(clean);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(u8);
};

const NAMED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// builds a marked-up fragment with textContent only, so matched text can never inject markup
function highlight(text, re, className = 'match') {
  const frag = document.createDocumentFragment();
  let last = 0, m, guard = 0;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = rx.exec(text)) !== null) {
    if (++guard > 5000) break;
    if (m[0] === '') { rx.lastIndex++; continue; }
    frag.append(document.createTextNode(text.slice(last, m.index)));
    frag.append(el('span', { class: className, text: m[0] }));
    last = m.index + m[0].length;
  }
  frag.append(document.createTextNode(text.slice(last)));
  return frag;
}

const randInt = n => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
};

export const tools = {

  // ------------------------------------------------------------ word-counter
  'word-counter': async (root) => {
    const a = area(L('pasteOrTypeYourText', 'Paste or type your text here…'), '240px');
    const grid = el('div', { class: 'out' });
    const kwBox = el('div', { class: 'out' });
    const STOP = new Set('the a an and or but if then of to in on for with as at by from is are was were be been being it its this that these those not you your we our they their he she his her i'.split(' '));
    a.addEventListener('input', update);
    root.append(a, grid, kwBox);
    function update() {
      const s = a.value;
      const words = countWords(s);
      const chars = s.length;
      const noSpace = s.replace(/\s/g, '').length;
      const sentences = (s.match(/[^.!?…]+[.!?…]+/g) || []).length;
      const paragraphs = s.split(/\n{2,}/).filter(p => p.trim()).length;
      const lines = s ? s.split('\n').length : 0;
      const tokens = s.toLowerCase().match(/[\p{L}\p{N}’'-]+/gu) || [];
      const unique = new Set(tokens).size;
      grid.replaceChildren(
        stat(L('wordsOut', 'Words'), String(words), unique ? fmt(L('ui0Unique', '{0}% unique'), Math.round(unique / Math.max(1, words) * 100)) : ''),
        stat(L('charactersOut', 'Characters'), String(chars), fmt(L('ui0WithoutSpaces', '{0} without spaces'), noSpace)),
        stat(L('sentencesOut', 'Sentences'), String(sentences || (s.trim() ? 1 : 0)), ''),
        stat(L('lineCount', 'Lines'), String(lines), fmt(L('ui0Paragraphs', '{0} paragraphs'), paragraphs)),
        stat(L('readingTime', 'Reading time'), fmt(L('ui0MinutesShort', '{0} min'), words ? Math.max(1, Math.round(words / 200)) : 0), fmt(L('about0Wpm', '≈{0} wpm'), 200)),
        stat(L('speakingTime', 'Speaking time'), fmt(L('ui0MinutesShort', '{0} min'), words ? Math.max(1, Math.round(words / 130)) : 0), fmt(L('about0Wpm', '≈{0} wpm'), 130)),
        stat(L('averageWord', 'Average word'), words ? (chars / words).toFixed(1) : '—', L('characters', 'characters')));
      const freq = new Map();
      for (const w of tokens) {
        if (w.length < 4 || STOP.has(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
      const top = [...freq.entries()].filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1]).slice(0, 14);
      fill(kwBox,
        el('h3', { text: L('mostUsedWords', 'Most used words') }),
        top.length ? el('div', { class: 'badges' }, ...top.map(([w, n]) => el('span', { class: 'badge' }, w, el('b', { text: ` ${n}` })))) : note(L('typeAtLeastACouple', 'Type at least a couple of sentences to see word frequencies.')),
        top.length ? note(fmt(L('these0WordsMakeUp', 'These {0} words make up {1}% of all words used.'), top.length, Math.round(top.reduce((acc, x) => acc + x[1], 0) / Math.max(1, tokens.length) * 100))) : null);
    }
    update();
  },

  // ------------------------------------------------------------ case-converter
  'case-converter': async (root) => {
    const inA = area(L('typeOrPasteText', 'Type or paste text…'), '150px');
    const outA = area(''); outA.readOnly = true;
    let mode = 'upper';
    const splitWords = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
    const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'up', 'with']);
    const cases = {
      upper: s => s.toUpperCase(),
      lower: s => s.toLowerCase(),
      sentence: s => s.toLowerCase().replace(/(^\s*\p{L})|([.!?…]\s+\p{L})|(^"[A-Za-z])/gu, m => m.toUpperCase()),
      title: s => splitWords(s).map((w, i, arr) => (i > 0 && i < arr.length - 1 && SMALL.has(w.toLowerCase())) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
      every: s => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()),
      camel: s => splitWords(s).map((w, i) => i ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join(''),
      pascal: s => splitWords(s).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(''),
      snake: s => splitWords(s).map(w => w.toLowerCase()).join('_'),
      kebab: s => splitWords(s).map(w => w.toLowerCase()).join('-'),
      constant: s => splitWords(s).map(w => w.toUpperCase()).join('_'),
      alt: s => [...s].map((c, i) => i % 2 ? c.toLowerCase() : c.toUpperCase()).join(''),
      inverse: s => [...s].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('')
    };
    // one table for both the select and the stat line: the stat used to print the raw mode id
    // ("upper"), which is an internal key and shows up as untranslated English on a Japanese page
    const caseLabels = {
      upper: L('caseUpper', 'UPPERCASE'), lower: L('caseLower', 'lowercase'), sentence: L('sentenceCase', 'Sentence case'),
      title: L('titleCase', 'Title Case'), every: L('everyWordHere', 'Every Word Here'), camel: 'camelCase', pascal: 'PascalCase',
      snake: L('snake', 'snake_case'), kebab: L('kebab', 'kebab-case'), constant: 'CONSTANT_CASE',
      alt: L('altCase', 'aLtErNaTiNg'), inverse: L('inverse', 'iNVERSE cASE')
    };
    const render = () => {
      outA.value = (cases[mode] || cases.upper)(inA.value);
      stats(root, [[L('wordsOut', 'Words'), String(countWords(outA.value)), ''], [L('charactersOut', 'Characters'), String(outA.value.length), ''], [L('caseMode', 'Case'), caseLabels[mode] || L('upper2', 'upper'), '']]);
    };
    inA.addEventListener('input', render);
    root.append(
      field(L('caseMode', 'Case'), select(Object.entries(caseLabels), mode, v => { mode = v; render(); }), L('worksOnWholeTextOr', 'Works on whole text or a single identifier')),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('inputText', 'Input') }), inA),
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value)),
        el('div', { class: 'out' })));
    render();
  },

  // ------------------------------------------------------------ remove-duplicate-lines
  'remove-duplicate-lines': async (root) => {
    const inA = area(L('oneItemPerLine2', 'One item per line…'), '200px');
    const outA = area(''); outA.readOnly = true;
    let ignoreCase = false, trimSp = true, dropBlank = true, sort = 'none', keep = 'first', dupesOnly = false;
    const box = el('div', { class: 'out' });
    const render = () => {
      const lines = inA.value.split(/\r?\n/);
      const seen = new Map();
      const order = [];
      for (let raw of lines) {
        if (trimSp) raw = raw.trim();
        if (dropBlank && !raw) continue;
        const key = ignoreCase ? raw.toLowerCase() : raw;
        if (seen.has(key)) {
          const e = seen.get(key);
          e.n++;
          if (keep === 'last') e.v = raw;
        } else { seen.set(key, { v: raw, n: 1 }); order.push(key); }
      }
      let items = order.map(k => seen.get(k));
      if (dupesOnly) items = items.filter(i => i.n > 1);
      const cmp = (x, y) => x.v.localeCompare(y.v, undefined, { numeric: true });
      if (sort === 'asc') items.sort(cmp);
      if (sort === 'desc') items.sort((x, y) => cmp(y, x));
      if (sort === 'freq') items.sort((x, y) => y.n - x.n || cmp(x, y));
      outA.value = items.map(i => i.v).join('\n');
      const dupes = [...seen.values()].filter(i => i.n > 1);
      fill(box,
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'out' },
          stat(L('lineCount', 'Lines'), `${lines.length} → ${items.length}`, fmt(L('ui0Removed', '{0} removed'), Math.max(0, lines.length - items.length))),
          stat(L('keepUnique', 'Unique'), String(seen.size), dupes.length ? fmt(L('ui0AppearTwiceOrMore', '{0} appear twice or more'), dupes.length) : L('noRepeats', 'no repeats')),
          stat(L('longestLine', 'Longest line'), String(items.reduce((a, i) => Math.max(a, i.v.length), 0)), L('characters', 'characters'))),
        dupes.length ? el('div', { class: 'badges' }, ...dupes.slice(0, 40).map(d => el('span', { class: 'badge' }, (d.v.length > 30 ? d.v.slice(0, 30) + '…' : d.v) || '(blank)', el('b', { text: ` ×${d.n}` })))) : null,
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value),
          button('.txt', () => download(new Blob([outA.value], { type: 'text/plain' }), 'clean-lines.txt'), { kind: 'ghost' })));
    };
    inA.addEventListener('input', render);
    root.append(el('div', { class: 'field' }, el('span', { text: L('inputLines', 'Lines') }), inA),
      el('div', { class: 'controls' },
        el('span', {}, checkInput(L('ignoreCase', 'Ignore case'), false, v => { ignoreCase = v; render(); })),
        el('span', {}, checkInput(L('trimSpaces', 'Trim spaces'), true, v => { trimSp = v; render(); })),
        el('span', {}, checkInput(L('removeBlank', 'Remove empty lines'), true, v => { dropBlank = v; render(); })),
        field(L('sort', 'Sort'), select([['none', L('keepOriginalOrder', 'Keep original order')], ['asc', 'A → Z'], ['desc', 'Z → A'], ['freq', L('mostFrequentFirst', 'Most frequent first')]], 'none', v => { sort = v; render(); }), ''),
        field(L('keep', 'Keep'), select([['first', L('firstCopy', 'First copy')], ['last', L('lastCopy', 'Last copy')]], 'first', v => { keep = v; render(); }), L('onlyMattersForCaseInsensitive', 'Only matters for case-insensitive matches')),
        el('span', {}, checkInput(L('duplicatesOnly', 'Duplicates only'), false, v => { dupesOnly = v; render(); }))),
      box);
    render();
  },

  // ------------------------------------------------------------ lorem-ipsum-generator
  'lorem-ipsum-generator': async (root) => {
    const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum curabitur purus semper volutpat tortor nisl pretium fusce id velit'.split(' ');
    let paras = 3, perPara = 6, classic = true, asHtml = false, withHeading = false;
    const outA = area('', '260px'); outA.readOnly = true;
    const sentence = n => {
      const w = Array.from({ length: n }, () => WORDS[randInt(WORDS.length)]);
      if (n > 6) w.splice(randInt(n - 3) + 2, 0, w[randInt(w.length)] + ',');
      const s = w.join(' ');
      return s.charAt(0).toUpperCase() + s.slice(1) + '.';
    };
    const generate = () => {
      const blocks = [];
      for (let p = 0; p < paras; p++) {
        const sents = Array.from({ length: perPara }, () => sentence(6 + randInt(10)));
        if (p === 0 && classic) sents[0] = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
        blocks.push(sents.join(' '));
      }
      outA.value = asHtml
        ? (withHeading ? '<h1>Lorem ipsum dolor sit amet</h1>\n' : '') + blocks.map(b => `  <p>${b}</p>`).join('\n')
        : blocks.join('\n\n');
      stats(root, [[L('wordsOut', 'Words'), String(countWords(outA.value)), ''], [L('sentencesOut', 'Sentences'), String((outA.value.match(/[.!?](\s|$)/g) || []).length), ''], [L('charactersOut', 'Characters'), String(outA.value.length), '']]);
    };
    root.append(el('div', { class: 'controls' },
      field(L('paragraphs', 'Paragraphs'), numberInput(3, v => { paras = Math.min(50, Math.max(1, Number(v) || 1)); generate(); }, { min: 1, max: 50 }), ''),
      field(L('sentencesEach', 'Sentences each'), numberInput(6, v => { perPara = Math.min(25, Math.max(1, Number(v) || 1)); generate(); }, { min: 1, max: 25 }), ''),
      el('span', {}, checkInput(L('startWithLorem', 'Start with “Lorem ipsum…”'), true, v => { classic = v; generate(); })),
      el('span', {}, checkInput(L('wrapInParagraphs', 'Wrap in <p> tags'), false, v => { asHtml = v; generate(); })),
      el('span', {}, checkInput(L('addHeadingOne', 'Add an <h1> too'), false, v => { withHeading = v; generate(); }))),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'btn-row' }, button(L('regenerate', 'Regenerate'), generate, { kind: 'ghost' }), copyBtn(() => outA.value)),
        el('div', { class: 'out' })));
    generate();
  },

  // ------------------------------------------------------------ base64-encode-decode
  'base64-encode-decode': async (root) => {
    let dir = 'encode', urlSafe = false, wrap = false;
    const inA = area(L('pasteTextToEncodeOr', 'Paste text to encode, or base64 to decode…'), '180px');
    const outA = area(''); outA.readOnly = true;
    const err = el('div');
    const go = () => {
      err.replaceChildren();
      const s = inA.value;
      if (!s.trim()) { outA.value = ''; stats(root, [[L('inputCharacters', 'Input characters'), '0', ''], [L('outputCharacters', 'Output characters'), '0', '']]); return; }
      try {
        let v;
        if (dir === 'encode') {
          v = b64encode(s);
          if (urlSafe) v = v.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          if (wrap) v = v.replace(/(.{76})/g, '$1\n');
        } else {
          v = b64decode(s);
        }
        outA.value = v;
        stats(root, [[L('inputCharacters', 'Input characters'), String(s.length), ''], [L('outputCharacters', 'Output characters'), String(v.length), dir === 'encode' ? `+${Math.max(0, Math.round((v.length / Math.max(1, s.length) - 1) * 100))}%` : '']]);
      } catch (e) {
        outA.value = '';
        err.append(note(fmt(L('couldNotDecodeThis0', 'Could not decode this: {0}. Base64 length must not leave a single leftover character.'), e.message || e), 'err'));
      }
    };
    inA.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('direction', 'Direction'), select([['encode', L('textToBase64', 'Text → base64')], ['decode', L('base64Text', 'base64 → text')]], dir, v => { dir = v; go(); }), L('textIsTreatedAsUtf', 'Text is treated as UTF-8, so accents and CJK work')),
      el('span', {}, checkInput(L('urlSafeVariant', 'URL-safe (- and _, no padding)'), false, v => { urlSafe = v; go(); })),
      el('span', {}, checkInput(L('wrapAt76', 'Wrap at 76 characters'), false, v => { wrap = v; go(); }))),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('inputText', 'Input') }), inA),
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value)),
        err, el('div', { class: 'out' })));
    go();
  },

  // ------------------------------------------------------------ url-encode-decode
  'url-encode-decode': async (root) => {
    let dir = 'encode', scope = 'component', plus = false;
    const inA = area('https://example.com/search?q=hello world&lang=中文', '160px');
    const outA = area(''); outA.readOnly = true;
    const detail = el('div');
    const SAFE = /^[A-Za-z0-9\-_.~]$/;
    const encAll = s => [...new TextEncoder().encode(s)]
      .map(b => SAFE.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '%' + b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const go = () => {
      detail.replaceChildren();
      const s = inA.value;
      if (!s.trim()) { outA.value = ''; return; }
      try {
        if (dir === 'encode') {
          outA.value = scope === 'component' ? encodeURIComponent(s)
            : scope === 'query' ? s.replace(/[&=?#]/g, c => encodeURIComponent(c))
            : scope === 'full' ? encAll(s) : encodeURI(s);
          if (plus && scope !== 'full') outA.value = outA.value.replace(/%20/g, '+');
        } else {
          const tmp = scope === 'query' ? s.replace(/\+/g, ' ') : s;
          outA.value = decodeURIComponent(tmp.replace(/%(?![0-9a-fA-F]{2})/g, '%25'));
        }
      } catch (e) {
        outA.value = '';
        detail.append(note(fmt(L('cannotDecode0AMust', 'Cannot decode: {0}. A % must be followed by exactly two hex digits.'), e.message || e), 'err'));
        return;
      }
      if (dir === 'decode' && scope !== 'full') {
        try {
          const u = new URL(outA.value);
          const kv = el('div', { class: 'kv' });
          for (const [k, v] of [['protocol', u.protocol], ['host', u.host], ['path', decodeURIComponent(u.pathname)], ['hash', u.hash || '—']]) {
            kv.append(el('span', { class: 'k', text: k }), el('code', { text: v }));
          }
          const q = [...u.searchParams.entries()];
          if (q.length) kv.append(el('span', { class: 'k', text: L('queryPart', 'query') }), el('div', {}, ...q.map(([n, v]) => el('div', { class: 'check' }, el('code', { text: `${n} = ${v}` })))));
          detail.append(el('h3', { text: L('thisUrlMeans', 'This URL means') }), kv);
        } catch { /* the result is not a URL, which is perfectly normal */ }
      }
    };
    inA.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('direction', 'Direction'), select([['encode', L('encode', 'Encode')], ['decode', L('decode', 'Decode')]], dir, v => { dir = v; go(); }), ''),
      field(L('scope', 'Scope'), select([['component', L('queryValueScope', 'Query value (also escapes & = ? #)')], ['query', L('queryStringScope', 'Query string (keeps & = ?)')], ['uri', L('wholeUrlScope', 'Whole URL (keeps structure)')], ['full', L('strictAsciiScope', 'Everything except A–Z a–z 0–9 -_.~')]], scope, v => { scope = v; go(); }), ''),
      el('span', {}, checkInput(L('plusForSpaces', 'Use + for spaces'), false, v => { plus = v; go(); }))),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('inputText', 'Input') }), inA),
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value)),
        detail));
    go();
  },

  // ------------------------------------------------------------ html-entities
  'html-entities': async (root) => {
    let dir = 'escape', style = 'named', all = false;
    const inA = area('<div class="a">Tom & Jerry’s “café” — 5 > 3</div>', '160px');
    const outA = area(''); outA.readOnly = true;
    const err = el('div');
    const go = () => {
      err.replaceChildren();
      const s = inA.value;
      if (!s) { outA.value = ''; return; }
      if (dir === 'escape') {
        outA.value = s.replace(/[&<>"']/g, c => style === 'named' ? NAMED[c] : `&#${c.charCodeAt(0)};`);
        if (all) outA.value = outA.value.replace(/[^\x20-\x7E]/gu, c => `&#${c.codePointAt(0)};`);
      } else {
        // let the browser's own entity table handle the thousands of named entities
        const doc = new DOMParser().parseFromString(`<i>${s.replace(/<(?!\/?i>)/g, '')}</i>`, 'text/html');
        outA.value = doc.querySelector('i')?.textContent ?? '';
      }
      stats(root, [[L('inputCharacters', 'Input characters'), String(s.length), ''], [L('outputCharacters', 'Output characters'), String(outA.value.length), '']]);
    };
    inA.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('direction', 'Direction'), select([['escape', L('escapeForHtml', 'Escape for HTML')], ['unescape', L('unescapeEntities', 'Unescape entities')]], dir, v => { dir = v; go(); }), L('escapeBeforePuttingTextInside', 'Escape before putting text inside HTML')),
      field(L('style', 'Style'), select([['named', '&amp; &lt; &gt;'], ['numeric', '&#38; &#60; &#62;']], style, v => { style = v; go(); }), ''),
      el('span', {}, checkInput(L('encodeAccents', 'Also encode accents & emoji'), false, v => { all = v; go(); }))),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('inputText', 'Input') }), inA),
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value)),
        err, el('div', { class: 'out' })));
    go();
  },

  // ------------------------------------------------------------ reverse-text
  'reverse-text': async (root) => {
    const inA = area(L('typeSomething', 'Type something…'), '150px');
    const outA = area(''); outA.readOnly = true;
    let mode = 'chars';
    // grapheme reversal keeps emoji and accents intact instead of splitting them apart
    const seg = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    const go = () => {
      const s = inA.value;
      if (mode === 'chars') outA.value = (seg ? [...seg.segment(s)].map(x => x.segment).reverse().join('') : [...s].reverse().join(''));
      else if (mode === 'words') outA.value = s.split(/\s+/).filter(Boolean).reverse().join(' ');
      else if (mode === 'lines') outA.value = s.split(/\r?\n/).reverse().join('\n');
      else if (mode === 'sentences') outA.value = (s.match(/[^.!?…]+[.!?…]*/g) || []).map(x => x.trim()).reverse().join(' ');
      else if (mode === 'letters-words') outA.value = [...s].reverse().join('').split(/\s+/).reverse().join(' ');
    };
    inA.addEventListener('input', go);
    root.append(field(L('reverse', 'Reverse'), select([['chars', L('byCharacters', 'Characters (keeps emoji whole)')], ['words', L('byWords', 'Word order')], ['lines', L('byLines', 'Line order')], ['sentences', L('bySentences', 'Sentence order')], ['letters-words', L('lettersPerWord', 'Letters, word by word')]], mode, v => { mode = v; go(); }), ''),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('inputText', 'Input') }), inA),
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value))));
    go();
  },

  // ------------------------------------------------------------ json-formatter
  'json-formatter': async (root) => {
    const inA = area('{"paste":"your JSON here","list":[1,2,3]}', '210px');
    const outA = area(''); outA.readOnly = true; outA.style.minHeight = '210px';
    let indent = '2', sortKeys = false, minify = false;
    const msg = el('div');
    const walk = (v, fn) => {
      if (Array.isArray(v)) return v.map(x => walk(x, fn));
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, fn)]));
      return fn(v);
    };
    const count = v => {
      let keys = 0, vals = 0, depth = 1, arrs = 0;
      const rec = (x, d) => {
        depth = Math.max(depth, d);
        if (Array.isArray(x)) { arrs++; x.forEach(i => rec(i, d + 1)); }
        else if (x && typeof x === 'object') { for (const [k, i] of Object.entries(x)) { keys++; rec(i, d + 1); } }
        else vals++;
      };
      rec(v, 1);
      return { keys, vals, depth, arrs };
    };
    const go = () => {
      msg.replaceChildren();
      const s = inA.value.trim();
      if (!s) { outA.value = ''; return; }
      let data;
      try {
        data = JSON.parse(s);
      } catch (e) {
        outA.value = '';
        const m2 = /position (\d+)/.exec(e.message);
        const pos = m2 ? Number(m2[1]) : -1;
        const line = pos >= 0 ? s.slice(0, pos).split('\n').length : 0;
        // e.message comes from JSON.parse and stays English — the browser wrote it, not us
        msg.append(note(`${L('notValidJson', 'Not valid JSON')}${line ? fmt(L('aroundLine0', ' around line {0}'), line) : ''}: ${e.message}`, 'err'));
        if (pos >= 0) {
          const lines = s.split('\n');
          msg.append(el('pre', { class: 'diff-view', text: fmt(L('ui012Here', '{0}: {1}\n{2}^ here'), line, lines[line - 1] || '', ' '.repeat(Math.max(0, pos - (lines.slice(0, line - 1).join('\n').length) + (line - 1)))) }));
        }
        return;
      }
      if (sortKeys) {
        const rec = x => Array.isArray(x) ? x.map(rec)
          : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, rec(x[k])])) : x;
        data = rec(data);
      }
      const pad = minify ? 0 : indent === 'tab' ? '\t' : Number(indent);
      outA.value = JSON.stringify(data, null, pad) ?? 'undefined';
      const c = count(data);
      stats(root, [[L('validJson', 'Valid JSON'), L('yes', 'yes'), ''], [L('keys', 'Keys'), String(c.keys), fmt(L('ui0Arrays', '{0} arrays'), c.arrs)], [L('depth', 'Depth'), String(c.depth), fmt(L('ui0LeafValues', '{0} leaf values'), c.vals)], [L('size', 'Size'), fmt(L('ui0Chars', '{0} chars'), outA.value.length.toLocaleString(locale())), '']]);
    };
    inA.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('indent', 'Indent'), select([['2', L('ui2Spaces', '2 spaces')], ['4', L('ui4Spaces', '4 spaces')], ['tab', L('tabIndent', 'Tab')]], indent, v => { indent = v; go(); }), ''),
      el('span', {}, checkInput(L('sortKeys', 'Sort keys'), false, v => { sortKeys = v; go(); })),
      el('span', {}, checkInput(L('minify', 'Minify'), false, v => { minify = v; go(); }))),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('inputJson', 'JSON input') }), inA),
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value),
          button('.json', () => outA.value && download(new Blob([outA.value], { type: 'application/json' }), 'formatted.json'), { kind: 'ghost' })),
        msg, el('div', { class: 'out' })));
    go();
  },

  // ------------------------------------------------------------ csv-to-json
  'csv-to-json': async (root) => {
    const inA = area(L('nameCityAgeAdaLondon', 'name,city,age\nAda,London,36\nGrace,New York,45'), '170px');
    const outA = area(''); outA.readOnly = true; outA.style.minHeight = '200px';
    let delim = ',', header = true, out = 'array', numeric = true;
    const err = el('div');
    const tableBox = el('div');
    const go = () => {
      err.replaceChildren();
      const s = inA.value;
      if (!s.trim()) { outA.value = ''; tableBox.replaceChildren(); return; }
      const { header: head, rows } = parseCsv(s, { delimiter: delim, header });
      if (!rows.length) { err.append(note(L('noDataRowsWereFound', 'No data rows were found — only a header line.'), 'err')); return; }
      const coerce = v => {
        if (!numeric || typeof v !== 'string') return v;
        const t2 = v.trim();
        if (t2 === '') return null;
        if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t2)) return Number(t2);
        if (t2 === 'true' || t2 === 'false') return t2 === 'true';
        return v;
      };
      const data = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, coerce(v)])));
      outA.value = out === 'object'
        ? JSON.stringify(Object.fromEntries(data.map((d, i) => [head[i] || i, d])), null, 2)
        : out === 'lines' ? data.map(d => JSON.stringify(d)).join('\n')
        : JSON.stringify(data, null, 2);
      stats(root, [[L('rows', 'Rows'), String(rows.length), ''], [L('columns', 'Columns'), String(head.length), ''], [L('delimitedBy', 'Delimited by'), delim === ',' ? L('comma2', 'comma') : delim === '\t' ? L('tab', 'tab') : delim === ';' ? L('semicolon2', 'semicolon') : `'${delim}'`, '']]);
      // preview the first rows as a real table so misaligned quoting is obvious
      const cols = head.length ? head : Object.keys(data[0] || {});
      const thead = el('tr', {}, ...cols.map(c => el('th', { text: String(c) })));
      const tb = el('table', { class: 'result-card', style: 'width:100%;border-collapse:collapse;font-size:13px' },
        el('thead', {}, thead),
        el('tbody', {}, ...data.slice(0, 8).map(r => el('tr', {}, ...cols.map(c => el('td', { text: r[c] === null || r[c] === undefined ? '' : String(r[c]), style: 'padding:4px 8px;border-top:1px solid var(--line)' }))))));
      fill(tableBox, el('h3', { text: L('preview', 'Preview') }), tb, rows.length > 8 ? note(fmt(L('showing8Of0Rows', 'Showing 8 of {0} rows.'), rows.length)) : null);
    };
    inA.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('delimiter', 'Delimiter'), select([[',', L('comma', 'Comma')], [';', L('semicolon', 'Semicolon')], ['\t', L('tabIndent', 'Tab')], ['|', L('pipe', 'Pipe')]], delim, v => { delim = v; go(); }), L('excelInManyRegionsExports', 'Excel in many regions exports semicolons')),
      el('span', {}, checkInput(L('hasHeader', 'First row is a header'), true, v => { header = v; go(); })),
      el('span', {}, checkInput(L('convertScalars', 'Convert numbers & booleans'), true, v => { numeric = v; go(); })),
      field(L('output', 'Output'), select([['array', L('jsonArray', 'JSON array')], ['object', L('objectKeyedByRow', 'Object keyed by row')], ['lines', L('jsonLines', 'JSON Lines')]], out, v => { out = v; go(); }), '')),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('inputCsv', 'CSV') }), inA),
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value),
          button('.json', () => outA.value && download(new Blob([outA.value], { type: 'application/json' }), 'data.json'), { kind: 'ghost' })),
        err, tableBox, el('div', { class: 'out' })));
    go();
  },

  // ------------------------------------------------------------ markdown-to-html
  'markdown-to-html': async (root) => {
    const inA = area('# Title\n\nSome **bold** and a [link](https://example.com).\n\n- item one\n- item two\n\n> a quote', '200px');
    const outA = area(''); outA.readOnly = true; outA.style.minHeight = '200px';
    let gfm = true, breaks = false, headingIds = false;
    const preview = el('div', { class: 'prose result-card' });
    const err = el('div');
    const go = async () => {
      err.replaceChildren();
      let marked;
      try { marked = await loadLib('marked'); }
      catch { err.append(note(L('theMarkdownLibraryCouldNot', 'The Markdown library could not be loaded.'), 'err')); return; }
      const parse = marked.parse || marked.default?.parse;
      if (!parse) { err.append(note(L('unexpectedMarkedBuild', 'Unexpected marked build.'), 'err')); return; }
      let html;
      try {
        html = parse(inA.value, { gfm, breaks });
      } catch (e) {
        err.append(note(fmt(L('couldNotRender0', 'Could not render: {0}'), e.message || e), 'err'));
        return;
      }
      if (headingIds) {
        const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
        doc.body.querySelectorAll('h1,h2,h3,h4').forEach(h => { h.id = h.textContent.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, ''); });
        html = doc.body.innerHTML;
      }
      html = html.trim();
      outA.value = html;
      preview.textContent = '';
      // DOMPurify is not vendored, so strip the vectors that matter before injecting
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
      doc.body.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove());
      doc.body.querySelectorAll('*').forEach(n => {
        for (const a of [...n.attributes]) {
          if (/^on/i.test(a.name)) n.removeAttribute(a.name);
          if ((a.name === 'href' || a.name === 'src') && /^\s*(javascript|data:text\/html)/i.test(a.value)) n.removeAttribute(a.name);
        }
      });
      preview.append(...[...doc.body.childNodes].map(n => document.importNode(n, true)));
      stats(root, [[L('htmlCharacters', 'HTML characters'), String(html.length), ''], [L('wordsRendered', 'Words rendered'), String(countWords(preview.textContent)), ''], [L('headings', 'Headings'), String(preview.querySelectorAll('h1,h2,h3,h4,h5,h6').length), '']]);
    };
    inA.addEventListener('input', () => go());
    root.append(el('div', { class: 'controls' },
      el('span', {}, checkInput(L('githubFlavour', 'GitHub flavour (tables, strikethrough)'), true, v => { gfm = v; go(); })),
      el('span', {}, checkInput(L('singleNewlineBreak', 'Single newline = <br>'), false, v => { breaks = v; go(); })),
      el('span', {}, checkInput(L('headingIds', 'Add id to headings'), false, v => { headingIds = v; go(); }))),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('inputMarkdown', 'Markdown') }), inA),
        el('h3', { text: L('htmlOut', 'HTML') }), outA,
        el('div', { class: 'btn-row' }, copyBtn(() => outA.value),
          button('.html', () => outA.value && download(new Blob([outA.value], { type: 'text/html' }), 'rendered.html'), { kind: 'ghost' })),
        err, el('h3', { text: L('preview', 'Preview') }), preview, el('div', { class: 'out' })));
    go();
  },

  // ------------------------------------------------------------ hash-generator
  'hash-generator': async (root) => {
    let text = '', file = null, algo = 'SHA-256', upper = false, hex = true;
    const ALGOS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
    const inA = area(L('textToHash', 'Text to hash…'), '130px');
    const out = el('div', { class: 'out' });
    const show = (map, label) => {
      out.replaceChildren(...Object.entries(map).map(([a, h]) => el('div', { class: 'result-card' },
        el('span', { class: 'k', text: a }), el('code', { text: upper ? h.toUpperCase() : h, style: 'word-break:break-all;flex:1' }),
        copyBtn(() => upper ? h.toUpperCase() : h))));
      if (label) out.prepend(note(label));
    };
    const compute = async () => {
      const list = algo === 'ALL' ? ALGOS : [algo];
      try {
        const map = {};
        for (const a of list) {
          if (a === 'MD5') {
            if (file) throw new Error(L('md5IsImplementedForText', 'MD5 is implemented for text only'));
            map[a] = md5(text);
          } else {
            map[a] = file ? await digestFile(file, a) : await digest(text, a);
          }
        }
        if (!hex) {
          for (const [a, h] of Object.entries(map)) {
            let s = '';
            for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
            map[a] = btoa(s);
          }
        }
        show(map, file ? `${file.name} · ${fmt(L('ui0Bytes', '{0} bytes'), file.size.toLocaleString(locale()))}` : fmt(L('ui0Characters', '{0} characters'), text.length.toLocaleString(locale())));
      } catch (e) {
        out.replaceChildren(note(fmt(L('couldNotHash0Web', 'Could not hash: {0}. Web Crypto hashes need an https or localhost page.'), e.message || e), 'err'));
      }
    };
    const opts = el('div', { class: 'controls' },
      field(L('algorithm', 'Algorithm'), select([...ALGOS.map(a => [a, a]), ['ALL', L('allFourShaSizes', 'All four SHA sizes')], ['MD5', L('md5LegacyNotSecure', 'MD5 — legacy, not secure')]], algo, v => { algo = v; compute(); }), L('md5AndSha1Are', 'MD5 and SHA-1 are for checksums only')),
      el('span', {}, checkInput(L('upper', 'UPPERCASE'), false, v => { upper = v; compute(); })),
      el('span', {}, checkInput(L('base64Output', 'Base64 instead of hex'), false, v => { hex = v; compute(); })));
    fileZoneHash(root, f => { file = f; inA.disabled = true; compute(); });
    inA.addEventListener('input', () => { text = inA.value; if (file) { file = null; inA.disabled = false; } compute(); });
    root.append(el('div', { class: 'field' }, el('span', { text: L('inputOrFile', 'Text or file') }), inA), opts, out);
    compute();
  },

  // ------------------------------------------------------------ uuid-generator
  'uuid-generator': async (root) => {
    let version = '4', count = 10, upper = false, hyphens = true, braces = false;
    const out = area('', '240px'); out.readOnly = true;
    const rnd = n => {
      const b = new Uint8Array(n);
      crypto.getRandomValues(b);
      return b;
    };
    const v4 = () => {
      if (crypto.randomUUID) return crypto.randomUUID();
      const b = rnd(16);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
    // v7 = 48-bit unix ms + random, so ids sort by creation time
    const v7 = () => {
      const b = rnd(16);
      let ms = BigInt(Date.now());
      for (let i = 5; i >= 0; i--) { b[i] = Number(ms & 0xffn); ms >>= 8n; }
      const hex1 = [...b].map(x => x.toString(16).padStart(2, '0'));
      hex1[6] = ((parseInt(hex1[6], 16) & 0x0f) | 0x70).toString(16).padStart(2, '0');
      hex1[8] = ((parseInt(hex1[8], 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
      const h = hex1.join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
    const v1 = () => {
      // time-ish layout with a random node: good enough for uniqueness, not for spec tests
      const b = rnd(16);
      const t = BigInt(Date.now()) * 10000n + 122192928000000000n;
      const hex = [...b].map(x => x.toString(16).padStart(2, '0'));
      const ts = t.toString(16).padStart(16, '0');
      hex[0] = ts.slice(6, 8); hex[1] = ts.slice(4, 6); hex[2] = ts.slice(2, 4); hex[3] = ts.slice(0, 2);
      hex[4] = ts.slice(12, 14); hex[5] = ts.slice(10, 12); hex[6] = ts.slice(14, 16); hex[7] = '0';
      hex[8] = ((parseInt(hex[8], 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
      const h = hex.join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
    const make = () => {
      const n = Math.min(1000, Math.max(1, Number(count) || 1));
      const gen = version === '7' ? v7 : version === '1' ? v1 : v4;
      const list = Array.from({ length: n }, gen).map(u => {
        let s = hyphens ? u : u.replace(/-/g, '');
        if (upper) s = s.toUpperCase();
        if (braces) s = `{${s}}`;
        return s;
      });
      out.value = list.join('\n');
      stats(root, [[L('generated', 'Generated'), String(list.length), version === '4' ? L('randomRfc4122', 'random (RFC 4122)') : version === '7' ? L('timeOrdered', 'time-ordered') : L('timeIsh', 'time-ish')], [L('keepUnique', 'Unique'), String(new Set(list).size), ''], [L('charactersOut', 'Characters'), String(out.value.length), '']]);
    };
    root.append(el('div', { class: 'controls' },
      field(L('version', 'Version'), select([['4', L('v4Random', 'v4 — random')], ['7', L('v7SortableByTime', 'v7 — sortable by time')], ['1', L('v1TimeIsh', 'v1 — time-ish')]], version, v => { version = v; make(); }), L('v4IsTheSafeDefault', 'v4 is the safe default')),
      field(L('quantity', 'How many'), numberInput(10, v => { count = Number(v) || 1; make(); }, { min: 1, max: 1000 }), L('max1000', 'max 1000')),
      el('span', {}, checkInput(L('upper', 'UPPERCASE'), false, v => { upper = v; make(); })),
      el('span', {}, checkInput(L('noHyphens', 'No hyphens'), false, v => { hyphens = !v; make(); })),
      el('span', {}, checkInput(L('wrapInBraces', 'Wrap in {braces}'), false, v => { braces = v; make(); }))),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), out),
        el('div', { class: 'btn-row' }, button(L('regenerate', 'Regenerate'), make, { kind: 'ghost' }), copyBtn(() => out.value),
          button('.txt', () => download(new Blob([out.value], { type: 'text/plain' }), 'uuids.txt'), { kind: 'ghost' })),
        el('div', { class: 'out' })));
    make();
  },

  // ------------------------------------------------------------ password-generator
  'password-generator': async (root) => {
    let len = 16, sets = { upper: true, lower: true, digits: true, symbols: true }, noAmbig = false, count = 5;
    const out = area('', '190px'); out.readOnly = true;
    const GROUPS = {
      upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      lower: 'abcdefghijkmnopqrstuvwxyz',
      digits: '23456789',
      symbols: '!@#$%^&*()-_=+[]{};,.?'
    };
    const FULL = {
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      lower: 'abcdefghijklmnopqrstuvwxyz',
      digits: '0123456789',
      symbols: '!@#$%^&*()-_=+[]{};,.?'
    };
    const makeOne = () => {
      const pool = Object.keys(sets).filter(k => sets[k]).map(k => (noAmbig ? GROUPS[k] : FULL[k])).join('');
      if (!pool) return '';
      const bytesOf = new Uint32Array(len);
      crypto.getRandomValues(bytesOf);
      // rejection-free enough for a browser tool: modulo bias on a 32-bit draw is negligible here
      const chars = [...bytesOf].map(x => pool[x % pool.length]);
      // guarantee one character from every chosen set
      const chosen = Object.keys(sets).filter(k => sets[k]);
      chosen.forEach((k, i) => {
        const g = noAmbig ? GROUPS[k] : FULL[k];
        const b = new Uint32Array(1);
        crypto.getRandomValues(b);
        chars[i % chars.length] = g[b[0] % g.length];
      });
      for (let i = chars.length - 1; i > 0; i--) {
        const b = new Uint32Array(1);
        crypto.getRandomValues(b);
        const j = b[0] % (i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
      return chars.join('');
    };
    const strength = () => {
      const pool = Object.keys(sets).filter(k => sets[k]).reduce((a, k) => a + (noAmbig ? GROUPS[k].length : FULL[k].length), 0);
      const bits = len * Math.log2(Math.max(2, pool));
      const label = bits < 40 ? L('weak', 'weak') : bits < 60 ? L('okayForLowValueAccounts', 'okay for low-value accounts') : bits < 90 ? L('strong', 'strong') : L('veryStrong', 'very strong');
      const crack = bits < 20 ? L('instantly', 'instantly') : fmt(L('ui0YearsAtATrillionGuessesPerSecond', '~{0} years at a trillion guesses per second'), (2 ** Math.max(0, bits - 34) / 1e6).toExponential(1));
      return { pool, bits, label, crack };
    };
    const make = () => {
      const n = Math.min(50, Math.max(1, Number(count) || 1));
      const list = Array.from({ length: n }, makeOne);
      out.value = list.filter(Boolean).join('\n');
      const st = strength();
      stats(root, [[L('length', 'Length'), String(len), fmt(L('pool0Characters', 'pool {0} characters'), st.pool)], [L('entropy', 'Entropy'), fmt(L('ui0Bits', '{0} bits'), st.bits.toFixed(1)), st.label], [L('bruteForce', 'Brute force'), st.crack, '']]);
      if (!st.pool) out.value = '';
    };
    root.append(el('div', { class: 'controls' },
      field(L('length', 'Length'), numberInput(16, v => { len = Math.min(128, Math.max(4, Number(v) || 16)); make(); }, { min: 4, max: 128 }), L('ui16IsAGoodDefault', '16 is a good default')),
      field(L('quantity', 'How many'), numberInput(5, v => { count = Number(v) || 5; make(); }, { min: 1, max: 50 }), ''),
      el('span', {}, checkInput('A–Z', true, v => { sets.upper = v; make(); })),
      el('span', {}, checkInput('a–z', true, v => { sets.lower = v; make(); })),
      el('span', {}, checkInput('0–9', true, v => { sets.digits = v; make(); })),
      el('span', {}, checkInput(L('symbolsOption', '!@# symbols'), true, v => { sets.symbols = v; make(); })),
      el('span', {}, checkInput(L('avoidConfusable', 'Avoid confusing characters (Il1O0)'), false, v => { noAmbig = v; make(); }))),
      el('div', { class: 'out' },
        el('div', { class: 'field' }, el('span', { text: L('passwordsOut', 'Passwords') }), out),
        el('div', { class: 'btn-row' }, button(L('regenerate', 'Regenerate'), make, { kind: 'ghost' }),
          button(L('copyFirst', 'Copy first'), () => out.value.split('\n')[0] ? copyText(out.value.split('\n')[0]) : toast(L('nothingGenerated', 'Nothing generated')), { kind: 'ghost' })),
        note(L('generatedWithTheBrowserCryptographic', 'Generated with the browser cryptographic random number generator. Nothing is stored or sent; for shared secrets use a password manager.')),
        el('div', { class: 'out' })));
    make();
  },

  // ------------------------------------------------------------ regex-tester
  'regex-tester': async (root) => {
    // the sample text is on screen (the highlighted result quotes it back), so it is UI copy; the two
    // addresses have to survive translation or the default email pattern finds nothing to show
    let pattern = '\\b\\w+@\\w+\\.\\w+\\b', flags = 'g', subject = L('sampleContactAdaOr', 'Contact ada@example.com or grace@example.org for details.');
    const patIn = textInput(pattern, v => { pattern = v; go(); }, 'text');
    patIn.setAttribute('spellcheck', 'false');
    patIn.style.fontFamily = 'var(--mono)';
    const flagIn = textInput(flags, v => { flags = v.replace(/[^gimsuy]/g, ''); go(); }, 'text');
    flagIn.style.width = '90px';
    const subj = area('', '140px'); subj.value = subject;
    const msg = el('div');
    const hits = el('div', { class: 'out' });
    const repl = area('$1', '60px');
    // id · dropdown label · pattern. The label is a dictionary string because the visitor reads it,
    // and the id is what the <option> value carries — a label that changes with the page language
    // cannot be the thing the change handler looks up.
    const PRESETS = [
      ['email', L('presetEmail', 'Email'), '[\\w.+-]+@[\\w-]+\\.[\\w.]+'],
      ['url', L('presetUrl', 'URL'), 'https?://[^\\s]+'],
      ['ipv4', L('presetIpv4Address', 'IPv4'), '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b'],
      ['date', L('presetDate', 'Date YYYY-MM-DD'), '\\b\\d{4}-(?:0[1-9]|1[0-2])-(?:[0-2]\\d|3[01])\\b'],
      ['hex', L('presetHexColour', 'Hex colour'), '#(?:[0-9a-fA-F]{3}){1,2}\\b'],
      ['phone', L('presetPhoneLoose', 'Phone (loose)'), '\\+?\\d[\\d\\s().-]{7,}\\d'],
      ['slug', L('presetSlug', 'Slug'), '^[a-z0-9]+(?:-[a-z0-9]+)*$'],
      ['html', L('presetHtmlTag', 'HTML tag'), '<\\/?([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*>'],
      ['password', L('presetPasswordMixed', 'Password ≥8 mixed'), '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$']
    ];
    let re = null;
    const go = () => {
      msg.replaceChildren(); hits.replaceChildren();
      subject = subj.value;
      if (!pattern) { msg.append(note(L('typeAPatternToTest', 'Type a pattern to test.'))); return; }
      try {
        re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
      } catch (e) {
        re = null;
        msg.append(note(fmt(L('invalidPattern0', 'Invalid pattern: {0}'), e.message), 'err'));
        return;
      }
      const matches = [];
      let m, guard = 0;
      while ((m = re.exec(subject)) !== null) {
        if (++guard > 5000) { msg.append(note(L('stoppedAfter5000MatchesThe', 'Stopped after 5000 matches — the pattern may match empty strings everywhere.'), 'err')); break; }
        if (m[0] === '') { re.lastIndex++; continue; }
        matches.push({ at: m.index, text: m[0], groups: m.slice(1), named: m.groups || {} });
      }
      stats(root, [[L('matches', 'Matches'), String(matches.length), flags.includes('g') ? '' : L('addTheGFlagTo', 'add the g flag to find more than one')],
        [L('subject', 'Subject'), fmt(L('ui0Chars', '{0} chars'), subject.length), fmt(L('ui0Lines', '{0} lines'), subject.split('\n').length)]]);
      hits.append(el('h3', { text: L('highlighted', 'Highlighted') }),
        el('div', { class: 'result-card', style: 'white-space:pre-wrap;font-family:var(--mono);font-size:13px;line-height:1.6' }, highlight(subject, re)));
      if (matches.length) {
        const rows = matches.slice(0, 60).map((x, i) => el('div', { class: 'result-card', style: 'display:flex;gap:12px;flex-wrap:wrap;font-size:13px' },
          el('b', { text: `#${i + 1}` }), el('code', { text: x.text }), el('span', { class: 'sz', text: fmt(L('at0', 'at {0}'), x.at) }),
          x.groups.length ? el('span', { class: 'delta', text: fmt(L('groups0', 'groups: {0}'), x.groups.map(g => g === undefined ? '∅' : JSON.stringify(g)).join(', ')) }) : null));
        add(hits, el('h3', { text: L('matches', 'Matches') }), ...rows, matches.length > 60 ? note(fmt(L('showing60Of0', 'Showing 60 of {0}.'), matches.length)) : null);
      } else {
        hits.append(note(L('noMatchTryRemovingAnchors', 'No match. Try removing anchors (^ $) or the case-sensitive flag.')));
      }
      try {
        const out2 = subject.replace(re, repl.value);
        hits.append(el('h3', { text: L('replaceWith', 'Replace with') }), area('', '80px'));
        const shown = hits.lastElementChild;
        shown.value = out2; shown.readOnly = true;
        if (out2 !== subject) shown.classList.add('ok');
      } catch (e) {
        msg.append(note(fmt(L('replacementFailed0', 'Replacement failed: {0}'), e.message), 'err'));
      }
    };
    subj.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('pattern', 'Pattern'), patIn, L('writtenAsPattern', 'written as /pattern/')),
      field(L('flags', 'Flags'), flagIn, 'g i m s u y'),
      field(L('examples', 'Examples'), select(PRESETS.map(p => [p[0], p[1]]), '', v => { const hit = PRESETS.find(p => p[0] === v); if (hit) { patIn.value = pattern = hit[2]; go(); } }), L('commonRecipes', 'common recipes')))
      , el('div', { class: 'field' }, el('span', { text: L('testString', 'Test string') }), subj),
      el('div', { class: 'field' }, el('span', { text: L('replacement', 'Replacement') }), repl), msg, hits);
    go();
  },

  // ------------------------------------------------------------ diff-checker
  'diff-checker': async (root) => {
    const a = area(L('firstLineSecondLineThird', 'First line\nSecond line\nThird line'), '200px');
    const b = area(L('firstLineSecondOneThird', 'First line\nSecond one\nThird line\nFourth line'), '200px');
    const out = el('div', { class: 'out' });
    let onlyDiff = false, ignoreWs = false, ignoreCase = false;
    const go = () => {
      const norm = s => s.split('\n').map(l => (ignoreCase ? l.toLowerCase() : l)).map(l => ignoreWs ? l.trim().replace(/\s+/g, ' ') : l);
      const rows = diffLines(norm(a.value).join('\n'), norm(b.value).join('\n'));
      const adds = rows.filter(r => r.t === 'add').length;
      const dels = rows.filter(r => r.t === 'del').length;
      const shown = onlyDiff ? rows.filter(r => r.t !== 'same') : rows;
      fill(out,
        el('div', { class: 'out' }, stat(L('changedLines', 'Changed lines'), String(adds + dels), fmt(L('ui0Added1Removed', '{0} added · {1} removed'), adds, dels)), stat(L('identical', 'Identical'), String(rows.length - adds - dels), L('lines', 'lines'))),
        el('div', { class: 'diff-view' }, ...shown.map(r => {
          const sign = r.t === 'add' ? '+' : r.t === 'del' ? '−' : ' ';
          return el('div', { class: r.t === 'same' ? '' : r.t === 'add' ? 'diff-add' : 'diff-del' }, el('span', { class: 'sz', text: sign }), ` ${r.v}`);
        })),
        !shown.length ? note(onlyDiff ? L('noDifferencesBothSidesMatch', 'No differences — both sides match.') : L('nothingToCompareYet', 'Nothing to compare yet.')) : null);
    };
    a.addEventListener('input', go); b.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      el('span', {}, checkInput(L('onlyDiff', 'Show changed lines only'), false, v => { onlyDiff = v; go(); })),
      el('span', {}, checkInput(L('ignoreEdgeSpaces', 'Ignore leading/trailing spaces'), false, v => { ignoreWs = v; go(); })),
      el('span', {}, checkInput(L('ignoreCase', 'Ignore case'), false, v => { ignoreCase = v; go(); }))),
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:14px' },
        el('div', { class: 'field' }, el('span', { text: L('left', 'Original') }), a),
        el('div', { class: 'field' }, el('span', { text: L('right', 'Changed') }), b)), out);
    go();
  },

  // ------------------------------------------------------------ text-to-speech
  'text-to-speech': async (root) => {
    const a = area(L('typeTheTextYouWant', 'Type the text you want read aloud.'), '160px');
    const voicesSel = select([['', L('loadingVoices', 'Loading voices…')]], '', () => {});
    let voice = null, rate = 1, pitch = 1, volume = 100;
    const msg = el('div');
    const supported = 'speechSynthesis' in window;
    if (!supported) {
      root.append(note(L('thisBrowserHasNoSpeech', 'This browser has no speech engine. Edge, Chrome and Safari on macOS/iOS do.'), 'err'));
      return;
    }
    const fill = () => {
      const list = speechSynthesis.getVoices();
      if (!list.length) return;
      const wanted = (navigator.language || 'en').slice(0, 2);
      const opts = list.map(v => [v.name, `${v.name} · ${v.lang}${v.default ? ' · default' : ''}`]);
      voicesSel.replaceChildren(...opts.map(([val, lab]) => el('option', { value: val }, lab)));
      const guess = list.find(v => v.lang.startsWith(wanted)) || list.find(v => v.default) || list[0];
      voice = guess;
      voicesSel.value = guess.name;
      voicesSel.onchange = () => { voice = list.find(v => v.name === voicesSel.value) || voice; };
      msg.replaceChildren(note(fmt(L('ui0VoicesAvailableFromYour', '{0} voices available from your operating system.'), list.length)));
    };
    fill();
    speechSynthesis.onvoiceschanged = fill;
    const playBtn = button(L('play', 'Play'), () => {
      if (!a.value.trim()) { msg.replaceChildren(note(L('nothingToRead', 'Nothing to read.'), 'err')); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(a.value);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = rate; u.pitch = pitch; u.volume = volume / 100;
      u.onerror = e => msg.replaceChildren(note(fmt(L('playbackFailed0', 'Playback failed: {0}.'), e.error || e.message || L('unknownCause', 'unknown')), 'err'));
      u.onend = () => msg.replaceChildren(note(L('finished', 'Finished.')));
      speechSynthesis.speak(u);
      msg.replaceChildren(note(L('speaking', 'Speaking…')));
    });
    root.append(el('div', { class: 'field' }, el('span', { text: L('textPlain', 'Text') }), a),
      el('div', { class: 'controls' },
        field(L('voice', 'Voice'), voicesSel, L('dependsOnYourOsVoices', 'depends on your OS voices')),
        field(L('rate', 'Speed'), (() => { const s = el('input', { type: 'range', min: 0.5, max: 2, step: 0.1, value: 1 }); s.addEventListener('input', () => rate = Number(s.value)); return el('span', { class: 'check' }, s, el('span', { text: '1×' })); })(), ''),
        field(L('pitch', 'Pitch'), (() => { const s = el('input', { type: 'range', min: 0, max: 2, step: 0.1, value: 1 }); s.addEventListener('input', () => pitch = Number(s.value)); return el('span', { class: 'check' }, s, el('span', { text: '1' })); })(), ''),
        field(L('volume', 'Volume'), (() => { const s = el('input', { type: 'range', min: 0, max: 100, step: 5, value: 100 }); s.addEventListener('input', () => volume = Number(s.value)); return el('span', { class: 'check' }, s, el('span', { text: '100%' })); })(), '')),
      el('div', { class: 'btn-row' }, playBtn,
        button(L('pause', 'Pause'), () => speechSynthesis.pause(), { kind: 'ghost' }),
        button(L('resume', 'Resume'), () => speechSynthesis.resume(), { kind: 'ghost' }),
        button(L('stop', 'Stop'), () => { speechSynthesis.cancel(); msg.replaceChildren(note(L('stopped', 'Stopped.'))); }, { kind: 'ghost' })),
      msg, note(L('audioComesFromYourOwn', 'Audio comes from your own system voices, so there is no file to download. Record with your OS if you need an MP3.')));
    a.addEventListener('input', () => { stats(root, [[L('wordsOut', 'Words'), String(countWords(a.value)), ''], [L('listening', '≈ listening'), fmt(L('ui0MinutesShort', '{0} min'), Math.max(1, Math.round(countWords(a.value) / 150))), L('atNormalSpeed', 'at normal speed')]]); });
  },

  // ------------------------------------------------------------ contract-generator
  'contract-generator': async (root) => {
    // Two plain-language templates (mutual NDA, service agreement). Every clause is a dictionary key
    // so the draft comes out in the visitor's language; the filled text lives in a readonly
    // textarea's .value, never a text node. A prominent banner states this is not legal advice.
    let kind = 'nda';
    const blank = '________';
    const nameA = textInput('', null); nameA.placeholder = L('contractNamePlaceholder', 'Full legal name');
    const nameB = textInput('', null); nameB.placeholder = L('contractNamePlaceholder', 'Full legal name');
    const dateIn = el('input', { type: 'date', style: 'width:100%' }); dateIn.value = new Date().toISOString().slice(0, 10);
    const purpose = textInput('', null); purpose.placeholder = L('contractPurposePlaceholder', 'e.g. a possible partnership');
    const scope = area(L('contractScopePlaceholder', 'Describe the services to be performed…'), '90px');
    const fee = textInput('', null); fee.placeholder = L('contractFeePlaceholder', 'e.g. USD 2,000 payable in 14 days');
    const term = textInput(L('contractTermDefault', '12 months'), null);
    const juris = textInput('', null); juris.placeholder = L('contractJurisdictionPlaceholder', 'e.g. England and Wales');
    const kindSel = select([['nda', L('contractNda', 'Non-disclosure agreement (NDA)')], ['service', L('contractService', 'Service agreement')]], kind, v => { kind = v; syncFields(); });
    const purposeField = field(L('contractPurpose', 'Purpose of the discussion'), purpose, '');
    const scopeField = field(L('contractScope', 'Services to be performed'), scope, '');
    const feeField = field(L('contractFee', 'Fee and payment terms'), fee, '');
    const syncFields = () => { purposeField.style.display = kind === 'nda' ? '' : 'none'; scopeField.style.display = kind === 'service' ? '' : 'none'; feeField.style.display = kind === 'service' ? '' : 'none'; };
    const out = area('', '340px'); out.readOnly = true; out.style.width = '100%';
    const jurisdictionClause = () => fmt(L('contractJurisdiction', 'This Agreement is governed by the laws of {0}, and the parties submit to the courts of that place for any dispute.'), juris.value.trim() || blank);
    const gen = button(L('contractGenerate', 'Generate draft'), () => {
      const A = nameA.value.trim() || blank, B = nameB.value.trim() || blank;
      const date = dateIn.value || blank, T = term.value.trim() || blank;
      const paras = kind === 'nda' ? [
        L('contractNdaTitle', 'MUTUAL NON-DISCLOSURE AGREEMENT'),
        fmt(L('contractNdaIntro', 'This Non-Disclosure Agreement ("Agreement") is entered into on {0} between {1} ("Party A") and {2} ("Party B").'), date, A, B),
        fmt(L('contractNdaPurpose', 'The parties wish to explore {0} and may disclose confidential information to each other for that purpose.'), purpose.value.trim() || blank),
        L('contractNdaDefinition', '"Confidential Information" means any non-public information disclosed by one party to the other, in any form, that is marked confidential or would reasonably be understood to be confidential.'),
        L('contractNdaObligations', 'Each party shall keep the other\'s Confidential Information secret, use it only for the purpose above, and share it only with people who need to know it and are bound by similar duties.'),
        L('contractNdaExclusions', 'Confidential Information does not include information that becomes public through no fault of the receiver, was already lawfully known to the receiver, or is independently developed without using the discloser\'s information.'),
        fmt(L('contractNdaTerm', 'The obligations in this Agreement continue for {0} from the date above.'), T),
        L('contractNdaReturn', 'On request, each party shall return or destroy the other\'s Confidential Information and confirm in writing that it has done so.'),
        jurisdictionClause(),
        L('contractSignatures', 'Signed by the parties on the date above.')
      ] : [
        L('contractServiceTitle', 'SERVICE AGREEMENT'),
        fmt(L('contractServiceIntro', 'This Service Agreement ("Agreement") is made on {0} between {1} ("Client") and {2} ("Provider").'), date, A, B),
        fmt(L('contractServiceScope', 'The Provider shall perform the following services: {0}.'), scope.value.trim() || blank),
        fmt(L('contractServiceFee', 'The Client shall pay {0} for the services. Each invoice is payable within the period stated on it.'), fee.value.trim() || blank),
        fmt(L('contractServiceTerm', 'This Agreement begins on the date above and continues for {0}, unless ended earlier under this Agreement.'), T),
        L('contractServiceIndependent', 'The Provider is an independent contractor, not an employee of the Client, and is responsible for its own taxes and insurance.'),
        L('contractServiceConfidentiality', 'Each party shall keep the other\'s non-public information confidential and use it only to perform this Agreement.'),
        L('contractServiceTermination', 'Either party may end this Agreement by written notice if the other materially breaches it and fails to cure the breach within a reasonable time.'),
        jurisdictionClause(),
        L('contractSignatures', 'Signed by the parties on the date above.')
      ];
      paras.push('', `${L('contractPartyA', 'Party A')}: ${A}    ____________________`, `${L('contractPartyB', 'Party B')}: ${B}    ____________________`);
      out.value = paras.join('\n\n');
    });
    const copyB = copyBtn(() => out.value);
    const dlB = button(L('contractDownload', 'Download .txt'), () => {
      if (!out.value) { toast(L('contractGenerateFirst', 'Generate a draft first.')); return; }
      download(new Blob([out.value], { type: 'text/plain;charset=utf-8' }), kind === 'nda' ? 'nda.txt' : 'service-agreement.txt');
    }, { kind: 'ghost' });
    const printB = button(L('contractPrint', 'Print'), () => {
      if (!out.value) { toast(L('contractGenerateFirst', 'Generate a draft first.')); return; }
      const w = window.open('', '_blank');
      if (!w) { toast(L('contractPrintBlocked', 'Allow pop-ups to print the draft.')); return; }
      const esc = out.value.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      w.document.write(`<pre style="white-space:pre-wrap;font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:1.7;max-width:720px;margin:40px auto">${esc}</pre>`);
      w.document.close(); w.focus(); w.print();
    }, { kind: 'ghost' });
    root.append(
      el('div', { class: 'note', style: 'border-left:4px solid #d97706;background:rgba(217,119,6,.08);padding:12px 14px;font-weight:600;border-radius:6px' },
        L('contractDisclaimer', 'This is a general template, not legal advice. Laws differ by country and situation — have a qualified lawyer review it before you sign.')),
      el('div', { class: 'controls' },
        field(L('contractTemplate', 'Template'), kindSel, ''),
        field(L('contractPartyA', 'Party A'), nameA, ''),
        field(L('contractPartyB', 'Party B'), nameB, ''),
        field(L('contractDate', 'Effective date'), dateIn, ''),
        field(L('contractTerm', 'Term'), term, ''),
        field(L('contractJurisdictionLabel', 'Governing law'), juris, ''),
        purposeField, scopeField, feeField),
      el('div', { class: 'btn-row' }, gen, copyB, dlB, printB),
      el('div', { class: 'field' }, el('span', { text: L('contractOutput', 'Your draft') }), out),
      note(L('contractNote', 'The draft is generated in your browser and never uploaded. Fill the blanks, delete the clauses that do not apply, and add the details that matter for your deal.')));
    syncFields();
  },

  // ------------------------------------------------------------ zero-width-watermark
  'zero-width-watermark': async (root) => {
    const ZW0 = '\u200B', ZW1 = '\u200C', ZWM = '\u2060';
    const encode = secret => {
      const bytes = new TextEncoder().encode(secret);
      let bits = '';
      for (const b of bytes) bits += b.toString(2).padStart(8, '0');
      return ZWM + [...bits].map(b => b === '0' ? ZW0 : ZW1).join('') + ZWM;
    };
    const decode = text => {
      const m = text.match(/\u2060([\u200B\u200C]*)\u2060/);
      if (!m || !m[1] || m[1].length % 8) return null;
      const bits = m[1].replace(/\u200B/g, '0').replace(/\u200C/g, '1');
      const bytes = new Uint8Array(bits.length / 8);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
    };
    let mode = 'embed';
    const carrier = area(L('zwCarrier', 'Carrier text — the visible message people will read…'), '120px');
    const secret = area(L('zwSecret', 'Secret text to hide inside it…'), '90px');
    const pasted = area(L('zwPasted', 'Paste the watermarked text here to reveal its hidden message…'), '120px');
    const outA = area(''); outA.readOnly = true;
    const statBox = el('div', { class: 'out' });
    const inputWrap = el('div', { class: 'out' });
    const goBtn = button(L('zwEmbed', 'Embed hidden message'), () => run(goBtn, async () => {
      if (mode === 'embed') {
        if (!secret.value.trim()) throw new Error(L('zwNeedSecret', 'Type a secret message to hide first'));
        const payload = encode(secret.value);
        const c = carrier.value;
        // insert after the first character so the visible text is unchanged and the payload travels
        // with it through copy-paste; an empty carrier becomes the payload alone
        outA.value = c ? c.slice(0, 1) + payload + c.slice(1) : payload;
        stats(statBox, [[L('zwVisibleChars', 'Visible characters'), String([...c].length), ''], [L('zwHiddenChars', 'Hidden characters'), String(payload.length), L('zwInvisible', 'invisible')], [L('zwTotalChars', 'Total length'), String(outA.value.length), '']]);
      } else {
        const found = decode(pasted.value);
        if (found === null) { outA.value = ''; throw new Error(L('zwNone', 'No hidden message was found in this text.')); }
        outA.value = found;
        stats(statBox, [[L('zwRevealedChars', 'Revealed characters'), String([...found].length), '']]);
      }
    }), { kind: 'primary' });
    const render = () => {
      fill(inputWrap, mode === 'embed'
        ? el('div', { class: 'field' }, el('span', { text: L('zwCarrierLabel', 'Carrier text') }), carrier)
        : el('div', { class: 'field' }, el('span', { text: L('zwPastedLabel', 'Watermarked text') }), pasted));
      if (mode === 'embed') inputWrap.append(el('div', { class: 'field' }, el('span', { text: L('zwSecretLabel', 'Secret message') }), secret));
      goBtn.textContent = mode === 'embed' ? L('zwEmbed', 'Embed hidden message') : L('zwExtract', 'Reveal hidden message');
      outA.value = ''; statBox.replaceChildren();
    };
    root.append(
      field(L('zwMode', 'Action'), select([['embed', L('zwEmbedMode', 'Hide a message')], ['extract', L('zwExtractMode', 'Reveal a message')]], mode, v => { mode = v; render(); }), ''),
      inputWrap,
      el('div', { class: 'btn-row' }, goBtn, copyBtn(() => outA.value)),
      el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
      statBox,
      note(L('zwNote', 'The secret is encoded as zero-width Unicode characters (U+200B/U+200C) wrapped in word-joiners. They are invisible and survive ordinary copy-paste, but any editor that strips formatting or normalises Unicode will remove them. This is obfuscation, not encryption — do not hide passwords or sensitive data with it.')));
    render();
  },

  // ------------------------------------------------------------ css-generator
  'css-generator': async (root) => {
    let mode = 'box';
    const b = { x: 6, y: 10, blur: 24, spread: -6, radius: 18, color: '#4f46e5', opacity: 40, inset: false, bg: '#ffffff' };
    const g = { cols: 3, gap: 12, items: 6, height: 72 };
    const preview = el('div', { style: 'display:flex;align-items:center;justify-content:center;min-height:230px;padding:30px;border-radius:12px;background:#f1f5f9;margin-bottom:14px' });
    const cssOut = area(''); cssOut.readOnly = true; cssOut.style.minHeight = '150px';
    const controls = el('div', { class: 'controls' });
    const hexToRgba = (hex, a) => {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16) || 0, gg = parseInt(h.slice(2, 4), 16) || 0, bb = parseInt(h.slice(4, 6), 16) || 0;
      return `rgba(${r}, ${gg}, ${bb}, ${a})`;
    };
    const colorField = (label, value, on) => field(label, el('input', { type: 'color', value, oninput: e => on(e.target.value) }), '');
    const render = () => {
      preview.replaceChildren();
      if (mode === 'box') {
        const shadow = `${b.inset ? 'inset ' : ''}${b.x}px ${b.y}px ${b.blur}px ${b.spread}px ${hexToRgba(b.color, (b.opacity / 100).toFixed(2))}`;
        preview.append(el('div', { style: `width:150px;height:150px;background:${b.bg};border-radius:${b.radius}px;box-shadow:${shadow}` }));
        cssOut.value = `.box {\n  background: ${b.bg};\n  border-radius: ${b.radius}px;\n  box-shadow: ${shadow};\n}`;
      } else {
        const gridEl = el('div', { style: `display:grid;grid-template-columns:repeat(${g.cols},1fr);gap:${g.gap}px;width:100%;max-width:420px` });
        const palette = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#e11d48'];
        for (let i = 0; i < g.items; i++) gridEl.append(el('div', { style: `height:${g.height}px;border-radius:8px;background:${palette[i % palette.length]}` }));
        preview.append(gridEl);
        cssOut.value = `.grid {\n  display: grid;\n  grid-template-columns: repeat(${g.cols}, 1fr);\n  gap: ${g.gap}px;\n}\n\n.grid > * {\n  min-height: ${g.height}px;\n  border-radius: 8px;\n}`;
      }
    };
    const renderControls = () => {
      controls.replaceChildren();
      if (mode === 'box') {
        controls.append(
          field(L('cssOffsetX', 'Shadow X'), rangeInput(b.x, -60, 60, 1, v => { b.x = v; render(); }, 'px'), ''),
          field(L('cssOffsetY', 'Shadow Y'), rangeInput(b.y, -60, 60, 1, v => { b.y = v; render(); }, 'px'), ''),
          field(L('cssBlur', 'Blur'), rangeInput(b.blur, 0, 100, 1, v => { b.blur = v; render(); }, 'px'), ''),
          field(L('cssSpread', 'Spread'), rangeInput(b.spread, -40, 40, 1, v => { b.spread = v; render(); }, 'px'), ''),
          field(L('cssRadius', 'Corner radius'), rangeInput(b.radius, 0, 120, 1, v => { b.radius = v; render(); }, 'px'), ''),
          field(L('cssOpacity', 'Shadow opacity'), rangeInput(b.opacity, 0, 100, 1, v => { b.opacity = v; render(); }, '%'), ''),
          colorField(L('cssShadowColor', 'Shadow colour'), b.color, v => { b.color = v; render(); }),
          colorField(L('cssBoxColor', 'Box colour'), b.bg, v => { b.bg = v; render(); }),
          el('span', {}, checkInput(L('cssInset', 'Inset shadow'), b.inset, v => { b.inset = v; render(); })));
      } else {
        controls.append(
          field(L('cssColumns', 'Columns'), rangeInput(g.cols, 1, 6, 1, v => { g.cols = v; render(); }, ''), ''),
          field(L('cssGap', 'Gap'), rangeInput(g.gap, 0, 40, 1, v => { g.gap = v; render(); }, 'px'), ''),
          field(L('cssItems', 'Items'), rangeInput(g.items, 1, 12, 1, v => { g.items = v; render(); }, ''), ''),
          field(L('cssRowHeight', 'Row height'), rangeInput(g.height, 30, 160, 2, v => { g.height = v; render(); }, 'px'), ''));
      }
    };
    root.append(
      field(L('cssMode', 'Generator'), select([['box', L('cssBoxMode', 'Box shadow & radius')], ['grid', L('cssGridMode', 'Grid layout')]], mode, v => { mode = v; renderControls(); render(); }), ''),
      controls, preview,
      el('div', { class: 'field' }, el('span', { text: L('cssGenerated', 'Generated CSS') }), cssOut),
      el('div', { class: 'btn-row' }, copyBtn(() => cssOut.value)),
      note(L('cssNote', 'Drag the sliders and watch the preview and the CSS update live. Copy the CSS into your stylesheet. Everything is computed in your browser.')));
    renderControls(); render();
  },

  // ------------------------------------------------------------ json-to-svg
  'json-to-svg': async (root) => {
    const SAMPLE = '{\n  "app": {\n    "frontend": ["pages", "components"],\n    "backend": { "api": "REST", "db": "Postgres" }\n  }\n}';
    const inA = area(L('jsvgInput', 'Paste JSON here — an object or array becomes a structure tree…'), '170px');
    inA.value = SAMPLE;
    const svgOut = area(''); svgOut.readOnly = true; svgOut.style.minHeight = '130px';
    const previewWrap = el('div', { class: 'out', style: 'text-align:center;overflow:auto;padding:10px;background:#0f172a;border-radius:12px' });
    let lastBlob = null;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const build = (value, key, depth) => {
      const label = key !== undefined ? String(key) : '';
      if (depth > 7) return { label: (label ? label + ': ' : '') + '…', children: [] };
      if (value && typeof value === 'object') {
        const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
        return { label: label || (Array.isArray(value) ? `[${value.length}]` : '{…}'), children: entries.slice(0, 40).map(([k, v]) => build(v, k, depth + 1)) };
      }
      let text = value === null ? 'null' : typeof value === 'string' ? `"${value}"` : String(value);
      if (text.length > 26) text = text.slice(0, 25) + '…';
      return { label: (label ? label + ': ' : '') + text, children: [] };
    };
    const render = () => {
      let data;
      try { data = JSON.parse(inA.value); } catch { throw new Error(L('jsvgBadJson', 'That is not valid JSON. Check for a missing comma or quote.')); }
      const tree = build(data, undefined, 0);
      const NODE_H = 30, V_GAP = 12, COL = 220, PAD = 18;
      const nodes = []; let nextY = PAD, maxDepth = 0;
      const measure = (node, depth) => {
        node.depth = depth; maxDepth = Math.max(maxDepth, depth);
        node.w = Math.min(200, Math.max(64, node.label.length * 7.2 + 20));
        node.x = PAD + depth * COL;
        if (!node.children.length) { node.y = nextY; nextY += NODE_H + V_GAP; }
        else { node.children.forEach(c => measure(c, depth + 1)); node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2; }
        nodes.push(node);
      };
      measure(tree, 0);
      const W = PAD * 2 + maxDepth * COL + 210, H = Math.max(nextY + PAD - V_GAP, 80);
      const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13">`;
      svg += `<rect width="${W}" height="${H}" fill="#0f172a"/>`;
      for (const n of nodes) for (const c of n.children) {
        const x1 = n.x + n.w, y1 = n.y + NODE_H / 2, x2 = c.x, y2 = c.y + NODE_H / 2, mx = (x1 + x2) / 2;
        svg += `<path d="M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="#475569" stroke-width="1.5"/>`;
      }
      for (const n of nodes) {
        const fill = n.children.length ? colors[n.depth % colors.length] : '#1e293b';
        svg += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${NODE_H}" rx="7" fill="${fill}" stroke="#334155"/>`;
        svg += `<text x="${n.x + 10}" y="${n.y + NODE_H / 2 + 4}" fill="#f8fafc">${esc(n.label)}</text>`;
      }
      svg += '</svg>';
      svgOut.value = svg;
      if (lastBlob) URL.revokeObjectURL(lastBlob);
      lastBlob = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      fill(previewWrap, el('img', { src: lastBlob, alt: '', style: 'max-width:100%;height:auto' }));
    };
    const goBtn = button(L('jsvgRender', 'Render diagram'), () => run(goBtn, async () => {
      if (!inA.value.trim()) throw new Error(L('jsvgNeedJson', 'Paste some JSON first'));
      render();
    }), { kind: 'primary' });
    const dlBtn = button(`${L('download', 'Download')} SVG`, () => {
      if (!lastBlob) { toast(L('jsvgRenderFirst', 'Render a diagram first')); return; }
      download(new Blob([svgOut.value], { type: 'image/svg+xml' }), 'structure.svg');
    }, { kind: 'ghost' });
    root.append(
      el('div', { class: 'field' }, el('span', { text: L('jsvgInputLabel', 'JSON input') }), inA),
      el('div', { class: 'btn-row' }, goBtn, dlBtn, copyBtn(() => svgOut.value)),
      previewWrap,
      el('div', { class: 'field' }, el('span', { text: L('jsvgSvgCode', 'SVG code') }), svgOut),
      note(L('jsvgNote', 'The JSON is parsed and laid out as a left-to-right structure tree, drawn entirely in your browser. Download it as an SVG you can drop into docs or slides, or copy the markup. Large arrays are capped at 40 branches and 8 levels deep to keep the diagram readable.')));
    try { render(); } catch { fill(previewWrap, note(L('jsvgHint', 'Enter JSON and press Render to draw its structure as an SVG tree.'))); }
  },

  // ------------------------------------------------------------ encrypt-decrypt
  'encrypt-decrypt': async (root) => {
    const inA = area(L('encInput', 'Type or paste the text to encrypt or decrypt…'), '150px');
    const passIn = el('input', { type: 'password', placeholder: L('encPassPlaceholder', 'Passphrase'), autocomplete: 'off', style: 'width:100%' });
    const outA = area(''); outA.readOnly = true;
    const subtle = () => {
      if (!crypto?.subtle) throw new Error(L('encNoSubtle', 'This browser has no Web Crypto support. A secure (https) page is required.'));
      return crypto.subtle;
    };
    const deriveKey = async (pass, salt) => {
      const base = await subtle().importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
      return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    };
    const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    const unb64 = str => { const bin = atob(str.replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const encBtn = button(L('encrypt', 'Encrypt'), () => run(encBtn, async () => {
      if (!inA.value) throw new Error(L('encNeedText', 'Enter some text first'));
      if (!passIn.value) throw new Error(L('encNeedPass', 'Enter a passphrase'));
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await deriveKey(passIn.value, salt);
      const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(inA.value));
      // pack salt + iv + ciphertext so the passphrase alone is enough to decrypt later
      const packed = new Uint8Array(salt.length + iv.length + ct.byteLength);
      packed.set(salt, 0); packed.set(iv, salt.length); packed.set(new Uint8Array(ct), salt.length + iv.length);
      outA.value = b64(packed);
    }), { kind: 'primary' });
    const decBtn = button(L('decrypt', 'Decrypt'), () => run(decBtn, async () => {
      if (!inA.value.trim()) throw new Error(L('encNeedCipher', 'Paste the encrypted text first'));
      if (!passIn.value) throw new Error(L('encNeedPass', 'Enter a passphrase'));
      let packed; try { packed = unb64(inA.value); } catch { throw new Error(L('encBadCipher', 'That is not valid encrypted text.')); }
      if (packed.length < 29) throw new Error(L('encBadCipher', 'That is not valid encrypted text.'));
      const salt = packed.slice(0, 16), iv = packed.slice(16, 28), ct = packed.slice(28);
      const key = await deriveKey(passIn.value, salt);
      let pt; try { pt = await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct); } catch { throw new Error(L('encWrongPass', 'Could not decrypt — wrong passphrase or corrupted text.')); }
      outA.value = new TextDecoder().decode(pt);
    }), { kind: 'ghost' });
    root.append(
      el('div', { class: 'field' }, el('span', { text: L('inputText', 'Input') }), inA),
      field(L('password', 'Password'), passIn, L('encPassHint', 'The same passphrase is needed to decrypt. It is never stored or sent anywhere.')),
      el('div', { class: 'btn-row' }, encBtn, decBtn, copyBtn(() => outA.value)),
      el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
      note(L('encNote', 'AES-256-GCM with a PBKDF2-derived key (150,000 iterations, SHA-256). The random salt and IV are packed into the output, so the passphrase alone decrypts it. Everything runs in your browser via the Web Crypto API — nothing is uploaded.')));
  }
};

// hash tool uses a file zone that must not clash with the other tools' panels
function fileZoneHash(root, onFile) {
  const input = el('input', { type: 'file', hidden: true });
  const zone = el('div', { class: 'drop' },
    el('span', { class: 'big', 'aria-hidden': 'true', text: '📄' }),
    el('span', { text: L('orHashWholeFile', '…or hash a whole file') }), input);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });
  root.append(zone);
}
