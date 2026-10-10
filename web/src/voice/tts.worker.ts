/**
 * Voice worker: turns lines of text into 24 kHz audio, one at a time, off the main thread.
 * Our Rust/WASM phonemizer (`crates/voice-wasm`) turns text into KittenTTS nano's input ids, and
 * ONNX Runtime Web runs the model (its WASM build with SIMD, on this one thread). `synth.ts`
 * makes each line.
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
import type { VoiceParams } from './voices';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToVoiceWorker>) => void) | null;
  postMessage(message: FromVoiceWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

/** Bumped when the files change; older caches are deleted. (New files under new names don't need it.) */
const CACHE = 'littlelives-voice-v2';

/** Files under `voice/` (made by `tools/voice/fetch.mjs`), with sizes in bytes for the progress bar. */
type File = [name: string, bytes: number];
const LEXICON: File = ['en-us.lexz', 1_320_518];
const MODEL: File = ['kitten-nano-0.8-edit2.onnx', 15_450_474];
const VOICES: File = ['kitten-nano-0.8-voices.f32', 1_048_576];
const ORT_WASM_BYTES = 14_239_897;
const VOICE_WASM_BYTES = 140_103;

const engine: Engine = { ort: ort as unknown as Engine['ort'], phonemizer: null as unknown as Engine['phonemizer'], session: null, kittenVoices: null };
let loading: Promise<void> | null = null;
/** Lines are made one after another: a run must finish before the next starts. */
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    if (!loading) {
      loading = load(msg.base).catch((err) => {
        loading = null;
        scope.postMessage({ type: 'error', message: String(err) });
        throw err;
      });
      loading.catch(() => {});
    }
  } else if (msg.type === 'speak') {
    queue = queue.then(() => speak(msg.id, msg.text, msg.voice));
  }
};

async function speak(id: number, text: string, voice: VoiceParams): Promise<void> {
  try {
    if (!loading) throw new Error('voice model not loaded');
    await loading;
    const start = performance.now();
    const { samples, resampleMs } = await synthesizeLine(engine, text, voice);
    scope.postMessage({ type: 'audio', id, samples, ms: performance.now() - start, resampleMs }, [samples.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', id, message: String(err) });
  }
}

/** Downloads (or takes from the cache) the runtime, phonemizer, dictionary and model, and starts its session. */
async function load(base: string): Promise<void> {
  const start = performance.now();
  // `built`: imported through Vite. In dev their URLs aren't hashed, so a rebuilt wasm would
  // otherwise come back stale from the cache; those are fetched fresh there.
  const files: { url: string; size: number; built?: boolean }[] = [
    { url: ortWasmUrl, size: ORT_WASM_BYTES, built: true },
    { url: wasmUrl, size: VOICE_WASM_BYTES, built: true },
    ...[LEXICON, MODEL, VOICES].map(([name, size]) => ({ url: `${base}voice/${name}`, size })),
  ];
  const total = files.reduce((n, f) => n + f.size, 0);
  const done = files.map(() => 0);
  const report = () => scope.postMessage({ type: 'progress', loaded: done.reduce((a, b) => a + b, 0), total });
  const cache = await openCache();
  const bytes = await Promise.all(
    files.map((f, i) =>
      fetchOnce(f.built && import.meta.env.DEV ? null : cache, f.url, (n) => {
        done[i] = Math.min(n, f.size);
        report();
      }),
    ),
  );
  void prune(cache, files.map((f) => f.url));
  const [ortWasm, wasm, lexicon, model, voices] = bytes;
  await init({ module_or_path: wasm });
  engine.phonemizer = new Voice(await gunzipText(lexicon));
  // One thread, no proxy worker (this is the worker); the runtime comes from our own download.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  ort.env.wasm.wasmBinary = ortWasm;
  ort.env.logLevel = 'error';
  engine.session = (await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })) as unknown as Session;
  engine.kittenVoices = new Float32Array(voices);
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

/** Drops cached files this version no longer uses (an older build's wasm, models no longer spoken with). */
async function prune(cache: Cache | null, keep: string[]): Promise<void> {
  if (!cache) return;
  const wanted = new Set(keep.map((url) => new URL(url, location.href).href));
  try {
    for (const req of await cache.keys()) if (!wanted.has(req.url)) await cache.delete(req);
  } catch {
    // Only space: the files still load.
  }
}

/** Unpacks a gzipped file, or reads it as text if a server already unpacked it. */
async function gunzipText(bytes: ArrayBuffer): Promise<string> {
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new TextDecoder().decode(bytes);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Each file once per worker (a load tried again after failing only fetches what it's missing). */
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
