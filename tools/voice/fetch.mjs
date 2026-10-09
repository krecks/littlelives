#!/usr/bin/env node
/**
 * Fetches the resident voice model and builds the pronunciation dictionary into
 * `web/public/voice/` (not in git; see docs/design/voices.md).
 *
 * - Paradee-8M (Apache-2.0): https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0
 * - Misaki's US English dictionaries (Apache-2.0): https://github.com/hexgrad/misaki
 *
 * Everything is pinned to a revision and checked against its SHA-256, so every build speaks the
 * same. Files already present with the right hash are kept. Usage: `node tools/voice/fetch.mjs`.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../web/public/voice/', import.meta.url));

const PARADEE = 'https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0/resolve/f662642d44c03c17588e4176469c54d462c0b623';
const MISAKI = 'https://raw.githubusercontent.com/hexgrad/misaki/fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data';

const FILES = [
  { url: `${PARADEE}/onnx/paradee_int8.onnx`, out: 'paradee-8m.onnx', sha256: '60e8f8a1bc7c546488154e9d99ecac6e9c50baf3f4b684c5b0de48ea03b698eb' },
  { url: `${PARADEE}/config.json`, out: 'paradee-8m.json', sha256: 'f24046974a3a8c747affefb45c7c504263a99d5081787908b16abe8f5ac94fcd' },
];
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
  if (await existing(path, file.sha256)) continue;
  console.log(`voice: downloading ${file.out}`);
  await writeFile(path, await download(file));
}

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
