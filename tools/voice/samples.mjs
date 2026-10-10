#!/usr/bin/env node
/**
 * Renders the same lines for a set of residents, as the game would say them, to compare voices
 * by ear: WAV files, an index, and per voice the median pitch and two spectral centroids (the
 * whole band, and voiced frames below 5 kHz, which follows the formants: the size of the voice).
 *
 * Usage (needs `pnpm voice` first):
 *   node tools/voice/samples.mjs <out-dir> [label=path/to/voices.ts ...]
 * Each label is a version of `web/src/voice/voices.ts` (default: `after=` the current one), e.g.
 * `before=/tmp/voices-old.ts after=web/src/voice/voices.ts` (made with `git show <rev>:web/src/voice/voices.ts`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { engine, say as sayLine, voices } from './engine.mjs';

const web = new URL('../../web/', import.meta.url);
const [outDir, ...versionArgs] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: node tools/voice/samples.mjs <out-dir> [label=voices.ts ...]');
  process.exit(1);
}
const versions = (versionArgs.length ? versionArgs : [`after=${new URL('src/voice/voices.ts', web).pathname}`]).map((a) => {
  const [label, path] = a.split('=');
  return { label, path: resolve(path) };
});

/**
 * Ids chosen so the grown-ups' mixes all differ (`voiceFor`'s hash): each man and woman leads
 * with another of KittenTTS's voices. Any other id gets some other mix.
 */
const RESIDENTS = [
  { name: 'man-1', id: 1, gender: 'male', stage: 'adult' },
  { name: 'man-2', id: 2, gender: 'male', stage: 'adult' },
  { name: 'man-3', id: 7, gender: 'male', stage: 'youngAdult' },
  { name: 'woman-1', id: 1, gender: 'female', stage: 'adult' },
  { name: 'woman-2', id: 2, gender: 'female', stage: 'adult' },
  { name: 'woman-3', id: 7, gender: 'female', stage: 'youngAdult' },
  { name: 'teen-boy', id: 57, gender: 'male', stage: 'teen' },
  { name: 'teen-girl', id: 58, gender: 'female', stage: 'teen' },
  { name: 'child', id: 45, gender: 'female', stage: 'child' },
  { name: 'elder-man', id: 56, gender: 'male', stage: 'elder' },
  { name: 'elder-woman', id: 61, gender: 'female', stage: 'elder' },
];
const LINES = [
  { name: 'hello', text: "Hello there! I don't think we've met." },
  { name: 'garden', text: 'What a lovely garden. I should water the roses before it gets dark.' },
];
const SR = 24000;
const e = await engine();

/** Older versions of voices.ts (Paradee only) give no model: theirs was Paradee. */
const say = (text, v) => sayLine(e, text, { model: 'paradee', mix: [0, 0, 1], depth: 1, ...v });
const describe = (v) =>
  v.model === 'kitten'
    ? `KittenTTS ${voices.KITTEN_VOICES[v.mix[0]].name}${v.mix[2] < 1 ? ` ${Math.round(v.mix[2] * 100)} % + ${voices.KITTEN_VOICES[v.mix[1]].name}` : ''}`
    : 'Paradee';

function wav(samples) {
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6);
  const gain = Math.min(1, 0.9 / peak);
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), 44 + i * 2));
  return buf;
}

/** In-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k);
        const wi = Math.sin(a * k);
        const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}

/** Median F0 (autocorrelation), centroid over the whole band and of voiced frames below 5 kHz. */
function measure(x) {
  const n = 1024;
  const f0s = [];
  let [allNum, allDen, vNum, vDen] = [0, 0, 0, 0];
  for (let at = 0; at + n <= x.length; at += 256) {
    const frame = x.subarray(at, at + n);
    const rms = Math.sqrt(frame.reduce((s, v) => s + v * v, 0) / n);
    if (rms < 0.02) continue;
    // pitch
    let best = 0;
    let lagBest = 0;
    let zero = 0;
    for (let i = 0; i < n; i++) zero += frame[i] * frame[i];
    for (let lag = Math.floor(SR / 450); lag < SR / 60; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += frame[i] * frame[i + lag];
      if (s > best) [best, lagBest] = [s, lag];
    }
    const voiced = best > 0.35 * zero;
    if (voiced) f0s.push(SR / lagBest);
    // spectrum
    const re = Float64Array.from(frame, (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)));
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 1; k < n / 2; k++) {
      const f = (k * SR) / n;
      const m = Math.hypot(re[k], im[k]);
      allNum += m * f;
      allDen += m;
      if (voiced && f < 5000) {
        vNum += m * f;
        vDen += m;
      }
    }
  }
  f0s.sort((a, b) => a - b);
  return { f0: f0s[f0s.length >> 1] ?? 0, centroid: allNum / allDen, voicedCentroid: vNum / vDen };
}

mkdirSync(outDir, { recursive: true });
const rows = [];
const index = ['# Voice samples', '', `Lines: ${LINES.map((l) => `"${l.text}"`).join(', ')}. 24 kHz mono WAV.`, ''];
for (const version of versions) {
  const { voiceFor } = await import(pathToFileURL(version.path).href);
  mkdirSync(`${outDir}/${version.label}`, { recursive: true });
  for (const r of RESIDENTS) {
    const v = voiceFor(r.id, r.gender, r.stage);
    const stats = [];
    let ms = 0;
    for (const line of LINES) {
      const start = performance.now();
      const samples = await say(line.text, v);
      ms += performance.now() - start;
      const file = `${version.label}/${r.name}-${line.name}.wav`;
      writeFileSync(`${outDir}/${file}`, wav(samples));
      stats.push(measure(samples));
      index.push(`- \`${file}\`: ${r.name} (${r.gender}, ${r.stage}): ${describe(v)}, pitch ${v.pitch.toFixed(2)}, speed ${v.speed.toFixed(2)}, depth ${(v.depth ?? 1).toFixed(2)}`);
    }
    const avg = (k) => stats.reduce((s, x) => s + x[k], 0) / stats.length;
    rows.push({ version: version.label, ...r, ...v, voice: describe(v), ms: ms / LINES.length, depth: v.depth ?? 1, f0: avg('f0'), centroid: avg('centroid'), voicedCentroid: avg('voicedCentroid') });
  }
}

const table = [
  '| Version | Resident | voice | pitch | speed | depth | ms per line | median F0 (Hz) | centroid (Hz) | voiced centroid < 5 kHz (Hz) |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.version} | ${r.name} | ${r.voice} | ${r.pitch.toFixed(2)} | ${r.speed.toFixed(2)} | ${r.depth.toFixed(2)} | ${r.ms.toFixed(0)} | ${r.f0.toFixed(0)} | ${r.centroid.toFixed(0)} | ${r.voicedCentroid.toFixed(0)} |`,
  ),
];
const groups = [];
for (const version of versions) {
  const mean = (rs, k) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
  const men = rows.filter((r) => r.version === version.label && /^man-/.test(r.name));
  const women = rows.filter((r) => r.version === version.label && /^woman-/.test(r.name));
  groups.push(
    `| ${version.label} | ${mean(men, 'f0').toFixed(0)} / ${mean(women, 'f0').toFixed(0)} | ${mean(men, 'centroid').toFixed(0)} / ${mean(women, 'centroid').toFixed(0)} | ${mean(men, 'voicedCentroid').toFixed(0)} / ${mean(women, 'voicedCentroid').toFixed(0)} (${((mean(men, 'voicedCentroid') / mean(women, 'voicedCentroid') - 1) * 100).toFixed(0)} %) |`,
  );
}
const summary = ['| Version | men / women: F0 (Hz) | centroid (Hz) | voiced centroid (Hz) |', '|---|---|---|---|', ...groups];
writeFileSync(`${outDir}/index.md`, [...index, '', '## Measurements', '', ...table, '', '## Men and women', '', ...summary, ''].join('\n'));
console.log([...table, '', ...summary].join('\n'));
