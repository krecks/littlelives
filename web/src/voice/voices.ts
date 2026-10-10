/**
 * How each resident sounds: Paradee has one (female) voice, shaped per resident by pitch and
 * speed. Derived from the resident id, gender and life stage, so a resident always sounds the
 * same; never saved. Formants (the size of the voice) come with our own engine
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

export function voiceFor(id: number, gender: string | undefined, stage?: string): VoiceParams {
  const p = unit(id, 1);
  const male = gender === 'male';
  let pitch = male ? 0.6 + p * 0.12 : gender === 'female' ? 0.92 + p * 0.24 : 0.7 + p * 0.4;
  let speed = 0.92 + unit(id, 2) * 0.16;
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
  return { pitch, speed };
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
