/** Saves a debug report (F8 or the button in the performance overlay) and tells the player where it went. */

import { services } from './services';
import { game, toast } from './state.svelte';

export async function saveDebugReport(note = ''): Promise<string | null> {
  if (game.debugSaving) return null;
  game.debugSaving = true;
  try {
    const path = await services.controls.debugReport(note);
    toast(`Debug report saved: ${path}`, 6000);
    return path;
  } catch (err) {
    console.error('[debug] report failed', err);
    toast(`Couldn't save the debug report: ${err instanceof Error ? err.message : String(err)}`, 6000);
    return null;
  } finally {
    game.debugSaving = false;
  }
}
