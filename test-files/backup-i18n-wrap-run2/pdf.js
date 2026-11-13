// PDF tools. All of them read the file locally with pdf-lib / pdf.js; nothing is sent anywhere.
import {
  el, $, D, t, bytes, pct, extOf, stem, download, downloadZip, fileZone, orderableList,
  loadLib, pdfWorker, run, note, stat, card, select, numberInput, textInput, rangeInput, checkInput,
  button, field, mmss, toast, copyText, loadCanvas, toBlob
} from '../lib.js';

const L = (k, fb) => t(k, fb);
const PDF_MIME = 'application/pdf';

async function loadPdf(files, { ignoreEncryption = true } = {}) {
  // every PDF tool destructures the first entry, so an empty list has to fail here with a
  // readable hint rather than as "undefined is not an object" further down
  if (!files.length) throw new Error(L('needFile', 'Add a file first'));
  const { PDFDocument } = await loadLib('pdf-lib');
  return Promise.all(files.map(async f => {
    const bytesIn = new Uint8Array(await f.arrayBuffer());
    return { file: f, bytes: bytesIn, doc: await PDFDocument.load(bytesIn, { ignoreEncryption }) };
  }));
}
const save = (doc, opts) => doc.save({ useObjectStreams: true, ...opts });
const asPdf = (u8, name) => new File([new Blob([u8], { type: PDF_MIME })], name, { type: PDF_MIME });
const parseRange = (input, total) => {
  // "3-8,10" -> [2,3,4,5,6,7,9]
  const out = [];
  for (const part of String(input || '').split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)?(?:-(\d+)?)?$/);
    if (!m) continue;
    const from = Math.max(1, Number(m[1] || 1));
    const to = Math.min(total, m[2] === undefined || m[2] === '' ? (m[1] ? from : total) : Number(m[2]));
    for (let i = from; i <= to; i++) out.push(i - 1);
  }
  return [...new Set(out)].sort((a, b) => a - b);
};

function filePanel(root, { accept = PDF_MIME, multiple = true, hint } = {}) {
  // the check has to come from `accept`, not from a hardcoded PDF test: images-to-pdf calls this
  // with accept "image/*" and a fixed PDF filter rejected every image a user dropped into it
  const kinds = accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isOk = f => f.size > 0 && kinds.some(k => k.endsWith('/*')
    ? (f.type || '').startsWith(k.slice(0, -1))
    : f.type === k || (k.startsWith('.') && f.name.toLowerCase().endsWith(k)));
  const files = [];
  const list = el('div');
  let ui;
  const onChange = f => { files.length = 0; files.push(...f); ui.draw(); };
  ui = orderableList(list, files, { onChange, label: hint });
  fileZone(root, {
    accept, multiple, hint,
    onFiles: incoming => {
      const ok = incoming.filter(isOk);
      if (!ok.length) { toast(D.common.wrongType || 'Unsupported file type'); return; }
      if (!multiple && files.length >= 1) { files.length = 0; }
      files.push(...(multiple ? ok : [ok[0]]));
      ui.draw();
    }
  });
  root.append(list);
  return { files, redraw: () => ui.draw() };
}

function outputBox(root) {
  const box = el('div', { class: 'out' });
  root.append(box);
  return box;
}
function resultRow(box, name, size, extra, blob) {
  const row = el('div', { class: 'result-card', style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
    el('span', { class: 'nm', text: name, style: 'flex:1;min-width:160px;font-weight:600' }),
    el('span', { class: 'sz', text: bytes(size) }),
    extra ? el('span', { class: 'delta', text: extra }) : null,
    button(L('download', 'Download'), () => download(blob, name), { kind: 'ghost' }));
  box.append(row);
  return row;
}

// ---------------------------------------------------------------- compress-pdf
export const tools = {

  'compress-pdf': async (root) => {
    const { files, redraw } = filePanel(root, { multiple: true });
    const levels = [
      ['smart', L('qualityAuto', 'Recommended'), `${L('level', 'Level')}: rebuild objects, drop metadata (text stays selectable)`],
      ['lossless', L('qualityHigh', 'Best quality'), 'pdf-lib re-save only, no image change'],
      ['small', L('qualitySmall', 'Smallest file'), 'renders pages as images: much smaller, text no longer selectable']
    ];
    let level = 'smart';
    let dpi = 1.6, q = 0.62;
    const out = outputBox(root);
    root.append(el('div', { class: 'controls' },
      field(L('level', 'Level'), select(levels.map(l => [l[0], l[1]]), level, v => { level = v; }), ''),
      field(L('dpi', 'Resolution'), rangeInput(1.6, 1, 3, 0.1, v => dpi = v, '×'), 'only used by Smallest file'),
      field(L('quality', 'Quality'), rangeInput(62, 30, 95, 1, v => q = v / 100), '')));
    const go = button(L('process', 'Run'), () => run(go, async tick => {
      out.replaceChildren();
      if (!files.length) throw new Error(L('needFile', 'Add a file first'));
      for (const [i, f] of files.entries()) {
        tick(`#${i + 1}/${files.length}`);
        let blob;
        if (level === 'small') {
          blob = await rasterCompress(f, dpi, q);
        } else {
          const [{ doc }] = await loadPdf([f]);
          doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]);
          doc.setProducer(''); doc.setCreator('');
          doc.setModificationDate(new Date());
          const u8 = await save(doc, { useObjectStreams: true });
          blob = new Blob([u8], { type: PDF_MIME });
          if (level === 'smart' && blob.size >= f.size) blob = await rasterCompress(f, 1.8, 0.7);
        }
        const gain = pct(blob.size, f.size);
        if (blob.size < f.size) {
          resultRow(out, extOf(f.name, 'pdf'), blob.size, `−${gain}%`, blob);
        } else {
          out.append(note(`${f.name}: already efficient (${bytes(f.size)} → ${bytes(blob.size)}). Try the Smallest file level.`, 'ok'));
        }
      }
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
    void redraw;
  },

  'merge-pdf': async (root) => {
    const { files } = filePanel(root, { multiple: true, label: true });
    const out = outputBox(root);
    const go = button(L('btnMerge', 'Merge'), () => run(go, async () => {
      out.replaceChildren();
      if (files.length < 2) throw new Error(L('needFiles', 'Add at least two files'));
      const { PDFDocument } = await loadLib('pdf-lib');
      const target = await PDFDocument.create();
      let count = 0;
      for (const f of files) {
        const src = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { ignoreEncryption: true });
        const pages = await target.copyPages(src, src.getPageIndices());
        pages.forEach(p => target.addPage(p));
        count += pages.length;
      }
      target.setTitle(files[0].name.replace(/\.pdf$/i, ''));
      const u8 = await save(target);
      const blob = new Blob([u8], { type: PDF_MIME });
      const name = `merged-${count}-pages.pdf`;
      resultRow(out, name, blob.size, `${count} pages`, blob);
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: L('mergeNote', 'Files are merged in the order shown.') })));
  },

  'split-pdf': async (root) => {
    const { files } = filePanel(root, { multiple: false });
    let mode = 'range', range = '1-1', chunk = 5;
    const out = outputBox(root);
    root.append(el('div', { class: 'controls' },
      field(L('mode', 'Mode'), select([
        ['range', L('extractRange', 'Extract a range')], ['each', L('extractEach', 'Save each page as a separate file')], ['chunk', L('splitIntoChunks', 'Split into chunks')]
      ], mode, v => mode = v), ''),
      field(L('pageRange', 'Page range'), textInput(range, v => range = v), 'e.g. 3-8 or 1,4,9-12'),
      field(L('pagesPerFile', 'Pages per file'), numberInput(chunk, v => chunk = Math.max(1, Number(v) || 1)), 'used by chunk mode')));
    const go = button(L('process', 'Run'), () => run(go, async () => {
      out.replaceChildren();
      const [{ doc }] = await loadPdf(files);
      const total = doc.getPageCount();
      const jobs = [];
      if (mode === 'range') {
        const idx = parseRange(range, total);
        if (!idx.length) throw new Error('Enter a page range such as 2-5');
        jobs.push({ idx, name: `${stem(files[0].name)}-pages.pdf` });
      } else if (mode === 'each') {
        for (let i = 0; i < total; i++) jobs.push({ idx: [i], name: `${stem(files[0].name)}-p${i + 1}.pdf` });
      } else {
        for (let i = 0; i < total; i += chunk) jobs.push({ idx: Array.from({ length: Math.min(chunk, total - i) }, (_, k) => i + k), name: `${stem(files[0].name)}-part${Math.floor(i / chunk) + 1}.pdf` });
      }
      const blobs = [];
      for (const job of jobs) {
        const { PDFDocument } = await loadLib('pdf-lib');
        const one = await PDFDocument.create();
        (await one.copyPages(doc, job.idx)).forEach(p => one.addPage(p));
        const blob = new Blob([await save(one)], { type: PDF_MIME });
        blobs.push({ blob, name: job.name });
        if (jobs.length <= 6) resultRow(out, job.name, blob.size, `${job.idx.length}p`, blob);
      }
      if (jobs.length > 6) {
        out.append(note(`${jobs.length} files produced.`, 'ok'));
        const zipName = `${stem(files[0].name)}-split.zip`;
        out.append(el('div', { class: 'btn-row' }, button(L('downloadAll', 'Download all (.zip)'), () => downloadZip(blobs, zipName))));
      }
    }));
    root.append(el('div', { class: 'btn-row' }, go));
  },

  'rotate-pdf': async (root) => {
    const { files } = filePanel(root, { multiple: false });
    let deg = 90, range = '';
    const out = outputBox(root);
    root.append(el('div', { class: 'controls' },
      field(L('angle', 'Angle'), select([['90', '90° →'], ['180', '180°'], ['270', '90° ←']], String(deg), v => deg = Number(v)), ''),
      field(L('pageRange', 'Page range'), textInput(range, v => range = v), 'leave empty for every page')));
    const go = button(L('apply', 'Apply'), () => run(go, async () => {
      out.replaceChildren();
      const [{ doc }] = await loadPdf(files);
      const total = doc.getPageCount();
      const idx = range.trim() ? parseRange(range, total) : doc.getPageIndices();
      if (!idx.length) throw new Error('That range does not match any page');
      const { degrees } = await loadLib('pdf-lib');
      idx.forEach(i => { const p = doc.getPage(i); p.setRotation(degrees((p.getRotation().angle + deg + 360) % 360)); });
      const blob = new Blob([await save(doc)], { type: PDF_MIME });
      resultRow(out, extOf(files[0].name, 'pdf'), blob.size, `${idx.length} pages rotated`, blob);
    }));
    root.append(el('div', { class: 'btn-row' }, go));
  },

  'watermark-pdf': async (root) => {
    const { files } = filePanel(root, { multiple: false });
    let text = 'DRAFT', size = 48, opacity = 22, angle = 45, below = false, range = '';
    const out = outputBox(root);
    root.append(el('div', { class: 'controls' },
      field(L('textPlain', 'Text'), textInput(text, v => text = v), ''),
      field(L('fontSize', 'Font size'), numberInput(size, v => size = Number(v) || 48), 'pt'),
      field(L('opacity', 'Opacity'), rangeInput(opacity, 5, 100, 1, v => opacity = v, '%'), ''),
      field(L('angle', 'Angle'), rangeInput(angle, 0, 90, 5, v => angle = v, '°'), ''),
      field(L('color', 'Colour'), select([['gray', L('colorGray', 'Gray')], ['red', L('colorRed', 'Red')], ['blue', L('colorBlue', 'Blue')]], 'gray', v => color = v), '')));
    let color = 'gray';
    root.append(el('label', { class: 'check' }, checkInput(L('stampBehind', 'Put the stamp behind the content'), below, v => below = v)));
    root.append(el('div', { class: 'controls' }, field(L('pageRange', 'Page range'), textInput(range, v => range = v), 'empty = every page')));
    const go = button(L('addWatermark', 'Add watermark'), () => run(go, async () => {
      out.replaceChildren();
      if (!text.trim()) throw new Error('Type the stamp text first');
      const [{ doc }] = await loadPdf(files);
      const { StandardFonts, rgb, degrees: rotate } = await loadLib('pdf-lib');
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const tint = { gray: rgb(.55, .55, .55), red: rgb(.83, .18, .18), blue: rgb(.18, .3, .83) }[color];
      const total = doc.getPageCount();
      const idx = range.trim() ? parseRange(range, total) : doc.getPageIndices();
      (idx.length ? idx : doc.getPageIndices()).forEach(i => {
        const page = doc.getPage(i);
        const { width, height } = page.getSize();
        const w = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: width / 2 - (w * Math.cos(angle * Math.PI / 180)) / 2,
          y: height / 2 + (w * Math.sin(angle * Math.PI / 180)) / 2,
          size, font, color: tint, opacity: opacity / 100, rotate: rotate(angle), lineHeight: 1
        });
      });
      const blob = new Blob([await save(doc)], { type: PDF_MIME });
      resultRow(out, extOf(files[0].name, 'pdf'), blob.size, `${idx.length || total} pages stamped`, blob);
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: 'The stamp is drawn as real text, so it scales cleanly in print.' })));
  },

  'pdf-to-jpg': async (root) => {
    const { files } = filePanel(root, { multiple: false });
    let scale = 2, fmt = 'image/jpeg';
    const out = outputBox(root);
    const grid = el('div', { class: 'preview-grid' });
    root.append(el('div', { class: 'controls' },
      field(L('format', 'Format'), select([['image/jpeg', 'JPG'], ['image/png', 'PNG']], fmt, v => fmt = v), ''),
      field(L('dpi', 'Resolution'), rangeInput(2, 1, 4, 0.5, v => scale = v, '×'), '2× ≈ 150 dpi, 4× ≈ 300 dpi')));
    const go = button(L('process', 'Run'), () => run(go, async tick => {
      if (!files.length) throw new Error(L('needFile', 'Add a file first'));
      out.replaceChildren(); grid.replaceChildren();
      const pdfjs = await pdfWorker();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await files[0].arrayBuffer()) }).promise;
      const items = [];
      for (let i = 1; i <= doc.numPages; i++) {
        tick(`${i}/${doc.numPages}`);
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = el('canvas', { width: viewport.width, height: viewport.height });
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const blob = await toBlob(canvas, fmt, 0.92);
        const name = `${stem(files[0].name)}-p${i}.${fmt === 'image/png' ? 'png' : 'jpg'}`;
        items.push({ blob, name });
        grid.append(el('figure', {}, el('img', { src: URL.createObjectURL(blob), alt: name }), el('figcaption', { text: name })));
      }
      out.append(grid);
      const row = el('div', { class: 'btn-row' });
      if (items.length === 1) row.append(button(L('download', 'Download'), () => download(items[0].blob, items[0].name)));
      else row.append(button(`${L('downloadAll', 'Download all (.zip)')} (${items.length})`, () => downloadZip(items, `${stem(files[0].name)}-pages.zip`)));
      out.append(row);
    }));
    root.append(el('div', { class: 'btn-row' }, go));
  },

  'pdf-to-text': async (root) => {
    const { files } = filePanel(root, { multiple: false });
    let layout = 'lines';
    root.append(el('div', { class: 'controls' },
      field(L('mode', 'Mode'), select([['lines', L('readingOrder', 'Reading order (merge lines into paragraphs)')], ['raw', L('oneItemPerLine', 'One text item per line')]], layout, v => layout = v), '')));
    const out = outputBox(root);
    const go = button(L('extractText', 'Extract text'), () => run(go, async tick => {
      if (!files.length) throw new Error(L('needFile', 'Add a file first'));
      out.replaceChildren();
      const pdfjs = await pdfWorker();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await files[0].arrayBuffer()) }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        tick(`${i}/${doc.numPages}`);
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        if (layout === 'raw') {
          text += content.items.map(it => it.str).join('\n') + '\n\n';
        } else {
          // group items by their y position, then join runs on the same line
          const rows = new Map();
          for (const it of content.items) {
            const y = Math.round(it.transform[5] / 3) * 3;
            rows.set(y, (rows.get(y) || '') + it.str + (it.hasEOL ? '\n' : ' '));
          }
          text += [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, s]) => s.trim()).join('\n') + `\n\n— page ${i} —\n\n`;
        }
      }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
      if (!text) {
        out.append(note('This PDF has no text layer — it is a scan of paper. Text extraction needs OCR, which does not run in a browser tab.', 'err'));
        return;
      }
      const pre = el('pre', { text });
      const area = card(pre);
      out.append(area, el('div', { class: 'btn-row' },
        button(L('copy', 'Copy'), () => copyText(text), { kind: 'ghost' }),
        button(L('downloadTxt', 'Download as .txt'), () => download(new Blob([text], { type: 'text/plain' }), `${stem(files[0].name)}.txt`), { kind: 'ghost' }),
        el('span', { class: 'note', text: `${text.length} characters` })));
    }));
    root.append(el('div', { class: 'btn-row' }, go));
  },

  'images-to-pdf': async (root) => {
    const { files } = filePanel(root, { accept: 'image/*', multiple: true });
    let fit = 'fit', paper = 'a4', margin = 24, landscape = false;
    root.append(el('div', { class: 'controls' },
      field(L('orientation', 'Orientation'), select([['fit', L('fitImageToPage', 'Fit image to page')], ['fill', L('fillPageCrop', 'Fill page (crop)')]], fit, v => fit = v), ''),
      field(L('margins', 'Margins'), rangeInput(margin, 0, 72, 4, v => margin = v, 'pt'), ''),
      checkInput(L('landscapePages', 'Landscape pages'), landscape, v => landscape = v)));
    const out = outputBox(root);
    const go = button(L('createPdf', 'Create PDF'), () => run(go, async tick => {
      out.replaceChildren();
      if (!files.length) throw new Error(L('needImage', 'Add an image first'));
      const { PDFDocument } = await loadLib('pdf-lib');
      const doc = await PDFDocument.create();
      const SIZES = { a4: [595.28, 841.89], letter: [612, 792], a5: [420.94, 595.28] };
      for (const [i, f] of files.entries()) {
        tick(`${i + 1}/${files.length}`);
        const img = await embedImage(doc, f);
        const ratio = img.width / img.height;
        let [pw, ph] = SIZES.a4;
        if (landscape) [pw, ph] = [ph, pw];
        const iw = pw - margin * 2, ih = ph - margin * 2;
        let dw = iw, dh = iw / ratio;
        if (dh > ih) { dh = ih; dw = ih * ratio; }
        const page = doc.addPage([pw, ph]);
        if (fit === 'fill') {
          const scale = Math.max(pw / dw, ph / dh);
          page.drawImage(img, { x: (pw - dw * scale) / 2, y: (ph - dh * scale) / 2, width: dw * scale, height: dh * scale });
        } else {
          page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
        }
        void paper;
      }
      const blob = new Blob([await save(doc)], { type: PDF_MIME });
      resultRow(out, `${stem(files[0].name) || 'photos'}-pdf.pdf`, blob.size, `${files.length} pages`, blob);
    }));
    root.append(el('div', { class: 'btn-row' }, go));
  },

  'html-to-pdf': async (root) => {
    let html = '<h1>Quarterly note</h1>\n<p>Paste your own HTML here, then open the print dialog.</p>\n<style>body{font-family:system-ui;padding:2rem}h1{color:#2f6df6}</style>';
    const editor = el('textarea', { spellcheck: 'false', style: 'min-height:220px' });
    editor.value = html;
    const frame = el('iframe', { title: 'preview', style: 'width:100%;height:360px;border:1px solid var(--line);border-radius:12px;background:#fff' });
    const render = () => { frame.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank">${editor.value}`; };
    editor.addEventListener('input', () => { clearTimeout(editor._t); editor._t = setTimeout(render, 400); });
    render();
    root.append(el('div', { class: 'grid', style: 'gap:14px' },
      el('div', {}, field(L('input', 'Input'), editor, 'HTML markup'),
        el('div', { class: 'btn-row' },
          button(L('print', 'Open the print dialog'), () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
          }),
          button(L('loadHtmlFile', 'Load an .html file'), () => input.click(), { kind: 'ghost' }),
          el('span', { class: 'note', text: 'Choose Save as PDF as the destination.' }))),
      el('div', {}, field(L('preview', 'Preview'), frame, ''))));
    const input = el('input', { type: 'file', accept: '.html,text/html', hidden: true, onChange: async () => {
      editor.value = await input.files[0]?.text() || editor.value;
      render();
    } });
    root.append(input);
    if (frame.contentWindow) setTimeout(render, 0);
  }
};

// helpers shared by the PDF tools -------------------------------------------------
async function embedImage(doc, file) {
  const type = file.type.toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return doc.embedJpg(await file.arrayBuffer());
  if (type === 'image/png') return doc.embedPng(await file.arrayBuffer());
  // anything else (webp, heic, gif) is re-drawn through canvas to PNG bytes
  const c = await loadCanvas(file);
  return doc.embedPng(await (await toBlob(c.canvas, 'image/png')).arrayBuffer());
}

async function rasterCompress(file, scale, quality) {
  const pdfjs = await pdfWorker();
  const src = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(src) }).promise;
  const { PDFDocument } = await loadLib('pdf-lib');
  const out = await PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = el('canvas', { width: Math.round(viewport.width), height: Math.round(viewport.height) });
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const jpg = await toBlob(canvas, 'image/jpeg', quality);
    const img = await out.embedJpg(await jpg.arrayBuffer());
    const p = out.addPage([viewport.width, viewport.height]);
    p.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  }
  return new Blob([await save(out)], { type: PDF_MIME });
}

async function degrees(deg) {
  const { degrees: d } = await loadLib('pdf-lib');
  return d(deg);
}
