// Audio tools. Web Audio decodes every input locally, pure-JS DSP (see media-core.js) transforms the
// samples, and lamejs/WAV encode the result. Nothing is uploaded. trim-audio lives here now that audio
// is its own category; the shared decode/encode/UI helpers come from media-core.js.
import {
  fmt, el, D, t, bytes, extOf, mmss, run, note, stat, select, numberInput, rangeInput, checkInput, button, field, fill
} from '../lib.js';
import {
  clamp, decodeAudio, bufferChannels, matchChannels, resampleFloat, timeStretch, applyEqualizer, EQ_BANDS,
  encodeAudio, encodeWav, audioPanel, audioMeta, outputBox, mediaResultRow, recorderPanel
} from './media-core.js';

const L = (k, fb) => t(k, fb);

// One drop zone + decode + metadata line, shared by every single-file audio tool. onLoaded fires after
// a decode succeeds (or fails) so a tool can sync its own controls (the trimmer's player and range).
function soundSource(root, { accept = 'audio/*,video/*', hint, onLoaded } = {}) {
  const state = { file: null, buf: null };
  const info = el('div', { class: 'note', text: L('waitingFile', 'Waiting for a file.') });
  audioPanel(root, {
    accept, hint,
    onChange: async files => {
      state.file = files[0] || null; state.buf = null;
      if (!state.file) { info.textContent = L('waitingFile', 'Waiting for a file.'); onLoaded?.(state); return; }
      info.textContent = fmt(L('decodingFile', 'Decoding {0}…'), state.file.name);
      try {
        state.buf = await decodeAudio(state.file);
        info.textContent = audioMeta(state.file, state.buf);
      } catch {
        info.replaceChildren();
        info.append(note(L('couldNotDecodeThatFile', 'Could not decode that file. Browsers refuse some AAC/AMR/DRM recordings.'), 'err'));
      }
      onLoaded?.(state);
    }
  });
  root.append(info);
  return { state, info };
}

// MP3/WAV + bitrate controls appended after a tool's own sliders. Returns the live options object.
function exportOptions(root) {
  const opt = { format: 'mp3', kbps: 192 };
  root.append(el('div', { class: 'controls' },
    field(L('format', 'Format'), select([['mp3', 'MP3'], ['wav', 'WAV']], opt.format, v => opt.format = v), L('mp3SmallestWavLossless', 'MP3 is small and universal; WAV is lossless and large.')),
    field(L('bitrate', 'Bitrate'), select([[320, '320 kbps'], [256, '256 kbps'], [192, '192 kbps'], [128, '128 kbps'], [96, '96 kbps'], [64, '64 kbps']], opt.kbps, v => opt.kbps = Number(v)), L('mp3Only', 'MP3 only'))));
  return opt;
}

const needSound = state => { if (!state.buf || !state.file) throw new Error(L('needAudio', 'Add an audio file first')); };

export const tools = {

  // ------------------------------------------------------------ trim-audio
  'trim-audio': async (root) => {
    let from = 0, to = 0, fade = 0, mono = true, rate = 44100;
    const player = el('audio', { controls: true, style: 'width:100%' });
    const wave = el('canvas', { style: 'width:100%;height:120px;display:block;border-radius:8px;background:#0f172a;touch-action:none;cursor:crosshair;margin:10px 0' });
    const wctx = wave.getContext('2d');
    let peaks = [], peakWidth = 0, dragging = false, dragStart = 0, playerUrl = null;
    const fIn = numberInput(0, v => { from = Math.max(0, Number(v) || 0); renderWave(); }, { min: 0, step: 0.1 });
    const tIn = numberInput(0, v => { to = Math.max(0, Number(v) || 0); renderWave(); }, { min: 0, step: 0.1 });
    const syncInputs = () => { fIn.value = Math.round(from * 1000) / 1000; tIn.value = Math.round(to * 1000) / 1000; };
    const computePeaks = (buf, W) => {
      const data = buf.getChannelData(0);
      const step = Math.max(1, Math.floor(data.length / W));
      const hop = Math.max(1, Math.floor(step / 40));
      peaks = [];
      for (let x = 0; x < W; x++) {
        let mx = 0; const s = x * step;
        for (let i = 0; i < step; i += hop) { const v = Math.abs(data[s + i] || 0); if (v > mx) mx = v; }
        peaks.push(mx);
      }
    };
    const renderWave = () => {
      const buf = state.buf;
      const W = Math.max(1, wave.clientWidth || 600), H = 120;
      if (wave.width !== W) { wave.width = W; peakWidth = 0; }
      wave.height = H;
      wctx.clearRect(0, 0, W, H);
      if (!buf) return;
      if (peakWidth !== W || !peaks.length) { computePeaks(buf, W); peakWidth = W; }
      wctx.fillStyle = '#38bdf8';
      for (let x = 0; x < W; x++) { const h = Math.max(1, (peaks[x] || 0) * (H - 8)); wctx.fillRect(x, (H - h) / 2, 1, h); }
      const dur = buf.duration || 0;
      if (dur) {
        const a = clamp(from, 0, dur) / dur * W, b = clamp(to, 0, dur) / dur * W;
        wctx.fillStyle = 'rgba(15,23,42,0.66)';
        wctx.fillRect(0, 0, a, H); wctx.fillRect(b, 0, W - b, H);
        wctx.fillStyle = '#f43f5e';
        wctx.fillRect(a, 0, 2, H); wctx.fillRect(Math.max(0, b - 2), 0, 2, H);
      }
    };
    const { state } = soundSource(root, {
      hint: L('mp3WavOggM4a', 'MP3, WAV, OGG, M4A…'),
      onLoaded: s => {
        if (s.buf) {
          if (playerUrl) URL.revokeObjectURL(playerUrl);
          playerUrl = URL.createObjectURL(s.file); player.src = playerUrl;
          from = 0; to = Math.round(s.buf.duration * 1000) / 1000;
          fIn.value = from; tIn.value = to; fIn.max = to; tIn.max = to;
          peakWidth = 0; renderWave();
        } else { if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null; } player.removeAttribute('src'); peaks = []; renderWave(); }
      }
    });
    const xToTime = clientX => { const r = wave.getBoundingClientRect(); return clamp((clientX - r.left) / (r.width || 1), 0, 1) * (state.buf?.duration || 0); };
    wave.addEventListener('pointerdown', e => { if (!state.buf) return; dragging = true; wave.setPointerCapture?.(e.pointerId); dragStart = xToTime(e.clientX); from = to = dragStart; syncInputs(); renderWave(); });
    wave.addEventListener('pointermove', e => { if (!dragging) return; const t = xToTime(e.clientX); from = Math.min(dragStart, t); to = Math.max(dragStart, t); syncInputs(); renderWave(); });
    const endDrag = () => { dragging = false; };
    wave.addEventListener('pointerup', endDrag);
    wave.addEventListener('pointercancel', endDrag);
    const onResize = () => renderWave();
    window.addEventListener('resize', onResize);
    if (root.parentNode) {
      const mo = new MutationObserver(() => { if (!root.isConnected) { window.removeEventListener('resize', onResize); if (playerUrl) URL.revokeObjectURL(playerUrl); mo.disconnect(); } });
      mo.observe(root.parentNode, { childList: true });
    }
    const out = outputBox(root);
    root.append(el('div', { class: 'note', text: L('wfHint', 'Drag across the waveform to choose the part to keep, or type the times below.') }), wave, player,
      el('div', { class: 'controls' },
        field(L('trimFrom', 'Cut from'), fIn, L('seconds', 'seconds')),
        field(L('trimTo', 'Cut until'), tIn, L('seconds', 'seconds')),
        field(L('fadeOut', 'Fade out (s)'), numberInput(0, v => fade = Math.max(0, Number(v) || 0), { min: 0, step: 0.1 }), L('seconds', 'seconds')),
        field(L('sampleRate', 'Sample rate'), select([[48000, '48 kHz'], [44100, '44.1 kHz'], [32000, '32 kHz'], [22050, '22 kHz'], [16000, '16 kHz'], [8000, '8 kHz']], 44100, v => rate = Number(v)), L('lowerSmallerFile', 'lower = smaller file')),
        el('span', {}, checkInput(L('mono', 'Mono'), true, v => mono = v))), out);
    const go = button(L('btnCut', 'Cut'), () => run(go, async tick => {
      out.replaceChildren();
      needSound(state);
      const buf = state.buf;
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
          for (let i = 0; i < len; i++) { let acc = 0; for (let k = 0; k < buf.numberOfChannels; k++) acc += buf.getChannelData(k)[s0 + i]; outCh[i] = acc / buf.numberOfChannels; }
        } else { const srcCh = buf.getChannelData(c); for (let i = 0; i < len; i++) outCh[i] = srcCh[s0 + i]; }
        chans.push(outCh);
      }
      // Fade every channel (not just the last) and ramp DOWN toward the end: gain 0 at the final
      // sample, ~1 at the start of the fade. The old (f-i)/f ramp rose toward the end (a fade-in)
      // and only touched chans[nCh-1], so stereo fades left one channel at full volume.
      if (fade > 0) { const f = Math.min(len, Math.floor(fade * sr)); for (const ch of chans) for (let i = 1; i <= f; i++) ch[len - i] *= (i - 1) / f; }
      const resampled = chans.map(ch => resampleFloat(ch, sr, rate));
      const blob = encodeWav(resampled, rate);
      mediaResultRow(out, extOf(state.file.name, 'wav'), blob, fmt(L('clipRateAndChannels', '{0} clip · {1} Hz · {2}'), mmss(b - a), rate, mono ? L('monoAudio', 'mono') : fmt(L('nChannels', '{0} ch'), nCh)), 'audio');
      out.append(note(L('wavIsUncompressedSoIt', 'WAV is uncompressed, so it is bigger than the MP3 you started with. Use a lower sample rate and mono for voice; re-encode to MP3 with a dedicated encoder if you need the smallest file.')));
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ audio-joiner
  'audio-joiner': async (root) => {
    const { files } = audioPanel(root, { accept: 'audio/*,video/*', multiple: true, hint: L('addAudioFilesInOrder', 'Add audio files in the order you want them joined. Use the arrows to reorder.') });
    const opt = exportOptions(root);
    const out = outputBox(root);
    const go = button(L('join', 'Join'), () => run(go, async tick => {
      out.replaceChildren();
      if (files.length < 2) throw new Error(L('needFiles', 'Add at least two files'));
      const decoded = [];
      for (const [i, f] of files.entries()) { tick(`${i + 1} / ${files.length}`); decoded.push(await decodeAudio(f)); }
      const commonRate = Math.max(...decoded.map(b => b.sampleRate));
      const commonCh = Math.max(...decoded.map(b => b.numberOfChannels));
      const prepared = decoded.map(b => matchChannels(b, commonCh).map(ch => resampleFloat(ch, b.sampleRate, commonRate)));
      const total = prepared.reduce((s, chans) => s + chans[0].length, 0);
      const joined = Array.from({ length: commonCh }, () => new Float32Array(total));
      let off = 0;
      for (const chans of prepared) { for (let c = 0; c < commonCh; c++) joined[c].set(chans[c], off); off += chans[0].length; }
      const blob = await encodeAudio(joined, commonRate, { format: opt.format, kbps: opt.kbps });
      mediaResultRow(out, `joined-${files.length}-files.${opt.format}`, blob, fmt(L('ui0Files1Duration', '{0} files · {1}'), files.length, mmss(total / commonRate)), 'audio');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ audio-converter
  'audio-converter': async (root) => {
    let rate = 44100;
    const { state } = soundSource(root, { hint: L('mp3WavOggM4a', 'MP3, WAV, OGG, M4A…') });
    root.append(el('div', { class: 'controls' },
      field(L('sampleRate', 'Sample rate'), select([[48000, '48 kHz'], [44100, '44.1 kHz'], [32000, '32 kHz'], [22050, '22 kHz'], [16000, '16 kHz']], 44100, v => rate = Number(v)), L('lowerSmallerFile', 'lower = smaller file'))));
    const opt = exportOptions(root);
    const out = outputBox(root);
    const go = button(L('convert', 'Convert'), () => run(go, async tick => {
      out.replaceChildren();
      needSound(state);
      tick(D.common.processing || 'Working…');
      let channels = bufferChannels(state.buf);
      if (rate !== state.buf.sampleRate) channels = channels.map(ch => resampleFloat(ch, state.buf.sampleRate, rate));
      const blob = await encodeAudio(channels, rate, { format: opt.format, kbps: opt.kbps });
      mediaResultRow(out, extOf(state.file.name, opt.format), blob, fmt(L('ui0To1', '{0} → {1}'), bytes(state.file.size), bytes(blob.size)), 'audio');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ change-volume
  'change-volume': async (root) => {
    let gain = 1.5;
    const { state } = soundSource(root, { hint: L('mp3WavOggM4a', 'MP3, WAV, OGG, M4A…') });
    root.append(el('div', { class: 'controls' },
      field(L('volume', 'Volume'), rangeInput(150, 0, 400, 5, v => gain = v / 100, '%'), L('volumeHint', '100% is the original loudness. Boosting far above it can distort.'))));
    const opt = exportOptions(root);
    const out = outputBox(root);
    const go = button(L('apply', 'Apply'), () => run(go, async tick => {
      out.replaceChildren();
      needSound(state);
      tick(D.common.processing || 'Working…');
      const channels = bufferChannels(state.buf).map(ch => { const o = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = ch[i] * gain; return o; });
      const blob = await encodeAudio(channels, state.buf.sampleRate, { format: opt.format, kbps: opt.kbps });
      mediaResultRow(out, extOf(state.file.name, opt.format), blob, fmt(L('ui0Volume', '{0}% volume'), Math.round(gain * 100)), 'audio');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ reverse-audio
  'reverse-audio': async (root) => {
    const { state } = soundSource(root, { hint: L('mp3WavOggM4a', 'MP3, WAV, OGG, M4A…') });
    root.append(el('div', { class: 'controls' }, el('span', { class: 'note', text: L('reverseHint', 'Reverses the waveform so the sound plays backwards. Duration and pitch stay the same.') })));
    const opt = exportOptions(root);
    const out = outputBox(root);
    const go = button(L('reverse', 'Reverse'), () => run(go, async tick => {
      out.replaceChildren();
      needSound(state);
      tick(D.common.processing || 'Working…');
      const channels = bufferChannels(state.buf).map(ch => Float32Array.from(ch).reverse());
      const blob = await encodeAudio(channels, state.buf.sampleRate, { format: opt.format, kbps: opt.kbps });
      mediaResultRow(out, extOf(state.file.name, opt.format), blob, L('audioReversed', 'Reversed'), 'audio');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ change-speed
  'change-speed': async (root) => {
    let speed = 1.25;
    const { state } = soundSource(root, { hint: L('mp3WavOggM4a', 'MP3, WAV, OGG, M4A…') });
    root.append(el('div', { class: 'controls' },
      field(L('speed', 'Speed'), rangeInput(125, 50, 200, 5, v => speed = v / 100, '%'), L('speedHint', 'Changes tempo without changing pitch. 100% is the original speed.'))));
    const opt = exportOptions(root);
    const out = outputBox(root);
    const go = button(L('apply', 'Apply'), () => run(go, async tick => {
      out.replaceChildren();
      needSound(state);
      tick(D.common.processing || 'Working…');
      const sr = state.buf.sampleRate;
      const channels = bufferChannels(state.buf).map(ch => timeStretch(ch, 1 / speed, sr));
      const blob = await encodeAudio(channels, sr, { format: opt.format, kbps: opt.kbps });
      mediaResultRow(out, extOf(state.file.name, opt.format), blob, fmt(L('ui0SpeedResult', '{0} · {1}% speed'), mmss(state.buf.duration / speed), Math.round(speed * 100)), 'audio');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ change-pitch
  'change-pitch': async (root) => {
    let semitones = 2;
    const { state } = soundSource(root, { hint: L('mp3WavOggM4a', 'MP3, WAV, OGG, M4A…') });
    root.append(el('div', { class: 'controls' },
      field(L('pitch', 'Pitch'), rangeInput(2, -12, 12, 1, v => semitones = v, ''), L('pitchHint', 'Shifts pitch without changing how long the sound lasts. +12 is one octave up.'))));
    const opt = exportOptions(root);
    const out = outputBox(root);
    const go = button(L('apply', 'Apply'), () => run(go, async tick => {
      out.replaceChildren();
      needSound(state);
      tick(D.common.processing || 'Working…');
      const sr = state.buf.sampleRate;
      const p = Math.pow(2, semitones / 12);
      // resample to shift pitch (and duration), then time-stretch back to the original duration
      const channels = bufferChannels(state.buf).map(ch => timeStretch(resampleFloat(ch, sr * p, sr), p, sr));
      const blob = await encodeAudio(channels, sr, { format: opt.format, kbps: opt.kbps });
      mediaResultRow(out, extOf(state.file.name, opt.format), blob, fmt(L('ui0Semitones', '{0} semitones'), (semitones > 0 ? '+' : '') + semitones), 'audio');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ equalizer
  'equalizer': async (root) => {
    const { state } = soundSource(root, { hint: L('mp3WavOggM4a', 'MP3, WAV, OGG, M4A…') });
    const gains = [0, 0, 0, 0, 0];
    const PRESETS = { flat: [0, 0, 0, 0, 0], bass: [6, 4, 0, 1, 3], vocal: [-2, 1, 3, 4, 1], treble: [0, 0, 1, 4, 7] };
    const labels = [L('eqBass', 'Bass'), L('eqLowMid', 'Low mid'), L('eqMid', 'Mid'), L('eqHighMid', 'High mid'), L('eqTreble', 'Treble')];
    const sliderBox = el('div', { class: 'controls' });
    const drawSliders = () => fill(sliderBox, ...EQ_BANDS.map((f, i) => field(labels[i], rangeInput(gains[i], -12, 12, 1, v => gains[i] = v, ' dB'), `${f} Hz`)));
    drawSliders();
    root.append(sliderBox, el('div', { class: 'controls' },
      field(L('preset', 'Preset'), select([['flat', L('presetFlat', 'Flat')], ['bass', L('presetBass', 'Bass boost')], ['vocal', L('presetVocal', 'Vocal')], ['treble', L('presetTreble', 'Treble boost')]], 'flat', v => { const p = PRESETS[v] || PRESETS.flat; for (let i = 0; i < 5; i++) gains[i] = p[i]; drawSliders(); }), ''),
      el('span', { class: 'note', text: L('eqHint', 'Boost or cut five bands, then press Apply to render the change.') })));
    const opt = exportOptions(root);
    const out = outputBox(root);
    const go = button(L('apply', 'Apply'), () => run(go, async tick => {
      out.replaceChildren();
      needSound(state);
      tick(D.common.processing || 'Working…');
      const channels = applyEqualizer(bufferChannels(state.buf), state.buf.sampleRate, gains);
      const blob = await encodeAudio(channels, state.buf.sampleRate, { format: opt.format, kbps: opt.kbps });
      mediaResultRow(out, extOf(state.file.name, opt.format), blob, L('eqApplied', '5-band EQ applied'), 'audio');
    }));
    root.append(el('div', { class: 'btn-row' }, go, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ voice-recorder
  'voice-recorder': async (root) => {
    recorderPanel(root, { mode: 'voice' });
  },

  // ------------------------------------------------------------ sound-level-meter
  'sound-level-meter': async (root) => {
    let stream = null, ac = null, analyser = null, raf = 0, dataArr = null, running = false;
    let max = -60, sum = 0, count = 0;
    const big = el('div', { style: 'font-size:64px;font-weight:800;text-align:center;font-variant-numeric:tabular-nums;line-height:1.1', text: '—' });
    const unit = el('div', { class: 'note', style: 'text-align:center', text: L('slmUnit', 'decibels (relative, uncalibrated)') });
    const bar = el('div', { style: 'height:26px;border-radius:13px;background:#e2e8f0;overflow:hidden;margin:14px 0' });
    const fillEl = el('div', { style: 'height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444)' });
    bar.append(fillEl);
    const statBox = el('div', { class: 'out stat-row' });
    const status = el('div', { class: 'note', text: L('slmIntro', 'Press Start and allow microphone access to see the relative sound level around you.') });
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; if (stream) { stream.getTracks().forEach(tr => tr.stop()); stream = null; } if (ac) { ac.close?.(); ac = null; } analyser = null; startBtn.textContent = L('start', 'Start'); };
    const startBtn = button(L('start', 'Start'), async () => {
      if (running) { stop(); status.textContent = L('slmStopped', 'Meter stopped.'); return; }
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(L('noMicCamera', 'This browser cannot reach the microphone or camera. A secure (https) page is required.'));
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        ac = new AudioContext();
        const source = ac.createMediaStreamSource(stream);
        analyser = ac.createAnalyser(); analyser.fftSize = 2048;
        source.connect(analyser);
        dataArr = new Uint8Array(analyser.fftSize);
        max = -60; sum = 0; count = 0; running = true;
        startBtn.textContent = L('stop', 'Stop');
        status.textContent = L('slmRunning', 'Listening… the level updates live.');
        const loop = () => {
          if (!running || !root.isConnected) { stop(); return; }
          analyser.getByteTimeDomainData(dataArr);
          let rms = 0; for (let i = 0; i < dataArr.length; i++) { const v = (dataArr[i] - 128) / 128; rms += v * v; }
          rms = Math.sqrt(rms / dataArr.length);
          const db = rms > 0 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
          if (db > max) max = db;
          sum += db; count++;
          big.textContent = db.toFixed(1);
          fillEl.style.width = `${Math.min(100, Math.round((db + 60) / 60 * 100))}%`;
          statBox.replaceChildren(stat(L('slmNow', 'Current'), `${db.toFixed(1)} dB`, ''), stat(L('slmMax', 'Peak'), `${max.toFixed(1)} dB`, ''), stat(L('slmAvg', 'Average'), `${(sum / count).toFixed(1)} dB`, ''));
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (err) { stop(); const denied = /denied|permission|notallowed/i.test(`${err?.name} ${err?.message}`); status.replaceChildren(); status.append(note(denied ? L('slmDenied', 'Microphone access was denied. Allow it in your browser settings and try again.') : L('slmFail', 'Could not start the microphone.'), 'err')); }
    }, { kind: 'primary' });
    const resetBtn = button(L('slmReset', 'Reset peak'), () => { max = -60; sum = 0; count = 0; }, { kind: 'ghost' });
    if (root.parentNode) {
      const mo = new MutationObserver(() => { if (!root.isConnected) { stop(); mo.disconnect(); } });
      mo.observe(root.parentNode, { childList: true });
    }
    root.append(status, big, unit, bar, statBox,
      el('div', { class: 'btn-row' }, startBtn, resetBtn, el('span', { class: 'note', text: D.tool.privacyLine })),
      note(L('slmNote', 'This is a relative meter, not a calibrated sound-level instrument: the decibel value is referenced to digital full scale, so it depends on your microphone and its gain. Use it to compare loudness or spot noise, not for legal or safety measurements. Audio is analysed in your browser and never recorded or uploaded.')));
  }
};