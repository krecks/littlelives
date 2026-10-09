/**
 * Main-thread side of the simulation. Owns the worker and turns the snapshot stream
 * into interpolatable frames for the renderer. Allocation-free per frame.
 */

import type { Catalog, Command, FromWorker, GameSource, SimThreadStats, SocialEvent, SocialOption, ToWorker, UiSnapshot, WorldStructure } from './protocol';
import { SharedSnapshotReader, type SnapshotLayout } from './snapshot';

/** What the renderer needs each frame. Reused; do not keep references across frames. */
export interface FrameState {
  prev: Float32Array;
  curr: Float32Array;
  /** Progress from `prev` to `curr`: 0..1, slightly above 1 when a snapshot is late (extrapolates). */
  alpha: number;
  layout: SnapshotLayout;
  now: number;
}

type Listener<T> = (value: T) => void;

/** How quickly the frame clock follows snapshot arrivals (per arrival); small = smooth over jitter. */
const CLOCK_GAIN = 0.05;
/** Arrivals further off than this many steps (hitch, hidden tab, backlog) restart the clock. */
const CLOCK_RESET_STEPS = 2;
/** How far past the newest snapshot motion may continue while waiting for a late one. */
const MAX_EXTRAPOLATION = 1.3;

export class SimBridge {
  readonly layout: SnapshotLayout;
  private readonly worker: Worker;
  private readonly reader: SharedSnapshotReader | null;
  private readonly stepMs: number;
  /** The three newest snapshots, oldest first, and a buffer for the next one. */
  private prev2: Float32Array;
  private prev: Float32Array;
  private curr: Float32Array;
  private scratch: Float32Array;
  /**
   * Frame clock: snapshot `n` is drawn as arriving at `clockBase + n * stepMs`. It follows the
   * average arrival rhythm, not each arrival, so timer jitter (e.g. browsers coarsening timers
   * for privacy) doesn't make motion stall and jump.
   */
  private clockBase = 0;
  private arrivals = 0;
  private clocked = false;
  private hasData = false;
  private pending = false;
  private readonly frameState: FrameState;

  private world: WorldStructure | null = null;
  private ui: UiSnapshot | null = null;
  /** The worker's latest report on how it keeps up (null until the first, after a second). */
  threadStats: SimThreadStats | null = null;
  private worldListeners: Listener<WorldStructure>[] = [];
  private uiListeners: Listener<UiSnapshot>[] = [];
  private errorListeners: Listener<string>[] = [];
  private nextRequest = 1;
  private readonly requests = new Map<number, (value: never) => void>();

  private constructor(
    worker: Worker,
    layout: SnapshotLayout,
    shared: SharedArrayBuffer | null,
    /** Careers and build/buy rules, as the simulation expanded them. */
    readonly catalog: Catalog,
  ) {
    this.worker = worker;
    this.layout = layout;
    this.stepMs = 1000 / layout.ticksPerSecond;
    this.reader = shared ? new SharedSnapshotReader(shared, layout.capacity) : null;
    this.prev2 = new Float32Array(layout.capacity);
    this.prev = new Float32Array(layout.capacity);
    this.curr = new Float32Array(layout.capacity);
    this.scratch = new Float32Array(layout.capacity);
    this.frameState = { prev: this.prev, curr: this.curr, alpha: 0, layout, now: 0 };
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
  }

  static start(content: string, source: GameSource): Promise<SimBridge> {
    const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message || 'sim worker failed to start'));
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const msg = e.data;
        if (msg.type === 'ready') resolve(new SimBridge(worker, msg.layout, msg.shared, msg.catalog));
        else if (msg.type === 'error') reject(new Error(msg.message));
      };
      worker.postMessage({ type: 'init', content, source } satisfies ToWorker);
    });
  }

  get sharedMemory(): boolean {
    return this.reader !== null;
  }

  send(command: Command): void {
    this.worker.postMessage({ type: 'command', command } satisfies ToWorker);
  }

  /** Limits wall/floor geometry to a tile rectangle (the lot being viewed); null = all. */
  setView(region: [number, number, number, number] | null): void {
    this.worker.postMessage({ type: 'view', region } satisfies ToWorker);
  }

  /** Serialized game state, taken between two sim steps. */
  requestSave(): Promise<string> {
    return this.request<string>((requestId) => ({ type: 'save', requestId }));
  }

  /** What `actor` can do with `target`, with success chances. */
  requestSocialOptions(actor: number, target: number): Promise<SocialOption[]> {
    return this.request<SocialOption[]>((requestId) => ({ type: 'socialOptions', requestId, actor, target }));
  }

  /** The whole story log, oldest first. */
  requestEvents(): Promise<SocialEvent[]> {
    return this.request<SocialEvent[]>((requestId) => ({ type: 'events', requestId }));
  }

  private request<T>(message: (requestId: number) => ToWorker): Promise<T> {
    const requestId = this.nextRequest++;
    return new Promise<T>((resolve) => {
      this.requests.set(requestId, resolve as (value: never) => void);
      this.worker.postMessage(message(requestId));
    });
  }

  private resolve(requestId: number, value: unknown): void {
    this.requests.get(requestId)?.(value as never);
    this.requests.delete(requestId);
  }

  /** Latest world structure is replayed to late subscribers. */
  onWorld(fn: Listener<WorldStructure>): void {
    this.worldListeners.push(fn);
    if (this.world) fn(this.world);
  }

  onUi(fn: Listener<UiSnapshot>): void {
    this.uiListeners.push(fn);
    if (this.ui) fn(this.ui);
  }

  onError(fn: Listener<string>): void {
    this.errorListeners.push(fn);
  }

  /** Pulls the newest snapshot. Call once per rendered frame, before `frame()`. */
  sync(now: number): void {
    const fresh = this.reader ? this.reader.read(this.scratch) : this.pending;
    if (!fresh) return;
    this.pending = false;
    const old = this.prev2;
    this.prev2 = this.prev;
    this.prev = this.curr;
    this.curr = this.scratch;
    this.scratch = old;
    if (!this.hasData) {
      this.prev.set(this.curr);
      this.prev2.set(this.curr);
      this.hasData = true;
    }
    this.arrivals++;
    const late = now - (this.clockBase + this.arrivals * this.stepMs);
    if (!this.clocked || Math.abs(late) > CLOCK_RESET_STEPS * this.stepMs) {
      this.clockBase = now - this.arrivals * this.stepMs;
      this.clocked = true;
    } else {
      this.clockBase += late * CLOCK_GAIN;
    }
  }

  /** Interpolation state for rendering: draws one step behind the sim for smooth motion. */
  frame(now: number): FrameState {
    const f = this.frameState;
    const t = (now - (this.clockBase + this.arrivals * this.stepMs)) / this.stepMs;
    if (t < 0) {
      // The newest snapshot came early: finish the step before it first.
      f.prev = this.prev2;
      f.curr = this.prev;
      f.alpha = Math.max(0, t + 1);
    } else {
      f.prev = this.prev;
      f.curr = this.curr;
      f.alpha = Math.min(t, MAX_EXTRAPOLATION);
    }
    f.now = now;
    return f;
  }

  /** Most recent snapshot (not interpolated). */
  latest(): Float32Array {
    return this.curr;
  }

  dispose(): void {
    this.worker.terminate();
  }

  private handle(msg: FromWorker): void {
    switch (msg.type) {
      case 'snapshot':
        this.scratch.set(msg.data);
        this.pending = true;
        break;
      case 'world': {
        // A lean world leaves out the lot: keep the one we have (same arrays, so consumers
        // can tell by reference that walls, floors and meshes didn't change).
        const world: WorldStructure = msg.full || !this.world ? (msg.world as WorldStructure) : { ...this.world, ...msg.world };
        this.world = world;
        for (const fn of this.worldListeners) fn(world);
        break;
      }
      case 'ui':
        this.ui = msg.ui;
        for (const fn of this.uiListeners) fn(msg.ui);
        break;
      case 'saved':
        this.resolve(msg.requestId, msg.data);
        break;
      case 'socialOptions':
        this.resolve(msg.requestId, msg.options);
        break;
      case 'events':
        this.resolve(msg.requestId, msg.events);
        break;
      case 'stats':
        this.threadStats = msg.stats;
        break;
      case 'error':
        for (const fn of this.errorListeners) fn(msg.message);
        break;
      case 'ready':
        break;
    }
  }
}
