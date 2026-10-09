/** Messages between the main thread and the voice worker (`tts.worker.ts`). */

export type ToVoiceWorker =
  /** `base`: the app's base URL, where `voice/` lives; `language`: which voice to load. */
  | { type: 'load'; base: string; language: string }
  | { type: 'speak'; id: number; text: string; speed: number; pitch: number };

export type FromVoiceWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; ms: number }
  /** 24 kHz mono; `ms`: how long the engine took. */
  | { type: 'audio'; id: number; samples: Float32Array; ms: number }
  | { type: 'error'; id?: number; message: string };

export const SAMPLE_RATE = 24_000;
