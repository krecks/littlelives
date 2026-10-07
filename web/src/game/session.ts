/**
 * A game session: starts the sim worker for a new or saved game and wires the (long-lived)
 * renderer, input and HUD to it. Sessions start hidden and paused — they can be prepared
 * in the background while the player is still in a menu — and go live with `reveal()`.
 */

import { AssetRegistry } from '../assets/registry';
import { Content } from '../content/content';
import { SimBridge } from '../core/bridge';
import type { GameSource, WorldStructure } from '../core/protocol';
import { AUTOSAVE_ID, readSave, writeSave, type SaveRecord } from '../persistence/saves';
import type { Renderer } from '../render/types';
import type { Settings } from '../settings/settings.svelte';
import { services, type GameControls } from '../ui/services';
import { game, toast } from '../ui/state.svelte';
import { BubbleLayer } from './bubbles';
import type { HouseholdDraft } from './household';
import { PointerInput } from './input';
import { assembleTown, loadTemplates, type NeighbourhoodDraft } from './town';

/** Click radius (CSS px) around a Sim's projected centre. */
const SIM_PICK_RADIUS = 32;
const STATS_INTERVAL_MS = 500;
const THUMBNAIL = { width: 320, height: 200 };

export type StartRequest =
  | { kind: 'new'; town: NeighbourhoodDraft; household: HouseholdDraft; slot: number }
  | { kind: 'load'; saveId: string };

/** How long a story-feed entry stays visible. */
const FEED_MS = 12_000;
/** Frames drawn before a prepared session counts as ready (shaders compiled, textures up). */
const WARM_FRAMES = 3;

export interface GameSession {
  /** Saves into `slotId` (a new slot when omitted). Returns the slot id. */
  save(name: string, slotId?: string): Promise<string>;
  applySettings(settings: Settings): void;
  /** Pauses for menus; `false` restores the previous speed. */
  setMenuPause(paused: boolean): void;
  readonly household: string;
  /** Resolves when the world is built and drawn: revealing is then instant. */
  readonly ready: Promise<void>;
  /** Unpauses the game and attaches input. */
  reveal(): void;
  /** Ends the session; the renderer is kept for the next one. */
  dispose(): void;
}

/** Shared, immutable data: loaded once per page. */
let shared: Promise<{ content: Content; assets: AssetRegistry }> | null = null;
export function loadGameData(): Promise<{ content: Content; assets: AssetRegistry }> {
  const params = new URLSearchParams(location.search);
  const base = import.meta.env.BASE_URL;
  shared ??= Promise.all([
    Content.load(`${base}content/base.json`),
    AssetRegistry.load(`${base}assets/manifest.json`, params.getAll('pack')),
  ]).then(([content, assets]) => {
    services.content = content;
    services.assets = assets;
    return { content, assets };
  });
  return shared;
}

export async function startSession(
  renderer: Renderer,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  request: StartRequest,
  settings: Settings,
): Promise<GameSession> {
  const params = new URLSearchParams(location.search);
  const { content, assets } = await loadGameData();

  let source: GameSource;
  let household: string;
  if (request.kind === 'new') {
    const templates = await loadTemplates();
    const lot = assembleTown(content, templates, request.town, request.household, request.slot);
    source = { lot, seed: Number(params.get('seed')) || (Math.random() * 2 ** 31) >>> 0 };
    household = request.household.name.trim();
  } else {
    const record = await readSave(request.saveId);
    if (!record) throw new Error('That save no longer exists.');
    source = { save: record.data };
    household = record.household;
  }

  const bridge = await SimBridge.start(content.json, source);
  // Hold the clock until the player actually enters the game.
  bridge.send({ type: 'setSpeed', speed: 0 });
  let resumeSpeed: number | null = null;
  let revealed = false;
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => (markReady = resolve));

  let world: WorldStructure | null = null;
  let lastSpeed = 1;
  let focused = false;
  let viewPlot: number | null = null;
  let lastEvent = -1;
  const bubbles = new BubbleLayer(overlay, renderer, content, assets);
  /** Sims the player controls. */
  const playerSims = () => game.roster.filter((s) => game.households[s.household]?.player).map((s) => s.id);
  let speedBeforeMenu: number | null = null;
  let autosaveTimer: ReturnType<typeof setInterval> | undefined;
  let autosaveMinutes = -1;

  const controls: GameControls = {
    setSpeed(speed) {
      if (speed > 0) lastSpeed = speed;
      bridge.send({ type: 'setSpeed', speed });
    },
    togglePause() {
      controls.setSpeed(game.speed === 0 ? lastSpeed : 0);
    },
    selectSim(id) {
      if (!playerSims().includes(id)) return;
      game.selected = id;
      game.socialMenu = null;
      renderer.setSelectedSim(id);
    },
    joinCareer(career) {
      bridge.send({ type: 'joinCareer', sim: game.selected, career });
    },
    quitCareer() {
      bridge.send({ type: 'quitCareer', sim: game.selected });
    },
    visit(plot) {
      bridge.send({ type: 'visit', sim: game.selected, plot });
      game.townOpen = false;
    },
    goHome() {
      bridge.send({ type: 'goHome', sim: game.selected });
      game.townOpen = false;
    },
    socialize(target, social) {
      bridge.send({ type: 'social', sim: game.selected, target, social });
      game.socialMenu = null;
    },
    useObject(objectId, interaction) {
      bridge.send({ type: 'use', sim: game.selected, object: objectId, interaction });
      game.menu = null;
    },
    cancelAction(index) {
      bridge.send({ type: 'cancel', sim: game.selected, index });
    },
    setWallMode(mode) {
      game.wallMode = mode;
      renderer.setWallMode(mode);
    },
    closeMenu() {
      game.menu = null;
      game.socialMenu = null;
    },
    openPauseMenu() {
      game.menu = null;
      game.pauseMenu = true;
    },
  };
  services.controls = controls;
  game.sharedMemory = bridge.sharedMemory;
  game.household = household;

  bridge.onError((message) => toast(message));
  bridge.onUi((ui) => {
    // The first snapshot carries the speed the game was saved at.
    resumeSpeed ??= ui.speed > 0 ? ui.speed : 1;
    game.day = ui.day;
    game.minute = ui.minute;
    game.speed = ui.speed;
    game.sims = ui.sims;
    game.weekday = ui.weekday;
    game.funds = ui.households.find((h) => game.households[h.id]?.player)?.funds ?? 0;
    game.relationships = ui.relationships;
    // The view follows the selected Sim to whichever lot they're on.
    const selected = ui.sims.find((s) => s.id === game.selected);
    if (selected?.plot != null && selected.plot !== viewPlot) showPlot(selected.plot);
    // New social events go to the story feed (only the first batch is skipped as history).
    const fresh = ui.events.filter((e) => e.id > lastEvent);
    if (lastEvent >= 0 && fresh.length) {
      const now = Date.now();
      game.feed = [...game.feed.filter((f) => now - f.at < FEED_MS), ...fresh.map((event) => ({ event, at: now }))].slice(-6);
    }
    if (ui.events.length) lastEvent = ui.events[ui.events.length - 1].id;
  });
  bridge.onWorld((w) => {
    world = w;
    game.roster = w.sims;
    game.households = w.households;
    game.plots = w.plots;
    if (!focused) {
      focused = true;
      const first = playerSims()[0];
      if (first !== undefined) controls.selectSim(first);
      // Start on the home lot; its geometry arrives in the next world message.
      const home = w.households.find((h) => h.player)?.plot;
      if (home != null && w.plots[home]) return showPlot(home);
    }
    const plot = viewPlot === null ? null : w.plots[viewPlot];
    renderer
      .setWorld(w, plot ? { x: plot.x, z: plot.z, w: plot.w, d: plot.d } : null)
      .then(() => renderer.framesRendered(WARM_FRAMES))
      .then(markReady)
      .catch((err) => toast(`Rendering failed: ${err}`));
  });

  /** Switches the view to a lot: the worker sends that lot's geometry, then the scene is rebuilt. */
  function showPlot(plot: number) {
    const p = world?.plots[plot];
    if (!p) return;
    viewPlot = plot;
    game.viewPlot = plot;
    renderer.focus(p.x + p.w / 2, p.z + p.d / 2);
    bridge.setView([p.x, p.z, p.x + p.w, p.z + p.d]);
  }
  controls.setWallMode(game.wallMode);

  const inLot = (x: number, z: number) => !!world && x >= 0 && z >= 0 && x < world.width && z < world.depth;

  const screen = { x: 0, y: 0 };
  /** Nearest Sim whose projected body centre is within the pick radius. */
  const simAt = (px: number, py: number): number | null => {
    const snap = bridge.latest();
    const { layout } = bridge;
    let best: number | null = null;
    let bestDist = SIM_PICK_RADIUS;
    for (let i = 0; i < snap[layout.header.simCount]; i++) {
      const o = layout.headerLen + i * layout.simStride;
      const dist = renderer.project(snap[o + layout.sim.x], 0.9, snap[o + layout.sim.z], screen)
        ? Math.hypot(screen.x - px, screen.y - py)
        : Infinity;
      if (dist < bestDist) {
        bestDist = dist;
        best = snap[o + layout.sim.id];
      }
    }
    return best;
  };

  const openMenu = (objectId: number, x: number, y: number) => {
    const placement = world?.objects.find((o) => o.id === objectId);
    const def = placement && content.object(placement.def);
    if (!def || def.interactions.length === 0) return;
    game.menu = { objectId, title: def.name, x, y, items: def.interactions.map((it, index) => ({ label: it.label, index })) };
  };

  let pointer: PointerInput | null = null;
  const attachPointer = () => new PointerInput(canvas, {
    click(x, y) {
      if (game.pauseMenu) return;
      game.menu = null;
      game.socialMenu = null;
      const sim = simAt(x, y);
      if (sim !== null && sim !== game.selected) {
        game.socialMenu = { target: sim, x, y, options: null };
        bridge.requestSocialOptions(game.selected, sim).then((options) => {
          if (game.socialMenu?.target === sim) game.socialMenu = { ...game.socialMenu, options };
        });
        return;
      }
      if (sim !== null) return;
      const hit = renderer.pick(x, y);
      if (hit.objectId !== null) return openMenu(hit.objectId, x, y);
      if (hit.ground && inLot(hit.ground.x, hit.ground.z)) {
        bridge.send({ type: 'moveTo', sim: game.selected, x: hit.ground.x, z: hit.ground.z });
      }
    },
    hover(x, y) {
      const g = renderer.pick(x, y).ground;
      renderer.setHoverTile(g && inLot(g.x, g.z) && !game.pauseMenu ? { x: Math.floor(g.x), z: Math.floor(g.z) } : null);
    },
    leave() {
      renderer.setHoverTile(null);
    },
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape') {
      if (game.townOpen) return void (game.townOpen = false);
      if (game.menu || game.socialMenu) return controls.closeMenu();
      game.pauseMenu = !game.pauseMenu;
      return;
    }
    if (game.pauseMenu) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        return controls.togglePause();
      case '0':
      case '1':
      case '2':
      case '3':
        return controls.setSpeed(Number(e.key));
      case 'm':
      case 'M':
        game.townOpen = !game.townOpen;
        return;
      case 'w':
      case 'W':
        return controls.setWallMode(game.wallMode === 'up' ? 'down' : 'up');
      case 'F3':
        e.preventDefault();
        game.perfOpen = !game.perfOpen;
        return;
      case 'Tab': {
        e.preventDefault();
        const ids = playerSims();
        if (ids.length) controls.selectSim(ids[(ids.indexOf(game.selected) + 1) % ids.length]);
        return;
      }
    }
  };

  const statsTimer = setInterval(() => {
    if (game.perfOpen) game.stats = renderer.stats();
  }, STATS_INTERVAL_MS);

  renderer.run((now) => {
    bridge.sync(now);
    const frame = bridge.frame(now);
    renderer.update(frame);
    if (revealed) bubbles.update(frame);
  });

  const session: GameSession = {
    household,
    ready,
    reveal() {
      if (revealed) return;
      revealed = true;
      renderer.setIdleOrbit(false);
      pointer = attachPointer();
      window.addEventListener('keydown', onKey);
      bridge.send({ type: 'setSpeed', speed: resumeSpeed ?? 1 });
    },
    async save(name, slotId) {
      const [data, thumbnail] = await Promise.all([bridge.requestSave(), renderer.captureThumbnail(THUMBNAIL.width, THUMBNAIL.height)]);
      const id = slotId ?? crypto.randomUUID();
      const record: SaveRecord = {
        id,
        name,
        household,
        members: game.sims.map((s) => s.name),
        day: game.day,
        minute: game.minute,
        savedAt: Date.now(),
        thumbnail,
        autosave: id === AUTOSAVE_ID,
        data,
      };
      await writeSave(record);
      return id;
    },
    applySettings(s) {
      renderer.configure({ bloom: s.bloom, tiltShift: s.tiltShift, resolutionScale: s.resolutionScale, cameraSensitivity: s.cameraSensitivity });
      bridge.send({ type: 'setAutonomy', enabled: s.autonomy });
      game.perfOpen = s.showFps;
      if (s.autosaveMinutes !== autosaveMinutes) {
        autosaveMinutes = s.autosaveMinutes;
        clearInterval(autosaveTimer);
        if (autosaveMinutes > 0) {
          autosaveTimer = setInterval(() => {
            if (game.pauseMenu) return;
            session.save(`${household} · Autosave`, AUTOSAVE_ID).catch((err) => console.warn('[save] autosave failed', err));
          }, autosaveMinutes * 60_000);
        }
      }
    },
    setMenuPause(paused) {
      if (paused && speedBeforeMenu === null) {
        speedBeforeMenu = game.speed;
        bridge.send({ type: 'setSpeed', speed: 0 });
      } else if (!paused && speedBeforeMenu !== null) {
        bridge.send({ type: 'setSpeed', speed: speedBeforeMenu });
        speedBeforeMenu = null;
      }
    },
    dispose() {
      clearInterval(statsTimer);
      clearInterval(autosaveTimer);
      window.removeEventListener('keydown', onKey);
      pointer?.dispose();
      bubbles.dispose();
      renderer.clear();
      bridge.dispose();
    },
  };
  session.applySettings(settings);
  if (import.meta.env.DEV) {
    // Test hook for automated browser checks; not present in production builds.
    (window as unknown as Record<string, unknown>).__osw = {
      simScreen(id: number) {
        const head = { x: 0, y: 0, z: 0 };
        const out = { x: 0, y: 0 };
        return renderer.simHead(id, head) && renderer.project(head.x, 0.9, head.z, out) ? out : null;
      },
      focusSim(id: number) {
        const head = { x: 0, y: 0, z: 0 };
        if (renderer.simHead(id, head)) renderer.focus(head.x, head.z);
      },
      stats: () => renderer.stats(),
      view: () => viewPlot,
      townFile: () => ('lot' in source ? source.lot : null),
      sims: () =>
        game.sims.map((x) => {
          const snap = bridge.latest();
          const o = bridge.layout.headerLen + x.id * bridge.layout.simStride;
          const pos = [snap[o + bridge.layout.sim.x].toFixed(1), snap[o + bridge.layout.sim.z].toFixed(1)];
          return { id: x.id, name: x.name, plot: x.plot, pos, away: x.awayUntil, visiting: x.visiting, job: x.job?.title, doing: x.actions[0]?.label };
        }),
    };
  }
  return session;
}
