/**
 * Does letting ONNX Runtime fold the weight DequantizeLinear nodes at load (session config
 * `session.disable_quant_qdq = 1`) speed up weight-only int8 models in ORT Web WASM? Times line 3
 * with and without, and checks the audio is unchanged.
 *
 * Usage: node qdq_fold.mjs model.onnx [kokoro|kitten|paradee]
 */
import { readFileSync } from 'node:fs';
import { LINES, misaki } from './lines.mjs';
import { ort, same, timed } from './harness.mjs';
import { editModel } from './model_edit.mjs';

const [path, kind = 'paradee'] = process.argv.slice(2);
let bytes = readFileSync(path);
if (kind === 'kitten') bytes = editModel(bytes);
const { ids } = await misaki(LINES[2]);
const feeds = () => {
  const f = { input_ids: new ort.Tensor('int64', ids, [1, ids.length]), speed: new ort.Tensor('float32', Float32Array.of(1), [1]) };
  if (kind !== 'kokoro') f.pitch = new ort.Tensor('float32', Float32Array.of(1), [1]);
  if (kind !== 'paradee') f.style = new ort.Tensor('float32', new Float32Array(256).fill(0.05), [1, 256]);
  return f;
};
const results = [];
for (const extra of [{}, { session: { disable_quant_qdq: '1' } }]) {
  const t = performance.now();
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', extra });
  const load = performance.now() - t;
  const { out, ms } = await timed(async () => new Float32Array((await s.run(feeds())).waveform.data), 3);
  results.push(out);
  console.log(`${JSON.stringify(extra)}: load ${load.toFixed(0)} ms, line 3 ${ms.toFixed(0)} ms, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
}
console.log('same audio:', same(results[0], results[1]));
