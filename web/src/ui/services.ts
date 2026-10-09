/** Non-reactive handles the UI needs. Set once by the game layer before the HUD mounts. */

import type { AssetRegistry } from '../assets/registry';
import type { EdgeEdit, FacePaint, GoalIn, RoutineIn, SocialEvent } from '../core/protocol';
import type { BuildTool, BuyFilter, GameMode } from './state.svelte';
import type { Content } from '../content/content';
import type { HouseholdDraft } from '../game/household';
import type { ItemPreviews, SimPreviews, WallMode } from '../render/types';

export interface GameControls {
  setSpeed(speed: number): void;
  togglePause(): void;
  /** Picks who acts on orders (a member of the player's household). */
  selectSim(id: number): void;
  /** Opens a resident's panel (anyone; null closes it). */
  inspect(id: number | null): void;
  /** The camera follows a resident, also to other lots (null: back home). */
  follow(id: number | null): void;
  /** The camera starts watching on its own now (the director). */
  watch(): void;
  /** Watch mode (true: the camera follows the household on its own) or Live mode; also leaves Buy and Build. */
  setWatchMode(watch: boolean): void;
  /** Frames the whole house. */
  frameHouse(): void;
  /** Opens or closes the journal (the story so far). */
  toggleJournal(): void;
  /** Shows the people of a story event, if they're at home. */
  showEvent(event: SocialEvent): void;
  /** Opens the planner on a resident (default: the one looked at) or the household's template. */
  openPlanner(who?: number | 'household'): void;
  /** A resident's own routine (null: the household's template). */
  setRoutines(sim: number | null, routines: RoutineIn[]): void;
  skipHouseholdRoutine(sim: number, routine: number, skip: boolean): void;
  addGoal(sim: number, goal: GoalIn): void;
  removeGoal(sim: number, index: number): void;
  acceptSuggestion(sim: number, index: number): void;
  dismissSuggestion(sim: number, index: number): void;
  /** Buy mode with only items that fit (a wish, a goal). */
  openCatalog(filter: BuyFilter): void;
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
  /** Turns what's in hand (or picked) by a quarter; `fine`: by 15°, for things that turn freely. */
  rotatePlacing(fine?: boolean): void;
  cancelPlacing(): void;
  sell(objectId: number): void;
  /** Pays for a quick fix of something worn or broken at home (free in Creative). */
  repair(objectId: number): void;
  /** Buy and Build mode: takes back the last edit (Ctrl/⌘+Z). */
  undo(): void;
  /** Buy and Build mode: makes the last undone edit again (Ctrl/⌘+Shift+Z, Ctrl+Y). */
  redo(): void;
  restyle(objectId: number, style: number): void;
  setHouseholdStyle(style: number): void;
  upgrade(objectId: number): void;
  /** Build and Buy mode: arms (or disarms) the eyedropper: the next click picks up a look (E). */
  toggleEyedropper(): void;
  /** Build mode: the roof over the home (a roof style and colour). */
  setRoof(style: number, color: number): void;
  /** Build mode: pick a tool (walls, rooms, doors, windows, remove); switches to Build mode. */
  setBuildTool(tool: BuildTool): void;
  build(edits: EdgeEdit[]): void;
  /** Build mode: cover wall faces (paint, wallpaper, brick...). */
  paint(faces: FacePaint[]): void;
  /** A family moves into the home (it arrives at the front of the lot); Live mode shows them arrive. */
  moveIn(household: HouseholdDraft): void;
  /** Saves a debug report (screenshot, game state, log) and returns where it went. */
  debugReport(note: string): Promise<string>;
}

/**
 * `content`, `assets`, `previews` (3D Sim previews and portraits) and `items` (furniture pictures)
 * are set once data has loaded; `controls` while a game is running.
 */
export const services = {} as {
  content: Content;
  assets: AssetRegistry;
  previews: SimPreviews;
  /** Catalog pictures of furniture. */
  items: ItemPreviews;
  controls: GameControls;
};
