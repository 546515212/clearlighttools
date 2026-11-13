// Video tools. compress-video re-encodes a clip live through a canvas + MediaRecorder (browsers cannot
// write MP4 locally, so the container is WebM); screen-recorder and webcam-recorder capture a live
// stream through the shared recorder engine in media-core.js. Nothing is uploaded.
import {
  fmt, el, D, t, bytes, extOf, mmss, run, note, select, numberInput, rangeInput, checkInput, button, field, toast
} from '../lib.js';
import { clamp, outputBox, mediaResultRow, recorderPanel } from './media-core.js';

const L = (k, fb) => t(k, fb);

export const tools = {

  // ------------------------------------------------------------ compress-video
  'compress-video': async (root) => {
    let file = null, bitrate = 800, maxW = 640, keepAudio = true;
    let recording = false, recorder = null, chunks = [], elapsed = 0;
    const video = el('video', { playsinline: true, controls: true, style: 'width:100%;max-height:340px;background:#000;border-radius:8px' });
    const status = el('div', { class: 'note', text: L('waitingFile', 'Waiting for a file.') });
    const out = outputBox(root);
    const maxWIn = numberInput(640, v => maxW = clamp(Number(v) || 640, 160, 1920), { min: 160, step: 80 });
    const isVideo = f => (f.type || '').startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name);
    const setFile = f => {
      file = f; chunks = []; out.replaceChildren();
      status.textContent = fmt(L('loadingFile', 'Loading {0}…'), f.name);
      video.src = URL.createObjectURL(f);
      video.onloadedmetadata = () => {
        maxW = Math.min(1280, video.videoWidth || 640);
        maxWIn.value = maxW;
        status.textContent = `${f.name} · ${bytes(f.size)} · ${mmss(video.duration)} · ${video.videoWidth}×${video.videoHeight}`;
      };
      video.onerror = () => { status.replaceChildren(); status.append(note(L('thisBrowserCannotPlayThat', 'This browser cannot play that file, so it cannot re-encode it either.'), 'err')); };
    };
    // drop zone (single file)
    const input = el('input', { type: 'file', accept: 'video/*', hidden: true });
    const zone = el('div', { class: 'drop', tabindex: 0, role: 'button' },
      el('span', { class: 'big', 'aria-hidden': 'true', text: '📂' }),
      el('span', { text: L('mp4WebmMov', 'MP4, WebM, MOV…') }), input);
    const open = () => input.click();
    zone.addEventListener('click', open);
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    input.addEventListener('change', () => { const f = [...input.files].find(isVideo); if (f) setFile(f); else toast(D.common.wrongType || L('unsupportedFileType', 'Unsupported file type')); });
    for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('over'); });
    zone.addEventListener('drop', e => { const f = [...e.dataTransfer.files].find(isVideo); if (f) setFile(f); else toast(D.common.wrongType || L('unsupportedFileType', 'Unsupported file type')); });
    root.append(zone, status, video,
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
      tick(L('preparing', 'Preparing…'));
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
          dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
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
      mediaResultRow(out, extOf(file.name, 'webm'), blob, fmt(L('ui012SOf', '{0} → {1} · {2}s of real time'), bytes(file.size), bytes(blob.size), secs), 'video');
      out.append(note(L('reEncodingHappensLiveA', 'Re-encoding happens live: a 3 minute clip takes 3 minutes. The container is WebM; browsers cannot write MP4 locally.')));
    }, { kind: 'primary' }));
    const stopBtn = button(L('stop', 'Stop'), () => { recording = false; video.pause(); }, { kind: 'ghost' });
    root.append(el('div', { class: 'btn-row' }, startBtn, stopBtn, el('span', { class: 'note', text: D.tool.privacyLine })));
  },

  // ------------------------------------------------------------ screen-recorder
  'screen-recorder': async (root) => {
    recorderPanel(root, { mode: 'screen' });
  },

  // ------------------------------------------------------------ webcam-recorder
  'webcam-recorder': async (root) => {
    recorderPanel(root, { mode: 'webcam' });
  },

  // ------------------------------------------------------------ camera-mic-test
  'camera-mic-test': async (root) => {
    const status = el('div', { class: 'note', text: L('camIntro', 'Test your camera, microphone and screen — all locally. Nothing is recorded or uploaded.') });
    const video = el('video', { playsinline: true, muted: true, style: 'width:100%;max-height:320px;background:#000;border-radius:8px;display:none' });
    const meterWrap = el('div', { style: 'display:none;margin-top:12px' });
    const meterBar = el('div', { style: 'height:18px;border-radius:9px;background:#e2e8f0;overflow:hidden;margin-top:6px' });
    const meterFill = el('div', { style: 'height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444)' });
    meterBar.append(meterFill);
    const dbText = el('div', { class: 'note', style: 'font-variant-numeric:tabular-nums', text: '—' });
    meterWrap.append(el('span', { text: L('camMicLevel', 'Microphone level') }), meterBar, dbText);
    let camStream = null, micStream = null, ac = null, raf = 0, analyser = null, dataArr = null;
    const denied = err => /denied|permission|notallowed/i.test(`${err?.name} ${err?.message}`);
    const stopCam = () => { if (camStream) { camStream.getTracks().forEach(tr => tr.stop()); camStream = null; } video.srcObject = null; video.style.display = 'none'; camBtn.textContent = L('camStartCam', 'Start camera'); };
    const stopMic = () => { if (raf) cancelAnimationFrame(raf); raf = 0; if (micStream) { micStream.getTracks().forEach(tr => tr.stop()); micStream = null; } if (ac) { ac.close?.(); ac = null; } analyser = null; meterWrap.style.display = 'none'; micBtn.textContent = L('camStartMic', 'Test microphone'); };
    const camBtn = button(L('camStartCam', 'Start camera'), async () => {
      if (camStream) { stopCam(); status.textContent = L('camIntro', 'Test your camera, microphone and screen — all locally. Nothing is recorded or uploaded.'); return; }
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(L('noMicCamera', 'This browser cannot reach the microphone or camera. A secure (https) page is required.'));
        camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        video.srcObject = camStream; video.style.display = 'block'; await video.play().catch(() => {});
        camBtn.textContent = L('camStopCam', 'Stop camera');
        status.textContent = L('camRunning', 'Camera is live. If you can see yourself, the camera works.');
      } catch (err) { stopCam(); status.replaceChildren(); status.append(note(denied(err) ? L('camDenied', 'Camera access was denied. Allow it in your browser settings and try again.') : L('camFail', 'Could not start the camera.'), 'err')); }
    }, { kind: 'primary' });
    const micBtn = button(L('camStartMic', 'Test microphone'), async () => {
      if (micStream) { stopMic(); status.textContent = L('camIntro', 'Test your camera, microphone and screen — all locally. Nothing is recorded or uploaded.'); return; }
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(L('noMicCamera', 'This browser cannot reach the microphone or camera. A secure (https) page is required.'));
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        ac = new AudioContext();
        const source = ac.createMediaStreamSource(micStream);
        analyser = ac.createAnalyser(); analyser.fftSize = 1024;
        source.connect(analyser);
        dataArr = new Uint8Array(analyser.fftSize);
        meterWrap.style.display = 'block'; micBtn.textContent = L('camStopMic', 'Stop microphone');
        status.textContent = L('camMicRunning', 'Speak or tap the microphone — the level bar should move.');
        const loop = () => {
          if (!root.isConnected || !analyser) { stopMic(); return; }
          analyser.getByteTimeDomainData(dataArr);
          let peak = 0; for (let i = 0; i < dataArr.length; i++) { const v = Math.abs(dataArr[i] - 128) / 128; if (v > peak) peak = v; }
          const db = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
          meterFill.style.width = `${Math.min(100, Math.round(peak * 140))}%`;
          dbText.textContent = `${db.toFixed(1)} dB`;
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (err) { stopMic(); status.replaceChildren(); status.append(note(denied(err) ? L('camMicDenied', 'Microphone access was denied. Allow it in your browser settings and try again.') : L('camMicFail', 'Could not start the microphone.'), 'err')); }
    }, { kind: 'ghost' });
    // screen dead-pixel test: a full-viewport solid colour that cycles on tap. No fullscreen API and
    // no window listeners, so the overlay lives inside the panel and is cleaned up when it unmounts.
    const colors = [['#ff0000', L('camRed', 'Red')], ['#00ff00', L('camGreen', 'Green')], ['#0000ff', L('camBlue', 'Blue')], ['#ffffff', L('camWhite', 'White')], ['#000000', L('camBlack', 'Black')], ['#808080', L('camGray', 'Gray')]];
    let screenOv = null, ci = 0, badge = null;
    const closeScreen = () => { if (screenOv) { screenOv.remove(); screenOv = null; } screenBtn.textContent = L('camScreen', 'Screen dead-pixel test'); };
    const screenBtn = button(L('camScreen', 'Screen dead-pixel test'), () => {
      if (screenOv) { closeScreen(); return; }
      ci = 0;
      badge = el('span', { class: 'badge', style: 'background:rgba(0,0,0,.55);color:#fff', text: colors[0][1] });
      screenOv = el('div', { style: 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:10px;cursor:pointer;padding:24px;background:' + colors[0][0] },
        badge,
        el('div', { class: 'note', style: 'background:rgba(0,0,0,.55);color:#fff;text-align:center', text: L('camScreenHint', 'Tap anywhere to change colour and look for stuck or dead pixels.') }),
        button(L('camExit', 'Exit'), e => { e.stopPropagation(); closeScreen(); }, { kind: 'ghost' }));
      screenOv.addEventListener('click', () => { ci = (ci + 1) % colors.length; screenOv.style.background = colors[ci][0]; badge.textContent = colors[ci][1]; });
      root.append(screenOv);
      screenBtn.textContent = L('camExit', 'Exit');
    }, { kind: 'ghost' });
    // stop hardware and loops if the panel is removed while something is still live
    if (root.parentNode) {
      const mo = new MutationObserver(() => { if (!root.isConnected) { stopCam(); stopMic(); mo.disconnect(); } });
      mo.observe(root.parentNode, { childList: true });
    }
    root.append(status, video, meterWrap,
      el('div', { class: 'btn-row' }, camBtn, micBtn, screenBtn),
      note(L('camNote', 'The camera preview and microphone level run entirely in your browser through getUserMedia and the Web Audio API. No video or audio is recorded, saved or sent anywhere. Use the screen test to spot dead pixels on a monitor or phone display.')));
  },

  // ------------------------------------------------------------ teleprompter
  'teleprompter': async (root) => {
    const input = el('textarea', { spellcheck: 'false', placeholder: L('teleInput', 'Paste your script or speech here…'), style: 'min-height:150px' });
    let size = 48, speed = 60, mirror = false, running = false, raf = 0, offset = 0;
    const stage = el('div', { style: 'position:relative;height:340px;overflow:hidden;border-radius:12px;background:#000;color:#fff;margin-bottom:12px' });
    const scroller = el('div', { style: 'position:absolute;left:0;right:0;top:0;padding:40px 28px;white-space:pre-wrap;line-height:1.5;font-weight:600;text-align:center;will-change:transform' });
    stage.append(scroller);
    const applyStyle = () => { scroller.style.fontSize = `${size}px`; scroller.style.transform = `translateY(${-offset}px) scaleX(${mirror ? -1 : 1})`; };
    const syncText = () => { scroller.textContent = input.value; offset = 0; applyStyle(); };
    input.addEventListener('input', syncText);
    const loop = () => {
      if (!running || !root.isConnected) { running = false; return; }
      offset += speed / 60;
      const max = Math.max(0, scroller.scrollHeight - stage.clientHeight + 80);
      if (offset > max) offset = max;
      applyStyle();
      raf = requestAnimationFrame(loop);
    };
    const startBtn = button(L('start', 'Start'), () => {
      if (running) { running = false; if (raf) cancelAnimationFrame(raf); startBtn.textContent = L('start', 'Start'); return; }
      if (!input.value.trim()) { toast(L('teleNeedText', 'Paste your script first')); return; }
      running = true; startBtn.textContent = L('stop', 'Stop'); raf = requestAnimationFrame(loop);
    }, { kind: 'primary' });
    const resetBtn = button(L('teleReset', 'Restart'), () => { offset = 0; applyStyle(); }, { kind: 'ghost' });
    const onFs = () => { stage.style.height = document.fullscreenElement === stage ? '100vh' : '340px'; };
    const fsBtn = button(L('teleFullscreen', 'Fullscreen'), () => {
      if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
      stage.requestFullscreen?.().catch(() => {});
    }, { kind: 'ghost' });
    document.addEventListener('fullscreenchange', onFs);
    if (root.parentNode) {
      const mo = new MutationObserver(() => { if (!root.isConnected) { running = false; if (raf) cancelAnimationFrame(raf); document.removeEventListener('fullscreenchange', onFs); mo.disconnect(); } });
      mo.observe(root.parentNode, { childList: true });
    }
    root.append(
      el('div', { class: 'field' }, el('span', { text: L('teleScript', 'Your script') }), input),
      stage,
      el('div', { class: 'controls' },
        field(L('fontSize', 'Font size'), rangeInput(size, 20, 120, 2, v => { size = v; applyStyle(); }, 'px'), ''),
        field(L('speed', 'Speed'), rangeInput(speed, 10, 240, 5, v => speed = v, ''), L('teleSpeedHint', 'scroll pixels per second')),
        el('span', {}, checkInput(L('teleMirror', 'Mirror (for a beam-splitter)'), mirror, v => { mirror = v; applyStyle(); }))),
      el('div', { class: 'btn-row' }, startBtn, resetBtn, fsBtn),
      note(L('teleNote', 'Paste your speech, set the font size and scroll speed, then press Start. Mirror flips the text for a beam-splitter teleprompter rig, and Fullscreen fills the display. Your script stays in this browser tab and is never uploaded.')));
    syncText();
  }
};