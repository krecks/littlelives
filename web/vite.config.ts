import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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

export default defineConfig({
  plugins: [svelte(), debugReports()],
  // The game's version (one number for web and Rust; `node ../tools/release/version.mjs <x.y.z>` bumps it).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 8000 },
});
