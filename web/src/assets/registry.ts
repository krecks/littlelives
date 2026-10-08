/**
 * Resolves asset keys to entries. Manifests stack: later packs override earlier keys,
 * so new art can be dropped in without changing code or the base manifest.
 */

import type { AssetEntry, AssetType, EntryOf, IconEntry, Manifest } from './types';

const URL_FIELDS = ['url', 'texture'] as const;

export class AssetRegistry {
  private readonly entries = new Map<string, AssetEntry>();
  private readonly warned = new Set<string>();

  static async load(manifestUrl: string, extraPacks: readonly string[] = []): Promise<AssetRegistry> {
    const registry = new AssetRegistry();
    const base = new URL(manifestUrl, location.href);
    await registry.addManifest(base);
    for (const pack of extraPacks) await registry.addManifest(new URL(pack, base));
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

  private async addManifest(url: URL): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to load asset manifest ${url}: ${res.status}`);
    const manifest = (await res.json()) as Manifest;
    for (const [key, entry] of Object.entries(manifest.entries)) {
      this.entries.set(key, resolveUrls(entry, url));
    }
    for (const pack of manifest.packs ?? []) await this.addManifest(new URL(pack, url));
  }

  private warnOnce(key: string, problem: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[assets] '${key}' ${problem}; using fallback`);
  }
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
