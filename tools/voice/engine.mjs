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
export const FILES = { model: 'kitten-nano-0.8-edit2.onnx', voices: 'kitten-nano-0.8-voices.f32' };
export const SAMPLE_RATE = 24000;

const dir = new URL('public/voice/', web);
initSync({ module: readFileSync(new URL('src/voice/wasm-pkg/voice_wasm_bg.wasm', web)) });
export const phonemizer = new Voice(gunzipSync(readFileSync(new URL('en-us.lexz', dir))).toString());
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

/** A new ONNX Runtime session for the model, as the worker makes it. */
export function session() {
  return ort.InferenceSession.create(readFileSync(new URL(FILES.model, dir)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

/** An engine with the model loaded (a fresh session). */
export async function engine() {
  const buf = readFileSync(new URL(FILES.voices, dir));
  return {
    ort,
    phonemizer,
    session: await session(),
    kittenVoices: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
  };
}

/** 24 kHz samples of one line in a voice (`VoiceParams`). */
export async function say(e, text, voice) {
  return (await synthesizeLine(e, text, voice)).samples;
}
