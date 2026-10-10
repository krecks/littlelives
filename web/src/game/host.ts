/**
 * The game host owns everything that should outlive a single session — the canvas, the
 * renderer (engine, compiled shaders, cached meshes, landscape) — and prepares sessions
 * in the background, so "Continue" and "Move in" don't stall the page.
 *
 * Behind the menus it shows a town overview on the same renderer (`showTown`); a session can
 * be prepared meanwhile (its world builds hidden behind the overview). Starting a game then
 * flies the camera into the lot (same town) or fades through a veil (a saved game).
 */

import type { WorldStructure } from '../core/protocol';
import { BabylonRenderer } from '../render/babylon/BabylonRenderer';
import type { Renderer } from '../render/types';
import { qualityFromSettings, RESTART_KEYS, type Settings } from '../settings/settings.svelte';
import { app } from '../ui/app.svelte';
import { game } from '../ui/state.svelte';
import type { HouseholdDraft } from './household';
import { loadGameData, startSession, type GameSession, type StartRequest } from './session';

function requestKey(r: StartRequest): string {
  if (r.kind === 'load') return `load:${r.saveId}`;
  const members = (h: HouseholdDraft) => h.members.map((m) => m.uid).join(',');
  // The whole town counts: going back and changing the neighbours needs a new session.
  const town = `${r.town.name}:${r.town.seed}:${r.town.slots.map((s) => `${s.template}@${s.lot ?? 'medium'}`).join(',')}:${r.town.households.map((h) => `${h.slot}=${members(h.household)}`).join(';')}`;
  // A household edited after its session was prepared (back to step 2) needs a new one too.
  return `${r.existing ? 'play' : 'new'}:${r.mode ?? 'living'}:${town}:${r.slot}:${JSON.stringify(r.household)}`;
}

/** Seconds the camera takes to fly from the menu's view of a lot into the game. */
const FLY_IN = 1.3;
const VEIL_MS = 260;

interface Entry {
  key: string;
  /** Resolves once the session exists (before its scene is built). */
  started: Promise<GameSession>;
  /** Resolves once the session's scene is built and drawn. */
  session: Promise<GameSession>;
  live: boolean;
  /** The session's scene is built and drawn (its progress reports end). */
  ready: boolean;
}

class GameHost {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLDivElement;
  private readonly root: HTMLDivElement;
  /** Fades the canvas out and in when the scene changes completely (menu town <-> a saved game). */
  private readonly veil: HTMLDivElement;
  private renderer: Promise<Renderer> | null = null;
  private rendererKey = '';
  private current: Entry | null = null;
  /** The previous session letting go of the renderer; the next one starts after it. */
  private teardown: Promise<void> = Promise.resolve();
  /** The town the menus show (kept to show it again on a new renderer); null while in a game. */
  private town: { world: WorldStructure; minute: number } | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'game-host';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene';
    this.canvas.tabIndex = -1;
    this.overlay = document.createElement('div');
    this.overlay.className = 'world-overlay';
    this.veil = document.createElement('div');
    this.veil.className = 'scene-veil';
    this.root.append(this.canvas, this.veil, this.overlay);
  }

  /** Places the canvas in the page (once, behind every screen). */
  mount(container: HTMLElement): void {
    if (this.root.parentElement !== container) container.appendChild(this.root);
  }

  /** The shared renderer (created on first use). */
  rendererNow(settings: Settings): Promise<Renderer> {
    return this.renderer ?? this.rendererFor(settings);
  }

  /**
   * Shows `world` as the town overview behind the menus. The renderer keeps drawing while it is
   * shown; `app.liveBackdrop` turns true once it is on screen.
   */
  async showTown(world: WorldStructure, minute: number, settings: Settings): Promise<void> {
    // A game started meanwhile (e.g. Continue before the menu town finished loading): it owns the view.
    if (this.current?.live) return;
    this.town = { world, minute };
    const renderer = await this.rendererNow(settings);
    if (this.town?.world !== world || this.current?.live) return;
    if (!renderer.townShown) renderer.configure(liveOptions(settings));
    await renderer.showTown(world, minute);
    if (this.current?.live) {
      // Too late: the game went live while the town was being built. Take it away again.
      this.town = null;
      if (renderer.townShown) await renderer.hideTown(0);
      return;
    }
    if (this.town?.world !== world) return;
    this.syncActive(renderer);
    await renderer.framesRendered(2);
    if (this.town?.world === world) app.liveBackdrop = true;
  }

  /** Live settings while only the menus use the renderer (a running game applies its own). */
  applyMenuSettings(settings: Settings): void {
    if (!this.town || this.current?.live) return;
    void this.renderer?.then((r) => r.configure(liveOptions(settings)));
  }

  /**
   * Starts a session in the background (paused, no input). Calling again with the same
   * request returns the same session; a different request replaces it.
   */
  prepare(request: StartRequest, settings: Settings): Promise<GameSession> {
    const key = requestKey(request);
    if (this.current?.key === key) return this.current.session;
    this.release();
    const previous = this.teardown;
    const entry = { key, live: false, ready: false } as Entry;
    app.loading = { label: 'Getting ready', value: 0 };
    entry.started = (async () => {
      const renderer = await this.rendererFor(settings);
      // One session at a time on the shared renderer: a replaced one must finish clearing it first.
      await previous;
      if (this.current !== entry) throw new Error('Replaced by another game.');
      return startSession(renderer, this.canvas, this.overlay, request, settings, (label, value) => {
        if (this.current === entry && !entry.ready) app.loading = { label, value };
      });
    })();
    entry.session = entry.started.then(async (s) => {
      await s.ready;
      entry.ready = true;
      if (this.current === entry) app.loading = null;
      // Warmed up: stop drawing unless it's shown (as the game, or the menus' town is).
      if (this.current === entry) this.syncActive(await this.renderer);
      return s;
    });
    const session = entry.session;
    this.current = entry;
    session.catch(() => {
      if (this.current?.session !== session) return;
      this.current = null;
      app.loading = null;
    });
    return session;
  }

  /** Prepares (or reuses) the session and makes it live: flies (or fades) from the menus into it. */
  async start(request: StartRequest, settings: Settings): Promise<GameSession> {
    const pending = this.prepare(request, settings);
    const entry = this.current;
    if (entry) entry.live = true;
    const session = await pending;
    const renderer = await this.renderer;
    if (!renderer || this.current !== entry) return session;
    renderer.setActive(true);
    let veiled = false;
    if (renderer.townShown) {
      // The menus showed this very town (choosing a home or a household to play): fly into the lot. Otherwise fade.
      const meta = this.town?.world.meta;
      const same = request.kind === 'new' && !!meta && request.town.seed === meta.seed && request.town.width === this.town?.world.width;
      if (same && !reducedMotion()) {
        await renderer.hideTown(FLY_IN);
      } else {
        veiled = true;
        await this.setVeil(true);
        await renderer.hideTown(0);
        await renderer.framesRendered(3);
      }
    }
    this.town = null;
    app.liveBackdrop = false;
    if (this.current !== entry) return session;
    session.reveal();
    if (veiled) void this.setVeil(false);
    return session;
  }

  /** Ends the current session (if any); the renderer stays for the next one. */
  release(): void {
    const current = this.current;
    this.current = null;
    app.loading = null;
    if (!this.town) app.liveBackdrop = false;
    if (!current) return;
    const renderer = this.renderer;
    // Don't wait for the scene to be ready: a replaced session may never get there.
    this.teardown = current.started
      .then((s) => s.dispose())
      .catch(() => {})
      .then(() => renderer?.then((r) => this.syncActive(r)))
      .catch(() => {});
    game.reset();
  }

  /** Draws only while something is on screen: the game, or the menus' town. */
  private syncActive(renderer: Renderer | undefined | null): void {
    if (!renderer) return;
    renderer.setActive(!!this.current?.live || renderer.townShown);
  }

  private setVeil(on: boolean): Promise<void> {
    this.veil.classList.toggle('on', on);
    return new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : VEIL_MS));
  }

  /** The shared renderer; recreated only when a restart-only setting changed. */
  private async rendererFor(settings: Settings): Promise<Renderer> {
    const key = JSON.stringify(RESTART_KEYS.map((k) => settings[k]));
    if (this.renderer && key === this.rendererKey) return this.renderer;
    const old = this.renderer;
    this.rendererKey = key;
    this.renderer = (async () => {
      (await old?.catch(() => null))?.dispose();
      const { content, assets } = await loadGameData();
      const params = new URLSearchParams(location.search);
      const renderer = new BabylonRenderer({ assets, content, backend: settings.renderer }, qualityFromSettings(settings, params));
      await renderer.init(this.canvas);
      return renderer;
    })();
    // A new renderer while the menus show a town: show it there too.
    if (old && this.town) {
      const { world, minute } = this.town;
      void this.renderer.then(async (r) => {
        if (this.town?.world !== world) return;
        await r.showTown(world, minute);
        this.syncActive(r);
      });
    }
    return this.renderer;
  }
}

function liveOptions(s: Settings) {
  return { resolutionScale: s.resolutionScale, cameraSensitivity: s.cameraSensitivity, visualStyle: s.visualStyle };
}

function reducedMotion(): boolean {
  return document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const host = new GameHost();
