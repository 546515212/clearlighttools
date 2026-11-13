// Image, audio and video tools. Everything runs on the local machine: Canvas 2D for images,
// Web Audio for sound, MediaRecorder for video. Nothing is uploaded anywhere.
import {
  fmt,
  el, D, t, bytes, pct, extOf, mmss, download, downloadZip, readAs,
  loadCanvas, canvasFrom, toBlob, fileZone, orderableList, run, loadLib,
  note, toast, select, numberInput, textInput, rangeInput, checkInput, button, field, copyText, locale
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
  const row = el('div', { class: 'result-card', style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
    blob?.type.startsWith('image/') && blob.type !== 'image/gif' && blob.type !== 'image/x-icon'
      ? el('img', { class: 'thumb', src: URL.createObjectURL(blob), alt: '', loading: 'lazy' })
      : null,
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
  box.append(el('div', { class: 'btn-row' }, b, el('span', { class: 'note', text: `${jobs.length} files` })));
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

function encodeWav(channels, sampleRate) {
  const n = channels[0].length;
  const bps = 2;
  const dataLen = n * channels.length * bps;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, channels.length, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * channels.length * bps, true);
  dv.setUint16(32, channels.length * bps, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const ch of channels) {
      const v = clamp(ch[i] ?? 0, -1, 1);
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Plain linear resample: OfflineAudioContext needs a real AudioBuffer, and after trimming
// we only hold Float32Arrays.
function resampleFloat(input, fromRate, toRate) {
  if (fromRate === toRate) return Float32Array.from(input);
  const outLen = Math.max(1, Math.round(input.length * toRate / fromRate));
  const out = new Float32Array(outLen);
  const step = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const p = i * step;
    const i0 = Math.floor(p), i1 = Math.min(input.length - 1, i0 + 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (p - i0);
  }
  return out;
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
      field(L('maxWidth', 'Max width (px)'), numberInput(0, v => maxDim = Math.max(0, Number(v) || 0), { min: 0, step: 50 }), '0 = keep'),
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
      meta.textContent = `${f.name} · ${bytes(f.size)} · ${full.length.toLocaleString(locale())} characters of text (base64 is ~33% larger than the bytes it encodes)`;
    };
    const { files } = imagePanel(root, {
      one: true,
      onChange: async list => {
        const f = list[0];
        if (!f) { area.value = ''; meta.textContent = L('waitingFile', 'Waiting for a file.'); return; }
        meta.textContent = `Reading ${f.name}…`;
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
      resultRow(out, `decoded.${mime.split('/')[1].replace('jpeg', 'jpg')}`, blob.size, `${mime} · ${dims} · from ${body.length.toLocaleString(locale())} base64 characters`, blob);
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
      field(L('encryption', 'Encryption'), select([['WPA', L('wpaWpa2', 'WPA / WPA2')], ['WEP', 'WEP'], ['nopass', 'Open']], 'WPA', v => { enc = v; draw(); }), ''),
      el('span', {}, checkInput(L('hiddenNetwork', 'Hidden network'), false, v => { hidden = v; draw(); })));
    ta.addEventListener('input', draw);
    root.append(
      field(L('contentType', 'Content type'), select([['text', L('contentTextUrl', 'Text / URL')], ['wifi', 'Wi‑Fi'], ['url', L('url', 'URL')]], mode, v => {
        mode = v;
        wifiBox.style.display = v === 'wifi' ? 'flex' : 'none';
        ta.style.display = v === 'wifi' ? 'none' : '';
        draw();
      }), ''),
      ta, wifiBox,
      el('div', { class: 'controls' },
        field(L('errorCorrection', 'Error correction'), select([['L', 'L · ~7%'], ['M', 'M · ~15%'], ['Q', 'Q · ~25%'], ['H', 'H · ~30%']], ecl, v => { ecl = v; draw(); }), L('higherSurvivesMoreDamage', 'higher = survives more damage')),
        field(L('moduleSize', 'Module size'), numberInput(8, v => { cell = clamp(Number(v) || 8, 1, 64); draw(); }, { min: 1, max: 64 }), 'px'),
        field(L('quietZone', 'Quiet zone'), numberInput(4, v => { margin = clamp(Number(v) || 0, 0, 24); draw(); }, { min: 0, max: 24 }), 'modules'),
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
        note(fmt(L('qrPayloadPreview', '{0} payload: {1}'), mode === 'wifi' ? 'Wi-Fi' : L('qrModeText', 'Text'), data.length > 90 ? data.slice(0, 90) + '…' : data)));
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
    imagePanel(root, { one: true, hint: 'Use a square image, at least 512×512 for the largest size', onChange: async list => {
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
        resultRow(out, 'favicon.ico', blob.size, `${parts.length} sizes in one file`, blob);
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
    imagePanel(root, { one: true, hint: 'Optional: drop an image, then click it to sample a pixel', onChange: showImage });

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
        ['HSL', `hsl(${hh}, ${ss}%, ${ll}%)`], ['CMYK', cmyk(r, g, b)], ['Closest name', nearest(r, g, b)]];
      const kv = el('div', { class: 'kv' });
      for (const [k, v] of rows) {
        const b2 = button('copy', () => copyText(v), { kind: 'ghost' });
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

  // ------------------------------------------------------------ trim-audio
  'trim-audio': async (root) => {
    let buf = null, file = null, from = 0, to = 0, fade = 0, mono = true, rate = 44100;
    const info = el('div', { class: 'note', text: L('waitingFile', 'Waiting for a file.') });
    const player = el('audio', { controls: true, style: 'width:100%' });
    const out = el('div', { class: 'out output-box' });
    const fIn = numberInput(0, v => from = Math.max(0, Number(v) || 0), { min: 0, step: 0.1 });
    const tIn = numberInput(0, v => to = Math.max(0, Number(v) || 0), { min: 0, step: 0.1 });
    const rates = select([[48000, '48 kHz'], [44100, '44.1 kHz'], [32000, '32 kHz'], [22050, '22 kHz'], [16000, '16 kHz'], [8000, '8 kHz']], 44100, v => rate = Number(v));
    fileZone(root, {
      accept: 'audio/*,video/*', multiple: false, hint: 'MP3, WAV, OGG, M4A…',
      onFiles: async incoming => {
        const f = incoming[0];
        if (!f) return;
        file = f;
        info.textContent = `Decoding ${f.name}…`;
        try {
          const ac = new AudioContext({ sampleRate: 48000 });
          buf = await ac.decodeAudioData(await f.arrayBuffer());
          ac.close();
          player.src = URL.createObjectURL(f);
          from = 0; to = Math.round(buf.duration * 1000) / 1000;
          fIn.value = from; tIn.value = to; fIn.max = to; tIn.max = to;
          info.textContent = `${f.name} · ${bytes(f.size)} · ${mmss(buf.duration)} · ${buf.sampleRate} Hz · ${buf.numberOfChannels === 1 ? 'mono' : 'stereo'}`;
          out.replaceChildren();
        } catch {
          buf = null;
          info.replaceChildren();
          info.append(note(L('couldNotDecodeThatFile', 'Could not decode that file. Browsers refuse some AAC/AMR/DRM recordings.'), 'err'));
        }
      }
    });
    root.append(info, player,
      el('div', { class: 'controls' },
        field(L('trimFrom', 'Cut from'), fIn, 'seconds'),
        field(L('trimTo', 'Cut until'), tIn, 'seconds'),
        field(L('fadeOut', 'Fade out (s)'), numberInput(0, v => fade = Math.max(0, Number(v) || 0), { min: 0, step: 0.1 }), 'seconds'),
        field(L('sampleRate', 'Sample rate'), rates, L('lowerSmallerFile', 'lower = smaller file')),
        el('span', {}, checkInput('Mono', true, v => mono = v))), out);
    const go = button(L('btnCut', 'Cut'), () => run(go, async tick => {
      out.replaceChildren();
      if (!buf || !file) throw new Error(L('needAudio', 'Add an audio file first'));
      const a = clamp(from, 0, buf.duration), b = clamp(to, 0, buf.duration);
      if (!(b > a)) throw new Error(L('endMustBeAfterStart', 'End must be after start'));
      tick(D.common.processing || 'Working…');
      const sr = buf.sampleRate;
      const s0 = Math.floor(a * sr);
      const len = Math.max(1, Math.min(buf.length, Math.floor(b * sr)) - s0);
      const nCh = mono ? 1 : buf.numberOfChannels;
      const chans = [];
      for (let c = 0; c < nCh; c++) {
        const outCh = new Float32Array(len);
        if (mono && buf.numberOfChannels > 1) {
          for (let i = 0; i < len; i++) {
            let acc = 0;
            for (let k = 0; k < buf.numberOfChannels; k++) acc += buf.getChannelData(k)[s0 + i];
            outCh[i] = acc / buf.numberOfChannels;
          }
        } else {
          const srcCh = buf.getChannelData(c);
          for (let i = 0; i < len; i++) outCh[i] = srcCh[s0 + i];
        }
        chans.push(outCh);
      }
      if (fade > 0) {
        const f = Math.min(len, Math.floor(fade * sr));
        const tail = chans[nCh - 1];
        for (let i = 1; i <= f; i++) tail[len - i] *= (f - i) / f;
      }
      const resampled = chans.map(ch => resampleFloat(ch, sr, rate));
      const blob = encodeWav(resampled, rate);
      resultRow(out, extOf(file.name, 'wav'), blob.size, `${mmss(b - a)} clip · ${rate} Hz · ${mono ? 'mono' : nCh + ' ch'}`, blob);
      out.append(note(L('wavIsUncompressedSoIt', 'WAV is uncompressed, so it is bigger than the MP3 you started with. Use a lower sample rate and mono for voice; re-encode to MP3 with a dedicated encoder if you need the smallest file.')));
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ compress-video
  'compress-video': async (root) => {
    let file = null, bitrate = 800, maxW = 640, keepAudio = true;
    let recording = false, recorder = null, chunks = [], elapsed = 0;
    const video = el('video', { playsinline: true, controls: true, style: 'width:100%;max-height:340px;background:#000;border-radius:8px' });
    const status = el('div', { class: 'note', text: L('waitingFile', 'Waiting for a file.') });
    const out = el('div', { class: 'out output-box' });
    const maxWIn = numberInput(640, v => maxW = clamp(Number(v) || 640, 160, 1920), { min: 160, step: 80 });
    fileZone(root, {
      accept: 'video/*', multiple: false, hint: 'MP4, WebM, MOV…',
      onFiles: incoming => {
        const f = incoming.find(x => (x.type || '').startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(x.name));
        if (!f) { toast(D.common.wrongType || L('unsupportedFileType', 'Unsupported file type')); return; }
        file = f; chunks = []; out.replaceChildren();
        status.textContent = `Loading ${f.name}…`;
        video.src = URL.createObjectURL(f);
        video.onloadedmetadata = () => {
          maxW = Math.min(1280, video.videoWidth || 640);
          maxWIn.value = maxW;
          status.textContent = `${f.name} · ${bytes(f.size)} · ${mmss(video.duration)} · ${video.videoWidth}×${video.videoHeight}`;
        };
        video.onerror = () => { status.replaceChildren(); status.append(note(L('thisBrowserCannotPlayThat', 'This browser cannot play that file, so it cannot re-encode it either.'), 'err')); };
      }
    });
    root.append(status, video,
      el('div', { class: 'controls' },
        field(L('bitrate', 'Bitrate'), select([[2000, '2000 kbps'], [1200, '1200 kbps'], [800, '800 kbps'], [500, '500 kbps'], [300, '300 kbps'], [150, '150 kbps']], 800, v => bitrate = Number(v)), L('lowerSmaller', 'lower = smaller')),
        field(L('maxWidth', 'Max width (px)'), maxWIn, ''),
        el('span', {}, checkInput(L('keepAudio', 'Keep audio'), true, v => keepAudio = v))), out);
    const startBtn = button(L('start', 'Start'), () => run(startBtn, async tick => {
      out.replaceChildren();
      recording = true; chunks = []; elapsed = Date.now();
      if (!file) throw new Error(L('needVideo', 'Add a video first'));
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error(L('thisBrowserHasNoMediarecorder', 'This browser has no MediaRecorder/canvas capture support'));
      if (!video.videoWidth) throw new Error(L('theClipHasNotFinished', 'The clip has not finished loading'));
      tick('Preparing…');
      const scale = Math.min(1, maxW / video.videoWidth);
      const w = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
      const h = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
      const canvas = el('canvas', { width: w, height: h });
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      let ac = null;
      if (keepAudio) {
        try {
          ac = new AudioContext();
          const node = ac.createMediaElementSource(video);
          const dest = ac.createMediaStreamDestination();
          node.connect(dest); // routed into the recording only, not the speakers
          dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
          await ac.resume();
        } catch { ac = null; }
      }
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm']
        .find(m => window.MediaRecorder.isTypeSupported?.(m));
      if (!mime) throw new Error(L('noSupportedWebmRecordingProfile', 'No supported WebM recording profile in this browser'));
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate * 1000 });
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      const stopped = new Promise(r => recorder.onstop = r);
      const dur = video.duration;
      video.pause();
      await new Promise(r => { video.onseeked = r; video.currentTime = 0; });
      recorder.start(300);
      tick('0:00');
      const clock = setInterval(() => tick(`${mmss(video.currentTime)} / ${isFinite(dur) ? mmss(dur) : '…'}`), 400);
      await new Promise(resolve => {
        let raf;
        const step = () => {
          if (!recording) return finish();
          if (video.readyState >= 2 && !video.paused) ctx.drawImage(video, 0, 0, w, h);
          if (video.ended || (isFinite(dur) && video.currentTime >= dur - 0.02)) return finish();
          raf = requestAnimationFrame(step);
        };
        const finish = () => { cancelAnimationFrame(raf); resolve(); };
        video.onended = finish;
        video.onpause = () => { if (recording) finish(); };
        video.play().then(() => raf = requestAnimationFrame(step), () => {
          status.replaceChildren();
          status.append(note(L('theBrowserBlockedPlaybackSo', 'The browser blocked playback, so recording cannot start. Press play yourself and try again.'), 'err'));
          recording = false; finish();
        });
      });
      clearInterval(clock);
      recording = false;
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      ac?.close();
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (!blob.size) throw new Error(L('nothingWasRecorded', 'Nothing was recorded'));
      const secs = Math.round((Date.now() - elapsed) / 1000);
      resultRow(out, extOf(file.name, 'webm'), blob.size, `${bytes(file.size)} → ${bytes(blob.size)} · ${secs}s of real time`, blob);
      out.append(note(L('reEncodingHappensLiveA', 'Re-encoding happens live: a 3 minute clip takes 3 minutes. The container is WebM; browsers cannot write MP4 locally.')));
    }, { kind: 'primary' }));
    const stopBtn = button(L('stop', 'Stop'), () => { recording = false; video.pause(); }, { kind: 'ghost' });
    root.append(el('div', { class: 'btn-row' }, startBtn, stopBtn, el('span', { class: 'note', text: D.tool.privacyLine })));
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
      field('Hue', rangeInput(0, 0, 360, 5, v => { hue = v; sync(); }, '°'), ''),
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
  }
};
