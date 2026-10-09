/** Top-level navigation: which screen is shown, and which modal is open on top of it. */

import type { GameKind, Lifespan } from '../core/protocol';
import type { HouseholdDraft } from '../game/household';
import type { StartRequest } from '../game/session';
import { EMPTY_LOT, withLot, type NeighbourhoodDraft } from '../game/town';

/**
 * New game: neighbourhood → household → home → game; neighbourhood → home → game (build first,
 * a family moves in later); or neighbourhood → play (take over a household that already lives
 * there) → game.
 */
export type Screen = 'menu' | 'neighbourhood' | 'create' | 'home' | 'play' | 'game';
export type Overlay = 'settings' | 'load' | 'credits' | null;
/** A loading step and the overall progress, 0..1. */
export interface Progress {
  label: string;
  value: number;
}

class AppState {
  screen = $state<Screen>('menu');
  overlay = $state<Overlay>(null);
  /** What the game screen should start; bumping `sessionKey` restarts it. */
  request = $state.raw<StartRequest | null>(null);
  sessionKey = $state(0);
  dataReady = $state(false);
  fatal = $state('');
  /** Drafts kept while moving back and forth through the new-game steps. */
  town = $state.raw<NeighbourhoodDraft | null>(null);
  household = $state.raw<HouseholdDraft | null>(null);
  /** Living (the residents earn the money) or Creative (building is free). */
  mode = $state<GameKind>('living');
  /** How fast residents age (the new game's choice). */
  lifespan = $state<Lifespan>('normal');
  /** Build first: the new game starts without a household (the draft is kept for going back). */
  buildFirst = $state(false);
  /** The home is an empty lot (its house cleared away) rather than the house as it stands. */
  emptyLot = $state(false);
  /** House picked on the home screen (prepared in the background). */
  homeSlot = $state<number | null>(null);
  /** Home of the neighbour household picked to play (prepared in the background). */
  playSlot = $state<number | null>(null);
  /** A live 3D scene is rendering behind the menus. */
  liveBackdrop = $state(false);
  /**
   * Start-up: everything the menus and "Continue" need is loaded first (game data, renderer,
   * the menu's town, the latest save) behind a loading screen; the menu shows after.
   */
  booting = $state(true);
  boot = $state.raw<Progress>({ label: 'Loading', value: 0 });
  /** The game being prepared (null when none is): what it is loading and how far along. */
  loading = $state.raw<Progress | null>(null);

  newGame(): void {
    this.town = null;
    this.household = null;
    this.playSlot = null;
    this.buildFirst = false;
    this.emptyLot = false;
    this.screen = 'neighbourhood';
  }

  /** The town as the home screen shows it: the chosen lot cleared when starting on an empty lot. */
  homeTown(slot: number): NeighbourhoodDraft | null {
    const town = this.town;
    if (!town) return null;
    return this.emptyLot ? withLot(town, slot, EMPTY_LOT) : town;
  }

  /** The new game the home screen starts on `slot` (also prepared in the background). */
  homeRequest(slot: number): StartRequest | null {
    const town = this.homeTown(slot);
    const household = this.buildFirst ? null : this.household;
    if (!town || (!household && !this.buildFirst)) return null;
    return { kind: 'new', town, household, slot, mode: this.mode, lifespan: this.lifespan };
  }

  start(request: StartRequest): void {
    this.request = request;
    this.overlay = null;
    this.sessionKey++;
    this.screen = 'game';
  }

  toMenu(): void {
    this.overlay = null;
    this.request = null;
    this.screen = 'menu';
  }
}

export const app = new AppState();
