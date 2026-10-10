/**
 * One line of speech from either model, the same way everywhere: the voice worker
 * (`tts.worker.ts`) and the Node tools (`tools/voice/check.mjs`, `samples.mjs`) call this, so the
 * checks hear exactly what the game plays. Plain TypeScript with type-only imports (Node runs it
 * by stripping the types).
 *
 * - Paradee-8M: Misaki phoneme ids, `speed` and `pitch`.
 * - KittenTTS nano: espeak-style ids, `speed`, `pitch` and a 256-number `style`: the resident's
 *   mix of two of its eight voices, from the row for the line's length. Its output is trimmed of
 *   the silence around the speech.
 *
 * Both then get the voice's size by resampling (`depth`, done in Rust with the trim).
 */

import type { VoiceModel, VoiceParams } from './voices';

/** The pieces of ONNX Runtime used here (the worker's `onnxruntime-web/wasm`, or Node's `onnxruntime-web`). */
export interface Ort {
  Tensor: new (type: 'int64' | 'float32', data: BigInt64Array | Float32Array, dims: number[]) => unknown;
}
export interface Session {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dispose?: () => void }>>;
}
/** `Inputs` from the phonemizer WASM (`crates/voice-wasm`). */
interface Inputs {
  readonly ids: BigInt64Array;
  readonly speed: number;
  readonly pitch: number;
  readonly depth: number;
  readonly row: number;
  finish(samples: Float32Array): Float32Array;
  free(): void;
}
export interface Phonemizer {
  inputs(text: string, speed: number, pitch: number, depth: number): Inputs;
  kitten_inputs(text: string, speed: number, pitch: number, depth: number): Inputs;
}

/** KittenTTS's voices file (`kitten-nano-0.8-voices.f32`): [voice][row][256] floats. */
export const KITTEN_ROWS = 128;
export const STYLE_SIZE = 256;

export interface Engine {
  ort: Ort;
  phonemizer: Phonemizer;
  sessions: Partial<Record<VoiceModel, Session>>;
  /** KittenTTS's style table, once loaded. */
  kittenVoices: Float32Array | null;
}

/** A resident's style: `w` of voice `a` and the rest of voice `b`, from one row of the table. */
export function kittenStyle(table: Float32Array, row: number, [a, b, w]: readonly [number, number, number]): Float32Array {
  const style = new Float32Array(STYLE_SIZE);
  const at = (v: number) => (v * KITTEN_ROWS + row) * STYLE_SIZE;
  const pa = at(a);
  const pb = at(b);
  for (let i = 0; i < STYLE_SIZE; i++) style[i] = w * table[pa + i] + (1 - w) * table[pb + i];
  return style;
}

/** 24 kHz mono for one line; `resampleMs`: the part spent trimming and resizing. */
export async function synthesizeLine(engine: Engine, text: string, voice: VoiceParams): Promise<{ samples: Float32Array; resampleMs: number }> {
  const session = engine.sessions[voice.model];
  if (!session) throw new Error(`voice model ${voice.model} not loaded`);
  const kitten = voice.model === 'kitten';
  const p = engine.phonemizer;
  const inputs = kitten ? p.kitten_inputs(text, voice.speed, voice.pitch, voice.depth) : p.inputs(text, voice.speed, voice.pitch, voice.depth);
  try {
    const ids = inputs.ids;
    if (ids.length === 0) return { samples: new Float32Array(0), resampleMs: 0 };
    const { Tensor } = engine.ort;
    const feeds: Record<string, unknown> = {
      input_ids: new Tensor('int64', ids, [1, ids.length]),
      speed: new Tensor('float32', Float32Array.of(inputs.speed), [1]),
      pitch: new Tensor('float32', Float32Array.of(inputs.pitch), [1]),
    };
    if (kitten) {
      if (!engine.kittenVoices) throw new Error('KittenTTS voices not loaded');
      feeds.style = new Tensor('float32', kittenStyle(engine.kittenVoices, inputs.row, voice.mix), [1, STYLE_SIZE]);
    }
    const out = await session.run(feeds);
    const wave = out.waveform.data as Float32Array;
    const start = performance.now();
    // A new array of our own either way, so its buffer can be transferred to the main thread.
    const samples = !kitten && inputs.depth === 1 ? new Float32Array(wave) : inputs.finish(wave);
    const resampleMs = performance.now() - start;
    for (const t of Object.values(out)) t.dispose?.();
    return { samples, resampleMs };
  } finally {
    inputs.free();
  }
}
