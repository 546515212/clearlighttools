#!/usr/bin/env node
// Numerical gate for the pure DSP in src/scripts/tools/media-core.js. The smoke harness mounts every
// panel against a FakeAudioContext whose decoded buffers are all zeros, so it proves the wiring but
// can never prove that timeStretch keeps pitch, that the EQ boosts the band it names, or that the WAV
// header is byte-correct. Those are the heart of eight audio tools and a regression would be silent.
// This runs the real functions on real signals and asserts the maths, with a counter-proof per group
// (a deliberately wrong expectation MUST fail) and a non-empty guard, per the project's check rules.
//
//   node scripts/check-dsp.mjs            run, exit 1 on any failed assertion
//   node scripts/check-dsp.mjs --selftest also prove each counter-proof fires (default: on)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// media-core.js imports lib.js, which reads window.__TH_DICT at module load. The pure DSP touches no
// DOM, so a minimal window is enough; load the REAL lamejs so encodeMp3 is exercised, not stubbed.
globalThis.window = { __TH_DICT: { w: {}, common: {}, tool: {}, cat: {} } };
new Function('window', readFileSync(join(ROOT, 'vendor', 'lame.min.js'), 'utf8') + '\n;window.lamejs=lamejs;')(window);

const M = await import('../src/scripts/tools/media-core.js');
const { encodeWav, resampleFloat, floatTo16, timeStretch, biquadPeaking, applyEqualizer, EQ_BANDS, encodeMp3, clamp } = M;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`); } else { fail++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); } };
// A counter-proof: the SAME predicate fed a deliberately wrong value must report false. If it does
// not, the assertion above is vacuous and proves nothing.
const bites = (name, predicate, wrongValue) => ok(`counter-proof: ${name}`, predicate(wrongValue) === false);

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sine = (freq, rate, secs) => { const n = Math.round(rate * secs); const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin(2 * Math.PI * freq * i / rate); return a; };
const rms = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); };
// Positive-going zero crossings per second = dominant frequency for a clean tone. Measured on the
// central 80% so OLA grain edges (where the window sum is still ramping) cannot skew the count.
const zeroFreq = (a, rate) => {
  const lo = Math.floor(a.length * 0.1), hi = Math.floor(a.length * 0.9);
  let cross = 0;
  for (let i = lo + 1; i < hi; i++) if (a[i - 1] <= 0 && a[i] > 0) cross++;
  return cross / ((hi - lo) / rate);
};

console.log('\nDSP numerical gate — media-core.js pure functions on real signals\n');

// ---------------------------------------------------------------- clamp
ok('clamp holds a value inside the range', clamp(5, 0, 10) === 5 && clamp(-3, 0, 10) === 0 && clamp(99, 0, 10) === 10);
bites('clamp would not pass an out-of-range value', v => clamp(v, 0, 10) === v, 50);

// ---------------------------------------------------------------- encodeWav
{
  const ch = [Float32Array.from([0, 0.5, -0.5, 1, -1])];
  const blob = encodeWav(ch, 44100);
  const buf = await blob.arrayBuffer();
  const dv = new DataView(buf);
  const tag = o => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  ok('WAV blob is audio/wav', blob.type === 'audio/wav', blob.type);
  ok('WAV RIFF/WAVE/fmt /data tags', tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data', `${tag(0)}/${tag(8)}/${tag(12)}/${tag(36)}`);
  ok('WAV total bytes = 44 + n*ch*2', buf.byteLength === 44 + 5 * 1 * 2, String(buf.byteLength));
  ok('WAV sample rate at offset 24', dv.getUint32(24, true) === 44100);
  ok('WAV channel count at offset 22', dv.getUint16(22, true) === 1);
  ok('WAV bits-per-sample at offset 34 = 16', dv.getUint16(34, true) === 16);
  ok('WAV data chunk size at offset 40', dv.getUint32(40, true) === 10);
  ok('WAV 0.5 encodes to +16383', dv.getInt16(44 + 2, true) === 16383, String(dv.getInt16(46, true)));
  ok('WAV -0.5 encodes to -16384', dv.getInt16(44 + 4, true) === -16384, String(dv.getInt16(48, true)));
  // clamping: out-of-range floats must saturate, not wrap
  const hot = encodeWav([Float32Array.from([2, -2])], 8000);
  const hdv = new DataView(await hot.arrayBuffer());
  ok('WAV clamps +2.0 to 32767', hdv.getInt16(44, true) === 32767, String(hdv.getInt16(44, true)));
  ok('WAV clamps -2.0 to -32768', hdv.getInt16(46, true) === -32768, String(hdv.getInt16(46, true)));
  bites('a wrong RIFF tag is rejected', () => tag(0) === 'XYZW');
  bites('a wrong byte length is rejected', () => buf.byteLength === 44 + 5 * 1 * 2 + 1);
}

// ---------------------------------------------------------------- resampleFloat
{
  const src = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
  const same = resampleFloat(src, 44100, 44100);
  ok('resample identity copies values', same.length === 1000 && same.every((v, i) => v === src[i]));
  ok('resample identity returns a NEW array', same !== src);
  const half = resampleFloat(src, 44100, 22050);
  ok('resample 44100->22050 halves length', half.length === 500, String(half.length));
  const dbl = resampleFloat(src, 22050, 44100);
  ok('resample 22050->44100 doubles length', dbl.length === 2000, String(dbl.length));
  ok('resample linear interp midpoint', near(half[250], src[500], 0.01), `${half[250]} vs ${src[500]}`);
  bites('a wrong resampled length is rejected', () => half.length === 501);
}

// ---------------------------------------------------------------- floatTo16
{
  const out = floatTo16(Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]));
  ok('floatTo16 zero', out[0] === 0);
  ok('floatTo16 +1 -> 32767', out[3] === 32767, String(out[3]));
  ok('floatTo16 -1 -> -32768', out[4] === -32768, String(out[4]));
  ok('floatTo16 clamps +2 -> 32767', out[5] === 32767, String(out[5]));
  ok('floatTo16 clamps -2 -> -32768', out[6] === -32768, String(out[6]));
  ok('floatTo16 is Int16Array', out instanceof Int16Array);
  bites('an unclamped +2 would overflow', () => floatTo16(Float32Array.from([2]))[0] === 65534);
}

// ---------------------------------------------------------------- timeStretch (pitch-preserving)
{
  const rate = 44100;
  const tone = sine(440, rate, 1);
  const f0 = zeroFreq(tone, rate);
  ok('frequency estimator reads a 440 Hz tone', near(f0, 440, 3), `${f0.toFixed(1)} Hz`);
  // the estimator itself must bite: a 880 Hz tone must NOT read as 440
  ok('frequency estimator distinguishes 880 Hz', near(zeroFreq(sine(880, rate, 1), rate), 880, 6));
  bites('the estimator would reject a wrong frequency', () => near(f0, 880, 3));

  const id = timeStretch(tone, 1, rate);
  ok('timeStretch factor 1 is identity length', id.length === tone.length);

  const longer = timeStretch(tone, 1.5, rate);
  const fLong = zeroFreq(longer, rate);
  ok('timeStretch 1.5x lengthens ~50%', near(longer.length, tone.length * 1.5, rate * 0.06), `${longer.length} vs ${Math.round(tone.length * 1.5)}`);
  ok('timeStretch 1.5x PRESERVES pitch (~440 Hz)', near(fLong, 440, 440 * 0.06), `${fLong.toFixed(1)} Hz`);

  const shorter = timeStretch(tone, 0.75, rate);
  const fShort = zeroFreq(shorter, rate);
  ok('timeStretch 0.75x shortens ~25%', near(shorter.length, tone.length * 0.75, rate * 0.06), `${shorter.length}`);
  ok('timeStretch 0.75x PRESERVES pitch (~440 Hz)', near(fShort, 440, 440 * 0.06), `${fShort.toFixed(1)} Hz`);

  // counter-proof: a naive resample changes pitch — prove the pitch assertion is not vacuous by
  // showing the SAME tolerance rejects a tone that really did shift frequency.
  bites('a genuinely pitch-shifted tone fails the preserve-pitch test', () => near(zeroFreq(sine(660, rate, 1), rate), 440, 440 * 0.06));
  bites('a wrong stretched length is rejected', () => near(longer.length, tone.length * 2, rate * 0.06));
  // amplitude must survive the overlap-add normalisation (no silent collapse, no blow-up)
  ok('timeStretch keeps amplitude sane', rms(longer) > 0.3 && rms(longer) < 0.95, `rms ${rms(longer).toFixed(3)}`);
}

// ---------------------------------------------------------------- biquadPeaking
{
  const rate = 44100;
  const tone1k = sine(1000, rate, 0.5);
  const flat = biquadPeaking(tone1k, rate, 1000, 0);
  ok('biquad 0 dB is an exact copy', flat.length === tone1k.length && flat.every((v, i) => v === tone1k[i]));
  const boosted = biquadPeaking(tone1k, rate, 1000, 9);
  const cut = biquadPeaking(tone1k, rate, 1000, -9);
  const r0 = rms(tone1k), rb = rms(boosted), rc = rms(cut);
  ok('biquad +9 dB at centre raises energy', rb > r0 * 1.5, `${rb.toFixed(3)} > ${r0.toFixed(3)}`);
  ok('biquad -9 dB at centre lowers energy', rc < r0 * 0.7, `${rc.toFixed(3)} < ${r0.toFixed(3)}`);
  // a band far from the tone must barely touch it (selectivity)
  const offband = biquadPeaking(tone1k, rate, 60, 9);
  ok('biquad boost at 60 Hz leaves a 1 kHz tone ~unchanged', near(rms(offband), r0, r0 * 0.15), `${rms(offband).toFixed(3)} vs ${r0.toFixed(3)}`);
  bites('a cut would not pass the boost assertion', () => rc > r0 * 1.5);
  bites('a boost would not pass the cut assertion', () => rb < r0 * 0.7);
}

// ---------------------------------------------------------------- applyEqualizer
{
  const rate = 44100;
  const chans = [sine(60, rate, 0.5), sine(60, rate, 0.5)];
  const flat = applyEqualizer(chans, rate, [0, 0, 0, 0, 0]);
  ok('EQ flat is identity per channel', flat.length === 2 && flat[0].every((v, i) => v === chans[0][i]));
  ok('EQ_BANDS is the five named centres', EQ_BANDS.join(',') === '60,250,1000,4000,12000', EQ_BANDS.join(','));
  const bass = applyEqualizer([sine(60, rate, 0.5)], rate, [10, 0, 0, 0, 0]);
  ok('EQ bass boost raises a 60 Hz tone', rms(bass[0]) > rms(chans[0]) * 1.5, `${rms(bass[0]).toFixed(3)}`);
  bites('EQ flat would not pass a boost assertion', () => rms(flat[0]) > rms(chans[0]) * 1.5);
}

// ---------------------------------------------------------------- encodeMp3 (real lamejs)
{
  const rate = 44100;
  const blob = await encodeMp3([sine(440, rate, 0.3), sine(440, rate, 0.3)], rate, 128);
  ok('encodeMp3 returns audio/mpeg', blob.type === 'audio/mpeg', blob.type);
  ok('encodeMp3 produces non-empty bytes', blob.size > 1000, `${blob.size} bytes`);
  const mono = await encodeMp3([sine(440, rate, 0.2)], rate, 96);
  ok('encodeMp3 mono path works', mono.size > 500, `${mono.size} bytes`);
  bites('an empty blob would fail the size assertion', () => 0 > 1000);
}

// ---------------------------------------------------------------- non-empty guard + verdict
const groups = 7;
if (pass + fail === 0) { console.error('EMPTY RUN: no assertion executed'); process.exit(1); }
if (pass < 30) { console.error(`VACUOUS RUN: only ${pass} assertions passed — the gate lost coverage (expected 30+)`); process.exit(1); }
console.log(`\nDSP gate: ${pass} passed, ${fail} failed across ${groups} function groups (counter-proofs included)\n`);
process.exit(fail ? 1 : 0);