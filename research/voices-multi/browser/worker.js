// Voice worker for the benchmark page: one model, one execution provider (WASM one thread, or
// WebGPU), like web/src/voice/tts.worker.ts. Messages: {load: {model, ep}} then {run: index}.
import * as ort from '/ort/ort.webgpu.min.mjs';

ort.env.wasm.numThreads = Number(new URL(self.location.href).searchParams.get('threads') ?? 1);
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = '/ort/';
ort.env.logLevel = new URL(self.location.href).searchParams.get('log') ?? 'error';

const MODELS = {
  paradee: { url: '/paradee-files/paradee-8m-edit1.onnx', kind: 'paradee', rate: 24000 },
  'kitten-nano-w8': { url: '/browser/kitten-nano-w8.onnx', kind: 'kitten', rate: 24000 },
  'piper-libritts_r-w8': { url: '/browser/piper-libritts_r-w8.onnx', kind: 'piper', rate: 22050 },
  kokoro7m: { url: '/browser/kokoro7m.onnx', kind: 'kokoro7m', rate: 24000 },
  'kokoro-q8': { url: '/dl/kokoro/onnx/model_quantized.onnx', kind: 'kokoro', rate: 24000 },
  'kokoro-fp32': { url: '/dl/kokoro/onnx/model.onnx', kind: 'kokoro', rate: 24000 },
  'kokoro-fp16': { url: '/dl/kokoro/onnx/model_fp16.onnx', kind: 'kokoro', rate: 24000 },
  'kokoro-q4f16': { url: '/dl/kokoro/onnx/model_q4f16.onnx', kind: 'kokoro', rate: 24000 },
};

let session = null;
let model = null;
let inputs = null;

function feeds(i) {
  const L = inputs[i];
  const i64 = (a) => new ort.Tensor('int64', BigInt64Array.from(a.map(BigInt)), [1, a.length]);
  const f32 = (a, dims) => new ort.Tensor('float32', Float32Array.from(a), dims);
  switch (model.kind) {
    case 'paradee':
      return { input_ids: i64(L.misaki), speed: f32([1], [1]), pitch: f32([1], [1]) };
    case 'kokoro':
      return { input_ids: i64(L.misaki), style: f32(L.kokoroStyle, [1, 256]), speed: f32([1], [1]) };
    case 'kokoro7m':
      return { input_ids: i64(L.misaki), style: f32(L.msaStyle, [1, 256]), speed: f32([1], [1]) };
    case 'kitten':
      return { input_ids: i64(L.kitten), style: f32(L.kittenStyle, [1, 256]), speed: f32([0.8], [1]), pitch: f32([1], [1]) };
    case 'piper':
      return {
        input: i64(L.piper),
        input_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(L.piper.length)), [1]),
        scales: f32([0.667, 1, 0.8], [3]),
        sid: new ort.Tensor('int64', BigInt64Array.of(48n), [1]),
      };
  }
}

async function hash(a) {
  const d = await crypto.subtle.digest('SHA-256', a.buffer);
  return [...new Uint8Array(d).slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

self.onmessage = async ({ data }) => {
  try {
    if (data.load) {
      model = MODELS[data.load.model];
      inputs = await (await fetch('/browser/inputs.json')).json();
      const bytes = new Uint8Array(await (await fetch(model.url)).arrayBuffer());
      const t = performance.now();
      session = await ort.InferenceSession.create(bytes, { executionProviders: [data.load.ep], graphOptimizationLevel: 'all' });
      const ms = performance.now() - t;
      let adapter = null;
      if (data.load.ep === 'webgpu' && navigator.gpu) {
        const a = await navigator.gpu.requestAdapter();
        adapter = a?.info ? `${a.info.vendor} ${a.info.architecture} ${a.info.description}` : 'unknown';
      }
      self.postMessage({ loaded: { ms, bytes: bytes.length, adapter } });
    } else if ('run' in data) {
      const t = performance.now();
      const out = await session.run(feeds(data.run));
      const ms = performance.now() - t;
      const wave = new Float32Array(Object.values(out)[0].data);
      self.postMessage({ ran: { i: data.run, ms, audioS: wave.length / model.rate, hash: await hash(wave) } });
    }
  } catch (e) {
    self.postMessage({ error: String(e?.stack ?? e) });
  }
};
