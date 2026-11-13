#!/usr/bin/env node
// One-pass generator for the first media batch (11 new tools + audio/video category labels + SEO).
// Writes the English tool copy, the per-locale chrome (category labels + search count), the per-locale
// translation shards (t copy + the 53 new widget labels), and the keyword source. It validates SERP
// lengths and placeholder integrity BEFORE writing, so a too-long description or a dropped {0} is
// caught here rather than by a red gate after the build. Re-runnable: it merges into existing files.
//
//   node scripts/gen-media-batch.mjs           validate + write everything
//   node scripts/gen-media-batch.mjs --dry     validate only, write nothing
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib-node.mjs';

const DRY = process.argv.includes('--dry');
const EMIT_SOURCE = process.argv.includes('--emit-source');
const L = (...a) => join(ROOT, 'src', 'locales', ...a);
const readJ = p => JSON.parse(readFileSync(p, 'utf8'));
const writeJ = (p, o) => { if (!DRY) writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8'); };
const cps = s => [...String(s ?? '').trim()].length;

const AUDIO_NEW = ['audio-joiner', 'audio-converter', 'change-volume', 'reverse-audio', 'change-speed', 'change-pitch', 'equalizer', 'voice-recorder'];
const VIDEO_NEW = ['screen-recorder', 'webcam-recorder'];
const PDF_NEW = ['pdf-page-numbers'];
const NEW_IDS = [...AUDIO_NEW, ...VIDEO_NEW, ...PDF_NEW];

// ---------------------------------------------------------------- English tool copy (the SEO source)
const EN_T = {
  'audio-joiner': {
    title: 'Audio Joiner',
    h1: 'Join audio files and merge MP3 online',
    desc: 'Combine MP3, WAV, M4A and OGG files into one track in the order you choose. Free, no upload, no watermark — merge audio in your browser.',
    intro: 'Add two or more clips, drag them into the right order, and the joiner decodes each one, matches sample rate and channels, and concatenates them into a single MP3 or WAV. Everything runs locally, so private recordings never leave your device.',
    steps: ['Add the audio files you want to combine.', 'Drag or use the arrows to set the playback order.', 'Choose MP3 or WAV and a bitrate.', 'Press Join and download the single track.'],
    faq: [
      { q: 'Can I join files of different formats?', a: 'Yes. Each file is decoded to raw samples, then resampled to a common rate and channel count before they are concatenated, so MP3, WAV, M4A and OGG can be mixed.' },
      { q: 'Is there a limit on how many files I can merge?', a: 'There is no fixed cap, but long audio is held in memory while it is decoded and encoded, so keep the total reasonable on low-memory devices.' }
    ]
  },
  'audio-converter': {
    title: 'Audio Converter',
    h1: 'Convert audio to MP3, WAV and more online',
    desc: 'Convert WAV to MP3, M4A, OGG and other audio formats in your browser. Pick the sample rate and bitrate, then download — no upload, no account.',
    intro: 'The converter decodes your file with the browser’s audio engine, resamples it to the rate you choose, and re-encodes it to MP3 (small and universal) or WAV (lossless). Because it all happens on your machine, the original never leaves your device.',
    steps: ['Load the audio file you want to convert.', 'Choose the output sample rate.', 'Pick MP3 or WAV and, for MP3, a bitrate.', 'Press Convert and download the new file.'],
    faq: [
      { q: 'Which input formats can it read?', a: 'Anything your browser can decode — commonly MP3, WAV, OGG, M4A/AAC and FLAC. Some DRM-protected or unusual codecs are refused by the browser itself.' },
      { q: 'Why is my MP3 smaller than the WAV?', a: 'MP3 is lossy compression; WAV stores every sample uncompressed. For voice and sharing, MP3 at 128–192 kbps is usually plenty; choose WAV for a lossless master.' }
    ]
  },
  'change-volume': {
    title: 'Volume Booster',
    h1: 'Change audio volume — boost or lower it online',
    desc: 'Increase or decrease the volume of an MP3, WAV or M4A file. Set the level from 0 to 400%, preview and download. Free and fully in-browser.',
    intro: 'This tool multiplies every sample by the gain you set, so 100% keeps the original loudness, 200% doubles it and 50% halves it. Boosting far past 100% can clip loud peaks, so preview before you export.',
    steps: ['Load the audio file.', 'Drag the volume slider to the level you want.', 'Choose MP3 or WAV output.', 'Press Apply, listen, then download.'],
    faq: [
      { q: 'Why does the audio distort when I boost it a lot?', a: 'Samples above full scale are clipped. If the original is already loud, a large boost pushes peaks past the limit; try a smaller gain first.' },
      { q: 'Can I make a file quieter instead?', a: 'Yes — set the slider below 100%. 50% is half the amplitude, a clearly noticeable drop in loudness.' }
    ]
  },
  'reverse-audio': {
    title: 'Reverse Audio',
    h1: 'Reverse audio and play sound backwards online',
    desc: 'Flip an audio file so it plays backwards, from end to start. Duration and pitch stay the same. A free MP3/WAV reverser with no upload.',
    intro: 'Reversing copies the waveform from the last sample to the first, so the sound plays in reverse while keeping its length and pitch. It is the classic way to make a riser effect, check for hidden messages, or hear a song backwards.',
    steps: ['Load the audio file.', 'Optionally pick MP3 or WAV output.', 'Press Reverse.', 'Play the result and download it.'],
    faq: [
      { q: 'Does reversing change the pitch or speed?', a: 'No. The samples are simply read in the opposite order, so duration and frequencies are unchanged — only the time direction flips.' },
      { q: 'What can I use reversed audio for?', a: 'Transition risers, sound design, checking for backmasked messages, or a palindrome-style clip that reads the same forwards and backwards.' }
    ]
  },
  'change-speed': {
    title: 'Audio Speed Changer',
    h1: 'Speed up or slow down audio without changing pitch',
    desc: 'Change audio tempo from 50% to 200% while keeping the pitch natural. Speed up lectures or slow down music to learn it — in your browser.',
    intro: 'The speed changer uses overlap-add time stretching, so a voice sped up does not turn into a chipmunk and a slowed-down song does not drop in pitch. 100% is the original speed; 200% plays twice as fast in half the time.',
    steps: ['Load the audio file.', 'Set the speed slider (50%–200%).', 'Choose MP3 or WAV output.', 'Press Apply and download the retimed clip.'],
    faq: [
      { q: 'Will speeding up audio raise the pitch?', a: 'No — that is the point of time stretching. The tempo changes but the pitch stays the same, unlike simply resampling the file.' },
      { q: 'How extreme can the speed change be?', a: 'The slider runs from 50% to 200%. Very large stretches can add a slight warble on complex material; moderate changes sound most natural.' }
    ]
  },
  'change-pitch': {
    title: 'Pitch Shifter',
    h1: 'Change the pitch of audio up or down online',
    desc: 'Shift audio pitch by up to 12 semitones either way without changing the duration. Raise or lower a voice or instrument, then download free.',
    intro: 'Pitch shifting resamples the audio to move the frequency, then time-stretches it back to the original length, so the clip lasts the same time but sounds higher or lower. +12 semitones is one octave up; −12 is one octave down.',
    steps: ['Load the audio file.', 'Set the pitch shift in semitones (−12 to +12).', 'Choose MP3 or WAV output.', 'Press Apply and download the shifted clip.'],
    faq: [
      { q: 'Does changing pitch change how long the file is?', a: 'No. The tool restores the original duration after shifting, so only the pitch moves, not the timing.' },
      { q: 'What is a semitone?', a: 'The smallest step in Western music — one key on a piano. Twelve semitones make an octave, so +12 doubles the frequency and −12 halves it.' }
    ]
  },
  'equalizer': {
    title: 'Audio Equalizer',
    h1: 'Online audio equalizer with bass and treble boost',
    desc: 'Adjust five bands (60 Hz–12 kHz) to boost bass, brighten treble or shape a vocal. Use presets or fine-tune, then export MP3 or WAV free.',
    intro: 'A five-band peaking equalizer lets you cut or boost bass, low mid, mid, high mid and treble by up to 12 dB each. Start from a preset — Flat, Bass boost, Vocal or Treble boost — then fine-tune and render the change to a new file.',
    steps: ['Load the audio file.', 'Pick a preset or drag the five band sliders.', 'Choose MP3 or WAV output.', 'Press Apply and download the equalized track.'],
    faq: [
      { q: 'What do the five bands control?', a: '60 Hz is bass weight, 250 Hz warmth, 1 kHz the body of vocals, 4 kHz presence and clarity, and 12 kHz air and sparkle. Boost or cut each to taste.' },
      { q: 'Is the EQ applied to the downloaded file?', a: 'Yes. Unlike a playback-only equalizer, this renders the filtering into the exported MP3 or WAV, so the change is permanent in the file you keep.' }
    ]
  },
  'voice-recorder': {
    title: 'Voice Recorder',
    h1: 'Record audio online with your microphone',
    desc: 'Record your voice from the microphone straight in the browser. Press record, stop, preview and download — no app, no upload, no account.',
    intro: 'The recorder captures your microphone with the browser’s MediaRecorder API and saves the take locally so you can preview and download it. Nothing is sent to a server; the recording stays on your device until you keep it.',
    steps: ['Press Record and allow microphone access.', 'Speak or play the sound you want to capture.', 'Press Stop when you are done.', 'Preview the take and download it.'],
    faq: [
      { q: 'Where is my recording stored?', a: 'Only in your browser’s memory until you download it. Nothing is uploaded, so once you close the page an unsaved take is gone.' },
      { q: 'Why does the browser ask for permission?', a: 'Microphone access always needs your explicit consent. If you denied it, re-enable the microphone permission for this site and press Record again.' }
    ]
  },
  'screen-recorder': {
    title: 'Screen Recorder',
    h1: 'Record your screen online for free',
    desc: 'Capture your screen, a window or a tab with optional system audio. Record, stop, preview and download a WebM video — no install, no upload.',
    intro: 'The screen recorder uses the browser’s display-capture API to record your whole screen, a single window or a tab, with audio where supported. The video is assembled locally and offered as a download; it never touches a server.',
    steps: ['Press Record and choose what to share (screen, window or tab).', 'Optionally include audio in the share picker.', 'Press Stop, or end the share, when finished.', 'Preview the clip and download the WebM.'],
    faq: [
      { q: 'Which browsers support screen recording?', a: 'Chrome and Edge on desktop have the most reliable display capture, and Firefox supports it too. Mobile browsers generally do not, so use a desktop browser.' },
      { q: 'Can it record system audio?', a: 'When you share a tab or the whole screen the picker offers an audio option. Whether system audio is included depends on the browser and what you shared.' }
    ]
  },
  'webcam-recorder': {
    title: 'Webcam Recorder',
    h1: 'Record video from your webcam online',
    desc: 'Record yourself with the camera and microphone in your browser. Preview the live feed, press record, then download — free, no software.',
    intro: 'The webcam recorder shows a live preview from your camera, captures it with the microphone through MediaRecorder, and saves the clip locally for preview and download. The video never leaves your device unless you download it.',
    steps: ['Press Record and allow camera and microphone access.', 'Check the live preview and frame yourself.', 'Press Stop when you are done.', 'Preview the recording and download it.'],
    faq: [
      { q: 'Is the video uploaded anywhere?', a: 'No. It is recorded and held in your browser, then offered as a local download. Nothing is sent to a server.' },
      { q: 'What format is the recording?', a: 'A WebM video (VP8/VP9 with Opus audio) where the browser supports it, which plays in modern browsers and most editors. Some browsers may produce MP4.' }
    ]
  },
  'pdf-page-numbers': {
    title: 'PDF Page Numbers',
    h1: 'Add page numbers to a PDF online',
    desc: 'Insert page numbers into a PDF at the top or bottom, left, centre or right. Set the start number, font size and a prefix. Free, no upload.',
    intro: 'This tool stamps a real text page number onto each page of your PDF with pdf-lib, so the numbers stay crisp at any zoom and are selectable. Position them in the header or footer, skip the cover, and add an optional prefix.',
    steps: ['Load the PDF you want to number.', 'Choose the position, alignment and starting number.', 'Set the font size and an optional prefix; skip the cover if needed.', 'Press Add page numbers and download.'],
    faq: [
      { q: 'Can I start from a specific page or number?', a: 'Yes. Set the starting number and use the page range to number only certain pages, or tick “skip the first page” to leave a cover unnumbered.' },
      { q: 'Are the numbers added as text or an image?', a: 'As real vector text, so they scale cleanly in print and can be selected and searched in the finished PDF.' }
    ]
  }
};

// English category labels: image is now image-only; audio and video are their own categories.
const EN_CAT = {
  'image': 'Image tools',
  'image.tagline': 'Compress, convert and resize photos, build QR codes and favicons, pick colours and make GIFs.',
  'audio': 'Audio tools',
  'audio.tagline': 'Cut, join, convert and record sound; change volume, speed and pitch, and equalise tracks.',
  'video': 'Video tools',
  'video.tagline': 'Compress clips and record your screen or webcam — all in the browser.'
};
const EN_SEARCH = 'Search 60 free tools…';

// The 53 new widget keys, in a fixed order, so every locale supplies exactly the same set.
const W_KEYS = ['decodingFile', 'mp3SmallestWavLossless', 'mp3Only', 'addAudioFilesInOrder', 'join', 'ui0Files1Duration', 'ui0To1', 'volumeHint', 'ui0Volume', 'reverseHint', 'speed', 'speedHint', 'ui0SpeedResult', 'pitchHint', 'ui0Semitones', 'eqBass', 'eqLowMid', 'eqMid', 'eqHighMid', 'eqTreble', 'preset', 'presetFlat', 'presetBass', 'presetVocal', 'presetTreble', 'eqHint', 'eqApplied', 'noWebAudio', 'recorderReady', 'noScreenCapture', 'noMicCamera', 'ui0SOfRecording', 'recordingSaved', 'record', 'requestingPermission', 'recordingInProgress', 'permissionDenied', 'recordingFailed', 'bottom', 'top', 'alignment', 'alignLeft', 'alignCenter', 'alignRight', 'startNumber', 'prefixHint', 'skipFirst', 'addPageNumbers', 'noPagesSelected', 'ui0PagesNumbered', 'pageNumbersNote', 'loadingFile', 'preparing', 'audioReversed'];

// ---------------------------------------------------------------- per-locale data
// Each locale's translation lives in scripts/media-i18n/<locale>.json so the work can be produced
// and reviewed one file at a time. `_source.json` (written by --emit-source) is the authoritative
// English reference the translations are made from — it is derived from the real en.tools.json /
// tools.json, never hand-copied, so a translator cannot drift from the keys the build actually reads.
const LOCALES = ['zh', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'ru', 'vi', 'ms', 'id', 'hi'];
const I18N_DIR = join(ROOT, 'scripts', 'media-i18n');
const exists = p => { try { readFileSync(p); return true; } catch { return false; } };

function emitSource() {
  const enW = readJ(L('en.tools.json')).w || {};
  const tools = readJ(join(ROOT, 'src', 'data', 'tools.json'));
  const phrases = NEW_IDS.flatMap(id => tools.find(t => t.id === id).kw);
  const src = {
    _note: 'Authoritative English source for the first media batch. Translate every value into the target language; keep every key, every {0}/{1} placeholder and every % sign. Do not summarise. desc must be <=160 code points (hard fail >170); title <=50; home <=65. Output scripts/media-i18n/<locale>.json with exactly: search, home, cat{6}, kw{33}, w{53}, t{11 tools each title/h1/desc/intro/steps[4]/faq[2]{q,a}}.',
    locales: LOCALES,
    newIds: NEW_IDS,
    en_search: EN_SEARCH,
    en_home: 'ClearLight Tools — Free Online PDF, Image, Audio & Video Tools',
    en_cat: EN_CAT,
    w_keys: W_KEYS,
    en_w: Object.fromEntries(W_KEYS.map(k => [k, enW[k]])),
    kw_phrases: phrases,
    en_t: EN_T
  };
  mkdirSync(I18N_DIR, { recursive: true });
  writeFileSync(join(I18N_DIR, '_source.json'), JSON.stringify(src, null, 2) + '\n', 'utf8');
  console.log(`wrote scripts/media-i18n/_source.json — ${W_KEYS.length} widget keys, ${phrases.length} keyword phrases, ${NEW_IDS.length} tools, ${LOCALES.length} target locales`);
}

const DATA = {};
for (const l of LOCALES) {
  const p = join(I18N_DIR, `${l}.json`);
  if (exists(p)) DATA[l] = readJ(p);
}

// ---------------------------------------------------------------- validation + write
const PH = /\{\d+\}/g;
const tokens = s => (String(s).match(PH) || []).sort();
function validate() {
  const problems = [];
  const enW = readJ(L('en.tools.json')).w || {};
  const allTools = readJ(join(ROOT, 'src', 'data', 'tools.json'));
  const phrases = NEW_IDS.flatMap(id => allTools.find(t => t.id === id).kw);
  // every W_KEY must exist in English (else the shard key would be stale)
  for (const k of W_KEYS) if (!(k in enW)) problems.push(`W_KEY "${k}" is not in en.tools.json w`);
  // English desc budget + structure
  for (const id of NEW_IDS) {
    const t = EN_T[id];
    if (!t) { problems.push(`missing EN_T for ${id}`); continue; }
    if (cps(t.desc) > 160) problems.push(`EN ${id}.desc is ${cps(t.desc)}cp (>160 soft)`);
    if (t.steps.length !== 4) problems.push(`EN ${id}.steps has ${t.steps.length}, need 4`);
    if (t.faq.length !== 2) problems.push(`EN ${id}.faq has ${t.faq.length}, need 2`);
  }
  const locales = Object.keys(DATA);
  if (locales.length !== 12) problems.push(`expected 12 locale data blocks, have ${locales.length}: ${locales.join(',')}`);
  for (const l of locales) {
    const d = DATA[l];
    for (const id of NEW_IDS) {
      const t = d.t[id];
      if (!t) { problems.push(`${l}: missing t.${id}`); continue; }
      if (cps(t.desc) > 170) problems.push(`${l} ${id}.desc is ${cps(t.desc)}cp (>170 HARD)`);
      else if (cps(t.desc) > 160) problems.push(`NOTE ${l} ${id}.desc is ${cps(t.desc)}cp (>160 soft)`);
      if (cps(t.title) > 50) problems.push(`${l} ${id}.title is ${cps(t.title)}cp (>50, risks T2)`);
      if (!Array.isArray(t.steps) || t.steps.length !== 4) problems.push(`${l} ${id}.steps must be 4 strings`);
      if (!Array.isArray(t.faq) || t.faq.length !== 2) problems.push(`${l} ${id}.faq must be 2 {q,a}`);
      // placeholder parity against English for every prose leaf
      const pairs = [['title', t.title, EN_T[id].title], ['h1', t.h1, EN_T[id].h1], ['desc', t.desc, EN_T[id].desc], ['intro', t.intro, EN_T[id].intro]];
      t.steps.forEach((s, i) => pairs.push([`steps.${i}`, s, EN_T[id].steps[i]]));
      t.faq.forEach((f, i) => { pairs.push([`faq.${i}.q`, f.q, EN_T[id].faq[i].q]); pairs.push([`faq.${i}.a`, f.a, EN_T[id].faq[i].a]); });
      for (const [name, val, en] of pairs) {
        if (typeof val !== 'string' || !val.trim()) { problems.push(`${l} ${id}.${name} empty/non-string`); continue; }
        if (tokens(val).join() !== tokens(en).join()) problems.push(`${l} ${id}.${name} placeholders ${tokens(val)} != EN ${tokens(en)}`);
      }
    }
    // widget keys: exactly the 53, placeholders preserved
    const wk = Object.keys(d.w || {});
    for (const k of W_KEYS) {
      if (!(k in (d.w || {}))) { problems.push(`${l}: missing w.${k}`); continue; }
      if (tokens(d.w[k]).join() !== tokens(enW[k] || '').join()) problems.push(`${l} w.${k} placeholders differ from EN`);
      const enPct = ((enW[k] || '').match(/\{\d+\}\s*%/g) || []).length;
      if (enPct && (d.w[k].match(/%/g) || []).length < enPct) problems.push(`${l} w.${k} lost a % sign`);
    }
    for (const k of wk) if (!W_KEYS.includes(k)) problems.push(`${l}: extra w.${k} not in W_KEYS (would be stale)`);
    // keywords: exactly the 33 new phrases
    for (const p of phrases) if (!String(d.kw?.[p] || '').trim()) problems.push(`${l}: missing kw "${p}"`);
    // chrome cat keys
    for (const k of ['image', 'image.tagline', 'audio', 'audio.tagline', 'video', 'video.tagline']) if (!String(d.cat?.[k] || '').trim()) problems.push(`${l}: missing cat.${k}`);
    if (!String(d.search || '').trim()) problems.push(`${l}: missing search placeholder`);
    if (!String(d.home || '').trim()) problems.push(`${l}: missing home title`);
    if (cps(d.home) > 65) problems.push(`${l}: home title ${cps(d.home)}cp >65`);
  }
  return problems;
}

function main() {
  const problems = validate();
  const hard = problems.filter(p => !p.startsWith('NOTE'));
  for (const p of problems) console.log(`  ${p.startsWith('NOTE') ? 'note' : 'FAIL'} ${p}`);
  if (hard.length) { console.error(`\n${hard.length} validation problem(s) — nothing written. Fix the data and re-run.`); process.exit(1); }
  console.log(`\nvalidation clean (${problems.length} soft note(s)). ${DRY ? 'DRY RUN — writing nothing.' : 'Writing files…'}`);
  if (DRY) return;

  // English tool copy
  const enTools = readJ(L('en.tools.json'));
  enTools.t = { ...enTools.t, ...EN_T };
  writeJ(L('en.tools.json'), enTools);
  // English chrome
  const enChrome = readJ(L('en.json'));
  enChrome.cat = { ...enChrome.cat, ...EN_CAT };
  enChrome.nav = { ...enChrome.nav, searchPlaceholder: EN_SEARCH };
  writeJ(L('en.json'), enChrome);
  // SEO source: merge the 33 new tool keyword phrases per locale. Home-page title/desc/brand are
  // owner-specified in keywords.json (ClearLight Tools) and must NOT be overwritten by this generator.
  const seo = readJ(join(ROOT, 'src', 'seo', 'keywords.json'));
  for (const l of Object.keys(DATA)) {
    seo.kw[l] = { ...(seo.kw[l] || {}), ...DATA[l].kw };
  }
  writeJ(join(ROOT, 'src', 'seo', 'keywords.json'), seo);
  // per-locale chrome + shards
  for (const l of Object.keys(DATA)) {
    const d = DATA[l];
    const chrome = readJ(L(`${l}.json`));
    chrome.cat = { ...chrome.cat, ...d.cat };
    chrome.nav = { ...chrome.nav, searchPlaceholder: d.search };
    writeJ(L(`${l}.json`), chrome);
    const dir = L(l); mkdirSync(dir, { recursive: true });
    const pick = ids => Object.fromEntries(ids.map(id => [id, d.t[id]]));
    writeJ(join(dir, '24-t-audio.json'), { t: pick(AUDIO_NEW) });
    writeJ(join(dir, '25-t-video.json'), { t: pick(VIDEO_NEW) });
    writeJ(join(dir, '26-t-pdf-page-numbers.json'), { t: pick(PDF_NEW) });
    writeJ(join(dir, '50-w-media.json'), { w: Object.fromEntries(W_KEYS.map(k => [k, d.w[k]])) });
  }
  console.log(`  wrote en.tools.json (11 t), en.json (cat+nav), keywords.json (home + ${Object.keys(DATA).length}×33 kw)`);
  console.log(`  wrote ${Object.keys(DATA).length} locales × (chrome cat/nav + 24-t-audio + 25-t-video + 26-t-pdf-page-numbers + 50-w-media)`);
}
if (EMIT_SOURCE) { emitSource(); } else { main(); }