// Main thread of the benchmark page: a WebGL2 GPU load standing in for the game's renderer
// (a fragment shader with a calibrated amount of work per pixel, every animation frame), frame
// intervals recorded before and while the voice worker synthesises lines.
// Query: ?model=<name>&ep=wasm|webgpu&reps=3&load=<0..1 share of the frame budget for the GPU>
const q = new URLSearchParams(location.search);
const MODEL = q.get('model') ?? 'paradee';
const EP = q.get('ep') ?? 'wasm';
const REPS = Number(q.get('reps') ?? 3);
const LOAD = Number(q.get('load') ?? 0.6);

const gl = document.getElementById('c').getContext('webgl2');
const vs = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;
const fs = `#version 300 es
precision highp float; uniform float t; uniform int n; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(1600., 900.); float a = 0.;
  for (int i = 0; i < 4096; i++) { if (i >= n) break; a += sin(uv.x * float(i) + t) * cos(uv.y * 1.3 * float(i) - t); }
  o = vec4(0.5 + 0.5 * sin(a), uv, 1.);
}`;
function shader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(prog);
gl.useProgram(prog);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const uT = gl.getUniformLocation(prog, 't');
const uN = gl.getUniformLocation(prog, 'n');

let iterations = 8;
let frames = [];
let last = 0;
function frame(now) {
  if (last) frames.push(now - last);
  last = now;
  gl.uniform1f(uT, now / 1000);
  gl.uniform1i(uN, iterations);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function measure(ms) {
  frames = [];
  await sleep(ms);
  return frames.slice();
}
function stats(f) {
  const s = f.slice().sort((a, b) => a - b);
  const pick = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { n: s.length, p50: +pick(0.5).toFixed(1), p95: +pick(0.95).toFixed(1), max: +(s.at(-1) ?? 0).toFixed(1), over50: s.filter((x) => x > 50).length, over25: s.filter((x) => x > 25).length };
}

// Calibrate: raise the shader work until frames slow down, then settle at LOAD of that.
async function calibrate() {
  for (;;) {
    const p50 = stats(await measure(500)).p50;
    if (p50 > 20 || iterations >= 4096) break;
    iterations *= 2;
  }
  iterations = Math.max(1, Math.floor(iterations * LOAD));
  // step down until the frame rate holds (under 2 % of frames over 25 ms)
  for (let k = 0; k < 12; k++) {
    const s = stats(await measure(1000));
    if (s.over25 <= s.n * 0.02) break;
    iterations = Math.floor(iterations * 0.8);
  }
}

const worker = new Worker('/app/worker.js?log=' + (q.get('log') ?? 'error') + '&threads=' + (q.get('threads') ?? 1), { type: 'module' });
const ask = (msg) =>
  new Promise((res, rej) => {
    worker.onmessage = ({ data }) => (data.error ? rej(new Error(data.error)) : res(data));
    worker.postMessage(msg);
  });

window.result = (async () => {
  await calibrate();
  const idle = stats(await measure(3000));
  const loaded = (await ask({ load: { model: MODEL, ep: EP } })).loaded;
  const warm = (await ask({ run: 0 })).ran;
  const runs = [];
  frames = [];
  const t0 = performance.now();
  for (let r = 0; r < REPS; r++) for (let i = 0; i < 3; i++) runs.push((await ask({ run: i })).ran);
  const busyMs = performance.now() - t0;
  const during = stats(frames);
  const lines = [0, 1, 2].map((i) => {
    const rs = runs.filter((r) => r.i === i);
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
    return { line: i + 1, ms: +ms.toFixed(0), firstMs: +rs[0].ms.toFixed(0), audioS: rs[0].audioS, rtf: +(rs[0].audioS / (ms / 1000)).toFixed(2), deterministic: rs.every((r) => r.hash === rs[0].hash) };
  });
  return { model: MODEL, ep: EP, adapter: loaded.adapter, sessionMs: Math.round(loaded.ms), bytes: loaded.bytes, warmMs: Math.round(warm.ms), shaderIterations: iterations, idle, during, busyMs: Math.round(busyMs), lines, gl: gl.getParameter(gl.VERSION) };
})().catch((e) => ({ error: String(e?.stack ?? e) }));
