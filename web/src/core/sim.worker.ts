/**
 * Sim worker: owns the Rust/WASM simulation and runs it at a fixed rate,
 * independent of rendering. Publishes:
 * - a render snapshot every step (shared memory, zero allocations),
 * - a UI view at ~10 Hz,
 * - world structure (geometry, placements) only when it changes.
 */

import init, { Game } from './wasm-pkg/sim_wasm.js';
import type { FromWorker, GameSource, MeshArrays, ToWorker, WorldStructure } from './protocol';
import { createSharedSnapshot, SharedSnapshotWriter, type SnapshotLayout } from './snapshot';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

const UI_INTERVAL_MS = 100;
/** After a stall (tab hidden, debugger), skip the backlog instead of fast-forwarding. */
const MAX_BACKLOG_MS = 1000;

let game: Game | null = null;
let memory: WebAssembly.Memory;
let writer: SharedSnapshotWriter | null = null;
let lastStructure = -1;
/** Tile rectangle whose walls and floors are sent to the renderer (null = whole town). */
let region: [number, number, number, number] | null = null;

scope.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      void start(msg.content, msg.source).catch((err) => fail(err, true));
    } else if (msg.type === 'save' && game) {
      scope.postMessage({ type: 'saved', requestId: msg.requestId, data: game.save() });
    } else if (msg.type === 'view') {
      region = msg.region;
      if (game) postWorld();
    } else if (msg.type === 'socialOptions' && game) {
      const options = JSON.parse(game.social_options(msg.actor, msg.target));
      scope.postMessage({ type: 'socialOptions', requestId: msg.requestId, options });
    } else if (msg.type === 'command' && game) {
      game.command(JSON.stringify(msg.command));
      publish();
      postUi();
    }
  } catch (err) {
    fail(err, false);
  }
};

async function start(content: string, source: GameSource): Promise<void> {
  memory = (await init()).memory;
  game = 'save' in source ? Game.fromSave(content, source.save) : new Game(content, source.lot, source.seed);
  const layout: SnapshotLayout = JSON.parse(game.snapshot_layout());

  const shared = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated ? createSharedSnapshot(layout) : null;
  writer = shared ? new SharedSnapshotWriter(shared, layout.capacity) : null;
  scope.postMessage({ type: 'ready', layout, shared, catalog: JSON.parse(game.catalog()) });

  publish();
  postUi();
  runLoop(1000 / layout.ticksPerSecond);
}

function runLoop(stepMs: number): void {
  let next = performance.now() + stepMs;
  let lastUi = 0;
  const step = () => {
    game!.advance();
    publish();
    const now = performance.now();
    if (now - lastUi >= UI_INTERVAL_MS) {
      lastUi = now;
      postUi();
    }
    next += stepMs;
    if (now - next > MAX_BACKLOG_MS) next = now;
    setTimeout(step, Math.max(0, next - now));
  };
  setTimeout(step, stepMs);
}

function publish(): void {
  const g = game!;
  // Re-create the view each time: WASM memory growth detaches old views.
  const view = new Float32Array(memory.buffer, g.snapshot_ptr(), g.snapshot_len());
  if (writer) {
    writer.write(view);
  } else {
    const copy = view.slice();
    scope.postMessage({ type: 'snapshot', data: copy }, [copy.buffer]);
  }
  const version = g.structure_version();
  if (version !== lastStructure) {
    lastStructure = version;
    postWorld();
  }
}

function postWorld(): void {
  const g = game!;
  const meshes = { walls: mesh(g, 0), wallsLow: mesh(g, 1), floors: mesh(g, 2) };
  const world: WorldStructure = { ...JSON.parse(g.structure()), meshes };
  const transfer = Object.values(meshes).flatMap((m) => [m.positions.buffer, m.normals.buffer, m.uvs.buffer, m.indices.buffer]);
  scope.postMessage({ type: 'world', world }, transfer);
}

function mesh(g: Game, kind: number): MeshArrays {
  const [x0, z0, x1, z1] = region ?? [0, 0, 1 << 16, 1 << 16];
  const m = g.build_mesh(kind, x0, z0, x1, z1);
  const out = { positions: m.positions, normals: m.normals, uvs: m.uvs, indices: m.indices };
  m.free();
  return out;
}

function postUi(): void {
  scope.postMessage({ type: 'ui', ui: JSON.parse(game!.ui_state()) });
}

function fail(err: unknown, fatal: boolean): void {
  const message = err instanceof Error ? err.message : String(err);
  scope.postMessage({ type: 'error', message, fatal });
}
