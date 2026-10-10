/**
 * How each resident sounds (docs/design/voices.md, "Voices"). Two models:
 *
 * - **KittenTTS nano** for teens and grown-ups: eight real voices, four women's and four men's.
 *   Each resident gets their own fixed mix of two of them (a style vector is a list of numbers,
 *   so a mix is a weighted sum): men from the men's voices, women from the women's, everyone
 *   else from all eight. Pitch, speed and size (depth) vary on top.
 * - **Paradee-8M** for children (higher and smaller by pitch and depth: KittenTTS has no child
 *   voice), and for anyone when KittenTTS can't keep up on this computer (`paradeeVoice`).
 * - Babies don't speak.
 *
 * Derived from the resident id, gender and life stage, so a resident always sounds the same; a
 * voice chosen in the household creator is kept in the appearance (`VoiceChoice`). Never saved
 * otherwise.
 */

export type VoiceModel = 'paradee' | 'kitten';

export interface VoiceParams {
  model: VoiceModel;
  /** KittenTTS: `w` of voice `a` and the rest of voice `b` (`KITTEN_VOICES` indices); ignored by Paradee. */
  mix: readonly [a: number, b: number, w: number];
  speed: number;
  pitch: number;
  /** Size of the voice: below 1 larger (lower formants), above 1 smaller. */
  depth: number;
}

/**
 * KittenTTS nano's voices, in the order of its voices file (`tools/voice/fetch.mjs`), with the
 * names its makers gave them. `pace`: the model speed that brings each to 4.5 syllables per
 * second (measured over 12 game lines at speed 1: Bella 2.95, Leo 3.43, Luna 4.04, Rosie 4.08,
 * Hugo 4.22, Jasper 4.45, Bruno 4.46, Kiki 4.82; Paradee 4.83). `pitch`: Jasper and Hugo are
 * light voices (about 170 Hz) and sound more like men a little lower; Bruno (108 Hz) and Leo lose
 * naturalness when lowered (UTMOS −0.3 at ×0.9), so they stay. `main`: whether the voice can
 * lead a resident's mix; Kiki, very high (about 290 Hz) and the least natural of the eight, only
 * colours a mix (or is chosen in the creator).
 */
export const KITTEN_VOICES = [
  { name: 'Bella', sex: 'female', pace: 1.53, pitch: 1, main: true },
  { name: 'Luna', sex: 'female', pace: 1.11, pitch: 1, main: true },
  { name: 'Rosie', sex: 'female', pace: 1.1, pitch: 1, main: true },
  { name: 'Kiki', sex: 'female', pace: 0.93, pitch: 1, main: false },
  { name: 'Jasper', sex: 'male', pace: 1.01, pitch: 0.9, main: true },
  { name: 'Bruno', sex: 'male', pace: 1.01, pitch: 1, main: true },
  { name: 'Hugo', sex: 'male', pace: 1.07, pitch: 0.9, main: true },
  { name: 'Leo', sex: 'male', pace: 1.31, pitch: 0.96, main: true },
] as const;

/** 0..1 from an integer and a salt (a small integer hash, stable across sessions). */
function unit(id: number, salt: number): number {
  let h = (id * 0x9e3779b1) ^ (salt * 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A voice chosen in the household creator (`appearance.voice`): factors on the generated voice,
 * 1 (or missing) being as generated, so it still changes as the resident grows up. Residents
 * without one (all older saves, neighbours, newcomers, babies) have the generated voice. Fields
 * are only ever added, so older choices load as they were.
 */
export interface VoiceChoice {
  /** Higher or lower than the generated voice (`VOICE_RANGE.pitch`). */
  pitch?: number;
  /** Faster or slower (`VOICE_RANGE.speed`). */
  speed?: number;
  /** Larger (below 1) or smaller (above 1) than the generated voice (`VOICE_RANGE.depth`). */
  depth?: number;
  /**
   * Stands in for the resident id in the generated voice: someone made in the creator has no id
   * until they move in, and the voice heard there must be the one they keep.
   */
  seed?: number;
  /**
   * One of KittenTTS's voices (`KITTEN_VOICES` index) as a teen's or grown-up's voice instead of
   * their own mix; missing: the mix.
   */
  base?: number;
}

/** How far a chosen voice may stray from the generated one: about two semitones, a little faster or slower, a little larger or smaller. */
export const VOICE_RANGE = { pitch: [0.88, 1.12], speed: [0.88, 1.12], depth: [0.92, 1.08] } as const;
/** And where it stops, so a deep elder made lower or a child made higher still sounds pleasant. */
const PITCH_LIMITS = [0.5, 1.5] as const;
const SPEED_LIMITS = [0.8, 1.2] as const;
const DEPTH_LIMITS = [0.78, 1.16] as const;

type Range = readonly [number, number];
/** A generated voice per group: pitch and depth ranges (factors on the model's own voice). */
interface Group {
  pitch: Range;
  depth: Range;
}
type Sex = 'male' | 'female' | 'other';

/**
 * Paradee (one woman's voice, about 210 Hz), grown-ups by gender, used when KittenTTS can't keep
 * up: men pitched down and made 12–18 % larger, women spread around the model's own size.
 */
const PARADEE_ADULT: Record<Sex, Group> = {
  male: { pitch: [0.52, 0.76], depth: [0.82, 0.88] },
  female: { pitch: [0.84, 1.22], depth: [0.95, 1.06] },
  other: { pitch: [0.66, 1.08], depth: [0.87, 1.0] },
};
/** Paradee teens in between: boys' voices dropping (lower, larger than girls'), girls near women. */
const PARADEE_TEEN: Record<Sex, Group> = {
  male: { pitch: [0.68, 0.9], depth: [0.88, 0.95] },
  female: { pitch: [0.94, 1.22], depth: [1.0, 1.06] },
  other: { pitch: [0.8, 1.12], depth: [0.94, 1.03] },
};
/** Children of any gender (Paradee): higher and smaller, not so small that they sound sped up. */
const CHILD: Group = { pitch: [1.2, 1.45], depth: [1.06, 1.13] };

/** KittenTTS's voices are real men's and women's: small spreads around them. */
const KITTEN_ADULT: Group = { pitch: [0.94, 1.06], depth: [0.97, 1.03] };
/** Teens: the same voices a little higher and smaller. */
const KITTEN_TEEN: Group = { pitch: [1.04, 1.12], depth: [1.03, 1.07] };

const clamp = (v: number, [lo, hi]: Range) => Math.min(hi, Math.max(lo, v));
const lerp = ([lo, hi]: Range, t: number) => lo + (hi - lo) * t;
/** A stored factor, or 1 for a missing or broken one (the appearance is free-form JSON). */
const factor = (v: unknown, range: Range) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, range) : 1);
const sexOf = (gender: string | undefined): Sex => (gender === 'male' || gender === 'female' ? gender : 'other');

/** Which model a life stage speaks with (babies don't speak; they're voiced as the child they'll be). */
export function modelFor(stage: string | undefined): VoiceModel {
  return stage === 'child' || stage === 'baby' ? 'paradee' : 'kitten';
}

/** A valid `KITTEN_VOICES` index from a stored choice, or null. */
export function baseVoice(choice: VoiceChoice | null | undefined): number | null {
  const b = choice?.base;
  return typeof b === 'number' && Number.isInteger(b) && b >= 0 && b < KITTEN_VOICES.length ? b : null;
}

/** The KittenTTS voices a resident's mix is made from. */
function candidates(sex: Sex): number[] {
  return KITTEN_VOICES.flatMap((v, i) => (sex === 'other' || v.sex === sex ? [i] : []));
}

/** A resident's own mix of two voices: a main one (half to all of it) and another. */
export function kittenMix(key: number, gender: string | undefined, choice?: VoiceChoice | null): [number, number, number] {
  const base = baseVoice(choice);
  if (base !== null) return [base, base, 1];
  const pool = candidates(sexOf(gender));
  const mains = pool.filter((i) => KITTEN_VOICES[i].main);
  const a = mains[Math.floor(unit(key, 4) * mains.length)];
  const rest = pool.filter((i) => i !== a);
  const b = rest[Math.floor(unit(key, 5) * rest.length)];
  return [a, b, 0.5 + 0.5 * unit(key, 6)];
}

/**
 * The resident's voice at this life stage. `model` forces one (Paradee for everyone when
 * KittenTTS can't keep up on this computer).
 */
export function voiceFor(id: number, gender: string | undefined, stage?: string, choice?: VoiceChoice | null, model?: VoiceModel): VoiceParams {
  const seed = choice?.seed;
  const key = typeof seed === 'number' && Number.isInteger(seed) ? seed : id;
  const p = unit(key, 1);
  // Size follows pitch a little (lower voices tend to be larger), with its own spread.
  const d = 0.65 * unit(key, 3) + 0.35 * p;
  let speed = 0.88 + unit(key, 2) * 0.24;
  const sex = sexOf(gender);
  // Children are always Paradee: KittenTTS has no child's voice.
  const kitten = modelFor(stage) === 'kitten' && model !== 'paradee';
  let mix: [number, number, number] = [0, 0, 1];
  let group: Group;
  /** KittenTTS: the mix's own pitch correction. */
  let tilt = 1;
  if (kitten) {
    mix = kittenMix(key, gender, choice);
    group = stage === 'teen' ? KITTEN_TEEN : KITTEN_ADULT;
    const [a, b, w] = mix;
    speed *= w * KITTEN_VOICES[a].pace + (1 - w) * KITTEN_VOICES[b].pace;
    tilt = w * KITTEN_VOICES[a].pitch + (1 - w) * KITTEN_VOICES[b].pitch;
  } else {
    // Babies don't speak (they're heard as the child they'll be); children sound alike whatever their gender; boys' voices drop in their teens.
    group = modelFor(stage) === 'paradee' ? CHILD : stage === 'teen' ? PARADEE_TEEN[sex] : PARADEE_ADULT[sex];
  }
  let pitch = lerp(group.pitch, p) * tilt;
  let depth = lerp(group.depth, d);
  switch (stage) {
    case 'child':
    case 'baby':
      speed *= 1.04;
      break;
    case 'elder':
      // Older women's voices drop; older men's rise a little and thin out; everyone slower.
      pitch *= sex === 'male' ? 1.04 : 0.93;
      depth *= sex === 'male' ? 1.02 : 0.98;
      speed *= 0.92;
      break;
  }
  const out: VoiceParams = { model: kitten ? 'kitten' : 'paradee', mix, pitch, speed, depth };
  if (!choice) return out;
  return {
    ...out,
    pitch: clamp(pitch * factor(choice.pitch, VOICE_RANGE.pitch), PITCH_LIMITS),
    speed: clamp(speed * factor(choice.speed, VOICE_RANGE.speed), SPEED_LIMITS),
    depth: clamp(depth * factor(choice.depth, VOICE_RANGE.depth), DEPTH_LIMITS),
  };
}

/** The same resident on Paradee (when KittenTTS is too slow or couldn't load). */
export function paradeeVoice(id: number, gender: string | undefined, stage?: string, choice?: VoiceChoice | null): VoiceParams {
  return voiceFor(id, gender, stage, choice, 'paradee');
}

/** Line tone on top of the resident's voice (the voice's size stays). */
export function withTone(v: VoiceParams, tone: string | undefined): VoiceParams {
  switch (tone) {
    case 'happy':
      return { ...v, pitch: v.pitch * 1.06, speed: v.speed * 1.06 };
    case 'angry':
      return { ...v, pitch: v.pitch * 1.04, speed: v.speed * 1.12 };
    case 'sad':
      return { ...v, pitch: v.pitch * 0.94, speed: v.speed * 0.9 };
    case 'flirty':
      return { ...v, pitch: v.pitch * 0.97, speed: v.speed * 0.94 };
    default:
      return v;
  }
}

export { unit as hashUnit };
