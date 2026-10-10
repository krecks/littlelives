import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// SharedArrayBuffer (zero-copy sim -> render snapshots) requires cross-origin isolation.
// Production hosting must send the same two headers.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Where debug reports from the game land (dev server only): `<repo>/debug-reports/<name>/`. */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const REPORTS = fileURLToPath(new URL('../debug-reports', import.meta.url));

/**
 * Dev server endpoints for debug reports (see src/debug/report.ts):
 * POST /__debug/report writes report.json, save.txt and screenshot.jpg into a new folder;
 * GET /__debug/reports/<name>/<file> reads them back (`?debugReport=<name>` loads one).
 */
function debugReports(): Plugin {
  return {
    name: 'debug-reports',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__debug/report', async (req, res) => {
        if (req.method !== 'POST') return void ((res.statusCode = 405), res.end());
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const { report, save, screenshot } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            report: { createdAt: string; note: string };
            save: string;
            screenshot: string | null;
          };
          const slug = report.note.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
          const name = report.createdAt.replace(/\.\d+Z$/, '').replace(/[:T]/g, '-') + (slug ? `-${slug}` : '');
          const dir = join(REPORTS, name);
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
          await writeFile(join(dir, 'save.txt'), save);
          if (screenshot) await writeFile(join(dir, 'screenshot.jpg'), Buffer.from(screenshot.slice(screenshot.indexOf(',') + 1), 'base64'));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ path: `debug-reports/${name}` }));
          server.config.logger.info(`[debug] report saved to debug-reports/${name}`, { timestamp: true });
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
      server.middlewares.use('/__debug/reports/', async (req, res) => {
        const [name, file] = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '').split('/');
        if (!name || !file || name.includes('..') || !['report.json', 'save.txt', 'screenshot.jpg'].includes(file)) {
          return void ((res.statusCode = 404), res.end());
        }
        try {
          res.end(await readFile(join(REPORTS, name, file)));
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

/**
 * Compressed copies of the assets (KTX2 textures, meshopt models, gzipped character data; see
 * tools/assets/optimize.mjs): encoded when the build starts (only files that changed since the
 * last build, the rest come from web/.assets/cache) and copied into dist/assets when it ends,
 * next to the sources. `LL_ASSETS=source` builds without them. The dev server serves sources.
 */
function optimizedAssets(): Plugin {
  const skip = process.env.LL_ASSETS === 'source';
  let outDir = '';
  let copies = '';
  return {
    name: 'optimized-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async buildStart() {
      if (skip) return;
      // Imported by URL so it runs from its own file (it starts worker threads on itself).
      const tool = await import(new URL('../tools/assets/optimize.mjs', import.meta.url).href);
      await tool.optimizeAssets({ log: (line: string) => this.info(line) });
      copies = tool.OUT;
    },
    async closeBundle() {
      if (copies) await cp(copies, join(outDir, 'assets'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), debugReports(), optimizedAssets()],
  // The game's version (one number for web and Rust; `node ../tools/release/version.mjs <x.y.z>` bumps it).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  // The main chunk is about 1.7 MB (Babylon by module, see render/babylon/core.ts): warn if it grows.
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
