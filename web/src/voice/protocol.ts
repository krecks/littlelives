/** Messages between the main thread and the voice worker (`tts.worker.ts`). */

import type { VoiceModel, VoiceParams } from './voices';

export type ToVoiceWorker =
  /** `base`: the app's base URL, where `voice/` lives; `language`: which voice; `model`: which model to get ready. */
  | { type: 'load'; base: string; language: string; model: VoiceModel }
  | { type: 'speak'; id: number; text: string; voice: VoiceParams };

export type FromVoiceWorker =
  /** Download progress of the model being loaded (bytes, files it shares with the other model included). */
  | { type: 'progress'; model: VoiceModel; loaded: number; total: number }
  | { type: 'ready'; model: VoiceModel; ms: number }
  /** 24 kHz mono; `ms`: how long the engine took, `resampleMs` of it for trimming and the voice's size. */
  | { type: 'audio'; id: number; samples: Float32Array; ms: number; resampleMs: number }
  /** A line that failed (`id`), a model that couldn't load (`model`), or the worker itself. */
  | { type: 'error'; id?: number; model?: VoiceModel; message: string };

export const SAMPLE_RATE = 24_000;
