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

    def acc(self, i):
        a = self.j['accessors'][i]
        bv = self.j['bufferViews'][a['bufferView']]
        buf = self.buffers[bv['buffer']]
        dt = CT[a['componentType']]
        n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride')
        isz = np.dtype(dt).itemsize
        if stride and stride != n * isz:
            out = np.zeros((a['count'], n), dt)
            for k in range(a['count']):
                out[k] = np.frombuffer(buf, dt, n, off + k * stride)
        else:
            out = np.frombuffer(buf, dt, a['count'] * n, off).reshape(a['count'], n)
        if a.get('normalized'):
            out = out.astype(np.float32) / np.iinfo(dt).max
        return out.copy()

    def node_by_name(self, name):
        for i, n in enumerate(self.j['nodes']):
            if n.get('name') == name:
                return i
        return None
