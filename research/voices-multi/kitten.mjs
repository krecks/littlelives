/**
 * KittenTTS 0.8 (nano int8 / micro / mini; Apache-2.0) in ONNX Runtime Web (WASM, one thread).
 * Input as its legacy code builds it (kittenml/kittentts_legacy/onnx_model.py): espeak IPA,
 * split into words and punctuation and re-joined with spaces, mapped through its StyleTTS2
 * symbol table, then [0] + ids + [10, 0]; style row min(len(text), 399); 5000 samples trimmed.
 * The model gets our deterministic noise (model_edit.mjs; plus a pitch input where the graph has
 * the plain /F0_proj/Conv node).
 *
 *   node kitten.mjs nano|micro|mini|nanofp32|nanow8   bench + samples (espeak phonemes and ours)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { LINES, WORK, misaki } from './lines.mjs';
import { hash, ort, resample, same, save, timed } from './harness.mjs';
import { editModel } from './model_edit.mjs';
import { toEspeak } from './misaki_espeak.mjs';
import { gzipSync } from 'node:zlib';

const RATE = 24000;
const size = process.argv[2] ?? 'nano';
const dir = `${WORK}/dl/kitten-${size}`;
// nanofp32: the official fp32 nano; nanow8: that one through weight_int8.py
const file = `kitten_tts_${size.replace(/fp32|w8/, '')}_v0_8.onnx`;
const config = JSON.parse(readFileSync(`${dir}/config.json`, 'utf8'));
const ref = JSON.parse(readFileSync(`${WORK}/models/espeak_ref.json`, 'utf8'));
const table = new Map();
ref.kitten_symbols.forEach((s, i) => table.set(s, i)); // later duplicates win, as in the Python dict

const raw = readFileSync(`${dir}/${file}`);
let edited;
let hasPitch = true;
try {
  edited = editModel(raw);
} catch {
  edited = editModel(raw, { pitchNode: null });
  hasPitch = false;
}
const rss0 = process.memoryUsage().rss;
const t0 = performance.now();
const s = await ort.InferenceSession.create(edited, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const sessionMs = performance.now() - t0;
const sessionRssMB = (process.memoryUsage().rss - rss0) / 1e6;

const load = (name) => new Float32Array(readFileSync(`${dir}/voices/${name}.bin`).buffer.slice(0));
/** A voice, or a blend written `a*0.6+b*0.4` (style vectors mixed linearly). */
const pack = (spec) => {
  const out = new Float32Array(400 * 256);
  for (const part of spec.split('+')) {
    const [name, w = '1'] = part.split('*');
    load(name).forEach((x, i) => (out[i] += Number(w) * x));
  }
  return out;
};
const tokens = (ipa) => {
  const joined = (ipa.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) ?? []).join(' ');
  const ids = [0];
  for (const ch of joined) if (table.has(ch)) ids.push(table.get(ch));
  ids.push(10, 0);
  return BigInt64Array.from(ids.map(BigInt));
};

async function say(text, ipa, voice, speed = 1, pitch = 1) {
  const v = pack(voice);
  const row = Math.min(text.length, 399);
  const ids = tokens(ipa);
  const feeds = {
    input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
    style: new ort.Tensor('float32', v.slice(row * 256, row * 256 + 256), [1, 256]),
    speed: new ort.Tensor('float32', Float32Array.of(speed * (config.speed_priors?.[voice.split('*')[0]] ?? 1)), [1]),
  };
  if (hasPitch) feeds.pitch = new ort.Tensor('float32', Float32Array.of(pitch), [1]);
  const out = await s.run(feeds);
  const w = out.waveform.data;
  return new Float32Array(w.subarray(0, Math.max(0, w.length - 5000)));
}

const report = { model: `kitten-${size}`, sizeMB: raw.length / 1e6, gzMB: gzipSync(raw, { level: 9 }).length / 1e6, sessionMs, sessionRssMB, hasPitch, lines: [] };
for (const line of LINES) {
  const ipa = toEspeak((await misaki(line)).phonemes);
  const { out, ms } = await timed(() => say(line, ipa, 'expr-voice-2-f'), 3);
  const again = await say(line, ipa, 'expr-voice-2-f');
  const secs = out.length / RATE;
  report.lines.push({ line, ipa, audioS: secs, ms, rtf: secs / (ms / 1000), deterministic: same(out, again), hash: hash(out) });
}
report.rssAfterMB = process.memoryUsage().rss / 1e6;
console.log(JSON.stringify(report, null, 1));
writeFileSync(`${WORK}/samples/kitten-bench-${size}.json`, JSON.stringify(report, null, 1));

const names = { 'expr-voice-2-f': 'f_bella', 'expr-voice-3-f': 'f_luna', 'expr-voice-4-f': 'f_rosie', 'expr-voice-5-f': 'f_kiki', 'expr-voice-2-m': 'm_jasper', 'expr-voice-3-m': 'm_bruno', 'expr-voice-4-m': 'm_hugo', 'expr-voice-5-m': 'm_leo' };
for (const [li, line] of LINES.entries()) {
  const ours = toEspeak((await misaki(line)).phonemes);
  for (const [voice, name] of Object.entries(names)) {
    save(`kitten-${size}`, `${name}_line${li + 1}`, await say(line, ours, voice), RATE);
    save(`kitten-${size}-espeak`, `${name}_line${li + 1}`, await say(line, ref.lines[line], voice), RATE);
  }
  // child-like: Kiki scaled up by resampling (pitch and formants x1.15)
  const a = 1.15;
  save(`kitten-${size}`, `child_kiki_up15_line${li + 1}`, resample(await say(line, ours, 'expr-voice-5-f', 1 / a), RATE * a, RATE), RATE);
}
console.log('rendered');

// More voices from the eight: blends of two style vectors, and the pitch input (nano only).
// [file name, voice spec, pitch]
const variety = [
  ['m_blend_bruno50_hugo50', 'expr-voice-3-m*0.5+expr-voice-4-m*0.5', 1],
  ['m_blend_jasper70_leo30', 'expr-voice-2-m*0.7+expr-voice-5-m*0.3', 1],
  ['m_blend_leo50_bruno50', 'expr-voice-5-m*0.5+expr-voice-3-m*0.5', 1],
  ['m_hugo_pitch088', 'expr-voice-4-m', 0.88],
  ['m_jasper_pitch112', 'expr-voice-2-m', 1.12],
  ['f_blend_luna50_rosie50', 'expr-voice-3-f*0.5+expr-voice-4-f*0.5', 1],
  ['f_blend_bella60_luna40', 'expr-voice-2-f*0.6+expr-voice-3-f*0.4', 1],
  ['f_luna_pitch112', 'expr-voice-3-f', 1.12],
  ['f_rosie_pitch090', 'expr-voice-4-f', 0.9],
];
if (hasPitch) {
  for (const [li, line] of LINES.entries()) {
    const ours = toEspeak((await misaki(line)).phonemes);
    for (const [name, spec, pitch] of variety) save(`kitten-${size}-variety`, `${name}_line${li + 1}`, await say(line, ours, spec, 1, pitch), RATE);
    for (const [voice, name] of Object.entries(names)) save(`kitten-${size}-variety`, `${name}_line${li + 1}`, await say(line, ours, voice), RATE);
  }
  console.log('rendered variety');
}
