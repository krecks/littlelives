/** Top-level navigation: which screen is shown, and which modal is open on top of it. */

import type { HouseholdDraft } from '../game/household';
import type { StartRequest } from '../game/session';
import type { NeighbourhoodDraft } from '../game/town';

/**
 * New game: neighbourhood → household → home → game, or neighbourhood → play (take over a
 * household that already lives there) → game.
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
    this.screen = 'neighbourhood';
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
