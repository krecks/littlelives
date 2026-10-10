/**
 * One line of speech, the same way everywhere: the voice worker (`tts.worker.ts`) and the Node
 * tools (`tools/voice/check.mjs`, `samples.mjs`) call this, so the checks hear exactly what the
 * game plays. Plain TypeScript with type-only imports (Node runs it by stripping the types).
 *
 * KittenTTS nano takes espeak-style ids, `speed`, `pitch` and a 256-number `style`: the
 * resident's mix of two of its eight voices, from the row for the line's length. Its output is
 * trimmed of the silence around the speech and given the voice's size by resampling (`depth`),
 * and its mouth shapes are found (`visemes.ts`; all three done in Rust).
 */

import type { VoiceParams } from './voices';

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
  /** After `finish`: the clip's mouth shapes, flat (`parseVisemes`). */
  readonly visemes: Float32Array;
  free(): void;
}
export interface Phonemizer {
  inputs(text: string, speed: number, pitch: number, depth: number): Inputs;
}

/** KittenTTS's voices file (`kitten-nano-0.8-voices.f32`): [voice][row][256] floats. */
export const KITTEN_ROWS = 128;
export const STYLE_SIZE = 256;

export interface Engine {
  ort: Ort;
  phonemizer: Phonemizer;
  /** The model and its style table, once loaded. */
  session: Session | null;
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

/** 24 kHz mono for one line and its mouth shapes (flat); `resampleMs`: the part spent trimming, resizing and finding them. */
export async function synthesizeLine(engine: Engine, text: string, voice: VoiceParams): Promise<{ samples: Float32Array; visemes: Float32Array; resampleMs: number }> {
  const { session, kittenVoices } = engine;
  if (!session || !kittenVoices) throw new Error('voice model not loaded');
  const inputs = engine.phonemizer.inputs(text, voice.speed, voice.pitch, voice.depth);
  try {
    const ids = inputs.ids;
    if (ids.length === 0) return { samples: new Float32Array(0), visemes: Float32Array.of(0, 0), resampleMs: 0 };
    const { Tensor } = engine.ort;
    const feeds: Record<string, unknown> = {
      input_ids: new Tensor('int64', ids, [1, ids.length]),
      speed: new Tensor('float32', Float32Array.of(inputs.speed), [1]),
      pitch: new Tensor('float32', Float32Array.of(inputs.pitch), [1]),
      style: new Tensor('float32', kittenStyle(kittenVoices, inputs.row, voice.mix), [1, STYLE_SIZE]),
    };
    const out = await session.run(feeds);
    const wave = out.waveform.data as Float32Array;
    const start = performance.now();
    // New arrays of our own, so their buffers can be transferred to the main thread.
    const samples = inputs.finish(wave);
    const visemes = inputs.visemes;
    const resampleMs = performance.now() - start;
    for (const t of Object.values(out)) t.dispose?.();
    return { samples, visemes, resampleMs };
  } finally {
    inputs.free();
  }
}
