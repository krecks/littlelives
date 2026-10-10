/**
 * Piper multi-speaker VITS voices (rhasspy/piper-voices) in ONNX Runtime Web (WASM, one thread),
 * weight-only int8 (weight_int8.py), with our deterministic noise (model_edit.mjs). Input: espeak
 * IPA (our Misaki phonemes mapped by misaki_espeak.mjs, or espeak's own for comparison) through
 * the voice's phoneme_id_map: ^, then each phoneme followed by the pad _, then $.
 *
 *   node piper.mjs scan <name> [count]             line 3 for speakers 0..count-1 (to pick by F0)
 *   node piper.mjs render <name> <label=sid> ...   bench + samples for chosen speakers
 *
 * <name>: en_US-libritts_r-medium | en_US-libritts-high | en_GB-vctk-medium (models/piper/).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { LINES, WORK, misaki } from './lines.mjs';
import { hash, ort, same, save, timed } from './harness.mjs';
import { editModel } from './model_edit.mjs';
import { toEspeak } from './misaki_espeak.mjs';

const [mode, name, ...rest] = process.argv.slice(2);
const config = JSON.parse(readFileSync(`${WORK}/models/piper/${name}.json`, 'utf8'));
const RATE = config.audio.sample_rate;
const map = config.phoneme_id_map;
const ref = JSON.parse(readFileSync(`${WORK}/models/espeak_ref.json`, 'utf8')).lines;
const raw = readFileSync(`${WORK}/models/piper/${name}.w8.onnx`);
const rss0 = process.memoryUsage().rss;
const t0 = performance.now();
const s = await ort.InferenceSession.create(editModel(raw, { pitchNode: null }), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const sessionMs = performance.now() - t0;
const sessionRssMB = (process.memoryUsage().rss - rss0) / 1e6;

function ids(ipa) {
  const out = [...map['^'], ...map['_']];
  for (const ch of ipa.normalize('NFD')) {
    if (!map[ch]) continue;
    out.push(...map[ch], ...map['_']);
  }
  out.push(...map['$']);
  return BigInt64Array.from(out.map(BigInt));
}

async function say(ipa, sid, lengthScale = 1) {
  const x = ids(ipa);
  const { noise_scale, noise_w } = config.inference;
  const out = await s.run({
    input: new ort.Tensor('int64', x, [1, x.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(x.length)), [1]),
    scales: new ort.Tensor('float32', Float32Array.of(noise_scale, lengthScale, noise_w), [3]),
    sid: new ort.Tensor('int64', BigInt64Array.of(BigInt(sid)), [1]),
  });
  return new Float32Array(Object.values(out)[0].data);
}

const ours = async (line) => toEspeak((await misaki(line)).phonemes);

if (mode === 'scan') {
  const count = Number(rest[0] ?? 60);
  const ipa = await ours(LINES[2]);
  for (let sid = 0; sid < Math.min(count, config.num_speakers); sid++) save(`piper-scan-${name}`, `s${sid}_line3`, await say(ipa, sid), RATE);
  console.log('scanned', count);
} else {
  const voices = rest.map((r) => r.split('='));
  const report = { model: name, sizeMB: raw.length / 1e6, gzMB: gzipSync(raw, { level: 9 }).length / 1e6, sessionMs, sessionRssMB, lines: [] };
  for (const line of LINES) {
    const ipa = await ours(line);
    const { out, ms } = await timed(() => say(ipa, Number(voices[0][1])), 3);
    const again = await say(ipa, Number(voices[0][1]));
    const secs = out.length / RATE;
    report.lines.push({ line, audioS: secs, ms, rtf: secs / (ms / 1000), deterministic: same(out, again), hash: hash(out) });
  }
  report.rssAfterMB = process.memoryUsage().rss / 1e6;
  console.log(JSON.stringify(report, null, 1));
  writeFileSync(`${WORK}/samples/piper-bench-${name}.json`, JSON.stringify(report, null, 1));
  for (const [li, line] of LINES.entries()) {
    const ipa = await ours(line);
    for (const [label, sid] of voices) {
      save(`piper-${name}`, `${label}_line${li + 1}`, await say(ipa, Number(sid)), RATE);
      if (li === 2) save(`piper-${name}-espeak`, `${label}_line${li + 1}`, await say(ref[line], Number(sid)), RATE);
    }
  }
  console.log('rendered');
}
