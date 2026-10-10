/**
 * Voice worker: turns lines of text into 24 kHz audio, one at a time, off the main thread.
 * Our Rust/WASM phonemizer (`crates/voice-wasm`) turns text into Paradee-8M's input ids, and
 * ONNX Runtime Web runs the model (its WASM build with SIMD, on this one thread).
 *
 * The runtime, the model and the dictionary are self-hosted, fetched once and kept in the
 * Cache API, so the next session starts without downloading.
 */

import * as ort from 'onnxruntime-web/wasm';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import init, { Voice } from './wasm-pkg/voice_wasm.js';
import wasmUrl from './wasm-pkg/voice_wasm_bg.wasm?url';
import type { FromVoiceWorker, ToVoiceWorker } from './protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToVoiceWorker>) => void) | null;
  postMessage(message: FromVoiceWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

/** Bumped when the files change; older caches are deleted. */
const CACHE = 'littlelives-voice-v2';

/**
 * The voice per language: the model (edited by `tools/voice/fetch.mjs`), its config and the
 * pronunciation dictionary (under `voice/`), with sizes in bytes for the progress bar.
 */
const VOICES: Record<string, { model: [string, number]; config: string; lexicon: [string, number] }> = {
  en: { model: ['paradee-8m-edit1.onnx', 9_044_733], config: 'paradee-8m.json', lexicon: ['en-us.lexz', 1_320_518] },
};
const ORT_WASM_BYTES = 14_239_897;
const VOICE_WASM_BYTES = 155_400;

let voice: Voice | null = null;
let session: ort.InferenceSession | null = null;
let loading: Promise<void> | null = null;
/** Lines are made one after another: a run must finish before the next starts. */
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    loading ??= load(msg.base, msg.language).catch((err) => {
      loading = null;
      scope.postMessage({ type: 'error', message: String(err) });
    });
  } else if (msg.type === 'speak') {
    queue = queue.then(() => speak(msg.id, msg.text, msg.speed, msg.pitch, msg.depth));
  }
};

async function speak(id: number, text: string, speed: number, pitch: number, depth: number): Promise<void> {
  try {
    await loading;
    if (!voice || !session) throw new Error('voice model not loaded');
    const start = performance.now();
    const { samples, resampleMs } = await synthesize(voice, session, text, speed, pitch, depth);
    scope.postMessage({ type: 'audio', id, samples, ms: performance.now() - start, resampleMs }, [samples.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', id, message: String(err) });
  }
}

/** One line: the model at pitch and speed divided by the depth, then resampled by the depth (the voice's size). */
async function synthesize(
  voice: Voice,
  session: ort.InferenceSession,
  text: string,
  speed: number,
  pitch: number,
  depth: number,
): Promise<{ samples: Float32Array; resampleMs: number }> {
  const inputs = voice.inputs(text, speed, pitch, depth);
  try {
    const ids = inputs.ids;
    if (ids.length === 0) return { samples: new Float32Array(0), resampleMs: 0 };
    const out = await session.run({
      input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
      speed: new ort.Tensor('float32', Float32Array.of(inputs.speed), [1]),
      pitch: new ort.Tensor('float32', Float32Array.of(inputs.pitch), [1]),
    });
    const wave = out.waveform.data as Float32Array;
    const start = performance.now();
    // A new array of our own either way, so its buffer can be transferred to the main thread.
    const samples = inputs.depth === 1 ? new Float32Array(wave) : inputs.finish(wave);
    const resampleMs = performance.now() - start;
    for (const t of Object.values(out)) t.dispose();
    return { samples, resampleMs };
  } finally {
    inputs.free();
  }
}

async function load(base: string, language: string): Promise<void> {
  const start = performance.now();
  const v = VOICES[language];
  if (!v) throw new Error(`no voice for language "${language}"`);
  const files = [
    { url: ortWasmUrl, size: ORT_WASM_BYTES },
    { url: wasmUrl, size: VOICE_WASM_BYTES },
    { url: `${base}voice/${v.model[0]}`, size: v.model[1] },
    { url: `${base}voice/${v.lexicon[0]}`, size: v.lexicon[1] },
    { url: `${base}voice/${v.config}`, size: 1_800 },
  ];
  const total = files.reduce((n, f) => n + f.size, 0);
  const done = files.map(() => 0);
  const report = () => scope.postMessage({ type: 'progress', loaded: done.reduce((a, b) => a + b, 0), total });
  const cache = await openCache();
  const [ortWasm, wasm, model, lexicon, config] = await Promise.all(
    files.map((f, i) =>
      fetchCached(cache, f.url, (n) => {
        done[i] = Math.min(n, f.size);
        report();
      }),
    ),
  );
  await init({ module_or_path: wasm });
  voice = new Voice(await gunzipText(lexicon), new TextDecoder().decode(config));
  // One thread, no proxy worker (this is the worker); the runtime comes from our own download.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  ort.env.wasm.wasmBinary = ortWasm;
  ort.env.logLevel = 'error';
  session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  scope.postMessage({ type: 'ready', ms: performance.now() - start });
}

/** This version's cache; caches of earlier versions are deleted. */
async function openCache(): Promise<Cache | null> {
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith('littlelives-voice-') && name !== CACHE) await caches.delete(name);
    }
    return await caches.open(CACHE);
  } catch {
    return null;
  }
}

/** Unpacks a gzipped file, or reads it as text if a server already unpacked it. */
async function gunzipText(bytes: ArrayBuffer): Promise<string> {
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new TextDecoder().decode(bytes);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** The file's bytes from the cache, or downloaded (with progress) and cached. */
async function fetchCached(cache: Cache | null, url: string, progress: (bytes: number) => void): Promise<ArrayBuffer> {
  const hit = await cache?.match(url);
  if (hit) {
    const bytes = await hit.arrayBuffer();
    progress(bytes.byteLength);
    return bytes;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    progress(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  await cache?.put(url, new Response(bytes, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } })).catch(() => {});
  return bytes.buffer;
}
