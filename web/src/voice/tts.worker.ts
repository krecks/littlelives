/**
 * Voice worker: owns the Rust/WASM voice engine (phonemizer + Paradee-8M through tract) and
 * turns lines of text into 24 kHz audio, one at a time, off the main thread.
 *
 * The engine code, the model and the dictionary are fetched once and kept in the Cache API,
 * so the next session starts without downloading.
 */

import init, { Voice } from './wasm-pkg/voice_wasm.js';
import wasmUrl from './wasm-pkg/voice_wasm_bg.wasm?url';
import type { FromVoiceWorker, ToVoiceWorker } from './protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToVoiceWorker>) => void) | null;
  postMessage(message: FromVoiceWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

const CACHE = 'littlelives-voice-v1';

/** The voice per language: model, its config and the pronunciation dictionary (under `voice/`). */
const VOICES: Record<string, { model: [string, number]; config: string; lexicon: [string, number] }> = {
  en: { model: ['paradee-8m.onnx', 9_040_000], config: 'paradee-8m.json', lexicon: ['en-us.lexz', 1_320_000] },
};

let voice: Voice | null = null;
let loading: Promise<void> | null = null;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    loading ??= load(msg.base, msg.language).catch((err) => {
      loading = null;
      scope.postMessage({ type: 'error', message: String(err) });
    });
  } else if (msg.type === 'speak') {
    void speak(msg.id, msg.text, msg.speed, msg.pitch);
  }
};

async function speak(id: number, text: string, speed: number, pitch: number): Promise<void> {
  try {
    await loading;
    if (!voice) throw new Error('voice model not loaded');
    const start = performance.now();
    const samples = voice.speak(text, speed, pitch);
    scope.postMessage({ type: 'audio', id, samples, ms: performance.now() - start }, [samples.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', id, message: String(err) });
  }
}

async function load(base: string, language: string): Promise<void> {
  const start = performance.now();
  const v = VOICES[language];
  if (!v) throw new Error(`no voice for language "${language}"`);
  const files = [
    { url: wasmUrl, size: 18_300_000 },
    { url: `${base}voice/${v.model[0]}`, size: v.model[1] },
    { url: `${base}voice/${v.lexicon[0]}`, size: v.lexicon[1] },
    { url: `${base}voice/${v.config}`, size: 1_800 },
  ];
  const total = files.reduce((n, f) => n + f.size, 0);
  const done = files.map(() => 0);
  const report = () => scope.postMessage({ type: 'progress', loaded: done.reduce((a, b) => a + b, 0), total });
  const cache = await caches.open(CACHE).catch(() => null);
  const [wasm, model, lexicon, config] = await Promise.all(
    files.map((f, i) =>
      fetchCached(cache, f.url, (n) => {
        done[i] = Math.min(n, f.size);
        report();
      }),
    ),
  );
  await init({ module_or_path: wasm });
  const text = await gunzipText(lexicon);
  voice = new Voice(text, new Uint8Array(model), new TextDecoder().decode(config));
  scope.postMessage({ type: 'ready', ms: performance.now() - start });
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
