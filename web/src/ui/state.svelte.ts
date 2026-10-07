/** Reactive UI state. Written by the game layer at ~10 Hz, read by components. */

import type { HouseholdInfo, PlotInfo, RelationshipView, SimInfo, SimView, SocialEvent, SocialOption } from '../core/protocol';
import type { RenderStats, WallMode } from '../render/types';

export interface MenuState {
  objectId: number;
  title: string;
  /** Canvas-relative CSS pixels. */
  x: number;
  y: number;
  items: { label: string; index: number }[];
}

export interface SocialMenuState {
  target: number;
  x: number;
  y: number;
  /** Null while loading. */
  options: SocialOption[] | null;
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
  funds = $state(0);
  /** Plot currently shown. */
  viewPlot = $state<number | null>(null);
  selected = $state(0);
  wallMode = $state<WallMode>('down');
  menu = $state.raw<MenuState | null>(null);
  perfOpen = $state(false);
  stats = $state.raw<RenderStats | null>(null);
  sharedMemory = $state(false);
  toasts = $state.raw<Toast[]>([]);

  selectedSim = $derived(this.sims.find((s) => s.id === this.selected) ?? null);

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
    this.day = 1;
    this.minute = 480;
  }
}

export const game = new GameState();

let toastId = 0;
export function toast(text: string, ms = 3500): void {
  const id = ++toastId;
  game.toasts = [...game.toasts, { id, text }];
  setTimeout(() => (game.toasts = game.toasts.filter((t) => t.id !== id)), ms);
}
