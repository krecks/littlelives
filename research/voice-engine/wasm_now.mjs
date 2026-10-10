// The production voice WASM (tract) in Node/V8, one thread: per-line time for the test lines,
// and the first sentence alone (streaming option (a): sentence chunking).
// node wasm_now.mjs   (needs web/src/voice/wasm-pkg and web/public/voice)
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { initSync, Voice } from '../../web/src/voice/wasm-pkg/voice_wasm.js';

const dir = new URL('../../web/public/voice/', import.meta.url);
initSync({ module: readFileSync(new URL('../../web/src/voice/wasm-pkg/voice_wasm_bg.wasm', import.meta.url)) });
let t = performance.now();
const voice = new Voice(
  gunzipSync(readFileSync(new URL('en-us.lexz', dir))).toString(),
  readFileSync(process.env.MODEL ?? new URL('paradee-8m.onnx', dir)),
  readFileSync(new URL('paradee-8m.json', dir), 'utf8'),
);
console.log(`load ${(performance.now() - t).toFixed(0)} ms`);
const LINES = [
  'Hello there!',
  "Oh, you won't believe it!",
  "Hello there! I don't think we've met.",
  "I'm so hungry, I could eat a whole pizza by myself.",
  'What a lovely garden! I should water the roses before it gets too dark.',
];
voice.speak('Warm up.', 1, 1);
for (const line of LINES) {
  const times = [];
  let samples = 0;
  for (let i = 0; i < 3; i++) {
    t = performance.now();
    samples = voice.speak(line, 1, 1).length;
    times.push(performance.now() - t);
  }
  const ms = Math.min(...times);
  const audio = samples / 24000;
  let first = '';
  const m = line.match(/^.*?[.!?](?=\s)/);
  if (m) {
    const ft = [];
    for (let i = 0; i < 3; i++) {
      t = performance.now();
      voice.speak(m[0], 1, 1);
      ft.push(performance.now() - t);
    }
    first = `  first sentence "${m[0]}" ${Math.min(...ft).toFixed(0)} ms`;
  }
  console.log(`${String(line.length).padStart(3)} chars  audio ${audio.toFixed(2)} s  ${ms.toFixed(0)} ms  ${(audio / (ms / 1000)).toFixed(1)}x RT${first}`);
}
