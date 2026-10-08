/**
 * Save slots in IndexedDB (browser storage, per device). One record per slot; the
 * `data` field is the simulation's own save format and is never parsed here.
 */

export interface SaveMeta {
  id: string;
  /** Player-facing slot name. */
  name: string;
  household: string;
  members: string[];
  day: number;
  minute: number;
  savedAt: number;
  /** Small JPEG data URL, if one could be captured. */
  thumbnail: string | null;
  autosave: boolean;
}

export interface SaveRecord extends SaveMeta {
  data: string;
}

export const AUTOSAVE_ID = 'autosave';

// Legacy key from the project's old name; kept so saves survive.
const DB_NAME = 'open-sims-wasm';
const STORE = 'saves';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('could not open save storage'));
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = op(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('save storage error'));
  });
}

/** Newest first, without the (large) game data. */
export async function listSaves(): Promise<SaveMeta[]> {
  const all = await run('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
  return all.map(({ data: _data, ...meta }) => meta).sort((a, b) => b.savedAt - a.savedAt);
}

export function readSave(id: string): Promise<SaveRecord | undefined> {
  return run('readonly', (s) => s.get(id) as IDBRequest<SaveRecord | undefined>);
}

export async function writeSave(record: SaveRecord): Promise<void> {
  await run('readwrite', (s) => s.put(record));
}

export async function deleteSave(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

export async function latestSave(): Promise<SaveMeta | undefined> {
  return (await listSaves())[0];
}
