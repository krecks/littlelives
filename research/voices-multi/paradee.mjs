/**
 * Paradee-8M in ONNX Runtime Web (WASM, one thread):
 *  1. benchmark (session start, time per line, real-time factor, memory, determinism);
 *  2. today's resident voices (pitch and speed only, ranges of web/src/voice/voices.ts);
 *  3. the same with "depth" (formants scaled by resampling, like the design doc's plan);
 *  4. its own style vectors (ts.style 1x32, ds.style 1x16) perturbed: can they make new voices?
 *
 * Needs models/paradee-style.onnx from paradee_style.py. Usage: node paradee.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { LINES, WORK, misaki } from './lines.mjs';
import { fmt, hash, ort, resample, same, save, session, timed } from './harness.mjs';

const RATE = 24000;
const base = await session(`${WORK}/paradee-files/paradee-8m-edit1.onnx`);
const styled = await session(`${WORK}/models/paradee-style.onnx`);
const orig = JSON.parse(readFileSync(`${WORK}/models/paradee-style.json`, 'utf8'));

async function say(s, ids, pitch = 1, speed = 1, style = null) {
  const feeds = {
    input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
    speed: new ort.Tensor('float32', Float32Array.of(speed), [1]),
    pitch: new ort.Tensor('float32', Float32Array.of(pitch), [1]),
  };
  if (style) {
    feeds['ts.style'] = new ort.Tensor('float32', Float32Array.from(style.ts), [1, 32]);
    feeds['ds.style'] = new ort.Tensor('float32', Float32Array.from(style.ds), [1, 16]);
  }
  const out = await s.run(feeds);
  return new Float32Array(out.waveform.data);
}

/** Pitch P, speed s, formants x a: render at P/a, s/a and play the result a times faster. */
async function sayDeep(s, ids, pitch, speed, a, style) {
  const y = await say(s, ids, pitch / a, speed / a, style);
  return a === 1 ? y : resample(y, RATE * a, RATE);
}

// 1. benchmark
const report = { model: 'paradee-8m-edit1 (int8)', sizeMB: base.bytes / 1e6, gzMB: base.gzBytes / 1e6, sessionMs: base.ms, sessionRssMB: base.rssMB, lines: [] };
for (const line of LINES) {
  const { ids } = await misaki(line);
  const { out, ms } = await timed(() => say(base.s, ids), 5);
  const again = await say(base.s, ids);
  const secs = out.length / RATE;
  report.lines.push({ line, chars: line.length, audioS: secs, ms, rtf: secs / (ms / 1000), deterministic: same(out, again), hash: hash(out) });
}
report.rssAfterMB = process.memoryUsage().rss / 1e6;
console.log(JSON.stringify(report, null, 1));

// 2 + 3. resident voices: [name, pitch, speed, depth]
const residents = [
  ['f1', 0.94, 1.0, 1.04],
  ['f2', 1.04, 0.95, 1.0],
  ['f3', 1.14, 1.06, 0.98],
  ['m1', 0.6, 0.96, 0.84],
  ['m2', 0.66, 1.04, 0.87],
  ['m3', 0.71, 0.92, 0.9],
  ['child', 1.35, 1.04, 1.2],
];
for (const [li, line] of LINES.entries()) {
  const { ids } = await misaki(line);
  for (const [name, p, sp, a] of residents) {
    save('paradee-today', `${name}_line${li + 1}`, await say(base.s, ids, p, sp), RATE);
    save('paradee-depth', `${name}_line${li + 1}`, await sayDeep(base.s, ids, p, sp, a), RATE);
  }
}

// 4. style perturbations, line 3, pitch 1 (no other change)
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}
const norm = (v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
function randomLike(v, seed) {
  const r = rng(seed);
  const d = v.map(() => gauss(r));
  const k = norm(v) / norm(d);
  return d.map((x) => x * k);
}
const T = orig['ts.style'];
const D = orig['ds.style'];
const styles = {
  original: { ts: T, ds: D },
  ds_zero: { ts: T, ds: D.map(() => 0) },
  ds_x2: { ts: T, ds: D.map((x) => 2 * x) },
  ds_neg: { ts: T, ds: D.map((x) => -x) },
  ts_zero: { ts: T.map(() => 0), ds: D },
  ts_neg: { ts: T.map((x) => -x), ds: D },
  ds_rand1: { ts: T, ds: randomLike(D, 1) },
  ds_rand2: { ts: T, ds: randomLike(D, 2) },
  ds_rand3: { ts: T, ds: randomLike(D, 3) },
  ds_half_rand1: { ts: T, ds: D.map((x, i) => 0.5 * x + 0.5 * randomLike(D, 1)[i]) },
  both_rand4: { ts: randomLike(T, 4), ds: randomLike(D, 4) },
};
const { ids } = await misaki(LINES[2]);
const check = await say(styled.s, ids, 1, 1, styles.original);
console.log('style-input model equals base with original style:', same(check, await say(base.s, ids)));
for (const [name, st] of Object.entries(styles)) save('paradee-style', `${name}_line3`, await say(styled.s, ids, 1, 1, st), RATE);
writeFileSync(`${WORK}/samples/paradee-bench.json`, JSON.stringify(report, null, 1));
console.log('wrote', `${WORK}/samples/paradee-*`, fmt(process.memoryUsage().rss / 1e6), 'MB rss');
