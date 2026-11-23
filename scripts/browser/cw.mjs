// Real-browser functional driver for compress-word, served by dev-server at /__script/cw.mjs.
// Builds genuine .docx packages in-page (JSZip + a canvas noise JPEG), feeds them through the tool's
// own file input / Run button, captures the produced blob by hooking URL.createObjectURL, re-opens it
// with JSZip to prove the package stays valid and the picture actually shrank, and exercises the error
// paths and the live controls. Run on the EN page so the Run button label is stable.
export default async function run() {
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const { loadLib } = await import('/_assets/lib.js');
  const JSZip = await loadLib('jszip');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const runBtn = document.querySelector('.btn-row button');
  const panel = runBtn.closest('.panel');
  const out = panel.querySelector('.out');
  const input = panel.querySelector('.drop input[type=file]');
  const sels = panel.querySelectorAll('.controls select');
  const modeSel = sels[0], dimSel = sels[1];
  const qRange = panel.querySelector('.controls input[type=range]');

  const captured = [];
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = b => { captured.push(b); return origCreate(b); };

  const clearFiles = () => { let rows; while ((rows = panel.querySelectorAll('.file-row')).length) { const b = rows[0].querySelectorAll('button'); b[b.length - 1].click(); } };
  const inject = file => { clearFiles(); const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
  const setSel = (s, v) => { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
  const setRange = (r, v) => { r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); };
  async function clickRun() { runBtn.click(); for (let i = 0; i < 300; i++) { await sleep(50); if (!runBtn.disabled) break; } await sleep(120); }
  function readResult() {
    const err = panel.querySelector('.note.err.run-error');
    if (err) return { kind: 'error', text: err.textContent.trim() };
    const card = out.querySelector('.result-card');
    if (card) return { kind: 'result', name: card.querySelector('.nm')?.textContent.trim(), size: card.querySelector('.sz')?.textContent.trim(), delta: card.querySelector('.delta')?.textContent.trim() };
    const ok = out.querySelector('.note.ok');
    if (ok) return { kind: 'ok', text: ok.textContent.trim() };
    return { kind: 'none', text: out.textContent.trim().slice(0, 140) };
  }
  async function grabOutput() {
    const card = out.querySelector('.result-card'); if (!card) return null;
    const dl = [...card.querySelectorAll('button')].pop();
    const n = captured.length; dl.click(); await sleep(150);
    return captured[n] || null;
  }
  async function inspect(blob) {
    if (!blob) return null;
    const z = await JSZip.loadAsync(blob);
    const img = z.file('word/media/image1.jpeg');
    return { docxBytes: blob.size, hasDocumentXml: !!z.file('word/document.xml'), hasContentTypes: !!z.file('[Content_Types].xml'), imageBytes: img ? (await img.async('blob')).size : null, mediaCount: z.file(/^word\/media\//).length };
  }
  async function save(blob, name) { if (!blob) return null; const r = await fetch('/__save?name=' + encodeURIComponent(name), { method: 'POST', body: blob }); return await r.json(); }

  async function noiseJpeg(w, h, q) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); const id = ctx.createImageData(w, h);
    for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.random() * 256 | 0; id.data[i + 1] = Math.random() * 256 | 0; id.data[i + 2] = Math.random() * 256 | 0; id.data[i + 3] = 255; }
    ctx.putImageData(id, 0, 0);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', q));
  }
  const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const DOC = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ClearLight compress-word test document.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>';
  const WRELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/></Relationships>';
  async function makeDocx(media, name) {
    const z = new JSZip();
    z.file('[Content_Types].xml', CT); z.file('_rels/.rels', RELS); z.file('word/document.xml', DOC); z.file('word/_rels/document.xml.rels', WRELS);
    if (media) z.file('word/media/' + media.name, media.blob);
    const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: DOCX_MIME });
    return new File([blob], name, { type: DOCX_MIME });
  }

  const results = {};
  const bigJpeg = await noiseJpeg(2000, 1500, 0.95);
  const photo = await makeDocx({ name: 'image1.jpeg', blob: bigJpeg }, 'photo.docx');
  results.fixture = { jpegBytes: bigJpeg.size, docxBytes: photo.size };

  // 1) balanced (default controls): downscale to 1600 + q0.70 -> must shrink, package stays valid
  setSel(modeSel, 'balanced'); setSel(dimSel, '1600'); setRange(qRange, 70);
  inject(photo); await clickRun();
  results.balanced = readResult();
  let blob = await grabOutput(); results.balancedOut = await inspect(blob); results.balancedSaved = await save(blob, 'cw-photo-balanced.docx');

  // 2) smallest + 800px + q30: must be smaller than balanced
  setSel(modeSel, 'smallest'); setSel(dimSel, '800'); setRange(qRange, 30);
  inject(photo); await clickRun();
  results.smallest = readResult();
  blob = await grabOutput(); results.smallestOut = await inspect(blob); results.smallestSaved = await save(blob, 'cw-photo-smallest.docx');

  // 3) lossless: image bytes must be untouched (0 recompressed), only the zip is rebuilt
  setSel(modeSel, 'lossless'); setSel(dimSel, '1600'); setRange(qRange, 70);
  inject(photo); await clickRun();
  results.lossless = readResult();
  blob = await grabOutput(); results.losslessOut = await inspect(blob);

  // 4) text-only docx (no media): nothing to recompress -> ok note or a tiny result, never an error
  const textDoc = await makeDocx(null, 'text.docx');
  setSel(modeSel, 'balanced'); inject(textDoc); await clickRun();
  results.textOnly = readResult();

  // 5) a .docx that is not a ZIP -> cwNotDocx error
  const broken = new File([new TextEncoder().encode('this is plain text, not a zip package')], 'broken.docx', { type: DOCX_MIME });
  inject(broken); await clickRun(); results.notZip = readResult();

  // 6) a valid ZIP that is not a Word document -> cwNotWord error
  const nz = new JSZip(); nz.file('hello.txt', 'not word');
  const notWord = new File([await nz.generateAsync({ type: 'blob' })], 'notword.docx', { type: DOCX_MIME });
  inject(notWord); await clickRun(); results.notWord = readResult();

  URL.createObjectURL = origCreate;
  results.controls = { modeOptions: [...modeSel.options].map(o => o.value), dimOptions: [...dimSel.options].map(o => o.value), quality: { min: qRange.min, max: qRange.max, value: qRange.value } };
  return results;
}