// ONNX Runtime Web 1.30 (WASM SIMD backend, 1 thread) running Paradee-8M in Node/V8.
// node bench.mjs [model.onnx] [--fold-dq]
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';

const args = process.argv.slice(2);
const model = args.find((a) => !a.startsWith('--')) ?? '../../../web/public/voice/paradee-8m.onnx';
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';
const ids = JSON.parse(readFileSync(new URL('../out/ids.json', import.meta.url)));
const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
// Weight-only int8: ORT keeps DequantizeLinear for QDQ fusion unless told otherwise.
if (args.includes('--fold-dq')) opts.extra = { session: { disable_quant_qdq: '1' } };
let t = performance.now();
const s = await ort.InferenceSession.create(readFileSync(model), opts);
console.log(`${model}${args.includes('--fold-dq') ? ' (disable_quant_qdq)' : ''}: load ${(performance.now() - t).toFixed(0)} ms`);
for (const [line, tok] of Object.entries(ids)) {
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(tok.map(BigInt)), [1, tok.length]),
    speed: new ort.Tensor('float32', Float32Array.of(1), [1]),
  };
  let best = Infinity;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    t = performance.now();
    const out = await s.run(feeds);
    best = Math.min(best, performance.now() - t);
    n = out.waveform.data.length;
  }
  const audio = n / 24000;
  console.log(`${String(line.length).padStart(3)} chars  audio ${audio.toFixed(2)} s  ${best.toFixed(0)} ms  ${(audio / (best / 1000)).toFixed(1)}x RT`);
}
