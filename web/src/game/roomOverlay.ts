/**
 * Build mode's room-score overlay: each room's floor tinted from red to green by its overall
 * score, with a tag over its centre (kind, score, what would help most). Rooms come from the UI
 * snapshot (sim-core `rooms.rs`), their tiles from the world structure's per-tile room ids.
 * The tags are DOM elements positioned per frame, like the bubbles; nothing is allocated per
 * frame.
 */

import type { Content } from '../content/content';
import { groundDepth, storeyOfRow, type RoomView, type WorldStructure } from '../core/protocol';
import { STOREY_HEIGHT, type Renderer, type RoomOverlayTile } from '../render/types';

/** Factor names in `RoomView.scores` order. */
export const ROOM_FACTORS = ['size', 'light', 'decor', 'clean', 'function'] as const;
/** What a weak factor asks for, as a tag's second line. */
const NEEDS: Record<(typeof ROOM_FACTORS)[number], string> = {
  size: 'needs space',
  light: 'needs light',
  decor: 'needs decor',
  clean: 'needs tidying',
  function: 'missing something',
};
/** Below this a factor is worth pointing out. */
const WEAK = 0.6;

/** Red (0) through amber (0.5) to green (1). */
export function scoreColor(score: number): [number, number, number] {
  const s = Math.min(1, Math.max(0, score));
  const red: [number, number, number] = [0.9, 0.33, 0.3];
  const amber: [number, number, number] = [0.95, 0.72, 0.25];
  const green: [number, number, number] = [0.3, 0.75, 0.47];
  const [a, b, t] = s < 0.5 ? [red, amber, s * 2] : [amber, green, (s - 0.5) * 2];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function roomName(content: Content, r: RoomView): string {
  if (r.garden) return 'Garden';
  const kind = r.kind === undefined ? undefined : content.roomKinds[r.kind];
  return kind ? (kind.label ?? kind.id) : 'Spare room';
}

/** The factor that would help most (lowest), if it's weak. */
export function weakest(r: RoomView): (typeof ROOM_FACTORS)[number] | null {
  let best = 0;
  for (let i = 1; i < ROOM_FACTORS.length; i++) if (r.scores[i] < r.scores[best]) best = i;
  return r.scores[best] < WEAK ? ROOM_FACTORS[best] : null;
}

interface Tag {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
}

export class RoomOverlay {
  private readonly root: HTMLDivElement;
  private tags: Tag[] = [];
  private key = '';
  private readonly screen = { x: 0, y: 0 };

  constructor(
    container: HTMLElement,
    private readonly renderer: Renderer,
    private readonly content: Content,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'room-tags';
    container.appendChild(this.root);
  }

  /** Shows `rooms` on storey `storey` of `world` (null hides the overlay). Cheap when nothing changed. */
  set(world: WorldStructure | null, rooms: readonly RoomView[] | null, storey = 0): void {
    const shown = world && rooms ? rooms.filter((r) => !r.garden && storeyOfRow(world, r.centre[1]) === storey) : [];
    const key = world && rooms ? `${world.lotVersion}|${storey}|${shown.map((r) => `${r.id}:${r.kind}:${r.scores.join(',')}`).join(';')}` : '';
    if (key === this.key) return;
    this.key = key;
    this.renderer.setRoomOverlay(world ? this.tiles(world, shown, storey) : []);
    const lift = world ? storey * groundDepth(world) : 0;
    this.root.replaceChildren();
    this.tags = shown.map((r) => {
      const el = document.createElement('div');
      el.className = 'room-tag';
      const [cr, cg, cb] = scoreColor(r.scores[5]);
      el.style.setProperty('--score', `rgb(${cr * 255}, ${cg * 255}, ${cb * 255})`);
      const head = document.createElement('b');
      head.textContent = `${roomName(this.content, r)} · ${Math.round(r.scores[5] * 100)}`;
      el.appendChild(head);
      const weak = weakest(r);
      if (weak) {
        const line = document.createElement('span');
        line.textContent = r.mixed && weak === 'function' ? 'two rooms in one' : NEEDS[weak];
        el.appendChild(line);
      }
      el.style.display = 'none';
      this.root.appendChild(el);
      return { el, x: r.centre[0], y: storey * STOREY_HEIGHT, z: r.centre[1] - lift };
    });
  }

  /** Positions the tags (call per frame while shown). */
  update(): void {
    for (const t of this.tags) {
      const on = this.renderer.project(t.x, t.y + 0.2, t.z, this.screen);
      t.el.style.display = on ? '' : 'none';
      if (on) t.el.style.transform = `translate3d(${this.screen.x}px, ${this.screen.y}px, 0) translate(-50%, -50%)`;
    }
  }

  dispose(): void {
    this.renderer.setRoomOverlay([]);
    this.root.remove();
  }

  /** Tiles of the storey's rooms, in its lot rows (the renderer lifts them to that storey). */
  private tiles(world: WorldStructure, rooms: readonly RoomView[], storey: number): RoomOverlayTile[] {
    const colors = new Map(rooms.map((r) => [r.id, scoreColor(r.scores[5])]));
    const split = new Map((world.diagonals ?? []).map((d) => [d.z * world.width + d.x, d.rooms]));
    const out: RoomOverlayTile[] = [];
    const rows = groundDepth(world);
    for (let z = storey * rows; z < Math.min(world.depth, (storey + 1) * rows); z++) {
      for (let x = 0; x < world.width; x++) {
        const i = z * world.width + x;
        const halves = split.get(i);
        const id = world.rooms[i] || (halves ? halves[0] || halves[1] : 0);
        const rgb = id ? colors.get(id) : undefined;
        if (rgb) out.push({ x, z, rgb });
      }
    }
    return out;
  }
}
