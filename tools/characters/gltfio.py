"""Minimal glTF/GLB reader (JSON + accessors as numpy arrays) for the character build."""
import json, struct, os
import numpy as np
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

class Gltf:
    def __init__(self, path):
        self.dir = os.path.dirname(path)
        if path.endswith('.glb'):
            data = open(path, 'rb').read()
            l = struct.unpack('<I', data[12:16])[0]
            self.j = json.loads(data[20:20 + l])
            off = 20 + l
            bl = struct.unpack('<I', data[off:off + 4])[0]
            self.buffers = [data[off + 8: off + 8 + bl]]
        else:
            self.j = json.load(open(path))
            self.buffers = [open(os.path.join(self.dir, b['uri']), 'rb').read() for b in self.j['buffers']]

    def view(self, bv_index, dt, count, n, offset=0):
        bv = self.j['bufferViews'][bv_index]
        buf = self.buffers[bv['buffer']]
        off = bv.get('byteOffset', 0) + offset
        stride = bv.get('byteStride')
        isz = np.dtype(dt).itemsize
        if stride and stride != n * isz:
            out = np.zeros((count, n), dt)
            for k in range(count):
                out[k] = np.frombuffer(buf, dt, n, off + k * stride)
            return out
        return np.frombuffer(buf, dt, count * n, off).reshape(count, n).copy()

    def acc(self, i):
        a = self.j['accessors'][i]
        dt = CT[a['componentType']]
        n = NC[a['type']]
        if 'bufferView' in a:
            out = self.view(a['bufferView'], dt, a['count'], n, a.get('byteOffset', 0))
        else:
            out = np.zeros((a['count'], n), dt)
        # Sparse accessors (morph targets): the listed elements replace the base (zeros if none).
        sp = a.get('sparse')
        if sp:
            si, sv = sp['indices'], sp['values']
            idx = self.view(si['bufferView'], CT[si['componentType']], sp['count'], 1, si.get('byteOffset', 0)).ravel()
            out[idx.astype(np.int64)] = self.view(sv['bufferView'], dt, sp['count'], n, sv.get('byteOffset', 0))
        if a.get('normalized'):
            out = out.astype(np.float32) / np.iinfo(dt).max
        return out

    def node_by_name(self, name):
        for i, n in enumerate(self.j['nodes']):
            if n.get('name') == name:
                return i
        return None
