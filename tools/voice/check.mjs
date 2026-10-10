#!/usr/bin/env node
/**
 * Checks the voice as the browser runs it: our phonemizer WASM (`web/src/voice/wasm-pkg`) and
 * ONNX Runtime Web (its WASM build, one thread, the same package the worker uses) on the edited
 * model in `web/public/voice/`. The same text and voice must give bit-identical samples, in one
 * session and in a fresh one: the clip cache (`web/src/voice/service.svelte.ts`) relies on it.
 * Also checks the voice controls and prints the time per line.
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

async function say(s, text, speed = 1, pitch = 1) {
  const inputs = voice.inputs(text, speed, pitch);
  const ids = inputs.ids;
  const out = await s.run({
    input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
    speed: new ort.Tensor('float32', Float32Array.of(inputs.speed), [1]),
    pitch: new ort.Tensor('float32', Float32Array.of(inputs.pitch), [1]),
  });
  inputs.free();
  return new Float32Array(out.waveform.data);
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
