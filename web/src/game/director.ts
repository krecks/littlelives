/**
 * The watching director: while the player leaves the game alone, it picks what's worth seeing
 * at home (a conversation, a fight, a first kiss, someone trying out what was just built, a
 * guest arriving) and frames it; when nothing is going on it looks around the house. Any input
 * hands the camera back (see `session.ts`). Pure logic: it reads the snapshot and the world
 * structure and asks for shots, which the renderer flies.
 */

import type { Content } from '../content/content';
import { groundDepth, type SocialEvent, type WorldStructure } from '../core/protocol';
import type { SnapshotLayout } from '../core/snapshot';
import type { GameShot, WallMode } from '../render/types';

export type DirectorPace = 'calm' | 'lively';

export interface DirectorDeps {
  content: Content;
  layout: SnapshotLayout;
  /** Newest snapshot (not interpolated). */
  snapshot(): Float32Array;
  /** Frames a shot with the given walls. */
  shoot(shot: GameShot, walls: WallMode): void;
  pace(): DirectorPace;
  reducedMotion(): boolean;
}

/** Something worth looking at, with how much it's worth. */
interface Moment {
  key: string;
  priority: number;
  /** Residents (snapshot indices) to keep in frame; empty for a place. */
  sims: number[];
  shot: GameShot;
  walls: WallMode;
}

/** Hold times per pace (seconds): at least, at most. */
const HOLD: Record<DirectorPace, [number, number]> = { calm: [12, 30], lively: [7, 18] };
/** A moment this much more important than the current one may cut in early. */
const CUT_IN = 30;
/** But never before this (seconds). */
const MIN_CUT = 4;
/** How long a placed object counts as new (ms of real time). */
const NEW_OBJECT_MS = 10 * 60_000;
/** How long a story event stays worth showing (ms). */
const EVENT_MS = 20_000;
const SCAN_MS = 250;

export class Director {
  private world: WorldStructure | null = null;
  private home: number | null = null;
  private running = false;
  private current: Moment | null = null;
  private since = 0;
  private lastScan = 0;
  private lastSims: number[] = [];
  /** Objects placed recently (id → when), until they've been shown in use. */
  private readonly fresh = new Map<number, number>();
  /** Story events at home still worth a look (id → when they came in). */
  private readonly events = new Map<number, { event: SocialEvent; at: number }>();
  /** Guests seen on the lot (snapshot indices), so each arrival is shown once. */
  private readonly guests = new Set<number>();
  private ambient = 0;

  constructor(private readonly deps: DirectorDeps) {}

  get active(): boolean {
    return this.running;
  }

  setWorld(world: WorldStructure, home: number | null): void {
    this.world = world;
    this.home = home;
  }

  /** A lot row on the ground's rows (residents upstairs are framed where they stand). */
  private groundRow(z: number): number {
    const d = this.world && (this.world.storeys ?? 1) > 1 ? groundDepth(this.world) : 0;
    return d > 0 ? z - Math.floor(z / d) * d : z;
  }

  /** Objects the player just placed: their first use is worth a look. */
  noteBuilt(ids: readonly number[], now: number): void {
    for (const id of ids) this.fresh.set(id, now);
  }

  /** New story events (any importance; the notable ones about people at home get a shot). */
  noteEvents(events: readonly SocialEvent[], now: number): void {
    for (const e of events) if (e.importance >= 1) this.events.set(e.id, { event: e, at: now });
  }

  start(now: number): void {
    if (this.running) return;
    this.running = true;
    this.current = null;
    this.update(now, true);
  }

  stop(): void {
    this.running = false;
    this.current = null;
  }

  /** Asks for a look at a story event (the journal); false when its people aren't at home. */
  show(e: SocialEvent, now: number): boolean {
    const sims = [e.a, e.b].filter((s, i, all) => all.indexOf(s) === i && this.atHome(s));
    if (!sims.length) return false;
    this.running = true;
    this.cut(this.peopleMoment(`event:${e.id}`, 100, sims), now);
    return true;
  }

  /** Call every frame; it looks for moments a few times a second. */
  update(now: number, force = false): void {
    if (!this.running || (!force && now - this.lastScan < SCAN_MS)) return;
    this.lastScan = now;
    for (const [id, at] of this.fresh) if (now - at > NEW_OBJECT_MS) this.fresh.delete(id);
    for (const [id, { at }] of this.events) if (now - at > EVENT_MS) this.events.delete(id);

    const [minHold, maxHold] = HOLD[this.deps.pace()];
    const held = (now - this.since) / 1000;
    const moments = this.moments();
    const best = moments.find((m) => m.key !== this.current?.key && !this.sameSims(m)) ?? moments[0] ?? null;
    const current = this.current;
    const stillOn = current && (current.sims.length === 0 || moments.some((m) => m.key === current.key));
    let next: Moment | null = null;
    if (!current) next = best ?? this.ambientMoment();
    else if (best && best.priority >= current.priority + CUT_IN && held >= MIN_CUT) next = best;
    else if (!stillOn && held >= MIN_CUT) next = best ?? this.ambientMoment();
    else if (held >= (current.sims.length ? maxHold : minHold * 1.5)) next = best && held >= minHold ? best : this.ambientMoment();
    else if (held >= minHold && best && best.priority > current.priority) next = best;
    if (next && next.key !== current?.key) this.cut(next, now);
  }

  private cut(m: Moment, now: number): void {
    this.current = m;
    this.since = now;
    this.lastSims = m.sims;
    if (m.key.startsWith('use:')) this.fresh.delete(Number(m.key.slice(4)));
    if (m.key.startsWith('event:')) this.events.delete(Number(m.key.slice(6)));
    const still = this.deps.reducedMotion();
    this.deps.shoot({ ...m.shot, drift: still ? 0 : m.shot.drift, duration: still ? 0 : m.shot.duration }, m.walls);
  }

  private sameSims(m: Moment): boolean {
    return m.sims.length > 0 && m.sims.length === this.lastSims.length && m.sims.every((s) => this.lastSims.includes(s));
  }

  /** Everything worth seeing right now, best first. */
  private moments(): Moment[] {
    const world = this.world;
    if (!world || this.home === null) return [];
    const { layout } = this.deps;
    const snap = this.deps.snapshot();
    const count = snap[layout.header.simCount];
    const at = (i: number) => layout.headerLen + i * layout.simStride;
    const out: Moment[] = [];

    for (let i = 0; i < count; i++) {
      if (!this.atHome(i)) {
        this.guests.delete(i);
        continue;
      }
      const o = at(i);
      // Conversations, seen from the one who started them.
      const social = snap[o + layout.sim.social];
      if (social > 0 && snap[o + layout.sim.role] === 1) {
        const partner = snap[o + layout.sim.partner];
        if (partner >= 0 && this.atHome(partner)) {
          const def = this.deps.content.social(social - 1);
          const priority = def?.category === 'romantic' ? 60 : def?.category === 'mean' ? (def.id === 'fight' ? 70 : 55) : def?.category === 'makeup' ? 40 : 25;
          out.push(this.peopleMoment(`talk:${i}:${partner}`, priority, [i, partner]));
        }
      }
      // Trying out something new.
      const object = snap[o + layout.sim.object];
      if (object >= 0 && snap[o + layout.sim.action] >= 0 && this.fresh.has(object)) {
        out.push(this.peopleMoment(`use:${object}`, 50, [i], 8.5));
      }
      // A guest arrives.
      const info = world.sims[i];
      const household = info ? world.households[info.household] : undefined;
      if (household && household.plot !== this.home && !this.guests.has(i)) {
        this.guests.add(i);
        out.push(this.peopleMoment(`guest:${i}`, 45, [i], 13));
      }
    }
    for (const { event } of this.events.values()) {
      const sims = [event.a, event.b].filter((s, k, all) => all.indexOf(s) === k && this.atHome(s));
      if (sims.length) out.push(this.peopleMoment(`event:${event.id}`, event.importance >= 2 ? 100 : 40, sims));
    }
    return out.sort((a, b) => b.priority - a.priority);
  }

  /** A shot of residents: from the side of the line between them, close, walls cut away. */
  private peopleMoment(key: string, priority: number, sims: number[], radius = sims.length > 1 ? 10.5 : 9.5): Moment {
    const { layout } = this.deps;
    const snap = this.deps.snapshot();
    const pos = (i: number) => {
      const o = layout.headerLen + i * layout.simStride;
      return [snap[o + layout.sim.x], this.groundRow(snap[o + layout.sim.z])] as const;
    };
    let alpha: number | undefined;
    if (sims.length > 1) {
      const [ax, az] = pos(sims[0]);
      const [bx, bz] = pos(sims[1]);
      alpha = Math.atan2(bz - az, bx - ax) + Math.PI / 2;
    }
    return { key, priority, sims, walls: 'cutaway', shot: { follow: sims, alpha, beta: 0.98, radius, drift: 0.015, duration: 2.6 } };
  }

  /** Nothing going on: the whole house from above, a resident at home, or the outside. */
  private ambientMoment(): Moment | null {
    const world = this.world;
    const plot = this.home === null ? null : world?.plots[this.home];
    if (!world || !plot) return null;
    const kind = this.ambient++ % 4;
    const [x0, z0, x1, z1] = plot.house ?? [plot.x, plot.z, plot.x + plot.w, plot.z + plot.d];
    const target = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
    const size = Math.max(x1 - x0, z1 - z0);
    if (kind === 1) {
      const residents = this.residentsAtHome();
      if (residents.length) {
        const who = residents[Math.floor(Math.random() * residents.length)];
        return { ...this.peopleMoment(`near:${who}`, 5, [who], 12), priority: 5 };
      }
    }
    if (kind === 3) {
      return { key: `outside:${this.ambient}`, priority: 5, sims: [], walls: 'up', shot: { target, beta: 1.12, radius: Math.min(70, size * 1.7 + 12), drift: 0.03, duration: 3.2 } };
    }
    return { key: `house:${this.ambient}`, priority: 5, sims: [], walls: 'cutaway', shot: { target, beta: 0.72, radius: Math.min(60, size * 1.25 + 8), drift: 0.025, duration: 3.2 } };
  }

  private residentsAtHome(): number[] {
    const world = this.world;
    if (!world) return [];
    const out: number[] = [];
    for (const s of world.sims) {
      if (world.households[s.household]?.plot === this.home && this.atHome(s.id)) out.push(s.id);
    }
    return out;
  }

  /** Whether resident `i` is on the home lot (and not away at work). */
  private atHome(i: number): boolean {
    const plot = this.home === null ? null : this.world?.plots[this.home];
    if (!plot) return false;
    const { layout } = this.deps;
    const snap = this.deps.snapshot();
    if (i < 0 || i >= snap[layout.header.simCount]) return false;
    const o = layout.headerLen + i * layout.simStride;
    if (snap[o + layout.sim.away] > 0) return false;
    const x = snap[o + layout.sim.x];
    const z = this.groundRow(snap[o + layout.sim.z]);
    return x >= plot.x && z >= plot.z && x < plot.x + plot.w && z < plot.z + plot.d;
  }
}
