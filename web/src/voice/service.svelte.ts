/**
 * The voice engine for the whole app (settings preview, benchmark, the game): one worker,
 * started the first time it is needed, with a status the settings screen shows.
 */

import { settings } from '../settings/settings.svelte';
import { SAMPLE_RATE, type FromVoiceWorker, type ToVoiceWorker } from './protocol';
import type { VoiceParams } from './voices';

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

/** How the voice worker is doing (for the debug overlay). */
export interface VoiceThreadStats {
  state: 'off' | 'loading' | 'ready' | 'error';
  /** Time to load the engine, ms (0 until ready). */
  loadMs: number;
  /** Lines made since the engine started, and lines waiting to be made. */
  lines: number;
  queued: number;
  /** Time to make a line, last and average, ms. */
  lastMs: number;
  avgMs: number;
  /** Generation time ÷ audio length over all lines (lower is faster). */
  rtf: number;
  /** Share of the last few seconds the worker spent making speech, 0..1. */
  busy: number;
}

export const voiceStatus = $state({
  state: 'off' as 'off' | 'loading' | 'ready' | 'error',
  /** Download progress 0..1 while loading. */
  progress: 0,
  error: '',
  benchmarking: false,
  bench: readBench(),
});

const BENCH_KEY = 'littlelives.voiceBench';
const MODEL_ID = 'paradee-8m@f662642';
const BENCH_LINES = [
  'Hello there!',
  "I'm so hungry, I could eat a whole pizza by myself.",
  'What a lovely garden. I should water the roses before it gets dark.',
];

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (s: Float32Array) => void; reject: (e: Error) => void }>();
let readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
/** Counters behind `voiceThreadStats` (not reactive: read by the overlay's timer). */
const BUSY_WINDOW_MS = 5000;
const counters = { loadMs: 0, lines: 0, totalMs: 0, lastMs: 0, audioSeconds: 0, recent: [] as { at: number; ms: number }[] };

function post(msg: ToVoiceWorker): void {
  worker?.postMessage(msg);
}

function onMessage(msg: FromVoiceWorker): void {
  if (msg.type === 'progress') {
    voiceStatus.progress = msg.total ? msg.loaded / msg.total : 0;
  } else if (msg.type === 'ready') {
    counters.loadMs = msg.ms;
    voiceStatus.state = 'ready';
    voiceStatus.progress = 1;
    readyWaiters.forEach((w) => w.resolve());
    readyWaiters = [];
  } else if (msg.type === 'audio') {
    const now = performance.now();
    counters.lines++;
    counters.totalMs += msg.ms;
    counters.lastMs = msg.ms;
    counters.audioSeconds += msg.samples.length / SAMPLE_RATE;
    counters.recent.push({ at: now, ms: msg.ms });
    while (counters.recent.length && counters.recent[0].at < now - BUSY_WINDOW_MS) counters.recent.shift();
    pending.get(msg.id)?.resolve(msg.samples);
    pending.delete(msg.id);
  } else if (msg.type === 'error') {
    if (msg.id !== undefined) {
      pending.get(msg.id)?.reject(new Error(msg.message));
      pending.delete(msg.id);
      return;
    }
    voiceStatus.state = 'error';
    voiceStatus.error = msg.message;
    readyWaiters.forEach((w) => w.reject(new Error(msg.message)));
    readyWaiters = [];
    unload();
  }
}

/** Starts the worker and the download if needed; resolves when the engine can speak. */
export function ensureVoice(): Promise<void> {
  if (voiceStatus.state === 'ready' && worker) return Promise.resolve();
  if (!worker) {
    worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromVoiceWorker>) => onMessage(e.data);
    worker.onerror = (e) => onMessage({ type: 'error', message: e.message || 'voice worker failed' });
    voiceStatus.state = 'loading';
    voiceStatus.progress = 0;
    voiceStatus.error = '';
    post({ type: 'load', base: import.meta.env.BASE_URL, language: settings.voiceLanguage });
  }
  return new Promise((resolve, reject) => readyWaiters.push({ resolve, reject }));
}

/** Audio for one line (24 kHz mono). Lines are made one after another in the worker. */
export async function synthesize(text: string, voice: VoiceParams): Promise<Float32Array> {
  await ensureVoice();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post({ type: 'speak', id, text, speed: voice.speed, pitch: voice.pitch });
  });
}

export function voiceThreadStats(): VoiceThreadStats {
  const now = performance.now();
  const recentMs = counters.recent.filter((r) => r.at >= now - BUSY_WINDOW_MS).reduce((n, r) => n + r.ms, 0);
  return {
    state: voiceStatus.state,
    loadMs: counters.loadMs,
    lines: counters.lines,
    queued: pending.size,
    lastMs: counters.lastMs,
    avgMs: counters.lines ? counters.totalMs / counters.lines : 0,
    rtf: counters.audioSeconds ? counters.totalMs / 1000 / counters.audioSeconds : 0,
    busy: Math.min(1, recentMs / BUSY_WINDOW_MS),
  };
}

/** Stops the worker and frees the model's memory (files stay in the browser cache). */
export function unloadVoice(): void {
  unload();
  voiceStatus.state = 'off';
  voiceStatus.progress = 0;
}

function unload(): void {
  worker?.terminate();
  worker = null;
  Object.assign(counters, { loadMs: 0, lines: 0, totalMs: 0, lastMs: 0, audioSeconds: 0, recent: [] });
  for (const p of pending.values()) p.reject(new Error('voice unloaded'));
  pending.clear();
}

export function benchVerdict(b: BenchResult): BenchVerdict {
  if (b.rtf <= 0.33 && b.worstFrameMs < 50) return 'good';
  if (b.rtf <= 0.6) return 'ok';
  return 'slow';
}

/**
 * "Test this computer": makes three typical lines while the scene keeps drawing, and measures
 * how fast speech is made and whether frames stay smooth. Paradee runs on the CPU only (a
 * model this small gains nothing from the GPU), so there is one mode to measure.
 */
export async function runBenchmark(): Promise<BenchResult> {
  voiceStatus.benchmarking = true;
  try {
    await ensureVoice();
    await synthesize('Ready.', { speed: 1, pitch: 1 }); // warm-up
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
    for (const line of BENCH_LINES) {
      const start = performance.now();
      const samples = await synthesize(line, { speed: 1, pitch: 1 });
      const ms = performance.now() - start;
      runs.push({ ms, rtf: ms / 1000 / (samples.length / SAMPLE_RATE) });
    }
    watching = false;
    const median = <T>(xs: T[], key: (x: T) => number) => xs.map(key).sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const result: BenchResult = {
      rtf: median(runs, (r) => r.rtf),
      lineMs: median(runs, (r) => r.ms),
      worstFrameMs,
      cores: navigator.hardwareConcurrency ?? 0,
      model: MODEL_ID,
      date: new Date().toISOString(),
    };
    voiceStatus.bench = result;
    try {
      localStorage.setItem(BENCH_KEY, JSON.stringify(result));
    } catch {
      // Storage unavailable; the result still shows for this session.
    }
    return result;
  } finally {
    voiceStatus.benchmarking = false;
  }
}

function readBench(): BenchResult | null {
  try {
    const b = JSON.parse(localStorage.getItem(BENCH_KEY) ?? 'null') as BenchResult | null;
    return b && b.model === MODEL_ID && b.cores === (navigator.hardwareConcurrency ?? 0) ? b : null;
  } catch {
    return null;
  }
}

/** Unload when voices are switched off. */
$effect.root(() => {
  $effect(() => {
    if (!settings.voices && worker) unloadVoice();
  });
});
