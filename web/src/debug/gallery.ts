/**
 * Dev-only model gallery (`pnpm dev`, then /gallery.html): draws manifest models in a grid with the
 * game's own loader and foliage shader (wind, camera-facing cards) under a noon sun, to check art
 * without starting a game. Not part of the build.
 *
 * URL: `?keys=model.tree,model.pine` (default: every `model.tree*`, `model.garden.*` and nature key),
 * `?filter=garden` (keys containing it), `?cols=6`, `?gap=5`, `?alpha=-1.2&beta=1.1&radius=30`,
 * `?labels=0`, `?pack=…` like the game.
 */

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Matrix,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  Vector3,
  WebGPUEngine,
} from '@babylonjs/core';
import { AssetRegistry } from '../assets/registry';
import { MaterialLibrary } from '../render/babylon/materials';
import { buildModel } from '../render/babylon/models';
import { installNature } from '../render/babylon/nature';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new WebGPUEngine(canvas, { antialias: true });
await engine.initAsync();
const scene = new Scene(engine);
scene.clearColor = new Color4(0.62, 0.77, 0.9, 1);
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
scene.imageProcessingConfiguration.exposure = 1.1;
installNature(scene);

const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
sky.intensity = 0.55;
sky.groundColor = new Color3(0.32, 0.36, 0.25);
const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35), scene);
sun.intensity = 3.2;
sun.diffuse = new Color3(1, 0.96, 0.88);
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true;
shadows.bias = 0.002;

const base = import.meta.env.BASE_URL;
const assets = await AssetRegistry.load(`${base}assets/manifest.json`, params.getAll('pack'));
const env = assets.get('environment.sky', 'image');
if (env?.url) await MaterialLibrary.for(scene).loadEnvironment(env.url);
scene.environmentIntensity = 0.9;
const manifest = (await (await fetch(`${base}assets/manifest.json`)).json()) as { entries: Record<string, { type: string }> };
const filter = params.get('filter');
const keys = params.get('keys')?.split(',') ?? Object.keys(manifest.entries).filter((k) => manifest.entries[k].type === 'model' && (filter ? k.includes(filter) : /^model\.(tree|pine|bush|hedge|garden|flowers|flowerbed|plant)/.test(k)) && !k.endsWith('.far'));

const cols = Number(params.get('cols')) || Math.ceil(Math.sqrt(keys.length));
const gap = Number(params.get('gap')) || 4;
const rows = Math.ceil(keys.length / cols);
const ground = MeshBuilder.CreateGround('ground', { width: cols * gap + 8, height: rows * gap + 8 }, scene);
const gm = new PBRMaterial('ground', scene);
gm.albedoColor = Color3.FromHexString('#6F9A3E').toLinearSpace();
gm.roughness = 1;
gm.metallic = 0;
ground.material = gm;
ground.receiveShadows = true;

const labels = document.getElementById('labels')!;
const spots: { key: string; at: Vector3; el: HTMLSpanElement }[] = [];
await Promise.all(
  keys.map(async (key, i) => {
    const x = (i % cols - (cols - 1) / 2) * gap;
    const z = -(Math.floor(i / cols) - (rows - 1) / 2) * gap;
    const template = await buildModel(scene, key, assets.get(key, 'model'), [1, 1]);
    for (const mesh of template.meshes) {
      mesh.thinInstanceSetBuffer('matrix', Matrix.Translation(x, 0, z).asArray() as unknown as Float32Array, 16, true);
      mesh.receiveShadows = true;
      shadows.addShadowCaster(mesh);
    }
    if (params.get('labels') !== '0') {
      const el = document.createElement('span');
      el.textContent = key.replace(/^model\./, '');
      labels.append(el);
      spots.push({ key, at: new Vector3(x, 0, z - gap * 0.38), el });
    }
  }),
);

const camera = new ArcRotateCamera('cam', Number(params.get('alpha') ?? -Math.PI / 2), Number(params.get('beta') ?? 1.05), Number(params.get('radius')) || Math.max(cols, rows) * gap * 1.05, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
camera.minZ = 0.1;
camera.wheelPrecision = 20;

scene.onAfterRenderObservable.add(() => {
  const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const m = scene.getTransformMatrix();
  for (const s of spots) {
    const p = Vector3.Project(s.at, Matrix.IdentityReadOnly, m, vp);
    s.el.style.left = `${(p.x / engine.getRenderWidth()) * canvas.clientWidth}px`;
    s.el.style.top = `${(p.y / engine.getRenderHeight()) * canvas.clientHeight}px`;
  }
});
engine.runRenderLoop(() => scene.render());
addEventListener('resize', () => engine.resize());
Object.assign(window, { __scene: scene, __camera: camera, __ready: true });
