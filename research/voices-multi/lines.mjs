/**
 * The three test lines (from web/public/content/voice/en.json: short, median-ish, 90th percentile)
 * and our phonemizer (the production `voice_wasm` build) to turn them into Misaki phonemes and
 * Paradee/Kokoro ids. `WORK` is the scratch folder holding `wasm-pkg/` and `paradee-files/`.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const WORK = process.env.WORK ?? '/private/tmp/claude-501/-Users-virtual-Documents-Workspace-littlelives/75785d73-0e12-473b-84bc-432dd362b282/scratchpad/voices-multi';

export const LINES = ['Do I know you?', 'Pretty good, thanks for asking!', 'I had the strangest dream last night.'];

let voice = null;
export async function phonemizer() {
  if (voice) return voice;
  const { initSync, Voice } = await import(`${WORK}/wasm-pkg/voice_wasm.js`);
  initSync({ module: readFileSync(`${WORK}/wasm-pkg/voice_wasm_bg.wasm`) });
  const dir = `${WORK}/paradee-files/`;
  voice = new Voice(gunzipSync(readFileSync(dir + 'en-us.lexz')).toString(), readFileSync(dir + 'paradee-8m.json', 'utf8'));
  return voice;
}

/** Misaki phonemes and Paradee/Kokoro input ids (pads included) for a line. */
export async function misaki(text) {
  const v = await phonemizer();
  const inputs = v.inputs(text, 1, 1);
  const ids = BigInt64Array.from(inputs.ids);
  inputs.free();
  return { phonemes: v.phonemize(text), ids };
}

/** 16-bit mono WAV. */
export function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const line of LINES) {
    const { phonemes, ids } = await misaki(line);
    console.log(JSON.stringify({ line, phonemes, ids: [...ids].map(Number) }));
  }
}
