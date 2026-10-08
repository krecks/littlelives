/**
 * `SimPreviews`: the household-creator stage and Sim portraits, from one small engine (`studio.ts`)
 * that runs only while it has work: a stage attached, or portraits to draw. It is disposed a few
 * seconds after the last of either, so it never runs alongside a game for long (portraits are
 * cached for the page; in play only new looks need it, briefly).
 */

import type { AssetRegistry } from '../../assets/registry';
import { loadCharacterSet } from '../babylon/characters/data';
import type { SimLook, SimPreviews, SimStage, Wardrobe } from '../types';
import { cached, lookKey, Portraits } from './portraits';
import { StageController } from './stage';
import { Studio, type StudioDeps } from './studio';

/** Idle time (ms) before the engine is released. */
const RELEASE_AFTER = 4000;

export function createSimPreviews(deps: StudioDeps): SimPreviews {
  return new Previews(deps);
}

class Previews implements SimPreviews {
  private studio: Promise<Studio | null> | null = null;
  private live: Studio | null = null;
  private unavailable = false;
  private stageCtl: StageController | null = null;
  private readonly portraits = new Portraits();
  private looping = false;
  private releaseTimer = 0;

  constructor(private readonly deps: StudioDeps) {
    // `?debug`: inspect from the console / test harness (`__previews.live` is the engine, if any).
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __previews: this });
  }

  async stage(host: HTMLElement): Promise<SimStage | null> {
    const studio = await this.open();
    if (!studio) return null;
    if (!host.isConnected) {
      this.idleCheck();
      return null;
    }
    this.stageCtl?.detach();
    const ctl = new StageController(studio, host, () => {
      if (this.stageCtl === ctl) this.stageCtl = null;
      this.idleCheck();
    });
    this.stageCtl = ctl;
    this.loop(studio);
    return ctl;
  }

  portrait(look: SimLook): Promise<string | null> {
    const key = lookKey(look);
    const url = cached(key);
    if (url) return Promise.resolve(url);
    if (this.unavailable) return Promise.resolve(null);
    const p = this.portraits.request(key, look);
    void this.open().then((studio) => {
      if (studio) this.loop(studio);
      else this.portraits.failAll();
    });
    return p;
  }

  cachedPortrait(look: SimLook): string | null {
    return cached(lookKey(look));
  }

  prefetch(looks: readonly SimLook[]): void {
    for (const look of looks) void this.portrait(look);
  }

  async wardrobe(gender: string): Promise<Wardrobe | null> {
    const set = await loadSet(this.deps.assets);
    const body = set?.bodies.get(gender === 'female' ? 'female' : 'male') ?? set?.bodies.values().next().value;
    if (!body) return null;
    const parts = Object.keys(body.garments);
    return {
      tops: parts.filter((p) => p.startsWith('top.')),
      bottoms: parts.filter((p) => p.startsWith('bottom.')),
      shoes: parts.filter((p) => p.startsWith('shoes.')),
      beard: body.parts.has('hair.beard'),
    };
  }

  private open(): Promise<Studio | null> {
    clearTimeout(this.releaseTimer);
    if (this.unavailable) return Promise.resolve(null);
    this.studio ??= Studio.create(this.deps).then(
      (studio) => (this.live = studio),
      (err: unknown) => {
        console.warn('[preview] 3D Sim previews unavailable', err);
        this.unavailable = true;
        this.studio = null;
        return null;
      },
    );
    return this.studio;
  }

  private loop(studio: Studio): void {
    clearTimeout(this.releaseTimer);
    if (this.looping) return;
    this.looping = true;
    studio.engine.runRenderLoop(() => {
      const now = performance.now();
      const stage = this.stageCtl;
      stage?.direct(now);
      this.portraits.direct(studio, now);
      studio.pose(now);
      this.portraits.render(studio, now);
      stage?.render();
      if (!stage && !this.portraits.busy) {
        studio.engine.stopRenderLoop();
        this.looping = false;
        this.idleCheck();
      }
    });
  }

  /** Releases the engine once neither the stage nor portraits have needed it for a while. */
  private idleCheck(): void {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => {
      const studio = this.live;
      if (!studio || this.stageCtl || this.portraits.busy) return;
      this.live = null;
      this.studio = null;
      this.looping = false;
      this.portraits.dispose();
      studio.dispose();
    }, RELEASE_AFTER);
  }
}

function loadSet(assets: AssetRegistry) {
  const entry = assets.get('model.sim', 'character');
  return entry ? loadCharacterSet(entry.url).catch(() => null) : Promise.resolve(null);
}
