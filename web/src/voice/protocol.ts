/** Messages between the main thread and the voice worker (`tts.worker.ts`). */

import type { VoiceParams } from './voices';

export type ToVoiceWorker =
  /** `base`: the app's base URL, where `voice/` lives; `language`: which voice. */
  | { type: 'load'; base: string; language: string }
  | { type: 'speak'; id: number; text: string; voice: VoiceParams };

export type FromVoiceWorker =
  /** Download progress (bytes). */
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; ms: number }
  /** 24 kHz mono; `ms`: how long the engine took, `resampleMs` of it for trimming and the voice's size. */
  | { type: 'audio'; id: number; samples: Float32Array; ms: number; resampleMs: number }
  /** A line that failed (`id`), or the engine couldn't load or the worker failed. */
  | { type: 'error'; id?: number; message: string };

export const SAMPLE_RATE = 24_000;
