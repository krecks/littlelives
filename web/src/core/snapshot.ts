/**
 * Snapshot layout and the shared-memory channel between the sim worker and the renderer.
 * The layout itself is defined in Rust (`sim-core/src/snapshot.rs`) and fetched at startup.
 */

export interface SnapshotLayout {
  capacity: number;
  headerLen: number;
  simStride: number;
  maxSims: number;
  ticksPerSecond: number;
  header: {
    tick: number;
    day: number;
    minute: number;
    speed: number;
    simCount: number;
    structureVersion: number;
    /** 1 while time skips ahead because it's quiet at home (missing in older layouts). */
    calm?: number;
    /** Id of the latest milestone event modulo 2^24 (missing in older layouts). */
    majorEvent?: number;
  };
  sim: {
    id: number;
    x: number;
    z: number;
    yaw: number;
    pose: number;
    moving: number;
    social: number;
    outcome: number;
    partner: number;
    /** Conversation animation: index into sim-core's `social::ANIMATIONS` + 1 ('talk', 'laugh', ...), 0 = none. */
    anim: number;
    emotion: number;
    role: number;
    away: number;
    /** Object instance id (as in `WorldStructure.objects`) the Sim is using or walking to use, -1 = none. */
    object: number;
    /** Index into `actions` while using an object (not while walking to it) or talking, -1 = none. */
    action: number;
    /** Mood 0..1 (missing in older layouts). */
    mood?: number;
    /** Thought bubble: 0 none, 1 skipping a planned block, 2 wants a place for one, 3 kept one, 4 reached a goal. */
    thought?: number;
    /** Activity index (1–3) or goal definition (4). */
    thoughtSubject?: number;
    /** Height in storeys (0 the ground; fractions on the stairs); `z` is in lot rows (see `WorldStructure.storeys`). */
    height?: number;
  };
  /** Animation tags from content (`animations` in base.json), named by `sim.action`. */
  actions: string[];
}

export const Pose = { Stand: 0, Sit: 1, Lie: 2 } as const;

/** Bytes reserved before the snapshot floats: one Int32 sequence counter (padded). */
const SHARED_HEADER_BYTES = 16;

export function createSharedSnapshot(layout: SnapshotLayout): SharedArrayBuffer {
  return new SharedArrayBuffer(SHARED_HEADER_BYTES + layout.capacity * 4);
}

/**
 * Seqlock writer: the sequence is odd while writing and even when the data is consistent.
 * Lock-free: the reader never blocks the writer.
 */
export class SharedSnapshotWriter {
  private readonly seq: Int32Array;
  private readonly data: Float32Array;

  constructor(buffer: SharedArrayBuffer, capacity: number) {
    this.seq = new Int32Array(buffer, 0, 1);
    this.data = new Float32Array(buffer, SHARED_HEADER_BYTES, capacity);
  }

  write(src: Float32Array): void {
    Atomics.add(this.seq, 0, 1);
    this.data.set(src);
    Atomics.add(this.seq, 0, 1);
  }
}

export class SharedSnapshotReader {
  private readonly seq: Int32Array;
  private readonly data: Float32Array;
  private lastSeq = 0;

  constructor(buffer: SharedArrayBuffer, capacity: number) {
    this.seq = new Int32Array(buffer, 0, 1);
    this.data = new Float32Array(buffer, SHARED_HEADER_BYTES, capacity);
  }

  /** Copies a new consistent snapshot into `into`. Returns false if nothing new (or torn; retried next frame). */
  read(into: Float32Array): boolean {
    const before = Atomics.load(this.seq, 0);
    if (before === this.lastSeq || before & 1) return false;
    into.set(this.data);
    if (Atomics.load(this.seq, 0) !== before) return false;
    this.lastSeq = before;
    return true;
  }
}
