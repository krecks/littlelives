// Optimises a glTF/GLB model for the game and writes one self-contained .glb:
// flatten the node tree, drop unused data, merge primitives that share a material (fewer draw
// calls), weld, optionally simplify, resize textures and re-encode them (WebP by default),
// then quantise the geometry (KHR_mesh_quantization, decoded natively by Babylon; no meshopt or
// Draco decoder needed, which would have to come from a CDN that cross-origin isolation blocks).
//
// usage: GT_DIR=<dir with node_modules/@gltf-transform> node optimize_model.mjs <in> <out.glb>
//          [--tex 512] [--format webp|jpeg|keep] [--quality 82] [--simplify 0.5] [--error 0.002]
//          [--drop-material name,name] [--no-quantize]
//
// Needs @gltf-transform/core, /extensions, /functions, meshoptimizer and sharp
// (`npm i @gltf-transform/cli@4` in GT_DIR installs all of them).
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(path.join(process.env.GT_DIR ?? process.cwd(), 'node_modules', 'x.js'));
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const F = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');
const sharp = require('sharp');

const args = process.argv.slice(2);
const [input, output] = args;
if (!input || !output) {
  console.error('usage: node optimize_model.mjs <in.gltf|glb> <out.glb> [--tex 512] [--format webp|jpeg|keep] [--simplify r] [--drop-material a,b]');
  process.exit(1);
}
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const tex = Number(opt('tex', 512));
const format = opt('format', 'webp');
const quality = Number(opt('quality', 82));
const ratio = Number(opt('simplify', 1));
const error = Number(opt('error', 0.002));
const drop = new Set((opt('drop-material', '') || '').split(',').filter(Boolean));
const quantize = !args.includes('--no-quantize');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': undefined });
const doc = await io.read(input);
const root = doc.getRoot();

// Skins, animations and cameras are never used (the game bakes static meshes).
for (const a of root.listAnimations()) a.dispose();
for (const s of root.listSkins()) s.dispose();
for (const c of root.listCameras()) c.dispose();
if (drop.size) {
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (drop.has(prim.getMaterial()?.getName() ?? '')) prim.dispose();
    }
  }
}

const steps = [F.dedup(), F.prune(), F.flatten(), F.join({ keepNamed: false }), F.weld()];
if (ratio < 1) {
  await MeshoptSimplifier.ready;
  steps.push(F.simplify({ simplifier: MeshoptSimplifier, ratio, error }));
}
steps.push(F.textureCompress({ encoder: sharp, resize: [tex, tex], targetFormat: format === 'keep' ? undefined : format, quality }));
if (quantize) steps.push(F.quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
steps.push(F.dedup(), F.prune());
await doc.transform(...steps);

// A GLB holds one binary buffer: move every accessor into the first one.
const buffers = root.listBuffers();
for (const b of buffers.slice(1)) {
  for (const a of root.listAccessors()) if (a.getBuffer() === b) a.setBuffer(buffers[0]);
  b.dispose();
}
fs.mkdirSync(path.dirname(output), { recursive: true });
await io.write(output, doc);
const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log(`${path.basename(output)}: ${(fs.statSync(output).size / 1024).toFixed(0)} KB, ${Math.round(tris)} tris, ${root.listMaterials().length} materials, ${root.listTextures().length} textures`);
