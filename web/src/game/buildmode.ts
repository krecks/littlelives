/**
 * Buy mode input: placing and moving objects on the home lot, and (with a build tool
 * picked) drawing walls and putting doors and windows into them. The simulation is the authority (it re-checks every edit and reports
 * problems as errors); this module only shows previews and sends commands.
 *
 * Walls and Remove work by press on a corner → drag → release (with a live preview and its
 * cost); a press and release without moving sets the start corner instead and the next click
 * finishes (click-then-click). Dragging at about 45° draws a diagonal run across tiles. Esc or a
 * right-click while drawing cancels. While drawing, left-drag doesn't turn the camera.
 */

import type { AssetRegistry } from '../assets/registry';
import type { Content, ObjectDef } from '../content/content';
import type { Command, EdgeEdit, PlotInfo, WorldStructure } from '../core/protocol';
import type { Renderer, ViewRect } from '../render/types';
import { game } from '../ui/state.svelte';

/** Preview calls the renderer offers in buy mode. */
interface BuildPreview {
  setPlacementGhost(ghost: { model: string; x: number; z: number; rot: number; w: number; d: number; valid: boolean } | null): void;
  setEdgePreview(edges: EdgeEdit[], valid: boolean): void;
  setBuildGrid(rect: ViewRect | null): void;
  /** Whether a left-drag turns the camera (off while drawing walls). */
  setLeftDragCamera(on: boolean): void;
}

type Point = { x: number; z: number };
type EdgeState = EdgeEdit['kind'];
type Axis = EdgeEdit['axis'];

/** A drag counts as diagonal within this angle of 45° (tan 22.5°: halfway to straight). */
const DIAGONAL_SLOPE = Math.tan(Math.PI / 8);

export class BuildBuyInput {
  private readonly preview: Partial<BuildPreview>;
  /** What stands on each wall edge now (`h:x:z` / `v:x:z` / `dp:x:z` / `dn:x:z`), for previews and costs. */
  private edges = new Map<string, EdgeState>();
  /** Direction of the diagonal across each tile (`x:z`), if any. */
  private diagonals = new Map<string, 'dp' | 'dn'>();
  /** A wall/remove press is held (the gesture belongs to drawing until release). */
  private pressed = false;
  /** That press started a new run (rather than finishing a click-then-click one). */
  private fresh = false;
  /** Esc or right-click cancelled the held press: ignore its release. */
  private dropped = false;
  /** Last ground point seen while drawing (used when the pointer leaves the lot). */
  private lastGround: Point | null = null;

  constructor(
    renderer: Renderer,
    private readonly content: Content,
    private readonly assets: AssetRegistry,
    private readonly send: (command: Command) => void,
  ) {
    this.preview = renderer as unknown as Partial<BuildPreview>;
  }

  /** Keeps the current walls, doors and windows (from each new world structure). */
  setStructure(world: WorldStructure): void {
    this.edges = new Map();
    this.diagonals = new Map();
    for (const e of world.walls ?? []) this.edges.set(`${e.axis}:${e.x}:${e.z}`, 'wall');
    for (const o of world.openings ?? []) this.edges.set(`${o.axis}:${o.x}:${o.z}`, o.kind);
    for (const d of world.diagonals ?? []) {
      this.edges.set(`${d.axis}:${d.x}:${d.z}`, d.kind);
      this.diagonals.set(`${d.x}:${d.z}`, d.axis);
    }
  }

  private edgeState(e: { axis: Axis; x: number; z: number }): EdgeState {
    return this.edges.get(`${e.axis}:${e.x}:${e.z}`) ?? 'open';
  }

  /** The player's home plot, where everything in buy mode happens. */
  home(): PlotInfo | null {
    const plot = game.households.find((h) => h.player)?.plot;
    return plot == null ? null : (game.plots[plot] ?? null);
  }

  /** Called when the mode changes: shows the grid and clears old previews. */
  modeChanged(): void {
    // Never leave the camera's left-drag switched off once drawing can't continue.
    if (!this.pressed) this.preview.setLeftDragCamera?.(true);
    const home = this.home();
    this.preview.setBuildGrid?.(game.mode !== 'live' && home ? { x: home.x, z: home.z, w: home.w, d: home.d } : null);
    this.clearPreviews();
  }

  clearPreviews(): void {
    this.preview.setPlacementGhost?.(null);
    this.preview.setEdgePreview?.([], true);
    game.buildCost = 0;
  }

  /** Model key for an object in a style, falling back to the plain model. */
  styledModel(def: ObjectDef, style: number): string {
    const id = this.content.styles[style]?.id;
    const key = id ? `${def.model}@${id}` : def.model;
    return id && this.assets.get(key, 'model') ? key : def.model;
  }

  /** Buy mode with a wall/door/window/remove tool in hand (otherwise: furniture). */
  private building(): boolean {
    return game.mode === 'buy' && game.buildTool !== null;
  }

  hover(ground: Point | null): void {
    // While drawing, keep the last preview when the pointer strays off the lot.
    if (!ground && this.pressed) return;
    if (!ground) return this.clearPreviews();
    if (this.pressed) this.lastGround = ground;
    if (this.building()) this.hoverBuild(ground);
    else if (game.mode === 'buy') this.hoverBuy(ground);
  }

  /** Returns true when the click was used. */
  click(ground: Point | null, objectId: number | null): boolean {
    if (this.building()) return ground ? this.clickBuild(ground) : true;
    if (game.mode === 'buy') return this.clickBuy(ground, objectId);
    return false;
  }

  // ---- Buy -------------------------------------------------------------------------

  private placement(ground: Point) {
    const placing = game.placing;
    const def = placing && this.content.object(placing.def);
    if (!placing || !def) return null;
    const [fw, fd] = def.footprint ?? [1, 1];
    const [w, d] = placing.rot % 2 === 0 ? [fw, fd] : [fd, fw];
    const x = Math.floor(ground.x - w / 2 + 0.5);
    const z = Math.floor(ground.z - d / 2 + 0.5);
    return { def, rot: placing.rot, x, z, w, d, valid: this.fits(x, z, w, d, placing.rot, placing.objectId, def) };
  }

  /** Same checks as the simulation, minus reachability: on the home plot, free tiles, affordable. */
  private fits(x: number, z: number, w: number, d: number, rot: number, moving: number | null, def: ObjectDef): boolean {
    const home = this.home();
    if (!home) return false;
    const onPlot = (tx: number, tz: number) => tx >= home.x && tz >= home.z && tx < home.x + home.w && tz < home.z + home.d;
    const taken = (tx: number, tz: number) =>
      game.objects.some((o) => o.id !== moving && tx >= o.x && tz >= o.z && tx < o.x + o.w && tz < o.z + o.d);
    for (let tz = z; tz < z + d; tz++) for (let tx = x; tx < x + w; tx++) if (!onPlot(tx, tz) || taken(tx, tz)) return false;
    const front = [
      [x + Math.floor((w - 1) / 2), z + d],
      [x + w, z + Math.floor((d - 1) / 2)],
      [x + Math.floor((w - 1) / 2), z - 1],
      [x - 1, z + Math.floor((d - 1) / 2)],
    ][rot % 4];
    if (!onPlot(front[0], front[1]) || taken(front[0], front[1])) return false;
    return moving !== null || game.funds >= (def.price ?? Infinity);
  }

  private hoverBuy(ground: Point): void {
    const p = this.placement(ground);
    if (!p) return this.preview.setPlacementGhost?.(null);
    const style = p && game.placing?.objectId != null ? (game.objects.find((o) => o.id === game.placing!.objectId)?.style ?? 0) : game.householdStyle;
    this.preview.setPlacementGhost?.({ model: this.styledModel(p.def, style), x: p.x, z: p.z, rot: p.rot, w: p.w, d: p.d, valid: p.valid });
  }

  private clickBuy(ground: Point | null, objectId: number | null): boolean {
    const placing = game.placing;
    if (placing) {
      const p = ground && this.placement(ground);
      if (!p) return true;
      if (placing.objectId !== null) {
        this.send({ type: 'moveObject', sim: game.selected, object: placing.objectId, x: p.x, z: p.z, rot: p.rot });
        game.placing = null;
        this.preview.setPlacementGhost?.(null);
      } else {
        // New purchases stay on the cursor so several can be placed in a row.
        this.send({ type: 'buy', sim: game.selected, object: p.def.id, at: [p.x, p.z, p.rot], style: game.householdStyle });
      }
      return true;
    }
    const home = this.home();
    const obj = objectId === null ? undefined : game.objects.find((o) => o.id === objectId);
    game.buySelection = obj && home && obj.x >= home.x && obj.z >= home.z && obj.x < home.x + home.w && obj.z < home.z + home.d ? obj.id : null;
    return true;
  }

  // ---- Build -----------------------------------------------------------------------

  private corner(ground: Point): Point {
    return { x: Math.round(ground.x), z: Math.round(ground.z) };
  }

  /** The wall edge nearest to a ground point: a grid edge, or the diagonal across its tile. */
  private nearestEdge(ground: Point): { axis: Axis; x: number; z: number } {
    const tx = Math.floor(ground.x);
    const tz = Math.floor(ground.z);
    const fx = ground.x - tx;
    const fz = ground.z - tz;
    const toGrid = Math.min(fz, 1 - fz, fx, 1 - fx);
    const diagonal = this.diagonals.get(`${tx}:${tz}`);
    if (diagonal) {
      // Distance to the diagonal line across this tile.
      const toDiagonal = (diagonal === 'dp' ? Math.abs(fx - fz) : Math.abs(fx + fz - 1)) / Math.SQRT2;
      if (toDiagonal < toGrid) return { axis: diagonal, x: tx, z: tz };
    }
    return Math.min(fz, 1 - fz) <= Math.min(fx, 1 - fx) ? { axis: 'h', x: tx, z: Math.round(ground.z) } : { axis: 'v', x: Math.round(ground.x), z: tz };
  }

  /**
   * The run of edges drawn from corner `a` towards the pointer: straight along the longer
   * direction, or diagonal (one tile per step, corner to corner) when the drag is near 45°.
   */
  private run(a: Point, ground: Point, kind: EdgeEdit['kind']): EdgeEdit[] {
    const edges: EdgeEdit[] = [];
    const vx = ground.x - a.x;
    const vz = ground.z - a.z;
    const ax = Math.abs(vx);
    const az = Math.abs(vz);
    if (Math.min(ax, az) > Math.max(ax, az) * DIAGONAL_SLOPE) {
      const n = Math.round((ax + az) / 2);
      const sx = Math.sign(vx);
      const sz = Math.sign(vz);
      const axis = sx === sz ? 'dp' : 'dn';
      for (let k = 0; k < n; k++) {
        edges.push({ axis, x: sx > 0 ? a.x + k : a.x - k - 1, z: sz > 0 ? a.z + k : a.z - k - 1, kind });
      }
      return edges;
    }
    const b = this.corner(ground);
    if (ax >= az) {
      for (let x = Math.min(a.x, b.x); x < Math.max(a.x, b.x); x++) edges.push({ axis: 'h', x, z: a.z, kind });
    } else {
      for (let z = Math.min(a.z, b.z); z < Math.max(a.z, b.z); z++) edges.push({ axis: 'v', x: a.x, z, kind });
    }
    return edges;
  }

  /** Doors and windows go into an existing wall with a single click. */
  private opening(): 'door' | 'window' | null {
    return game.buildTool === 'door' || game.buildTool === 'window' ? game.buildTool : null;
  }

  /** Walls and Remove: drawn by dragging (or click-then-click). */
  private drawing(): boolean {
    return this.building() && (game.buildTool === 'wall' || game.buildTool === 'remove');
  }

  private edits(ground: Point): EdgeEdit[] {
    const opening = this.opening();
    if (opening) return [{ ...this.nearestEdge(ground), kind: opening }];
    const kind = game.buildTool === 'remove' ? 'open' : 'wall';
    if (!game.buildStart) {
      // Before the first click: highlight the edge under the cursor.
      const e = this.nearestEdge(ground);
      return [{ ...e, kind }];
    }
    return this.run(game.buildStart, ground, kind);
  }

  private edgesOnHome(edges: EdgeEdit[]): boolean {
    const home = this.home();
    if (!home) return false;
    return edges.every((e) =>
      e.axis === 'h'
        ? e.x >= home.x && e.x < home.x + home.w && e.z >= home.z && e.z <= home.z + home.d
        : e.axis === 'v'
          ? e.x >= home.x && e.x <= home.x + home.w && e.z >= home.z && e.z < home.z + home.d
          : e.x >= home.x && e.x < home.x + home.w && e.z >= home.z && e.z < home.z + home.d,
    );
  }

  /** Diagonal walls can't cross furniture, nor a tile that has a diagonal the other way. */
  private diagonalsFit(edges: EdgeEdit[]): boolean {
    return edges.every((e) => {
      if ((e.axis !== 'dp' && e.axis !== 'dn') || e.kind === 'open') return true;
      const other = this.diagonals.get(`${e.x}:${e.z}`);
      if (other && other !== e.axis) return false;
      return !game.objects.some((o) => e.x >= o.x && e.z >= o.z && e.x < o.x + o.w && e.z < o.z + o.d);
    });
  }

  /** What the simulation will charge: only edges that change cost anything. */
  private cost(edges: EdgeEdit[]): number {
    const prices = game.catalog?.build;
    if (!prices) return 0;
    const price = { wall: prices.wall, door: prices.door, window: prices.window ?? prices.door, open: prices.remove };
    const diagonalWall = prices.diagonalWall ?? Math.round(prices.wall * 1.414);
    return edges.reduce((sum, e) => {
      const state = this.edgeState(e);
      if (state === e.kind) return sum;
      // Removing a diagonal that runs the other way (or isn't there) changes nothing.
      if (e.kind === 'open' && state === 'open') return sum;
      return sum + (e.kind === 'wall' && (e.axis === 'dp' || e.axis === 'dn') ? diagonalWall : price[e.kind]);
    }, 0);
  }

  private hoverBuild(ground: Point): void {
    const edges = this.edits(ground);
    game.buildCost = this.cost(edges);
    // Doors and windows need a wall to go into (the simulation re-checks everything).
    const inWall = !this.opening() || edges.every((e) => this.edgeState(e) !== 'open');
    this.preview.setEdgePreview?.(edges, inWall && this.edgesOnHome(edges) && this.diagonalsFit(edges) && game.funds >= game.buildCost);
  }

  private commit(ground: Point): void {
    const edges = this.edits(ground);
    game.buildStart = null;
    if (edges.length) this.send({ type: 'build', sim: game.selected, edits: edges });
    this.clearPreviews();
  }

  private clickBuild(ground: Point): boolean {
    if (this.opening()) {
      this.send({ type: 'build', sim: game.selected, edits: this.edits(ground) });
      return true;
    }
    if (!game.buildStart) {
      game.buildStart = this.corner(ground);
      this.hoverBuild(ground);
      return true;
    }
    this.commit(ground);
    return true;
  }

  /**
   * Left press with a wall or remove tool on the lot: starts a run at the nearest corner (or,
   * with a start already set by a click, will finish it on release). Returns true when the
   * gesture belongs to drawing; the camera then doesn't turn until the release.
   */
  press(ground: Point | null): boolean {
    if (!this.drawing() || !ground) return false;
    this.pressed = true;
    this.dropped = false;
    this.fresh = !game.buildStart;
    if (this.fresh) game.buildStart = this.corner(ground);
    this.lastGround = ground;
    this.preview.setLeftDragCamera?.(false);
    this.hoverBuild(ground);
    return true;
  }

  /** End of a drawing press: a drag builds the run; a click without moving only sets the start. */
  release(ground: Point | null, moved: boolean): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.preview.setLeftDragCamera?.(true);
    if (this.dropped) {
      this.dropped = false;
      return;
    }
    const g = ground ?? this.lastGround;
    const start = game.buildStart;
    if (!g || !start || !this.drawing()) return;
    const end = this.corner(g);
    // A press without a drag (or back onto the start corner) keeps the start for click-then-click.
    if (this.fresh && (!moved || (end.x === start.x && end.z === start.z))) return this.hoverBuild(g);
    this.commit(g);
    this.hoverBuild(g);
  }

  /** Right-click: stops drawing (a held drag or a click-then-click start). */
  cancelDrawing(): boolean {
    if (!this.pressed && !game.buildStart) return false;
    if (this.pressed) {
      this.dropped = true;
      this.preview.setLeftDragCamera?.(true);
    }
    game.buildStart = null;
    this.clearPreviews();
    return true;
  }

  /** Escape: drop what's in hand. Returns true if there was something to cancel. */
  cancel(): boolean {
    if (this.pressed) {
      this.dropped = true;
      this.preview.setLeftDragCamera?.(true);
    }
    if (game.placing || game.buildStart || game.buySelection !== null) {
      game.placing = null;
      game.buildStart = null;
      game.buySelection = null;
      this.clearPreviews();
      return true;
    }
    return false;
  }
}
