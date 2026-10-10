// node bench.mjs <kernels.wasm> [label]
// Runs the conv and Snake micro-benchmarks in V8 (the engine Chrome uses), one thread.
import { readFileSync } from 'node:fs';

const [file, label = file] = process.argv.slice(2);
const { instance } = await WebAssembly.instantiate(readFileSync(file), { env: { now: () => performance.now() } });
const { bench, check_variant, bench_snake, check_snake } = instance.exports;

const CASES = [
  'gen resblock 32ch k11 d5',
  'gen resblock 32ch k3 d1',
  'gen resblock 64ch k7 d3',
  'decoder conv 514->256 k3',
  'ALBERT FFN 256->768',
];
const VARIANTS = { 1: 'port4x4', 10: 'simd4x4', 11: 'simd8x2', 12: 'simd4x2', 13: 'simd2x8', 14: 'simd8x4', 15: 'simd4x8', 16: 'simd8x1' };
console.log(`== ${label}`);
for (let c = 0; c < CASES.length; c++) {
  const cells = [];
  for (const [v, name] of Object.entries(VARIANTS)) {
    const err = check_variant(c, Number(v));
    const g = bench(c, Number(v), 5);
    cells.push(`${name} ${g.toFixed(1)}${err > 1e-3 ? ' ERR' + err : ''}`);
  }
  console.log(`${CASES[c].padEnd(26)} GFLOP/s: ${cells.join('  ')}`);
}
const { bench_skeleton, skeleton_stage } = instance.exports;
for (const [frames, line] of [[73, '25 chars'], [99, '37 chars'], [146, '51 chars'], [179, '71 chars']]) {
  const total = bench_skeleton(frames, 3);
  const st = [0, 1, 2].map((i) => skeleton_stage(i).toFixed(0));
  const audio = (frames * 600) / 24000;
  console.log(
    `skeleton ${line} (${frames} frames, ${audio.toFixed(2)} s): ${total.toFixed(0)} ms ` +
      `(decoder ${st[0]}, source ${st[1]}, generator ${st[2]}) = ${(total / audio).toFixed(0)} ms per audio second`,
  );
}
console.log(`snake: libm ${bench_snake(0, 5).toFixed(2)} ns/elem, simd poly ${bench_snake(1, 5).toFixed(2)} ns/elem, max err ${check_snake().toExponential(1)}`);
