"""Mesh helpers for the character build: welding, normals, adjacency, scalar-field clipping, weights."""

import numpy as np
from scipy import sparse


def weld_ids(pos, tol=1e-5):
    """Index of the welded vertex for each vertex (vertices split at UV seams share one id)."""
    key = np.round(np.asarray(pos) / tol).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.ravel()


def smooth_normals(pos, idx, weld=None):
    """Area-weighted vertex normals, averaged across UV seams (CCW front faces)."""
    tri = np.asarray(idx).reshape(-1, 3)
    w = np.arange(len(pos)) if weld is None else weld
    fn = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
    acc = np.zeros((w.max() + 1, 3))
    for k in range(3):
        np.add.at(acc, w[tri[:, k]], fn)
    n = acc[w]
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def adjacency(idx, n):
    """Symmetric vertex adjacency (CSR, 1 per edge)."""
    tri = np.asarray(idx).reshape(-1, 3)
    a = np.concatenate([tri[:, 0], tri[:, 1], tri[:, 2]])
    b = np.concatenate([tri[:, 1], tri[:, 2], tri[:, 0]])
    m = sparse.coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n)).tocsr()
    m = m + m.T
    m.data[:] = 1
    return m


def boundary_edges(idx):
    """Directed edges used by exactly one triangle (in that triangle's winding)."""
    tri = np.asarray(idx).reshape(-1, 3)
    e = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    key = np.sort(e, 1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    return e[cnt[inv.ravel()] == 1]


def dense_weights(joints, weights, nb):
    out = np.zeros((len(joints), nb))
    for s in range(joints.shape[1]):
        np.add.at(out, (np.arange(len(joints)), joints[:, s]), weights[:, s])
    return out


def top4(dense):
    """Dense (n, bones) weights -> 4 joints / normalised weights."""
    j = np.argsort(-dense, 1)[:, :4]
    w = np.take_along_axis(dense, j, 1)
    w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
    return j.astype(np.int64), w


def geodesic_from(seeds, pos, idx, limit=1.0):
    """Approximate geodesic distance (along edges) from a set of seed vertices (Dijkstra)."""
    from scipy.sparse.csgraph import dijkstra
    tri = np.asarray(idx).reshape(-1, 3)
    a = np.concatenate([tri[:, 0], tri[:, 1], tri[:, 2]])
    b = np.concatenate([tri[:, 1], tri[:, 2], tri[:, 0]])
    d = np.linalg.norm(pos[a] - pos[b], axis=1)
    n = len(pos)
    g = sparse.coo_matrix((d, (a, b)), shape=(n, n)).tocsr()
    g = g.maximum(g.T)
    if len(seeds) == 0:
        return np.full(n, limit)
    dist = dijkstra(g, directed=False, indices=np.unique(seeds), min_only=True, limit=limit)
    return np.where(np.isfinite(dist), dist, limit)


def clip_by_field(part, g, dense):
    """
    Keeps the region g > 0 of a mesh, cutting triangles exactly along the iso-line g = 0 (linear
    interpolation), so cut edges are smooth however coarse the region boundaries are. New vertices on
    a shared edge are shared, so the result stays welded. `dense` is the (n, bones) weight matrix.
    Returns (pos, nor, uv, dense, idx, src) where src[i] = (a, b, t) source edge of each vertex.
    """
    pos, nor, uv = part['pos'], part['nor'], part['uv']
    tri = part['idx'].reshape(-1, 3)
    inside = g > 0
    keep = {}
    out_a, out_b, out_t = [], [], []

    def vert(a, b=None):
        if b is None:
            k = (a, a)
            t = 0.0
        else:
            k = (min(a, b), max(a, b))
            if k[0] != a:
                a, b = b, a
            t = g[a] / (g[a] - g[b])
        v = keep.get(k)
        if v is None:
            v = len(out_a)
            keep[k] = v
            out_a.append(a)
            out_b.append(a if b is None else b)
            out_t.append(t)
        return v

    faces = []
    for t in tri:
        s = inside[t]
        c = int(s.sum())
        if c == 0:
            continue
        if c == 3:
            faces.append([vert(t[0]), vert(t[1]), vert(t[2])])
            continue
        # Rotate so the pattern starts at a fixed corner (winding kept).
        if c == 1:
            r = int(np.argmax(s))
            a, b, cc = t[r], t[(r + 1) % 3], t[(r + 2) % 3]
            faces.append([vert(a), vert(a, b), vert(a, cc)])
        else:
            r = int(np.argmin(s))
            cc, a, b = t[r], t[(r + 1) % 3], t[(r + 2) % 3]
            faces.append([vert(a), vert(b), vert(b, cc)])
            faces.append([vert(a), vert(b, cc), vert(cc, a)])
    A = np.array(out_a)
    Bv = np.array(out_b)
    T = np.array(out_t)[:, None]
    lerp = lambda arr: arr[A] * (1 - T) + arr[Bv] * T
    n = lerp(nor)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    return dict(pos=lerp(pos), nor=n, uv=lerp(uv), dense=lerp(dense), idx=np.array(faces, np.int64).ravel(), src=(A, Bv, T[:, 0]))


def laplacian_relax(pos, idx, weld, iters, amount, fixed=None, constraint=None):
    """Umbrella smoothing in welded space; `constraint(p)` may project positions after each step."""
    nw = weld.max() + 1
    wp = np.zeros((nw, 3))
    cnt = np.zeros(nw)
    np.add.at(wp, weld, pos)
    np.add.at(cnt, weld, 1)
    wp /= cnt[:, None]
    tri = weld[np.asarray(idx).reshape(-1, 3)]
    adj = adjacency(tri.ravel(), nw)
    deg = np.asarray(adj.sum(1)).ravel()
    fw = None
    if fixed is not None:
        fw = np.zeros(nw, bool)
        fw[weld[fixed]] = True
    for _ in range(iters):
        avg = adj @ wp / np.maximum(deg, 1)[:, None]
        step = (avg - wp) * amount
        if fw is not None:
            step[fw] = 0
        wp = wp + step
        if constraint is not None:
            wp = constraint(wp)
    return wp[weld], wp
