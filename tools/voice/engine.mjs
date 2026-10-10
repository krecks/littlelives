/**
 * The voice engine in Node, as the browser's voice worker runs it: our phonemizer WASM
 * (`web/src/voice/wasm-pkg`), ONNX Runtime Web (its WASM build, one thread) and the files in
 * `web/public/voice/`, with every line made by `web/src/voice/synth.ts` (the worker's own code).
 * Used by `check.mjs` and `samples.mjs`. Needs `pnpm voice` first.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

const web = new URL('../../web/', import.meta.url);
export const ort = createRequire(new URL('package.json', web))('onnxruntime-web');
const { initSync, Voice } = await import(new URL('src/voice/wasm-pkg/voice_wasm.js', web).href);
export const { synthesizeLine } = await import(new URL('src/voice/synth.ts', web).href);
export const voices = await import(new URL('src/voice/voices.ts', web).href);

/** The model files (as the worker names them). */
export const FILES = { paradee: 'paradee-8m-edit1.onnx', kitten: 'kitten-nano-0.8-edit1.onnx', kittenVoices: 'kitten-nano-0.8-voices.f32' };
export const SAMPLE_RATE = 24000;

const dir = new URL('public/voice/', web);
initSync({ module: readFileSync(new URL('src/voice/wasm-pkg/voice_wasm_bg.wasm', web)) });
export const phonemizer = new Voice(gunzipSync(readFileSync(new URL('en-us.lexz', dir))).toString(), readFileSync(new URL('paradee-8m.json', dir), 'utf8'));
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

/** A new ONNX Runtime session for a model (`paradee` or `kitten`), as the worker makes it. */
export function session(model) {
  return ort.InferenceSession.create(readFileSync(new URL(FILES[model], dir)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

/** An engine with both models loaded (fresh sessions). */
export async function engine() {
  const buf = readFileSync(new URL(FILES.kittenVoices, dir));
  return {
    ort,
    phonemizer,
    sessions: { paradee: await session('paradee'), kitten: await session('kitten') },
    kittenVoices: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
  };
}

/** 24 kHz samples of one line in a voice (`VoiceParams`). */
export async function say(e, text, voice) {
  return (await synthesizeLine(e, text, voice)).samples;
}
