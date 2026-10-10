/**
 * Prepares the Chrome benchmark (browser/run.mjs): deterministic model files and every model's
 * inputs for the three lines (`<WORK>/browser/inputs.json`), so the page needs no phonemizer.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LINES, WORK, misaki } from '../lines.mjs';
import { editModel } from '../model_edit.mjs';
import { toEspeak } from '../misaki_espeak.mjs';

const out = `${WORK}/browser`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/kitten-nano-w8.onnx`, editModel(readFileSync(`${WORK}/dl/kitten-nanow8/kitten_tts_nano_v0_8.onnx`)));
writeFileSync(`${out}/piper-libritts_r-w8.onnx`, editModel(readFileSync(`${WORK}/models/piper/en_US-libritts_r-medium.w8.onnx`), { pitchNode: null }));
writeFileSync(`${out}/kokoro7m.onnx`, editModel(readFileSync(`${WORK}/dl/kokoro7m/model.onnx`), { pitchNode: null }));

const kitten = JSON.parse(readFileSync(`${WORK}/models/espeak_ref.json`, 'utf8')).kitten_symbols;
const ktable = new Map();
kitten.forEach((s, i) => ktable.set(s, i));
const piper = JSON.parse(readFileSync(`${WORK}/models/piper/en_US-libritts_r-medium.json`, 'utf8')).phoneme_id_map;
const heart = new Float32Array(readFileSync(`${WORK}/dl/kokoro/voices/af_heart.bin`).buffer.slice(0));
const msa = new Float32Array(readFileSync(`${WORK}/dl/kokoro/voices/af_msa.bin`).buffer.slice(0));
const bella = new Float32Array(readFileSync(`${WORK}/dl/kitten-nano/voices/expr-voice-2-f.bin`).buffer.slice(0));

const lines = [];
for (const line of LINES) {
  const { ids } = await misaki(line);
  const ipa = toEspeak((await misaki(line)).phonemes);
  const kt = [0];
  for (const ch of (ipa.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) ?? []).join(' ')) if (ktable.has(ch)) kt.push(ktable.get(ch));
  kt.push(10, 0);
  const pt = [...piper['^'], ...piper['_']];
  for (const ch of ipa.normalize('NFD')) if (piper[ch]) pt.push(...piper[ch], ...piper['_']);
  pt.push(...piper['$']);
  const row = Math.min(ids.length - 2, 509);
  const krow = Math.min(line.length, 399);
  lines.push({
    line,
    misaki: [...ids].map(Number),
    kokoroStyle: [...heart.slice(row * 256, row * 256 + 256)],
    msaStyle: [...msa.slice(row * 256, row * 256 + 256)],
    kitten: kt,
    kittenStyle: [...bella.slice(krow * 256, krow * 256 + 256)],
    piper: pt,
  });
}
writeFileSync(`${out}/inputs.json`, JSON.stringify(lines));
console.log('prepared', out);
