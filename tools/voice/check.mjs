#!/usr/bin/env node
/**
 * Checks the voice as the browser runs it: our phonemizer WASM (`web/src/voice/wasm-pkg`) and
 * ONNX Runtime Web (its WASM build, one thread, the same package the worker uses) on the edited
 * model in `web/public/voice/`. The same text and voice must give bit-identical samples, in one
 * session and in a fresh one: the clip cache (`web/src/voice/service.svelte.ts`) relies on it.
 * Also checks the voice controls (pitch, speed, depth) and prints the time per line.
 *
 * Needs `pnpm voice` first. Usage (from web/): `pnpm check:voice`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

const web = new URL('../../web/', import.meta.url);
const ort = createRequire(new URL('package.json', web))('onnxruntime-web');
const { initSync, Voice } = await import(new URL('src/voice/wasm-pkg/voice_wasm.js', web).href);

const MODEL = 'paradee-8m-edit1.onnx';
const LINES = [
  'Hello there!',
  "I'm so hungry, I could eat a whole pizza by myself.",
  'What a lovely garden. I should water the roses before it gets dark.',
];

initSync({ module: readFileSync(new URL('src/voice/wasm-pkg/voice_wasm_bg.wasm', web)) });
const dir = new URL('public/voice/', web);
const voice = new Voice(gunzipSync(readFileSync(new URL('en-us.lexz', dir))).toString(), readFileSync(new URL('paradee-8m.json', dir), 'utf8'));
const model = readFileSync(new URL(MODEL, dir));
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';
const session = () => ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });

/** As the worker makes a line: the model at pitch and speed divided by the depth, then resampled by it. */
async function say(s, text, speed = 1, pitch = 1, depth = 1) {
  const inputs = voice.inputs(text, speed, pitch, depth);
  const ids = inputs.ids;
  const out = await s.run({
    input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
    speed: new ort.Tensor('float32', Float32Array.of(inputs.speed), [1]),
    pitch: new ort.Tensor('float32', Float32Array.of(inputs.pitch), [1]),
  });
  const wave = out.waveform.data;
  const start = performance.now();
  const samples = inputs.depth === 1 ? new Float32Array(wave) : inputs.finish(wave);
  lastResampleMs = performance.now() - start;
  inputs.free();
  return samples;
}
let lastResampleMs = 0;

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
      num += (mag * k * 24000) / n;
      den += mag;
    }
    sum += num / den;
    count++;
  }
  return sum / count;
}

const same = (a, b) => a.length === b.length && Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
const fail = (message) => {
  console.error(`voice check FAILED: ${message}`);
  process.exit(1);
};

const first = await session();
const second = await session();
for (const line of LINES) {
  const a = await say(first, line);
  const start = performance.now();
  const b = await say(first, line);
  const ms = performance.now() - start;
  const c = await say(second, line);
  if (!same(a, b)) fail(`"${line}" differs between two runs`);
  if (!same(a, c)) fail(`"${line}" differs between two sessions`);
  const rms = Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  if (!(rms > 0.01)) fail(`"${line}" is silent`);
  const secs = a.length / 24000;
  const hash = createHash('sha256').update(Buffer.from(a.buffer)).digest('hex').slice(0, 12);
  console.log(`voice: ${secs.toFixed(2)} s of audio in ${ms.toFixed(0)} ms (${(secs / (ms / 1000)).toFixed(1)}x real time), identical every time [${hash}]  ${line}`);
}
const line = LINES[1];
const base = await say(first, line);
const low = await say(first, line, 1, 0.7);
const fast = await say(first, line, 1.25, 1);
if (low.length !== base.length || same(low, base)) fail('pitch should change the sound but not the timing');
if (!(fast.length < base.length)) fail('a faster voice should be shorter');
if (voice.inputs('', 1, 1).ids.length !== 0) fail('empty text should give no ids (the worker then skips the model)');
console.log('voice: pitch and speed work');

// Depth (the voice's size, by resampling): deterministic too, keeps the length, darker when larger.
for (const depth of [0.85, 1.1]) {
  const a = await say(first, line, 1, 1, depth);
  const resampleMs = lastResampleMs;
  const b = await say(first, line, 1, 1, depth);
  const c = await say(second, line, 1, 1, depth);
  if (!same(a, b) || !same(a, c)) fail(`depth ${depth} differs between runs or sessions`);
  const ratio = a.length / base.length;
  if (ratio < 0.94 || ratio > 1.06) fail(`depth ${depth} changed the length by ${ratio.toFixed(3)}`);
  const hash = createHash('sha256').update(Buffer.from(a.buffer)).digest('hex').slice(0, 12);
  console.log(`voice: depth ${depth}: identical every time [${hash}], length ×${ratio.toFixed(3)}, resampled in ${resampleMs.toFixed(1)} ms, spectral centroid ${centroid(a).toFixed(0)} Hz (depth 1: ${centroid(base).toFixed(0)} Hz)`);
}
if (!(centroid(await say(first, line, 1, 1, 0.85)) < centroid(base) * 0.95)) fail('a larger voice should sound darker');
