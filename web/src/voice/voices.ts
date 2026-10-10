/**
 * How each resident sounds: Paradee has one (female) voice, shaped per resident by pitch and
 * speed. Derived from the resident id, gender and life stage, so a resident always sounds the
 * same. A voice chosen in the household creator is kept in the appearance as factors on top
 * (`VoiceChoice`). Formants (the size of the voice) come with our own engine
 * (docs/design/voices.md).
 */

export interface VoiceParams {
  speed: number;
  pitch: number;
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
 * 1 being as generated, so it still changes as the resident grows up. Residents without one (all
 * older saves, neighbours, newcomers, babies) have the generated voice. New fields (such as a
 * voice size) are added as further optional factors.
 */
export interface VoiceChoice {
  /** Higher or lower than the generated voice (`VOICE_RANGE.pitch`). */
  pitch?: number;
  /** Faster or slower (`VOICE_RANGE.speed`). */
  speed?: number;
  /**
   * Stands in for the resident id in the generated voice: someone made in the creator has no id
   * until they move in, and the voice heard there must be the one they keep.
   */
  seed?: number;
}

/** How far a chosen voice may stray from the generated one: about two semitones, and a little faster or slower. */
export const VOICE_RANGE = { pitch: [0.88, 1.12], speed: [0.88, 1.12] } as const;
/** And where it stops, so a deep elder made lower or a child made higher still sounds pleasant. */
const PITCH_LIMITS = [0.52, 1.5] as const;
const SPEED_LIMITS = [0.8, 1.2] as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
/** A stored factor, or 1 for a missing or broken one (the appearance is free-form JSON). */
const factor = (v: unknown, range: readonly [number, number]) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, range) : 1);

export function voiceFor(id: number, gender: string | undefined, stage?: string, choice?: VoiceChoice | null): VoiceParams {
  const seed = choice?.seed;
  const key = typeof seed === 'number' && Number.isInteger(seed) ? seed : id;
  const p = unit(key, 1);
  const male = gender === 'male';
  let pitch = male ? 0.6 + p * 0.12 : gender === 'female' ? 0.92 + p * 0.24 : 0.7 + p * 0.4;
  let speed = 0.92 + unit(key, 2) * 0.16;
  // Babies don't speak; children sound alike whatever their gender; boys' voices drop in their teens; elders a little lower and slower.
  switch (stage) {
    case 'child':
      pitch = 1.25 + p * 0.2;
      speed *= 1.04;
      break;
    case 'teen':
      pitch = male ? 0.72 + p * 0.14 : pitch * 1.04;
      break;
    case 'elder':
      pitch *= 0.94;
      speed *= 0.93;
      break;
  }
  if (!choice) return { pitch, speed };
  return {
    pitch: clamp(pitch * factor(choice.pitch, VOICE_RANGE.pitch), PITCH_LIMITS),
    speed: clamp(speed * factor(choice.speed, VOICE_RANGE.speed), SPEED_LIMITS),
  };
}

/** Line tone on top of the resident's voice. */
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
