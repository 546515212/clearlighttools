// Browser-side verification driver for the site's file tools.
//
// It is served by the dev server at /__script/drive.mjs and imported from a page eval:
//
//   async function go() {
//     const d = await import('/__script/drive.mjs?v=' + Date.now());
//     return d.run({ fixtures: ['sample-a.pdf'], prefix: 'split' });
//   }
//
// Why a file and not pasted code: the same four steps run for every tool, and a bug in them
// would otherwise look like a bug in the tool. The steps are
//   1. fetch a fixture and wrap it in a real File object
//   2. hand that File to the tool through a synthetic DataTransfer drop on .drop
//      (the same code path a manual drag uses; the hidden <input> is not driveable headlessly)
//   3. fill any inputs the test asks for, matched by the label text next to the field
//   4. click the action buttons and intercept the blob download, POSTing the exact bytes to
//      /__save so Node can inspect what the browser really produced
//
// Nothing here asserts anything about correctness — it returns observations. The checks live in
// scripts/browser-report.mjs so a failure is a diff, not a guess.

const TYPES = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.webm': 'video/webm', '.gif': 'image/gif', '.zip': 'application/zip', '.txt': 'text/plain'
};

// Chrome clamps setTimeout in a hidden or occluded window to roughly one call every 300 ms, and
// harder after five minutes hidden. That is measured and reported (throttleMs below) rather than
// fought: an earlier version of this driver waited on MessageChannel yields, which are not
// throttled, and it made things worse — the sweep's own spin loop competed with the tool's
// chunked rendering, and pdf-to-jpg then never finished at all inside 120 s while it did finish,
// slowly, on ordinary timers. Waits therefore stay on timers and a slow row in a throttled tab is
// read as "not verified", not as a broken tool. Bring the browser window to the front for a sweep
// whose numbers you intend to trust.
const settle = ms => new Promise(r => setTimeout(r, ms));
// wait for a condition rather than for a guessed duration: the budget is a ceiling, not a sleep
async function until(cond, budgetMs, every = 120) {
  const t0 = Date.now();
  for (;;) {
    if (cond()) return true;
    if (Date.now() - t0 >= budgetMs) return false;
    await settle(every);
  }
}
// how badly this tab is being throttled right now, so a slow row in the report can be read honestly
let timerLag = null;
async function measureThrottle() {
  if (timerLag !== null) return timerLag;
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 50));
  timerLag = Date.now() - t0;
  return timerLag;
}

// ---------------------------------------------------------------- which button hands over the file
// The first version asked a hardcoded regex: /download|save|\.zip|导出|下载/. That is English plus
// two languages, so on /de/ the driver looked at a result row plainly reading "Herunterladen" and
// reported "file tool produced no download button" — eleven of thirteen locales could never pass a
// file row. The words now come from the dictionary the page itself loaded, so the driver and the UI
// cannot drift apart, and the last resort is structural instead of linguistic.
const GRAB_KEYS = ['download', 'downloadAll', 'save', 'saveFile', 'export'];
const NOT_GRAB_KEYS = ['copy', 'copied', 'remove', 'removeFile', 'reset', 'clear', 'cancel', 'tryAgain', 'play', 'stop', 'generate'];

function dictWords(keys) {
  const D = window.__TH_DICT || {};
  const out = new Set();
  for (const ns of ['w', 'common', 'tool', 'cat']) {
    for (const k of keys) {
      const v = D[ns] && D[ns][k];
      // values are strings, but a dictionary layer could nest — anything non-string is skipped
      // rather than coerced, so a shape change shows up as "no grabber clicked", not a click on
      // "[object Object]"
      if (typeof v === 'string' && v.trim()) out.add(v.trim().toLowerCase());
    }
  }
  return [...out];
}

function makeGrabberTest() {
  const grab = dictWords(GRAB_KEYS);
  const stop = dictWords(NOT_GRAB_KEYS);
  return b => {
    const text = b.textContent.trim().toLowerCase();
    if (!text) return false;
    if (stop.some(w => text.includes(w))) return false;
    // the English words stay as a floor: the scratch-host sweep mounts into a page whose dictionary
    // is English, and a page that failed to load its dictionary should still be drivable
    if (grab.some(w => text.includes(w)) || /download|save|\.zip|导出|下载/.test(text)) return true;
    return !!(b.closest && b.closest('.out'));
  };
}

// ---------------------------------------------------------------- fixtures
async function loadFixture(name) {
  const res = await fetch(`/__files/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`fixture ${name} -> HTTP ${res.status}`);
  const blob = await res.blob();
  const mime = blob.type && blob.type !== 'application/octet-stream'
    ? blob.type
    : TYPES['.' + name.split('.').pop().toLowerCase()] || 'application/octet-stream';
  return { file: new File([blob], name, { type: mime }), bytes: blob.size };
}

// ---------------------------------------------------------------- downloads
// lib.js download() creates <a download> and clicks it, so patching the prototype catches every
// generated file. The blob is read here and shipped to Node; the click is swallowed so no real
// download dialog fires. The returned promise is tracked because the tool code does not await it.
let saved = [];
let pending = [];
let prefix = '';
let patched = false;
function patchDownloads() {
  if (patched) return;
  patched = true;
  const real = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.hasAttribute('download')) return real.call(this);
    const name = this.getAttribute('download') || 'download';
    const href = this.href;
    pending.push((async () => {
      try {
        const res = await fetch(href);
        const blob = await res.blob();
        const buf = await blob.arrayBuffer();
        // the tool decides its own file name, which collides across tools (every split of
        // sample-a.pdf is "sample-a-pages.pdf"), so the per-tool prefix goes on the saved copy
        const out = await fetch(`/__save?name=${encodeURIComponent(prefix + name)}`, { method: 'POST', body: buf }).then(r => r.json());
        const entry = { name, mime: blob.type, bytes: buf.byteLength, saved: out.saved, text: null };
        // keep a short prefix of text-ish output so the report can eyeball it
        if (/json|text|csv|xml|html/.test(blob.type)) entry.text = (await blob.text()).slice(0, 200);
        saved.push(entry);
      } catch (err) {
        saved.push({ name, error: String(err && err.message || err) });
      }
    })());
  };
}

// ---------------------------------------------------------------- detached output box
// "file tool produced no download button" is true but useless when the tool actually did the work:
// image-to-gif and image-contrast-brightness both built `const out = el('div', {class: 'out'})`,
// wrote the finished result into it, and never appended it to the page — so the encode ran, the
// button spun, the file existed, and the user saw nothing.
// The first version flagged "written to while detached and still detached at the end", which was
// wrong for remove-duplicate-lines: it renders a *nested* `.out` inside its box on every keystroke,
// so the previous keystroke's box is detached by the next one. Correct code, red row. The rule now
// also requires that the node was never attached to something that was in the page — a box that got
// connected once and was later replaced is garbage collection, a box that never connected is a bug.
let strayBox = null;
function watchDetachedOutputs() {
  if (strayBox) return strayBox;
  const written = new Set();   // every `.out` box something was written into
  const attached = new Set();  // every node seen inside the page (so a box that was connected once
                               // and got replaced on the next render is not mistaken for a bug)
  const isOut = n => n.nodeType === 1 && n.classList?.contains('out');
  const observe = node => {
    if (isOut(node)) written.add(node);
    if (node.isConnected) {
      attached.add(node);
      if (node.querySelectorAll) for (const d of node.querySelectorAll('.out')) attached.add(d);
    }
  };
  for (const name of ['append', 'prepend', 'appendChild', 'replaceChildren', 'insertBefore']) {
    const real = Element.prototype[name];
    Element.prototype[name] = function (...args) {
      // an empty replaceChildren() only clears a box; nothing was written, nothing to learn
      if (!args.length) return real.apply(this, args);
      const r = real.apply(this, args);
      observe(this);
      for (const a of args) if (a instanceof Node) observe(a);
      return r;
    };
  }
  strayBox = {
    stray: () => [...written].filter(n => !n.isConnected && !attached.has(n)),
    clear: () => { written.clear(); attached.clear(); }
  };
  return strayBox;
}

// ---------------------------------------------------------------- animation frames
// pdf.js paces its main-thread render loop with requestAnimationFrame — in the vendored
// pdf.min.js 3.11.174, RenderTaskStream._scheduleNext() calls it when the caller did not supply an
// onContinue handler. A background tab is handed no frames at all, so page.render().promise never
// settles and a rasterising tool reads as hung: pdf-to-jpg ran 261 s without producing a byte, and
// the probe below shows why (rAF: never within 3 s, while fetch/parse/viewport/toBlob all timed at
// ~10 ms). On a visible tab the current behaviour is correct — the loop pauses with the tab and
// resumes the moment the visitor comes back — so the product code stays as it is and the driver
// stands in for the missing frames instead.
// This is opt-in per row ("rafShim": true) and recorded in the row, so a green pdf-to-jpg can
// never be misread as "verified with real animation frames".
let rafRestore = null;
function installRafShim() {
  if (rafRestore) return rafRestore;
  const realRaf = window.requestAnimationFrame, realCancel = window.cancelAnimationFrame;
  const jobs = new Map();
  let n = 0;
  window.requestAnimationFrame = cb => {
    const id = ++n;
    jobs.set(id, setTimeout(() => { jobs.delete(id); try { cb(performance.now()); } catch { /* a cancelled callback */ } }, 16));
    return id;
  };
  window.cancelAnimationFrame = id => { clearTimeout(jobs.get(id)); jobs.delete(id); };
  rafRestore = () => {
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancel;
    for (const t of jobs.values()) clearTimeout(t);
    jobs.clear();
    rafRestore = null;
  };
  return rafRestore;
}

// ---------------------------------------------------------------- drop
async function dropFiles(zone, files) {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await settle(120);
}

// ---------------------------------------------------------------- field filling
// Match on the human label, not on the DOM order: the markup is generated per tool and the order
// is the thing most likely to change.
function labelledInputs(root) {
  const out = [];
  root.querySelectorAll('.controls > *').forEach(control => {
    const label = control.querySelector('label, span')?.textContent?.trim() || '';
    const input = control.querySelector('input:not([type=hidden]), select, textarea');
    if (input) out.push({ label, input });
  });
  return out;
}

function fillOne({ label, input }, value) {
  if (input.type === 'checkbox') {
    input.checked = !!value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return `${label}=${input.checked}`;
  }
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return `${label}=${value}`;
}

// ---------------------------------------------------------------- mount one tool
// The bundles in /_assets/tools/ are the same files the tool pages import, and they take the
// container element as their only argument. Mounting one into a scratch div lets a single page
// load drive many tools, which is the only way to sweep 49 of them without 49 navigations.
// The cost: this skips the shell (nav, ads, routing, data-libs preload), so a handful of tools
// are also driven on their real URL — run() with no `tool` key mounts into the page's own
// #tool-root instead. That pass is what proves the shell; see scripts/browser/sweep-pages.json.
// The bundle name is the category the registry gives the tool, so this cannot drift out of sync
// with src/data/tools.json the way a hand-copied id table would.
const cache = {};
const registry = {};
async function toolMeta(id) {
  if (!registry.loaded) {
    const t = await (await fetch('/_assets/tools.json?v=' + Date.now())).json();
    for (const x of (t.tools || t)) registry[x.id] = x;
    registry.loaded = true;
  }
  if (!registry[id]) throw new Error(`${id} is not in /_assets/tools.json`);
  return registry[id];
}

const libModule = () => import('/_assets/lib.js');
export async function mountTool(id) {
  const meta = await toolMeta(id);
  cache[meta.cat] ??= import(`/_assets/tools/${meta.cat}.js`);
  const mod = await cache[meta.cat];
  if (!mod.tools[id]) throw new Error(`${meta.cat}.js has no tool ${id}`);
  // runtime.js loads the tool's vendor libraries before mounting it (data-libs on the page);
  // mounting straight from the driver has to do the same or pdf.js/libraries are simply missing
  if (meta.needs?.length) {
    const { loadLib } = await libModule();
    await Promise.all(meta.needs.map(l => loadLib(l)));
  }
  document.querySelector('.scratch-host')?.remove();
  const host = document.createElement('div');
  // "panel" is not decoration here: lib.js run() appends its error to button.closest('.panel'),
  // falling back to document.body. Without the class every tool's error lands on <body>, where
  // nothing removes it, and the next 20 tools are reported as failing with the previous tool's
  // message. With it, dropping the host at the end of the sweep drops the error with it.
  host.className = 'scratch-host panel';
  host.style.cssText = 'margin:0;padding:12px;border:1px dashed #999';
  document.body.append(host);
  await mod.tools[id](host);
  return host;
}

// ---------------------------------------------------------------- run
export async function run({
  fixtures = [],
  set = {},            // { 'Page range': '1-2' } — substring match on the visible label
  click,               // optional: array of label substrings; defaults to every primary button
  skip = [],           // label substrings never to click (e.g. a destructive reset)
  prefix: prefixArg = 'out',
  wait = 2500,
  tool,                // when set, mount this tool id into a scratch host instead of the page's own
  text,                // paste this into the first textarea before clicking (text tools)
  noClick,             // do not press any button (tools whose only action is a native dialog)
  rafShim,             // stand in for requestAnimationFrame; see installRafShim()
  expect               // strings that must appear in the preview iframe, output or field values
} = {}) {
  patchDownloads();
  saved = [];
  pending = [];
  // the probe lives on the page between rows; only this tool's writes are of interest, and the
  // previous host was already removed by mountTool, so start from an empty set each run
  const stray = watchDetachedOutputs();
  stray.clear();
  prefix = prefixArg ? `${prefixArg}-` : '';
  const throttleMs = await measureThrottle();

  const errors = [];
  const onErr = e => errors.push(String(e.message || e));
  window.addEventListener('error', onErr);
  const onRej = e => errors.push(`unhandled: ${String(e?.reason?.message || e?.reason)}`);
  window.addEventListener('unhandledrejection', onRej);
  // lib.js run() catches the tool's error and console.error()s it before showing the note, so
  // without this hook the driver would report "nothing happened" instead of the real reason.
  const realError = console.error;
  console.error = (...a) => { errors.push(a.map(x => x?.message || String(x)).join(' ').slice(0, 200)); realError(...a); };

  let root = document.querySelector('#tool-root');
  const info = { tool: tool || location.pathname, mounted: false, fixtures: [], filled: [], clicked: [], downloads: [], errors, notes: [], output: [], throttleMs };
  const stopRafShim = rafShim ? installRafShim() : null;
  if (stopRafShim) info.rafShim = 'requestAnimationFrame replaced by a 16 ms timer (driver tab is hidden, so no frames arrive)';
  // every exit path must undo the hooks: the page lives on after a sweep, and a leaked
  // console.error wrapper would swallow the next tool's real failure
  const finish = () => {
    console.error = realError;
    if (stopRafShim) stopRafShim();
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onRej);
    return info;
  };
  if (tool) {
    try {
      root = await mountTool(tool);
    } catch (err) {
      errors.push(`mount ${tool}: ${String(err.message || err)}`);
      return finish();
    }
  }
  info.mounted = !!root?.children.length;
  if (!root) return finish();

  // text tools read a textarea rather than a file
  if (text) {
    // "@b64:photo-small.png" means "the fixture, base64-encoded" — that is the honest input for
    // base64-to-image, and pasting 34 KB through the eval would not fit
    let value = text;
    if (text.startsWith('@b64:')) {
      const { file } = await loadFixture(text.slice(5));
      value = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
    }
    const ta = root.querySelector('textarea');
    if (!ta) info.notes.push('asked for text but the tool has no textarea');
    else { ta.value = value; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    // several text tools are debounced and have no Run button at all: the result, and the Download
    // button that comes with it, only exist after their timer fires. Guessing a duration is what
    // made base64-to-image look dead in a throttled tab, so wait for the DOM to say something
    // instead — up to the row's own budget, then carry on and let the assertions report it.
    await until(() => /download|save|导出|下载/.test([...root.querySelectorAll('button')].map(b => b.textContent).join(' '))
      || [...root.querySelectorAll('.out, .result-card, .stat')].some(n => n.textContent.trim()), Math.max(wait, 3000));
  }

  // 1-2. fixtures
  const files = [];
  for (const n of fixtures) {
    const { file, bytes } = await loadFixture(n);
    files.push(file);
    info.fixtures.push([n, bytes, file.type]);
  }
  if (files.length) {
    const zone = root.querySelector('.drop');
    if (!zone) info.notes.push('no .drop zone on this page');
    else {
      await dropFiles(zone, files);
      // The tool has to acknowledge the drop before clicking Run means anything, otherwise a correct
      // tool reports "Add a file first". But it does that in more than one way: most render an
      // orderableList row, while trim-audio decodes silently and only writes "Decoding tone.wav…"
      // into a note — demanding `.file-row` alone marked it FAILED while it was producing a
      // byte-correct 105 KB WAV. So: a row, or any visible text quoting the file name, or a button
      // that has gone disabled while it works.
      const names = files.map(f => f.name);
      const ack = () => root.querySelector('.file-row')
        || [...root.querySelectorAll('button')].some(b => b.disabled)
        || [...root.querySelectorAll('.note, .out, .stat, .result-card, .kv, h3')]
          .some(n => names.some(nm => n.textContent.includes(nm)));
      const seen = await until(ack, 4000);
      if (!seen) info.notes.push(`dropped ${files.length} file(s) and the tool gave no sign of accepting them within 4 s`);
    }
  }

  // 3. fields
  if (Object.keys(set).length) {
    const fields = labelledInputs(root);
    for (const [want, value] of Object.entries(set)) {
      const hit = fields.find(f => f.label.toLowerCase().includes(want.toLowerCase()));
      if (!hit) { info.notes.push(`no field labelled "${want}" (have: ${fields.map(f => f.label).join(' | ')})`); continue; }
      info.filled.push(fillOne(hit, value));
    }
  }

  // 4. buttons. Primary = .btn without .ghost; that is the run/apply/convert action.
  const all = () => [...root.querySelectorAll('button.btn')];
  const primaries = all().filter(b => !b.className.includes('ghost'));
  info.buttons = all().map(b => b.textContent.trim()).filter(Boolean);
  const lower = b => b.textContent.trim().toLowerCase();
  const isGrabber = makeGrabberTest();
  let wanted = noClick ? [] : click
    ? primaries.filter(b => click.some(s => lower(b).includes(s.toLowerCase())))
    : primaries;
  // a debounced tool (base64-to-image) has no primary button at all: its only action is the ghost
  // "Download" that is already sitting in the result card. Without this the sweep pressed nothing and
  // reported a tool that works as "nothing happened".
  if (!wanted.length && !noClick && !click) {
    wanted = all().filter(isGrabber);
  }
  const skipped = all().filter(b => skip.some(s => lower(b).includes(s.toLowerCase())));

  for (const btn of wanted) {
    if (skipped.includes(btn)) continue;
    const before = new Set(all());
    // read the label before clicking: run() overwrites it with the progress message ("1/3"),
    // so sampling afterwards records the progress text instead of the action name
    const label = btn.textContent.trim();
    btn.click();
    // tools are async (pdf-lib, decode/encode); lib.js run() only re-enables the button in its
    // finally block, so waiting for that is the honest end-of-work signal. Encoding a video or a
    // big PDF is slow: 120 s, and a timeout is reported instead of silently carrying on.
    const t0 = Date.now();
    while (btn.disabled && Date.now() - t0 < 120000) await settle(100);
    if (btn.disabled) info.timedOut = `${label} still working after 120 s`;
    else info.msWorked = (info.msWorked || 0) + (Date.now() - t0);
    await settle(wait);
    info.clicked.push(label);

    // 5. most tools do not download by themselves: the run appends result rows carrying a ghost
    // "Download" (or, past six files, one "Download all (.zip)"). Click what just appeared.
    const fresh = all().filter(b => !before.has(b) && !skipped.includes(b));
    const grabbers = fresh.filter(isGrabber);
    for (const g of grabbers) {
      g.click();
      await settle(400);
      info.clicked.push(g.textContent.trim());
    }
    if (!grabbers.length && !saved.length && files.length) {
      info.notes.push(`file tool produced no download button (new buttons: ${fresh.map(lower).join(', ') || 'none'}; buttons after run: ${all().map(lower).join(', ')})`);
    }
  }

  await Promise.allSettled(pending);
  info.downloads = saved;
  // what the tool finally shows: for calculators and text tools this is the whole result, and
  // they have no button at all, so "produced output" is the only honest pass signal.
  info.output = [...root.querySelectorAll('.out, .stat, .result-card, code, pre, .kv, .swatches')]
    .map(n => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
  // still detached at the end of the run, and never connected during it => the result was thrown
  // away (see the probe's comment for why "was written while detached" alone is not enough)
  const stranded = stray.stray();
  if (stranded.length) {
    info.notes.push(`wrote the result into an output box that is not on the page: "${
      stranded.map(n => n.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)).join(' / ')}"`);
  }
  info.notes = [...info.notes, ...[...document.querySelectorAll('.note.err, .run-error')]
    // run() appends the message to the nearest .panel, falling back to document.body: in the
    // scratch host there is no panel, so the scan has to cover the whole document
    .map(n => n.textContent.trim()).filter(Boolean)];
  // what the plan says must be present, wherever the tool chose to put it
  if (expect?.length) {
    const hay = [
      root.querySelector('iframe')?.srcdoc || '',
      info.output.join(' '),
      [...root.querySelectorAll('textarea, input')].map(i => i.value).join('\n'),
      [...root.querySelectorAll('.result-card, .file-row, code, pre')].map(n => n.textContent).join(' '),
      // and the panel as the visitor reads it, labels included: the settings field labels are
      // precisely where the widget dictionary lands (w.level -> "Stufe"), and leaving them out made
      // an honest expectation about localisation impossible to write here. The page shell — h1,
      // <title>, nav — is still outside `root`, which is why check-locale-leak.mjs asserts those.
      root.textContent.replace(/\s+/g, ' ')
    ].join('\n');
    const missing = expect.filter(e => !hay.includes(e));
    info.expect = { want: expect, missing };
    if (missing.length) info.notes.push(`expected text never appeared: ${missing.join(' | ')}`);
  }
  console.error = realError;
  await settle(50);
  return finish();
}

// Chrome keeps a cached asset forever if the response ever said "immutable" — which is what the
// production headers do, and what the dev server said before it was fixed. A rebuild then stays
// invisible to the sweep, and it reports yesterday's bugs. fetch({cache:'reload'}) rewrites the
// cache entry, so navigate afterwards and the page picks up the current build.
export async function bustCache() {
  const urls = [
    '/_assets/lib.js', '/_assets/runtime.js', '/_assets/router.js', '/_assets/state.js',
    '/_assets/i18n.js', '/_assets/site.css',
    ...['pdf', 'image', 'text', 'calc'].map(c => `/_assets/tools/${c}.js`),
    ...['jszip.min.js', 'pdf-lib.min.js', 'pdf.min.js', 'pdf.worker.min.js',
      'qrcode-generator.min.js', 'gifenc.mjs', 'marked.min.js'].map(v => `/_assets/vendor/${v}`)
  ];
  const bad = [];
  for (const u of urls) {
    const r = await fetch(u, { cache: 'reload' });
    if (!r.ok) bad.push(`${u} ${r.status}`);
  }
  return { busted: urls.length, bad };
}

// Compact row per tool: enough to judge in the terminal, while the full detail for one tool is
// available by calling run() on its own.
export async function sweep(list, onRow) {
  const out = [];
  for (const item of list) {
    const t0 = Date.now();
    let r;
    try {
      r = await run(item);
    } catch (err) {
      out.push({ tool: item.tool || '?', ok: false, why: `driver threw: ${String(err.message || err)}` });
      onRow?.(out);
      continue;
    }
    const why = [];
    if (!r.mounted) why.push('not mounted');
    if (r.timedOut) why.push(r.timedOut);
    if (r.errors.length) why.push(`errors: ${r.errors.join(' / ')}`);
    if (r.notes.length) why.push(`notes: ${r.notes.join(' / ')}`);
    if (!r.clicked.length && !r.output.length && !(item.noClick || item.expect)) why.push('nothing happened: no button fired and no output');
    out.push({
      tool: r.tool,
      ok: !why.length,
      why: why.join(' | ') || null,
      clicks: r.clicked,
      bytes: r.downloads.map(d => `${d.saved} | ${d.bytes} | ${d.mime || '-'}`),
      output: r.output.map(o => o.slice(0, 110)),
      filled: r.filled,
      // reported, never a failure: a throttled tab explains a big ms without blaming the tool
      throttleMs: r.throttleMs,
      // and the same for the rAF stand-in: a row that only finished because the driver supplied
      // fake frames has to say so, or the next reader thinks pdf.js is fine in a hidden tab
      rafShim: r.rafShim,
      ms: Date.now() - t0
    });
    onRow?.(out);
  }
  return out;
}

// The page eval has a 15 s budget, and a 20-tool sweep needs minutes. So the sweep runs in the
// background and streams its rows to /__save, which drops the JSON in test-files/out/ for Node
// (scripts/browser-report.mjs) to read. Returns immediately.
export function startSweep(list, name = 'sweep.json') {
  // a row without a `tool` key is a real-URL page row (scripts/browser/sweep-pages.json) driven
  // on its own page, so label it by the URL the operator is looking at rather than "?"
  const rows = { done: false, startedAt: new Date().toISOString(), planned: list.map(i => i.tool || i.url || i.page || '?'), rows: [] };
  const save = () => fetch(`/__save?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(rows, null, 1) }).then(() => {}).catch(() => {});
  save();
  sweep(list, out => { rows.rows = out; save(); })
    .then(() => { rows.done = true; rows.finishedAt = new Date().toISOString(); return save(); })
    .catch(err => { rows.error = String(err && err.message || err); rows.done = true; return save(); });
  return { started: rows.planned.length, name, note: 'poll /__files until the json says done:true' };
}

// Small helper the report can call from the same eval: what the page thinks its locale is.
export function localeInfo() {
  return {
    path: location.pathname,
    htmlLang: document.documentElement.lang,
    bodyLocale: document.body.dataset.locale,
    cookie: document.cookie,
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim(),
    nav: [...document.querySelectorAll('nav a')].slice(0, 6).map(a => a.textContent.trim())
  };
}
