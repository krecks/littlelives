/**
 * The edits Idyll Lives makes to the voice model's ONNX graph, KittenTTS nano (used by `fetch.mjs`, which pins the upstream file and the edited result by SHA-256, so every
 * build gets byte-identical files):
 *
 * - a `pitch` input (float, [1]) that multiplies the predicted pitch curve (`/F0_proj/Conv`),
 *   so one voice can be made higher or lower per resident;
 * - deterministic noise: the graph's two random nodes (`RandomNormalLike` for the noise added to
 *   the harmonic source, `RandomUniformLike` for the harmonics' starting phases) are replaced by
 *   a counter-based hash of each element's position. ONNX Runtime's random kernels keep their
 *   state between runs even with a seed, so the same line would otherwise sound slightly
 *   different every time; with the hash, the same text and voice give bit-identical samples
 *   (the clip cache in `web/src/voice/service.svelte.ts` relies on it).
 *
 * The hash: h = (i·48271 + salt) mod P, then twice h = (h² + c) mod P, P = 2³¹ − 1, all in int64
 * (no overflow), u = (h + ½) / P. Normal noise uses Box–Muller on two such streams. Measured on
 * 1M values it is as white as a library generator (autocorrelation < 0.004, spectral flatness
 * 0.998). Only ops of the model's own opset (17) are used.
 * - weight-only int8 (`quantizeWeights`, KittenTTS): the large float weights of convolutions,
 *   matrix products and LSTMs are stored as int8 with one float scale per output channel and
 *   turned back into floats by `DequantizeLinear` nodes, so the file is a quarter of the size
 *   but the arithmetic stays float. (The upstream int8 builds use dynamic quantisation,
 *   `ConvInteger`/`MatMulInteger`, which runs slower than float in ONNX Runtime Web's WASM build;
 *   measured in docs/design/voices.md, "Research".)
 *
 * No dependencies: a minimal protobuf reader/writer splices nodes into the graph and copies
 * everything else byte for byte.
 */

// ---- protobuf wire format ---------------------------------------------------------------------

function readVarint(buf, pos) {
  let value = 0n;
  let shift = 0n;
  for (;;) {
    const b = buf[pos++];
    value |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return [value, pos];
    shift += 7n;
  }
}

/** Top-level fields of a message: `{ no, wire, data, raw }` (raw includes the tag). */
function parse(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    let key;
    [key, pos] = readVarint(buf, pos);
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    let data;
    if (wire === 0) {
      [data, pos] = readVarint(buf, pos);
    } else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      data = buf.subarray(pos, pos + n);
      pos += n;
    } else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      data = buf.subarray(pos, pos + Number(len));
      pos += Number(len);
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
    fields.push({ no, wire, data, raw: buf.subarray(start, pos) });
  }
  return fields;
}

function varint(v) {
  let x = BigInt.asUintN(64, BigInt(v));
  const bytes = [];
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x) b |= 0x80;
    bytes.push(b);
  } while (x);
  return Uint8Array.from(bytes);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const utf8 = (s) => new TextEncoder().encode(s);
const text = (b) => new TextDecoder().decode(b);
const tag = (no, wire) => varint((no << 3) | wire);
const bytesField = (no, bytes) => concat([tag(no, 2), varint(bytes.length), bytes]);
const stringField = (no, s) => bytesField(no, utf8(s));
const intField = (no, v) => concat([tag(no, 0), varint(v)]);
function floatField(no, f) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, f, true);
  return concat([tag(no, 5), b]);
}

// ---- ONNX messages (field numbers from onnx.proto) --------------------------------------------

const MODEL_GRAPH = 7;
const GRAPH = { node: 1, initializer: 5, input: 11 };
const NODE = { input: 1, output: 2, name: 3, opType: 4, attribute: 5 };
/** TensorProto fields. */
const TENSOR = { dims: 1, dataType: 2, name: 8, raw: 9 };
const FLOAT = 1;
const INT8 = 3;
const INT64 = 7;

/** `attrs`: `{ name: { int } | { float } }`. */
function node(opType, inputs, outputs, name, attrs = {}) {
  const parts = [...inputs.map((i) => stringField(NODE.input, i)), ...outputs.map((o) => stringField(NODE.output, o))];
  parts.push(stringField(NODE.name, name), stringField(NODE.opType, opType));
  for (const [attr, v] of Object.entries(attrs)) {
    // AttributeProto: name 1, f 2, i 3, type 20 (FLOAT 1, INT 2)
    const body = 'float' in v ? [stringField(1, attr), floatField(2, v.float), intField(20, 1)] : [stringField(1, attr), intField(3, v.int), intField(20, 2)];
    parts.push(bytesField(NODE.attribute, concat(body)));
  }
  return bytesField(GRAPH.node, concat(parts));
}

/** A scalar initializer (TensorProto: data_type 2, name 8, raw_data 9). */
function scalar(name, type, value) {
  const raw = new Uint8Array(type === INT64 ? 8 : 4);
  const view = new DataView(raw.buffer);
  if (type === INT64) view.setBigInt64(0, BigInt(value), true);
  else view.setFloat32(0, value, true);
  return bytesField(GRAPH.initializer, concat([intField(2, type), stringField(8, name), bytesField(9, raw)]));
}

/** A graph input `name`: float tensor of shape [1] (ValueInfoProto / TypeProto / TensorShapeProto). */
function floatInput(name) {
  const shape = bytesField(1, intField(1, 1)); // dim { dim_value: 1 }
  const tensor = concat([intField(1, FLOAT), bytesField(2, shape)]);
  return bytesField(GRAPH.input, concat([stringField(1, name), bytesField(2, bytesField(1, tensor))]));
}

function nodeInfo(data) {
  const info = { inputs: [], outputs: [], name: '', opType: '' };
  for (const f of parse(data)) {
    if (f.no === NODE.input) info.inputs.push(text(f.data));
    else if (f.no === NODE.output) info.outputs.push(text(f.data));
    else if (f.no === NODE.name) info.name = text(f.data);
    else if (f.no === NODE.opType) info.opType = text(f.data);
  }
  return info;
}

/** The node with its output `from` renamed to `to`. */
function renameOutput(data, from, to) {
  return bytesField(
    GRAPH.node,
    concat(parse(data).map((f) => (f.no === NODE.output && text(f.data) === from ? stringField(NODE.output, to) : f.raw))),
  );
}

/** An int attribute of a node (AttributeProto: name 1, i 3), or undefined. */
function intAttr(data, name) {
  for (const f of parse(data)) {
    if (f.no !== NODE.attribute) continue;
    const a = parse(f.data);
    if (a.some((x) => x.no === 1 && text(x.data) === name)) return Number(a.find((x) => x.no === 3)?.data ?? 0n);
  }
  return undefined;
}

// ---- the edits --------------------------------------------------------------------------------

const PITCH_NODE = '/F0_proj/Conv';
const P = 2147483647;
// Names of the added nodes; part of the pinned model, so it keeps the game's old name.
const K = '/littlelives/noise/';

/** Constants shared by the noise subgraphs. */
function noiseConstants() {
  return [
    scalar(`${K}zero`, INT64, 0),
    scalar(`${K}one`, INT64, 1),
    scalar(`${K}mult`, INT64, 48271),
    scalar(`${K}p`, INT64, P),
    scalar(`${K}c1`, INT64, 1013904223),
    scalar(`${K}c2`, INT64, 1664525),
    scalar(`${K}half`, FLOAT, 0.5),
    scalar(`${K}pf`, FLOAT, P),
    scalar(`${K}minus2`, FLOAT, -2),
    scalar(`${K}twopi`, FLOAT, 2 * Math.PI),
    ...[1, 2, 3].map((s) => scalar(`${K}salt${s}`, INT64, 1_000_003 * s * 7919)),
  ];
}

/** Uniform (0, 1) values, one per index in `idx` (int64), from stream `salt` (1..3). */
function uniformNodes(p, idx, salt) {
  const n = (op, inputs, out, attrs) => node(op, inputs, [`${p}${out}`], `${p}${out}`, attrs);
  return [
    n('Mul', [idx, `${K}mult`], 'a'),
    n('Add', [`${p}a`, `${K}salt${salt}`], 'b'),
    n('Mod', [`${p}b`, `${K}p`], 'h1'),
    n('Mul', [`${p}h1`, `${p}h1`], 'sq1'),
    n('Add', [`${p}sq1`, `${K}c1`], 'r1'),
    n('Mod', [`${p}r1`, `${K}p`], 'h2'),
    n('Mul', [`${p}h2`, `${p}h2`], 'sq2'),
    n('Add', [`${p}sq2`, `${K}c2`], 'r2'),
    n('Mod', [`${p}r2`, `${K}p`], 'h3'),
    n('Cast', [`${p}h3`], 'f', { to: { int: FLOAT } }),
    n('Add', [`${p}f`, `${K}half`], 'g'),
    n('Div', [`${p}g`, `${K}pf`], 'u'),
  ];
}

/** Nodes that compute `output` like `RandomNormalLike`/`RandomUniformLike(input)` (defaults), deterministically. */
function noiseNodes(kind, input, output) {
  const p = `${K}${kind}/`;
  const n = (op, inputs, out, attrs) => node(op, inputs, [`${p}${out}`], `${p}${out}`, attrs);
  const nodes = [
    n('Shape', [input], 'shape'),
    n('ReduceProd', [`${p}shape`], 'count', { keepdims: { int: 0 } }),
    n('Range', [`${K}zero`, `${p}count`, `${K}one`], 'index'),
  ];
  let flat;
  if (kind === 'uniform') {
    nodes.push(...uniformNodes(`${p}u/`, `${p}index`, 1));
    flat = `${p}u/u`;
  } else {
    nodes.push(...uniformNodes(`${p}u1/`, `${p}index`, 2), ...uniformNodes(`${p}u2/`, `${p}index`, 3));
    nodes.push(
      n('Log', [`${p}u1/u`], 'log'),
      n('Mul', [`${p}log`, `${K}minus2`], 'm2log'),
      n('Sqrt', [`${p}m2log`], 'radius'),
      n('Mul', [`${p}u2/u`, `${K}twopi`], 'angle'),
      n('Cos', [`${p}angle`], 'cos'),
      n('Mul', [`${p}radius`, `${p}cos`], 'z'),
    );
    flat = `${p}z`;
  }
  nodes.push(node('Reshape', [flat, `${p}shape`], [output], `${p}reshape`));
  return nodes;
}

/**
 * Applies the edits (pitch input, deterministic noise) to a model's bytes; returns the edited model.
 *
 * The pitch curve's producer is renamed and the scaled curve gets the old name, so every reader
 * gets it, nested graphs included (the decoder reads the curve inside an `If` subgraph).
 */
export function editModel(bytes) {
  const model = parse(bytes);
  const graphField = model.find((f) => f.no === MODEL_GRAPH);
  if (!graphField) throw new Error('model: no graph');
  const graph = parse(graphField.data);
  const nodes = graph.filter((f) => f.no === GRAPH.node).map((f) => ({ f, info: nodeInfo(f.data) }));
  const pitchNode = nodes.find((n) => n.info.name === PITCH_NODE);
  if (!pitchNode) throw new Error(`model: no ${PITCH_NODE}`);
  const f0 = pitchNode.info.outputs[0];
  const raw = `${f0}_unscaled`;
  const random = nodes.filter((n) => n.info.opType.startsWith('Random'));
  if (random.length !== 2) throw new Error(`model: expected 2 random nodes, found ${random.length}`);

  const out = [];
  for (const field of graph) {
    if (field.no !== GRAPH.node) {
      out.push(field.raw);
      continue;
    }
    const info = nodeInfo(field.data);
    if (info.opType === 'RandomNormalLike' || info.opType === 'RandomUniformLike') {
      out.push(...noiseNodes(info.opType === 'RandomNormalLike' ? 'normal' : 'uniform', info.inputs[0], info.outputs[0]));
    } else if (info.name === PITCH_NODE) {
      out.push(renameOutput(field.data, f0, raw), node('Mul', [raw, 'pitch'], [f0], '/pitch_scale'));
    } else {
      out.push(field.raw);
    }
  }
  out.push(...noiseConstants(), floatInput('pitch'));
  const newGraph = concat(out);
  return concat(model.map((f) => (f.no === MODEL_GRAPH ? bytesField(MODEL_GRAPH, newGraph) : f.raw)));
}

// ---- weight-only int8 -------------------------------------------------------------------------

/** Weights smaller than this stay float (biases, norms, small tables): not worth a scale per channel. */
const MIN_QUANTIZED = 4096;

/** Rounds half to even, like NumPy, so ties don't all go one way. */
function roundEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function tensorInfo(data) {
  const t = { dims: [], dataType: 0, name: '', raw: null };
  for (const f of parse(data)) {
    if (f.no === TENSOR.dims) {
      if (f.wire === 0) t.dims.push(Number(f.data));
      else {
        // packed
        for (let pos = 0; pos < f.data.length; ) {
          const [v, next] = readVarint(f.data, pos);
          t.dims.push(Number(v));
          pos = next;
        }
      }
    } else if (f.no === TENSOR.dataType) t.dataType = Number(f.data);
    else if (f.no === TENSOR.name) t.name = text(f.data);
    else if (f.no === TENSOR.raw) t.raw = f.data;
  }
  return t;
}

function tensor(name, type, dims, raw) {
  return bytesField(GRAPH.initializer, concat([...dims.map((d) => intField(TENSOR.dims, d)), intField(TENSOR.dataType, type), stringField(TENSOR.name, name), bytesField(TENSOR.raw, raw)]));
}

/**
 * Stores the large float weights of `Conv`, `ConvTranspose`, `MatMul`, `Gemm` and `LSTM` nodes as
 * int8 with a float scale per output channel (symmetric: scale = max |w| / 127), dequantised by
 * `DequantizeLinear` nodes placed first in the graph under the weight's own name, so nothing
 * else changes. Needs opset 13 or later (per-axis `DequantizeLinear`).
 */
export function quantizeWeights(bytes) {
  const model = parse(bytes);
  const graphField = model.find((f) => f.no === MODEL_GRAPH);
  if (!graphField) throw new Error('model: no graph');
  const graph = parse(graphField.data);
  // Which initializer each node uses as a weight, and along which axis its output channels run.
  const axes = new Map();
  const other = new Set();
  const inits = new Map(graph.filter((f) => f.no === GRAPH.initializer).map((f) => [tensorInfo(f.data).name, f]));
  for (const f of graph) {
    if (f.no !== GRAPH.node) continue;
    const info = nodeInfo(f.data);
    info.inputs.forEach((input, k) => {
      if (!inits.has(input)) return;
      let axis = null;
      if ((info.opType === 'Conv' || info.opType === 'ConvTranspose') && k === 1) axis = 0;
      else if (info.opType === 'MatMul' && k === 1) axis = 1;
      else if (info.opType === 'Gemm' && k === 1) axis = intAttr(f.data, 'transB') ? 0 : 1;
      else if (info.opType === 'LSTM' && (k === 1 || k === 2)) axis = 1;
      if (axis === null || (axes.has(input) && axes.get(input) !== axis)) other.add(input);
      else axes.set(input, axis);
    });
  }
  const dq = [];
  const replaced = new Map();
  for (const [name, axis] of axes) {
    if (other.has(name)) continue;
    const t = tensorInfo(inits.get(name).data);
    const count = t.dims.reduce((a, b) => a * b, 1);
    if (t.dataType !== FLOAT || !t.raw || count < MIN_QUANTIZED || t.dims.length < 2) continue;
    const w = new Float32Array(t.raw.buffer.slice(t.raw.byteOffset, t.raw.byteOffset + t.raw.byteLength));
    const channels = t.dims[axis];
    const inner = t.dims.slice(axis + 1).reduce((a, b) => a * b, 1);
    const channelOf = (i) => Math.floor(i / inner) % channels;
    const max = new Float64Array(channels);
    for (let i = 0; i < count; i++) max[channelOf(i)] = Math.max(max[channelOf(i)], Math.abs(w[i]));
    const scale = Float32Array.from(max, (m) => (m > 0 ? m / 127 : 1));
    const q = new Int8Array(count);
    for (let i = 0; i < count; i++) q[i] = Math.max(-127, Math.min(127, roundEven(w[i] / scale[channelOf(i)])));
    replaced.set(name, [
      tensor(`${name}_q8`, INT8, t.dims, new Uint8Array(q.buffer)),
      tensor(`${name}_s8`, FLOAT, [channels], new Uint8Array(scale.buffer)),
    ]);
    dq.push(node('DequantizeLinear', [`${name}_q8`, `${name}_s8`], [name], `${name}_dq`, { axis: { int: axis } }));
  }
  const out = [];
  let placed = false;
  for (const f of graph) {
    if (f.no === GRAPH.node && !placed) {
      out.push(...dq);
      placed = true;
    }
    if (f.no === GRAPH.initializer) {
      const r = replaced.get(tensorInfo(f.data).name);
      if (r) {
        out.push(...r);
        continue;
      }
    }
    out.push(f.raw);
  }
  const newGraph = concat(out);
  return concat(model.map((f) => (f.no === MODEL_GRAPH ? bytesField(MODEL_GRAPH, newGraph) : f.raw)));
}
