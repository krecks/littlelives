/** Top-level navigation: which screen is shown, and which modal is open on top of it. */

import type { HouseholdDraft } from '../game/household';
import type { StartRequest } from '../game/session';
import type { NeighbourhoodDraft } from '../game/town';

/** New game: neighbourhood → household → home → game. */
export type Screen = 'menu' | 'neighbourhood' | 'create' | 'home' | 'game';
export type Overlay = 'settings' | 'load' | 'credits' | null;

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
  /** A live 3D scene is rendering behind the menus. */
  liveBackdrop = $state(false);

  newGame(): void {
    this.town = null;
    this.household = null;
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
