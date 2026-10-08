/** Non-reactive handles the UI needs. Set once by the game layer before the HUD mounts. */

import type { AssetRegistry } from '../assets/registry';
import type { EdgeEdit } from '../core/protocol';
import type { BuildTool, GameMode } from './state.svelte';
import type { Content } from '../content/content';
import type { SimPreviews, WallMode } from '../render/types';

export interface GameControls {
  setSpeed(speed: number): void;
  togglePause(): void;
  selectSim(id: number): void;
  /** Take level `level` (grade) of career `career` (catalog index). */
  joinCareer(career: number, level: number): void;
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
  setMode(mode: GameMode): void;
  /** Buy mode: start placing a new object from the catalog. */
  startPlacing(def: string): void;
  /** Buy mode: pick up an owned object to move it. */
  startMoving(objectId: number): void;
  rotatePlacing(): void;
  cancelPlacing(): void;
  sell(objectId: number): void;
  restyle(objectId: number, style: number): void;
  setHouseholdStyle(style: number): void;
  upgrade(objectId: number): void;
  /** Buy mode: pick a build tool (walls, doors, remove), or null for the furniture catalog. */
  setBuildTool(tool: BuildTool | null): void;
  build(edits: EdgeEdit[]): void;
  /** Saves a debug report (screenshot, game state, log) and returns where it went. */
  debugReport(note: string): Promise<string>;
}

/**
 * `content`, `assets` and `previews` (3D Sim previews and portraits) are set once data has
 * loaded; `controls` while a game is running.
 */
export const services = {} as {
  content: Content;
  assets: AssetRegistry;
  previews: SimPreviews;
  controls: GameControls;
};
