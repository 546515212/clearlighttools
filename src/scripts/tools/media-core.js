// Shared audio/video engine for the audio.js and video.js bundles. Everything runs on the local
// machine: Web Audio decodes, pure-JS DSP transforms, lamejs encodes MP3, MediaRecorder captures.
// No sample ever leaves the browser. The pure functions (encodeWav, resampleFloat, timeStretch,
// biquadPeaking) touch no DOM, so they are deterministic and unit-testable; the UI helpers and the
// recorder build the panels. Every visitor-facing string goes through L() so it can be translated.
import {
  fmt, el, D, t, bytes, mmss, download, fileZone, orderableList, loadLib, note, toast, button
} from '../lib.js';

const L = (k, fb) => t(k, fb);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- pure DSP
// 16-bit PCM WAV. channels is an array of Float32Arrays in [-1, 1]; values outside are clamped.
export function encodeWav(channels, sampleRate) {
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

// Plain linear resample between two sample rates. After DSP we only hold Float32Arrays, and the
// encoders want a single consistent rate, so this is the bridge.
export function resampleFloat(input, fromRate, toRate) {
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

export function floatTo16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = clamp(input[i], -1, 1);
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

// Overlap-add time stretch: changes duration by `factor` (1.5 = 50% longer) WITHOUT changing pitch.
// Hann grains at 50% overlap sum to unity (COLA), so dividing the accumulated output by the accumulated
// window restores the original amplitude. This is what lets change-speed keep the voice natural and
// change-pitch restore the original duration after a resampling pitch shift.
export function timeStretch(input, factor, sampleRate) {
  factor = clamp(factor, 0.25, 4);
  if (Math.abs(factor - 1) < 1e-3 || !input.length) return Float32Array.from(input);
  const grain = Math.max(256, Math.round(sampleRate * 0.046));   // ~46 ms window
  const synthHop = Math.floor(grain / 2);                        // 50% overlap
  const analysisHop = synthHop / factor;
  const target = Math.max(1, Math.round(input.length * factor));
  const outLen = target + grain;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const win = new Float32Array(grain);
  for (let i = 0; i < grain; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (grain - 1));
  let aPos = 0, sPos = 0;
  while (aPos < input.length) {
    const base = Math.floor(aPos);
    for (let j = 0; j < grain; j++) {
      const idx = base + j;
      const s = idx < input.length ? input[idx] : 0;
      const w = win[j];
      const o = sPos + j;
      if (o < outLen) { out[o] += s * w; norm[o] += w; }
    }
    aPos += analysisHop;
    sPos += synthHop;
  }
  const res = new Float32Array(target);
  for (let i = 0; i < target; i++) res[i] = norm[i] > 1e-6 ? out[i] / norm[i] : (out[i] || 0);
  return res;
}

// RBJ cookbook peaking EQ, pure JS so it needs no OfflineAudioContext and behaves identically everywhere.
export function biquadPeaking(input, sampleRate, freq, gainDb, Q = 1) {
  if (!gainDb) return Float32Array.from(input);
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * clamp(freq, 10, sampleRate / 2 - 10) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosw0 = Math.cos(w0);
  const a0 = 1 + alpha / A;
  const b0 = (1 + alpha * A) / a0, b1 = (-2 * cosw0) / a0, b2 = (1 - alpha * A) / a0;
  const a1 = (-2 * cosw0) / a0, a2 = (1 - alpha / A) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

export const EQ_BANDS = [60, 250, 1000, 4000, 12000];
export function applyEqualizer(channels, sampleRate, gains) {
  return channels.map(ch => {
    let out = ch;
    EQ_BANDS.forEach((f, i) => { if (gains[i]) out = biquadPeaking(out, sampleRate, f, gains[i], 1); });
    return out;
  });
}

// ---------------------------------------------------------------- encoders
export async function encodeMp3(channels, sampleRate, kbps = 192) {
  const lamejs = await loadLib('lamejs');
  const nCh = Math.min(2, channels.length);
  const encoder = new lamejs.Mp3Encoder(nCh, sampleRate, kbps);
  const left = floatTo16(channels[0]);
  const right = nCh > 1 ? floatTo16(channels[1]) : null;
  const block = 1152;
  const chunks = [];
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const buf = right ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l);
    if (buf.length) chunks.push(new Int8Array(buf));
  }
  const end = encoder.flush();
  if (end.length) chunks.push(new Int8Array(end));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

export async function encodeAudio(channels, sampleRate, { format = 'mp3', kbps = 192 } = {}) {
  if (format === 'wav') return encodeWav(channels, sampleRate);
  return encodeMp3(channels, sampleRate, kbps);
}

// ---------------------------------------------------------------- decode
export async function decodeAudio(file, { sampleRate } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error(L('noWebAudio', 'This browser has no Web Audio support, so it cannot decode sound.'));
  const ac = sampleRate ? new Ctx({ sampleRate }) : new Ctx();
  try {
    return await ac.decodeAudioData(await file.arrayBuffer());
  } finally {
    ac.close();
  }
}

// Copy a decoded buffer into plain Float32Arrays, optionally mixing down to mono.
export function bufferChannels(buffer, { mono = false } = {}) {
  const n = buffer.numberOfChannels;
  const len = buffer.length;
  if (mono && n > 1) {
    const out = new Float32Array(len);
    for (let c = 0; c < n; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < len; i++) out[i] += d[i] / n; }
    return [out];
  }
  const chans = [];
  for (let c = 0; c < n; c++) chans.push(Float32Array.from(buffer.getChannelData(c)));
  return chans;
}

// Force a buffer to `target` channels: mix down to mono, or duplicate mono up to stereo.
export function matchChannels(buffer, target) {
  const src = bufferChannels(buffer);
  if (src.length === target) return src;
  if (target === 1) {
    const len = src[0].length, out = new Float32Array(len);
    for (let i = 0; i < len; i++) { let a = 0; for (const c of src) a += c[i]; out[i] = a / src.length; }
    return [out];
  }
  const out = [];
  for (let c = 0; c < target; c++) out.push(src[Math.min(c, src.length - 1)]);
  return out;
}

// ---------------------------------------------------------------- UI helpers
export function outputBox(root) {
  const box = el('div', { class: 'out output-box' });
  root.append(box);
  return box;
}

// A playable result with a download button. kind 'audio' renders <audio>, 'video' renders <video>.
export function mediaResultRow(box, name, blob, extra, kind = 'audio') {
  const url = URL.createObjectURL(blob);
  const player = kind === 'video'
    ? el('video', { controls: true, src: url, style: 'width:100%;max-height:320px;background:#000;border-radius:8px' })
    : el('audio', { controls: true, src: url, style: 'width:100%' });
  const row = el('div', { class: 'result-card' },
    player,
    el('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:8px' },
      el('span', { class: 'nm', text: name, style: 'flex:1;min-width:140px;font-weight:600' }),
      el('span', { class: 'sz', text: bytes(blob.size) }),
      extra ? el('span', { class: 'delta', text: extra }) : null,
      button(L('download', 'Download'), () => download(blob, name), { kind: 'ghost' })));
  box.append(row);
  return row;
}

export function audioMeta(file, buffer) {
  const ch = buffer.numberOfChannels === 1 ? L('monoAudio', 'mono') : fmt(L('nChannels', '{0} ch'), buffer.numberOfChannels);
  return `${file.name} · ${bytes(file.size)} · ${mmss(buffer.duration)} · ${buffer.sampleRate} Hz · ${ch}`;
}

// Drop zone for sound. Single-file mode replaces; multi mode keeps an orderable list (for the joiner).
export function audioPanel(root, { accept = 'audio/*', multiple = false, hint, onChange } = {}) {
  const files = [];
  const list = el('div');
  const ui = multiple ? orderableList(list, files, { onChange: () => { ui.draw(); onChange?.(files); }, label: hint }) : null;
  const isSound = f => (f.type || '').startsWith('audio/') || (f.type || '').startsWith('video/')
    || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm|mp4|mov|mkv)$/i.test(f.name);
  fileZone(root, {
    accept, multiple, hint,
    onFiles: incoming => {
      const ok = incoming.filter(isSound);
      if (!ok.length) { toast(D.common.wrongType || L('unsupportedFileType', 'Unsupported file type')); return; }
      if (!multiple) { files.length = 0; files.push(ok[0]); }
      else files.push(...ok);
      ui?.draw();
      onChange?.(files);
    }
  });
  if (multiple) root.append(list);
  return { files, draw: () => ui?.draw() };
}

// ---------------------------------------------------------------- recorder engine
// One builder for the three capture tools. mode 'voice' = microphone only, 'webcam' = camera+mic,
// 'screen' = display+system audio. Acquisition, permission errors, the live timer, track cleanup and
// the playable result are shared; only the stream source and the preview element differ.
export function recorderPanel(root, { mode = 'voice' } = {}) {
  const isVideo = mode !== 'voice';
  const preview = isVideo
    ? el('video', { playsinline: true, muted: true, style: 'width:100%;max-height:340px;background:#000;border-radius:8px' })
    : null;
  // status is a plain wrapper, not a .note itself: fillStatus() swaps in a single note(msg, kind)
  // child. Giving the wrapper the .note class too boxed every message twice (a pink error inside a
  // grey note, double padding) and the recording timer's textContent wiped the inner note's colour.
  const status = el('div', { class: 'recorder-status' }, note(L('recorderReady', 'Press Record to begin. Nothing is uploaded.')));
  const out = outputBox(root);
  let recorder = null, stream = null, chunks = [], recording = false, startTime = 0, timer = null;

  const candidates = isVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  const pickMime = () => (window.MediaRecorder && candidates.find(m => window.MediaRecorder.isTypeSupported?.(m))) || '';
  const extFor = mime => /mp4/.test(mime) ? (isVideo ? 'mp4' : 'm4a') : /ogg/.test(mime) ? 'ogg' : 'webm';

  const acquire = async () => {
    if (mode === 'screen') {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error(L('noScreenCapture', 'This browser cannot capture the screen. Try Chrome or Edge on desktop.'));
      return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(L('noMicCamera', 'This browser cannot reach the microphone or camera. A secure (https) page is required.'));
    return navigator.mediaDevices.getUserMedia(isVideo
      ? { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
      : { audio: true });
  };

  const cleanup = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach(tr => tr.stop()); stream = null; }
    if (preview) preview.srcObject = null;
  };

  const finish = () => {
    recording = false;
    stopBtn.disabled = true; startBtn.disabled = false;
    const mime = recorder?.mimeType || pickMime() || (isVideo ? 'video/webm' : 'audio/webm');
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    cleanup();
    if (!blob.size) { fillStatus(note(L('nothingWasRecorded', 'Nothing was recorded'), 'err')); return; }
    const secs = Math.round((Date.now() - startTime) / 1000);
    const name = `${mode}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extFor(mime)}`;
    mediaResultRow(out, name, blob, fmt(L('ui0SOfRecording', '{0} recording'), mmss(secs)), isVideo ? 'video' : 'audio');
    fillStatus(note(L('recordingSaved', 'Your recording is below. Download it to keep it.'), 'ok'));
  };

  const fillStatus = node => { status.replaceChildren(); status.append(node); };

  const startBtn = button(L('record', 'Record'), async () => {
    if (recording) return;
    out.replaceChildren();
    fillStatus(note(L('requestingPermission', 'Allow access when your browser asks for it.')));
    try {
      if (!window.MediaRecorder) throw new Error(L('thisBrowserHasNoMediarecorder', 'This browser has no MediaRecorder/canvas capture support'));
      stream = await acquire();
      if (preview) { preview.srcObject = stream; await preview.play().catch(() => {}); }
      const mime = pickMime();
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      recorder.onstop = finish;
      // stopping the share from the browser's own UI ends the track: treat that as pressing Stop
      stream.getVideoTracks?.().forEach(tr => tr.addEventListener('ended', () => { if (recording) stopBtn.click(); }));
      recorder.start(250);
      recording = true; startTime = Date.now();
      startBtn.disabled = true; stopBtn.disabled = false;
      fillStatus(note(L('recordingInProgress', 'Recording… press Stop when you are done.'), 'ok'));
      timer = setInterval(() => {
        const line = status.firstElementChild;
        if (line) line.textContent = `${L('recordingInProgress', 'Recording… press Stop when you are done.')} ${mmss((Date.now() - startTime) / 1000)}`;
      }, 500);
    } catch (err) {
      cleanup();
      recording = false; startBtn.disabled = false; stopBtn.disabled = true;
      const denied = /denied|permission|notallowed/i.test(`${err?.name} ${err?.message}`);
      const msg = denied ? L('permissionDenied', 'Access was denied. Enable the microphone, camera or screen permission and try again.') : L('recordingFailed', 'Recording could not start.');
      fillStatus(note(msg, 'err'));
    }
  }, { kind: 'primary' });

  const stopBtn = button(L('stop', 'Stop'), () => {
    if (!recording || !recorder) return;
    recording = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (recorder.state !== 'inactive') recorder.stop();   // fires onstop -> finish
  }, { kind: 'ghost', disabled: true });

  if (preview) root.append(preview);
  root.append(status,
    el('div', { class: 'btn-row' }, startBtn, stopBtn, el('span', { class: 'note', text: D.tool.privacyLine })),
    out);
}