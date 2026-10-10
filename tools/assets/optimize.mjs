// Compressed copies of the game's assets for the production build. The sources in
// web/public/assets stay as they are (and are still what `pnpm dev` serves); `vite build` runs
// this and ships the copies next to them, with an index the asset registry reads
// (`assets/optimized.json`: source path -> compressed copy). Anything not in the index, such as
// a modder's pack, loads as it is.
//
//   textures (jpg/png/webp) -> KTX2, Basis Universal ETC1S with mipmaps. The GPU keeps them
//     block-compressed (BC7/BC1, ETC2 or ASTC, whatever it has), 4-8x less memory than RGBA.
//   models (.glb)           -> meshopt geometry (EXT_meshopt_compression, lossless on the
//     already quantised data), embedded textures to KTX2 (KHR_texture_basisu); references to
//     shared textures (the foliage atlas) point at their KTX2 copies.
//   character binaries      -> gzip (the browser inflates them; most hosts don't compress .bin).
//
// Outputs are cached by content hash in web/.assets/cache, so only changed files are encoded.
//
// usage (in web/): node ../tools/assets/optimize.mjs [--force] [--jobs N]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import zlib from 'node:zlib';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const SRC = path.join(WEB, 'public/assets');
const CACHE = path.join(WEB, '.assets/cache');
/** Copied into dist/assets by the build: `optimized.json` and the `opt/` tree. */
export const OUT = path.join(WEB, '.assets/out');

/** Bump when the encoding changes, so cached outputs are rebuilt. */
const VERSION = 1;

/** Left as they are: not loaded by the game, or drawn in a way KTX2 can't (flipped on upload). */
const SKIP = new Set([
  'nature/leaves.webp', // only an input of the foliage atlas
  'textures/sky/clouds.png', // loaded with invertY (compressed textures can't be flipped), small
]);

/**
 * Basis Universal ETC1S per kind of texture. Colour maps carry the sRGB transfer function, so
 * Babylon treats them like the JPGs they replace (gamma space); normal maps use the encoder's
 * normal-map tuning; packed AO/roughness/metal data is linear.
 */
const KTX2 = {
  color: { isUASTC: false, qualityLevel: 160, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: true },
  normal: { isUASTC: false, qualityLevel: 224, compressionLevel: 2, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, generateMipmap: true },
  data: { isUASTC: false, qualityLevel: 128, compressionLevel: 2, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, generateMipmap: true },
};

const IMAGE = /\.(jpe?g|png|webp)$/i;

/** What a source file becomes (null: shipped as it is). */
function plan(rel) {
  if (rel.startsWith('icons/') || SKIP.has(rel)) return null;
  if (/\.glb$/i.test(rel)) return { kind: 'model', out: rel };
  if (IMAGE.test(rel)) return { kind: 'texture', role: textureRole(rel), out: rel.replace(IMAGE, '.ktx2') };
  if (/^characters\/.*\.bin$/i.test(rel)) return { kind: 'gzip', out: `${rel}.gz` };
  return null;
}

/** By file name: `normal.jpg`, `male_normal.jpg`, `*_folds.jpg` and the fabric weave are normal maps, `arm.jpg` is data. */
function textureRole(rel) {
  if (/(^|[/_])(normal|folds)\.[a-z]+$/i.test(rel) || rel === 'characters/fabric.jpg') return 'normal';
  if (/(^|\/)arm\.[a-z]+$/i.test(rel)) return 'data';
  return 'color';
}

// ---- main thread: plan, cache, run jobs on workers, write the index -----------------------

/** Builds (or reuses) every compressed copy and writes `.assets/out`. Returns the index. */
export async function optimizeAssets({ force = false, jobs = Math.max(1, os.availableParallelism() - 1), log = console.log } = {}) {
  const started = performance.now();
  const files = walk(SRC).map((abs) => path.relative(SRC, abs).split(path.sep).join('/'));
  const settings = JSON.stringify({ VERSION, KTX2, SKIP: [...SKIP] });
  const tasks = [];
  for (const rel of files) {
    const p = plan(rel);
    if (!p) continue;
    const bytes = fs.readFileSync(path.join(SRC, rel));
    const key = createHash('sha256').update(settings).update(p.kind).update(p.role ?? '').update(bytes).digest('hex').slice(0, 24);
    const cached = path.join(CACHE, key + path.extname(p.out));
    tasks.push({ rel, ...p, size: bytes.length, cached, bytes });
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const todo = tasks.filter((t) => force || !fs.existsSync(t.cached));
  if (todo.length) log(`[assets] encoding ${todo.length} of ${tasks.length} files on ${Math.min(jobs, todo.length)} workers…`);

  // Gzip is quick: here. Textures and models: on workers (the Basis encoder is single-threaded WASM).
  for (const t of todo.filter((t) => t.kind === 'gzip')) fs.writeFileSync(t.cached, zlib.gzipSync(t.bytes, { level: 9 }));
  const heavy = todo.filter((t) => t.kind !== 'gzip').sort((a, b) => b.size - a.size);
  const converted = new Set(tasks.filter((t) => t.kind === 'texture').map((t) => t.rel));
  await runOnWorkers(heavy, jobs, (t) => ({ kind: t.kind, role: t.role, src: path.join(SRC, t.rel), rel: t.rel, converted: [...converted] }), (t, out) => {
    fs.writeFileSync(t.cached, out);
    log(`[assets]   ${t.rel}: ${kb(t.size)} -> ${kb(out.length)}`);
  });

  // The output tree: only copies that help (a gzip that doesn't shrink is dropped).
  fs.rmSync(OUT, { recursive: true, force: true });
  const index = {};
  const totals = new Map();
  for (const t of tasks) {
    const size = fs.statSync(t.cached).size;
    if (t.kind === 'gzip' && size >= t.size) continue;
    const dest = path.join(OUT, 'opt', t.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(t.cached, dest);
    index[t.rel] = `opt/${t.out}`;
    const group = `${t.rel.split('/')[0]} (${t.kind})`;
    const sum = totals.get(group) ?? { files: 0, before: 0, after: 0 };
    sum.files++;
    sum.before += t.size;
    sum.after += size;
    totals.set(group, sum);
  }
  fs.writeFileSync(path.join(OUT, 'optimized.json'), JSON.stringify({ version: VERSION, files: index }));
  // Forget outputs of files that changed or went away (keeps the CI cache from growing).
  const live = new Set(tasks.map((t) => path.basename(t.cached)));
  for (const file of fs.readdirSync(CACHE)) if (!live.has(file)) fs.rmSync(path.join(CACHE, file));
  for (const [group, s] of [...totals].sort()) log(`[assets] ${group.padEnd(22)} ${String(s.files).padStart(3)} files  ${kb(s.before).padStart(9)} -> ${kb(s.after).padStart(9)}`);
  log(`[assets] ${Object.keys(index).length} compressed copies in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return index;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function runOnWorkers(tasks, jobs, message, done) {
  if (!tasks.length) return;
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(jobs, tasks.length) }, () => {
    // The Basis encoder prints its progress; drop it.
    const worker = new Worker(fileURLToPath(import.meta.url), { stdout: true });
    worker.stdout.resume();
    return worker;
  });
  try {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            let current = null;
            const next = () => {
              current = queue.shift();
              if (!current) return resolve();
              worker.postMessage(message(current));
            };
            worker.on('message', (msg) => {
              if (msg.error) return reject(new Error(`${current.rel}: ${msg.error}`));
              done(current, Buffer.from(msg.bytes));
              next();
            });
            worker.on('error', reject);
            next();
          }),
      ),
    );
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

// ---- workers: encode one texture or model per message --------------------------------------

async function workerMain() {
  // The packages are web/'s dev dependencies.
  const require = (await import('node:module')).createRequire(path.join(WEB, 'package.json'));
  const load = async (id) => import(pathToFileURL(require.resolve(id)).href);
  const sharp = (await load('sharp')).default;
  // (ESM only, and its Node build isn't reachable through require.)
  const { encodeToKTX2 } = await import(pathToFileURL(path.join(WEB, 'node_modules/ktx2-encoder/dist/node/index.js')).href);
  const { Logger, NodeIO } = await load('@gltf-transform/core');
  const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } = await load('@gltf-transform/extensions');
  const { reorder } = await load('@gltf-transform/functions');
  const { MeshoptEncoder } = await load('meshoptimizer');
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  const imageDecoder = async (buffer) => {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height };
  };
  const ktx2 = (bytes, role) => encodeToKTX2(bytes, { ...KTX2[role], imageDecoder });

  /** A texture's role from the material slots that use it (a colour slot wins). */
  const slotRole = (texture) => {
    const slots = texture
      .getGraph()
      .listParentEdges(texture)
      .map((e) => e.getName());
    if (slots.some((s) => /baseColor|emissive|diffuse|specularGlossiness|sheenColor/.test(s))) return 'color';
    if (slots.some((s) => /normal/i.test(s))) return 'normal';
    return 'data';
  };

  async function model(src, rel, converted) {
    const doc = await io.read(src);
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    const root = doc.getRoot();
    let basisu = false;
    /** Texture index -> file, for textures that stay separate files (see `relinkImages`). */
    const shared = new Map();
    for (const [i, texture] of root.listTextures().entries()) {
      const uri = texture.getURI();
      // A shared texture next to the model (the foliage atlas): point at its KTX2 copy.
      const file = uri && !uri.startsWith('data:') ? path.posix.join(path.posix.dirname(rel), uri) : null;
      if (file) {
        const ktx = converted.includes(file);
        shared.set(i, ktx ? uri.replace(IMAGE, '.ktx2') : uri);
        texture.setImage(new Uint8Array(4));
        if (ktx) texture.setMimeType('image/ktx2');
        basisu ||= ktx;
        continue;
      }
      const image = texture.getImage();
      if (!image || texture.getMimeType() === 'image/ktx2') continue;
      texture.setImage(await ktx2(image, slotRole(texture))).setMimeType('image/ktx2');
      basisu = true;
    }
    if (basisu) {
      doc.createExtension(KHRTextureBasisu).setRequired(true);
      for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
    }
    // Vertex order that compresses (and caches) best, then meshopt over every buffer view. The
    // data is encoded as it is (no further quantisation): the foliage cards keep float attributes.
    await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    return relinkImages(await io.writeBinary(doc), shared);
  }

  parentPort.on('message', async (msg) => {
    try {
      const bytes = msg.kind === 'texture' ? await ktx2(fs.readFileSync(msg.src), msg.role) : await model(msg.src, msg.rel, msg.converted);
      parentPort.postMessage({ bytes }, [bytes.buffer]);
    } catch (err) {
      parentPort.postMessage({ error: String(err?.stack ?? err) });
    }
  });
}

/**
 * glTF-Transform embeds every image in a .glb. Shared textures were written as 4-byte stubs; this
 * points their image entries back at the separate file (the stub's buffer view stays, unused).
 */
function relinkImages(glb, files) {
  if (!files.size) return glb;
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  for (const [i, uri] of files) {
    delete json.images[i].bufferView;
    json.images[i].uri = uri;
  }
  let text = JSON.stringify(json);
  text += ' '.repeat((4 - (Buffer.byteLength(text) % 4)) % 4);
  const jsonChunk = Buffer.from(text);
  const rest = glb.subarray(20 + jsonLength);
  const out = Buffer.alloc(20 + jsonChunk.length + rest.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  Buffer.from(rest).copy(out, 20 + jsonChunk.length);
  return new Uint8Array(out.buffer, out.byteOffset, out.length);
}

if (!isMainThread) {
  await workerMain();
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const jobs = args.includes('--jobs') ? Number(args[args.indexOf('--jobs') + 1]) : undefined;
  await optimizeAssets({ force: args.includes('--force'), jobs });
}
