#!/usr/bin/env node
/**
 * Checks the voices as the browser makes them (`engine.mjs`: our phonemizer WASM, ONNX Runtime
 * Web's WASM build on one thread, the worker's own `synth.ts`), with KittenTTS nano:
 *
 * - the same text and voice give bit-identical samples, in one session and in a fresh one (the
 *   clip cache in `web/src/voice/service.svelte.ts` relies on it), and match golden hashes (a
 *   change to the model, its edit, the phonemizer or the mixing shows up here);
 * - the voice controls work: pitch changes the sound but not the timing, speed the length,
 *   depth the brightness; mixes differ from their voices; silence is trimmed;
 * - and prints the time per line.
 *
 * Needs `pnpm voice` first. Usage (from web/): `pnpm check:voice`.
 */

import { createHash } from 'node:crypto';
import { SAMPLE_RATE, engine, say } from './engine.mjs';

const LINES = [
  'Hello there!',
  "I'm so hungry, I could eat a whole pizza by myself.",
  'What a lovely garden. I should water the roses before it gets dark.',
];
/** Bruno (one of KittenTTS's men), and a mix of Luna and Rosie (two women). */
const BRUNO = { mix: [5, 5, 1], speed: 1, pitch: 1, depth: 1 };
const MIX = { mix: [1, 2, 0.6], speed: 1.05, pitch: 1.02, depth: 0.98 };
/**
 * KittenTTS's output for `LINES` in `BRUNO`, then line 2 in `MIX` (SHA-256, first 12 hex digits).
 * WASM arithmetic is the same on every machine, so these hold everywhere; update them only on
 * purpose (a new model, edit, phonemizer rule or mixing).
 */
const GOLDEN = ['ee17e172d952', '61899b6ba874', '848017ba7531', 'fb4a29635bcf'];

const hash = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 12);
const same = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const fail = (message) => {
  console.error(`voice check FAILED: ${message}`);
  process.exit(1);
};
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));

/** Mean spectral centroid (Hz) of the loud frames, by a direct DFT (no dependencies). */
function centroid(x) {
  const n = 512;
  let sum = 0;
  let count = 0;
  for (let at = 0; at + n <= x.length; at += n * 2) {
    const frame = x.subarray(at, at + n);
    if (Math.sqrt(frame.reduce((s, v) => s + v * v, 0) / n) < 0.02) continue;
    let num = 0;
    let den = 0;
    for (let k = 1; k < n / 2; k++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const v = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
        re += v * Math.cos((2 * Math.PI * k * i) / n);
        im += v * Math.sin((2 * Math.PI * k * i) / n);
      }
      const mag = Math.hypot(re, im);
      num += (mag * k * SAMPLE_RATE) / n;
      den += mag;
    }
    sum += num / den;
    count++;
  }
  return sum / count;
}

/** Median pitch (Hz) of the loud frames, by normalised autocorrelation. */
function pitch(x) {
  const n = 960;
  const level = rms(x);
  const found = [];
  for (let i = 0; i + n + 400 < x.length; i += 480) {
    let e = 0;
    for (let k = 0; k < n; k++) e += x[i + k] ** 2;
    if (Math.sqrt(e / n) < level) continue;
    let best = 0;
    let lag = 0;
    for (let L = 48; L < 400; L++) {
      let c = 0;
      let e2 = 0;
      for (let k = 0; k < n; k++) {
        c += x[i + k] * x[i + k + L];
        e2 += x[i + k + L] ** 2;
      }
      c /= Math.sqrt(e * e2) + 1e-9;
      if (c > best) [best, lag] = [c, L];
    }
    if (best > 0.8) found.push(SAMPLE_RATE / lag);
  }
  found.sort((a, b) => a - b);
  return found[found.length >> 1] ?? 0;
}

const first = await engine();
const second = await engine();

/** Same samples twice in one engine and once in a fresh one; prints the time. */
async function steady(label, line, voice) {
  const a = await say(first, line, voice);
  const start = performance.now();
  const b = await say(first, line, voice);
  const ms = performance.now() - start;
  const c = await say(second, line, voice);
  if (!same(a, b)) fail(`${label}: "${line}" differs between two runs`);
  if (!same(a, c)) fail(`${label}: "${line}" differs between two sessions`);
  if (!(rms(a) > 0.01)) fail(`${label}: "${line}" is silent`);
  const secs = a.length / SAMPLE_RATE;
  console.log(`voice: ${label}: ${secs.toFixed(2)} s of audio in ${ms.toFixed(0)} ms (${(secs / (ms / 1000)).toFixed(1)}x real time), identical every time [${hash(a)}]  ${line}`);
  return a;
}

const line = LINES[1];
const got = [];
for (const l of LINES) got.push(await steady('KittenTTS', l, BRUNO));
got.push(await steady('KittenTTS mix', line, MIX));
const hashes = got.map(hash);
if (GOLDEN.some((g, i) => g !== hashes[i])) fail(`KittenTTS: samples changed: [${hashes.join(', ')}], expected [${GOLDEN.join(', ')}] (update GOLDEN only on purpose)`);
console.log('voice: KittenTTS: matches the golden samples');

const kBase = got[1];
const kLow = await say(first, line, { ...BRUNO, pitch: 0.85 });
const kFast = await say(first, line, { ...BRUNO, speed: 1.25 });
const [p0, p1] = [pitch(kBase), pitch(kLow)];
if (same(kLow, kBase) || !(p1 < p0 * 0.93)) fail(`KittenTTS: pitch 0.85 should lower the pitch (${p0.toFixed(0)} Hz to ${p1.toFixed(0)} Hz)`);
if (Math.abs(kLow.length - kBase.length) > 0.05 * kBase.length) fail('KittenTTS: pitch should not change the timing');
if (!(kFast.length < kBase.length * 0.9)) fail('KittenTTS: a faster voice should be shorter');
const kLarge = await say(first, line, { ...BRUNO, depth: 0.88 });
if (!(centroid(kLarge) < centroid(kBase) * 0.97)) fail('KittenTTS: a larger voice should sound darker');
// Depth (the voice's size, by resampling): deterministic too, and keeps the length.
for (const depth of [0.88, 1.1]) {
  const a = await say(first, line, { ...BRUNO, depth });
  const b = await say(second, line, { ...BRUNO, depth });
  if (!same(a, b)) fail(`KittenTTS: depth ${depth} differs between sessions`);
  const ratio = a.length / kBase.length;
  if (ratio < 0.94 || ratio > 1.06) fail(`KittenTTS: depth ${depth} changed the length by ${ratio.toFixed(3)}`);
}
if (first.phonemizer.inputs('', 1, 1, 1).ids.length !== 0) fail('empty text should give no ids (the worker then skips the model)');
const luna = await say(first, line, { ...MIX, mix: [1, 1, 1] });
if (same(luna, got[3])) fail('KittenTTS: a mix should differ from its main voice');
// Trimmed: speech starts within 0.1 s (the model's own clips start with up to 0.8 s of silence).
const onset = kBase.findIndex((v) => Math.abs(v) > 0.05 * kBase.reduce((m, x) => Math.max(m, Math.abs(x)), 0));
if (onset > 0.1 * SAMPLE_RATE) fail(`KittenTTS: speech starts after ${(onset / SAMPLE_RATE).toFixed(2)} s: silence not trimmed`);
console.log(`voice: KittenTTS: pitch (${p0.toFixed(0)} to ${p1.toFixed(0)} Hz at x0.85), speed, depth and mixes work; speech starts at ${(onset / SAMPLE_RATE).toFixed(2)} s`);
