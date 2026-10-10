/**
 * Shared bits for the candidate benchmarks: ONNX Runtime Web (WASM build, SIMD, one thread, as
 * the production voice worker runs it) loaded from the scratch `node/` project, timing, memory,
 * WAV output and a windowed-sinc resampler (for "depth": formant scaling by resampling).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { WORK, wav } from './lines.mjs';

export const ort = createRequire(`${WORK}/node/package.json`)('onnxruntime-web');
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

export const OUT = `${WORK}/samples`;

/** `edit`: optional bytes -> bytes graph edit (e.g. deterministic noise) applied before loading. */
export async function session(path, edit = null) {
  const rss0 = process.memoryUsage().rss;
  const t = performance.now();
  const bytes = readFileSync(path);
  const s = await ort.InferenceSession.create(edit ? edit(bytes) : bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const ms = performance.now() - t;
  return { s, ms, rssMB: (process.memoryUsage().rss - rss0) / 1e6, bytes: bytes.length, gzBytes: gzipSync(bytes, { level: 9 }).length };
}

/** Runs `fn` once to warm up, then `n` times; returns the output of the last run and the median ms. */
export async function timed(fn, n = 3) {
  let out = await fn();
  const times = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    out = await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return { out, ms: times[Math.floor(times.length / 2)], first: times[0] };
}

export const hash = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 12);
export const same = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

/** Peak-normalised (to -1 dBFS) 16-bit WAV, so every sample plays at a similar level. */
export function save(dir, name, samples, rate) {
  mkdirSync(`${OUT}/${dir}`, { recursive: true });
  let peak = 1e-6;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  const g = 0.89 / peak;
  writeFileSync(`${OUT}/${dir}/${name}.wav`, wav(samples.map((x) => x * g), rate));
}

/**
 * Resamples `x` from `from` Hz to `to` Hz (Lanczos-windowed sinc, 16 zero crossings, low-passed
 * when going down). Played at `to`, a clip rendered at pitch P/a and speed s/a and then treated as
 * if it were sampled at to*a gives pitch P, speed s and formants scaled by a.
 */
export function resample(x, from, to) {
  const ratio = to / from;
  const n = Math.floor(x.length * ratio);
  const y = new Float32Array(n);
  const cutoff = Math.min(1, ratio);
  const zc = 16;
  const half = zc / cutoff;
  for (let i = 0; i < n; i++) {
    const t = i / ratio;
    let acc = 0;
    let wsum = 0;
    for (let k = Math.ceil(t - half); k <= Math.floor(t + half); k++) {
      if (k < 0 || k >= x.length) continue;
      const d = (t - k) * cutoff;
      const s = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const w = Math.abs(d) >= zc ? 0 : (d === 0 ? 1 : Math.sin((Math.PI * d) / zc) / ((Math.PI * d) / zc));
      acc += x[k] * s * w;
      wsum += s * w;
    }
    y[i] = wsum ? acc / wsum : 0; // unity gain at DC
  }
  return y;
}

export const fmt = (x, d = 0) => x.toFixed(d);
