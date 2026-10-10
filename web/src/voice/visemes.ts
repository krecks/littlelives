/**
 * Mouth shapes for a voice clip, made in Rust with the audio (`crates/voice/src/visemes.rs`) and
 * sent from the worker as one flat array: `[segments, energy frames, times…, visemes…, energy…]`.
 */

/** The 15 Oculus/Meta visemes, in index order. */
export const VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'] as const;
/** `energy` values per second. */
export const ENERGY_RATE = 100;

/**
 * Segment `i` shows `visemes[i]` from `times[i]` to `times[i + 1]` (seconds from the clip's
 * first sample; `times` has one more entry than `visemes`, or none). Before the first time and
 * after the last the mouth rests. `energy`: loudness 0..1 every 10 ms from the clip's start.
 */
export interface VisemeTrack {
  times: Float32Array;
  visemes: Uint8Array;
  energy: Float32Array;
}

const EMPTY: VisemeTrack = { times: new Float32Array(0), visemes: new Uint8Array(0), energy: new Float32Array(0) };

/** Reads the flat array (views into it, the visemes copied); an empty track if it doesn't add up. */
export function parseVisemes(flat: Float32Array): VisemeTrack {
  const n = flat[0] ?? 0;
  const e = flat[1] ?? 0;
  const t = n > 0 ? n + 1 : 0;
  if (flat.length !== 2 + t + n + e) return EMPTY;
  return {
    times: flat.subarray(2, 2 + t),
    visemes: Uint8Array.from(flat.subarray(2 + t, 2 + t + n)),
    energy: flat.subarray(2 + t + n),
  };
}
