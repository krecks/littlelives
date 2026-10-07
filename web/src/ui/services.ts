/** Non-reactive handles the UI needs. Set once by the game layer before the HUD mounts. */

import type { AssetRegistry } from '../assets/registry';
import type { Content } from '../content/content';
import type { WallMode } from '../render/types';

export interface GameControls {
  setSpeed(speed: number): void;
  togglePause(): void;
  selectSim(id: number): void;
  joinCareer(career: number): void;
  quitCareer(): void;
  /** Send the selected Sim to another plot. */
  visit(plot: number): void;
  goHome(): void;
  /** The selected Sim starts social interaction `social` with `target`. */
  socialize(target: number, social: number): void;
  useObject(objectId: number, interaction: number): void;
  cancelAction(index: number): void;
  setWallMode(mode: WallMode): void;
  closeMenu(): void;
  openPauseMenu(): void;
}

/** `content` and `assets` are set once data has loaded; `controls` while a game is running. */
export const services = {} as {
  content: Content;
  assets: AssetRegistry;
  controls: GameControls;
};
