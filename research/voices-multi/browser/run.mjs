/**
 * Serves the benchmark page (plain HTTP, no cross-origin isolation, like GitHub Pages) and runs
 * it in Chrome for Testing (Playwright's build) for each model/EP, printing JSON results.
 *
 *   node browser/prep.mjs && node browser/run.mjs [model:ep ...] [--headed]
 * Port 5391 (never 5173).
 */
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK } from '../lines.mjs';

const APP = fileURLToPath(new URL('.', import.meta.url));
const ORT = `${WORK}/node/node_modules/onnxruntime-web/dist`;
const PORT = 5391;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };

const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const path = url.startsWith('/app/') ? join(APP, url.slice(5)) : url.startsWith('/ort/') ? join(ORT, url.slice(5)) : join(WORK, url);
  if (!existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const coi = process.env.COI ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {};
  res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Content-Length': statSync(path).size, ...coi });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const { chromium } = createRequire(`${WORK}/node/package.json`)('playwright-core');
const headed = process.argv.includes('--headed');
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  headless: !headed,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const configs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = [];
for (const c of configs.length ? configs : ['paradee:wasm']) {
  const [model, ep] = c.split(':');
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => process.env.LOG && console.error('  [page]', m.text().slice(0, 400)));
  await page.goto(`http://127.0.0.1:${PORT}/app/bench.html?model=${model}&ep=${ep}&log=${process.env.LOG ?? 'error'}&threads=${process.env.THREADS ?? 1}`);
  const r = await page.evaluate(() => window.result);
  console.log(JSON.stringify(r));
  results.push(r);
  await page.close();
}
writeFileSync(`${WORK}/samples/browser-bench-${Date.now()}.json`, JSON.stringify(results, null, 1));
await browser.close();
server.close();
