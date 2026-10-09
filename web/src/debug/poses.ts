/**
 * Dev-only pose bench (`pnpm dev`, then /poses.html): Sims at real furniture, driven through the
 * game's own `Characters` with a synthetic snapshot, to check activity animations without
 * setting up a game. Not part of the build.
 *
 * Each station is one object and one Sim (two for social interactions) doing an activity tag;
 * a station with a `script` cycles through poses (sitting down, getting into bed, ...).
 *
 * URL: `?only=garden,water` (stations whose label contains any), `?cols=6`, `?gap=3.4`,
 * `?focus=<n>` (frame station n close up), `?alpha=…&beta=…&radius=…`, `?labels=0`,
 * `?manual` (time only advances via `__poses.advance(seconds)`, for screenshots).
 */

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Matrix,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  Vector3,
} from '../render/babylon/core';
import { AssetRegistry } from '../assets/registry';
import type { FrameState } from '../core/bridge';
import type { ObjectPlacement, SimInfo } from '../core/protocol';
import { Pose, type SnapshotLayout } from '../core/snapshot';
import { Characters, MAX_CHARACTERS } from '../render/babylon/characters';
import { MaterialLibrary } from '../render/babylon/materials';
import { buildModel } from '../render/babylon/models';
import { installNature } from '../render/babylon/nature';

const P = Pose;
/** Conversation animation codes (`social::ANIMATIONS` + 1). */
const SOCIAL = { talk: 1, laugh: 2, flirt: 3, argue: 4, fight: 5, hug: 6, kiss: 7 } as const;

interface Step {
  seconds: number;
  pose: number;
  /** Activity tag while in this step ('' = none). */
  tag?: string;
  moving?: boolean;
}
interface Station {
  label: string;
  def?: string;
  tag?: string;
  pose?: number;
  social?: keyof typeof SOCIAL;
  /** Cycles through these steps (overrides `pose` / `tag`). */
  script?: Step[];
  female?: boolean;
}

const STATIONS: Station[] = [
  // Gardening
  { label: 'water flowers', def: 'garden.tulips', tag: 'water' },
  { label: 'water houseplant', def: 'garden.monstera', tag: 'water' },
  { label: 'tend veg (weed)', def: 'garden.vegPatch', tag: 'tend' },
  { label: 'harvest tomatoes', def: 'garden.tomatoes', tag: 'harvest' },
  { label: 'prune roses', def: 'garden.roses', tag: 'prune' },
  { label: 'trim hedge', def: 'garden.hedge', tag: 'prune' },
  { label: 'garden (legacy tag)', def: 'flowerbed', tag: 'garden' },
  // Looking
  { label: 'smell flowers', def: 'garden.tulips', tag: 'smell', female: true },
  { label: 'admire blossom', def: 'garden.cherry', tag: 'look' },
  { label: 'look birdbath', def: 'garden.birdbath', tag: 'look', female: true },
  { label: 'talk to plant', def: 'garden.monstera', tag: 'talk', female: true },
  // Lying
  { label: 'sleep', def: 'bed', tag: 'sleep', pose: P.Lie },
  { label: 'nap hammock', def: 'natureLover.gardenHammock', tag: 'nap', pose: P.Lie, female: true },
  { label: 'bench press', def: 'weightBench', tag: 'lift', pose: P.Lie },
  {
    label: 'get into / out of bed',
    def: 'bed',
    female: true,
    script: [
      { seconds: 2.5, pose: P.Stand },
      { seconds: 6, pose: P.Lie, tag: 'sleep' },
      { seconds: 4, pose: P.Stand },
    ],
  },
  {
    label: 'sit down / stand up',
    def: 'armchair',
    script: [
      { seconds: 2.5, pose: P.Stand },
      { seconds: 5, pose: P.Sit, tag: 'sit' },
      { seconds: 4, pose: P.Stand },
    ],
  },
  // Eating / drinking
  { label: 'eat (fridge)', def: 'fridge', tag: 'eat' },
  { label: 'drink (espresso)', def: 'foodie.espressoBar', tag: 'drink', female: true },
  { label: 'eat seated', def: 'romantic.candlelitTable', tag: 'eat', pose: P.Sit },
  // Seated
  { label: 'relax recliner', def: 'couchPotato.recliner', tag: 'relax', pose: P.Sit },
  { label: 'bath', def: 'whirlpoolTub', tag: 'bath', pose: P.Sit, female: true },
  { label: 'toilet', def: 'toilet', tag: 'toilet', pose: P.Sit },
  { label: 'meditate', def: 'hotHeaded.coolDownCushion', tag: 'meditate', pose: P.Sit, female: true },
  { label: 'read seated', def: 'bookworm.readingNook', tag: 'read', pose: P.Sit },
  { label: 'type', def: 'computerDesk', tag: 'type', pose: P.Sit, female: true },
  { label: 'piano', def: 'piano', tag: 'music', pose: P.Sit },
  { label: 'cello', def: 'gloomy.cello', tag: 'music', pose: P.Sit, female: true },
  { label: 'drums', def: 'hotHeaded.thunderDrums', tag: 'music', pose: P.Sit },
  // Standing work
  { label: 'cook', def: 'chefStove', tag: 'cook', female: true },
  { label: 'wash (sink)', def: 'sink', tag: 'wash' },
  { label: 'paint', def: 'easel', tag: 'paint', female: true },
  { label: 'tinker', def: 'workbench', tag: 'tinker' },
  { label: 'read bookshelf', def: 'bookshelf', tag: 'read', female: true },
  { label: 'mop', def: 'neat.steamMopDock', tag: 'clean' },
  { label: 'laundry', def: 'neat.laundryCenter', tag: 'clean', female: true },
  { label: 'sing', def: 'cheerful.karaokeMachine', tag: 'sing', female: true },
  // Exercise
  { label: 'trampoline', def: 'energetic.trampoline', tag: 'exercise' },
  { label: 'bouldering', def: 'energetic.boulderingWall', tag: 'exercise', female: true },
  { label: 'vibe plate', def: 'lazy.vibePlate', tag: 'exercise' },
  { label: 'heavy bag', def: 'hotHeaded.heavyBag', tag: 'exercise' },
  { label: 'streetball', def: 'energetic.streetballHoop', tag: 'exercise', female: true },
  { label: 'sunrise lamp', def: 'cheerful.sunriseLamp', tag: 'exercise' },
  // Socials
  { label: 'hug', social: 'hug' },
  { label: 'kiss', social: 'kiss' },
  { label: 'laugh', social: 'laugh' },
  { label: 'flirt', social: 'flirt' },
  { label: 'argue', social: 'argue' },
  { label: 'fight', social: 'fight' },
];

const params = new URLSearchParams(location.search);
const only = params.get('only')?.split(',');
const stations = only ? STATIONS.filter((s) => only.some((o) => s.label.includes(o) || s.def?.includes(o) || s.tag === o)) : STATIONS;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.62, 0.77, 0.9, 1);
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
scene.imageProcessingConfiguration.exposure = 1.1;
installNature(scene);
const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
sky.intensity = 0.6;
sky.groundColor = new Color3(0.32, 0.36, 0.25);
const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, -0.35), scene);
sun.intensity = 3;
sun.diffuse = new Color3(1, 0.96, 0.88);
const shadowGen = new ShadowGenerator(2048, sun);
shadowGen.usePercentageCloserFiltering = true;
shadowGen.bias = 0.002;

const base = import.meta.env.BASE_URL;
const assets = await AssetRegistry.load(`${base}assets/manifest.json`, params.getAll('pack'));
const lib = MaterialLibrary.for(scene).setAssets(assets);
const env = assets.get('environment.sky', 'image');
if (env?.url) await lib.loadEnvironment(env.url);

// Content: object defs (model and footprint) and the animation tags.
interface DefRaw {
  id: string;
  model?: string;
  footprint?: [number, number];
  slots?: number;
}
const PACKS = ['bookworm', 'cheerful', 'couchPotato', 'energetic', 'foodie', 'gloomy', 'hotHeaded', 'kind', 'lazy', 'loner', 'natureLover', 'neat', 'outgoing', 'romantic', 'slob'];
const files = await Promise.all(
  ['base', 'garden', ...PACKS.map((p) => `packs/${p}`)].map((f) =>
    fetch(`${base}content/${f}.json`)
      .then((r) => r.json() as Promise<{ objects?: DefRaw[]; animations?: string[] }>)
      .catch(() => ({ objects: [] as DefRaw[], animations: undefined as string[] | undefined })),
  ),
);
const defs = new Map<string, DefRaw>();
for (const f of files) for (const o of f.objects ?? []) defs.set(o.id, o);
const actions = [...(files[0].animations ?? [])];
for (const s of stations) for (const t of [s.tag, ...(s.script ?? []).map((x) => x.tag)]) if (t && !actions.includes(t)) actions.push(t);

// Layout: stations in a grid, each object at its cell's centre facing +z.
const cols = Number(params.get('cols')) || Math.ceil(Math.sqrt(stations.length * 1.4));
const gap = Number(params.get('gap')) || 3.4;
const rows = Math.ceil(stations.length / cols);
const ground = MeshBuilder.CreateGround('ground', { width: cols * gap + 6, height: rows * gap + 6 }, scene);
const gm = new PBRMaterial('ground', scene);
gm.albedoColor = Color3.FromHexString('#8E9A7A').toLinearSpace();
gm.roughness = 1;
gm.metallic = 0;
ground.material = gm;
ground.receiveShadows = true;

interface Actor {
  station: number;
  x: number;
  z: number;
  yaw: number;
  object: number;
  partner: number;
  role: number;
  /** Standing use: the front tile's centre. */
  frontX?: number;
  frontZ?: number;
}
const objects: ObjectPlacement[] = [];
const actors: Actor[] = [];
const labels = document.getElementById('labels')!;
const spots: { at: Vector3; el: HTMLSpanElement }[] = [];
const centres: Vector3[] = [];
const look = (id: number, female: boolean): SimInfo => ({
  id,
  name: '',
  household: 0,
  gender: female ? 'female' : 'male',
  attractedTo: [],
  appearance: {
    body: female ? '#C9725F' : '#5F86C9',
    skin: ['#C08A64', '#8D5A3B', '#E8C0A0', '#6B4430'][id % 4],
    hair: ['#2B2320', '#7A4A2A', '#C9A15A', '#1A1A1A'][id % 4],
    hairStyle: female ? 'long' : 'short',
    height: 1,
  },
  traits: [],
  perks: [],
});

await Promise.all(
  stations.map(async (s, n) => {
    const cx = ((n % cols) - (cols - 1) / 2) * gap;
    const cz = -(Math.floor(n / cols) - (rows - 1) / 2) * gap;
    centres.push(new Vector3(cx, 0, cz));
    if (s.social) {
      actors.push({ station: n, x: cx, z: cz - 0.5, yaw: 0, object: -1, partner: 0, role: 1 });
      actors.push({ station: n, x: cx, z: cz + 0.5, yaw: Math.PI, object: -1, partner: 0, role: 2 });
    } else if (s.def) {
      const def = defs.get(s.def);
      const [w, d] = def?.footprint ?? [1, 1];
      const ox = Math.round(cx - w / 2);
      const oz = Math.round(cz - d / 2);
      const id = objects.length;
      objects.push({ id, def: s.def, x: ox, z: oz, rot: 0, w, d, quality: 0, style: 0, sellValue: null });
      const key = def?.model ?? `model.${s.def}`;
      const template = await buildModel(scene, key, assets.get(key, 'model'), [w, d]);
      for (const mesh of template.meshes) {
        mesh.thinInstanceSetBuffer('matrix', Matrix.Translation(ox + w / 2, 0, oz + d / 2).asArray() as unknown as Float32Array, 16, true);
        mesh.receiveShadows = true;
        shadowGen.addShadowCaster(mesh);
      }
      // Standing use: centred on the front tile, facing the object; sitting / lying: on the
      // (first) slot, facing out (as sim-core places them).
      const slots = def?.slots ?? 1;
      const slotX = ox + w / 2 + (0 - (slots - 1) / 2) * (w / slots);
      actors.push({ station: n, x: slotX, z: oz + d / 2, yaw: 0, object: id, partner: -1, role: 0, frontX: ox + Math.floor((w - 1) / 2) + 0.5, frontZ: oz + d + 0.5 });
    }
    if (params.get('labels') !== '0') {
      const el = document.createElement('span');
      el.textContent = `${n}: ${s.label}`;
      labels.append(el);
      spots.push({ at: new Vector3(cx, 0, cz + gap * 0.42), el });
    }
  }),
);
actors.sort((a, b) => a.station - b.station);
// Stations load in any order: row i is actor i after sorting.
const actorSims = actors.map((a, i) => look(i, stations[a.station].social ? a.role === 2 : !!stations[a.station].female));
for (let i = 0; i < actors.length; i++) {
  const a = actors[i];
  if (a.partner >= 0) a.partner = actors[i].role === 1 ? i + 1 : i - 1;
}

const characters = new Characters(scene, assets, lib);
if (!(await characters.init())) throw new Error('characters unavailable');
await characters.build({ sims: actorSims, objects });
for (const m of characters.casters()) shadowGen.addShadowCaster(m);

const FIELDS = ['id', 'x', 'z', 'yaw', 'pose', 'moving', 'social', 'outcome', 'partner', 'anim', 'emotion', 'role', 'away', 'object', 'action', 'mood'] as const;
const HEADER_LEN = 6;
const STRIDE = FIELDS.length;
const layout: SnapshotLayout = {
  capacity: HEADER_LEN + STRIDE * MAX_CHARACTERS,
  headerLen: HEADER_LEN,
  simStride: STRIDE,
  maxSims: MAX_CHARACTERS,
  ticksPerSecond: 20,
  header: { tick: 0, day: 1, minute: 2, speed: 3, simCount: 4, structureVersion: 5 },
  sim: Object.fromEntries(FIELDS.map((f, i) => [f, i])) as unknown as SnapshotLayout['sim'],
  actions,
};
const snap = new Float32Array(layout.capacity);
const frame: FrameState = { prev: snap, curr: snap, alpha: 0, layout, now: 0 };
const shadowMatrices = new Float32Array(MAX_CHARACTERS * 16);

let clock = 0;
function writeSnapshot(): void {
  const h = layout.header;
  const k = layout.sim;
  snap[h.speed] = 1;
  snap[h.simCount] = actors.length;
  actors.forEach((a, i) => {
    const s = stations[a.station];
    const o = HEADER_LEN + i * STRIDE;
    let pose = s.pose ?? P.Stand;
    let tag = s.tag ?? '';
    if (s.script) {
      const total = s.script.reduce((t, x) => t + x.seconds, 0);
      let t = clock % total;
      const step = s.script.find((x) => (t -= x.seconds) < 0)!;
      pose = step.pose;
      tag = step.tag ?? '';
    }
    const standing = pose === P.Stand && a.object >= 0;
    snap[o + k.id] = i;
    snap[o + k.x] = standing ? a.frontX! : a.x;
    snap[o + k.z] = standing ? a.frontZ! : a.z;
    // Scripted stations stand up facing away, as sim-core leaves them (it keeps the yaw).
    snap[o + k.yaw] = standing && !s.script ? Math.PI : a.yaw;
    snap[o + k.pose] = pose;
    snap[o + k.moving] = 0;
    const social = s.social ? SOCIAL[s.social] : 0;
    snap[o + k.social] = social ? 1 : 0;
    snap[o + k.anim] = social;
    snap[o + k.outcome] = 0;
    snap[o + k.partner] = a.partner;
    snap[o + k.role] = a.role;
    snap[o + k.emotion] = 0;
    snap[o + k.away] = 0;
    snap[o + k.object] = s.script && pose === P.Stand ? -1 : a.object;
    snap[o + k.action] = social ? actions.indexOf('talk') : tag ? actions.indexOf(tag) : -1;
    snap[o + k.mood!] = 0.8;
  });
}

const focus = params.get('focus');
const target = focus !== null ? centres[Number(focus)].add(new Vector3(0.3, 0.7, 0.75)) : Vector3.Zero();
const camera = new ArcRotateCamera(
  'cam',
  Number(params.get('alpha') ?? Math.PI / 2 + 0.5),
  Number(params.get('beta') ?? 1.15),
  Number(params.get('radius')) || (focus !== null ? 4 : Math.max(cols, rows) * gap * 1.05),
  target,
  scene,
);
camera.attachControl(canvas, true);
camera.minZ = 0.05;
camera.wheelPrecision = 30;

scene.onAfterRenderObservable.add(() => {
  const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const m = scene.getTransformMatrix();
  for (const s of spots) {
    const p = Vector3.Project(s.at, Matrix.IdentityReadOnly, m, vp);
    s.el.style.left = `${(p.x / engine.getRenderWidth()) * canvas.clientWidth}px`;
    s.el.style.top = `${(p.y / engine.getRenderHeight()) * canvas.clientHeight}px`;
  }
});

const manual = params.has('manual');
function step(dt: number): void {
  clock += dt;
  writeSnapshot();
  frame.now = clock * 1000;
  characters.update(frame, () => true, shadowMatrices);
}
let last = performance.now();
engine.runRenderLoop(() => {
  if (!manual) {
    const now = performance.now();
    step(Math.min(0.1, (now - last) / 1000));
    last = now;
  }
  scene.render();
});
addEventListener('resize', () => engine.resize());

Object.assign(window, {
  __poses: {
    stations: stations.map((s) => s.label),
    /** Advances the bench by `seconds` in 1/30 s steps (manual mode). */
    advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-6; t += 1 / 30) step(1 / 30);
    },
    focus(n: number, radius = 4, alpha?: number, beta?: number) {
      camera.target = centres[n].add(new Vector3(0.3, 0.7, 0.75));
      camera.radius = radius;
      if (alpha !== undefined) camera.alpha = alpha;
      if (beta !== undefined) camera.beta = beta;
    },
    characters,
    camera,
  },
  __ready: true,
});
