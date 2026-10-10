// Refreshes web/public/decoders/: the decoders Babylon would otherwise fetch from its CDN, which
// the cross-origin isolated page can't use. Same layout as the CDN (render/babylon/loaders.ts
// points Tools.ScriptBaseUrl there). Run after upgrading Babylon or meshoptimizer; the files are
// committed, so builds need no network.
//
//   KTX2 (Basis Universal) texture decoder and transcoders: Babylon's CDN, pinned to the
//   @babylonjs/core version in web/package.json (Apache-2.0; zstddec BSD).
//   meshopt geometry decoder: the meshoptimizer package that also encodes our models (MIT).
//
// usage (in web/): node ../tools/assets/decoders.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const OUT = path.join(WEB, 'public/decoders');
const pkg = JSON.parse(fs.readFileSync(path.join(WEB, 'package.json'), 'utf8'));
const version = pkg.dependencies['@babylonjs/core'].replace(/^[^\d]*/, '');
const CDN = `https://cdn.babylonjs.com/v${version}`;

const fromCdn = [
  'babylon.ktx2Decoder.js',
  'zstddec.wasm',
  'ktx2Transcoders/1/msc_basis_transcoder.js',
  'ktx2Transcoders/1/msc_basis_transcoder.wasm',
  'ktx2Transcoders/1/uastc_astc.wasm',
  'ktx2Transcoders/1/uastc_bc7.wasm',
  'ktx2Transcoders/1/uastc_r8_unorm.wasm',
  'ktx2Transcoders/1/uastc_rg8_unorm.wasm',
  'ktx2Transcoders/1/uastc_rgba8_srgb_v2.wasm',
  'ktx2Transcoders/1/uastc_rgba8_unorm_v2.wasm',
];

for (const file of fromCdn) {
  const res = await fetch(`${CDN}/${file}`);
  if (!res.ok) throw new Error(`${CDN}/${file}: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
  fs.writeFileSync(path.join(OUT, file), bytes);
  console.log(`${file} (${(bytes.length / 1024).toFixed(0)} KB, Babylon ${version})`);
}

// The UMD build: Babylon loads it as a classic script and uses the global MeshoptDecoder.
const meshopt = path.join(WEB, 'node_modules/meshoptimizer');
const meshoptVersion = JSON.parse(fs.readFileSync(path.join(meshopt, 'package.json'), 'utf8')).version;
fs.copyFileSync(path.join(meshopt, 'meshopt_decoder.cjs'), path.join(OUT, 'meshopt_decoder.js'));
console.log(`meshopt_decoder.js (meshoptimizer ${meshoptVersion})`);
