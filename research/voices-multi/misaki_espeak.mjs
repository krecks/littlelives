/**
 * Misaki (US) phonemes, as our phonemizer makes them, to espeak-ng-style IPA (en-us), as KittenTTS
 * and Piper were trained on. Misaki was itself derived from espeak with a fixed substitution table
 * (misaki/espeak.py), so most of this is that table backwards, plus the vowel length marks that
 * Misaki drops for American English.
 *
 *   node misaki_espeak.mjs   scores the mapping against espeak on every line of the game content
 *                            (models/espeak_ref.json from espeak_ref.py): phoneme error rate
 */
import { readFileSync } from 'node:fs';
import { WORK, misaki } from './lines.mjs';

const DIPHTHONGS = { A: 'eɪ', I: 'aɪ', O: 'oʊ', W: 'aʊ', Y: 'ɔɪ', ʤ: 'dʒ', ʧ: 'tʃ', T: 'ɾ', ᵊ: 'ə' };
const VOWEL = /[aeiouæɑɒɔəɛɜɪʊʌAIOWYᵊᵻ]/u;

function word(w) {
  let s = w;
  s = s.replace(/ɜɹ/g, 'ɜː'); // nurse: bɜɹd -> bɜːd
  s = s.replace(/əɹ/g, 'ɚ'); // unstressed r-coloured schwa
  s = s.replace(/ɔɹ/g, 'ɔːɹ').replace(/ɑɹ/g, 'ɑːɹ');
  s = s.replace(/ɑ(?!ː)/g, 'ɑː').replace(/ɔ(?![ːY])/g, 'ɔː');
  s = s.replace(/u/g, 'uː');
  // i: long except at the end of a word of two or more syllables (happy, pretty)
  const syllables = [...s].filter((c) => VOWEL.test(c)).length;
  s = s.replace(/i(?=.)/g, 'iː');
  if (s.endsWith('i')) s = syllables >= 2 ? s : s + 'ː';
  s = [...s].map((c) => DIPHTHONGS[c] ?? c).join('');
  return s;
}

/** Misaki phoneme string -> espeak-style IPA. */
export function toEspeak(ps) {
  return ps.replace(/[^\s.,!?;:—…"()“”]+/gu, word);
}

function distance(a, b) {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ref = JSON.parse(readFileSync(`${WORK}/models/espeak_ref.json`, 'utf8')).lines;
  // stress marks and length are prosody hints; score them separately from the segments
  const segs = (s) => s.replace(/[ˈˌː]/g, '').replace(/\s+/g, ' ').trim();
  let errs = 0;
  let total = 0;
  let segErr = 0;
  let segTot = 0;
  let exact = 0;
  const worst = [];
  for (const [text, ipa] of Object.entries(ref)) {
    const mapped = toEspeak((await misaki(text)).phonemes);
    const d = distance(mapped, ipa);
    errs += d;
    total += [...ipa].length;
    const ds = distance(segs(mapped), segs(ipa));
    segErr += ds;
    segTot += [...segs(ipa)].length;
    if (ds === 0) exact++;
    worst.push([ds / Math.max(1, [...segs(ipa)].length), text, mapped, ipa]);
  }
  const n = Object.keys(ref).length;
  console.log(`${n} lines: character error ${((100 * errs) / total).toFixed(1)} % with stress/length, ${((100 * segErr) / segTot).toFixed(1)} % on segments; ${exact} lines (${((100 * exact) / n).toFixed(0)} %) identical segments`);
  worst.sort((a, b) => b[0] - a[0]);
  for (const [e, t, m, r] of worst.slice(0, 12)) console.log(`${(100 * e).toFixed(0)}%  ${t}\n   ours:   ${m}\n   espeak: ${r}`);
}
