"""
Face for the Sim characters (glTF space, before the Babylon mirror):

- `stylise`: a slightly bigger head and bigger eyes (friendlier, stylised-realistic proportions), applied to the
  body, eyes and brows in the bind pose (the skeleton and animations are unchanged);
- `face_rig`: extra bones under the head (eyes, upper / lower lids, jaw, lip corners, brows), their
  pivots and skin weights, found from facial landmarks (eyeballs, the mouth slit);
- `make_lids`: eyelid shells around each eyeball (the source faces have open sockets and no lids),
  skinned to the lid bones, so blinks and squints are bone rotations like everything else.

All geometry stays skinned on the GPU from the shared bone texture; the runtime only writes a few
more bone rotations.
"""

import numpy as np

from meshops import smooth_normals, weld_ids

FACE_BONES = ['eye_l', 'eye_r', 'lidU_l', 'lidU_r', 'lidL_l', 'lidL_r', 'jaw', 'lip_l', 'lip_r', 'brow_l', 'brow_r']
HEAD_SCALE = 0.075
EYE_SCALE = 1.13
# Lid margins in the bind pose (elevation above the eye's horizontal plane, degrees). The runtime
# rotates the lids about the eye centre from here (see `rig.json` `face`).
UPPER_OPEN = 21.0
LOWER_OPEN = -38.0
LID_AZIMUTH = 62.0


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def eye_centres(eyes_pos):
    out = {}
    for side, sgn in (('l', 1), ('r', -1)):
        p = eyes_pos[eyes_pos[:, 0] * sgn > 0]
        c = (p.min(0) + p.max(0)) / 2
        out[side] = (c, float(((p.max(0) - p.min(0)) / 2).mean()))
    return out


def stylise(body, eyes, brows, H, head_w):
    """Bigger head (scaled about the head joint, faded across the neck) and bigger eyes."""
    s = 1 + HEAD_SCALE * head_w
    body['pos'] = H + (body['pos'] - H) * s[:, None]
    for part in (eyes, brows):
        part['pos'] = H + (part['pos'] - H) * (1 + HEAD_SCALE)
    centres = eye_centres(eyes['pos'])
    # Eyes: eyeballs scaled about their centres; the sockets (and brows) warped radially to match.
    warp_any = np.zeros(len(body['pos']), bool)
    for side, (c, r) in centres.items():
        sgn = 1 if side == 'l' else -1
        sel = eyes['pos'][:, 0] * sgn > 0
        eyes['pos'][sel] = c + (eyes['pos'][sel] - c) * EYE_SCALE
    for part in (body, brows):
        disp = np.zeros_like(part['pos'])
        for side, (c, r) in centres.items():
            d = np.linalg.norm(part['pos'] - c, axis=1)
            f = 1 - smoothstep(1.15 * r, 2.4 * r, d)
            disp += (part['pos'] - c) * (EYE_SCALE - 1) * f[:, None]
            if part is body:
                warp_any |= f > 0
        part['pos'] = part['pos'] + disp
    weld = weld_ids(body['pos'])
    n = smooth_normals(body['pos'], body['idx'], weld)
    body['nor'] = np.where(warp_any[:, None], n, body['nor'])
    return {k: (c, r * EYE_SCALE) for k, (c, r) in eye_centres(eyes['pos']).items()}


def find_mouth(body, eyes):
    """Mouth slit landmarks: line height, corners, front and back depth (glTF space)."""
    pos, nor = body['pos'], body['nor']
    cl, rl = eyes['l']
    ey, ex, ez = cl[1], cl[0], cl[2]
    box = (np.abs(pos[:, 0]) < ex * 1.35) & (pos[:, 1] < ey - 0.035) & (pos[:, 1] > ey - 0.16) & (pos[:, 2] > ez - 0.02)
    mid = box & (np.abs(pos[:, 0]) < 0.01)
    up = np.where(mid & (nor[:, 1] > 0.5))[0]
    dn = np.where(mid & (nor[:, 1] < -0.5))[0]
    # The slit: an upward-facing (lower lip, inside) and a downward-facing (upper lip, inside)
    # surface a few millimetres apart, behind the lips' front.
    best = None
    for i in up:
        for j in dn:
            dy = pos[j, 1] - pos[i, 1]
            if -0.001 < dy < 0.005 and abs(pos[i, 2] - pos[j, 2]) < 0.012:
                key = pos[i, 2] + pos[j, 2]
                if best is None or key > best[0]:
                    best = (key, (pos[i, 1] + pos[j, 1]) / 2)
    assert best is not None, 'mouth slit not found'
    ym = best[1]
    slit = box & (np.abs(pos[:, 1] - ym) < 0.007) & (np.abs(nor[:, 1]) > 0.4)
    front = float(pos[box & (np.abs(pos[:, 1] - ym) < 0.012) & (np.abs(pos[:, 0]) < 0.01), 2].max())
    back = float(pos[slit, 2].min())
    corners = {}
    for side, sgn in (('l', 1), ('r', -1)):
        cand = np.where(slit & (pos[:, 0] * sgn > 0))[0]
        k = cand[np.argmax(np.abs(pos[cand, 0]))]
        corners[side] = pos[k].copy()
    return dict(y=ym, front=front, back=back, corners=corners)


def face_rig(body, eyes_part, brows_part, eyes, H, head_index, bone_index, nb):
    """
    Pivots of the face bones and skin weights (dense (n, nb) matrices, returned per part).
    `bone_index` maps face bone names to indices (appended after the clip skeleton's bones).
    """
    from meshops import dense_weights
    mouth = find_mouth(body, eyes)
    cl, r_eye = eyes['l']
    pos, nor = body['pos'], body['nor']
    dense = dense_weights(body['joints'], body['weights'], nb)
    hw = dense[:, head_index].copy()
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
    ax = np.abs(x)
    ym, xc = mouth['y'], abs(mouth['corners']['l'][0])
    # Jaw: everything below the mouth line in front of the jaw hinge, the line rising behind the
    # mouth corners towards the hinge below the ears.
    hinge = np.array([0.0, ym + 0.032, H[2] + 0.012])
    yb = ym + 0.03 * smoothstep(xc, xc + 0.035, ax) + 0.012 * smoothstep(mouth['back'], mouth['back'] - 0.05, z)
    jaw = smoothstep(yb + 0.006, yb - 0.014, y) * smoothstep(hinge[2] - 0.01, hinge[2] + 0.03, z)
    lips = (ax < xc + 0.005) & (np.abs(y - ym) < 0.014) & (z > mouth['back'] - 0.004)
    inner = lips & (np.abs(nor[:, 1]) > 0.4) & (z < mouth['front'] - 0.004) & (np.abs(y - ym) < 0.0055)
    jaw = np.where(lips, smoothstep(ym + 0.0015, ym - 0.0015, y), jaw)
    jaw = np.where(inner, (nor[:, 1] > 0).astype(float), jaw)
    # Lip corners (smile / frown): a soft region around each corner.
    lip = {}
    for side, sgn in (('l', 1), ('r', -1)):
        c = mouth['corners'][side]
        d = np.linalg.norm(pos - c, axis=1)
        lip[side] = 0.95 * np.exp(-(d / 0.0125) ** 2) * (x * sgn > 0.002) * (z > c[2] - 0.03)
    # Brows: the brow meshes ride on the brow bones; the forehead skin follows softly.
    bp = brows_part['pos']
    brow_c = {}
    brow = {}
    for side, sgn in (('l', 1), ('r', -1)):
        p = bp[bp[:, 0] * sgn > 0]
        brow_c[side] = p.mean(0)
        d = np.linalg.norm(pos - brow_c[side], axis=1)
        brow[side] = 0.65 * np.exp(-(d / 0.024) ** 2) * (x * sgn > -0.004) * (y > eyes[side][0][1] + r_eye * 0.95)
    face = lip['l'] + lip['r'] + brow['l'] + brow['r']
    face = np.minimum(face, 0.95)
    rem = hw * (1 - face)
    dense[:, head_index] = rem * (1 - jaw)
    dense[:, bone_index['jaw']] = rem * jaw
    for side in ('l', 'r'):
        dense[:, bone_index[f'lip_{side}']] = hw * lip[side]
        dense[:, bone_index[f'brow_{side}']] = hw * brow[side]
    # Paint-mask of the mouth's inside (darkened in the albedo): the inner slit faces.
    mouth['inner'] = inner

    def single(part, name_of):
        d = np.zeros((len(part['pos']), nb))
        for k, p in enumerate(part['pos']):
            d[k, bone_index[name_of(p)]] = 1
        return d

    eyes_dense = single(eyes_part, lambda p: 'eye_l' if p[0] > 0 else 'eye_r')
    brows_dense = single(brows_part, lambda p: 'brow_l' if p[0] > 0 else 'brow_r')
    pivots = {
        'eye_l': eyes['l'][0], 'eye_r': eyes['r'][0],
        'lidU_l': eyes['l'][0], 'lidU_r': eyes['r'][0], 'lidL_l': eyes['l'][0], 'lidL_r': eyes['r'][0],
        'jaw': hinge,
        'lip_l': mouth['corners']['l'] + [0, 0, -0.045], 'lip_r': mouth['corners']['r'] + [0, 0, -0.045],
        'brow_l': brow_c['l'] + [0, 0, -0.05], 'brow_r': brow_c['r'] + [0, 0, -0.05],
    }
    return dict(body=dense, eyes=eyes_dense, brows=brows_dense, pivots=pivots, mouth=mouth)


def make_lids(body, eyes, bone_index, nb):
    """
    Upper and lower eyelid shells per eye: spherical bands just outside the eyeball, kept under the
    socket skin (so they never poke through when they rotate), with a rolled margin. UV: u across,
    v = 0 at the margin (lash line) to 1 at the far edge (the lid material shades from it).
    """
    pos = body['pos']
    parts = []
    for side in ('l', 'r'):
        c, r = eyes[side]
        near = pos[np.linalg.norm(pos - c, axis=1) < 3.2 * r]
        dv = near - c
        dr = np.linalg.norm(dv, axis=1)
        du = dv / dr[:, None]
        for upper in (True, False):
            nphi, npsi = 15, 7
            phis = np.radians(np.linspace(-LID_AZIMUTH, LID_AZIMUTH, nphi))
            if upper:
                psis = np.radians(np.linspace(UPPER_OPEN, 74, npsi))
                sweep = np.radians(np.linspace(0, UPPER_OPEN + 28, 9))  # closes downwards
            else:
                psis = np.radians(np.linspace(LOWER_OPEN, -74, npsi))
                sweep = -np.radians(np.linspace(0, 30, 7))  # rises upwards
            R0 = r + 0.0012
            verts, uvs, norms = [], [], []
            for j, ps in enumerate(psis):
                for i, ph in enumerate(phis):
                    u = np.array([np.sin(ph) * np.cos(ps), np.sin(ps), np.cos(ph) * np.cos(ps)])
                    # Keep inside the skin along the whole sweep (rotation about x, closing).
                    rad = R0
                    for a in sweep:
                        ca, sa = np.cos(-a), np.sin(-a)
                        uu = np.array([u[0], u[1] * ca - u[2] * sa, u[1] * sa + u[2] * ca])
                        cosang = du @ uu
                        m = cosang > np.cos(np.radians(11))
                        if m.any():
                            rad = min(rad, dr[m].min() - 0.0007)
                    rad = max(rad, r + 0.0004)
                    verts.append(c + u * rad)
                    norms.append(u)
                    uvs.append([i / (nphi - 1), 0.1 + 0.9 * j / (npsi - 1)])
            # Rolled margin: a ring tucked onto the eyeball just past the edge.
            for i, ph in enumerate(phis):
                ps = psis[0] - np.radians(2.5 if upper else -2.5)
                u = np.array([np.sin(ph) * np.cos(ps), np.sin(ps), np.cos(ph) * np.cos(ps)])
                verts.append(c + u * (r + 0.0003))
                down = np.array([0, -1.0 if upper else 1.0, 0])
                norms.append((u + down) / np.linalg.norm(u + down))
                uvs.append([i / (nphi - 1), 0.0])
            V = np.array(verts)
            idx = []
            grid = lambda j, i: j * nphi + i
            rows = [npsi] + list(range(npsi))  # margin ring first
            ring = lambda k, i: (npsi * nphi + i) if rows[k] == npsi else grid(rows[k], i)
            for k in range(len(rows) - 1):
                for i in range(nphi - 1):
                    a, b, cc, d = ring(k, i), ring(k, i + 1), ring(k + 1, i + 1), ring(k + 1, i)
                    # Outward-facing (CCW seen from outside); the lower lid's rows run downwards.
                    if upper:
                        idx += [a, b, cc, a, cc, d]
                    else:
                        idx += [a, d, cc, a, cc, b]
            bone = bone_index[f'lid{"U" if upper else "L"}_{side}']
            dense = np.zeros((len(V), nb))
            dense[:, bone] = 1
            parts.append(dict(pos=V, nor=np.array(norms), uv=np.array(uvs), idx=np.array(idx), dense=dense))
    # Merge.
    out = dict(pos=[], nor=[], uv=[], idx=[], dense=[])
    base = 0
    for p in parts:
        for k in ('pos', 'nor', 'uv', 'dense'):
            out[k].append(p[k])
        out['idx'].append(p['idx'] + base)
        base += len(p['pos'])
    return {k: np.concatenate(v) for k, v in out.items()}
