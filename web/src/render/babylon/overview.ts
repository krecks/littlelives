/**
 * The town overview behind the menus (main menu, new-game steps): the whole neighbourhood at
 * once, drawn with the game's own builders so it looks like the game. Every house is a dressed
 * shell (`HouseBuilder.silhouettes` through `Street`: porches, chimneys, garages, cars, fences,
 * flower beds), plus the road, garden paths and every outdoor object (garden and park trees,
 * benches, flower beds). No interiors, no Sims.
 *
 * Also owns the overview's lot highlights (glowing outlines, a soft fill and a light wall around
 * the selected lot; thin instances whose colours are rewritten, never re-recorded) and its
 * camera rig (framed shots, glides, a slow drift).
 *
 * Everything here is on the `LAYER_TOWN` camera layer, so it can be built and kept while the
 * game world is on screen, and the other way round (see `BabylonRenderer.showTown`).
 */

import { ArcRotateCamera, Color3, Constants, Matrix, Quaternion, StandardMaterial, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import type { AssetRegistry } from '../../assets/registry';
import type { Content } from '../../content/content';
import type { ObjectPlacement, PlotInfo, WorldStructure } from '../../core/protocol';
import type { LotHighlight, TownShot } from '../types';
import { Geo, type V3 } from './geometry';
import type { HouseBuilder } from './house';
import { LAYER_TOWN } from './layers';
import type { MaterialLibrary } from './materials';
import { buildModel, placementVariation, type ModelTemplate } from './models';
import { Street } from './street';

/** Height that labels and fits allow for (roofs, chimneys, crowns). */
const TOWN_HEIGHT = 7;
const HIGHLIGHT_INSET = 0.55;
const HIGHLIGHT_CORNER = 1.6;
/** Per-plot highlight intensities ease towards their targets with this time constant (s). */
const FADE = 0.12;

const COLORS = {
  outline: new Color3(1, 0.97, 0.9),
  hover: new Color3(1, 0.98, 0.92),
  selected: new Color3(0.42, 0.62, 1.25),
  marked: new Color3(1.0, 0.78, 0.38),
};

export class TownOverview {
  /** Two streets used in turn: the next one builds while the current one stays on screen. */
  private readonly streets: [Street, Street];
  private current = 0;
  private ground: Mesh[] = [];
  private readonly templates = new Map<string, Promise<ModelTemplate>>();
  private readonly templatesInUse = new Set<string>();
  private key = '';
  /** Shadow casters of the overview (without the landscape). */
  casters: Mesh[] = [];
  /** Everything on the town layer (for the room-light exclusions). */
  meshes: Mesh[] = [];
  plots: PlotInfo[] = [];
  readonly centre = new Vector3();
  width = 0;
  depth = 0;

  // Lot highlights: ring (outline), fill (inner glow) and wall (light curtain), one instance per plot.
  private readonly glowMaterial: StandardMaterial;
  private hl: { mesh: Mesh; colors: Float32Array; matrices: Float32Array }[] = [];
  private hlSize = '';
  private state: LotHighlight = { hover: null, selected: null, marked: [], outlines: false };
  /** Per plot: current and target intensity of [outline, hover, selected, marked]. */
  private level = new Float32Array(0);
  private target = new Float32Array(0);
  /** Colours must be written even though nothing is fading (after a rebuild). */
  private dirty = false;
  private time = 0;

  readonly rig: OverviewCamera;

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetRegistry,
    private readonly content: Content,
    house: HouseBuilder,
    private readonly lib: MaterialLibrary,
    camera: ArcRotateCamera,
  ) {
    this.streets = [new Street(scene, assets, house, LAYER_TOWN), new Street(scene, assets, house, LAYER_TOWN)];
    const mat = (this.glowMaterial = new StandardMaterial('lotGlow', scene));
    // Unlit: the output is emissive x vertex colour x instance colour.
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.emissiveColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    mat.fogEnabled = false;
    mat.zOffset = -6;
    this.rig = new OverviewCamera(camera);
  }

  /** Builds the overview of `world` (kept when it is the same town); the previous one stays until it is done. */
  async build(world: WorldStructure): Promise<boolean> {
    const key = townKey(world);
    if (key === this.key) return false;
    const next = this.streets[1 - this.current];
    const streetCasters = await next.build(world, null);
    const ground = this.buildGround(world);
    const objects = await this.buildObjects(world);

    // Swap: drop the previous overview, show the new one.
    this.streets[this.current].clear();
    this.current = 1 - this.current;
    for (const mesh of this.ground) mesh.dispose(false, false);
    this.ground = ground;
    for (const [key, t] of this.templates) {
      if (objects.has(key)) continue;
      void t.then((template) => {
        if (!this.templatesInUse.has(key)) for (const mesh of template.meshes) mesh.setEnabled(false);
      });
    }
    this.templatesInUse.clear();
    const objectMeshes: Mesh[] = [];
    for (const [key, { template, matrices }] of objects) {
      this.templatesInUse.add(key);
      for (const mesh of template.meshes) {
        mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.setEnabled(true);
        objectMeshes.push(mesh);
      }
    }
    this.key = key;
    this.plots = world.plots;
    this.width = world.width;
    this.depth = world.depth;
    this.centre.set(world.width / 2, 0, world.depth / 2);
    this.casters = [...streetCasters, ...objectMeshes];
    this.buildHighlights(world.plots);
    this.meshes = [...next.all, ...ground, ...objectMeshes, ...this.hl.map((h) => h.mesh)];
    for (const mesh of this.meshes) mesh.layerMask = LAYER_TOWN;
    return true;
  }

  setNight(lamps: number, glow: Color3): void {
    this.streets[this.current].setNight(lamps, glow);
  }

  /** Which lots glow (see `Renderer.setLotHighlight`). */
  setHighlight(h: LotHighlight): void {
    this.state = h;
    this.updateTargets();
  }

  /**
   * Per frame: eases the highlights (true while the colour buffers changed) and the camera.
   * Allocation-free.
   */
  frame(dt: number, aspect: number): boolean {
    this.time += dt;
    this.rig.frame(dt, aspect);
    const n = this.plots.length;
    if (!this.hl.length || !n) return false;
    let moving = false;
    const k = 1 - Math.exp(-dt / FADE);
    for (let i = 0; i < n * 4; i++) {
      const d = this.target[i] - this.level[i];
      if (Math.abs(d) < 0.002) this.level[i] = this.target[i];
      else {
        this.level[i] += d * k;
        moving = true;
      }
    }
    const pulse = this.state.selected !== null;
    if (!moving && !pulse && !this.dirty) return false;
    this.dirty = false;
    const beat = 0.82 + 0.18 * Math.sin(this.time * 3.2);
    const [ring, fill, wall] = this.hl;
    for (let i = 0; i < n; i++) {
      const outline = this.level[i * 4];
      const hover = this.level[i * 4 + 1];
      const sel = this.level[i * 4 + 2] * beat;
      const marked = this.level[i * 4 + 3];
      // Ring: the strongest of the states, blended by colour.
      writeColor(ring.colors, i, outline * 0.32, hover * 1.15, sel * 1.1, marked * 0.6);
      writeColor(fill.colors, i, 0, hover * 0.4, sel * 0.34, marked * 0.05);
      writeColor(wall.colors, i, 0, hover * 0.2, sel * 0.32, 0);
    }
    for (const h of this.hl) h.mesh.thinInstanceBufferUpdated('color');
    return true;
  }

  dispose(): void {
    for (const street of this.streets) street.clear();
    for (const mesh of this.ground) mesh.dispose(false, false);
    for (const h of this.hl) h.mesh.dispose(false, false);
  }

  // ---- building ---------------------------------------------------------------------

  /** Road and garden paths / driveways, one flat mesh each. */
  private buildGround(world: WorldStructure): Mesh[] {
    const out: Mesh[] = [];
    const layers: [string, { x: number; z: number; w: number; d: number }[] | undefined, string, number][] = [
      ['townStreets', world.meta?.streets, 'material.road', 0.012],
      ['townPaths', world.meta?.paths, 'material.path', 0.014],
    ];
    for (const [name, rects, material, y] of layers) {
      if (!rects?.length) continue;
      const g = new Geo();
      for (const r of rects) g.poly([[r.x, y, r.z], [r.x + r.w, y, r.z], [r.x + r.w, y, r.z + r.d], [r.x, y, r.z + r.d]], [0, 1, 0]);
      const mesh = g.toMesh(name, this.scene);
      if (!mesh) continue;
      mesh.material = this.lib.surface(material, { doubleSided: true });
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      out.push(mesh);
    }
    return out;
  }

  /** Outdoor objects of every lot (garden and park trees, benches, flower beds), one template per model. */
  private async buildObjects(world: WorldStructure): Promise<Map<string, { template: ModelTemplate; matrices: Float32Array }>> {
    const W = world.width;
    const outdoor = (o: ObjectPlacement) => {
      for (let z = o.z; z < o.z + o.d; z++) for (let x = o.x; x < o.x + o.w; x++) if (world.rooms[z * W + x]) return false;
      return true;
    };
    const groups = Map.groupBy(world.objects.filter(outdoor), (o) => this.content.object(o.def)?.model ?? `model.${o.def}`);
    const out = new Map<string, { template: ModelTemplate; matrices: Float32Array }>();
    const m = new Matrix();
    const q = new Quaternion();
    const scale = new Vector3();
    const at = new Vector3();
    for (const [key, list] of groups) {
      let t = this.templates.get(key);
      if (!t) {
        const def = this.content.object(list[0].def);
        t = buildModel(this.scene, `town:${key}`, this.assets.get(key, 'model'), def?.footprint ?? [1, 1]).then((template) => {
          for (const mesh of template.meshes) {
            mesh.layerMask = LAYER_TOWN;
            mesh.isPickable = false;
            mesh.receiveShadows = true;
          }
          return template;
        });
        this.templates.set(key, t);
      }
      const template = await t;
      const matrices = new Float32Array(list.length * 16);
      const vary = this.assets.get(key, 'model')?.vary ?? 0;
      list.forEach((o, i) => {
        const { turn, size } = placementVariation(vary, o.x, o.z);
        Quaternion.RotationYawPitchRollToRef((o.rot * Math.PI) / 2 + turn, 0, 0, q);
        Matrix.ComposeToRef(scale.setAll(size), q, at.set(o.x + o.w / 2, 0, o.z + o.d / 2), m);
        m.copyToArray(matrices, i * 16);
      });
      out.set(key, { template, matrices });
    }
    return out;
  }

  /** Highlight meshes for the plot size (rebuilt only when it changes) and one instance per plot. */
  private buildHighlights(plots: PlotInfo[]): void {
    const first = plots[0];
    if (!first) return;
    const size = `${first.w}x${first.d}`;
    if (size !== this.hlSize) {
      for (const h of this.hl) h.mesh.dispose(false, false);
      this.hlSize = size;
      const path = roundedRect(first.w, first.d, HIGHLIGHT_INSET, HIGHLIGHT_CORNER, 7);
      const ring = new Geo().color('#FFFFFF');
      const fill = new Geo().color('#FFFFFF');
      const wall = new Geo().color('#FFFFFF');
      const up: V3 = [0, 1, 0];
      for (let i = 0; i < path.length; i++) {
        const [ax, az, anx, anz] = path[i];
        const [bx, bz, bnx, bnz] = path[(i + 1) % path.length];
        const at = (x: number, z: number, nx: number, nz: number, d: number, y: number): V3 => [x + nx * d, y, z + nz * d];
        // Ring: feathered band either side of the outline.
        for (const [d0, d1, a0, a1] of [
          [-0.42, -0.07, 0, 1],
          [-0.07, 0.07, 1, 1],
          [0.07, 0.42, 1, 0],
        ] as const) {
          // (Lifted over the lawn tufts so they don't hide it.)
          ring.poly([at(ax, az, anx, anz, d0, 0.22), at(bx, bz, bnx, bnz, d0, 0.22), at(bx, bz, bnx, bnz, d1, 0.22), at(ax, az, anx, anz, d1, 0.22)], up, undefined, [a0, a0, a1, a1]);
        }
        // Fill: a glow fading inwards from the outline.
        fill.poly([at(ax, az, anx, anz, -3.2, 0.2), at(bx, bz, bnx, bnz, -3.2, 0.2), at(bx, bz, bnx, bnz, 0, 0.2), at(ax, az, anx, anz, 0, 0.2)], up, undefined, [0, 0, 1, 1]);
        // Wall: a curtain of light standing on the outline, fading upwards.
        wall.poly([at(ax, az, anx, anz, 0, 0.05), at(bx, bz, bnx, bnz, 0, 0.05), at(bx, bz, bnx, bnz, 0, 2.2), at(ax, az, anx, anz, 0, 2.2)], [anx, 0, anz], undefined, [1, 1, 0, 0]);
      }
      this.hl = [
        [ring, 'lotRing'],
        [fill, 'lotFill'],
        [wall, 'lotWall'],
      ].map(([geo, name]) => {
        const mesh = (geo as Geo).toMesh(name as string, this.scene, { colors: true })!;
        mesh.hasVertexAlpha = true;
        mesh.material = this.glowMaterial;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.layerMask = LAYER_TOWN;
        return { mesh, colors: new Float32Array(0), matrices: new Float32Array(0) };
      });
    }
    const n = plots.length;
    for (const h of this.hl) {
      h.matrices = new Float32Array(n * 16);
      h.colors = new Float32Array(n * 4);
      plots.forEach((p, i) => {
        const o = i * 16;
        h.matrices[o] = p.w / first.w;
        h.matrices[o + 5] = 1;
        h.matrices[o + 10] = p.d / first.d;
        h.matrices[o + 12] = p.x;
        h.matrices[o + 14] = p.z;
        h.matrices[o + 15] = 1;
      });
      h.mesh.thinInstanceSetBuffer('matrix', h.matrices, 16, true);
      h.mesh.thinInstanceSetBuffer('color', h.colors, 4, false);
    }
    this.level = new Float32Array(n * 4);
    this.target = new Float32Array(n * 4);
    this.updateTargets();
    // Start at the targets (no fade-in after a rebuild), then write the colours once.
    this.level.set(this.target);
    this.dirty = true;
  }

  private updateTargets(): void {
    const n = this.plots.length;
    if (this.target.length !== n * 4) return;
    const { hover, selected, marked, outlines } = this.state;
    for (let i = 0; i < n; i++) {
      const id = this.plots[i].id;
      this.target[i * 4] = outlines ? 1 : 0;
      this.target[i * 4 + 1] = hover === id && selected !== id ? 1 : 0;
      this.target[i * 4 + 2] = selected === id ? 1 : 0;
      this.target[i * 4 + 3] = marked.includes(id) && selected !== id && hover !== id ? 1 : 0;
    }
  }
}

/** Identity of a town layout: the overview rebuilds only when it changes. */
function townKey(world: WorldStructure): string {
  return [
    world.meta?.seed ?? 0,
    world.width,
    world.depth,
    world.plots.map((p) => `${p.house?.join(',') ?? '-'}`).join(';'),
    world.openings.length,
    world.objects.length,
    world.objects.reduce((a, o) => a + o.x * 31 + o.z * 7 + o.rot, 0),
    (world.meta?.paths ?? []).map((r) => `${r.x},${r.z},${r.w}`).join(';'),
  ].join('|');
}

/** Ring colour of one plot: the states mixed by intensity (additive glow, alpha = strength). */
function writeColor(buf: Float32Array, i: number, outline: number, hover: number, selected: number, marked: number): void {
  const a = outline + hover + selected + marked;
  const o = i * 4;
  if (a < 1e-4) {
    buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 0;
    return;
  }
  const c = COLORS;
  buf[o] = (c.outline.r * outline + c.hover.r * hover + c.selected.r * selected + c.marked.r * marked) / a;
  buf[o + 1] = (c.outline.g * outline + c.hover.g * hover + c.selected.g * selected + c.marked.g * marked) / a;
  buf[o + 2] = (c.outline.b * outline + c.hover.b * hover + c.selected.b * selected + c.marked.b * marked) / a;
  buf[o + 3] = Math.min(1.2, a);
}

/** Closed rounded rectangle inset into a w x d plot: points [x, z, outward nx, nz]. */
function roundedRect(w: number, d: number, inset: number, r: number, seg: number): [number, number, number, number][] {
  const pts: [number, number, number, number][] = [];
  const [x0, z0, x1, z1] = [inset + r, inset + r, w - inset - r, d - inset - r];
  const corners: [number, number, number][] = [
    [x1, z1, 0],
    [x0, z1, Math.PI / 2],
    [x0, z0, Math.PI],
    [x1, z0, Math.PI * 1.5],
  ];
  for (const [cx, cz, start] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = start + (i / seg) * (Math.PI / 2);
      const nx = Math.cos(t);
      const nz = Math.sin(t);
      pts.push([cx + nx * r, cz + nz * r, nx, nz]);
    }
  }
  return pts;
}

// ---- camera -------------------------------------------------------------------------------

interface Pose {
  alpha: number;
  beta: number;
  radius: number;
  tx: number;
  tz: number;
  /** View-space offset (`ArcRotateCamera.targetScreenOffset`), frames the focus off-centre. */
  ox: number;
  oy: number;
}

const pose = (): Pose => ({ alpha: 0, beta: 0.9, radius: 60, tx: 0, tz: 0, ox: 0, oy: 0 });

/**
 * Drives the camera in the overview: shots framed into a screen rectangle (fit by projecting
 * the focus box), glides between them (ease in-out), a slow drift and user nudges. Per frame it
 * only does arithmetic on preallocated poses.
 */
export class OverviewCamera {
  private readonly cur = pose();
  private readonly from = pose();
  private readonly goal = pose();
  private shot: TownShot | null = null;
  private t = 0;
  private duration = 0;
  private drift = 0;
  private sway = 0;
  private swayTime = 0;
  private swayBase = 0;
  /** User orbit and zoom on top of the shot. */
  private userAlpha = 0;
  private userZoom = 1;
  private aspect = 16 / 9;
  private viewW = 1920;
  private viewH = 1080;
  private onArrive: (() => void) | null = null;

  constructor(private readonly camera: ArcRotateCamera) {}

  /** Copies the camera's pose (entering the overview from the game). */
  syncFromCamera(): void {
    const c = this.camera;
    Object.assign(this.cur, { alpha: c.alpha, beta: c.beta, radius: c.radius, tx: c.target.x, tz: c.target.z, ox: c.targetScreenOffset.x, oy: c.targetScreenOffset.y });
  }

  setViewport(width: number, height: number): void {
    if (width === this.viewW && height === this.viewH) return;
    this.viewW = width;
    this.viewH = height;
    this.refit();
  }

  /** Re-fits the current shot (viewport changed), keeping the drift/sway phase. */
  private refit(): void {
    if (!this.shot) return;
    const alpha = this.goal.alpha;
    const base = this.swayBase;
    this.fitGoal({ ...this.shot, alpha: this.shot.alpha === undefined ? undefined : alpha });
    this.goal.alpha = alpha;
    this.swayBase = base;
  }

  /** Frames `shot`; with `duration` 0 (or `cut`) it jumps there. */
  setShot(shot: TownShot, cut = false): void {
    const alphaChanged = shot.alpha !== undefined && shot.alpha !== this.shot?.alpha;
    if (alphaChanged) this.userAlpha = 0;
    if (shot.zoom !== this.shot?.zoom || alphaChanged) this.userZoom = 1;
    this.shot = shot;
    this.drift = shot.drift ?? 0;
    this.sway = shot.sway ?? 0;
    this.swayTime = 0;
    this.fitGoal(shot);
    this.swayBase = this.goal.alpha;
    this.startGlide(cut ? 0 : (shot.duration ?? 1.2));
  }

  /** Glides to an exact camera pose (the game's view of a lot) and calls back on arrival. */
  glideTo(target: { alpha: number; beta: number; radius: number; x: number; z: number }, seconds: number, done: () => void): void {
    this.shot = null;
    this.drift = 0;
    this.sway = 0;
    this.userAlpha = 0;
    this.userZoom = 1;
    Object.assign(this.goal, { alpha: target.alpha, beta: target.beta, radius: target.radius, tx: target.x, tz: target.z, ox: 0, oy: 0 });
    this.onArrive = done;
    this.startGlide(seconds);
  }

  nudge(dAlpha: number, zoom: number): void {
    this.userAlpha += dAlpha;
    this.userZoom = Math.min(2.6, Math.max(0.6, this.userZoom * zoom));
  }

  /** Advances and applies the pose. */
  frame(dt: number, aspect: number): void {
    if (Math.abs(aspect - this.aspect) > 1e-3) {
      this.aspect = aspect;
      this.refit();
    }
    this.swayBase += this.drift * dt;
    if (this.sway) {
      this.swayTime += dt;
      this.goal.alpha = this.swayBase + this.sway * Math.sin((this.swayTime * Math.PI * 2) / 70);
    } else this.goal.alpha = this.swayBase;
    const g = this.goal;
    const c = this.cur;
    const zoom = this.userZoom;
    const ga = g.alpha + this.userAlpha;
    if (this.t < this.duration) {
      this.t = Math.min(this.duration, this.t + dt);
      const k = ease(this.t / this.duration);
      const f = this.from;
      c.alpha = f.alpha + angleDelta(f.alpha, ga) * k;
      c.beta = f.beta + (g.beta - f.beta) * k;
      // Zooms glide in log space (a long pull-back doesn't rush at the start).
      c.radius = Math.exp(Math.log(f.radius) + (Math.log(g.radius / zoom) - Math.log(f.radius)) * k);
      c.tx = f.tx + (g.tx - f.tx) * k;
      c.tz = f.tz + (g.tz - f.tz) * k;
      c.ox = f.ox + ((g.ox * c.radius) / g.radius - f.ox) * k;
      c.oy = f.oy + ((g.oy * c.radius) / g.radius - f.oy) * k;
      if (this.t >= this.duration && this.onArrive) {
        const done = this.onArrive;
        this.onArrive = null;
        done();
      }
    } else {
      // Settled: follow drift and nudges smoothly.
      const k = 1 - Math.exp(-dt / 0.25);
      c.alpha += angleDelta(c.alpha, ga) * k;
      c.beta += (g.beta - c.beta) * k;
      c.radius += (g.radius / zoom - c.radius) * k;
      c.tx += (g.tx - c.tx) * k;
      c.tz += (g.tz - c.tz) * k;
      c.ox += ((g.ox * c.radius) / g.radius - c.ox) * k;
      c.oy += ((g.oy * c.radius) / g.radius - c.oy) * k;
    }
    this.apply();
  }

  /** Writes the pose into the camera. */
  apply(): void {
    const cam = this.camera;
    const c = this.cur;
    cam.alpha = c.alpha;
    cam.beta = c.beta;
    cam.radius = c.radius;
    cam.target.copyFromFloats(c.tx, 0, c.tz);
    cam.targetScreenOffset.copyFromFloats(c.ox, c.oy);
  }

  private startGlide(seconds: number): void {
    Object.assign(this.from, this.cur);
    this.t = 0;
    this.duration = Math.max(0, seconds);
    if (this.duration === 0) {
      Object.assign(this.cur, this.goal);
      this.cur.alpha += this.userAlpha;
      this.cur.radius /= this.userZoom;
      if (this.onArrive) {
        const done = this.onArrive;
        this.onArrive = null;
        done();
      }
    }
  }

  /** Goal pose for a shot: the radius and view offset that fit its focus into its frame. */
  private fitGoal(shot: TownShot): void {
    const g = this.goal;
    const f = shot.focus;
    g.alpha = shot.alpha ?? this.cur.alpha;
    g.beta = shot.beta ?? 0.9;
    g.tx = f.x + f.w / 2;
    g.tz = f.z + f.d / 2;
    const W = this.viewW;
    const H = this.viewH;
    const fr = shot.frame ?? { left: 0, top: 0, right: W, bottom: H };
    // Frame in normalised device coordinates.
    const nl = (fr.left / W) * 2 - 1;
    const nr = (fr.right / W) * 2 - 1;
    const nt = 1 - (fr.top / H) * 2;
    const nb = 1 - (fr.bottom / H) * 2;
    const ncx = (nl + nr) / 2;
    const ncy = (nt + nb) / 2;
    const zoom = shot.zoom ?? 1;
    const hx = ((nr - nl) / 2) * 0.94 * zoom;
    const hy = ((nt - nb) / 2) * 0.94 * zoom;
    const tanY = Math.tan(this.camera.fov / 2);
    const tanX = tanY * (W / H);
    // Camera basis (left-handed, as Babylon's look-at).
    const sa = Math.sin(g.alpha);
    const ca = Math.cos(g.alpha);
    const sb = Math.sin(g.beta);
    const cb = Math.cos(g.beta);
    const ex = ca * sb;
    const ey = cb;
    const ez = sa * sb;
    // forward = -e; right = normalize(cross(up, forward)); up' = cross(forward, right)
    const rl = Math.hypot(ez, ex) || 1;
    const rx = -ez / rl;
    const rz = ex / rl;
    const ux = -ey * rz;
    const uy = -ez * rx + ex * rz;
    const uz = ey * rx;
    const corners: [number, number, number][] = [];
    for (const y of [0, TOWN_HEIGHT]) for (const x of [f.x, f.x + f.w]) for (const z of [f.z, f.z + f.d]) corners.push([x - g.tx, y, z - g.tz]);
    const project = (r: number, ox: number, oy: number) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [px, py, pz] of corners) {
        const dx = px - ex * r;
        const dy = py - ey * r;
        const dz = pz - ez * r;
        const depth = -(dx * ex + dy * ey + dz * ez);
        const x = (dx * rx + dz * rz + ox) / (Math.max(0.1, depth) * tanX);
        const y = (dx * ux + dy * uy + dz * uz + oy) / (Math.max(0.1, depth) * tanY);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return { minX, maxX, minY, maxY };
    };
    const offsets = (r: number) => {
      let ox = ncx * r * tanX;
      let oy = ncy * r * tanY;
      for (let i = 0; i < 4; i++) {
        const b = project(r, ox, oy);
        ox += (ncx - (b.minX + b.maxX) / 2) * r * tanX;
        oy += (ncy - (b.minY + b.maxY) / 2) * r * tanY;
      }
      return [ox, oy] as const;
    };
    const fits = (r: number) => {
      const [ox, oy] = offsets(r);
      const b = project(r, ox, oy);
      return (b.maxX - b.minX) / 2 <= hx && (b.maxY - b.minY) / 2 <= hy;
    };
    let lo = 4;
    let hi = 900;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    g.radius = hi;
    [g.ox, g.oy] = offsets(hi);
  }
}

export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
