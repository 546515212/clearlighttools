// Image, audio and video tools. Everything runs on the local machine: Canvas 2D for images,
// Web Audio for sound, MediaRecorder for video. Nothing is uploaded anywhere.
import {
  fmt,
  el, D, t, bytes, pct, extOf, mmss, download, downloadZip, readAs,
  loadCanvas, canvasFrom, toBlob, fileZone, orderableList, run, loadLib,
  note, toast, select, numberInput, textInput, rangeInput, checkInput, button, field, copyText, locale, add, fill
} from '../lib.js';

const L = (k, fb) => t(k, fb);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- local helpers
// Returns the live `files` array plus a hook, because fileZone owns the input element.
function imagePanel(root, { accept = 'image/*', hint, one = false, onChange } = {}) {
  const files = [];
  const list = el('div');
  const ui = orderableList(list, files, {
    onChange: () => { ui.draw(); onChange?.(files); },
    label: hint
  });
  fileZone(root, {
    accept, multiple: !one, hint,
    onFiles: incoming => {
      const ok = incoming.filter(f =>
        (f.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name));
      if (!ok.length) { toast(D.common.wrongType || L('unsupportedFileType', 'Unsupported file type')); return; }
      // only single-file mode replaces what is already loaded: in multi mode people pick photos
      // one at a time (especially on phones), and clearing the list there loses their work
      if (one) {
        if (files.length && ok.length > 1) toast(L('oneFileOnly', 'Add a single file for this mode.'));
        files.length = 0;
        files.push(ok[0]);
      } else {
        files.push(...ok);
      }
      ui.draw();
      onChange?.(files);
    }
  });
  root.append(list);
  return { files, draw: () => ui.draw() };
}

function outputBox(root) {
  const box = el('div', { class: 'out output-box' });
  root.append(box);
  return box;
}

function resultRow(box, name, size, extra, blob) {
  let thumb = null;
  if (blob?.type.startsWith('image/') && blob.type !== 'image/gif' && blob.type !== 'image/x-icon') {
    // Free the thumbnail's object URL once it has decoded: the <img> keeps the bitmap, so the
    // preview stays visible. Without this a 36-piece grid split (or repeated splits/downloads)
    // leaks one blob URL per thumbnail for the life of the page.
    const url = URL.createObjectURL(blob);
    thumb = el('img', { class: 'thumb', src: url, alt: '', loading: 'lazy' });
    const free = () => URL.revokeObjectURL(url);
    thumb.addEventListener('load', free, { once: true });
    thumb.addEventListener('error', free, { once: true });
  }
  const row = el('div', { class: 'result-card', style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
    thumb,
    el('span', { class: 'nm', text: name, style: 'flex:1;min-width:160px;font-weight:600' }),
    el('span', { class: 'sz', text: bytes(size) }),
    extra ? el('span', { class: 'delta', text: extra }) : null,
    button(L('download', 'Download'), () => download(blob, name), { kind: 'ghost' }));
  box.append(row);
  return row;
}

// Offer a single archive once there is more than one result.
function zipRow(box, jobs, name) {
  if (jobs.length < 2) return;
  const b = button(`${L('download', 'Download')} .zip`, () => run(b, async () => { await downloadZip(jobs, name); }), { kind: 'ghost' });
  box.append(el('div', { class: 'btn-row' }, b, el('span', { class: 'note', text: fmt(L('ui0Files', '{0} files'), jobs.length) })));
}

// An ImageBitmap-like source that drawImage() accepts at any size.
async function bitmapOf(canvas) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(canvas); } catch { /* Safari sometimes refuses */ }
  }
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(L('decodeFailed', 'decode failed'))); img.src = canvas.toDataURL('image/png'); });
  return img;
}

function filters(b, c, s, hue, gray, blur) {
  return `brightness(${b}%) contrast(${c}%) saturate(${s}%) hue-rotate(${hue}deg) grayscale(${gray ? 100 : 0}%) blur(${blur}px)`;
}

const toHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

export const tools = {

  // ------------------------------------------------------------ compress-image
  'compress-image': async (root) => {
    const { files } = imagePanel(root);
    let type = 'image/jpeg', quality = 0.72, maxDim = 0, targetKB = 0;
    const out = outputBox(root);
    root.append(el('div', { class: 'controls' },
      field(L('format', 'Format'), select([['image/jpeg', 'JPG'], ['image/webp', 'WebP']], type, v => type = v), ''),
      field(L('quality', 'Quality'), rangeInput(72, 20, 95, 1, v => quality = v / 100), ''),
      field(L('maxWidth', 'Max width (px)'), numberInput(0, v => maxDim = Math.max(0, Number(v) || 0), { min: 0, step: 50 }), L('ui0Keep', '0 = keep')),
      field(L('targetSize', 'Target size'), numberInput(0, v => targetKB = Math.max(0, Number(v) || 0), { min: 0, step: 50 }), L('kb0Off', 'KB, 0 = off'))));
    const go = button(L('btnCompress', 'Compress'), () => run(go, async tick => {
      out.replaceChildren();
      if (!files.length) throw new Error(L('needFile', 'Add a file first'));
      const jobs = [];
      for (const [i, f] of files.entries()) {
        tick(`${i + 1}/${files.length}`);
        const src = await loadCanvas(f);
        let work = src.canvas;
        if (maxDim && src.width > maxDim) {
          work = canvasFrom(await bitmapOf(src.canvas), maxDim, Math.max(1, Math.round(src.height * maxDim / src.width)));
        }
        let q = quality;
        let blob = await toBlob(work, type, q);
        // hunt for the quality that hits the target, then shrink pixels if quality is not enough
        if (targetKB > 0 && blob.size > targetKB * 1024) {
          let lo = 0.05, hi = q;
          while (hi - lo > 0.03) {
            const mid = (lo + hi) / 2;
            const tryBlob = await toBlob(work, type, mid);
            if (tryBlob.size > targetKB * 1024) hi = mid; else { lo = mid; blob = tryBlob; }
          }
          q = lo;
          if (blob.size > targetKB * 1024) {
            const k = Math.sqrt((targetKB * 1024) / blob.size) * 0.95;
            work = canvasFrom(await bitmapOf(work), Math.max(32, Math.round(work.width * k)), Math.max(32, Math.round(work.height * k)));
            blob = await toBlob(work, type, q);
          }
        }
        const ext = type === 'image/jpeg' ? 'jpg' : 'webp';
        const name = extOf(f.name, ext);
        if (blob.size < f.size) {
          resultRow(out, name, blob.size, `${bytes(f.size)} → ${bytes(blob.size)} (−${pct(blob.size, f.size)}%)`, blob);
        } else {
          out.append(note(fmt(L('ui012LowerThe', '{0}: {1} → {2}. Lower the quality, add a max width, or set a target size.'), f.name, bytes(f.size), bytes(blob.size))));
        }
        jobs.push({ name, blob });
      }
      zipRow(out, jobs, 'compressed-images.zip');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ convert-image
  'convert-image': async (root) => {
    const { files } = imagePanel(root);
    let type = 'image/png', quality = 0.9, bg = '#ffffff';
    const out = outputBox(root);
    root.append(el('div', { class: 'controls' },
      field(L('targetFormat', 'Convert to'), select([['image/png', 'PNG'], ['image/jpeg', 'JPG'], ['image/webp', 'WebP'], ['image/gif', L('gif256Colours', 'GIF (256 colours)')]], type, v => type = v), ''),
      field(L('quality', 'Quality'), rangeInput(90, 20, 100, 1, v => quality = v / 100), L('jpgWebp', 'JPG / WebP')),
      field(L('background', 'Background'), textInput(bg, v => bg = v, 'color'), L('fillsTransparencyInJpg', 'fills transparency in JPG'))));
    const go = button(L('btnConvert', 'Convert'), () => run(go, async tick => {
      out.replaceChildren();
      if (!files.length) throw new Error(L('needFile', 'Add a file first'));
      const jobs = [];
      for (const [i, f] of files.entries()) {
        tick(`${i + 1}/${files.length}`);
        const src = await loadCanvas(f);
        let work = src.canvas;
        if (type === 'image/jpeg') {
          const c = el('canvas', { width: src.width, height: src.height });
          const ctx = c.getContext('2d');
          ctx.fillStyle = bg || '#ffffff';
          ctx.fillRect(0, 0, src.width, src.height);
          ctx.drawImage(src.canvas, 0, 0);
          work = c;
        }
        const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
        const blob = await toBlob(work, type, quality);
        const name = extOf(f.name, ext);
        resultRow(out, name, blob.size, `${src.width}×${src.height} · ${bytes(f.size)} → ${bytes(blob.size)}`, blob);
        jobs.push({ name, blob });
      }
      zipRow(out, jobs, 'converted-images.zip');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ resize-image
  'resize-image': async (root) => {
    const { files } = imagePanel(root);
    let w = 1024, h = 768, mode = 'contain', scale = 100, lock = true;
    const out = outputBox(root);
    const info = el('div', { class: 'note', text: '1024 × 768 px' });
    const wIn = numberInput(1024, v => { w = Math.max(1, Number(v) || 1); if (lock && ratio) h = Math.max(1, Math.round(w / ratio)); hIn.value = h; info.textContent = `${w} × ${h} px`; }, { min: 1 });
    const hIn = numberInput(768, v => { h = Math.max(1, Number(v) || 1); if (lock && ratio) w = Math.max(1, Math.round(h * ratio)); wIn.value = w; info.textContent = `${w} × ${h} px`; }, { min: 1 });
    let ratio = 0;
    root.append(el('div', { class: 'controls' },
      field(L('width', 'Width'), wIn, 'px'),
      field(L('height', 'Height'), hIn, 'px'),
      field(L('mode', 'Mode'), select([['contain', L('fitKeepsAll', 'Fit (keeps all)')], ['cover', L('fillCrops', 'Fill (crops)')], ['stretch', L('stretch', 'Stretch')]], mode, v => mode = v), ''),
      field(L('scale', 'Scale'), select([['100', '100%'], ['75', '75%'], ['50', '50%'], ['25', '25%'], ['200', '200%']], '100', v => scale = Number(v)), ''),
      el('span', {}, checkInput(L('lockRatio', 'Keep aspect ratio'), true, v => lock = v))), info);
    const go = button(L('btnResize', 'Resize'), () => run(go, async tick => {
      out.replaceChildren();
      if (!files.length) throw new Error(L('needFile', 'Add a file first'));
      const jobs = [];
      for (const [i, f] of files.entries()) {
        tick(`${i + 1}/${files.length}`);
        const src = await loadCanvas(f);
        ratio = src.width / src.height;
        const tw = Math.max(1, Math.round(w * scale / 100));
        const th = Math.max(1, Math.round((scale === 100 && lock ? Math.round(w / ratio) : h) * scale / 100));
        const c = el('canvas', { width: tw, height: th });
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        if (f.type === 'image/png') ctx.fillRect(0, 0, tw, th);
        const k = mode === 'stretch' ? null
          : mode === 'contain' ? Math.min(tw / src.width, th / src.height)
          : Math.max(tw / src.width, th / src.height);
        if (mode === 'stretch') ctx.drawImage(src.canvas, 0, 0, tw, th);
        else ctx.drawImage(src.canvas, (tw - src.width * k) / 2, (th - src.height * k) / 2, src.width * k, src.height * k);
        const type = f.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const ext = type === 'image/png' ? 'png' : 'jpg';
        const blob = await toBlob(c, type, 0.92);
        const name = extOf(f.name, ext);
        resultRow(out, name, blob.size, `${src.width}×${src.height} → ${tw}×${th}`, blob);
        jobs.push({ name, blob });
      }
      zipRow(out, jobs, 'resized-images.zip');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ image-to-base64
  'image-to-base64': async (root) => {
    let prefix = true, urlSafe = false, quoted = false;
    const area = el('textarea', { readonly: true, spellcheck: 'false', style: 'min-height:220px' });
    const meta = el('div', { class: 'note', text: L('waitingFile', 'Waiting for a file.') });
    const apply = () => {
      const f = files[0];
      if (!f?.b64) { area.value = ''; return; }
      let body = f.b64;
      if (urlSafe) body = body.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const full = prefix ? `data:${f.mime};base64,${body}` : body;
      area.value = quoted ? JSON.stringify(full) : full;
      meta.textContent = `${f.name} · ${bytes(f.size)} · ` + fmt(L('ui0CharactersOfTextBase64Is', '{0} characters of text (base64 is ~33% larger than the bytes it encodes)'), full.length.toLocaleString(locale()));
    };
    const { files } = imagePanel(root, {
      one: true,
      onChange: async list => {
        const f = list[0];
        if (!f) { area.value = ''; meta.textContent = L('waitingFile', 'Waiting for a file.'); return; }
        meta.textContent = fmt(L('reading0', 'Reading {0}…'), f.name);
        const u8 = new Uint8Array(await readAs(f, 'ArrayBuffer'));
        let bin = '';
        // chunked: String.fromCharCode(...big) blows the argument limit on large files
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        f.b64 = btoa(bin);
        f.mime = f.type || 'application/octet-stream';
        apply();
      }
    });
    root.append(el('div', { class: 'controls' },
      el('span', {}, checkInput(L('dataUrlPrefix', 'Data URL prefix'), true, v => { prefix = v; apply(); })),
      el('span', {}, checkInput(L('urlSafeBase64', 'URL-safe (for file names)'), false, v => { urlSafe = v; apply(); })),
      el('span', {}, checkInput(L('quotedForCode', 'Quoted, for CSS / JS'), false, v => { quoted = v; apply(); }))),
      el('div', { class: 'out' }, meta, area,
        el('div', { class: 'btn-row' },
          button(L('copy', 'Copy'), () => area.value ? copyText(area.value) : toast(D.common.errorGeneric || L('nothingToCopy', 'Nothing to copy')), { kind: 'ghost' }))));
  },

  // ------------------------------------------------------------ base64-to-image
  'base64-to-image': async (root) => {
    const out = el('div', { class: 'out output-box' });
    const area = el('textarea', { spellcheck: 'false', placeholder: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg…' });
    let timer;
    area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => decode(area.value), 250); });
    root.append(el('div', { class: 'field' }, el('span', { text: L('inputBase64', 'Paste base64') }), area), out);
    function sniff(u8) {
      const sig = [...u8.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
      if (sig.startsWith('89504e47')) return 'image/png';
      if (sig.startsWith('ffd8ff')) return 'image/jpeg';
      if (sig.startsWith('47494638')) return 'image/gif';
      if (sig.startsWith('52494646')) return 'image/webp';
      if (sig.startsWith('424d')) return 'image/bmp';
      return '';
    }
    async function decode(input) {
      out.replaceChildren();
      const declared = (input.match(/^data:([^;,]+)[;,]/i) || [])[1] || '';
      const body = input.replace(/^\s*data:[^,]*,/i, '').replace(/[^A-Za-z0-9+/=_-]/g, '');
      if (body.length < 8) { out.append(note(L('waitingInput', 'Waiting for input.'))); return; }
      if (body.length % 4 === 1) { out.append(note(L('thisIsNotValidBase64', 'This is not valid base64: the character count is impossible.'), 'err')); return; }
      let bin;
      try { bin = atob(body.replace(/-/g, '+').replace(/_/g, '/')); }
      catch { out.append(note(L('notBase64', 'This is not valid base64.'), 'err')); return; }
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const mime = (/^image\//.test(declared) ? declared : '') || sniff(u8);
      if (!mime) { out.append(note(L('decodedTheBytesButThey', 'Decoded the bytes, but they do not look like a PNG, JPEG, GIF, WebP or BMP image.'), 'err')); return; }
      const blob = new Blob([u8], { type: mime });
      const url = URL.createObjectURL(blob);
      const img = el('img', { src: url, alt: '', style: 'max-width:100%;border-radius:8px;border:1px solid var(--line)' });
      const dims = await new Promise(r => { img.onload = () => r(`${img.naturalWidth}×${img.naturalHeight}`); img.onerror = () => r('unreadable'); });
      out.append(el('div', { class: 'result-card' }, img));
      resultRow(out, `decoded.${mime.split('/')[1].replace('jpeg', 'jpg')}`, blob.size, fmt(L('ui01From2Base64', '{0} · {1} · from {2} base64 characters'), mime, dims, body.length.toLocaleString(locale())), blob);
    }
  },

  // ------------------------------------------------------------ qr-code-generator
  'qr-code-generator': async (root) => {
    let ecl = 'M', cell = 8, margin = 4, fg = '#000000', bg = '#ffffff', mode = 'text';
    let ssid = '', pass = '', enc = 'WPA', hidden = false;
    const out = el('div', { class: 'out output-box' });
    const ta = el('textarea', { spellcheck: 'false', style: 'min-height:90px' });
    ta.value = 'https://';
    const wifiBox = el('div', { class: 'controls', style: 'display:none' },
      field('SSID', textInput('', v => { ssid = v; draw(); }), ''),
      field(L('password', 'Password'), textInput('', v => { pass = v; draw(); }), ''),
      field(L('encryption', 'Encryption'), select([['WPA', L('wpaWpa2', 'WPA / WPA2')], ['WEP', 'WEP'], ['nopass', L('open', 'Open')]], 'WPA', v => { enc = v; draw(); }), ''),
      el('span', {}, checkInput(L('hiddenNetwork', 'Hidden network'), false, v => { hidden = v; draw(); })));
    ta.addEventListener('input', draw);
    root.append(
      field(L('contentType', 'Content type'), select([['text', L('contentTextUrl', 'Text / URL')], ['wifi', L('wiFi', 'Wi‑Fi')], ['url', L('url', 'URL')]], mode, v => {
        mode = v;
        wifiBox.style.display = v === 'wifi' ? 'flex' : 'none';
        ta.style.display = v === 'wifi' ? 'none' : '';
        draw();
      }), ''),
      ta, wifiBox,
      el('div', { class: 'controls' },
        field(L('errorCorrection', 'Error correction'), select([['L', 'L · ~7%'], ['M', 'M · ~15%'], ['Q', 'Q · ~25%'], ['H', 'H · ~30%']], ecl, v => { ecl = v; draw(); }), L('higherSurvivesMoreDamage', 'higher = survives more damage')),
        field(L('moduleSize', 'Module size'), numberInput(8, v => { cell = clamp(Number(v) || 8, 1, 64); draw(); }, { min: 1, max: 64 }), 'px'),
        field(L('quietZone', 'Quiet zone'), numberInput(4, v => { margin = clamp(Number(v) || 0, 0, 24); draw(); }, { min: 0, max: 24 }), L('modules', 'modules')),
        field(L('foregroundColor', 'Foreground'), textInput(fg, v => { fg = v; draw(); }, 'color'), ''),
        field(L('background', 'Background'), textInput(bg, v => { bg = v; draw(); }, 'color'), '')),
      out);
    const esc = s => String(s).replace(/([\\;,:"])/g, '\\$1');
    function payload() {
      if (mode !== 'wifi') return ta.value;
      return `WIFI:T:${enc};S:${esc(ssid)};${enc === 'nopass' ? '' : `P:${esc(pass)};`}${hidden ? 'H:true;' : ''};`;
    }
    async function draw() {
      out.replaceChildren();
      const data = payload();
      if (!data.trim()) { out.append(note(L('waitingInput', 'Waiting for input.'))); return; }
      let qrcode;
      try { qrcode = await loadLib('qrcode-generator'); }
      catch { out.append(note(L('theQrLibraryCouldNot', 'The QR library could not be loaded.'), 'err')); return; }
      let qr;
      try {
        qr = qrcode(0, ecl);
        qr.addData(data);
        qr.make();
      } catch (err) {
        out.append(note(fmt(L('tooMuchTextForOne', 'Too much text for one code ({0}). Shorten it, or use error level L.'), err?.message || err), 'err'));
        return;
      }
      const n = qr.getModuleCount();
      const size = (n + margin * 2) * cell;
      const canvas = el('canvas', { width: size, height: size });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = fg;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
      }
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${n + margin * 2} ${n + margin * 2}" shape-rendering="crispEdges"><rect width="${n + margin * 2}" height="${n + margin * 2}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
      out.append(
        el('div', { class: 'result-card', style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start' },
          el('div', {}, canvas, note(fmt(L('ui01Modules2Px', '{0}×{1} modules · {2}px · payload {3}'), n, n, size, bytes(new TextEncoder().encode(data).length))))),
        el('div', { class: 'btn-row' },
          button(`${L('download', 'Download')} PNG`, () => canvas.toBlob(b => b && download(b, 'qr-code.png'), 'image/png'), { kind: 'ghost' }),
          button(`${L('download', 'Download')} SVG`, () => download(new Blob([svg], { type: 'image/svg+xml' }), 'qr-code.svg'), { kind: 'ghost' }),
          button(L('copyImage', 'Copy image'), async () => {
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': await new Promise(r => canvas.toBlob(r, 'image/png')) })]);
              toast(D.common.copied || 'Copied');
            } catch { toast(L('thisBrowserCannotCopyImages', 'This browser cannot copy images')); }
          }, { kind: 'ghost' }),
          button(L('btnPrint', 'Print'), () => {
            const w = window.open('', '_blank', 'width=640,height=640');
            if (!w) { toast(L('popupBlocked', 'Popup blocked')); return; }
            w.document.write(`<!doctype html><title>QR</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff"><img src="${canvas.toDataURL('image/png')}" style="max-width:90vmin"></body>`);
            w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
          }, { kind: 'ghost' })),
        // the payload itself is machine data (a URL, an SSID) and is never translated; only the
        // frame around it goes through the dictionary
        note(fmt(L('qrPayloadPreview', '{0} payload: {1}'), mode === 'wifi' ? L('wifi', 'Wi-Fi') : L('qrModeText', 'Text'), data.length > 90 ? data.slice(0, 90) + '…' : data)));
    }
    draw();
  },

  // ------------------------------------------------------------ favicon-generator
  'favicon-generator': async (root) => {
    const chosen = new Set([16, 32, 48, 180]);
    const out = el('div', { class: 'out output-box' });
    const toggles = el('div', { class: 'controls' });
    for (const s of [16, 32, 48, 64, 128, 180, 192, 512]) {
      toggles.append(checkInput(`${s}px`, chosen.has(s), v => { v ? chosen.add(s) : chosen.delete(s); }));
    }
    let src = null;
    root.append(toggles, out);
    imagePanel(root, { one: true, hint: L('useASquareImageAt', 'Use a square image, at least 512×512 for the largest size'), onChange: async list => {
      if (!list[0]) { src = null; return; }
      try { src = await loadCanvas(list[0]); out.replaceChildren(note(fmt(L('readyAtSize', '{0}×{1} ready.'), src.width, src.height))); }
      catch { out.replaceChildren(note(L('couldNotReadThatImage', 'Could not read that image.'), 'err')); }
    } });
    const go = button(L('generate', 'Generate'), () => run(go, async tick => {
      out.replaceChildren();
      if (!src) throw new Error(L('needImage', 'Add an image first'));
      if (!chosen.size) throw new Error(L('pickAtLeastOneSize', 'Pick at least one size'));
      const side = Math.min(src.width, src.height);
      const sx = (src.width - side) / 2, sy = (src.height - side) / 2;
      const square = async (s) => {
        const c = el('canvas', { width: s, height: s });
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src.canvas, sx, sy, side, side, 0, 0, s, s);
        return c;
      };
      const jobs = [];
      for (const s of [...chosen].sort((a, b) => a - b)) {
        tick(`${s}px`);
        const blob = await toBlob(await square(s), 'image/png', 1);
        const name = `favicon-${s}x${s}.png`;
        resultRow(out, name, blob.size, `${s}×${s}`, blob);
        jobs.push({ name, blob });
      }
      // ICO holds every size up to 256px as embedded PNG data (supported since Windows Vista)
      const icoSizes = [...chosen].filter(s => s <= 256).sort((a, b) => a - b);
      if (icoSizes.length) {
        const parts = [];
        for (const s of icoSizes) {
          const png = await toBlob(await square(s), 'image/png', 1);
          parts.push({ size: s, u8: new Uint8Array(await png.arrayBuffer()) });
        }
        const blob = await buildIco(parts);
        resultRow(out, 'favicon.ico', blob.size, fmt(L('ui0SizesInOneFile', '{0} sizes in one file'), parts.length), blob);
        jobs.push({ name: 'favicon.ico', blob });
      }
      zipRow(out, jobs, 'favicon.zip');
      // the markup itself is code the visitor copies, so it stays outside the dictionary and is
      // interpolated into the translated sentence
      out.append(note(fmt(L('faviconMarkupHint', 'Reference it with {0} and {1}.'),
        '<link rel="icon" href="favicon-32x32.png" sizes="32x32" type="image/png">',
        '<link rel="apple-touch-icon" href="favicon-180x180.png">')));
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));

    async function buildIco(entries) {
      const header = 6 + entries.length * 16;
      const total = header + entries.reduce((a, e) => a + e.u8.length, 0);
      const buf = new ArrayBuffer(total);
      const dv = new DataView(buf);
      const u8 = new Uint8Array(buf);
      let o = 0;
      const w16 = v => { dv.setUint16(o, v, true); o += 2; };
      const w32 = v => { dv.setUint32(o, v, true); o += 4; };
      w16(0); w16(1); w16(entries.length);
      let dataOff = header;
      for (const e of entries) {
        dv.setUint8(o, e.size === 256 ? 0 : e.size); o += 1;
        dv.setUint8(o, e.size === 256 ? 0 : e.size); o += 1;
        dv.setUint8(o, 0); o += 1;   // palette count
        dv.setUint8(o, 0); o += 1;   // reserved
        w16(1); w16(32);             // colour planes, bits per pixel
        w32(e.u8.length); w32(dataOff);
        dataOff += e.u8.length;
      }
      let p = header;
      for (const e of entries) { u8.set(e.u8, p); p += e.u8.length; }
      return new Blob([buf], { type: 'image/x-icon' });
    }
  },

  // ------------------------------------------------------------ color-picker
  'color-picker': async (root) => {
    let hex = '#3366ff';
    const out = el('div', { class: 'out' });
    const canvasWrap = el('div');
    const swatches = el('div', { class: 'swatches' });
    const colorIn = el('input', { type: 'color', value: hex });
    const textIn = textInput(hex, v => set(v), 'text');
    colorIn.addEventListener('input', () => set(colorIn.value));
    root.append(el('div', { class: 'controls' },
      field(L('color', 'Colour'), el('span', { class: 'check' }, colorIn, textIn), 'hex, e.g. #F0A830'),
      el('span', {}, button(L('pickFromScreen', 'Pick from screen'), pickScreen, { kind: 'ghost', disabled: typeof window.EyeDropper !== 'function' }))),
      canvasWrap, out, el('div', {}, el('h3', { text: L('paletteSize', 'Colours in palette') }), swatches));
    imagePanel(root, { one: true, hint: L('optionalDropAnImageThen', 'Optional: drop an image, then click it to sample a pixel'), onChange: showImage });

    function set(v) {
      const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(v).trim());
      out.replaceChildren();
      if (!m) { out.append(note(L('enterA36Or', 'Enter a 3, 6 or 8-digit hex value such as #36F or #3366FF'), 'err')); return; }
      let h = m[1];
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      hex = '#' + h.slice(0, 6).toUpperCase();
      if (h.length === 6) colorIn.value = hex.toLowerCase();
      textIn.value = hex;
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      const [hh, ss, ll] = rgbToHsl(r, g, b);
      const rows = [['HEX', hex], ['RGB', `rgb(${r}, ${g}, ${b})`], ['RGBA', `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`],
        ['HSL', `hsl(${hh}, ${ss}%, ${ll}%)`], ['CMYK', cmyk(r, g, b)], [L('closestName', 'Closest name'), nearest(r, g, b)]];
      const kv = el('div', { class: 'kv' });
      for (const [k, v] of rows) {
        const b2 = button(L('copy2', 'copy'), () => copyText(v), { kind: 'ghost' });
        kv.append(el('span', { class: 'k', text: k }), el('span', { class: 'check' }, el('code', { text: v }), b2));
      }
      out.append(el('div', { class: 'result-card' },
        el('i', { style: `display:block;height:72px;border-radius:8px;border:1px solid var(--line);background:${hex}` }), kv));
    }
    function cmyk(r, g, b) {
      const k = 1 - Math.max(r, g, b) / 255;
      if (k >= 1) return 'cmyk(0%, 0%, 0%, 100%)';
      const c = (1 - r / 255 - k) / (1 - k), m2 = (1 - g / 255 - k) / (1 - k), y = (1 - b / 255 - k) / (1 - k);
      return `cmyk(${Math.round(c * 100)}%, ${Math.round(m2 * 100)}%, ${Math.round(y * 100)}%, ${Math.round(k * 100)}%)`;
    }
    const NAMES = [['black', 0, 0, 0], ['white', 255, 255, 255], ['silver', 192, 192, 192], ['gray', 128, 128, 128],
      ['red', 255, 0, 0], ['maroon', 128, 0, 0], ['orange', 255, 165, 0], ['gold', 255, 215, 0], ['yellow', 255, 255, 0],
      ['olive', 128, 128, 0], ['lime', 0, 255, 0], ['green', 0, 128, 0], ['teal', 0, 128, 128], ['cyan', 0, 255, 255],
      ['blue', 0, 0, 255], ['navy', 0, 0, 128], ['purple', 128, 0, 128], ['violet', 238, 130, 238], ['pink', 255, 192, 203],
      ['brown', 165, 42, 42]];
    function nearest(r, g, b) {
      let best = '', bd = Infinity;
      for (const [n, nr, ng, nb] of NAMES) {
        const d = 0.3 * (r - nr) ** 2 + 0.59 * (g - ng) ** 2 + 0.11 * (b - nb) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    }
    async function pickScreen() {
      try {
        const res = await new window.EyeDropper().open();
        set(res.sRGBHex);
      } catch { /* the user pressed Escape */ }
    }
    async function showImage(list) {
      canvasWrap.replaceChildren();
      swatches.replaceChildren();
      const f = list[0];
      if (!f) return;
      let src;
      try { src = await loadCanvas(f); } catch { canvasWrap.append(note(L('couldNotDecodeThatImage', 'Could not decode that image.'), 'err')); return; }
      const k = Math.min(1, 520 / src.width);
      const c = canvasFrom(await bitmapOf(src.canvas), Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
      c.style.cssText = 'max-width:100%;cursor:crosshair;border:1px solid var(--line);border-radius:8px';
      c.addEventListener('click', e => {
        const rect = c.getBoundingClientRect();
        // map the click through the CSS scale, clamped inside the canvas
        const x = clamp(Math.floor((e.clientX - rect.left) * c.width / rect.width), 0, c.width - 1);
        const y = clamp(Math.floor((e.clientY - rect.top) * c.height / rect.height), 0, c.height - 1);
        const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
        if (d[3] === 0) return toast(L('thatPixelIsTransparent', 'That pixel is transparent'));
        set(toHex(d[0], d[1], d[2]));
      });
      canvasWrap.append(c, note(L('clickThePictureToSample', 'Click the picture to sample a pixel.')));
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const buckets = new Map();
      const stride = Math.max(1, Math.floor(data.length / 4 / 60000)) * 4;
      for (let i = 0; i < data.length; i += stride) {
        if (data[i + 3] < 128) continue;
        const key = [(data[i] >> 5) << 5, (data[i + 1] >> 5) << 5, (data[i + 2] >> 5) << 5];
        const k2 = key.join(',');
        const e = buckets.get(k2) || { c: key, n: 0 };
        e.n++; buckets.set(k2, e);
      }
      for (const { c: [r, g, b] } of [...buckets.values()].sort((a, b2) => b2.n - a.n).slice(0, 12)) {
        const hx = toHex(r, g, b);
        swatches.append(el('button', { class: 'swatch', title: hx, onClick: () => set(hx) },
          el('i', { style: `background:${hx}` }), el('span', { text: hx })));
      }
    }
    set(hex);
  },

  // ------------------------------------------------------------ image-to-gif
  'image-to-gif': async (root) => {
    const { files } = imagePanel(root);
    let delay = 400, width = 480, fit = 'contain';
    const out = el('div', { class: 'out output-box' });
    root.append(el('div', { class: 'controls' },
      field(L('frameDelay', 'Frame delay (ms)'), numberInput(400, v => delay = clamp(Number(v) || 400, 20, 20000), { min: 20, step: 20 }), 'ms'),
      field(L('width', 'Width'), numberInput(480, v => width = clamp(Number(v) || 480, 16, 1200), { min: 16, step: 16 }), 'px'),
      field(L('fitMode', 'Fit'), select([['contain', L('fitPads', 'Fit (pads)')], ['cover', L('fillCrops', 'Fill (crops)')]], fit, v => fit = v), '')));
    // the box has to be in the page: a local `out` that is only ever written to, never appended,
    // silently throws the animation away — the encode runs, the button spins, and nothing appears
    root.append(out);
    const go = button(L('btnCreateGif', 'Create GIF'), () => run(go, async tick => {
      out.replaceChildren();
      if (files.length < 2) throw new Error(L('addAtLeastTwoImages', 'Add at least two images'));
      const { GIFEncoder, quantize, applyPalette } = await loadLib('gifenc');
      const first = await loadCanvas(files[0]);
      const w = Math.max(16, width);
      const h = Math.max(16, Math.round(w * first.height / first.width));
      const gif = GIFEncoder();
      for (const [i, f] of files.entries()) {
        tick(`${i + 1}/${files.length}`);
        const src = await loadCanvas(f);
        const c = el('canvas', { width: w, height: h });
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        const k = fit === 'contain' ? Math.min(w / src.width, h / src.height) : Math.max(w / src.width, h / src.height);
        ctx.drawImage(src.canvas, (w - src.width * k) / 2, (h - src.height * k) / 2, src.width * k, src.height * k);
        const { data } = ctx.getImageData(0, 0, w, h);
        const palette = quantize(data, 256);
        gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay });
      }
      gif.finish();
      const blob = new Blob([gif.bytes()], { type: 'image/gif' });
      out.append(el('div', { class: 'result-card' },
        el('img', { src: URL.createObjectURL(blob), alt: '', style: 'max-width:100%;border-radius:8px' }),
        el('div', {}, note(fmt(L('ui0Frames123', '{0} frames · {1}×{2} · {3} · {4}s per loop'), files.length, w, h, bytes(blob.size), (files.length * delay / 1000).toFixed(1))),
          el('div', { class: 'btn-row' }, button(L('download', 'Download'), () => download(blob, 'animation.gif'), { kind: 'ghost' })))));
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ image-contrast-brightness
  'image-contrast-brightness': async (root) => {
    const { files } = imagePanel(root, { onChange: list => { prev.src = list.length ? URL.createObjectURL(list[list.length - 1]) : ''; sync(); } });
    let b = 100, c = 100, s = 100, hue = 0, gray = false, blur = 0;
    const out = el('div', { class: 'out output-box' });
    const prev = el('img', { alt: '', style: 'max-width:100%;display:block' });
    const fig = el('figure', {}, prev, el('figcaption', { text: L('preview', 'Preview') }));
    const sync = () => { prev.style.filter = filters(b, c, s, hue, gray, blur); };
    root.append(el('div', { class: 'controls' },
      field(L('brightness', 'Brightness'), rangeInput(100, 10, 220, 1, v => { b = v; sync(); }, '%'), ''),
      field(L('contrast', 'Contrast'), rangeInput(100, 10, 220, 1, v => { c = v; sync(); }, '%'), ''),
      field(L('saturation', 'Saturation'), rangeInput(100, 0, 220, 1, v => { s = v; sync(); }, '%'), ''),
      field(L('hue', 'Hue'), rangeInput(0, 0, 360, 5, v => { hue = v; sync(); }, '°'), ''),
      field(L('blur', 'Blur'), rangeInput(0, 0, 10, 0.5, v => { blur = v; sync(); }, 'px'), L('livePreviewOnly', 'live preview only')),
      el('span', {}, checkInput(L('grayscale', 'Grayscale'), false, v => { gray = v; sync(); }))),
      el('div', { class: 'preview-grid' }, fig));
    // see image-to-gif: an output box that is never appended swallows the edited images
    root.append(out);
    const go = button(L('apply', 'Apply'), () => run(go, async tick => {
      out.replaceChildren();
      if (!files.length) throw new Error(L('needImage', 'Add an image first'));
      const jobs = [];
      for (const [i, f] of files.entries()) {
        tick(`${i + 1}/${files.length}`);
        const src = await loadCanvas(f);
        const canvas = el('canvas', { width: src.width, height: src.height });
        const ctx = canvas.getContext('2d');
        ctx.filter = filters(b, c, s, hue, gray, blur);
        ctx.drawImage(src.canvas, 0, 0);
        const type = f.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const ext = type === 'image/png' ? 'png' : 'jpg';
        const blob = await toBlob(canvas, type, 0.92);
        const name = extOf(f.name, ext);
        resultRow(out, name, blob.size, `${src.width}×${src.height} · ${bytes(f.size)} → ${bytes(blob.size)}`, blob);
        jobs.push({ name, blob });
      }
      zipRow(out, jobs, 'edited-images.zip');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ signature-pad
  'signature-pad': async (root) => {
    // A transparent-background signature drawn with pointer events. Only canvas calls the smoke
    // harness stubs are used (moveTo/lineTo/stroke/arc/fill/getImageData/drawImage), and the PNG
    // keeps its alpha channel so it can be laid over a document.
    const W = 640, H = 260;
    const canvas = el('canvas', { width: W, height: H, style: 'width:100%;max-width:640px;height:auto;touch-action:none;background:#fff;border:1px solid var(--line);border-radius:10px;cursor:crosshair;display:block' });
    const ctx = canvas.getContext('2d');
    let color = '#111111', width = 3, trim = true, drawing = false, cur = null;
    const strokes = [];
    const hasInk = () => strokes.some(s => s.points.length);
    const redraw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of strokes) {
        ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width;
        const p = s.points;
        if (!p.length) continue;
        if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0].x, p[0].y, s.width / 2, 0, Math.PI * 2); ctx.fill(); continue; }
        ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
        for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
        ctx.stroke();
      }
    };
    const pos = e => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / (r.width || 1)), y: (e.clientY - r.top) * (H / (r.height || 1)) };
    };
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault(); drawing = true; cur = { color, width, points: [pos(e)] }; strokes.push(cur);
      canvas.setPointerCapture?.(e.pointerId); redraw();
    });
    canvas.addEventListener('pointermove', e => { if (!drawing || !cur) return; cur.points.push(pos(e)); redraw(); });
    const end = () => { drawing = false; cur = null; };
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) canvas.addEventListener(ev, end);
    const out = outputBox(root);
    const dl = button(L('signDownload', 'Download PNG'), () => run(dl, async () => {
      if (!hasInk()) throw new Error(L('signDrawFirst', 'Draw your signature first.'));
      let sx = 0, sy = 0, sw = W, sh = H;
      if (trim) {
        // getImageData returns all-zero alpha in the smoke harness, so maxX stays -1 and we keep the
        // full canvas — the trim is a real-browser convenience, never a reason to fail the export.
        const d = ctx.getImageData(0, 0, W, H).data;
        let minX = W, minY = H, maxX = -1, maxY = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (d[(y * W + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
        if (maxX >= 0) { const pad = 8; sx = Math.max(0, minX - pad); sy = Math.max(0, minY - pad); sw = Math.min(W, maxX + pad) - sx; sh = Math.min(H, maxY + pad) - sy; }
      }
      const c = el('canvas', { width: sw, height: sh });
      c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await toBlob(c, 'image/png');
      fill(out); resultRow(out, 'signature.png', blob.size, '', blob);
    }));
    root.append(
      el('div', { class: 'controls' },
        field(L('signPenColor', 'Pen colour'), select([['#111111', L('signBlack', 'Black')], ['#1d4ed8', L('signBlue', 'Blue')], ['#dc2626', L('signRed', 'Red')]], color, v => color = v), ''),
        field(L('signPenWidth', 'Pen width'), rangeInput(3, 1, 12, 1, v => width = v, 'px'), ''),
        el('span', {}, checkInput(L('signTrim', 'Trim empty space'), trim, v => trim = v))),
      canvas,
      el('div', { class: 'btn-row' },
        dl,
        button(L('signUndo', 'Undo'), () => { strokes.pop(); redraw(); }, { kind: 'ghost' }),
        button(L('signClear', 'Clear'), () => { strokes.length = 0; redraw(); fill(out); }, { kind: 'ghost' })),
      out,
      note(L('signNote', 'Draw with a mouse, finger or stylus. The PNG keeps a transparent background, so you can place it over a contract or form. Nothing is uploaded.')));
    redraw();
  },

  // ------------------------------------------------------------ id-photo-maker
  'id-photo-maker': async (root) => {
    const { files } = imagePanel(root, { one: true, hint: L('idUploadHint', 'Upload a portrait photo') });
    const DIMS = { cn1: [25, 35], cn2: [35, 49], passport: [33, 48], us: [51, 51] };
    const TARGETS = { white: [255, 255, 255], blue: [67, 140, 219], red: [255, 0, 0] };
    let preset = 'cn1', dpi = 300, zoom = 1, offsetY = 0, changeBg = false, target = 'white', tol = 30;
    const wMm = numberInput(25, null, { min: 10, max: 200, step: 1 });
    const hMm = numberInput(35, null, { min: 10, max: 200, step: 1 });
    const presetSel = select([
      ['cn1', L('idPresetCn1', 'China 1-inch (25×35 mm)')],
      ['cn2', L('idPresetCn2', 'China 2-inch (35×49 mm)')],
      ['passport', L('idPresetPassport', 'Passport / visa (33×48 mm)')],
      ['us', L('idPresetUs', 'US passport (51×51 mm)')],
      ['custom', L('idPresetCustom', 'Custom size')]
    ], preset, v => { preset = v; if (DIMS[v]) { wMm.value = DIMS[v][0]; hMm.value = DIMS[v][1]; } });
    const out = outputBox(root);
    const go = button(L('idApply', 'Make photo'), () => run(go, async () => {
      fill(out);
      if (!files.length) throw new Error(L('needImage', 'Add an image first'));
      const mmW = clamp(Number(wMm.value) || 25, 10, 200), mmH = clamp(Number(hMm.value) || 35, 10, 200);
      const tw = clamp(Math.round(mmW / 25.4 * dpi), 1, 4000), th = clamp(Math.round(mmH / 25.4 * dpi), 1, 4000);
      const src = await loadCanvas(files[0]);
      const canvas = el('canvas', { width: tw, height: th });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, tw, th);
      const s = Math.max(tw / src.width, th / src.height) * zoom;
      const dw = src.width * s, dh = src.height * s;
      ctx.drawImage(src.canvas, (tw - dw) / 2, (th - dh) / 2 + (offsetY / 100) * th, dw, dh);
      if (changeBg) {
        // key out the colour sampled from the top-left corner; a plain backdrop makes this clean
        const im = ctx.getImageData(0, 0, tw, th), d = im.data;
        const cr = d[0], cg = d[1], cb = d[2], [tr, tg, tb] = TARGETS[target] || TARGETS.white, lim = tol * tol * 3;
        for (let i = 0; i < d.length; i += 4) {
          const dr = d[i] - cr, dg = d[i + 1] - cg, db = d[i + 2] - cb;
          if (dr * dr + dg * dg + db * db <= lim) { d[i] = tr; d[i + 1] = tg; d[i + 2] = tb; }
        }
        ctx.putImageData(im, 0, 0);
      }
      const blob = await toBlob(canvas, 'image/jpeg', 0.92);
      resultRow(out, 'id-photo.jpg', blob.size, `${tw}×${th}`, blob);
    }));
    root.append(el('div', { class: 'controls' },
      field(L('idPreset', 'Photo size'), presetSel, ''),
      field(L('idWidth', 'Width (mm)'), wMm, ''),
      field(L('idHeight', 'Height (mm)'), hMm, ''),
      field(L('idDpi', 'Resolution'), select([['150', '150 dpi'], ['300', '300 dpi'], ['600', '600 dpi']], String(dpi), v => dpi = Number(v)), L('idDpiHint', '300 dpi is standard for print')),
      field(L('idZoom', 'Zoom'), rangeInput(1, 0.5, 2.5, 0.05, v => zoom = v, '×'), ''),
      field(L('idOffsetY', 'Vertical position'), rangeInput(0, -50, 50, 1, v => offsetY = v, '%'), '')),
      el('div', { class: 'controls' },
        el('span', {}, checkInput(L('idChangeBg', 'Replace background'), changeBg, v => changeBg = v)),
        field(L('idTargetBg', 'New background'), select([['white', L('idWhite', 'White')], ['blue', L('idBlue', 'Blue')], ['red', L('idRed', 'Red')]], target, v => target = v), ''),
        field(L('idTolerance', 'Colour tolerance'), rangeInput(30, 0, 120, 1, v => tol = v, ''), L('idToleranceHint', 'higher removes more of the old background'))),
      el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })),
      out,
      note(L('idBgNote', 'Background replacement keys out the colour in the top-left corner, so start with a plain, evenly lit backdrop. Crop and zoom to frame the head, then check the result against the exact rules of your issuing authority before printing.')));
  },

  // ------------------------------------------------------------ image-mosaic
  'image-mosaic': async (root) => {
    let src = null, brush = 30, strength = 12, mode = 'pixel', drawing = false;
    const canvas = el('canvas', { style: 'max-width:100%;height:auto;border-radius:8px;touch-action:none;cursor:crosshair;background:#f1f5f9;display:block' });
    const ctx = canvas.getContext('2d');
    const status = el('div', { class: 'note', text: L('mosWaiting', 'Add an image, then drag over the areas you want to hide.') });
    const out = outputBox(root);
    const load = async file => {
      try {
        src = await loadCanvas(file);
        canvas.width = src.width; canvas.height = src.height;
        ctx.drawImage(src.img, 0, 0);
        status.textContent = `${file.name} · ${src.width}×${src.height}`;
        out.replaceChildren();
      } catch { src = null; status.replaceChildren(); status.append(note(L('mosDecodeFail', 'Could not read that image.'), 'err')); }
    };
    fileZone(root, {
      accept: 'image/*', multiple: false, hint: L('mosHint', 'PNG, JPG, WebP…'),
      onFiles: files => {
        const f = files.find(x => (x.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(x.name));
        if (f) load(f); else toast(D.common.wrongType || L('unsupportedFileType', 'Unsupported file type'));
      }
    });
    const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / (r.width || 1)), y: (e.clientY - r.top) * (canvas.height / (r.height || 1)) }; };
    const applyAt = (x, y) => {
      if (!src) return;
      const half = brush / 2;
      const sx = Math.max(0, Math.floor(x - half)), sy = Math.max(0, Math.floor(y - half));
      const sw = Math.min(canvas.width - sx, Math.ceil(brush)), sh = Math.min(canvas.height - sy, Math.ceil(brush));
      if (sw <= 0 || sh <= 0) return;
      if (mode === 'pixel') {
        const block = Math.max(2, Math.round(strength));
        const region = ctx.getImageData(sx, sy, sw, sh);
        const d = region.data;
        for (let by = 0; by < sh; by += block) for (let bx = 0; bx < sw; bx += block) {
          let r = 0, g = 0, b = 0, a = 0, n = 0;
          const ye = Math.min(by + block, sh), xe = Math.min(bx + block, sw);
          for (let yy = by; yy < ye; yy++) for (let xx = bx; xx < xe; xx++) { const i = (yy * sw + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++; }
          r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n); a = Math.round(a / n);
          for (let yy = by; yy < ye; yy++) for (let xx = bx; xx < xe; xx++) { const i = (yy * sw + xx) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
        }
        ctx.putImageData(region, sx, sy);
      } else {
        const tw = Math.max(1, Math.round(sw / strength)), th = Math.max(1, Math.round(sh / strength));
        const tmp = el('canvas', { width: tw, height: th });
        tmp.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, tw, th);
        ctx.save(); ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tmp, 0, 0, tw, th, sx, sy, sw, sh);
        ctx.restore();
      }
    };
    canvas.addEventListener('pointerdown', e => { if (!src) return; drawing = true; canvas.setPointerCapture?.(e.pointerId); const p = pos(e); applyAt(p.x, p.y); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); applyAt(p.x, p.y); });
    const endDraw = () => { drawing = false; };
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);
    canvas.addEventListener('pointerleave', endDraw);
    const resetBtn = button(L('mosReset', 'Restore original'), () => { if (!src) { toast(L('mosNeedImage', 'Add an image first')); return; } ctx.drawImage(src.img, 0, 0); out.replaceChildren(); }, { kind: 'ghost' });
    const dlBtn = button(`${L('download', 'Download')} PNG`, () => run(dlBtn, async () => {
      out.replaceChildren();
      if (!src) throw new Error(L('mosNeedImage', 'Add an image first'));
      const blob = await toBlob(canvas, 'image/png');
      resultRow(out, 'mosaic.png', blob.size, `${canvas.width}×${canvas.height}`, blob);
    }), { kind: 'primary' });
    root.append(status, canvas,
      el('div', { class: 'controls' },
        field(L('mosMode', 'Effect'), select([['pixel', L('mosPixel', 'Pixelate')], ['blur', L('mosBlur', 'Blur')]], mode, v => mode = v), ''),
        field(L('mosBrush', 'Brush size'), rangeInput(brush, 8, 140, 1, v => brush = v, 'px'), ''),
        field(L('mosStrength', 'Strength'), rangeInput(strength, 2, 40, 1, v => strength = v, ''), L('mosStrengthHint', 'bigger = coarser blocks / stronger blur'))),
      el('div', { class: 'btn-row' }, dlBtn, resetBtn, el('span', { class: 'note', text: D.tool.privacyLine })),
      out,
      note(L('mosNote', 'Drag across a face, a number plate or any private detail to pixelate or blur it. The image is edited on a canvas in your browser and never uploaded. Download the result as a PNG.')));
  },

  // ------------------------------------------------------------ grid-splitter
  'grid-splitter': async (root) => {
    let src = null, n = 3, square = true;
    const canvas = el('canvas', { style: 'max-width:100%;height:auto;border-radius:8px;background:#f1f5f9;display:block' });
    const ctx = canvas.getContext('2d');
    const status = el('div', { class: 'note', text: L('gridWaiting', 'Add an image to slice it into a grid of squares.') });
    const out = outputBox(root);
    const drawPreview = () => {
      if (!src) { status.textContent = L('gridWaiting', 'Add an image to slice it into a grid of squares.'); return; }
      canvas.width = src.width; canvas.height = src.height;
      ctx.drawImage(src.img, 0, 0);
      const side = Math.min(src.width, src.height);
      const ox = square ? (src.width - side) / 2 : 0, oy = square ? (src.height - side) / 2 : 0;
      const spanX = square ? side : src.width, spanY = square ? side : src.height;
      ctx.save();
      ctx.strokeStyle = 'rgba(244,63,94,0.95)'; ctx.lineWidth = Math.max(2, Math.round(src.width / 260));
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const gx = ox + spanX * i / n, gy = oy + spanY * i / n;
        ctx.moveTo(gx, oy); ctx.lineTo(gx, oy + spanY);
        ctx.moveTo(ox, gy); ctx.lineTo(ox + spanX, gy);
      }
      ctx.stroke(); ctx.restore();
      status.textContent = fmt(L('gridPreview', '{0} × {1} grid · {2} pieces'), n, n, n * n);
    };
    fileZone(root, {
      accept: 'image/*', multiple: false, hint: L('gridHint', 'PNG, JPG, WebP…'),
      onFiles: async files => {
        const f = files.find(x => (x.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(x.name));
        if (!f) { toast(D.common.wrongType || L('unsupportedFileType', 'Unsupported file type')); return; }
        try { src = await loadCanvas(f); out.replaceChildren(); drawPreview(); }
        catch { src = null; status.replaceChildren(); status.append(note(L('mosDecodeFail', 'Could not read that image.'), 'err')); }
      }
    });
    const go = button(L('gridSplit', 'Split image'), () => run(go, async tick => {
      out.replaceChildren();
      if (!src) throw new Error(L('needFile', 'Add a file first'));
      const side = Math.min(src.width, src.height);
      const ox = square ? (src.width - side) / 2 : 0, oy = square ? (src.height - side) / 2 : 0;
      const cw = (square ? side : src.width) / n, ch = (square ? side : src.height) / n;
      const jobs = [], total = n * n;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        tick(`${jobs.length + 1}/${total}`);
        const cell = el('canvas', { width: Math.max(1, Math.round(cw)), height: Math.max(1, Math.round(ch)) });
        cell.getContext('2d').drawImage(src.img, ox + c * cw, oy + r * ch, cw, ch, 0, 0, cell.width, cell.height);
        const blob = await toBlob(cell, 'image/png');
        const name = `grid-${String(r * n + c + 1).padStart(2, '0')}.png`;
        jobs.push({ name, blob });
        resultRow(out, name, blob.size, `${cell.width}×${cell.height}`, blob);
      }
      zipRow(out, jobs, 'grid-pieces.zip');
    }), { kind: 'primary' });
    root.append(status, canvas,
      el('div', { class: 'controls' },
        field(L('gridSize', 'Grid'), select([[2, '2 × 2'], [3, '3 × 3'], [4, '4 × 4'], [5, '5 × 5'], [6, '6 × 6']], n, v => { n = Number(v); drawPreview(); }), L('gridSizeHint', '3 × 3 is the classic social-media nine-square')),
        el('span', {}, checkInput(L('gridSquare', 'Crop to square first'), square, v => { square = v; drawPreview(); }))),
      el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })),
      out,
      note(L('gridNote', 'The image is cut into equal pieces on a canvas in your browser. Download them one by one or as a single ZIP, then post them in order for a seamless nine-square grid. Nothing is uploaded.')));
  }
};
