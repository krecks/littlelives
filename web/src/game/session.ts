/**
 * A game session: starts the sim worker for a new or saved game and wires the (long-lived)
 * renderer, input and HUD to it. Sessions start hidden and paused — they can be prepared
 * in the background while the player is still in a menu — and go live with `reveal()`.
 */

import { AssetRegistry } from '../assets/registry';
import { Content } from '../content/content';
import { SimBridge } from '../core/bridge';
import type { GameSource, SocialEvent, WorldStructure } from '../core/protocol';
import { AUTOSAVE_ID, readSave, writeSave, type SaveRecord } from '../persistence/saves';
import { recentLog } from '../debug/log';
import { deliverReport, gpuInfo, takePendingPose, type DebugReport } from '../debug/report';
import { plainState } from '../debug/snapshot.svelte';
import { createSimPreviews } from '../render/preview';
import { createItemPreviews } from '../render/preview/items';
import type { Renderer, WallMode } from '../render/types';
import { settings as liveSettings, type Settings } from '../settings/settings.svelte';
import { services, type GameControls } from '../ui/services';
import { game, nextWallMode, toast } from '../ui/state.svelte';
import { saveDebugReport } from '../ui/debugReport';
import { aboutUs } from '../ui/story';
import { BubbleLayer } from './bubbles';
import { Director } from './director';
import { BuildBuyInput, editFeedback } from './buildmode';
import { styledModel } from '../ui/buy/catalog';
import { play } from '../ui/sfx';
import type { HouseholdDraft } from './household';
import { PointerInput } from './input';
import { assembleTown, loadTemplates, type NeighbourhoodDraft } from './town';

/** Click radius (CSS px) around a Sim's projected centre. */
const SIM_PICK_RADIUS = 32;
const STATS_INTERVAL_MS = 500;
const THUMBNAIL = { width: 320, height: 200 };

export type StartRequest =
  | {
      kind: 'new';
      town: NeighbourhoodDraft;
      household: HouseholdDraft;
      slot: number;
      /** `household` already lives in `town` at `slot`: the player takes it over instead of moving a new one in. */
      existing?: boolean;
    }
  | { kind: 'load'; saveId: string };

/** How long a story-feed entry stays visible. */
const FEED_MS = 12_000;
/** Story-feed entries shown at once. */
const FEED_SIZE = 3;
/** Fastest game speed (`clock::MAX_SPEED`). */
const MAX_SPEED = 5;
/** How long the interface stays after the mouse moves while it watches quietly. */
const HUD_AWAKE_MS = 3000;
/** How long a big moment plays at normal speed before the game speeds up again. */
const SLOW_MS = 25_000;
/** Frames drawn before a prepared session counts as ready (shaders compiled, textures up). */
const WARM_FRAMES = 3;
/** Longest wait for the household's portraits before a prepared session counts as ready anyway. */
const PORTRAIT_WAIT_MS = 8000;
/** After this long in the game, the catalog's pictures are drawn in idle moments (Buy mode then opens with them). */
const PREFETCH_PICTURES_MS = 4000;

export interface GameSession {
  /** Saves into `slotId` (a new slot when omitted). Returns the slot id. */
  save(name: string, slotId?: string): Promise<string>;
  applySettings(settings: Settings): void;
  /** Pauses for menus; `false` restores the previous speed. */
  setMenuPause(paused: boolean): void;
  readonly household: string;
  /** Resolves when the world is built and drawn and the HUD's portraits exist: revealing is then instant. */
  readonly ready: Promise<void>;
  /** Unpauses the game and attaches input. */
  reveal(): void;
  /** Ends the session; resolves once it has let go of the renderer, which is kept for the next one. */
  dispose(): Promise<void>;
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
    services.previews = createSimPreviews({ assets, emotions: content.emotions.map((e) => e.id), backend: () => liveSettings.renderer });
    services.items = createItemPreviews(assets);
    return { content, assets };
  });
  return shared;
}

/** Reports a loading step and the overall progress (0..1) while a session is prepared. */
export type ProgressReport = (label: string, value: number) => void;

export async function startSession(
  renderer: Renderer,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  request: StartRequest,
  settings: Settings,
  progress: ProgressReport = () => {},
): Promise<GameSession> {
  const params = new URLSearchParams(location.search);
  progress(request.kind === 'load' ? 'Reading your save' : 'Laying out the neighbourhood', 0.05);
  const { content, assets } = await loadGameData();

  let source: GameSource;
  let household: string;
  if (request.kind === 'new') {
    const templates = await loadTemplates();
    const lot = assembleTown(content, templates, request.town, request.household, request.slot, request.existing);
    source = { lot, seed: Number(params.get('seed')) || (Math.random() * 2 ** 31) >>> 0 };
    household = request.household.name.trim();
  } else {
    const record = await readSave(request.saveId);
    if (!record) throw new Error('That save no longer exists.');
    source = { save: record.data };
    household = record.household;
  }

  progress('Starting the simulation', 0.15);
  const bridge = await SimBridge.start(content.json, source);
  progress('Building the world', 0.3);
  // Hold the clock until the player actually enters the game.
  bridge.send({ type: 'setSpeed', speed: 0 });
  let resumeSpeed: number | null = null;
  let revealed = false;
  let disposed = false;
  /** The scene build in progress; disposing waits for it so it can't add to the next session's scene. */
  let building: Promise<unknown> = Promise.resolve();
  let markReady: () => void = () => {};
  /** The player household's portraits (requested with the first world). */
  let portraits: Promise<unknown> | null = null;
  const ready = new Promise<void>((resolve) => (markReady = resolve));

  let world: WorldStructure | null = null;
  /** The lot the last world structure showed (edit feedback compares worlds of the same lot). */
  let worldView: number | null = null;
  let lastSpeed = 1;
  let focused = false;
  let viewPlot: number | null = null;
  let lastEvent = -1;
  const bubbles = new BubbleLayer(overlay, renderer, content, assets);
  const buildBuy = new BuildBuyInput(renderer, content, assets, (command) => bridge.send(command));
  game.catalog = bridge.catalog;
  /** Sims the player controls. */
  const playerSims = () => game.roster.filter((s) => game.households[s.household]?.player).map((s) => s.id);
  const homePlot = (): number | null => game.households.find((h) => h.player)?.plot ?? null;

  // --- Watching: after a while without input the director takes the camera ----------------
  const director = new Director({
    content,
    layout: bridge.layout,
    snapshot: () => bridge.latest(),
    pace: () => liveSettings.directorPace,
    reducedMotion: () => liveSettings.reducedMotion,
    shoot(shot, walls) {
      renderer.setGameShot(shot);
      if (game.wallMode !== walls) controls.setWallMode(walls);
    },
  });
  /** Last time the player touched anything (ms, performance clock). */
  let lastInput = performance.now();
  /** The wall mode to give back when the director lets go. */
  let playerWalls: WallMode | null = null;
  /** Speed before a big moment slowed the game down, and until when (restored unless the player picks a speed). */
  let slowedFrom: number | null = null;
  let slowUntil = 0;
  const canWatch = () =>
    revealed &&
    liveSettings.directorDelay > 0 &&
    game.mode === 'live' &&
    game.follow === null &&
    !game.pauseMenu &&
    !game.menu &&
    !game.socialMenu &&
    !game.townOpen &&
    !game.jobBoardOpen &&
    !game.plannerOpen &&
    viewPlot !== null &&
    viewPlot === homePlot();
  function startWatching(now: number) {
    if (!world) return;
    playerWalls = game.wallMode;
    director.setWorld(world, homePlot());
    director.start(now);
    game.watching = true;
  }
  function stopWatching() {
    director.stop();
    renderer.setGameShot(null);
    game.watching = false;
    if (playerWalls !== null && game.wallMode !== playerWalls) controls.setWallMode(playerWalls);
    playerWalls = null;
  }
  /** Any input: the camera is the player's again at once. */
  function takeBack() {
    lastInput = performance.now();
    if (game.watching) stopWatching();
  }
  const onInput = () => takeBack();
  let hudTimer: ReturnType<typeof setTimeout> | undefined;
  const onMove = () => {
    // Moving the mouse doesn't take the camera, but it does count as being here (and wakes a
    // quiet interface for a moment).
    if (!game.watching) lastInput = performance.now();
    game.hudAwake = true;
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => (game.hudAwake = false), HUD_AWAKE_MS);
  };
  let speedBeforeMenu: number | null = null;
  /** Buy mode pauses the game; the speed to restore when leaving it. */
  let speedBeforeBuy: number | null = null;
  let autosaveTimer: ReturnType<typeof setInterval> | undefined;
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  let autosaveMinutes = -1;

  const controls: GameControls = {
    setSpeed(speed) {
      // Time stands still in Buy mode.
      if (game.mode !== 'live') return;
      speed = Math.max(0, Math.min(MAX_SPEED, speed));
      if (speed > 0) lastSpeed = speed;
      slowedFrom = null;
      bridge.send({ type: 'setSpeed', speed });
    },
    togglePause() {
      controls.setSpeed(game.speed === 0 ? lastSpeed : 0);
    },
    selectSim(id) {
      if (!playerSims().includes(id)) return;
      game.selected = id;
      game.socialMenu = null;
      if (liveSettings.directControl === 'always') controls.inspect(id);
    },
    inspect(id) {
      game.inspected = id;
      game.socialMenu = null;
      if (id !== null && playerSims().includes(id)) game.selected = id;
      renderer.setSelectedSim(id);
      if (id === null && game.follow !== null) controls.follow(null);
    },
    follow(id) {
      game.follow = id;
      renderer.followSim(id);
      if (id !== null) {
        takeBack();
        const plot = game.sims.find((s) => s.id === id)?.plot;
        if (plot != null && plot !== viewPlot) showPlot(plot);
      } else {
        const home = buildBuy.home();
        if (home && viewPlot !== home.id) showPlot(home.id);
      }
    },
    watch() {
      lastInput = -Infinity;
      if (canWatch()) startWatching(performance.now());
    },
    frameHouse() {
      takeBack();
      if (game.follow !== null) controls.follow(null);
      const plot = world && homePlot() !== null ? world.plots[homePlot()!] : null;
      if (!plot) return;
      const [x0, z0, x1, z1] = plot.house ?? [plot.x, plot.z, plot.x + plot.w, plot.z + plot.d];
      renderer.setGameShot({ target: { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, beta: 0.72, radius: Math.min(60, Math.max(x1 - x0, z1 - z0) * 1.25 + 8), duration: liveSettings.reducedMotion ? 0 : 1.6 });
      // The shot lands, then the camera is the player's again.
      setTimeout(() => {
        if (!director.active) renderer.setGameShot(null);
      }, liveSettings.reducedMotion ? 0 : 1700);
    },
    toggleJournal() {
      game.journalOpen = !game.journalOpen;
      if (game.journalOpen) void bridge.requestEvents().then((events) => (game.journal = events));
    },
    openPlanner(who) {
      takeBack();
      const mine = playerSims();
      game.plannerFor = who ?? (game.inspected !== null && mine.includes(game.inspected) ? game.inspected : (mine[0] ?? 'household'));
      game.plannerOpen = true;
      game.menu = null;
      game.socialMenu = null;
    },
    setRoutines(sim, routines) {
      const anyone = playerSims()[0];
      if (sim === null) {
        if (anyone !== undefined) bridge.send({ type: 'setHouseholdRoutines', sim: anyone, routines });
      } else bridge.send({ type: 'setRoutines', sim, routines });
    },
    skipHouseholdRoutine(sim, routine, skip) {
      bridge.send({ type: 'skipHouseholdRoutine', sim, routine, skip });
    },
    addGoal(sim, goal) {
      bridge.send({ type: 'addGoal', sim, goal });
    },
    removeGoal(sim, index) {
      bridge.send({ type: 'removeGoal', sim, index });
    },
    acceptSuggestion(sim, index) {
      bridge.send({ type: 'acceptSuggestion', sim, index });
    },
    dismissSuggestion(sim, index) {
      bridge.send({ type: 'dismissSuggestion', sim, index });
    },
    openCatalog(filter) {
      game.plannerOpen = false;
      controls.setMode('buy');
      game.buySelection = null;
      game.placing = null;
      game.buyFilter = filter;
    },
    showEvent(event) {
      if (game.mode !== 'live') return;
      const now = performance.now();
      if (!director.active) {
        playerWalls = game.wallMode;
        game.watching = true;
      }
      if (!director.show(event, now)) {
        if (!director.active) stopWatching();
        toast("They aren't at home right now.");
      }
    },
    joinCareer(career, level) {
      bridge.send({ type: 'joinCareer', sim: game.selected, career, level });
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
      if (game.mode !== 'live') return;
      bridge.send({ type: 'social', sim: game.selected, target, social });
      game.socialMenu = null;
    },
    useObject(objectId, interaction) {
      if (game.mode !== 'live') return;
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
    setMode(mode) {
      if (game.mode === mode) return;
      takeBack();
      if (mode !== 'live' && game.follow !== null) controls.follow(null);
      const fromLive = game.mode === 'live';
      buildBuy.cancel();
      game.mode = mode;
      play(mode === 'live' ? 'close' : fromLive ? 'open' : 'tab');
      game.menu = null;
      game.socialMenu = null;
      // Buy and Build mode pause the game (and close Live-only panels); back in Live the speed returns.
      if (mode !== 'live') {
        if (fromLive) {
          speedBeforeBuy = game.speed;
          bridge.send({ type: 'setSpeed', speed: 0 });
        }
        game.townOpen = false;
        game.jobBoardOpen = false;
      } else if (speedBeforeBuy !== null) {
        if (speedBeforeBuy > 0) lastSpeed = speedBeforeBuy;
        bridge.send({ type: 'setSpeed', speed: speedBeforeBuy });
        speedBeforeBuy = null;
      }
      // Building happens at home, with the walls down so the floor plan is visible.
      const home = buildBuy.home();
      if (mode !== 'live' && home) {
        if (viewPlot !== home.id) showPlot(home.id);
        controls.setWallMode('down');
      }
      buildBuy.modeChanged();
    },
    startPlacing(def) {
      controls.setMode('buy');
      game.buySelection = null;
      game.placing = { def, rot: game.placing?.rot ?? 0, objectId: null };
    },
    startMoving(objectId) {
      const obj = game.objects.find((o) => o.id === objectId);
      if (!obj) return;
      controls.setMode('buy');
      game.buySelection = null;
      game.placing = { def: obj.def, rot: obj.rot, objectId };
    },
    rotatePlacing() {
      if (game.mode !== 'buy') return;
      if (game.placing) {
        game.placing = { ...game.placing, rot: (game.placing.rot + 1) % 4 };
        play('rotate');
      } else if (game.buySelection !== null) {
        const obj = game.objects.find((o) => o.id === game.buySelection);
        if (obj) bridge.send({ type: 'moveObject', sim: game.selected, object: obj.id, x: obj.x, z: obj.z, rot: (obj.rot + 1) % 4 });
      }
    },
    cancelPlacing() {
      buildBuy.cancel();
    },
    sell(objectId) {
      if (game.mode !== 'buy') return;
      bridge.send({ type: 'sell', sim: game.selected, object: objectId });
      game.buySelection = null;
      game.menu = null;
    },
    undo() {
      // The step count follows a little later; don't send more undos than there are steps.
      if (game.mode === 'live' || game.undoSteps <= 0) return;
      game.undoSteps--;
      game.buildStart = null;
      game.buySelection = null;
      buildBuy.clearPreviews();
      bridge.send({ type: 'undo', sim: game.selected });
    },
    restyle(objectId, style) {
      bridge.send({ type: 'restyle', sim: game.selected, object: objectId, style });
    },
    setHouseholdStyle(style) {
      bridge.send({ type: 'setStyle', sim: game.selected, style });
      game.householdStyle = style;
    },
    /** Buy mode: buy the next quality level (instant). */
    upgrade(objectId) {
      if (game.mode !== 'buy') return;
      bridge.send({ type: 'upgrade', sim: game.selected, object: objectId });
      game.menu = null;
    },
    setBuildTool(tool) {
      controls.setMode('build');
      game.buildTool = tool;
      // Painting needs the walls standing to see them.
      if (tool === 'paint' && game.wallMode === 'down') controls.setWallMode('cutaway');
      game.buildStart = null;
      buildBuy.clearPreviews();
    },
    build(edits) {
      bridge.send({ type: 'build', sim: game.selected, edits });
    },
    paint(faces) {
      bridge.send({ type: 'paint', sim: game.selected, faces });
    },
    async debugReport(note) {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const [save, screenshot, gpu] = await Promise.all([
        bridge.requestSave(),
        renderer.captureThumbnail(Math.round(canvas.clientWidth * scale), Math.round(canvas.clientHeight * scale)),
        gpuInfo(),
      ]);
      // Everything the HUD shows, minus the (large, static) catalog.
      const ui = plainState(game, ['catalog']);
      const report: DebugReport = {
        note,
        version: __APP_VERSION__,
        createdAt: new Date().toISOString(),
        url: location.href,
        userAgent: navigator.userAgent,
        screen: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 },
        gpu,
        renderer: renderer.stats(),
        settings: plainState(liveSettings),
        camera: renderer.cameraPose(),
        ui: { ...ui, viewPlot },
        log: recentLog(),
        saveMeta: { id: 'debug', name: 'Debug report', household, members: game.sims.map((x) => x.name), day: game.day, minute: game.minute, savedAt: Date.now(), autosave: false },
      };
      return deliverReport({ report, save, screenshot });
    },
  };
  services.controls = controls;
  // `?debug`: drive the game from the console / test harness.
  if (params.has('debug')) Object.assign(window, { __controls: controls });
  game.sharedMemory = bridge.sharedMemory;
  game.household = household;

  bridge.onError((message) => {
    if (disposed) return;
    toast(message);
    if (game.mode !== 'live') play('error');
  });
  bridge.onUi((ui) => {
    if (disposed) return;
    // The first snapshot carries the speed the game was saved at.
    resumeSpeed ??= ui.speed > 0 ? ui.speed : 1;
    game.day = ui.day;
    game.minute = ui.minute;
    game.speed = ui.speed;
    game.sims = ui.sims;
    game.weekday = ui.weekday;
    const mine = ui.households.find((h) => game.households[h.id]?.player);
    game.funds = mine?.funds ?? 0;
    game.rent = mine?.rent ?? null;
    game.bills = mine?.bills ?? null;
    game.householdStyle = mine?.style ?? 0;
    game.undoSteps = mine?.undo ?? 0;
    if (mine?.routines && JSON.stringify(mine.routines) !== JSON.stringify(game.householdRoutines)) game.householdRoutines = mine.routines;
    game.relationships = ui.relationships;
    // The view stays home; it goes along to other lots only with a resident the player follows.
    const followed = game.follow === null ? null : ui.sims.find((s) => s.id === game.follow);
    if (game.follow !== null && !followed) controls.follow(null);
    else if (followed?.plot != null && followed.plot !== viewPlot) showPlot(followed.plot);
    // New story events: the journal, the director, and the feed (only the first batch is history).
    const fresh = ui.events.filter((e) => e.id > lastEvent);
    if (lastEvent >= 0 && fresh.length) onStory(fresh);
    if (ui.events.length) lastEvent = ui.events[ui.events.length - 1].id;
  });
  bridge.onWorld((w) => {
    if (disposed) return;
    // Buy mode: show what the simulation just accepted (furniture popping in, dust, money).
    const feedback = game.mode !== 'live' && world && worldView === viewPlot ? editFeedback(world, w) : null;
    if (feedback?.sound) play(feedback.sound);
    // Things the player just placed: the director looks out for their first use.
    if (game.mode !== 'live' && world) {
      const before = world.objects;
      const added = w.objects.filter((o) => !before.some((b) => b.id === o.id && b.def === o.def));
      if (added.length) director.noteBuilt(added.map((o) => o.id), performance.now());
    }
    world = w;
    worldView = viewPlot;
    buildBuy.setStructure(w);
    director.setWorld(w, w.households.find((h) => h.player)?.plot ?? null);
    game.objects = w.objects;
    if (game.buySelection !== null && !w.objects.some((o) => o.id === game.buySelection)) game.buySelection = null;
    game.roster = w.sims;
    game.households = w.households;
    game.plots = w.plots;
    // Portraits for the HUD, the household first (drawn once, cached by look); the game is
    // ready once the household's are.
    const mineFirst = [...w.sims].sort((a, b) => Number(!!w.households[b.household]?.player) - Number(!!w.households[a.household]?.player));
    const looks = mineFirst.map((s) => ({ gender: s.gender, appearance: s.appearance, id: s.id }));
    portraits ??= Promise.all(looks.filter((_, i) => w.households[mineFirst[i].household]?.player).map((look) => services.previews.portrait(look)));
    services.previews.prefetch(looks);
    if (!focused) {
      focused = true;
      const first = playerSims()[0];
      if (first !== undefined) {
        game.selected = first;
        if (liveSettings.directControl === 'always') controls.inspect(first);
      }
      // Start on the home lot; its geometry arrives in the next world message.
      const home = w.households.find((h) => h.player)?.plot;
      if (home != null && w.plots[home]) return showPlot(home);
    }
    const plot = viewPlot === null ? null : w.plots[viewPlot];
    const build = renderer.setWorld(w, plot ? { x: plot.x, z: plot.z, w: plot.w, d: plot.d } : null);
    building = build.catch(() => {});
    if (feedback?.effects.length) void build.then(() => feedback.effects.forEach((fx) => renderer.buildEffect(fx)), () => {});
    build
      .then(() => {
        progress('Warming up', 0.75);
        return renderer.framesRendered(WARM_FRAMES);
      })
      .then(() => {
        progress('Drawing portraits', 0.9);
        return Promise.race([portraits, new Promise((resolve) => setTimeout(resolve, PORTRAIT_WAIT_MS))]);
      })
      .then(() => {
        progress('Ready', 1);
        markReady();
      })
      .catch((err) => toast(`Rendering failed: ${err}`));
  });

  function onStory(fresh: SocialEvent[]) {
    const now = Date.now();
    if (game.journal.length) game.journal = [...game.journal, ...fresh];
    director.noteEvents(fresh.filter(aboutUs), performance.now());
    // The feed: what happens to the household, and the town's bigger news.
    const news = fresh.filter((e) => (aboutUs(e) && e.importance >= 1) || e.importance >= 2 || (aboutUs(e) && e.kind === 'skillUp'));
    if (news.length) game.feed = [...game.feed.filter((f) => now - f.at < FEED_MS), ...news.map((event) => ({ event, at: now }))].slice(-FEED_SIZE);
    // Big moments at home are worth seeing at normal speed.
    const big = fresh.find((e) => e.importance >= 2 && aboutUs(e));
    if (big && liveSettings.autoSlow && game.mode === 'live' && game.speed >= 3) {
      const from = game.speed;
      controls.setSpeed(1);
      slowedFrom = from;
      slowUntil = performance.now() + SLOW_MS;
      toast('Slowed down for a moment');
    }
  }

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
    if (!placement || !def) return;
    // Paid interactions show their price; the pie menu greys them out when funds run short.
    const items: { label: string; index: number; disabled?: boolean; cost?: number }[] = def.interactions.map((it, index) =>
      it.cost ? { label: it.label, index, cost: it.cost } : { label: it.label, index },
    );
    // Upgrades are bought in Buy mode, not from here.
    if (items.length === 0) return;
    game.menu = { objectId, title: placement.quality ? `${def.name} ${'★'.repeat(placement.quality)}` : def.name, x, y, items };
  };

  let pointer: PointerInput | null = null;
  const attachPointer = () => new PointerInput(canvas, {
    click(x, y) {
      if (game.pauseMenu) return;
      game.menu = null;
      game.socialMenu = null;
      if (game.mode !== 'live') {
        const hit = renderer.pick(x, y);
        buildBuy.click(hit.ground, hit.objectId);
        return;
      }
      // Watching first: a click looks at someone; orders come from their panel (or, with the
      // classic setting, straight away).
      const direct = liveSettings.directControl === 'always';
      const actor = direct ? game.selected : game.inspected !== null && playerSims().includes(game.inspected) ? game.inspected : null;
      const sim = simAt(x, y);
      if (sim !== null && actor !== null && sim !== actor) {
        game.socialMenu = { target: sim, x, y, options: null };
        bridge.requestSocialOptions(actor, sim).then((options) => {
          if (game.socialMenu?.target === sim) game.socialMenu = { ...game.socialMenu, options };
        });
        return;
      }
      if (sim !== null) {
        if (!direct) controls.inspect(sim === game.inspected ? null : sim);
        return;
      }
      const hit = renderer.pick(x, y);
      if (hit.objectId !== null) return openMenu(hit.objectId, x, y);
      if (actor !== null && hit.ground && inLot(hit.ground.x, hit.ground.z)) {
        bridge.send({ type: 'moveTo', sim: actor, x: hit.ground.x, z: hit.ground.z });
      } else if (!direct) controls.inspect(null);
    },
    hover(x, y) {
      const g = renderer.pick(x, y).ground;
      renderer.setHoverTile(g && inLot(g.x, g.z) && !game.pauseMenu ? { x: Math.floor(g.x), z: Math.floor(g.z) } : null);
      if (game.mode !== 'live') buildBuy.hover(g && inLot(g.x, g.z) ? g : null);
    },
    leave() {
      renderer.setHoverTile(null);
      buildBuy.clearPreviews();
    },
    // Wall and Remove tools: press, drag, release (see `BuildBuyInput.press`).
    press(x, y) {
      if (game.pauseMenu || game.mode === 'live') return false;
      const g = renderer.pick(x, y).ground;
      return buildBuy.press(g && inLot(g.x, g.z) ? g : null);
    },
    release(x, y, moved) {
      const g = renderer.pick(x, y).ground;
      buildBuy.release(g && inLot(g.x, g.z) ? g : null, moved);
    },
    cancel: () => buildBuy.cancelDrawing(),
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape') {
      if (game.townOpen) return void (game.townOpen = false);
      if (game.jobBoardOpen) return void (game.jobBoardOpen = false);
      // Step back: drop what's in hand, then leave Buy or Build mode.
      if (buildBuy.cancel()) return;
      if (game.mode !== 'live') return controls.setMode('live');
      if (game.menu || game.socialMenu) return controls.closeMenu();
      if (game.journalOpen) return void (game.journalOpen = false);
      if (game.follow !== null) return controls.follow(null);
      if (game.inspected !== null && liveSettings.directControl !== 'always') return controls.inspect(null);
      game.pauseMenu = !game.pauseMenu;
      return;
    }
    if (game.pauseMenu) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      return controls.undo();
    }
    switch (e.key) {
      case ' ':
        e.preventDefault();
        return controls.togglePause();
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        return controls.setSpeed(Number(e.key));
      case 'f':
      case 'F':
        if (game.mode !== 'live') return;
        return controls.follow(game.follow === null ? (game.inspected ?? game.selected) : null);
      case 'h':
      case 'H':
        if (game.mode === 'live') controls.frameHouse();
        return;
      case 'j':
      case 'J':
        if (game.mode === 'live') controls.toggleJournal();
        return;
      case 'p':
      case 'P':
        if (game.mode === 'live') {
          if (game.plannerOpen) game.plannerOpen = false;
          else controls.openPlanner();
        }
        return;
      case 'm':
      case 'M':
        if (game.mode === 'live') game.townOpen = !game.townOpen;
        return;
      case 'w':
      case 'W':
        return controls.setWallMode(nextWallMode(game.wallMode));
      case 'F8':
        e.preventDefault();
        void saveDebugReport();
        return;
      case 'F3':
        e.preventDefault();
        game.perfOpen = !game.perfOpen;
        return;
      case 'r':
      case 'R':
        return controls.rotatePlacing();
      case 'Delete':
      case 'Backspace':
        if (game.mode === 'buy' && game.buySelection !== null) controls.sell(game.buySelection);
        return;
      // B toggles Build mode, V Buy mode.
      case 'b':
      case 'B':
        return controls.setMode(game.mode === 'build' ? 'live' : 'build');
      case 'v':
      case 'V':
        game.buyFilter = null;
        return controls.setMode(game.mode === 'buy' ? 'live' : 'buy');
      case 'l':
      case 'L':
        return controls.setMode('live');
      case 'Tab': {
        e.preventDefault();
        const ids = playerSims();
        if (!ids.length) return;
        const next = ids[(ids.indexOf(game.inspected ?? game.selected) + 1) % ids.length];
        controls.selectSim(next);
        controls.inspect(next);
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
    if (!revealed) return;
    bubbles.update(frame);
    if (game.watching) {
      // Menus and other modes end watching (opening them is input, but not all of it is ours).
      if (!canWatch() && !director.active) stopWatching();
      else director.update(now);
    } else if (canWatch() && now - lastInput > liveSettings.directorDelay * 1000) startWatching(now);
    // After a big moment, back to the speed the player had (unless they picked another).
    if (slowedFrom !== null && now > slowUntil) {
      if (game.speed === 1 && game.mode === 'live') bridge.send({ type: 'setSpeed', speed: slowedFrom });
      slowedFrom = null;
    }
  });

  const session: GameSession = {
    household,
    ready,
    reveal() {
      if (revealed) return;
      revealed = true;
      renderer.setIdleOrbit(false);
      // A loaded debug report shows the view it was captured from.
      const pose = takePendingPose();
      if (pose) renderer.setCameraPose(pose);
      pointer = attachPointer();
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointerdown', onInput, true);
      canvas.addEventListener('wheel', onInput, { capture: true, passive: true });
      window.addEventListener('keydown', onInput, true);
      window.addEventListener('pointermove', onMove, { passive: true });
      lastInput = performance.now();
      bridge.send({ type: 'setSpeed', speed: resumeSpeed ?? 1 });
      prefetchTimer = setTimeout(() => {
        if (disposed) return;
        services.items.prefetch(content.shop.map((def) => ({ model: styledModel(content, assets, def, game.householdStyle), footprint: def.footprint ?? [1, 1] })));
      }, PREFETCH_PICTURES_MS);
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
      renderer.configure({
        bloom: s.bloom,
        tiltShift: s.tiltShift,
        resolutionScale: s.resolutionScale,
        cameraSensitivity: s.cameraSensitivity,
        visualStyle: s.visualStyle,
      });
      bridge.send({ type: 'setAutonomy', enabled: s.autonomy });
      bridge.send({ type: 'setAutoFast', enabled: s.skipQuietHours });
      game.perfOpen = s.showFps;
      if (s.autosaveMinutes !== autosaveMinutes) {
        autosaveMinutes = s.autosaveMinutes;
        clearInterval(autosaveTimer);
      clearTimeout(prefetchTimer);
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
    async dispose() {
      disposed = true;
      clearInterval(statsTimer);
      clearInterval(autosaveTimer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onInput, true);
      canvas.removeEventListener('wheel', onInput, true);
      window.removeEventListener('keydown', onInput, true);
      window.removeEventListener('pointermove', onMove);
      director.stop();
      clearTimeout(hudTimer);
      renderer.setGameShot(null);
      renderer.followSim(null);
      pointer?.dispose();
      bubbles.dispose();
      buildBuy.dispose();
      await building;
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
      project(x: number, y: number, z: number) {
        const out = { x: 0, y: 0 };
        return renderer.project(x, y, z, out) ? out : null;
      },
      home: () => buildBuy.home(),
      /** Sim-clock minute of the newest snapshot (changes when one arrives). */
      snapshotMinute: () => bridge.latest()[bridge.layout.header.minute],
      renderer,
      structure: () => ({ walls: world?.walls?.length ?? 0, openings: world?.openings?.map((o) => o.kind) ?? [], diagonals: world?.diagonals?.map((d) => `${d.axis}:${d.x}:${d.z}:${d.kind}`) ?? [], funds: game.funds }),
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
