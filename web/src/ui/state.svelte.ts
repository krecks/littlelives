/** Reactive UI state. Written by the game layer at ~10 Hz, read by components. */

import type { Catalog, HouseholdInfo, ObjectPlacement, PlotInfo, RelationshipView, Routine, SimInfo, SimView, SocialEvent, SocialOption } from '../core/protocol';
import type { RenderStats, WallMode } from '../render/types';

export interface MenuState {
  objectId: number;
  title: string;
  /** Canvas-relative CSS pixels. */
  x: number;
  y: number;
  /** `cost` is charged when chosen (shown, and checked against funds). */
  items: { label: string; index: number; disabled?: boolean; cost?: number }[];
}

/** Live: play. Buy: furnish (place, move, upgrade, sell). Build: walls, rooms, doors and windows. */
export type GameMode = 'live' | 'buy' | 'build';
export type BuildTool = 'wall' | 'room' | 'paint' | 'floor' | 'door' | 'window' | 'remove';

/** What Build mode puts up: wall covering (0: automatic, else wall covering + 1) and form, door and window style. */
export interface BuildLook {
  cover: number;
  /** Floor covering (0: automatic, by room; else a floor covering + 1). */
  floor: number;
  /** 0 full height, 1 half wall. */
  form: number;
  door: number;
  window: number;
}

/** An object being placed in buy mode: a new purchase, or an owned object being moved. */
export interface Placing {
  def: string;
  rot: number;
  /** Degrees past `rot`, for objects that turn freely. */
  turn: number;
  /** Set when moving an object the household already owns. */
  objectId: number | null;
}

export interface SocialMenuState {
  target: number;
  x: number;
  y: number;
  /** Null while loading. */
  options: SocialOption[] | null;
}

/** Catalog filter from the planner: items that offer an activity (training a skill), for someone. */
export interface BuyFilter {
  label: string;
  activity: string;
  skill?: string | null;
}

export interface FeedEntry {
  event: SocialEvent;
  at: number;
}

export interface Toast {
  id: number;
  text: string;
}

class GameState {
  day = $state(1);
  minute = $state(480);
  speed = $state(1);
  /** Replaced wholesale on each update; raw avoids deep proxies. */
  /** A debug report is being saved. */
  debugSaving = $state(false);
  sims = $state.raw<SimView[]>([]);
  /** Static per-Sim info (appearance, traits) from the world structure. */
  roster = $state.raw<SimInfo[]>([]);
  households = $state.raw<HouseholdInfo[]>([]);
  plots = $state.raw<PlotInfo[]>([]);
  relationships = $state.raw<RelationshipView[]>([]);
  socialMenu = $state.raw<SocialMenuState | null>(null);
  feed = $state.raw<FeedEntry[]>([]);
  household = $state('');
  pauseMenu = $state(false);
  townOpen = $state(false);
  weekday = $state(0);
  /** The player's household (build and buy are addressed to it; nobody may live there yet). */
  home = $state(0);
  /** A Creative game: building and buying are free, and the home pays no rent or bills. */
  creative = $state(false);
  funds = $state(0);
  /** Weekly rent of the player's home (null if none is charged). */
  rent = $state<number | null>(null);
  /** Weekly bills of the player's home: they grow with what the household owns. */
  bills = $state<number | null>(null);
  /** The household's favourite object style (index into content styles). */
  householdStyle = $state(0);
  /** Careers and build/buy rules from the simulation. */
  catalog = $state.raw<Catalog | null>(null);
  objects = $state.raw<ObjectPlacement[]>([]);
  mode = $state<GameMode>('live');
  placing = $state.raw<Placing | null>(null);
  /** Owned object picked in buy mode. */
  buySelection = $state<number | null>(null);
  /** Build mode's tool (kept between visits). */
  buildTool = $state<BuildTool>('wall');
  /** The looks Build mode's tools use (kept between visits). */
  buildLook = $state<BuildLook>({ cover: 0, floor: 1, form: 0, door: 0, window: 0 });
  /** Paint tool: wall faces under the preview, and whether Shift (a whole room) is held. */
  paintFaces = $state(0);
  /** Floor tool: tiles under the preview. */
  floorTiles = $state(0);
  /** Build and buy edits that can be taken back (until time moves on). */
  undoSteps = $state(0);
  /** Edits taken back that can be made again (until the next edit, or time moves on). */
  redoSteps = $state(0);
  /** Remove tool: the preview walls up doors and windows (rather than tearing walls down). */
  buildWallUp = $state(false);
  /** Wall being drawn: its first corner, and the cost of the preview. */
  buildStart = $state.raw<{ x: number; z: number } | null>(null);
  buildCost = $state(0);
  /** Wall edges the build preview changes, and whether it can be built (for the cursor tag). */
  buildEdges = $state(0);
  buildValid = $state(true);
  /** The Room tool's rectangle in tiles while one is drawn. */
  buildRoom = $state.raw<[number, number] | null>(null);
  /** Whether the object in hand fits where the pointer is. */
  placeValid = $state(true);
  /** Why the item in hand doesn't fit where it points ("Goes outdoors"); null for the usual reason. */
  placeHint = $state<string | null>(null);
  jobBoardOpen = $state(false);
  /** Plot currently shown. */
  viewPlot = $state<number | null>(null);
  /** Who acts on orders (a member of the player's household). */
  selected = $state(0);
  /** Resident whose panel is open (anyone; orders only for the player's household); null: just watching. */
  inspected = $state<number | null>(null);
  /** Resident the camera follows (also to other lots); null: the camera stays home. */
  follow = $state<number | null>(null);
  /** The camera is watching on its own (the director). */
  watching = $state(false);
  /** The mouse moved lately: a quiet interface shows itself again for a moment. */
  hudAwake = $state(false);
  journalOpen = $state(false);
  /** The planner is open, on a resident (id) or the household's template. */
  plannerOpen = $state(false);
  plannerFor = $state<number | 'household'>('household');
  /** The household creator is open over the game: a family moving into the home. */
  moveInOpen = $state(false);
  /** The player household's routine template. */
  householdRoutines = $state.raw<Routine[]>([]);
  /** Buy mode shows only what this filter allows (a wish, a goal); null: everything. */
  buyFilter = $state.raw<BuyFilter | null>(null);
  /** The story so far (the whole log, fetched when the journal opens, then kept up to date). */
  journal = $state.raw<SocialEvent[]>([]);
  wallMode = $state<WallMode>('cutaway');
  menu = $state.raw<MenuState | null>(null);
  perfOpen = $state(false);
  stats = $state.raw<RenderStats | null>(null);
  sharedMemory = $state(false);
  toasts = $state.raw<Toast[]>([]);

  /** Whether the household can pay `cost` for building or buying (always, in Creative). */
  affords(cost: number): boolean {
    return this.creative || cost <= this.funds;
  }

  /** Somebody lives in the player's home (false: build first, a family moves in later). */
  occupied = $derived(this.roster.some((s) => this.households[s.household]?.player));

  selectedSim = $derived(this.sims.find((s) => s.id === this.selected) ?? null);
  inspectedSim = $derived(this.inspected === null ? null : (this.sims.find((s) => s.id === this.inspected) ?? null));

  /** Clears per-session state when leaving a game. */
  reset(): void {
    this.sims = [];
    this.roster = [];
    this.households = [];
    this.plots = [];
    this.relationships = [];
    this.socialMenu = null;
    this.feed = [];
    this.menu = null;
    this.pauseMenu = false;
    this.townOpen = false;
    this.viewPlot = null;
    this.stats = null;
    this.selected = 0;
    this.inspected = null;
    this.follow = null;
    this.watching = false;
    this.journalOpen = false;
    this.journal = [];
    this.plannerOpen = false;
    this.moveInOpen = false;
    this.buyFilter = null;
    this.day = 1;
    this.minute = 480;
    this.mode = 'live';
    this.placing = null;
    this.buySelection = null;
    this.buildTool = 'wall';
    this.buildStart = null;
    this.undoSteps = 0;
    this.redoSteps = 0;
    this.jobBoardOpen = false;
    this.objects = [];
    this.catalog = null;
    this.home = 0;
    this.creative = false;
  }
}

export const game = new GameState();

/** Walls up → cutaway → down → up (the W key and the top-bar button). */
export function nextWallMode(mode: WallMode): WallMode {
  return mode === 'up' ? 'cutaway' : mode === 'cutaway' ? 'down' : 'up';
}

let toastId = 0;
export function toast(text: string, ms = 3500): void {
  const id = ++toastId;
  game.toasts = [...game.toasts, { id, text }];
  setTimeout(() => (game.toasts = game.toasts.filter((t) => t.id !== id)), ms);
}
