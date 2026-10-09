/**
 * Buy and Build mode input: placing and moving objects on the home lot (Buy), and drawing
 * walls and rooms and putting doors and windows into them (Build). The simulation is the
 * authority (it re-checks every edit and reports problems as errors); this module only shows
 * previews and sends commands.
 *
 * Walls, Room and Remove work by press on a corner → drag → release (with a live preview and its
 * cost); a press and release without moving sets the start corner instead and the next click
 * finishes (click-then-click). Dragging at about 45° draws a diagonal run across tiles; the Room
 * tool draws the four walls of the rectangle between the two corners. Esc or a right-click while
 * drawing cancels. While drawing, left-drag doesn't turn the camera.
 *
 * New walls, doors and windows take the looks picked in Build mode (`game.buildLook`: covering
 * and form, door and window style); drawing a wall in another form over a standing one rebuilds
 * it, and a door or window of another style replaces the one there. The Paint tool covers the
 * wall face on the pointer's side: click, or drag along walls; with Shift, every face of the
 * room (or, outdoors, the outside of the house) at once. The Floor tool covers the floor of the
 * tile under the pointer: click, or drag out a rectangle of tiles; with Shift, the whole room.
 * Remove on doors and windows alone walls
 * them up again (the wall stays); a run that takes in walls tears everything on it down.
 */

import type { AssetRegistry } from '../assets/registry';
import type { Content, ObjectDef } from '../content/content';
import type { Command, EdgeEdit, FacePaint, FloorPaint, ObjectPlacement, PlotInfo, WorldStructure } from '../core/protocol';
import type { BuildEffect, Renderer, ViewRect } from '../render/types';
import { styledModel } from '../ui/buy/catalog';
import type { Sound } from '../ui/sfx';
import { game } from '../ui/state.svelte';

/** Preview calls the renderer offers in buy mode. */
interface BuildPreview {
  /** Paint tool: the wall faces a click would cover, in the covering's colour (null: hidden). */
  setPaintPreview(faces: readonly PaintFace[], color: string | null): void;
  /** Floor tool: the tiles a release would cover, in the covering's colour (null: hidden). */
  setFloorPreview(tiles: readonly { x: number; z: number }[], color: string | null): void;
  setPlacementGhost(ghost: { model: string; x: number; z: number; rot: number; w: number; d: number; valid: boolean } | null): void;
  setEdgePreview(edges: EdgeEdit[], valid: boolean): void;
  setBuildGrid(rect: ViewRect | null): void;
  /** Whether a left-drag turns the camera (off while drawing walls). */
  setLeftDragCamera(on: boolean): void;
}

type Point = { x: number; z: number };
/** A wall face to paint; `half` for a half wall (the preview's height). */
export type PaintFace = FacePaint & { half: boolean };
/** A wall's look as the structure sends it. */
type Look = { faces?: [number, number]; form?: number; style?: number };
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
  /** Looks of the walls that have one (keys as `edges`). */
  private looks = new Map<string, Look>();
  /** Room of each tile, and of each half of a split tile (`x:z` → rooms of halves 0 and 1). */
  private rooms: number[] = [];
  private halves = new Map<string, [number, number]>();
  private width = 0;
  /** Paint tool: faces collected by the drag in progress. */
  private painting: PaintFace[] | null = null;
  /** Floor coverings laid (`x:z` → covering), and the Floor tool's drag start tile. */
  private floors = new Map<string, number>();
  private floorStart: Point | null = null;
  private shift = false;
  private readonly onKey = (e: KeyboardEvent) => {
    if (this.shift === e.shiftKey) return;
    this.shift = e.shiftKey;
    if (this.lastHover && game.mode === 'build' && (game.buildTool === 'paint' || game.buildTool === 'floor')) this.hoverBuild(this.lastHover);
  };
  private lastHover: Point | null = null;
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
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }

  /** Keeps the current walls, doors and windows (from each new world structure). */
  setStructure(world: WorldStructure): void {
    this.edges = new Map();
    this.diagonals = new Map();
    this.looks = new Map();
    this.halves = new Map();
    this.floors = new Map((world.floors ?? []).map(([x, z, c]) => [`${x}:${z}`, c]));
    this.rooms = world.rooms;
    this.width = world.width;
    const look = (key: string, l: Look) => this.looks.set(key, { ...this.looks.get(key), ...l });
    for (const e of world.walls ?? []) {
      this.edges.set(`${e.axis}:${e.x}:${e.z}`, 'wall');
      if (e.faces || e.form) look(`${e.axis}:${e.x}:${e.z}`, { faces: e.faces, form: e.form });
    }
    for (const o of world.openings ?? []) {
      this.edges.set(`${o.axis}:${o.x}:${o.z}`, o.kind);
      if (o.style) look(`${o.axis}:${o.x}:${o.z}`, { style: o.style });
    }
    for (const d of world.diagonals ?? []) {
      this.edges.set(`${d.axis}:${d.x}:${d.z}`, d.kind);
      this.diagonals.set(`${d.x}:${d.z}`, d.axis);
      this.halves.set(`${d.x}:${d.z}`, d.rooms);
      if (d.faces || d.form || d.style) look(`${d.axis}:${d.x}:${d.z}`, { faces: d.faces, form: d.form, style: d.style });
    }
  }

  private lookOf(e: { axis: Axis; x: number; z: number }): Look {
    return this.looks.get(`${e.axis}:${e.x}:${e.z}`) ?? {};
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
    this.preview.setPaintPreview?.([], null);
    this.preview.setFloorPreview?.([], null);
    game.paintFaces = 0;
    game.floorTiles = 0;
    game.buildWallUp = false;
    game.buildEdges = 0;
    game.buildValid = true;
    game.buildRoom = null;
    game.placeValid = true;
    game.placeHint = null;
  }

  /** Model key for an object in a style, falling back to the plain model. */
  styledModel(def: ObjectDef, style: number): string {
    return styledModel(this.content, this.assets, def, style);
  }

  /** Build mode: walls, rooms, paint, doors, windows and removing them. */
  private building(): boolean {
    return game.mode === 'build';
  }

  /** Build mode's Paint tool. */
  private paintTool(): boolean {
    return this.building() && game.buildTool === 'paint';
  }

  /** Build mode's Floor tool. */
  private floorTool(): boolean {
    return this.building() && game.buildTool === 'floor';
  }

  hover(ground: Point | null): void {
    // While drawing, keep the last preview when the pointer strays off the lot.
    if (!ground && this.pressed) return;
    this.lastHover = ground;
    if (!ground) return this.clearPreviews();
    if (this.pressed) this.lastGround = ground;
    if (this.building()) this.hoverBuild(ground);
    else if (game.mode === 'buy') this.hoverBuy(ground);
  }

  /** Returns true when the click was used. */
  click(ground: Point | null, objectId: number | null): boolean {
    if (this.paintTool() || this.floorTool()) return true;
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
    const fit = this.fits(x, z, w, d, placing.rot, placing.objectId, def);
    return { def, rot: placing.rot, x, z, w, d, valid: fit === true, reason: fit === true ? null : fit };
  }

  /** Whether a tile is indoors (a tile split by a diagonal wall is when either half is, as in the simulation). */
  private indoors(tx: number, tz: number): boolean {
    return (this.rooms[tz * this.width + tx] ?? 0) !== 0;
  }

  /**
   * Same checks as the simulation, minus reachability: on the home plot, free tiles, outdoors for
   * garden things, affordable. True, or why not (a short hint; null for the usual "doesn't fit").
   */
  private fits(x: number, z: number, w: number, d: number, rot: number, moving: number | null, def: ObjectDef): true | string | null {
    const home = this.home();
    if (!home) return null;
    const onPlot = (tx: number, tz: number) => tx >= home.x && tz >= home.z && tx < home.x + home.w && tz < home.z + home.d;
    const taken = (tx: number, tz: number) =>
      game.objects.some((o) => o.id !== moving && tx >= o.x && tz >= o.z && tx < o.x + o.w && tz < o.z + o.d);
    for (let tz = z; tz < z + d; tz++) for (let tx = x; tx < x + w; tx++) if (!onPlot(tx, tz) || taken(tx, tz)) return null;
    if (def.outdoors) {
      for (let tz = z; tz < z + d; tz++) for (let tx = x; tx < x + w; tx++) if (this.indoors(tx, tz)) return 'Goes outdoors';
    }
    const front = [
      [x + Math.floor((w - 1) / 2), z + d],
      [x + w, z + Math.floor((d - 1) / 2)],
      [x + Math.floor((w - 1) / 2), z - 1],
      [x - 1, z + Math.floor((d - 1) / 2)],
    ][rot % 4];
    if (!onPlot(front[0], front[1]) || taken(front[0], front[1])) return null;
    // As the simulation: no wall through the footprint, or between it and where it's used from.
    for (let tz = z; tz < z + d; tz++) {
      for (let tx = x; tx < x + w; tx++) {
        if (this.diagonals.has(`${tx}:${tz}`)) return null;
        if ((tx + 1 < x + w && this.wallBetween(tx, tz, tx + 1, tz)) || (tz + 1 < z + d && this.wallBetween(tx, tz, tx, tz + 1))) return 'Blocked by a wall';
      }
    }
    const [fx, fz] = front;
    const back = [
      [fx, fz - 1],
      [fx - 1, fz],
      [fx, fz + 1],
      [fx + 1, fz],
    ][rot % 4];
    if (this.wallBetween(back[0], back[1], fx, fz)) return 'Faces a wall';
    return moving !== null || (def.price !== undefined && game.affords(def.price)) ? true : null;
  }

  /** Whether a wall (with or without a door or window) stands between two neighbouring tiles. */
  private wallBetween(ax: number, az: number, bx: number, bz: number): boolean {
    const edge =
      bx !== ax ? { axis: 'v' as const, x: Math.max(ax, bx), z: az } : { axis: 'h' as const, x: ax, z: Math.max(az, bz) };
    return this.edgeState(edge) !== 'open';
  }

  private hoverBuy(ground: Point): void {
    const p = this.placement(ground);
    if (!p) return this.preview.setPlacementGhost?.(null);
    const style = p && game.placing?.objectId != null ? (game.objects.find((o) => o.id === game.placing!.objectId)?.style ?? 0) : game.householdStyle;
    this.preview.setPlacementGhost?.({ model: this.styledModel(p.def, style), x: p.x, z: p.z, rot: p.rot, w: p.w, d: p.d, valid: p.valid });
    if (game.placeValid !== p.valid) game.placeValid = p.valid;
    if (game.placeHint !== p.reason) game.placeHint = p.reason;
  }

  private clickBuy(ground: Point | null, objectId: number | null): boolean {
    const placing = game.placing;
    if (placing) {
      const p = ground && this.placement(ground);
      if (!p) return true;
      if (placing.objectId !== null) {
        this.send({ type: 'moveObject', household: game.home, object: placing.objectId, x: p.x, z: p.z, rot: p.rot });
        game.placing = null;
        this.preview.setPlacementGhost?.(null);
      } else {
        // New purchases stay on the cursor so several can be placed in a row.
        this.send({ type: 'buy', household: game.home, object: p.def.id, at: [p.x, p.z, p.rot], style: game.householdStyle });
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

  /** Walls, Room and Remove: drawn by dragging (or click-then-click). */
  private drawing(): boolean {
    return this.building() && (game.buildTool === 'wall' || game.buildTool === 'room' || game.buildTool === 'remove');
  }

  /** The walls around the rectangle between corner `a` and the pointer (a line while it's flat). */
  private room(a: Point, ground: Point): EdgeEdit[] {
    const b = this.corner(ground);
    if (a.x === b.x || a.z === b.z) return this.run(a, ground, 'wall');
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [z0, z1] = [Math.min(a.z, b.z), Math.max(a.z, b.z)];
    const edges: EdgeEdit[] = [];
    for (let x = x0; x < x1; x++) edges.push({ axis: 'h', x, z: z0, kind: 'wall' }, { axis: 'h', x, z: z1, kind: 'wall' });
    for (let z = z0; z < z1; z++) edges.push({ axis: 'v', x: x0, z, kind: 'wall' }, { axis: 'v', x: x1, z, kind: 'wall' });
    return edges;
  }

  private edits(ground: Point): EdgeEdit[] {
    const look = game.buildLook;
    const opening = this.opening();
    if (opening) return [{ ...this.nearestEdge(ground), kind: opening, style: opening === 'door' ? look.door : look.window }];
    const kind = game.buildTool === 'remove' ? 'open' : 'wall';
    let edges: EdgeEdit[];
    if (!game.buildStart) {
      // Before the first click: highlight the edge under the cursor.
      edges = [{ ...this.nearestEdge(ground), kind }];
    } else edges = game.buildTool === 'room' ? this.room(game.buildStart, ground) : this.run(game.buildStart, ground, kind);
    // Removing only doors and windows walls them up again; a run with walls in it tears it all down.
    if (kind === 'open' && edges.length && edges.every((e) => this.edgeState(e) === 'door' || this.edgeState(e) === 'window')) {
      return edges.map((e) => ({ ...e, kind: 'wall' }));
    }
    return kind === 'wall' ? edges.map((e) => ({ ...e, cover: look.cover, form: look.form })) : edges;
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

  /** Price of a door or window style (the plain price without styles in content). */
  private stylePrice(kind: 'door' | 'window', style: number | undefined): number {
    const prices = game.catalog?.build;
    const list = kind === 'door' ? this.content.doorStyles : this.content.windowStyles;
    return list[style ?? 0]?.price ?? (kind === 'door' ? (prices?.door ?? 0) : (prices?.window ?? prices?.door ?? 0));
  }

  private coverPrice(cover: number | undefined): number {
    return cover ? (this.content.wallCoverings[cover - 1]?.price ?? 0) : 0;
  }

  /** What the simulation will charge (see `World::build`): only edges that change cost anything. */
  private cost(edges: EdgeEdit[]): number {
    const prices = game.catalog?.build;
    if (!prices) return 0;
    const diagonalWall = prices.diagonalWall ?? Math.round(prices.wall * 1.414);
    return edges.reduce((sum, e) => {
      const state = this.edgeState(e);
      const wall = e.axis === 'dp' || e.axis === 'dn' ? diagonalWall : prices.wall;
      // Removing a diagonal that runs the other way (or isn't there) changes nothing.
      if (e.kind === 'open') return sum + (state === 'open' ? 0 : prices.remove);
      const old = this.lookOf(e);
      if (state === e.kind) {
        // Rebuilt in another form, or replaced by another style.
        if (e.kind === 'wall') return sum + ((e.form ?? 0) !== (old.form ?? 0) && e.form !== undefined ? wall : 0);
        return sum + ((e.style ?? old.style ?? 0) !== (old.style ?? 0) ? this.stylePrice(e.kind, e.style) : 0);
      }
      if (e.kind === 'wall') return sum + wall + (state === 'open' ? 2 * this.coverPrice(e.cover) : 0);
      return sum + this.stylePrice(e.kind, e.style);
    }, 0);
  }

  // ---- Paint ----------------------------------------------------------------------

  /** Room on side `side` (0: -z / -x / half 0) of a wall (outdoors: 0). */
  private roomBeside(e: { axis: Axis; x: number; z: number }, side: 0 | 1): number {
    if (e.axis === 'dp' || e.axis === 'dn') return this.halves.get(`${e.x}:${e.z}`)?.[side] ?? 0;
    const [tx, tz] = e.axis === 'h' ? [e.x, side ? e.z : e.z - 1] : [side ? e.x : e.x - 1, e.z];
    const halves = this.halves.get(`${tx}:${tz}`);
    if (halves) {
      // The half of a split tile that touches this edge.
      const d = this.diagonals.get(`${tx}:${tz}`);
      const half = e.axis === 'h' ? (side ? 0 : 1) : side ? (d === 'dp' ? 1 : 0) : d === 'dp' ? 0 : 1;
      return halves[half];
    }
    if (tx < 0 || tz < 0 || tx >= this.width) return 0;
    return this.rooms[tz * this.width + tx] ?? 0;
  }

  /** The wall face nearest the pointer, on the pointer's side of the wall (null: no wall there). */
  private faceAt(ground: Point): PaintFace | null {
    const e = this.nearestEdge(ground);
    if (this.edgeState(e) === 'open') return null;
    const fx = ground.x - e.x;
    const fz = ground.z - e.z;
    // Face 0 looks towards -z (h), -x (v), or the tile's half 0 (the -z side of a diagonal).
    const side: 0 | 1 = e.axis === 'h' ? (ground.z < e.z ? 0 : 1) : e.axis === 'v' ? (ground.x < e.x ? 0 : 1) : e.axis === 'dp' ? (fz < fx ? 0 : 1) : fz < 1 - fx ? 0 : 1;
    return { ...e, side, covering: game.buildLook.cover, half: this.half(e) };
  }

  private half(e: { axis: Axis; x: number; z: number }): boolean {
    return this.edgeState(e) === 'wall' && !!this.lookOf(e).form;
  }

  /** Every face on the home lot that looks into the same room as `face` (outdoors: the house's outside). */
  private roomFaces(face: PaintFace): PaintFace[] {
    const home = this.home();
    const room = this.roomBeside(face, face.side);
    const out: PaintFace[] = [];
    for (const [key, state] of this.edges) {
      if (state === 'open') continue;
      const [axis, xs, zs] = key.split(':') as [Axis, string, string];
      const e = { axis, x: Number(xs), z: Number(zs) };
      if (!this.edgesOnHome([{ ...e, kind: 'wall' }]) || !home) continue;
      for (const side of [0, 1] as const) {
        if (this.roomBeside(e, side) === room) out.push({ ...e, side, covering: face.covering, half: this.half(e) });
      }
    }
    return out;
  }

  private paintCost(faces: readonly PaintFace[]): number {
    return faces.reduce((sum, f) => sum + ((this.lookOf(f).faces?.[f.side] ?? 0) !== f.covering ? this.coverPrice(f.covering) : 0), 0);
  }

  private hoverPaint(ground: Point): void {
    const face = this.faceAt(ground);
    let faces: PaintFace[] = [];
    if (this.painting) {
      if (face && !this.painting.some((f) => f.axis === face.axis && f.x === face.x && f.z === face.z && f.side === face.side)) this.painting.push(face);
      faces = this.painting;
    } else if (face) faces = this.shift ? this.roomFaces(face) : [face];
    faces = faces.filter((f) => this.edgesOnHome([{ ...f, kind: 'wall' }]));
    const cover = game.buildLook.cover;
    const color = cover ? (this.content.wallCoverings[cover - 1]?.color ?? '#FFFFFF') : '#FFFFFF';
    this.preview.setPaintPreview?.(faces, faces.length ? color : null);
    game.buildCost = game.creative ? 0 : this.paintCost(faces);
    game.paintFaces = faces.length;
    game.buildEdges = faces.length;
    game.buildValid = faces.length > 0 && game.affords(game.buildCost);
  }

  private commitPaint(ground: Point | null): void {
    const faces = this.painting ?? [];
    this.painting = null;
    if (!faces.length && ground) {
      const face = this.faceAt(ground);
      if (face) faces.push(...(this.shift ? this.roomFaces(face) : [face]));
    }
    const onHome = faces.filter((f) => this.edgesOnHome([{ ...f, kind: 'wall' }]));
    if (onHome.length) this.send({ type: 'paint', household: game.home, faces: onHome.map(({ axis, x, z, side, covering }) => ({ axis, x, z, side, covering })) });
  }

  // ---- Floor ----------------------------------------------------------------------

  private tileOf(ground: Point): Point {
    return { x: Math.floor(ground.x), z: Math.floor(ground.z) };
  }

  private onHomeTile(t: Point): boolean {
    const home = this.home();
    return !!home && t.x >= home.x && t.z >= home.z && t.x < home.x + home.w && t.z < home.z + home.d;
  }

  /**
   * Tiles the Floor tool covers: the rectangle from the drag's start tile to the pointer's, or
   * the tile under the pointer (Shift: every tile of its room). Only indoor tiles on the home lot.
   */
  private floorTiles(ground: Point): FloorPaint[] {
    const covering = game.buildLook.floor;
    const at = this.tileOf(ground);
    const out: FloorPaint[] = [];
    const add = (x: number, z: number) => {
      if (this.indoors(x, z) && this.onHomeTile({ x, z })) out.push({ x, z, covering });
    };
    if (this.floorStart) {
      const s = this.floorStart;
      for (let z = Math.min(s.z, at.z); z <= Math.max(s.z, at.z); z++) for (let x = Math.min(s.x, at.x); x <= Math.max(s.x, at.x); x++) add(x, z);
    } else if (this.shift && this.indoors(at.x, at.z)) {
      const room = this.rooms[at.z * this.width + at.x];
      const home = this.home();
      if (home) for (let z = home.z; z < home.z + home.d; z++) for (let x = home.x; x < home.x + home.w; x++) if (this.rooms[z * this.width + x] === room) add(x, z);
    } else add(at.x, at.z);
    return out;
  }

  private floorCost(tiles: readonly FloorPaint[]): number {
    return tiles.reduce((sum, t) => sum + ((this.floors.get(`${t.x}:${t.z}`) ?? 0) !== t.covering && t.covering ? (this.content.floorCoverings[t.covering - 1]?.price ?? 0) : 0), 0);
  }

  private hoverFloor(ground: Point): void {
    const tiles = this.floorTiles(ground);
    const floor = game.buildLook.floor;
    const color = floor ? (this.content.floorCoverings[floor - 1]?.color ?? '#FFFFFF') : '#FFFFFF';
    this.preview.setFloorPreview?.(tiles, tiles.length ? color : null);
    game.buildCost = game.creative ? 0 : this.floorCost(tiles);
    game.floorTiles = tiles.length;
    game.buildEdges = tiles.length;
    game.buildValid = tiles.length > 0 && game.affords(game.buildCost);
  }

  private commitFloor(ground: Point | null): void {
    const tiles = ground ? this.floorTiles(ground) : [];
    this.floorStart = null;
    if (tiles.length) this.send({ type: 'paintFloor', household: game.home, tiles });
  }

  private hoverBuild(ground: Point): void {
    if (this.paintTool()) return this.hoverPaint(ground);
    if (this.floorTool()) return this.hoverFloor(ground);
    const edges = this.edits(ground);
    game.buildCost = game.creative ? 0 : this.cost(edges);
    // Doors and windows need a full-height wall to go into (the simulation re-checks everything).
    const inWall = !this.opening() || edges.every((e) => this.edgeState(e) !== 'open' && !(this.edgeState(e) === 'wall' && this.lookOf(e).form));
    const valid = inWall && this.edgesOnHome(edges) && this.diagonalsFit(edges) && game.affords(game.buildCost);
    this.preview.setEdgePreview?.(edges, valid);
    game.buildEdges = edges.length;
    game.buildValid = valid;
    game.buildWallUp = game.buildTool === 'remove' && edges.length > 0 && edges.every((e) => e.kind === 'wall');
    const start = game.buildStart;
    const end = this.corner(ground);
    game.buildRoom = game.buildTool === 'room' && start && start.x !== end.x && start.z !== end.z ? [Math.abs(end.x - start.x), Math.abs(end.z - start.z)] : null;
  }

  private commit(ground: Point): void {
    const edges = this.edits(ground);
    game.buildStart = null;
    if (edges.length) this.send({ type: 'build', household: game.home, edits: edges });
    this.clearPreviews();
  }

  private clickBuild(ground: Point): boolean {
    if (this.opening()) {
      this.send({ type: 'build', household: game.home, edits: this.edits(ground) });
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
    if (this.floorTool() && ground) {
      // Floor: a drag covers the rectangle of tiles it spans; a click, one tile (Shift: the room).
      this.pressed = true;
      this.dropped = false;
      this.floorStart = this.shift ? null : this.tileOf(ground);
      this.preview.setLeftDragCamera?.(false);
      this.hoverFloor(ground);
      return true;
    }
    if (this.paintTool() && ground) {
      // Paint: a drag covers every face it passes (on the side it's on); a click, one (Shift: a room).
      this.pressed = true;
      this.dropped = false;
      this.painting = this.shift ? null : [];
      this.preview.setLeftDragCamera?.(false);
      this.hoverPaint(ground);
      return true;
    }
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
      this.painting = null;
      this.floorStart = null;
      return;
    }
    if (this.floorTool()) {
      this.commitFloor(ground ?? this.lastHover);
      if (ground) this.hoverFloor(ground);
      return;
    }
    if (this.paintTool()) {
      this.commitPaint(ground);
      if (ground) this.hoverPaint(ground);
      return;
    }
    const g = ground ?? this.lastGround;
    const start = game.buildStart;
    if (!g || !start || !this.drawing()) return;
    const end = this.corner(g);
    if (this.fresh && !moved && game.buildTool === 'remove') {
      // Remove: a click on a door or window walls it up at once.
      const e = this.nearestEdge(g);
      const state = this.edgeState(e);
      if (state === 'door' || state === 'window') {
        game.buildStart = null;
        this.send({ type: 'build', household: game.home, edits: [{ ...e, kind: 'wall' }] });
        this.clearPreviews();
        return this.hoverBuild(g);
      }
    }
    // A press without a drag (or back onto the start corner) keeps the start for click-then-click.
    if (this.fresh && (!moved || (end.x === start.x && end.z === start.z))) return this.hoverBuild(g);
    this.commit(g);
    this.hoverBuild(g);
  }

  /** Right-click: stops drawing (a held drag or a click-then-click start). */
  cancelDrawing(): boolean {
    this.painting = null;
    this.floorStart = null;
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

/** More changed objects than this at once is a different view, not an edit. */
const MAX_EDIT_OBJECTS = 8;
/** Dust is shown on at most this many changed wall edges. */
const MAX_EDIT_EDGES = 40;

/**
 * What changed between two world structures of the same lot, as effects to play and the sound
 * that goes with them: furniture bought, moved, restyled, upgraded or sold; walls, doors and
 * windows put in or taken out. Feedback only follows edits the simulation accepted.
 */
export function editFeedback(prev: WorldStructure, next: WorldStructure): { effects: BuildEffect[]; sound: Sound | null } {
  const effects: BuildEffect[] = [];
  const sounds = new Set<Sound>();
  // An object's id is its place in the list, and edits reorder it (selling shifts later ids
  // down, moving re-adds an object at the end, undo puts things back), so match objects by what
  // they are: first those unchanged (same look, same place), then the same kind of object among
  // the rest (moved, turned, restyled or upgraded); the same id wins a tie.
  const before = new Map<number, ObjectPlacement>();
  const left = new Set(prev.objects);
  const key = (o: ObjectPlacement) => `${o.def}:${o.x}:${o.z}:${o.rot}:${o.style}:${o.quality}`;
  const byKey = Map.groupBy(prev.objects, key);
  for (const o of next.objects) {
    const same = byKey.get(key(o));
    if (!same?.length) continue;
    const old = same.splice(Math.max(0, same.findIndex((p) => p.id === o.id)), 1)[0];
    before.set(o.id, old);
    left.delete(old);
  }
  for (const o of next.objects) {
    if (before.has(o.id)) continue;
    const kind = [...left].filter((p) => p.def === o.def);
    const old = kind.find((p) => p.id === o.id) ?? kind[0];
    if (!old) continue;
    before.set(o.id, old);
    left.delete(old);
  }
  const rect = (o: { x: number; z: number; w: number; d: number }) => ({ x: o.x, z: o.z, w: o.w, d: o.d });
  const added = next.objects.filter((o) => !before.has(o.id));
  const removed = [...left];
  if (added.length + removed.length <= MAX_EDIT_OBJECTS) {
    for (const o of added) {
      effects.push({ kind: 'place', ...rect(o), objectId: o.id });
      sounds.add('place');
    }
    for (const o of removed) {
      effects.push({ kind: 'sell', ...rect(o) });
      sounds.add('sell');
    }
    for (const o of next.objects) {
      const old = before.get(o.id);
      if (!old) continue;
      if (o.quality > old.quality) {
        effects.push({ kind: 'upgrade', ...rect(o), objectId: o.id });
        sounds.add('upgrade');
      } else if (o.x !== old.x || o.z !== old.z || o.rot !== old.rot || o.style !== old.style) {
        effects.push({ kind: 'place', ...rect(o), objectId: o.id });
        sounds.add(o.x !== old.x || o.z !== old.z ? 'place' : 'rotate');
      }
    }
  }

  const edges = (w: WorldStructure) => {
    const map = new Map<string, { axis: Axis; x: number; z: number }>();
    for (const e of w.walls ?? []) map.set(`${e.axis}:${e.x}:${e.z}:wall`, e);
    for (const o of w.openings ?? []) map.set(`${o.axis}:${o.x}:${o.z}:${o.kind}`, o);
    for (const d of w.diagonals ?? []) map.set(`${d.axis}:${d.x}:${d.z}:${d.kind}`, d);
    return map;
  };
  /** Looks by edge: coverings (painting), and form and style (rebuilt or replaced in place). */
  const looks = (w: WorldStructure) => {
    const faces = new Map<string, string>();
    const shape = new Map<string, string>();
    for (const e of [...(w.walls ?? []), ...(w.diagonals ?? [])]) {
      faces.set(`${e.axis}:${e.x}:${e.z}`, String(e.faces ?? ''));
      shape.set(`${e.axis}:${e.x}:${e.z}`, `${e.form ?? 0}:${'style' in e ? (e.style ?? 0) : ''}`);
    }
    for (const o of w.openings ?? []) shape.set(`${o.axis}:${o.x}:${o.z}`, `0:${o.style ?? 0}`);
    return { faces, shape };
  };
  const was = edges(prev);
  const now = edges(next);
  const edgeRect = (e: { axis: Axis; x: number; z: number }) =>
    e.axis === 'h' ? { x: e.x, z: e.z - 0.1, w: 1, d: 0.2 } : e.axis === 'v' ? { x: e.x - 0.1, z: e.z, w: 0.2, d: 1 } : { x: e.x + 0.3, z: e.z + 0.3, w: 0.4, d: 0.4 };
  const built = [...now].filter(([k]) => !was.has(k));
  const torn = [...was].filter(([k]) => !now.has(k));
  for (const [, e] of built.slice(0, MAX_EDIT_EDGES)) effects.push({ kind: 'build', ...edgeRect(e) });
  // A door or window replacing a wall shows up as both; only the new opening needs dust.
  const edge = (key: string) => key.slice(0, key.lastIndexOf(':'));
  const rebuilt = new Set(built.map(([k]) => edge(k)));
  for (const [k, e] of torn.slice(0, MAX_EDIT_EDGES)) if (!rebuilt.has(edge(k))) effects.push({ kind: 'remove', ...edgeRect(e) });
  if (built.length) sounds.add('build');
  else if (torn.length) sounds.add('remove');
  const [lookWas, lookNow] = [looks(prev), looks(next)];
  // (Walls that became a door or window already have their dust.)
  const restyled = [...lookNow.shape].filter(([k, v]) => !rebuilt.has(k) && lookWas.shape.has(k) && lookWas.shape.get(k) !== v);
  for (const [k] of restyled.slice(0, MAX_EDIT_EDGES)) {
    const [axis, x, z] = k.split(':');
    effects.push({ kind: 'build', ...edgeRect({ axis: axis as Axis, x: Number(x), z: Number(z) }) });
  }
  if (restyled.length) sounds.add('build');
  if ([...lookNow.faces].some(([k, v]) => lookWas.faces.has(k) && lookWas.faces.get(k) !== v)) sounds.add('paint');
  const floorKey = (w: WorldStructure) => (w.floors ?? []).map((f) => f.join(':')).join(',');
  if (floorKey(prev) !== floorKey(next)) sounds.add('paint');

  const order: Sound[] = ['upgrade', 'place', 'sell', 'build', 'remove', 'paint', 'rotate'];
  return { effects, sound: order.find((s) => sounds.has(s)) ?? null };
}
