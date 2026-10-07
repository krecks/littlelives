/**
 * The game host owns everything that should outlive a single session — the canvas, the
 * renderer (engine, compiled shaders, cached meshes, landscape) — and prepares sessions
 * in the background, so "Continue" and "Move in" don't stall the page.
 */

import { BabylonRenderer } from '../render/babylon/BabylonRenderer';
import type { Renderer } from '../render/types';
import { qualityFromSettings, RESTART_KEYS, type Settings } from '../settings/settings.svelte';
import { app } from '../ui/app.svelte';
import { game } from '../ui/state.svelte';
import { loadGameData, startSession, type GameSession, type StartRequest } from './session';

function requestKey(r: StartRequest): string {
  return r.kind === 'load'
    ? `load:${r.saveId}`
    : `new:${r.town.name}:${r.slot}:${r.household.name}:${r.household.members.map((m) => m.uid).join(',')}`;
}

class GameHost {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLDivElement;
  private readonly root: HTMLDivElement;
  private renderer: Promise<Renderer> | null = null;
  private rendererKey = '';
  private current: { key: string; session: Promise<GameSession>; live: boolean; backdrop: boolean } | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'game-host';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene';
    this.canvas.tabIndex = -1;
    this.overlay = document.createElement('div');
    this.overlay.className = 'world-overlay';
    this.root.append(this.canvas, this.overlay);
  }

  /** Places the canvas in the page (once, behind every screen). */
  mount(container: HTMLElement): void {
    if (this.root.parentElement !== container) container.appendChild(this.root);
  }

  /**
   * Starts a session in the background (paused, no input). Calling again with the same
   * request returns the same session; a different request replaces it.
   */
  prepare(request: StartRequest, settings: Settings): Promise<GameSession> {
    const key = requestKey(request);
    if (this.current?.key === key) return this.current.session;
    this.release();
    const entry: { key: string; session: Promise<GameSession>; live: boolean; backdrop: boolean } = {
      key,
      session: Promise.resolve(null as unknown as GameSession),
      live: false,
      backdrop: false,
    };
    entry.session = (async () => {
      const renderer = await this.rendererFor(settings);
      const s = await startSession(renderer, this.canvas, this.overlay, request, settings);
      await s.ready;
      // Warmed up: stop drawing until it's shown (as the game or as a menu backdrop).
      if (!entry.live && !entry.backdrop) renderer.setActive(false);
      return s;
    })();
    const session = entry.session;
    this.current = entry;
    session.catch(() => {
      if (this.current?.session === session) this.current = null;
    });
    return session;
  }

  /** Prepares (or reuses) the session and makes it live. */
  async start(request: StartRequest, settings: Settings): Promise<GameSession> {
    const pending = this.prepare(request, settings);
    if (this.current) this.current.live = true;
    const session = await pending;
    app.liveBackdrop = false;
    (await this.renderer)?.setActive(true);
    session.reveal();
    return session;
  }

  /** Shows a prepared session's scene behind the menus, slowly orbiting. */
  async showAsBackdrop(): Promise<void> {
    const current = this.current;
    if (!current || current.live) return;
    current.backdrop = true;
    await current.session;
    if (this.current !== current || !current.backdrop) return;
    const renderer = await this.renderer;
    renderer?.setIdleOrbit(true);
    renderer?.setActive(true);
    app.liveBackdrop = true;
  }

  /** Stops showing the prepared scene behind menus (it stays prepared). */
  async hideBackdrop(): Promise<void> {
    const current = this.current;
    app.liveBackdrop = false;
    if (!current || current.live) return;
    current.backdrop = false;
    (await this.renderer)?.setActive(false);
  }

  /** Ends the current session (if any); the renderer stays for the next one. */
  release(): void {
    const current = this.current;
    this.current = null;
    app.liveBackdrop = false;
    if (!current) return;
    void current.session.then((s) => s.dispose()).catch(() => {});
    void this.renderer?.then((r) => r.setActive(false));
    game.reset();
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
    return this.renderer;
  }
}

export const host = new GameHost();
