// PDF tools. All of them read the file locally with pdf-lib / pdf.js; nothing is sent anywhere.
import {
  fmt,
  el, $, D, t, bytes, pct, extOf, stem, download, downloadZip, fileZone, orderableList,
  loadLib, pdfWorker, run, note, stat, card, select, numberInput, textInput, rangeInput, checkInput,
  button, field, mmss, toast, copyText, loadCanvas, canvasFrom, toBlob, locale, add, fill
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
      if (!ok.length) { toast(D.common.wrongType || L('unsupportedFileType', 'Unsupported file type')); return; }
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
      field(L('dpi', 'Resolution'), rangeInput(1.6, 1, 3, 0.1, v => dpi = v, '×'), L('onlyUsedBySmallestFile', 'only used by Smallest file')),
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
          out.append(note(fmt(L('ui0AlreadyEfficient12', '{0}: already efficient ({1} → {2}). Try the Smallest file level.'), f.name, bytes(f.size), bytes(blob.size)), 'ok'));
        }
      }
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
    void redraw;
  },

  // A .docx is an OOXML ZIP: the bulk of a large document is the raster pictures under word/media/.
  // We recompress those in the browser (same format, same filename, so [Content_Types].xml and the
  // relationships stay valid), replace an entry only when the new bytes are actually smaller, then
  // re-zip the whole package at DEFLATE level 9. Text, styles and layout are never touched. Nothing
  // is uploaded. Old binary .doc and encrypted documents are not ZIPs, so they are refused clearly.
  'compress-word': async (root) => {
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const { files } = filePanel(root, { accept: `.docx,${DOCX_MIME}`, multiple: true, hint: L('cwHint', 'Drop .docx Word documents, or click to browse') });
    let mode = 'balanced', q = 0.7, maxDim = 1600;
    const out = outputBox(root);
    root.append(el('div', { class: 'controls' },
      field(L('mode', 'Mode'), select([
        ['balanced', L('qualityAuto', 'Recommended')],
        ['lossless', L('cwLossless', 'Lossless (re-zip only)')],
        ['smallest', L('qualitySmall', 'Smallest file')]
      ], mode, v => { mode = v; }), ''),
      field(L('quality', 'Quality'), rangeInput(70, 30, 95, 1, v => q = v / 100), L('cwQualityHint', 'lower = smaller embedded pictures')),
      field(L('cwMaxDim', 'Largest image side'), select([
        ['0', L('cwKeepSize', 'Keep original size')], ['1600', '1600 px'], ['1200', '1200 px'], ['800', '800 px']
      ], String(maxDim), v => { maxDim = Number(v); }), '')));
    root.append(note(L('cwDocOnly', '.docx only — the old .doc format and encrypted documents are not supported.')));
    const go = button(L('process', 'Run'), () => run(go, async tick => {
      out.replaceChildren();
      if (!files.length) throw new Error(L('needFile', 'Add a file first'));
      const JSZip = await loadLib('jszip');
      for (const [i, f] of files.entries()) {
        tick(`#${i + 1}/${files.length}`);
        let zip;
        try { zip = await JSZip.loadAsync(await f.arrayBuffer()); }
        catch { throw new Error(L('cwNotDocx', 'That is not a readable .docx file. The old .doc format and encrypted documents are not supported.')); }
        if (!zip.file('word/document.xml')) throw new Error(L('cwNotWord', 'This file is a ZIP archive but not a Word document (.docx).'));
        let recompressed = 0;
        if (mode !== 'lossless') {
          const cap = mode === 'smallest' ? Math.min(maxDim || 1200, 1200) : (maxDim || 0);
          const quality = mode === 'smallest' ? Math.min(q, 0.6) : q;
          for (const entry of zip.file(/^word\/media\//i)) {
            const ext = (entry.name.split('.').pop() || '').toLowerCase();
            const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext];
            if (!mime) continue;                         // emf/wmf/gif/bmp/tiff/svg: canvas cannot re-encode these safely
            try {
              const original = await entry.async('blob');
              const { canvas, img, width, height } = await loadCanvas(new File([original], entry.name));
              const longest = Math.max(width, height);
              const scale = cap && longest > cap ? cap / longest : 1;
              if (mime === 'image/png' && scale === 1) continue;   // PNG is lossless: same-size re-encode rarely shrinks
              const target = scale === 1 ? canvas : canvasFrom(img, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
              const blob = await toBlob(target, mime, quality);
              if (blob && blob.size < original.size) { zip.file(entry.name, blob); recompressed++; }
            } catch { /* an undecodable picture keeps its original bytes */ }
          }
        }
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 }, mimeType: DOCX_MIME });
        const gain = pct(blob.size, f.size);
        if (blob.size < f.size) {
          resultRow(out, extOf(f.name, 'docx'), blob.size, fmt(L('cwExtra', '−{0}% · {1} images'), gain, recompressed), blob);
        } else {
          out.append(note(fmt(L('ui0AlreadyEfficient12', '{0}: already efficient ({1} → {2}). Try the Smallest file level.'), f.name, bytes(f.size), bytes(blob.size)), 'ok'));
        }
      }
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
    root.append(note(L('cwNote', 'A .docx is a ZIP of XML plus pictures. This tool recompresses the embedded images and re-zips the package; your text, styles and layout stay untouched.')));
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
      resultRow(out, name, blob.size, fmt(L('ui0Pages', '{0} pages'), count), blob);
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
      field(L('pageRange', 'Page range'), textInput(range, v => range = v), L('eG38Or', 'e.g. 3-8 or 1,4,9-12')),
      field(L('pagesPerFile', 'Pages per file'), numberInput(chunk, v => chunk = Math.max(1, Number(v) || 1)), L('usedByChunkMode', 'used by chunk mode'))));
    const go = button(L('process', 'Run'), () => run(go, async () => {
      out.replaceChildren();
      const [{ doc }] = await loadPdf(files);
      const total = doc.getPageCount();
      const jobs = [];
      if (mode === 'range') {
        const idx = parseRange(range, total);
        if (!idx.length) throw new Error(L('enterAPageRangeSuch', 'Enter a page range such as 2-5'));
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
        out.append(note(fmt(L('ui0FilesProduced', '{0} files produced.'), jobs.length), 'ok'));
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
      field(L('pageRange', 'Page range'), textInput(range, v => range = v), L('leaveEmptyForEveryPage', 'leave empty for every page'))));
    const go = button(L('apply', 'Apply'), () => run(go, async () => {
      out.replaceChildren();
      const [{ doc }] = await loadPdf(files);
      const total = doc.getPageCount();
      const idx = range.trim() ? parseRange(range, total) : doc.getPageIndices();
      if (!idx.length) throw new Error(L('thatRangeDoesNotMatch', 'That range does not match any page'));
      const { degrees } = await loadLib('pdf-lib');
      idx.forEach(i => { const p = doc.getPage(i); p.setRotation(degrees((p.getRotation().angle + deg + 360) % 360)); });
      const blob = new Blob([await save(doc)], { type: PDF_MIME });
      resultRow(out, extOf(files[0].name, 'pdf'), blob.size, fmt(L('ui0PagesRotated', '{0} pages rotated'), idx.length), blob);
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
    root.append(el('div', { class: 'controls' }, field(L('pageRange', 'Page range'), textInput(range, v => range = v), L('emptyEveryPage', 'empty = every page'))));
    const go = button(L('addWatermark', 'Add watermark'), () => run(go, async () => {
      out.replaceChildren();
      if (!text.trim()) throw new Error(L('typeTheStampTextFirst', 'Type the stamp text first'));
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
      resultRow(out, extOf(files[0].name, 'pdf'), blob.size, fmt(L('ui0PagesStamped', '{0} pages stamped'), idx.length || total), blob);
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: L('theStampIsDrawnAs', 'The stamp is drawn as real text, so it scales cleanly in print.') })));
  },

  'pdf-to-jpg': async (root) => {
    const { files } = filePanel(root, { multiple: false });
    let scale = 2, fmt = 'image/jpeg';
    const out = outputBox(root);
    const grid = el('div', { class: 'preview-grid' });
    root.append(el('div', { class: 'controls' },
      field(L('format', 'Format'), select([['image/jpeg', 'JPG'], ['image/png', 'PNG']], fmt, v => fmt = v), ''),
      field(L('dpi', 'Resolution'), rangeInput(2, 1, 4, 0.5, v => scale = v, '×'), L('ui2150Dpi4300', '2× ≈ 150 dpi, 4× ≈ 300 dpi'))));
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
        out.append(note(L('thisPdfHasNoText', 'This PDF has no text layer — it is a scan of paper. Text extraction needs OCR, which does not run in a browser tab.'), 'err'));
        return;
      }
      const pre = el('pre', { text });
      const area = card(pre);
      out.append(area, el('div', { class: 'btn-row' },
        button(L('copy', 'Copy'), () => copyText(text), { kind: 'ghost' }),
        button(L('downloadTxt', 'Download as .txt'), () => download(new Blob([text], { type: 'text/plain' }), `${stem(files[0].name)}.txt`), { kind: 'ghost' }),
        el('span', { class: 'note', text: fmt(L('ui0Characters', '{0} characters'), text.length) })));
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
      resultRow(out, `${stem(files[0].name) || 'photos'}-pdf.pdf`, blob.size, fmt(L('ui0Pages', '{0} pages'), files.length), blob);
    }));
    root.append(el('div', { class: 'btn-row' }, go));
  },

  'html-to-pdf': async (root) => {
    let html = '<h1>Quarterly note</h1>\n<p>Paste your own HTML here, then open the print dialog.</p>\n<style>body{font-family:system-ui;padding:2rem}h1{color:#2f6df6}</style>';
    const editor = el('textarea', { spellcheck: 'false', style: 'min-height:220px' });
    editor.value = html;
    const frame = el('iframe', { title: L('preview2', 'preview'), style: 'width:100%;height:360px;border:1px solid var(--line);border-radius:12px;background:#fff' });
    const render = () => { frame.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank">${editor.value}`; };
    editor.addEventListener('input', () => { clearTimeout(editor._t); editor._t = setTimeout(render, 400); });
    render();
    root.append(el('div', { class: 'grid', style: 'gap:14px' },
      el('div', {}, field(L('input', 'Input'), editor, L('htmlMarkup', 'HTML markup')),
        el('div', { class: 'btn-row' },
          button(L('print', 'Open the print dialog'), () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
          }),
          button(L('loadHtmlFile', 'Load an .html file'), () => input.click(), { kind: 'ghost' }),
          el('span', { class: 'note', text: L('chooseSaveAsPdfAs', 'Choose Save as PDF as the destination.') }))),
      el('div', {}, field(L('preview', 'Preview'), frame, ''))));
    const input = el('input', { type: 'file', accept: '.html,text/html', hidden: true, onChange: async () => {
      editor.value = await input.files[0]?.text() || editor.value;
      render();
    } });
    root.append(input);
    if (frame.contentWindow) setTimeout(render, 0);
  },

  'pdf-page-numbers': async (root) => {
    const { files } = filePanel(root, { multiple: false });
    let position = 'bottom', align = 'center', start = 1, size = 12, prefix = '', skipFirst = false, range = '';
    const margin = 24;
    const out = outputBox(root);
    root.append(el('div', { class: 'controls' },
      field(L('position', 'Position'), select([['bottom', L('bottom', 'Bottom')], ['top', L('top', 'Top')]], position, v => position = v), ''),
      field(L('alignment', 'Alignment'), select([['left', L('alignLeft', 'Left')], ['center', L('alignCenter', 'Center')], ['right', L('alignRight', 'Right')]], align, v => align = v), ''),
      field(L('startNumber', 'Start number'), numberInput(start, v => start = Math.max(0, Math.round(Number(v) || 1))), ''),
      field(L('fontSize', 'Font size'), numberInput(size, v => size = Math.min(72, Math.max(6, Number(v) || 12))), 'pt'),
      field(L('prefix', 'Prefix'), textInput(prefix, v => prefix = v), L('prefixHint', 'Optional text before the number, e.g. "Page ".'))));
    root.append(el('div', { class: 'controls' },
      field(L('pageRange', 'Page range'), textInput(range, v => range = v), L('emptyEveryPage', 'empty = every page')),
      el('span', {}, checkInput(L('skipFirst', 'Skip the first page (cover)'), skipFirst, v => skipFirst = v))));
    const go = button(L('addPageNumbers', 'Add page numbers'), () => run(go, async () => {
      out.replaceChildren();
      const [{ doc }] = await loadPdf(files);
      const { StandardFonts, rgb } = await loadLib('pdf-lib');
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const total = doc.getPageCount();
      let idx = range.trim() ? parseRange(range, total) : doc.getPageIndices();
      if (skipFirst) idx = idx.filter(i => i !== 0);
      if (!idx.length) throw new Error(L('noPagesSelected', 'No pages left to number with that range.'));
      const ink = rgb(0.15, 0.15, 0.15);
      idx.forEach((i, k) => {
        const page = doc.getPage(i);
        const { width, height } = page.getSize();
        const label = `${prefix}${start + k}`;
        const w = font.widthOfTextAtSize(label, size);
        const x = align === 'left' ? margin : align === 'right' ? width - margin - w : (width - w) / 2;
        const y = position === 'top' ? height - margin - size : margin;
        page.drawText(label, { x, y, size, font, color: ink });
      });
      const blob = new Blob([await save(doc)], { type: PDF_MIME });
      resultRow(out, extOf(files[0].name, 'pdf'), blob.size, fmt(L('ui0PagesNumbered', '{0} pages numbered'), idx.length), blob);
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: L('pageNumbersNote', 'Numbers are added as real text in the margin; the original page content is untouched.') })));
  },

  // ------------------------------------------------------------ invoice-generator
  'invoice-generator': async (root) => {
    // The invoice is drawn on a canvas, then embedded as a PNG into a one-page PDF. Canvas fillText
    // is Unicode-capable, so the labels (L()) render in any language — pdf-lib's built-in Helvetica
    // is WinAnsi-only and would throw on Chinese, Japanese, Cyrillic, etc. This also keeps the PDF
    // path inside the methods the smoke harness stubs (embedPng / addPage / drawImage / save).
    const CW = 1240, M = 64, LH = 28;
    const F = { big: 'bold 46px sans-serif', h: 'bold 24px sans-serif', b: '20px sans-serif', s: '17px sans-serif', th: 'bold 19px sans-serif', total: 'bold 28px sans-serif' };
    const clampN = v => Math.min(100, Math.max(0, Number(v) || 0));
    let currency = 'USD';
    const ti = (ph, val = '') => { const i = el('input', { type: 'text', placeholder: ph, style: 'width:100%' }); i.value = val; return i; };
    const ta = (ph, val = '') => { const a = el('textarea', { placeholder: ph, spellcheck: 'false', style: 'width:100%;min-height:64px' }); a.value = val; return a; };
    const sellerName = ti(L('invoiceSellerName', 'Your name or company'));
    const sellerAddr = ta(L('invoiceSellerAddress', 'Your address, email, phone'));
    const buyerName = ti(L('invoiceBuyerName', 'Client name or company'));
    const buyerAddr = ta(L('invoiceBuyerAddress', 'Client address'));
    const invNo = ti(L('invoiceNoPlaceholder', 'INV-0001'), 'INV-0001');
    const invDate = el('input', { type: 'date', style: 'width:100%' }); invDate.value = new Date().toISOString().slice(0, 10);
    const CURRENCIES = ['USD', 'EUR', 'CNY', 'GBP', 'JPY', 'INR', 'AUD', 'CAD'];
    const curSel = select(CURRENCIES.map(c => [c, c]), currency, v => currency = v);
    const taxIn = numberInput(0, null, { min: 0, max: 100, step: 'any' });
    const discIn = numberInput(0, null, { min: 0, max: 100, step: 'any' });
    const notesIn = ta(L('invoiceNotesPlaceholder', 'Payment details, bank account, a thank-you note…'));
    const termsIn = ta(L('invoiceTermsPlaceholder', 'Payment due in 14 days. Late payments incur…'));
    const items = [];
    const itemsBox = el('div', { class: 'out' });
    const addItem = (desc = '', qty = 1, price = 0) => {
      const d = ti(L('invoiceItemDesc', 'Description of the item or service')); d.style.flex = '1'; d.style.minWidth = '180px';
      const q = numberInput(qty, null, { min: 0, step: 1 }); q.style.width = '84px';
      const p = numberInput(price, null, { min: 0, step: 'any' }); p.style.width = '120px';
      const rec = { d, q, p };
      const row = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap' }, d, q, p,
        button(L('invoiceRemoveItem', 'Remove'), () => { const i = items.indexOf(rec); if (i >= 0) items.splice(i, 1); row.remove(); }, { kind: 'ghost' }));
      rec.row = row; items.push(rec); itemsBox.append(row);
    };
    addItem();
    const out = outputBox(root);
    const wrap = (ctx, text, maxW, font) => {
      ctx.font = font;
      const lines = [];
      for (const para of String(text || '').split('\n')) {
        const words = para.split(/\s+/).filter(Boolean);
        if (!words.length) { lines.push(''); continue; }
        let line = '';
        for (const w of words) {
          const test = line ? `${line} ${w}` : w;
          if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test;
        }
        lines.push(line);
      }
      return lines;
    };
    const gen = button(L('invoiceGenerate', 'Generate invoice'), () => run(gen, async () => {
      const money = n => { try { return new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(n); } catch { return `${currency} ${n.toFixed(2)}`; } };
      const rows = items.map(r => ({ desc: r.d.value, qty: Number(r.q.value) || 0, price: Number(r.p.value) || 0 }));
      const subtotal = rows.reduce((s, r) => s + r.qty * r.price, 0);
      const discPct = clampN(Number(discIn.value) || 0), taxPct = clampN(Number(taxIn.value) || 0);
      const discount = subtotal * discPct / 100, taxable = subtotal - discount, tax = taxable * taxPct / 100, total = taxable + tax;
      const canvas = el('canvas', { width: CW, height: 1754 });
      const ctx = canvas.getContext('2d');
      const sellerLines = wrap(ctx, sellerAddr.value, 540, F.b);
      const buyerLines = wrap(ctx, buyerAddr.value, 540, F.b);
      const itemLines = rows.map(r => wrap(ctx, r.desc, 560, F.b));
      const notesLines = notesIn.value.trim() ? wrap(ctx, notesIn.value, CW - 2 * M, F.s) : [];
      const termsLines = termsIn.value.trim() ? wrap(ctx, termsIn.value, CW - 2 * M, F.s) : [];
      const nTotals = 2 + (discPct > 0 ? 1 : 0) + (taxPct > 0 ? 1 : 0);
      let need = M + 64 + 34 + Math.max(1, sellerLines.length) * LH + 28 + 34 + Math.max(1, buyerLines.length) * LH + 34 + 46;
      itemLines.forEach(ls => { need += Math.max(1, ls.length) * LH + 18; });
      need += 24 + nTotals * 38 + 24;
      if (notesLines.length) need += 32 + notesLines.length * 24 + 18;
      if (termsLines.length) need += 32 + termsLines.length * 24 + 18;
      need += 64 + M;
      canvas.height = Math.max(1754, Math.ceil(need));
      // draw pass — setting height reset the context, so every font/fill is applied as we go
      const line = (x1, y1, x2, y2, color = '#d8dee9') => { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      const put = (str, x, y, font, color = '#1f2937', align = 'left') => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(str, x, y); };
      let y = M;
      put(L('invoiceTitle', 'INVOICE'), M, y + 40, F.big, '#111827'); y += 64;
      put(sellerName.value || L('invoiceSellerName', 'Your name or company'), M, y + 22, F.h); y += 34;
      ctx.textAlign = 'left';
      sellerLines.forEach((ln, i) => put(ln, M, y + 20 + i * LH, F.b, '#4b5563')); y += Math.max(1, sellerLines.length) * LH + 28;
      put(L('invoiceBillTo', 'Bill To'), M, y + 22, F.h, '#111827'); y += 34;
      put(buyerName.value || L('invoiceBuyerName', 'Client name or company'), M, y + 20, F.b); y += 28;
      buyerLines.forEach((ln, i) => put(ln, M, y + 18 + i * LH, F.b, '#4b5563')); y += Math.max(1, buyerLines.length) * LH + 34;
      // meta box, top-right
      put(`${L('invoiceNo', 'Invoice no.')}  ${invNo.value || '—'}`, CW - M, M + 24, F.b, '#111827', 'right');
      put(`${L('invoiceDate', 'Date')}  ${invDate.value || '—'}`, CW - M, M + 54, F.b, '#4b5563', 'right');
      // table
      const cDesc = M, cQty = 828, cPrice = 988, cAmt = CW - M;
      ctx.fillStyle = '#f3f4f6'; ctx.fillRect(M, y, CW - 2 * M, 40);
      put(L('invoiceDescription', 'Description'), cDesc + 10, y + 27, F.th, '#374151');
      put(L('invoiceQty', 'Qty'), cQty, y + 27, F.th, '#374151', 'right');
      put(L('invoiceUnitPrice', 'Unit price'), cPrice, y + 27, F.th, '#374151', 'right');
      put(L('invoiceAmount', 'Amount'), cAmt - 10, y + 27, F.th, '#374151', 'right');
      y += 46;
      rows.forEach((r, i) => {
        const ls = itemLines[i].length ? itemLines[i] : [''];
        const rh = Math.max(1, ls.length) * LH;
        ls.forEach((ln, k) => put(ln, cDesc + 10, y + 20 + k * LH, F.b, '#1f2937'));
        put(String(r.qty), cQty, y + 20, F.b, '#1f2937', 'right');
        put(money(r.price), cPrice, y + 20, F.b, '#1f2937', 'right');
        put(money(r.qty * r.price), cAmt - 10, y + 20, F.b, '#1f2937', 'right');
        y += rh + 18; line(M, y - 9, CW - M, y - 9);
      });
      y += 24;
      const totalRow = (label, value, bold) => { put(label, cPrice, y + 24, bold ? F.total : F.b, bold ? '#111827' : '#4b5563', 'right'); put(value, cAmt - 10, y + 24, bold ? F.total : F.b, bold ? '#111827' : '#1f2937', 'right'); y += 38; };
      totalRow(L('invoiceSubtotal', 'Subtotal'), money(subtotal));
      if (discPct > 0) totalRow(`${L('invoiceDiscount', 'Discount')} (${discPct}%)`, `−${money(discount)}`);
      if (taxPct > 0) totalRow(`${L('invoiceTax', 'Tax')} (${taxPct}%)`, money(tax));
      line(cPrice - 200, y - 12, CW - M, y - 12, '#9ca3af');
      totalRow(L('invoiceTotal', 'Total'), money(total), true);
      y += 24;
      if (notesLines.length) { put(L('invoiceNotes', 'Notes'), M, y + 20, F.h, '#111827'); y += 32; notesLines.forEach((ln, i) => put(ln, M, y + 18 + i * 24, F.s, '#4b5563')); y += notesLines.length * 24 + 18; }
      if (termsLines.length) { put(L('invoiceTerms', 'Terms'), M, y + 20, F.h, '#111827'); y += 32; termsLines.forEach((ln, i) => put(ln, M, y + 18 + i * 24, F.s, '#4b5563')); y += termsLines.length * 24 + 18; }
      put(L('invoiceThanks', 'Thank you for your business.'), M, canvas.height - M + 8, F.s, '#9ca3af');
      const pngBlob = await toBlob(canvas, 'image/png');
      const pdfBtn = button(L('invoiceDownloadPdf', 'Download PDF'), () => run(pdfBtn, async () => {
        const { PDFDocument } = await loadLib('pdf-lib');
        const doc = await PDFDocument.create();
        const png = await doc.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));
        const pw = 595.28, ph = 595.28 * canvas.height / canvas.width;
        const page = doc.addPage([pw, ph]);
        page.drawImage(png, { x: 0, y: 0, width: pw, height: ph });
        download(new Blob([await doc.save()], { type: PDF_MIME }), 'invoice.pdf');
      }));
      fill(out,
        el('img', { src: URL.createObjectURL(pngBlob), alt: '', style: 'width:100%;max-width:660px;border:1px solid var(--line);border-radius:8px;display:block' }),
        el('div', { class: 'btn-row' }, pdfBtn, button(L('invoiceDownloadPng', 'Download PNG'), () => download(pngBlob, 'invoice.png'), { kind: 'ghost' })));
    }));
    root.append(
      el('div', { class: 'controls' },
        field(L('invoiceSeller', 'From (seller)'), sellerName, ''),
        field(L('invoiceSellerAddressLabel', 'Seller address'), sellerAddr, ''),
        field(L('invoiceBuyer', 'Bill To (client)'), buyerName, ''),
        field(L('invoiceBuyerAddressLabel', 'Client address'), buyerAddr, '')),
      el('div', { class: 'controls' },
        field(L('invoiceNo', 'Invoice no.'), invNo, ''),
        field(L('invoiceDate', 'Date'), invDate, ''),
        field(L('invoiceCurrency', 'Currency'), curSel, ''),
        field(L('invoiceTax', 'Tax'), taxIn, '%'),
        field(L('invoiceDiscount', 'Discount'), discIn, '%')),
      el('h3', { text: L('invoiceItems', 'Line items') }),
      itemsBox,
      el('div', { class: 'btn-row' }, button(L('invoiceAddItem', 'Add item'), () => addItem(), { kind: 'ghost' })),
      el('div', { class: 'controls' },
        field(L('invoiceNotes', 'Notes'), notesIn, ''),
        field(L('invoiceTerms', 'Terms'), termsIn, '')),
      el('div', { class: 'btn-row' }, gen, el('span', { class: 'note', text: D.tool.privacyLine })),
      out,
      note(L('invoiceNote', 'Everything is drawn in your browser and exported as a PNG or a one-page PDF — no data is uploaded. Check the totals and your local tax rules before sending.')));
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
