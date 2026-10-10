/**
 * Reads NumPy `.npz` archives (a zip of `.npy` arrays) without dependencies, for KittenTTS's
 * `voices.npz` (used by `fetch.mjs`). Only what that file needs: stored or deflated entries,
 * little-endian float32 arrays in C order, no zip64.
 */

import { inflateRawSync } from 'node:zlib';

/** `{ name: { shape, data: Float32Array } }` for every `.npy` in the archive. */
export function readNpz(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('npz: no zip directory');
  const entries = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('npz: bad zip directory');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const skip = nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + skip;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    const npy = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!npy) throw new Error(`npz: ${name}: compression method ${method}`);
    out[name.replace(/\.npy$/, '')] = readNpy(npy, name);
  }
  return out;
}

function readNpy(b, name) {
  if (b.toString('latin1', 0, 6) !== '\x93NUMPY') throw new Error(`npz: ${name} is not .npy`);
  const major = b[6];
  const headerLength = major === 1 ? b.readUInt16LE(8) : b.readUInt32LE(8);
  const offset = (major === 1 ? 10 : 12) + headerLength;
  const header = b.toString('latin1', major === 1 ? 10 : 12, offset);
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  if (descr !== '<f4' || /'fortran_order':\s*True/.test(header)) throw new Error(`npz: ${name}: ${header.trim()}`);
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '')
    .split(',')
    .filter((s) => s.trim())
    .map(Number);
  const count = shape.reduce((a, n) => a * n, 1);
  const data = new Float32Array(b.buffer.slice(b.byteOffset + offset, b.byteOffset + offset + count * 4));
  return { shape, data };
}
