#!/usr/bin/env node
/**
 * Fetches the resident voice model and builds the pronunciation dictionary into
 * `web/public/voice/` (not in git; see docs/design/voices.md).
 *
 * - KittenTTS nano 0.8 (Apache-2.0): https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32
 * - Misaki's US English dictionaries (Apache-2.0): https://github.com/hexgrad/misaki
 *
 * Everything is pinned to a revision and checked against its SHA-256, so every build speaks the
 * same. The model is edited after download (`model.mjs`: a `pitch` input, deterministic noise and
 * its float weights stored as int8) and its voices are packed into one raw float file; every result is pinned by its own SHA-256 too. Files already present with
 * the right hash are kept. Usage: `node tools/voice/fetch.mjs`.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { editModel, quantizeWeights } from './model.mjs';
import { readNpz } from './npz.mjs';

const OUT = fileURLToPath(new URL('../../web/public/voice/', import.meta.url));

const KITTEN = 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32/resolve/7a1db645b1f3ab9420761d87428e042b9cec3f26';
const MISAKI = 'https://raw.githubusercontent.com/hexgrad/misaki/fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data';

/**
 * KittenTTS's voices in the order `web/src/voice/voices.ts` numbers them (`KITTEN_VOICES`): the
 * four women's, then the four men's. Each is a table of style vectors, one per text length;
 * lines are short, so only the first `KITTEN_ROWS` rows are kept (longer text uses the last).
 */
const KITTEN_VOICE_IDS = ['expr-voice-2-f', 'expr-voice-3-f', 'expr-voice-4-f', 'expr-voice-5-f', 'expr-voice-2-m', 'expr-voice-3-m', 'expr-voice-4-m', 'expr-voice-5-m'];
const KITTEN_ROWS = 128;
const STYLE = 256;

/** `voices.npz` to one little-endian float32 array [voice][row][256]. */
function packKittenVoices(bytes) {
  const voices = readNpz(bytes);
  const out = new Float32Array(KITTEN_VOICE_IDS.length * KITTEN_ROWS * STYLE);
  KITTEN_VOICE_IDS.forEach((id, v) => {
    const a = voices[id];
    if (!a || a.shape[1] !== STYLE || a.shape[0] < KITTEN_ROWS) throw new Error(`voices.npz: ${id} missing or shaped ${a?.shape}`);
    out.set(a.data.subarray(0, KITTEN_ROWS * STYLE), v * KITTEN_ROWS * STYLE);
  });
  return new Uint8Array(out.buffer);
}

/**
 * `edit`: applied to the downloaded bytes; `sha256` pins the download, `editedSha256` the result.
 * The edited model's name carries the edit's version, so browsers never reuse an older copy.
 */
const FILES = [
  {
    url: `${KITTEN}/kitten_tts_nano_v0_8.onnx`,
    out: 'kitten-nano-0.8-edit2.onnx',
    sha256: '320564d2615f235de972ca27a7f39551c94185cfa24ca85b07a29084135f1e5e',
    edit: (bytes) => editModel(quantizeWeights(bytes)),
    editedSha256: '251899772c73278b76b95d256a22a539bc4bc2a39a58e4a619bf8fead2f2836c',
  },
  {
    url: `${KITTEN}/voices.npz`,
    out: 'kitten-nano-0.8-voices.f32',
    sha256: '8aa7cee235abb0739cb51e6559685f65a4dacd95568833d05699b1633f519b3f',
    edit: packKittenVoices,
    editedSha256: 'd85d3d0b44cc56574cc53058080292a357406ae161fafb10b3b8cae3d2f45192',
  },
];
/** Files earlier versions wrote that are no longer used (they would be copied into the build). */
const OBSOLETE = ['paradee-8m.onnx', 'paradee-8m-edit1.onnx', 'paradee-8m.json', 'kitten-nano-0.8-edit1.onnx'];
const LEXICON = [
  { url: `${MISAKI}/us_gold.json`, sha256: 'dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f' },
  { url: `${MISAKI}/us_silver.json`, sha256: 'de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475' },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download({ url, sha256: expected }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`${url}: SHA-256 ${actual}, expected ${expected}`);
  return bytes;
}

async function existing(path, expected) {
  try {
    return sha256(await readFile(path)) === expected;
  } catch {
    return false;
  }
}

await mkdir(OUT, { recursive: true });

for (const file of FILES) {
  const path = OUT + file.out;
  if (await existing(path, file.editedSha256 ?? file.sha256)) continue;
  console.log(`voice: downloading ${file.out}`);
  let bytes = await download(file);
  if (file.edit) {
    bytes = Buffer.from(file.edit(new Uint8Array(bytes)));
    const actual = sha256(bytes);
    if (actual !== file.editedSha256) throw new Error(`${file.out}: edited SHA-256 ${actual}, expected ${file.editedSha256}`);
  }
  await writeFile(path, bytes);
}
for (const name of OBSOLETE) await rm(OUT + name, { force: true });

/**
 * The dictionary as `word<TAB>phonemes` lines, gzipped. Gold entries win over silver ones; for
 * words whose pronunciation depends on the part of speech only the default is kept (lines are
 * short and the engine has no tagger). Named `.lexz`, not `.gz`: servers send `.gz` files with
 * `Content-Encoding: gzip`, and the browser would unpack them on its own.
 */
const lexPath = OUT + 'en-us.lexz';
const stamp = LEXICON.map((l) => l.sha256.slice(0, 12)).join(' ');
let current = '';
try {
  current = await readFile(OUT + 'en-us.lex.stamp', 'utf8');
} catch {
  // Not built yet.
}
if (current !== stamp) {
  console.log('voice: building en-us.lexz');
  const [gold, silver] = await Promise.all(LEXICON.map(async (l) => JSON.parse((await download(l)).toString('utf8'))));
  const words = new Map();
  for (const dict of [silver, gold]) {
    for (const [word, value] of Object.entries(dict)) {
      const phonemes = typeof value === 'string' ? value : value?.DEFAULT;
      if (phonemes) words.set(word, phonemes);
    }
  }
  const lines = [...words].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([w, p]) => `${w}\t${p}`);
  await writeFile(lexPath, gzipSync(lines.join('\n') + '\n', { level: 9 }));
  await writeFile(OUT + 'en-us.lex.stamp', stamp);
  console.log(`voice: ${lines.length} words`);
}
