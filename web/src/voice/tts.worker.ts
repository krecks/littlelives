/**
 * Voice worker: turns lines of text into 24 kHz audio, one at a time, off the main thread.
 * Our Rust/WASM phonemizer (`crates/voice-wasm`) turns text into a model's input ids, and ONNX
 * Runtime Web runs the model (its WASM build with SIMD, on this one thread): Paradee-8M for
 * children (and as the small, fast fallback), KittenTTS nano for teens and grown-ups. Each model
 * is loaded the first time it is asked for; both share the runtime, the phonemizer and the
 * dictionary. `synth.ts` makes each line.
 *
 * Everything is self-hosted, fetched once and kept in the Cache API, so the next session starts
 * without downloading.
 */

import * as ort from 'onnxruntime-web/wasm';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import init, { Voice } from './wasm-pkg/voice_wasm.js';
import wasmUrl from './wasm-pkg/voice_wasm_bg.wasm?url';
import type { FromVoiceWorker, ToVoiceWorker } from './protocol';
import { synthesizeLine, type Engine, type Session } from './synth';
import type { VoiceModel, VoiceParams } from './voices';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToVoiceWorker>) => void) | null;
  postMessage(message: FromVoiceWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

/** Bumped when the files change; older caches are deleted. (New files under new names don't need it.) */
const CACHE = 'littlelives-voice-v2';

/** Files under `voice/` (made by `tools/voice/fetch.mjs`), with sizes in bytes for the progress bar. */
type File = [name: string, bytes: number];
const SHARED: { lexicon: File; config: File } = { lexicon: ['en-us.lexz', 1_320_518], config: ['paradee-8m.json', 1_774] };
const MODELS: Record<VoiceModel, { model: File; voices?: File }> = {
  paradee: { model: ['paradee-8m-edit1.onnx', 9_044_733] },
  kitten: { model: ['kitten-nano-0.8-edit1.onnx', 15_450_474], voices: ['kitten-nano-0.8-voices.f32', 1_048_576] },
};
const ORT_WASM_BYTES = 14_239_897;
const VOICE_WASM_BYTES = 180_388;

const engine: Engine = { ort: ort as unknown as Engine['ort'], phonemizer: null as unknown as Engine['phonemizer'], sessions: {}, kittenVoices: null };
let shared: Promise<void> | null = null;
const loads = new Map<VoiceModel, Promise<void>>();
/** Lines are made one after another: a run must finish before the next starts. */
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    if (!loads.has(msg.model)) {
      const loading = load(msg.base, msg.model).catch((err) => {
        loads.delete(msg.model);
        scope.postMessage({ type: 'error', model: msg.model, message: String(err) });
        throw err;
      });
      loading.catch(() => {});
      loads.set(msg.model, loading);
    }
  } else if (msg.type === 'speak') {
    queue = queue.then(() => speak(msg.id, msg.text, msg.voice));
  }
};

async function speak(id: number, text: string, voice: VoiceParams): Promise<void> {
  try {
    const loading = loads.get(voice.model);
    if (!loading) throw new Error(`voice model ${voice.model} not loaded`);
    await loading;
    const start = performance.now();
    const { samples, resampleMs } = await synthesizeLine(engine, text, voice);
    scope.postMessage({ type: 'audio', id, samples, ms: performance.now() - start, resampleMs }, [samples.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', id, message: String(err) });
  }
}

/** Downloads (or takes from the cache) what a model needs and starts its session. */
async function load(base: string, model: VoiceModel): Promise<void> {
  const start = performance.now();
  const m = MODELS[model];
  const own: File[] = [m.model, ...(m.voices ? [m.voices] : [])];
  const files: { url: string; size: number }[] = [
    { url: ortWasmUrl, size: ORT_WASM_BYTES },
    { url: wasmUrl, size: VOICE_WASM_BYTES },
    { url: `${base}voice/${SHARED.lexicon[0]}`, size: SHARED.lexicon[1] },
    { url: `${base}voice/${SHARED.config[0]}`, size: SHARED.config[1] },
    ...own.map(([name, size]) => ({ url: `${base}voice/${name}`, size })),
  ];
  const total = files.reduce((n, f) => n + f.size, 0);
  const done = files.map(() => 0);
  const report = () => scope.postMessage({ type: 'progress', model, loaded: done.reduce((a, b) => a + b, 0), total });
  const cache = await openCache();
  const bytes = await Promise.all(
    files.map((f, i) =>
      fetchOnce(cache, f.url, (n) => {
        done[i] = Math.min(n, f.size);
        report();
      }),
    ),
  );
  shared ??= startShared(bytes[0], bytes[1], bytes[2], bytes[3]);
  await shared;
  const session = (await ort.InferenceSession.create(new Uint8Array(bytes[4]), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })) as unknown as Session;
  if (m.voices) engine.kittenVoices = new Float32Array(bytes[5]);
  engine.sessions[model] = session;
  scope.postMessage({ type: 'ready', model, ms: performance.now() - start });
}

/** The phonemizer and the runtime, once for both models. */
async function startShared(ortWasm: ArrayBuffer, wasm: ArrayBuffer, lexicon: ArrayBuffer, config: ArrayBuffer): Promise<void> {
  await init({ module_or_path: wasm });
  engine.phonemizer = new Voice(await gunzipText(lexicon), new TextDecoder().decode(config));
  // One thread, no proxy worker (this is the worker); the runtime comes from our own download.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  ort.env.wasm.wasmBinary = ortWasm;
  ort.env.logLevel = 'error';
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

/** Each file once per worker, whichever model asked first (the other's progress counts it when it's in). */
const fetched = new Map<string, Promise<ArrayBuffer>>();
function fetchOnce(cache: Cache | null, url: string, progress: (bytes: number) => void): Promise<ArrayBuffer> {
  let p = fetched.get(url);
  if (!p) {
    p = fetchCached(cache, url, progress);
    p.catch(() => fetched.delete(url));
    fetched.set(url, p);
    return p;
  }
  return p.then((b) => {
    progress(b.byteLength);
    return b;
  });
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
