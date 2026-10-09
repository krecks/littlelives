/**
 * Resolves asset keys to entries. Manifests stack: later packs override earlier keys,
 * so new art can be dropped in without changing code or the base manifest.
 *
 * Production builds also ship compressed copies of the base assets (KTX2 textures, meshopt
 * models, gzipped character data; see `tools/assets/optimize.mjs`) and an index of them,
 * `optimized.json` next to the base manifest. Loaders ask `optimizedUrl` for the file to fetch;
 * files without a copy (the dev server, a modder's pack) load as they are.
 */

import type { AssetEntry, AssetType, EntryOf, IconEntry, Manifest } from './types';

const URL_FIELDS = ['url', 'texture'] as const;

export class AssetRegistry {
  private readonly entries = new Map<string, AssetEntry>();
  private readonly warned = new Set<string>();

  static async load(manifestUrl: string, extraPacks: readonly string[] = []): Promise<AssetRegistry> {
    const registry = new AssetRegistry();
    const base = new URL(manifestUrl, location.href);
    // Every manifest downloads at once; entries apply in order (later packs override earlier keys).
    const [manifests] = await Promise.all([
      Promise.all([fetchManifests(base), ...extraPacks.map((pack) => fetchManifests(new URL(pack, base)))]),
      loadOptimized(base),
    ]);
    for (const [url, manifest] of manifests.flat()) {
      for (const [key, entry] of Object.entries(manifest.entries)) registry.entries.set(key, resolveUrls(entry, url));
    }
    return registry;
  }

  get<T extends AssetType>(key: string, type: T): EntryOf<T> | undefined {
    const entry = this.entries.get(key);
    if (entry?.type === type) return entry as EntryOf<T>;
    this.warnOnce(key, entry ? `is a ${entry.type}, expected ${type}` : 'is missing');
    return undefined;
  }

  /** Whether `key` exists with type `type` (no warning; for optional variants such as `model.sofa@modern`). */
  has(key: string, type: AssetType): boolean {
    return this.entries.get(key)?.type === type;
  }

  /** Icons never fail: a missing key yields a neutral placeholder so the UI stays intact. */
  icon(key: string): IconEntry {
    return this.get(key, 'icon') ?? { type: 'icon', url: FALLBACK_ICON, mode: 'mask' };
  }

  private warnOnce(key: string, problem: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[assets] '${key}' ${problem}; using fallback`);
  }
}

/** A manifest followed by the packs it lists (depth first, in order), fetched in parallel. */
async function fetchManifests(url: URL): Promise<[URL, Manifest][]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load asset manifest ${url}: ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  const packs = await Promise.all((manifest.packs ?? []).map((pack) => fetchManifests(new URL(pack, url))));
  return [[url, manifest], ...packs.flat()];
}

/** Absolute source URL -> absolute URL of its compressed copy. */
const optimized = new Map<string, string>();

/** Reads the build's index of compressed copies (there is none on the dev server). */
async function loadOptimized(base: URL): Promise<void> {
  try {
    const res = await fetch(new URL('optimized.json', base));
    // (The dev server answers a missing file with its index page.)
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return;
    const index = (await res.json()) as { files?: Record<string, string> };
    for (const [file, copy] of Object.entries(index.files ?? {})) optimized.set(new URL(file, base).href, new URL(copy, base).href);
  } catch {
    // No index: everything loads from its source file.
  }
}

/** The file to fetch for an asset URL: its compressed copy when the build made one. */
export function optimizedUrl(url: string): string {
  return optimized.get(new URL(url, location.href).href) ?? url;
}

/** Makes file references absolute relative to the manifest that declared them. */
function resolveUrls(entry: AssetEntry, base: URL): AssetEntry {
  const out: Record<string, unknown> = { ...entry };
  for (const field of URL_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = new URL(value, base).href;
  }
  return out as unknown as AssetEntry;
}

const FALLBACK_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="#000" stroke-width="2"/></svg>',
  );
