/**
 * Main-thread side of the simulation. Owns the worker and turns the snapshot stream
 * into interpolatable frames for the renderer. Allocation-free per frame.
 */

import type { Command, FromWorker, GameSource, SocialOption, ToWorker, UiSnapshot, WorldStructure } from './protocol';
import { SharedSnapshotReader, type SnapshotLayout } from './snapshot';

/** What the renderer needs each frame. Reused; do not keep references across frames. */
export interface FrameState {
  prev: Float32Array;
  curr: Float32Array;
  /** 0..1 progress from `prev` to `curr`. */
  alpha: number;
  layout: SnapshotLayout;
  now: number;
}

type Listener<T> = (value: T) => void;

export class SimBridge {
  readonly layout: SnapshotLayout;
  private readonly worker: Worker;
  private readonly reader: SharedSnapshotReader | null;
  private readonly stepMs: number;
  private prev: Float32Array;
  private curr: Float32Array;
  private scratch: Float32Array;
  private currTime = 0;
  private hasData = false;
  private pending = false;
  private readonly frameState: FrameState;

  private world: WorldStructure | null = null;
  private ui: UiSnapshot | null = null;
  private worldListeners: Listener<WorldStructure>[] = [];
  private uiListeners: Listener<UiSnapshot>[] = [];
  private errorListeners: Listener<string>[] = [];
  private nextRequest = 1;
  private readonly requests = new Map<number, (value: never) => void>();

  private constructor(worker: Worker, layout: SnapshotLayout, shared: SharedArrayBuffer | null) {
    this.worker = worker;
    this.layout = layout;
    this.stepMs = 1000 / layout.ticksPerSecond;
    this.reader = shared ? new SharedSnapshotReader(shared, layout.capacity) : null;
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
        if (msg.type === 'ready') resolve(new SimBridge(worker, msg.layout, msg.shared));
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
    const old = this.prev;
    this.prev = this.curr;
    this.curr = this.scratch;
    this.scratch = old;
    if (!this.hasData) {
      this.prev.set(this.curr);
      this.hasData = true;
    }
    this.currTime = now;
  }

  /** Interpolation state for rendering: draws one step behind the sim for smooth motion. */
  frame(now: number): FrameState {
    const f = this.frameState;
    f.prev = this.prev;
    f.curr = this.curr;
    f.alpha = Math.min(1, Math.max(0, (now - this.currTime) / this.stepMs));
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
      case 'world':
        this.world = msg.world;
        for (const fn of this.worldListeners) fn(msg.world);
        break;
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
      case 'error':
        for (const fn of this.errorListeners) fn(msg.message);
        break;
      case 'ready':
        break;
    }
  }
}
