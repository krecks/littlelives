"""
Clothes as real geometry, generated from the body (glTF space, bind pose):

- per-vertex *fields* on the body (`fields`): sleeve parameter (-1 torso, 0 shoulder .. 1 wrist),
  height, and two neckline distances (crew / scoop). A garment covers the body where all of its
  predicates hold, e.g. a T-shirt: sleeve < 0.32, height > hem, crew > 0;
- *shells*: the covered region cut exactly along the iso-lines of those (linearly interpolated)
  fields, so hems are clean curves, offset outward along the smoothed normals, relaxed so cloth
  bridges the body's hollows (under the bust, the spine, between the shoulder blades), and closed with
  a rolled hem rim that turns back onto the skin;
- a lofted A-line *skirt* (not a body copy: it hangs from the hips and swings with the thighs);
- shoes: a shell over the feet with a thicker welt / sole band.

The shells keep the body's skin weights (interpolated at cut points), so they deform exactly with
it; the runtime discards body skin well inside a garment using the same fields, so skin can never
poke through. Garment vertices carry (hem distance, part flag, category, 0) in `fields`.
"""

import numpy as np

from meshops import adjacency, boundary_edges, clip_by_field, geodesic_from, laplacian_relax, smooth_normals, top4, weld_ids

# Categories (fields.z of garment vertices; the runtime colours them with the top / bottom / shoe colour).
TOP, BOTTOM, SHOES = 0, 1, 2
# Part flags (fields.y): 1 = sole / welt, 2 = waistband, 3 = skirt.
FLAG_SOLE, FLAG_BAND, FLAG_SKIRT = 1, 2, 3
# Sleeve parameter is scaled to metres in the predicates (approximate arm length).
ARM_M = 0.55


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class Landmarks:
    def __init__(self, P, gender):
        self.gender = gender
        self.pelvis = P['pelvis'][1]
        self.neck = P['neck_01']
        self.hip, self.knee, self.ankle = P['thigh_l'][1], P['calf_l'][1], P['foot_l'][1]
        self.hem = self.pelvis + (0.02 if gender == 'male' else 0.045)
        self.waist = self.pelvis + (0.075 if gender == 'male' else 0.09)
        self.sh = np.abs(P['upperarm_l']) * [1, 0, 0] + P['upperarm_l'] * [0, 1, 1]
        self.el = np.abs(P['lowerarm_l']) * [1, 0, 0] + P['lowerarm_l'] * [0, 1, 1]
        self.wr = np.abs(P['hand_l']) * [1, 0, 0] + P['hand_l'] * [0, 1, 1]
        self.pelvis_z = P['pelvis'][2]


def body_fields(body, lm, arm_w):
    """(n, 4): sleeve, height, crew neck, scoop neck (metres except sleeve)."""
    pos = body['pos']
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
    axis = lm.wr - lm.sh
    L = np.linalg.norm(axis)
    axis = axis / L
    pa = np.stack([np.abs(x), y, z], -1)
    ta = ((pa - lm.sh) @ axis) / L
    sleeve = arm_w * ta + (1 - arm_w) * -1.0
    neck = lm.neck
    front = np.clip((z - neck[2]) / 0.06, 0, 1)
    rho = np.hypot(x - neck[0], (z - neck[2]) * 0.85)
    male = lm.gender == 'male'

    def neckline(collar, drop, deep):
        # Open where (inside the collar and above the neckline) or high on the neck; N > 0 = covered.
        C = collar + 0.03 * front
        Y0 = neck[1] - 0.035 - deep * front * np.clip(1 - (x / collar) ** 2, 0, 1) - drop
        open_ = np.maximum(np.minimum(C - rho, y - Y0), y - (neck[1] + 0.03))
        return -open_

    crew = neckline(0.088 if male else 0.092, 0.0, 0.035 if male else 0.045)
    scoop = neckline(0.1 if male else 0.11, 0.01, 0.075 if male else 0.1)
    return np.stack([sleeve, y, crew, scoop], -1)


# Garment variants: cuts (None = predicate off). The runtime reads these from rig.json to discard
# the body under each Sim's clothes.
def variants(lm, gender):
    hem = lm.hem
    thigh = lm.hip - lm.knee
    shin = lm.knee - lm.ankle
    tops = {
        'tee': dict(sleeve=0.3, hem=hem, crew=0.0),
        'long': dict(sleeve=0.955, hem=hem, crew=0.0),
    }
    if gender == 'female':
        tops['tank'] = dict(sleeve=-0.55, hem=hem, scoop=0.0)
        tops['blouse'] = dict(sleeve=0.58, hem=hem, scoop=0.0)
    else:
        tops['vneck'] = dict(sleeve=0.3, hem=hem, scoop=0.0)
        tops['polo'] = dict(sleeve=0.42, hem=hem - 0.02, crew=0.0)
    bottoms = {
        'trousers': dict(waist=lm.waist, leg=lm.ankle + 0.03),
        'shorts': dict(waist=lm.waist, leg=lm.knee + 0.45 * thigh),
    }
    if gender == 'female':
        bottoms['capri'] = dict(waist=lm.waist, leg=lm.knee - 0.45 * shin)
        bottoms['skirt'] = dict(waist=lm.waist, leg=lm.hip - 0.07, skirt=True)
    shoes = {
        'sneakers': dict(shoe=lm.ankle + 0.03),
        'boots': dict(shoe=lm.ankle + 0.13),
    }
    return {'top': tops, 'bottom': bottoms, 'shoes': shoes}


def coverage(f, cut, kind):
    """Signed coverage (metres, > 0 = covered) of a garment variant over body fields `f`."""
    sleeve, y, crew, scoop = f[:, 0], f[:, 1], f[:, 2], f[:, 3]
    if kind == 'top':
        g = np.minimum((cut['sleeve'] - sleeve) * ARM_M, y - cut['hem'])
        if 'crew' in cut:
            g = np.minimum(g, crew - cut['crew'])
        if 'scoop' in cut:
            g = np.minimum(g, scoop - cut['scoop'])
        return g
    if kind == 'bottom':
        return np.minimum(np.minimum(cut['waist'] - y, y - cut['leg']), (-0.5 - sleeve) * ARM_M)
    return cut['shoe'] - y


def offsets(kind, name, cut, f, lm):
    """Cloth thickness / looseness (m) per body vertex."""
    sleeve, y = f[:, 0], f[:, 1]
    if kind == 'top':
        d = np.full(len(f), 0.0065)
        # Looser over the belly and where it overlaps the waistband; sleeves flare a little.
        d += 0.004 * smoothstep(lm.waist + 0.15, lm.waist, y) * (sleeve < 0)
        d = np.where(y < lm.waist + 0.02, np.maximum(d, 0.019), d)
        s = np.clip(sleeve, 0, None)
        if cut['sleeve'] < 0.7:
            d += 0.009 * np.clip(s / max(cut['sleeve'], 0.1), 0, 1)
        else:
            d += 0.003 * smoothstep(0.75, 0.95, s)
        return d
    if kind == 'bottom':
        d = np.full(len(f), 0.0075)
        if name == 'trousers':
            d += 0.014 * smoothstep(lm.knee + 0.12, lm.ankle + 0.03, y)
        elif name == 'shorts':
            d += 0.012 * smoothstep(lm.hip - 0.02, cut['leg'], y)
        elif name == 'capri':
            d += 0.008 * smoothstep(lm.knee + 0.1, cut['leg'], y)
        return d
    d = np.full(len(f), 0.0045)
    d += 0.0045 * (y < 0.022)
    return d


def shell(body, dense, f, kind, name, cut, lm):
    """Offset shell over the region a variant covers, with a rolled hem rim."""
    g = coverage(f, cut, kind)
    d = offsets(kind, name, cut, f, lm)
    part = dict(body)
    part['nor'] = smooth_normals(body['pos'], body['idx'], weld_ids(body['pos']))
    ext = np.c_[part['pos'], part['nor'], d]
    part2 = dict(part, pos=ext[:, :3], nor=ext[:, 3:6])
    cl = clip_by_field(part2, g, dense)
    A, Bv, T = cl['src']
    base = cl['pos']
    nrm = cl['nor']
    dd = d[A] * (1 - T) + d[Bv] * T
    weld = weld_ids(base)
    # Hem lines: the iso-line of a non-linear field zigzags across coarse triangles; straighten each
    # boundary loop (1D smoothing along the loop, on the skin before the offset).
    tri_w = weld[cl['idx'].reshape(-1, 3)]
    be0 = boundary_edges(tri_w.ravel())
    nw0 = weld.max() + 1
    wpos = np.zeros((nw0, 3)); c0 = np.zeros(nw0)
    np.add.at(wpos, weld, base); np.add.at(c0, weld, 1)
    wpos /= c0[:, None]
    nbr = {}
    for a, b in be0:
        nbr.setdefault(a, []).append(b)
        nbr.setdefault(b, []).append(a)
    bv = np.array([k for k, v in nbr.items() if len(v) == 2], np.int64)
    if len(bv):
        n1 = np.array([nbr[k][0] for k in bv]); n2 = np.array([nbr[k][1] for k in bv])
        for _ in range(12):
            wpos[bv] += 0.5 * ((wpos[n1] + wpos[n2]) / 2 - wpos[bv])
    base = wpos[weld]
    pos = base + nrm * dd[:, None]
    hem_fixed = np.where(np.isin(weld, bv))[0] if len(bv) else None
    # Relax (bridges hollows), never closer to the skin than 85% of the offset nor farther than +3 cm.
    nw = weld.max() + 1
    wb = np.zeros((nw, 3)); wn = np.zeros((nw, 3)); wd = np.zeros(nw); cnt = np.zeros(nw)
    np.add.at(wb, weld, base); np.add.at(wn, weld, nrm); np.add.at(wd, weld, dd); np.add.at(cnt, weld, 1)
    wb /= cnt[:, None]; wd /= cnt
    wn /= np.maximum(np.linalg.norm(wn, axis=1, keepdims=True), 1e-9)

    # Bottoms stay snug where the top overlaps them (else they bulge through it in hollows).
    wy = wb[:, 1]
    slack = np.full(nw, 0.035)
    if kind == 'bottom':
        slack = np.where(wy > lm.hem - 0.03, 0.006, slack)

    def constrain(p):
        off = ((p - wb) * wn).sum(1)
        lo, hi = wd * 0.8, wd + slack
        return p + wn * (np.clip(off, lo, hi) - off)[:, None]

    if kind != 'shoes':
        # Cloth drapes over the muscles instead of shrink-wrapping them.
        pos, _ = laplacian_relax(pos, cl['idx'], weld, 30, 0.55, fixed=hem_fixed, constraint=constrain)
    nor = smooth_normals(pos, cl['idx'], weld)
    uv = cl['uv']
    dn = cl['dense']
    idx = cl['idx']
    # Rim: each boundary edge gets a quad back down to the skin (the hem's thickness).
    be = boundary_edges(weld[idx.reshape(-1, 3)].ravel())
    rep = {}
    for k, w in enumerate(weld):
        rep.setdefault(w, k)
    rim_of = {}
    rp, rn, ru, rd = [], [], [], []
    n0 = len(pos)

    def rim(w):
        v = rim_of.get(w)
        if v is None:
            k = rep[w]
            v = n0 + len(rp)
            rim_of[w] = v
            rp.append(wb[w] + wn[w] * 0.0012)
            rn.append(-nrm[k] * 0 + (nor[k]))
            ru.append(uv[k])
            rd.append(dn[k])
        return v

    faces = list(idx)
    for a, b in be:
        ka, kb = rep[a], rep[b]
        ra, rb = rim(a), rim(b)
        faces += [kb, ka, ra, kb, ra, rb]
    if rp:
        pos = np.concatenate([pos, np.array(rp)])
        nor = np.concatenate([nor, np.array(rn)])
        uv = np.concatenate([uv, np.array(ru)])
        dn = np.concatenate([dn, np.array(rd)])
    idx = np.array(faces, np.int64)
    # Hem distance (for stitching / hem shading) from the boundary.
    seeds = np.array([rep[a] for a, _ in be] + list(range(n0, len(pos))), np.int64)
    hem = geodesic_from(seeds, pos, idx, 0.08)
    flag = np.zeros(len(pos))
    if kind == 'shoes':
        flag[:] = (np.concatenate([base[:, 1], np.array(rp)[:, 1] if rp else np.zeros(0)]) < 0.024) * FLAG_SOLE
    if kind == 'bottom':
        yy = np.concatenate([base[:, 1], np.array(rp)[:, 1] if rp else np.zeros(0)])
        flag[:] = (yy > cut['waist'] - 0.035) * FLAG_BAND
    cat = {'top': TOP, 'bottom': BOTTOM, 'shoes': SHOES}[kind]
    fields = np.stack([hem, flag, np.full(len(pos), cat), np.zeros(len(pos))], -1)
    j, w = top4(dn)
    return dict(pos=pos, nor=nor, uv=uv, joints=j, weights=w, idx=idx, fields=fields)


def skirt(body, P, lm, B, nb):
    """A-line skirt lofted from the waist to just above the knee, enclosing both legs."""
    pos = body['pos']
    cz = lm.pelvis_z
    y0 = lm.waist + 0.004
    y1 = lm.knee + 0.07
    na, nr = 44, 12
    ang = np.linspace(0, 2 * np.pi, na, endpoint=False)
    ys = np.linspace(y0, y1, nr)
    rx = pos[:, 0]
    rz = pos[:, 2] - cz
    va = np.arctan2(rx, rz) % (2 * np.pi)
    vr = np.hypot(rx, rz)
    R = np.zeros((nr, na))
    for k, yy in enumerate(ys):
        band = np.abs(pos[:, 1] - yy) < 0.025
        for i, a in enumerate(ang):
            da = np.abs((va - a + np.pi) % (2 * np.pi) - np.pi)
            m = band & (da < np.radians(9)) & (vr < 0.3)
            R[k, i] = vr[m].max() if m.any() else 0.1
    # Smooth around and enforce a widening A-line with ease.
    for _ in range(3):
        R = (np.roll(R, 1, 1) + 2 * R + np.roll(R, -1, 1)) / 4
    ease = np.linspace(0.007, 0.02, nr)[:, None]
    R = R + ease
    for k in range(1, nr):
        R[k] = np.maximum(R[k], R[k - 1] + 0.0025)
    verts, uvs, dense, hem = [], [], [], []
    for k, yy in enumerate(ys):
        t = k / (nr - 1)
        for i in range(na + 1):
            a = ang[i % na]
            r = R[k, i % na]
            verts.append([np.sin(a) * r, yy - 0.012 * t * t, cz + np.cos(a) * r])
            uvs.append([i / na, t])
            dw = np.zeros(nb)
            tw = smoothstep(0.15, 1.0, t) * 0.8
            s = np.clip(0.5 + np.sin(a) * r / 0.16, 0, 1)
            dw[B['thigh_l']] = tw * s
            dw[B['thigh_r']] = tw * (1 - s)
            dw[B['pelvis']] = 1 - tw
            dense.append(dw)
            hem.append((1 - t) * (y0 - y1))
    idx = []
    row = na + 1
    for k in range(nr - 1):
        for i in range(na):
            a, b, c, d = k * row + i, k * row + i + 1, (k + 1) * row + i + 1, (k + 1) * row + i
            # Outward facing (CCW from outside): rows go downwards, angle increases towards +x.
            idx += [a, d, c, a, c, b]
    V = np.array(verts)
    idx = np.array(idx, np.int64)
    nor = smooth_normals(V, idx, weld_ids(V))
    j, w = top4(np.array(dense))
    n = len(V)
    fields = np.stack([np.array(hem), np.full(n, FLAG_SKIRT), np.full(n, BOTTOM), np.zeros(n)], -1)
    return dict(pos=V, nor=nor, uv=np.array(uvs), joints=j, weights=w, idx=idx, fields=fields)
