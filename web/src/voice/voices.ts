/**
 * How each resident sounds: Paradee has one (female) voice, shaped per resident by pitch, speed
 * and depth (the size of the voice: its formants, made by resampling in the voice worker).
 * Derived from the resident id, gender and life stage, so a resident always sounds the same. A
 * voice chosen in the household creator is kept in the appearance as factors on top
 * (`VoiceChoice`). See docs/design/voices.md, "Voices from one model".
 */

export interface VoiceParams {
  speed: number;
  pitch: number;
  /** Size of the voice: below 1 larger (lower formants), above 1 smaller. */
  depth: number;
}

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
 * without one (all older saves, neighbours, newcomers, babies) have the generated voice.
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

/**
 * Grown-ups by gender. The model's voice is a woman's (about 210 Hz): men are pitched down by
 * about an octave and their voice made 12–18 % larger, so they don't sound like a woman pitched
 * down; women spread around the model's own size.
 */
const ADULT: Record<string, Group> = {
  male: { pitch: [0.52, 0.76], depth: [0.82, 0.88] },
  female: { pitch: [0.84, 1.22], depth: [0.95, 1.06] },
  other: { pitch: [0.66, 1.08], depth: [0.87, 1.0] },
};
/** Teens in between: boys' voices dropping (lower, larger than girls'), girls near women. */
const TEEN: Record<string, Group> = {
  male: { pitch: [0.68, 0.9], depth: [0.88, 0.95] },
  female: { pitch: [0.94, 1.22], depth: [1.0, 1.06] },
  other: { pitch: [0.8, 1.12], depth: [0.94, 1.03] },
};
/** Children of any gender: higher and smaller, not so small that they sound sped up. */
const CHILD: Group = { pitch: [1.2, 1.45], depth: [1.06, 1.13] };

const clamp = (v: number, [lo, hi]: Range) => Math.min(hi, Math.max(lo, v));
const lerp = ([lo, hi]: Range, t: number) => lo + (hi - lo) * t;
/** A stored factor, or 1 for a missing or broken one (the appearance is free-form JSON). */
const factor = (v: unknown, range: Range) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, range) : 1);

export function voiceFor(id: number, gender: string | undefined, stage?: string, choice?: VoiceChoice | null): VoiceParams {
  const seed = choice?.seed;
  const key = typeof seed === 'number' && Number.isInteger(seed) ? seed : id;
  const p = unit(key, 1);
  // Size follows pitch a little (lower voices tend to be larger), with its own spread.
  const d = 0.65 * unit(key, 3) + 0.35 * p;
  let speed = 0.88 + unit(key, 2) * 0.24;
  const sex = gender === 'male' || gender === 'female' ? gender : 'other';
  // Babies don't speak; children sound alike whatever their gender; boys' voices drop in their teens.
  const group = stage === 'child' ? CHILD : stage === 'teen' ? TEEN[sex] : ADULT[sex];
  let pitch = lerp(group.pitch, p);
  let depth = lerp(group.depth, d);
  switch (stage) {
    case 'child':
      speed *= 1.04;
      break;
    case 'elder':
      // Older women's voices drop; older men's rise a little and thin out; everyone slower.
      pitch *= sex === 'male' ? 1.04 : 0.93;
      depth *= sex === 'male' ? 1.02 : 0.98;
      speed *= 0.92;
      break;
  }
  if (!choice) return { pitch, speed, depth };
  return {
    pitch: clamp(pitch * factor(choice.pitch, VOICE_RANGE.pitch), PITCH_LIMITS),
    speed: clamp(speed * factor(choice.speed, VOICE_RANGE.speed), SPEED_LIMITS),
    depth: clamp(depth * factor(choice.depth, VOICE_RANGE.depth), DEPTH_LIMITS),
  };
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
