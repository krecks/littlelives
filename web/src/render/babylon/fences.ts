/**
 * Fences and gates the player builds (Build mode's Fence and Gate tools): one baked mesh of
 * every fence edge in its style (picket, ranch rails, slats, wrought iron, low stone wall).
 * Fences are drawn per 1 m grid edge with posts on the grid corners they share, so runs and
 * corners join up; a gate is a framed leaf in the fence's style between two stout posts.
 */

import type { Mesh, Scene } from './core';
import type { FenceStyleDef } from '../../content/content';
import type { FenceEdge } from '../../core/protocol';
import { Geo } from './geometry';
import { MaterialLibrary } from './materials';
import { Painter } from './street';

type Kind = FenceStyleDef['kind'];

const FALLBACK: FenceStyleDef = { id: 'picket', label: 'Picket', kind: 'picket', color: '#F2F0EA', height: 1 };
/** Colour of iron gate leaves in stone walls. */
const IRON = '#2B2D30';

/** Builds the mesh of all fences and gates (null when there are none). */
export function buildFences(scene: Scene, fences: readonly FenceEdge[], styles: readonly FenceStyleDef[], layerMask?: number): Mesh | null {
  if (!fences.length) return null;
  const p = new Painter(new Geo());
  const styleOf = (f: FenceEdge) => styles[f.style ?? 0] ?? styles[0] ?? FALLBACK;
  // Posts where fences meet or end: once per grid corner, in the tallest style there.
  const posts = new Map<string, { x: number; z: number; style: FenceStyleDef; gate: boolean }>();
  for (const f of fences) {
    const style = styleOf(f);
    const ends: [number, number][] = f.axis === 'h' ? [[f.x, f.z], [f.x + 1, f.z]] : [[f.x, f.z], [f.x, f.z + 1]];
    for (const [x, z] of ends) {
      const key = `${x}:${z}`;
      const had = posts.get(key);
      if (!had || (style.height ?? 1) > (had.style.height ?? 1)) posts.set(key, { x, z, style, gate: f.kind === 'gate' || !!had?.gate });
      else if (f.kind === 'gate') had.gate = true;
    }
  }
  for (const f of fences) {
    const style = styleOf(f);
    // Local frame: +x along the edge (0..1), +z across it.
    p.at(f.x, f.z, f.axis === 'h' ? 0 : -Math.PI / 2);
    if (f.kind === 'gate') gate(p, style);
    else panel(p, style);
  }
  for (const post of posts.values()) {
    if (post.style.kind === 'stone' && !post.gate) continue;
    p.at(post.x, post.z, 0);
    postAt(p, post.style, post.gate);
  }
  const mesh = p.geo.toMesh('fences', scene, { colors: true, cut: false });
  if (!mesh) return null;
  mesh.hasVertexAlpha = false;
  mesh.material = MaterialLibrary.for(scene).plainFinish();
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  if (layerMask !== undefined) mesh.layerMask = layerMask;
  return mesh;
}

const height = (s: FenceStyleDef) => s.height ?? 1;
const rough: Record<Kind, number> = { picket: 0.6, rails: 0.8, slats: 0.55, iron: 0.45, stone: 0.95 };

/** A grid-corner post (stouter beside a gate). */
function postAt(p: Painter, s: FenceStyleDef, gate: boolean): void {
  const h = height(s) + (gate ? 0.08 : 0.04);
  const r = s.kind === 'iron' ? (gate ? 0.06 : 0.035) : s.kind === 'stone' ? 0.2 : gate ? 0.07 : 0.05;
  const colour = s.kind === 'stone' ? s.color : s.color;
  p.paint(colour, rough[s.kind], s.kind === 'iron' ? 0.4 : 0);
  p.box(-r, 0, -r, r, h, r, 'ny');
  if (s.kind === 'picket' || s.kind === 'rails') p.paint(shade(colour, 0.92), rough[s.kind], 0).box(-r - 0.015, h, -r - 0.015, r + 0.015, h + 0.035, r + 0.015, 'ny');
  if (s.kind === 'iron') p.box(-0.03, h, -0.03, 0.03, h + 0.07, 0.03, 'ny');
}

/** One metre of fence between two posts. */
function panel(p: Painter, s: FenceStyleDef): void {
  const h = height(s);
  p.paint(s.color, rough[s.kind], s.kind === 'iron' ? 0.4 : 0);
  switch (s.kind) {
    case 'picket':
      for (const y of [0.25 * h, 0.7 * h]) p.box(0, y, -0.03, 1, y + 0.06, -0.01, 'ny');
      for (let x = 0.12; x < 0.95; x += 0.15) {
        for (const [z, n] of [[0.01, 1], [-0.01, -1]] as const) {
          p.poly([[x - 0.036, 0.05, z], [x + 0.036, 0.05, z], [x + 0.036, h * 0.86, z], [x, h * 0.94, z], [x - 0.036, h * 0.86, z]], [0, 0, n]);
        }
      }
      return;
    case 'rails':
      for (const y of [0.22, 0.52, 0.82]) p.box(0, y * h, -0.025, 1, y * h + 0.09, 0.025, 'ny');
      return;
    case 'slats':
      for (let y = 0.06; y + 0.09 <= h; y += 0.12) p.box(0, y, -0.02, 1, y + 0.09, 0.02);
      return;
    case 'iron':
      p.box(0, 0.1, -0.012, 1, 0.13, 0.012);
      p.box(0, h - 0.12, -0.012, 1, h - 0.09, 0.012);
      for (let x = 0.1; x < 0.95; x += 0.1) {
        p.box(x - 0.01, 0.02, -0.01, x + 0.01, h - 0.02, 0.01, 'ny');
        p.box(x - 0.02, h - 0.02, -0.02, x + 0.02, h + 0.02, 0.02, 'ny');
      }
      return;
    case 'stone':
      // A dry-stone wall, a little overlapping its neighbours so corners close, with a cap.
      p.box(-0.16, 0, -0.16, 1.16, h - 0.06, 0.16, 'ny');
      p.paint(shade(s.color, 1.12), 0.9, 0).box(-0.19, h - 0.06, -0.19, 1.19, h, 0.19, 'ny');
      return;
  }
}

/** A gate leaf: a frame with a brace, filled in the fence's style (iron in a stone wall). */
function gate(p: Painter, s: FenceStyleDef): void {
  const stone = s.kind === 'stone';
  const h = stone ? 1.0 : height(s);
  const colour = stone ? IRON : s.color;
  const [x0, x1, y0, y1] = [0.09, 0.91, 0.06, h * 0.92];
  const t = s.kind === 'iron' || stone ? 0.012 : 0.03;
  p.paint(shade(colour, 0.9), rough[stone ? 'iron' : s.kind], stone || s.kind === 'iron' ? 0.4 : 0);
  p.box(x0, y0, -t, x1, y0 + 0.07, t);
  p.box(x0, y1 - 0.07, -t, x1, y1, t);
  p.box(x0, y0, -t, x0 + 0.06, y1, t);
  p.box(x1 - 0.06, y0, -t, x1, y1, t);
  p.paint(colour, rough[stone ? 'iron' : s.kind], stone || s.kind === 'iron' ? 0.4 : 0);
  if (s.kind === 'iron' || stone) {
    for (let x = x0 + 0.12; x < x1 - 0.06; x += 0.1) p.box(x - 0.01, y0, -0.01, x + 0.01, y1, 0.01);
    return;
  }
  // Diagonal brace from the hinge foot to the latch head.
  const [bx0, by0, bx1, by1] = [x0 + 0.06, y0 + 0.07, x1 - 0.06, y1 - 0.07];
  const w = 0.04;
  for (const [z, n] of [[t + 0.002, 1], [-t - 0.002, -1]] as const) {
    p.poly([[bx0, by0, z], [bx0 + w, by0, z], [bx1, by1 - w, z], [bx1, by1, z], [bx1 - w, by1, z], [bx0, by0 + w, z]], [0, 0, n]);
  }
  if (s.kind === 'picket') {
    for (let x = x0 + 0.11; x < x1 - 0.06; x += 0.13) p.box(x - 0.03, y0, -0.01, x + 0.03, y1 + 0.04, 0.01);
  } else if (s.kind === 'slats') {
    for (let y = y0 + 0.1; y + 0.08 < y1 - 0.06; y += 0.12) p.box(x0 + 0.06, y, -0.015, x1 - 0.06, y + 0.08, 0.015);
  } else {
    p.box(x0, (y0 + y1) / 2 - 0.04, -t, x1, (y0 + y1) / 2 + 0.04, t);
  }
}

/** A colour lightened (>1) or darkened (<1). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
