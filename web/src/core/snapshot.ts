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
  header: { tick: number; day: number; minute: number; speed: number; simCount: number; structureVersion: number };
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
    anim: number;
    emotion: number;
    role: number;
    away: number;
  };
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
