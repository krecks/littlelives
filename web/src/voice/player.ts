/**
 * Plays voice clips through Web Audio: one voice bus with the "Voice volume" setting, and a
 * stereo panner per clip so a voice comes from where the resident is on screen.
 */

import { settings } from '../settings/settings.svelte';
import { SAMPLE_RATE } from './protocol';

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      bus = ctx.createGain();
      bus.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  bus!.gain.value = settings.voiceVolume;
  return ctx;
}

export interface Playing {
  /** -1 (left) .. 1 (right). */
  setPan(pan: number): void;
  stop(): void;
  readonly ended: Promise<void>;
}

export function playClip(samples: Float32Array, pan = 0): Playing | null {
  const ac = audio();
  if (!ac || !bus || samples.length === 0) return null;
  const buffer = ac.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const panner = ac.createStereoPanner();
  panner.pan.value = pan;
  src.connect(panner).connect(bus);
  const ended = new Promise<void>((resolve) => (src.onended = () => resolve()));
  src.start();
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
  };
}

/** Applies a changed "Voice volume" right away. */
export function updateVoiceVolume(): void {
  if (bus) bus.gain.value = settings.voiceVolume;
}
