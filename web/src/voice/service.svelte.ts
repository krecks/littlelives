/**
 * The voice engine for the whole app (settings preview, benchmark, creator, the game): one
 * worker, started the first time it is needed, with each model (Paradee-8M, KittenTTS nano)
 * loaded the first time a voice needs it, and a status the settings screen shows.
 */

import { settings } from '../settings/settings.svelte';
import { SAMPLE_RATE, type FromVoiceWorker, type ToVoiceWorker } from './protocol';
import type { VoiceModel, VoiceParams } from './voices';

export interface BenchResult {
  /** Median generation time ÷ audio length (lower is faster; 0.25 = four times real time). */
  rtf: number;
  /** Median time to make one typical line, ms. */
  lineMs: number;
  /** Worst frame while speech was being made, ms (the 3D scene keeps drawing during the test). */
  worstFrameMs: number;
  cores: number;
  model: string;
  date: string;
}

export type BenchVerdict = 'good' | 'ok' | 'slow';
export type ModelState = 'off' | 'loading' | 'ready' | 'error';

/** How the voice worker is doing (for the debug overlay). */
export interface VoiceThreadStats {
  state: ModelState;
  /** Each model's state. */
  models: Record<VoiceModel, ModelState>;
  /** Time to load the engine, ms (0 until ready). */
  loadMs: number;
  /** Lines made since the engine started, and lines waiting to be made. */
  lines: number;
  queued: number;
  /** Time to make a line, last and average, ms; and the last line's model. */
  lastMs: number;
  avgMs: number;
  lastModel: VoiceModel | '';
  /** Generation time ÷ audio length over all lines (lower is faster). */
  rtf: number;
  /** Share of the last few seconds the worker spent making speech, 0..1. */
  busy: number;
  /** Clips kept for reuse, their size in bytes, and lines served from them. */
  cachedClips: number;
  cacheBytes: number;
  cacheHits: number;
}

// Before `voiceStatus`, which reads stored results with them.
const BENCH_KEY = 'littlelives.voiceBench';
/** Each model, its edit and the runtime: a new id discards old speed-test results and cached clips. */
export const MODEL_IDS: Record<VoiceModel, string> = {
  paradee: 'paradee-8m@f662642+edit1/ort-web@1.30.0',
  kitten: 'kitten-nano-0.8@7a1db64+int8+edit1/ort-web@1.30.0',
};

export const voiceStatus = $state({
  /** Summary: loading while any model loads, ready when one can speak. */
  state: 'off' as ModelState,
  models: { paradee: 'off', kitten: 'off' } as Record<VoiceModel, ModelState>,
  /** Download progress 0..1 of the model loading. */
  progress: 0,
  error: '',
  benchmarking: false,
  bench: readBench(),
});

/** The download each model needs, MB (runtime, phonemizer and dictionary shared: about 15.8 MB). */
export const DOWNLOAD_MB = { shared: 15.8, paradee: 9.0, kitten: 16.5 } as const;
const BENCH_LINES = [
  'Hello there!',
  "I'm so hungry, I could eat a whole pizza by myself.",
  'What a lovely garden. I should water the roses before it gets dark.',
];
/** The voices the speed test uses: one of KittenTTS's men (Bruno), and Paradee as it is. */
const BENCH_VOICES: Record<VoiceModel, VoiceParams> = {
  kitten: { model: 'kitten', mix: [5, 5, 1], speed: 1, pitch: 1, depth: 1 },
  paradee: { model: 'paradee', mix: [0, 0, 1], speed: 1, pitch: 1, depth: 1 },
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (s: Float32Array) => void; reject: (e: Error) => void; model: VoiceModel; chars: number }>();
const waiters: Record<VoiceModel, { resolve: () => void; reject: (e: Error) => void }[]> = { paradee: [], kitten: [] };
/** Counters behind `voiceThreadStats` (not reactive: read by the overlay's timer). */
const BUSY_WINDOW_MS = 5000;
const counters = { loadMs: 0, lines: 0, totalMs: 0, lastMs: 0, lastModel: '' as VoiceModel | '', audioSeconds: 0, recent: [] as { at: number; ms: number }[] };
/** Time per character of text, per model, averaged over recent lines (null: no line yet). */
const msPerChar: Record<VoiceModel, number | null> = { paradee: null, kitten: null };

function post(msg: ToVoiceWorker): void {
  worker?.postMessage(msg);
}

function summarise(): void {
  const s = Object.values(voiceStatus.models);
  voiceStatus.state = s.includes('loading') ? 'loading' : s.includes('ready') ? 'ready' : s.includes('error') ? 'error' : 'off';
}

function setModel(model: VoiceModel, state: ModelState): void {
  voiceStatus.models[model] = state;
  summarise();
}

function onMessage(msg: FromVoiceWorker): void {
  if (msg.type === 'progress') {
    voiceStatus.progress = msg.total ? msg.loaded / msg.total : 0;
  } else if (msg.type === 'ready') {
    counters.loadMs = Math.max(counters.loadMs, msg.ms);
    voiceStatus.progress = 1;
    setModel(msg.model, 'ready');
    waiters[msg.model].forEach((w) => w.resolve());
    waiters[msg.model] = [];
  } else if (msg.type === 'audio') {
    const now = performance.now();
    const line = pending.get(msg.id);
    counters.lines++;
    counters.totalMs += msg.ms;
    counters.lastMs = msg.ms;
    counters.audioSeconds += msg.samples.length / SAMPLE_RATE;
    counters.recent.push({ at: now, ms: msg.ms });
    while (counters.recent.length && counters.recent[0].at < now - BUSY_WINDOW_MS) counters.recent.shift();
    if (line) {
      counters.lastModel = line.model;
      const perChar = msg.ms / Math.max(8, line.chars);
      const prev = msPerChar[line.model];
      msPerChar[line.model] = prev === null ? perChar : prev * 0.7 + perChar * 0.3;
      line.resolve(msg.samples);
    }
    pending.delete(msg.id);
  } else if (msg.type === 'error') {
    if (msg.id !== undefined) {
      pending.get(msg.id)?.reject(new Error(msg.message));
      pending.delete(msg.id);
      return;
    }
    voiceStatus.error = msg.message;
    if (msg.model) {
      // One model couldn't load; the other may still speak.
      setModel(msg.model, 'error');
      waiters[msg.model].forEach((w) => w.reject(new Error(msg.message)));
      waiters[msg.model] = [];
      return;
    }
    for (const m of ['paradee', 'kitten'] as const) {
      waiters[m].forEach((w) => w.reject(new Error(msg.message)));
      waiters[m] = [];
    }
    unload();
    voiceStatus.models = { paradee: 'error', kitten: 'error' };
    summarise();
  }
}

/** Starts the worker and the model's download if needed; resolves when that model can speak. */
export function ensureVoice(model: VoiceModel = 'kitten'): Promise<void> {
  if (voiceStatus.models[model] === 'ready' && worker) return Promise.resolve();
  if (!worker) {
    worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromVoiceWorker>) => onMessage(e.data);
    worker.onerror = (e) => onMessage({ type: 'error', message: e.message || 'voice worker failed' });
  }
  if (voiceStatus.models[model] !== 'loading') {
    voiceStatus.progress = 0;
    voiceStatus.error = '';
    setModel(model, 'loading');
    post({ type: 'load', base: import.meta.env.BASE_URL, language: settings.voiceLanguage, model });
  }
  return new Promise((resolve, reject) => waiters[model].push({ resolve, reject }));
}

/** Whether a model can speak now. */
export function voiceReady(model: VoiceModel): boolean {
  return voiceStatus.models[model] === 'ready' && !!worker;
}

/**
 * About how long a line of this length would take to make with this model, ms, from the lines
 * made so far (or the speed test); null while nothing is known.
 */
export function estimateLineMs(model: VoiceModel, text: string): number | null {
  const known = msPerChar[model];
  const chars = Math.max(8, text.length);
  if (known !== null) return known * chars;
  const b = voiceStatus.bench[model];
  return b ? (b.lineMs / 45) * chars : null; // the speed test's lines average about 45 characters
}

/**
 * Clips already made, by language, model, voice and text. The engine is deterministic (seeded
 * noise), so a resident saying the same line again sounds exactly the same: reuse the clip
 * instead of making it again. Least recently used first out; survives the engine unloading.
 */
const CACHE_BYTES = 24 * 2 ** 20;
const clips = new Map<string, Float32Array>();
const making = new Map<string, Promise<Float32Array>>();
const cache = { bytes: 0, hits: 0 };

function clipKey(text: string, voice: VoiceParams): string {
  const mix = voice.model === 'kitten' ? `${voice.mix[0]}/${voice.mix[1]}/${voice.mix[2].toFixed(3)}` : '';
  return `${settings.voiceLanguage}|${MODEL_IDS[voice.model]}|${mix}|${voice.speed.toFixed(3)}|${voice.pitch.toFixed(3)}|${voice.depth.toFixed(3)}|${text}`;
}

/** The clip for this line and voice if it was made before (and keeps it fresh), else null. */
export function cachedClip(text: string, voice: VoiceParams): Float32Array | null {
  const key = clipKey(text, voice);
  const clip = clips.get(key);
  if (!clip) return null;
  clips.delete(key);
  clips.set(key, clip);
  cache.hits++;
  return clip;
}

/** Audio for one line, from the cache or made (once, however often it's asked for meanwhile). */
export function speak(text: string, voice: VoiceParams): Promise<Float32Array> {
  const cached = cachedClip(text, voice);
  if (cached) return Promise.resolve(cached);
  const key = clipKey(text, voice);
  const inFlight = making.get(key);
  if (inFlight) return inFlight;
  const clip = synthesize(text, voice)
    .then((samples) => {
      keep(key, samples);
      return samples;
    })
    .finally(() => making.delete(key));
  making.set(key, clip);
  return clip;
}

function keep(key: string, samples: Float32Array): void {
  if (clips.has(key) || samples.byteLength > CACHE_BYTES / 8) return;
  clips.set(key, samples);
  cache.bytes += samples.byteLength;
  for (const [k, old] of clips) {
    if (cache.bytes <= CACHE_BYTES) break;
    clips.delete(k);
    cache.bytes -= old.byteLength;
  }
}

/** Audio for one line (24 kHz mono), always made fresh (the speed test). Lines are made one after another in the worker. */
export async function synthesize(text: string, voice: VoiceParams): Promise<Float32Array> {
  await ensureVoice(voice.model);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, model: voice.model, chars: text.length });
    post({ type: 'speak', id, text, voice: { ...voice, mix: [...voice.mix] } });
  });
}

export function voiceThreadStats(): VoiceThreadStats {
  const now = performance.now();
  const recentMs = counters.recent.filter((r) => r.at >= now - BUSY_WINDOW_MS).reduce((n, r) => n + r.ms, 0);
  return {
    state: voiceStatus.state,
    models: { ...voiceStatus.models },
    loadMs: counters.loadMs,
    lines: counters.lines,
    queued: pending.size,
    lastMs: counters.lastMs,
    avgMs: counters.lines ? counters.totalMs / counters.lines : 0,
    lastModel: counters.lastModel,
    rtf: counters.audioSeconds ? counters.totalMs / 1000 / counters.audioSeconds : 0,
    busy: Math.min(1, recentMs / BUSY_WINDOW_MS),
    cachedClips: clips.size,
    cacheBytes: cache.bytes,
    cacheHits: cache.hits,
  };
}

/** Stops the worker and frees the models' memory (files stay in the browser cache). */
export function unloadVoice(): void {
  unload();
  voiceStatus.models = { paradee: 'off', kitten: 'off' };
  voiceStatus.progress = 0;
  summarise();
}

function unload(): void {
  worker?.terminate();
  worker = null;
  Object.assign(counters, { loadMs: 0, lines: 0, totalMs: 0, lastMs: 0, lastModel: '', audioSeconds: 0, recent: [] });
  for (const p of pending.values()) p.reject(new Error('voice unloaded'));
  pending.clear();
  for (const m of ['paradee', 'kitten'] as const) {
    waiters[m].forEach((w) => w.reject(new Error('voice unloaded')));
    waiters[m] = [];
  }
}

/** Whether a model keeps up: lines in time (a 2-second line within about 1.5 s) and smooth frames. */
export function benchVerdict(b: BenchResult): BenchVerdict {
  if (b.lineMs <= 1500 && b.worstFrameMs < 50) return 'good';
  if (b.lineMs <= 3000) return 'ok';
  return 'slow';
}

/**
 * "Test this computer": for each model, makes three typical lines while the scene keeps
 * drawing, and measures how fast speech is made and whether frames stay smooth. Both models
 * run on the CPU only (models this small gain nothing from the GPU, which the game needs).
 * KittenTTS (the grown-ups' voices) first, then Paradee (children's, and the fallback).
 */
export async function runBenchmark(): Promise<Partial<Record<VoiceModel, BenchResult>>> {
  voiceStatus.benchmarking = true;
  try {
    const results: Partial<Record<VoiceModel, BenchResult>> = {};
    for (const model of ['kitten', 'paradee'] as const) {
      try {
        results[model] = await benchModel(model);
      } catch {
        // A model that can't load has no result; the other's still counts.
      }
      voiceStatus.bench = { ...voiceStatus.bench, ...results };
    }
    try {
      localStorage.setItem(BENCH_KEY, JSON.stringify(voiceStatus.bench));
    } catch {
      // Storage unavailable; the result still shows for this session.
    }
    return results;
  } finally {
    voiceStatus.benchmarking = false;
  }
}

async function benchModel(model: VoiceModel): Promise<BenchResult> {
  await ensureVoice(model);
  const voice = BENCH_VOICES[model];
  await synthesize('Ready.', voice); // warm-up
  let worstFrameMs = 0;
  let last = performance.now();
  let watching = true;
  const watch = (t: number) => {
    worstFrameMs = Math.max(worstFrameMs, t - last);
    last = t;
    if (watching) requestAnimationFrame(watch);
  };
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(watch);
  });
  const runs: { ms: number; rtf: number }[] = [];
  try {
    for (const line of BENCH_LINES) {
      const start = performance.now();
      const samples = await synthesize(line, voice);
      const ms = performance.now() - start;
      runs.push({ ms, rtf: ms / 1000 / (samples.length / SAMPLE_RATE) });
    }
  } finally {
    watching = false;
  }
  const median = <T>(xs: T[], key: (x: T) => number) => xs.map(key).sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return {
    rtf: median(runs, (r) => r.rtf),
    lineMs: median(runs, (r) => r.ms),
    worstFrameMs,
    cores: navigator.hardwareConcurrency ?? 0,
    model: MODEL_IDS[model],
    date: new Date().toISOString(),
  };
}

/** Stored results still valid for these models and this computer (older single results are dropped). */
function readBench(): Partial<Record<VoiceModel, BenchResult>> {
  try {
    const stored = JSON.parse(localStorage.getItem(BENCH_KEY) ?? 'null') as Partial<Record<VoiceModel, BenchResult>> | null;
    const out: Partial<Record<VoiceModel, BenchResult>> = {};
    for (const m of ['paradee', 'kitten'] as const) {
      const b = stored?.[m];
      if (b && b.model === MODEL_IDS[m] && b.cores === (navigator.hardwareConcurrency ?? 0)) out[m] = b;
    }
    return out;
  } catch {
    return {};
  }
}

/** Unload when voices are switched off. */
$effect.root(() => {
  $effect(() => {
    if (!settings.voices && worker) unloadVoice();
  });
});
