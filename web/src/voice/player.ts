/**
 * Plays voice clips through Web Audio: the voice bus (`audio/mixer.ts`, "Voice volume"), and a
 * stereo panner per clip so a voice comes from where the resident is on screen.
 */

import { audioContext, bus, updateVolumes } from '../audio/mixer';
import { SAMPLE_RATE } from './protocol';

export interface Playing {
  /** -1 (left) .. 1 (right). */
  setPan(pan: number): void;
  stop(): void;
  readonly ended: Promise<void>;
  /** When its first sample is heard: seconds on the `performance.now()` clock (output latency included). */
  readonly startTime: number;
}

export function playClip(samples: Float32Array, pan = 0): Playing | null {
  const ac = audioContext();
  const voices = bus('voices');
  if (!ac || !voices || samples.length === 0) return null;
  const buffer = ac.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const panner = ac.createStereoPanner();
  panner.pan.value = pan;
  src.connect(panner).connect(voices);
  const ended = new Promise<void>((resolve) => (src.onended = () => resolve()));
  src.start();
  const startTime = performance.now() / 1000 + (ac.outputLatency || ac.baseLatency || 0);
  return {
    setPan(p) {
      panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), ac.currentTime, 0.05);
    },
    stop() {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
    },
    ended,
    startTime,
  };
}

/** Applies a changed "Voice volume" right away. */
export function updateVoiceVolume(): void {
  updateVolumes();
}
