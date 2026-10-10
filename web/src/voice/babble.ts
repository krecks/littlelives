/**
 * Babble, the made-up language (docs/design/voices.md): no model, no download, works on every
 * computer. A line is said as made-up syllables, about as many as the line has, so Babble "says"
 * the same line; the same word always gives the same syllables.
 *
 * A small source-filter synthesiser: a buzzy pitched source through three formant filters for
 * vowels and voiced consonants, filtered noise for hisses and bursts. Targets change per segment
 * and are smoothed, so sounds glide into each other. Rendered straight into a clip (24 kHz mono,
 * like the English voice) in a few milliseconds, so it plays through the same voice bus.
 * Deterministic: the same line and voice always give the same clip.
 */

import { SAMPLE_RATE } from './protocol';
import type { VoiceParams } from './voices';

const RATE = SAMPLE_RATE;
/** Paradee's median pitch at ×1, so a resident's Babble voice sits where their English one does. */
const BASE_HZ = 210;
const MAX_SECONDS = 8;

type Formants = readonly [number, number, number];

const VOWELS: Record<string, Formants> = {
  a: [780, 1220, 2600],
  e: [480, 1880, 2550],
  i: [320, 2250, 2950],
  o: [500, 880, 2500],
  u: [350, 820, 2350],
};
const VOWEL_KEYS = ['a', 'a', 'e', 'i', 'o', 'o', 'u'];

interface Consonant {
  kind: 'stop' | 'hiss' | 'nasal' | 'glide';
  voiced: boolean;
  /** Noise band centre (Hz) and Q; a hiss without a band breathes through the vowel (h). */
  band?: number;
  q?: number;
  /** Loudness of the hiss. */
  noise?: number;
  formants?: Formants;
}

const CONSONANTS: Record<string, Consonant> = {
  p: { kind: 'stop', voiced: false, band: 900, q: 1 },
  t: { kind: 'stop', voiced: false, band: 4200, q: 1.2 },
  k: { kind: 'stop', voiced: false, band: 2200, q: 1.5 },
  b: { kind: 'stop', voiced: true, band: 900, q: 1 },
  d: { kind: 'stop', voiced: true, band: 3800, q: 1.2 },
  g: { kind: 'stop', voiced: true, band: 2000, q: 1.5 },
  s: { kind: 'hiss', voiced: false, band: 6000, q: 2.5, noise: 0.45 },
  sh: { kind: 'hiss', voiced: false, band: 2800, q: 2, noise: 0.4 },
  f: { kind: 'hiss', voiced: false, band: 4500, q: 0.8, noise: 0.18 },
  z: { kind: 'hiss', voiced: true, band: 5500, q: 2.5, noise: 0.3 },
  h: { kind: 'hiss', voiced: false, noise: 0.3 },
  m: { kind: 'nasal', voiced: true, formants: [260, 1100, 2400] },
  n: { kind: 'nasal', voiced: true, formants: [260, 1700, 2600] },
  l: { kind: 'glide', voiced: true, formants: [380, 1250, 2800] },
  w: { kind: 'glide', voiced: true, formants: [300, 650, 2300] },
  y: { kind: 'glide', voiced: true, formants: [280, 2250, 3000] },
};
/** Repeats make a sound more common; '' is a syllable without a consonant. */
const ONSETS = ['b', 'b', 'd', 'g', 'k', 'l', 'l', 'm', 'm', 'n', 'n', 'p', 's', 't', 'w', 'sh', 'f', 'h', 'y', 'z', '', ''];
const CODAS = ['', '', '', '', 'm', 'n', 'l', 's'];

/** One stretch of sound with its targets; the synthesiser glides between them. */
interface Segment {
  seconds: number;
  /** Buzz through the formants. */
  voice: number;
  /** Breath through the formants (h, aspiration). */
  breath: number;
  /** Hiss through the noise band. */
  hiss: number;
  formants: Formants;
  band: number;
  q: number;
  /** Pitch, relative to the resident's own. */
  pitch: number;
}

/**
 * The clip for a line. `tone` follows the lines' tones (`happy`, `sad`, `angry`, `flirty`,
 * `question`), plus `cry` for babies, who only cry and coo.
 */
export function babble(text: string, voice: VoiceParams, tone?: string): Float32Array {
  const segments = plan(text, voice, tone);
  return render(segments, voice, tone, hashString(text));
}

/** Made-up syllables for a word: as many as it has vowel groups, from a hash of the word. */
function syllables(word: string, cry: boolean): { onset: string; vowel: string; coda: string }[] {
  const groups = word.match(/[aeiouy]+/g)?.length ?? 1;
  const count = Math.max(1, Math.min(4, groups));
  const h = hashString(word);
  const out = [];
  for (let k = 0; k < count; k++) {
    const r = (salt: number) => unit(h, k * 3 + salt);
    if (cry) {
      out.push({ onset: r(1) < 0.7 ? 'w' : '', vowel: r(2) < 0.75 ? 'a' : 'e', coda: '' });
      continue;
    }
    const onset = ONSETS[Math.floor(r(1) * ONSETS.length)];
    const vowel = VOWEL_KEYS[Math.floor(r(2) * VOWEL_KEYS.length)];
    const coda = k === count - 1 ? CODAS[Math.floor(r(3) * CODAS.length)] : '';
    out.push({ onset, vowel, coda });
  }
  return out;
}

function plan(text: string, voice: VoiceParams, tone: string | undefined): Segment[] {
  const cry = tone === 'cry';
  const tokens = text.toLowerCase().match(/[a-z']+|[.,!?;:]/g) ?? [];
  const words = tokens.map((t) => (/[a-z]/.test(t) ? syllables(t.replace(/'/g, ''), cry) : null));
  const total = words.reduce((n, w) => n + (w?.length ?? 0), 0) || 1;
  const question = tone === 'question' || /\?\s*$/.test(text);
  // How far the pitch moves: lively when happy or angry, flat when sad.
  const range = tone === 'happy' || tone === 'angry' ? 1.5 : tone === 'sad' ? 0.6 : 1;
  const slow = 1 / Math.max(0.5, voice.speed);
  const segs: Segment[] = [];
  let lastPitch = 1;
  const push = (s: Partial<Segment> & { seconds: number }) => {
    const seg: Segment = { voice: 0, breath: 0, hiss: 0, formants: VOWELS.a, band: 3000, q: 1, pitch: lastPitch, ...s };
    seg.seconds *= slow;
    lastPitch = seg.pitch;
    segs.push(seg);
  };
  push({ seconds: 0.02 });

  let index = 0;
  tokens.forEach((token, t) => {
    const word = words[t];
    if (!word) {
      push({ seconds: token === ',' || token === ';' || token === ':' ? 0.13 : 0.2 });
      return;
    }
    word.forEach((syl, k) => {
      const progress = total > 1 ? index / (total - 1) : 0;
      index++;
      // Falling through the line, a bump on each word's first syllable, a rise at the end of a question.
      let pitch = 1 + (0.08 - 0.18 * progress) * range;
      if (k === 0) pitch *= 1 + 0.06 * range;
      if (question && progress > 0.65) pitch *= 1 + (progress - 0.65) * 1.1;
      const v = VOWELS[syl.vowel];
      if (syl.onset) consonant(push, CONSONANTS[syl.onset], v, pitch, true);
      const last = k === word.length - 1;
      if (cry) {
        // A rising then falling wail.
        push({ seconds: 0.22, voice: 1, breath: 0.08, formants: v, pitch: pitch * 1.18 });
        push({ seconds: 0.28, voice: 0.85, breath: 0.1, formants: v, pitch: pitch * 0.82 });
      } else {
        const seconds = (k === 0 ? 0.11 : 0.085) + (last ? 0.03 : 0);
        push({ seconds, voice: k === 0 ? 1 : 0.8, breath: 0.03, formants: v, pitch });
      }
      if (syl.coda) consonant(push, CONSONANTS[syl.coda], v, pitch * 0.97, false);
    });
    push({ seconds: cry ? 0.12 : 0.04, formants: segs[segs.length - 1].formants });
  });
  push({ seconds: 0.06, formants: segs[segs.length - 1].formants });
  return segs;
}

function consonant(
  push: (s: Partial<Segment> & { seconds: number }) => void,
  c: Consonant,
  vowel: Formants,
  pitch: number,
  onset: boolean,
): void {
  const bandOf = { band: c.band ?? 3000, q: c.q ?? 1 };
  switch (c.kind) {
    case 'stop':
      // Closure, burst, then (voiceless, before a vowel) a breath of aspiration.
      push({ seconds: 0.035, voice: c.voiced ? 0.12 : 0, formants: [200, vowel[1] * 0.85, vowel[2]], pitch });
      push({ seconds: 0.014, voice: c.voiced ? 0.35 : 0, hiss: 0.55, ...bandOf, formants: vowel, pitch });
      if (!c.voiced && onset) push({ seconds: 0.025, breath: 0.25, formants: vowel, pitch });
      break;
    case 'hiss':
      if (c.band === undefined) push({ seconds: 0.06, breath: c.noise ?? 0.3, formants: vowel, pitch });
      else push({ seconds: 0.075, voice: c.voiced ? 0.25 : 0, hiss: c.noise ?? 0.35, ...bandOf, formants: vowel, pitch });
      break;
    case 'nasal':
      push({ seconds: 0.06, voice: 0.45, formants: c.formants!, pitch });
      break;
    case 'glide':
      push({ seconds: 0.05, voice: 0.6, formants: c.formants!, pitch });
      break;
  }
}

/** Band-pass biquad (constant 0 dB peak), direct form I. */
class BandPass {
  private b0 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  set(freq: number, q: number): void {
    const w = (2 * Math.PI * Math.min(freq, RATE * 0.45)) / RATE;
    const alpha = Math.sin(w) / (2 * Math.max(0.3, q));
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  step(x: number): number {
    const y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Formant bandwidths (Hz) and loudness. */
const BANDWIDTH = [80, 110, 160];
const FORMANT_GAIN = [1, 0.7, 0.35];
/** Filter coefficients follow the gliding formants every this many samples. */
const BLOCK = 16;

function render(segs: Segment[], voice: VoiceParams, tone: string | undefined, seed: number): Float32Array {
  const seconds = Math.min(MAX_SECONDS, segs.reduce((n, s) => n + s.seconds, 0));
  const out = new Float32Array(Math.ceil(seconds * RATE));
  const formantScale = voice.formant ?? 1;
  const baseHz = BASE_HZ * voice.pitch;
  const cry = tone === 'cry';
  // One-pole smoothing per sample: amplitudes quickly, formants and pitch more slowly.
  const ampK = 1 - Math.exp(-1 / (0.005 * RATE));
  const formantK = 1 - Math.exp(-BLOCK / (0.014 * RATE));
  const pitchK = 1 - Math.exp(-1 / (0.03 * RATE));

  const filters = [new BandPass(), new BandPass(), new BandPass()];
  const hissFilter = new BandPass();
  let rng = seed | 1;
  const noise = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return (rng >>> 0) / 2147483648 - 1;
  };

  const first = segs[0];
  let vAmp = 0;
  let bAmp = 0;
  let hAmp = 0;
  let pitch = first.pitch;
  const f = [first.formants[0] * formantScale, first.formants[1] * formantScale, first.formants[2] * formantScale];
  let phase = 0;
  let tilt = 0;
  let jitter = 0;
  let jitterTarget = 0;

  let segEnd = 0;
  let seg = first;
  let next = 0;
  for (let i = 0; i < out.length; i++) {
    if (i >= segEnd && next < segs.length) {
      seg = segs[next++];
      segEnd = i + Math.round(seg.seconds * RATE);
      hissFilter.set(seg.band, seg.q);
    }
    if (i % BLOCK === 0) {
      for (let k = 0; k < 3; k++) {
        f[k] += (seg.formants[k] * formantScale - f[k]) * formantK;
        filters[k].set(f[k], f[k] / (BANDWIDTH[k] * formantScale));
      }
      // A slow wobble so the pitch is never perfectly steady.
      if (i % (BLOCK * 32) === 0) jitterTarget = noise() * 0.012;
      jitter += (jitterTarget - jitter) * 0.05;
    }
    vAmp += (seg.voice - vAmp) * ampK;
    bAmp += (seg.breath - bAmp) * ampK;
    hAmp += (seg.hiss - hAmp) * ampK;
    pitch += (seg.pitch - pitch) * pitchK;

    const vibrato = cry ? 1 + 0.06 * Math.sin((2 * Math.PI * 5.5 * i) / RATE) : 1;
    const dt = (baseHz * pitch * vibrato * (1 + jitter)) / RATE;
    phase += dt;
    if (phase >= 1) phase -= 1;
    // Band-limited sawtooth (polyBLEP), softened a little: the buzz of the vocal folds.
    let saw = 2 * phase - 1 - polyBlep(phase, dt);
    tilt = saw * 0.65 + tilt * 0.35;
    saw = tilt;

    const n = noise();
    const source = saw * vAmp + n * bAmp;
    let y = 0;
    for (let k = 0; k < 3; k++) y += filters[k].step(source) * FORMANT_GAIN[k];
    y += hissFilter.step(n) * hAmp;
    out[i] = y;
  }

  // Loudness by tone; fade the very ends so nothing clicks.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const level = tone === 'angry' ? 0.75 : tone === 'sad' ? 0.45 : cry ? 0.7 : 0.6;
  const gain = peak > 0 ? level / peak : 0;
  const fade = Math.min(out.length / 2, Math.round(0.01 * RATE));
  for (let i = 0; i < out.length; i++) {
    const edge = Math.min(1, i / fade, (out.length - 1 - i) / fade);
    out[i] *= gain * edge;
  }
  return out;
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** FNV-1a. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function unit(h: number, salt: number): number {
  let x = Math.imul(h ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
