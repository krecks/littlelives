/**
 * The live 3D scene behind the menus: which town the overview shows (a showcase neighbourhood
 * on the main menu, the draft being edited during a new game), its camera shots, lot
 * highlights, labels pinned to lots and lot picking. Screens call this; it reaches the renderer
 * through the host (never the sim worker).
 */

import { groundDepth, type WorldStructure } from '../core/protocol';
import type { LotHighlight, Renderer, TownShot } from '../render/types';
import { settings } from '../settings/settings.svelte';
import { services } from '../ui/services';
import { host } from './host';
import { generateNeighbourhood, loadTemplates, type NeighbourhoodDraft, type Templates } from './town';
import { previewWorld } from './townPreview';

/** Golden hour on the title screen: low warm sun, long shadows, no lamps yet. */
export const MENU_MINUTE = 18 * 60 + 20;
/** Late afternoon while building the household: warm but brighter (sim faces, town detail). */
const CREATE_MINUTE = 17 * 60 + 30;
/** The overview while choosing: clear afternoon light, houses read best from above. */
const OVERVIEW_MINUTE = 16 * 60 + 40;

/** Screen rectangle in CSS pixels (as `getBoundingClientRect`). */
export interface Frame {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Shot =
  /** Main menu: a slow, low orbit, the town to the right of the menu panel. */
  | { kind: 'menu' }
  /** Behind character creation: closer, slower. */
  | { kind: 'create' }
  /** The whole neighbourhood from above, framed into `frame`. */
  | { kind: 'overview'; frame: Frame }
  /** One lot as the game will first show it, framed into `frame`. */
  | { kind: 'lot'; plot: number; frame: Frame };

const NO_HIGHLIGHT: LotHighlight = { hover: null, selected: null, marked: [], outlines: false };

class MenuScene {
  private templates: Templates | null = null;
  private showcase: NeighbourhoodDraft | null = null;
  private draft: NeighbourhoodDraft | null = null;
  private world: WorldStructure | null = null;
  private worldOf: NeighbourhoodDraft | null = null;
  private shotKey = '';
  private wanted: { shot: Shot; duration: number } | null = null;
  /** Tags of lots outside this screen area stay at its edge (pointing the way). */
  private bounds: Frame | null = null;
  private renderer: Renderer | null = null;
  private readonly labels = new Map<number, Label>();
  private readonly out = { x: 0, y: 0 };
  /** UI on top of the town that tags must keep clear of (buttons, hint bars). */
  private readonly obstacles = new Set<HTMLElement>();
  /** Lots whose tags win when tags compete for space. */
  private focusPlots: [number | null, number | null] = [null, null];
  private readonly sizes = new ResizeObserver((entries) => {
    for (const e of entries) {
      for (const label of this.labels.values()) {
        if (label.el.firstElementChild !== e.target) continue;
        const r = e.target.getBoundingClientRect();
        // Measured without hover lift/scale changes mattering much; zoom (UI scale) is included.
        label.w = r.width;
        label.h = r.height;
      }
    }
  });

  /** The main menu's neighbourhood (generated once per visit to the page). */
  async showcaseDraft(): Promise<NeighbourhoodDraft> {
    if (this.showcase) return this.showcase;
    const templates = (this.templates ??= await loadTemplates());
    this.showcase ??= generateNeighbourhood(services.content, services.assets, templates, 'medium');
    return this.showcase;
  }

  /**
   * Shows a neighbourhood behind the menus (the renderer rebuilds it only when its layout
   * changed). Again after a game, too: starting one hides the overview.
   */
  async show(draft: NeighbourhoodDraft): Promise<void> {
    if (draft === this.draft && this.renderer?.townShown) return;
    this.draft = draft;
    const templates = (this.templates ??= await loadTemplates());
    const world = this.world && this.worldOf === draft ? this.world : previewWorld(services.content, templates, draft);
    const renderer = await host.rendererNow({ ...settings });
    if (this.draft !== draft) return;
    this.world = world;
    this.worldOf = draft;
    this.attach(renderer);
    for (const [plot, label] of this.labels) this.anchor(plot, label);
    this.applyShot();
    await host.showTown(world, MENU_MINUTE, { ...settings });
  }

  /** The town currently shown. */
  get shown(): NeighbourhoodDraft | null {
    return this.draft;
  }

  /** Points the camera (applied once the town is shown); repeated identical shots are ignored. */
  shoot(shot: Shot, duration = 1.6): void {
    this.wanted = { shot, duration };
    this.applyShot();
  }

  private applyShot(): void {
    const world = this.world;
    const renderer = this.renderer;
    if (!world || !renderer || !this.wanted) return;
    const { shot, duration } = this.wanted;
    this.bounds = shot.kind === 'overview' || shot.kind === 'lot' ? shot.frame : null;
    const key = `${JSON.stringify(shot)}|${world.width}x${groundDepth(world)}|${window.innerWidth}x${window.innerHeight}`;
    if (key === this.shotKey) return;
    const first = this.shotKey === '';
    this.shotKey = key;
    renderer.setTownShot(this.townShot(shot, world, duration), first);
  }

  highlight(h: Partial<LotHighlight>): void {
    this.focusPlots = [h.selected ?? null, h.hover ?? null];
    this.renderer?.setLotHighlight({ ...NO_HIGHLIGHT, ...h });
  }

  /** Keeps lot tags clear of `el` (a button or bar over the town). Returns a detach function. */
  avoid(el: HTMLElement): () => void {
    this.obstacles.add(el);
    return () => this.obstacles.delete(el);
  }

  /** Orbit / zoom from the player's drag and wheel on the town. */
  nudge(dAlpha: number, zoom: number): void {
    this.renderer?.nudgeTown(dAlpha, zoom);
  }

  /** Plot under a screen point (CSS pixels), if any. */
  plotAt(x: number, y: number): number | null {
    const ground = this.renderer?.townShown ? this.renderer.pick(x, y).ground : null;
    if (!ground || !this.world) return null;
    const p = this.world.plots.find((p) => ground.x >= p.x && ground.x < p.x + p.w && ground.z >= p.z && ground.z < p.z + p.d);
    return p ? p.id : null;
  }

  /** Pins `el` above a plot (its house's roof); positioned every frame while shown. Returns a detach function. */
  pin(plot: number, el: HTMLElement): () => void {
    const entry: Label = { el, x: 0, y: -1000, z: 0, px: NaN, py: NaN, shown: false, edge: false, w: 150, h: 40, sx: 0, sy: 0, order: 0 };
    el.style.visibility = 'hidden';
    this.labels.set(plot, entry);
    this.anchor(plot, entry);
    const tag = el.firstElementChild;
    if (tag) this.sizes.observe(tag);
    return () => {
      if (tag) this.sizes.unobserve(tag);
      if (this.labels.get(plot) === entry) this.labels.delete(plot);
    };
  }

  /** Label anchor: above the middle of the house's roof (or the middle of the lot). */
  private anchor(plot: number, label: { x: number; y: number; z: number; px: number }): void {
    const p = this.world?.plots[plot];
    if (!p) return;
    const [x0, z0, x1, z1] = p.house ?? [p.x + p.w / 2, p.z + p.d / 2, p.x + p.w / 2, p.z + p.d / 2];
    label.x = (x0 + x1) / 2;
    label.y = p.house ? 7.2 : 5;
    label.z = (z0 + z1) / 2;
    label.px = NaN;
  }

  /** Where the game camera will look at a lot first (as the renderer frames a lot on arrival). */
  private lotAlpha(plot: number, world: WorldStructure): number {
    const p = world.plots[plot];
    const dx = p.entry ? p.entry[0] - (p.x + p.w / 2) : 0;
    const dz = p.entry ? p.entry[1] - (p.z + p.d / 2) : 1;
    return Math.atan2(dz, dx) - Math.PI * 0.12;
  }

  private townShot(shot: Shot, world: WorldStructure, duration: number): TownShot {
    const t = this.baseShot(shot, world, duration);
    // Reduced motion: no drifting camera, short glides.
    if (document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { ...t, sway: 0, drift: 0, duration: Math.min(t.duration ?? 0, 0.25) };
    }
    return t;
  }

  private baseShot(shot: Shot, world: WorldStructure, duration: number): TownShot {
    const town = { x: 0, z: 0, w: world.width, d: groundDepth(world) };
    // The built-up part (plots and street), without the empty margin.
    const plots = world.plots.length
      ? {
          x: Math.min(...world.plots.map((p) => p.x)),
          z: Math.min(...world.plots.map((p) => p.z)),
          w: Math.max(...world.plots.map((p) => p.x + p.w)) - Math.min(...world.plots.map((p) => p.x)),
          d: Math.max(...world.plots.map((p) => p.z + p.d)) - Math.min(...world.plots.map((p) => p.z)),
        }
      : town;
    const W = window.innerWidth;
    const H = window.innerHeight;
    switch (shot.kind) {
      case 'menu':
        // Low, towards the evening sun: backlit roofs, glow over the hills.
        return { focus: plots, frame: { left: W * 0.36, top: H * 0.12, right: W * 0.99, bottom: H * 0.96 }, beta: 1.32, alpha: 0.55, zoom: 1.55, sway: 0.32, duration, minute: MENU_MINUTE };
      case 'create':
        return { focus: plots, frame: { left: W * 0.12, top: H * 0.1, right: W * 0.88, bottom: H * 0.98 }, beta: 1.3, alpha: 0.9, zoom: 1.8, sway: 0.25, duration, minute: CREATE_MINUTE };
      case 'overview':
        return { focus: plots, frame: shot.frame, beta: 0.8, alpha: -Math.PI / 2 + 0.32, zoom: 1.04, drift: 0, duration, minute: OVERVIEW_MINUTE };
      case 'lot': {
        // The lot with a strip of its neighbours around it, from the side the game opens on.
        const p = world.plots[shot.plot];
        const mx = p.w * 0.45;
        const mz = p.d * 0.25;
        const focus = { x: p.x - mx, z: p.z - mz, w: p.w + mx * 2, d: p.d + mz * 2 };
        return { focus, frame: shot.frame, beta: 0.86, alpha: this.lotAlpha(shot.plot, world), zoom: 1, drift: 0, duration, minute: OVERVIEW_MINUTE };
      }
    }
  }

  private attach(renderer: Renderer): void {
    if (this.renderer === renderer) return;
    this.renderer = renderer;
    this.shotKey = '';
    renderer.onTownFrame(this.positionLabels);
  }

  /**
   * Per overview frame: lays out the pinned tags in screen space. Each tag wants to sit above its
   * lot, inside the stage; in priority order (selected and hovered lots first, then nearer lots,
   * i.e. lower on screen) each takes the free spot nearest to that, next to the tags already
   * placed and clear of the UI over the town. Writes transforms only for tags that moved.
   */
  private readonly positionLabels = () => {
    const r = this.renderer;
    if (!r || !this.labels.size) return;
    const b = this.bounds;
    const area = b ? { left: b.left + 8, top: b.top + 8, right: b.right - 8, bottom: b.bottom - 6 } : { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    const blocks: Box[] = [];
    for (const el of this.obstacles) {
      if (!el.isConnected) continue;
      const o = el.getBoundingClientRect();
      if (o.width && o.height) blocks.push({ l: o.left - 6, t: o.top - 6, r: o.right + 6, b: o.bottom + 6 });
    }
    const placed: Label[] = [];
    for (const [plot, label] of this.labels) {
      const visible = label.y > -100 && r.project(label.x, label.y, label.z, this.out);
      if (visible !== label.shown) {
        label.shown = visible;
        label.el.style.visibility = visible ? 'visible' : 'hidden';
      }
      if (!visible) continue;
      label.sx = this.out.x;
      label.sy = this.out.y;
      label.order = plot === this.focusPlots[0] ? -2e5 : plot === this.focusPlots[1] ? -1e5 : -this.out.y;
      placed.push(label);
    }
    placed.sort((a, c) => a.order - c.order);
    const done: Box[] = [];
    const clampX = (x: number, w: number) => Math.min(area.right - w / 2, Math.max(area.left + w / 2, x));
    const clampY = (y: number, h: number) => Math.min(area.bottom, Math.max(area.top + h, y));
    for (const label of placed) {
      const w = label.w;
      const h = label.h + STEM;
      // The anchor (x, y) is the stem's foot: the box spans [x - w/2, x + w/2] x [y - h, y].
      const wx = clampX(label.sx, w);
      const wy = clampY(label.sy, h);
      const free = (x: number, y: number) => {
        const box = { l: x - w / 2, t: y - h, r: x + w / 2, b: y };
        return !blocks.some((o) => overlaps(box, o)) && !done.some((o) => overlaps(box, o));
      };
      // Candidates: the wanted spot, and spots just beside every tag placed and every obstacle
      // (above, below, left, right and the diagonals); the free one nearest the lot wins.
      let x = wx;
      let y = wy;
      if (!free(wx, wy)) {
        let best = Infinity;
        const tryAt = (cx0: number, cy0: number) => {
          const cx = clampX(cx0, w);
          const cy = clampY(cy0, h);
          // Vertical moves read better than sideways ones (the tag stays over its column).
          const cost = Math.abs(cx - label.sx) * 1.4 + Math.abs(cy - label.sy);
          if (cost < best && free(cx, cy)) {
            best = cost;
            x = cx;
            y = cy;
          }
        };
        const around = [...done, ...blocks];
        for (const o of around) {
          for (const cx of [wx, o.l - w / 2 - 3, o.r + w / 2 + 3]) for (const cy of [wy, o.t - 3, o.b + h + 3]) tryAt(cx, cy);
        }
        // Crowded corner: combine edges of different boxes (rare, a little more work).
        if (best === Infinity) {
          const xs = [wx, ...around.flatMap((o) => [o.l - w / 2 - 3, o.r + w / 2 + 3])];
          const ys = [wy, ...around.flatMap((o) => [o.t - 3, o.b + h + 3])];
          for (const cx of xs) for (const cy of ys) tryAt(cx, cy);
        }
      }
      done.push({ l: x - w / 2, t: y - h, r: x + w / 2, b: y });
      const edge = Math.abs(x - label.sx) > 2 || Math.abs(y - label.sy) > 2;
      if (edge !== label.edge) {
        label.edge = edge;
        label.el.classList.toggle('edge', edge);
      }
      if (Math.abs(x - label.px) < 0.3 && Math.abs(y - label.py) < 0.3) continue;
      label.px = x;
      label.py = y;
      label.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  };
}

/** Height of a tag's stem below its body (see TownStage). */
const STEM = 10;

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

interface Label {
  el: HTMLElement;
  /** Anchor in the world (above the house). */
  x: number;
  y: number;
  z: number;
  /** Position written last (screen). */
  px: number;
  py: number;
  shown: boolean;
  /** Moved away from its lot (the stem is hidden). */
  edge: boolean;
  /** Tag size on screen (CSS pixels). */
  w: number;
  h: number;
  /** Projected anchor this frame, and layout priority. */
  sx: number;
  sy: number;
  order: number;
}

const overlaps = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

export const menuScene = new MenuScene();
