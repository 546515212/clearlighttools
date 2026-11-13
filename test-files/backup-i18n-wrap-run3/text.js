// Text and code tools. Everything is computed in the page: no text ever leaves the browser.
import {
  fmt,
  el, D, t, countWords, parseCsv, diffLines, digest, digestFile, md5, download,
  note, stat, toast, select, numberInput, textInput, checkInput, button, field, run, copyText, loadLib, locale
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
        stat(L('wordsOut', 'Words'), String(words), unique ? `${Math.round(unique / Math.max(1, words) * 100)}% unique` : ''),
        stat(L('charactersOut', 'Characters'), String(chars), fmt(L('ui0WithoutSpaces', '{0} without spaces'), noSpace)),
        stat(L('sentencesOut', 'Sentences'), String(sentences || (s.trim() ? 1 : 0)), ''),
        stat(L('lineCount', 'Lines'), String(lines), `${paragraphs} paragraphs`),
        stat(L('readingTime', 'Reading time'), `${words ? Math.max(1, Math.round(words / 200)) : 0} min`, '≈200 wpm'),
        stat(L('speakingTime', 'Speaking time'), `${words ? Math.max(1, Math.round(words / 130)) : 0} min`, '≈130 wpm'),
        stat(L('averageWord', 'Average word'), words ? (chars / words).toFixed(1) : '—', 'characters'));
      const freq = new Map();
      for (const w of tokens) {
        if (w.length < 4 || STOP.has(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
      const top = [...freq.entries()].filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1]).slice(0, 14);
      kwBox.replaceChildren(
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
    const render = () => {
      outA.value = (cases[mode] || cases.upper)(inA.value);
      stats(root, [['Words', String(countWords(outA.value)), ''], ['Characters', String(outA.value.length), ''], ['Case', Object.keys(cases).includes(mode) ? mode : 'upper', '']]);
    };
    inA.addEventListener('input', render);
    root.append(
      field(L('caseMode', 'Case'), select(Object.entries({
        upper: L('caseUpper', 'UPPERCASE'), lower: L('caseLower', 'lowercase'), sentence: L('sentenceCase', 'Sentence case'),
        title: L('titleCase', 'Title Case'), every: 'Every Word Here', camel: 'camelCase', pascal: 'PascalCase',
        snake: L('snake', 'snake_case'), kebab: L('kebab', 'kebab-case'), constant: 'CONSTANT_CASE',
        alt: L('altCase', 'aLtErNaTiNg'), inverse: 'iNVERSE cASE'
      }), mode, v => { mode = v; render(); }), L('worksOnWholeTextOr', 'Works on whole text or a single identifier')),
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
      box.replaceChildren(
        el('div', { class: 'field' }, el('span', { text: L('result', 'Result') }), outA),
        el('div', { class: 'out' },
          stat(L('lineCount', 'Lines'), `${lines.length} → ${items.length}`, `${Math.max(0, lines.length - items.length)} removed`),
          stat(L('keepUnique', 'Unique'), String(seen.size), dupes.length ? fmt(L('ui0AppearTwiceOrMore', '{0} appear twice or more'), dupes.length) : 'no repeats'),
          stat(L('longestLine', 'Longest line'), String(items.reduce((a, i) => Math.max(a, i.v.length), 0)), 'characters')),
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
      stats(root, [['Words', String(countWords(outA.value)), ''], ['Sentences', String((outA.value.match(/[.!?](\s|$)/g) || []).length), ''], ['Characters', String(outA.value.length), '']]);
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
      if (!s.trim()) { outA.value = ''; stats(root, [['Input characters', '0', ''], ['Output characters', '0', '']]); return; }
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
        stats(root, [['Input characters', String(s.length), ''], ['Output characters', String(v.length), dir === 'encode' ? `+${Math.max(0, Math.round((v.length / Math.max(1, s.length) - 1) * 100))}%` : '']]);
      } catch (e) {
        outA.value = '';
        err.append(note(fmt(L('couldNotDecodeThis0', 'Could not decode this: {0}. Base64 length must not leave a single leftover character.'), e.message || e), 'err'));
      }
    };
    inA.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('direction', 'Direction'), select([['encode', L('textToBase64', 'Text → base64')], ['decode', 'base64 → text']], dir, v => { dir = v; go(); }), L('textIsTreatedAsUtf', 'Text is treated as UTF-8, so accents and CJK work')),
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
      stats(root, [['Input characters', String(s.length), ''], ['Output characters', String(outA.value.length), '']]);
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
        msg.append(note(`Not valid JSON${line ? ` around line ${line}` : ''}: ${e.message}`, 'err'));
        if (pos >= 0) {
          const lines = s.split('\n');
          msg.append(el('pre', { class: 'diff-view', text: `${line}: ${lines[line - 1] || ''}\n${' '.repeat(Math.max(0, pos - (lines.slice(0, line - 1).join('\n').length) + (line - 1)))}^ here` }));
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
      stats(root, [['Valid JSON', 'yes', ''], ['Keys', String(c.keys), `${c.arrs} arrays`], ['Depth', String(c.depth), `${c.vals} leaf values`], ['Size', `${outA.value.length.toLocaleString(locale())} chars`, '']]);
    };
    inA.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('indent', 'Indent'), select([['2', '2 spaces'], ['4', '4 spaces'], ['tab', L('tabIndent', 'Tab')]], indent, v => { indent = v; go(); }), ''),
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
    const inA = area('name,city,age\nAda,London,36\nGrace,New York,45', '170px');
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
      stats(root, [['Rows', String(rows.length), ''], ['Columns', String(head.length), ''], ['Delimited by', delim === ',' ? 'comma' : delim === '\t' ? 'tab' : delim === ';' ? 'semicolon' : `'${delim}'`, '']]);
      // preview the first rows as a real table so misaligned quoting is obvious
      const cols = head.length ? head : Object.keys(data[0] || {});
      const thead = el('tr', {}, ...cols.map(c => el('th', { text: String(c) })));
      const tb = el('table', { class: 'result-card', style: 'width:100%;border-collapse:collapse;font-size:13px' },
        el('thead', {}, thead),
        el('tbody', {}, ...data.slice(0, 8).map(r => el('tr', {}, ...cols.map(c => el('td', { text: r[c] === null || r[c] === undefined ? '' : String(r[c]), style: 'padding:4px 8px;border-top:1px solid var(--line)' }))))));
      tableBox.replaceChildren(el('h3', { text: L('preview', 'Preview') }), tb, rows.length > 8 ? note(`Showing 8 of ${rows.length} rows.`) : null);
    };
    inA.addEventListener('input', go);
    root.append(el('div', { class: 'controls' },
      field(L('delimiter', 'Delimiter'), select([[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], ['|', 'Pipe']], delim, v => { delim = v; go(); }), L('excelInManyRegionsExports', 'Excel in many regions exports semicolons')),
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
      stats(root, [['HTML characters', String(html.length), ''], ['Words rendered', String(countWords(preview.textContent)), ''], ['Headings', String(preview.querySelectorAll('h1,h2,h3,h4,h5,h6').length), '']]);
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
        show(map, file ? `${file.name} · ${file.size.toLocaleString(locale())} bytes` : `${text.length.toLocaleString(locale())} characters`);
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
      stats(root, [['Generated', String(list.length), version === '4' ? 'random (RFC 4122)' : version === '7' ? 'time-ordered' : 'time-ish'], ['Unique', String(new Set(list).size), ''], ['Characters', String(out.value.length), '']]);
    };
    root.append(el('div', { class: 'controls' },
      field(L('version', 'Version'), select([['4', 'v4 — random'], ['7', L('v7SortableByTime', 'v7 — sortable by time')], ['1', 'v1 — time-ish']], version, v => { version = v; make(); }), L('v4IsTheSafeDefault', 'v4 is the safe default')),
      field(L('quantity', 'How many'), numberInput(10, v => { count = Number(v) || 1; make(); }, { min: 1, max: 1000 }), 'max 1000'),
      el('span', {}, checkInput(L('upper', 'UPPERCASE'), false, v => { upper = v; make(); })),
      el('span', {}, checkInput(L('noHyphens', 'No hyphens'), false, v => { hyphens = !v; make(); })),
      el('span', {}, checkInput('Wrap in {braces}', false, v => { braces = v; make(); }))),
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
      const label = bits < 40 ? 'weak' : bits < 60 ? 'okay for low-value accounts' : bits < 90 ? 'strong' : 'very strong';
      const crack = bits < 20 ? 'instantly' : `~${(2 ** Math.max(0, bits - 34) / 1e6).toExponential(1)} years at a trillion guesses per second`;
      return { pool, bits, label, crack };
    };
    const make = () => {
      const n = Math.min(50, Math.max(1, Number(count) || 1));
      const list = Array.from({ length: n }, makeOne);
      out.value = list.filter(Boolean).join('\n');
      const st = strength();
      stats(root, [['Length', String(len), `pool ${st.pool} characters`], ['Entropy', `${st.bits.toFixed(1)} bits`, st.label], ['Brute force', st.crack, '']]);
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
    let pattern = '\\b\\w+@\\w+\\.\\w+\\b', flags = 'g', subject = 'Contact ada@example.com or grace@example.org for details.';
    const patIn = textInput(pattern, v => { pattern = v; go(); }, 'text');
    patIn.setAttribute('spellcheck', 'false');
    patIn.style.fontFamily = 'var(--mono)';
    const flagIn = textInput(flags, v => { flags = v.replace(/[^gimsuy]/g, ''); go(); }, 'text');
    flagIn.style.width = '90px';
    const subj = area('', '140px'); subj.value = subject;
    const msg = el('div');
    const hits = el('div', { class: 'out' });
    const repl = area('$1', '60px');
    const PRESETS = {
      'Email': '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
      'URL': 'https?://[^\\s]+',
      'IPv4': '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b',
      'Date YYYY-MM-DD': '\\b\\d{4}-(?:0[1-9]|1[0-2])-(?:[0-2]\\d|3[01])\\b',
      'Hex colour': '#(?:[0-9a-fA-F]{3}){1,2}\\b',
      'Phone (loose)': '\\+?\\d[\\d\\s().-]{7,}\\d',
      'Slug': '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      'HTML tag': '<\\/?([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*>',
      'Password ≥8 mixed': '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$'
    };
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
      stats(root, [['Matches', String(matches.length), flags.includes('g') ? '' : 'add the g flag to find more than one'],
        ['Subject', `${subject.length} chars`, `${subject.split('\n').length} lines`]]);
      hits.append(el('h3', { text: L('highlighted', 'Highlighted') }),
        el('div', { class: 'result-card', style: 'white-space:pre-wrap;font-family:var(--mono);font-size:13px;line-height:1.6' }, highlight(subject, re)));
      if (matches.length) {
        const rows = matches.slice(0, 60).map((x, i) => el('div', { class: 'result-card', style: 'display:flex;gap:12px;flex-wrap:wrap;font-size:13px' },
          el('b', { text: `#${i + 1}` }), el('code', { text: x.text }), el('span', { class: 'sz', text: `at ${x.at}` }),
          x.groups.length ? el('span', { class: 'delta', text: `groups: ${x.groups.map(g => g === undefined ? '∅' : JSON.stringify(g)).join(', ')}` }) : null));
        hits.append(el('h3', { text: L('matches', 'Matches') }), ...rows, matches.length > 60 ? note(`Showing 60 of ${matches.length}.`) : null);
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
      field(L('examples', 'Examples'), select(Object.keys(PRESETS), '', v => { if (PRESETS[v]) { patIn.value = pattern = PRESETS[v]; go(); } }), L('commonRecipes', 'common recipes')))
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
      out.replaceChildren(
        el('div', { class: 'out' }, stat(L('changedLines', 'Changed lines'), String(adds + dels), `${adds} added · ${dels} removed`), stat(L('identical', 'Identical'), String(rows.length - adds - dels), 'lines')),
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
      u.onerror = e => msg.replaceChildren(note(`Playback failed: ${e.error || e.message || 'unknown'}.`, 'err'));
      u.onend = () => msg.replaceChildren(note('Finished.'));
      speechSynthesis.speak(u);
      msg.replaceChildren(note('Speaking…'));
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
        button(L('stop', 'Stop'), () => { speechSynthesis.cancel(); msg.replaceChildren(note('Stopped.')); }, { kind: 'ghost' })),
      msg, note(L('audioComesFromYourOwn', 'Audio comes from your own system voices, so there is no file to download. Record with your OS if you need an MP3.')));
    a.addEventListener('input', () => { stats(root, [['Words', String(countWords(a.value)), ''], ['≈ listening', `${Math.max(1, Math.round(countWords(a.value) / 150))} min`, 'at normal speed']]); });
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
