/**
 * Kokoro-82M (onnx-community/Kokoro-82M-v1.0-ONNX) in ONNX Runtime Web (WASM, one thread), fed
 * by our phonemizer (Kokoro and Paradee share the Misaki alphabet and ids).
 *
 *   node kokoro.mjs bench <model.onnx>   session start, time per line, RTF, memory, determinism
 *   node kokoro.mjs render <model.onnx>  samples: stock voices, blends, a child-like setting
 *
 * A voice pack (`voices/<name>.bin`) is float32 [510][256]: one style vector per input length;
 * row `min(ids - 2, 509)` is the one for this line (as kokoro-js does). Blends mix packs linearly.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { LINES, WORK, misaki } from './lines.mjs';
import { hash, ort, resample, same, save, session, timed } from './harness.mjs';
import { editModel } from './model_edit.mjs';

const RATE = 24000;
const [mode = 'bench', modelPath = `${WORK}/dl/kokoro/onnx/model_quantized.onnx`] = process.argv.slice(2);
const pack = (name) => new Float32Array(readFileSync(`${WORK}/dl/kokoro/voices/${name}.bin`).buffer.slice(0));
const blend = (parts) => {
  const out = new Float32Array(510 * 256);
  for (const [name, w] of parts) pack(name).forEach((x, i) => (out[i] += w * x));
  return out;
};

// Kokoro-7M-Distill (oddadmix) keeps ONNX Runtime's random nodes: give it our deterministic noise
const small = modelPath.includes('kokoro7m');
const { s, ms: sessionMs, rssMB, bytes, gzBytes } = await session(modelPath, small ? (b) => editModel(b, { pitchNode: null }) : null);
const OUTDIR = small ? 'kokoro7m' : 'kokoro';

async function say(ids, voice, speed = 1) {
  const row = Math.min(Math.max(ids.length - 2, 0), 509);
  const out = await s.run({
    input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
    style: new ort.Tensor('float32', voice.slice(row * 256, row * 256 + 256), [1, 256]),
    speed: new ort.Tensor('float32', Float32Array.of(speed), [1]),
  });
  return new Float32Array(out.waveform.data);
}

if (mode === 'bench') {
  const report = { model: modelPath.split('/').pop(), sizeMB: bytes / 1e6, gzMB: gzBytes / 1e6, sessionMs, sessionRssMB: rssMB, lines: [] };
  const v = pack(small ? 'af_msa' : 'af_heart');
  for (const line of LINES) {
    const { ids } = await misaki(line);
    const { out, ms } = await timed(() => say(ids, v), 3);
    const again = await say(ids, v);
    const secs = out.length / RATE;
    report.lines.push({ line, audioS: secs, ms, rtf: secs / (ms / 1000), deterministic: same(out, again), hash: hash(out) });
  }
  report.rssAfterMB = process.memoryUsage().rss / 1e6;
  console.log(JSON.stringify(report, null, 1));
  writeFileSync(`${WORK}/samples/kokoro-bench-${report.model}.json`, JSON.stringify(report, null, 1));
} else {
  // [file name, voice parts, speed, depth (formant and pitch scale by resampling; 1 = none)]
  const voices = [
    ['af_msa', [['af_msa', 1]]],
    ['af_heart', [['af_heart', 1]]],
    ['af_bella', [['af_bella', 1]]],
    ['af_nicole', [['af_nicole', 1]]],
    ['bf_emma', [['bf_emma', 1]]],
    ['af_sarah', [['af_sarah', 1]]],
    ['am_michael', [['am_michael', 1]]],
    ['am_fenrir', [['am_fenrir', 1]]],
    ['am_puck', [['am_puck', 1]]],
    ['bm_george', [['bm_george', 1]]],
    ['bm_fable', [['bm_fable', 1]]],
    ['am_onyx', [['am_onyx', 1]]],
    // per-resident blends: two packs mixed
    ['f_blend_heart60_bella40', [['af_heart', 0.6], ['af_bella', 0.4]]],
    ['f_blend_sarah50_emma50', [['af_sarah', 0.5], ['bf_emma', 0.5]]],
    ['m_blend_michael50_fenrir50', [['am_michael', 0.5], ['am_fenrir', 0.5]]],
    ['m_blend_george70_puck30', [['bm_george', 0.7], ['am_puck', 0.3]]],
    // a child: a light female voice, a little faster, whole voice scaled up by resampling
    ['child_sky_up18', [['af_sky', 1]], 1.0, 1.18],
    ['child_nicole_up15', [['af_nicole', 0.5], ['af_sky', 0.5]], 1.0, 1.15],
  ];
  for (const [li, line] of LINES.entries()) {
    const { ids } = await misaki(line);
    for (const [name, parts, speed = 1, a = 1] of voices) {
      let y = await say(ids, blend(parts), speed / a);
      if (a !== 1) y = resample(y, RATE * a, RATE);
      save(OUTDIR, `${name}_line${li + 1}`, y, RATE);
    }
  }
  console.log('rendered', voices.length, 'voices');
}
