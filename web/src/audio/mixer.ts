/**
 * One audio context for the whole game, with a bus each for interface sounds (`ui/sfx.ts`),
 * resident voices (`voice/player.ts`) and the sounds of the world (`audio/world.ts`), each with
 * its own volume setting. The context starts on the first sound after a user gesture.
 */

import { settings } from '../settings/settings.svelte';

export type Bus = 'effects' | 'voices' | 'world';

/** Interface sounds are quiet by design. */
const EFFECTS_LEVEL = 0.5;

let ctx: AudioContext | null = null;
const buses = new Map<Bus, GainNode>();

export function audioContext(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** The bus's input, at its current volume. */
export function bus(name: Bus): GainNode | null {
  const ac = audioContext();
  if (!ac) return null;
  let gain = buses.get(name);
  if (!gain) {
    gain = ac.createGain();
    gain.connect(ac.destination);
    buses.set(name, gain);
  }
  gain.gain.value = level(name);
  return gain;
}

function level(name: Bus): number {
  switch (name) {
    case 'effects':
      return EFFECTS_LEVEL;
    case 'voices':
      return settings.voiceVolume;
    case 'world':
      return settings.worldSound ? settings.worldVolume : 0;
  }
}

/** Applies changed volume settings right away. */
export function updateVolumes(): void {
  for (const [name, gain] of buses) gain.gain.value = level(name);
}
