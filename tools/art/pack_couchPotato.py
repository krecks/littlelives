# Couch Potato pack models (web/public/assets/packs/couchPotato/manifest.json). Conventions: see
# pack_foodie.py. Seated items put their seat on the footprint centre line (characters.ts DEFAULT_SEAT:
# seat top 0.45 m, facing +Z); screens the Sim watches stand at the front edge facing -Z (toward it).
# Run: python3 -I pack_couchPotato.py [out.json] && python3 -I apply_pack.py couchPotato out.json
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, gltf, placeholder,  # noqa: E402
                       OAK, OAKD, HONEY, BRASS, CHROME, TEAL, MUSTARD, SAGE, RUST, CREAM)
from pack_foodie import run  # noqa: E402

LIB = '../../models/'
E, FOOT = {}, {}
CORD = '#8C6A4E'          # couch-potato corduroy brown
PLUSH = '#C08A52'
FRAME = '#5C6168'         # graphite (not black)
BACK = '#C9CBCC'          # screen backs facing the room
GLOW = '#3BA3E0'          # lit screen


def screen_on_posts(x0, x1, z, y0, y1, label=TEAL):
    """A screen held between two slim posts at the front edge, facing -Z (the seats)."""
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    p = [box([w, h, 0.05], [cx, cy, z], OAK, 'wood', radius=0.015),                           # oak acoustic back
         box([w - 0.03, h - 0.03, 0.004], [cx, cy, z - 0.027], '#1B2A3A', 'gloss', radius=0.006),
         box([w * 0.82, h * 0.7, 0.002], [cx, cy + h * 0.04, z - 0.0295], GLOW, 'gloss', radius=0.004),
         box([w * 0.3, h * 0.12, 0.002], [cx - w * 0.2, cy - h * 0.28, z - 0.031], MUSTARD, 'gloss', radius=0.003),
         box([w * 0.5, 0.02, 0.006], [cx, y0 + 0.06, z + 0.027], label, 'satin', radius=0.003)]  # stripe on the back
    n = max(3, int(w / 0.09))
    for i in range(1, n):
        p.append(box([0.012, h - 0.04, 0.006], [x0 + w * i / n, cy, z + 0.026], OAKD, 'wood', radius=0.002))  # slat grooves
    for x in (x0 + 0.02, x1 - 0.02):
        p += [box([0.04, y1 + 0.02, 0.04], [x, (y1 + 0.02) / 2, z + 0.01], FRAME, 'metal', radius=0.008),
              box([0.08, 0.02, 0.12], [x, 0.01, z - 0.04], FRAME, 'metal', radius=0.008)]
    return p


def recliner_seat(x, w=0.74, color=CORD, arm=True, foot=False):
    """A plush recliner seat centred on (x, z=0): seat top 0.45, reclined back, rounded arms."""
    p = [cushion([w, 0.3, 0.62], [x, 0.17, -0.06], color, radius=0.06),                         # base
         cushion([w - 0.16, 0.12, 0.56], [x, 0.39, -0.02], color, radius=0.05),                # seat cushion (top 0.45)
         cushion([w, 0.62, 0.18], [x, 0.62, -0.29], color, rotate=[-14, 0, 0], radius=0.07),    # back
         cushion([w - 0.16, 0.36, 0.12], [x, 0.66, -0.19], color, rotate=[-14, 0, 0], radius=0.05)]  # pillow back
    if arm:
        for s in (-1, 1):
            p.append(cushion([0.1, 0.3, 0.62], [x + s * (w / 2 - 0.05), 0.47, -0.06], color, radius=0.045))
    if foot:
        p += [cushion([w - 0.16, 0.1, 0.28], [x, 0.36, 0.29], color, rotate=[12, 0, 0], radius=0.04)]
    return p


# ---- cinemaWall (2x1, 2 seats): twin recliners with a cup console, big screen at the front edge -
def cinema_wall():
    p = recliner_seat(-0.5, 0.78, '#7A2E2E') + recliner_seat(0.5, 0.78, '#7A2E2E')
    p += [box([0.2, 0.5, 0.6], [0, 0.25, -0.06], FRAME, 'satin', radius=0.03),                   # centre console
          cyl([0.08, 0.02, 0.08], [0, 0.505, 0.08], '#2B2C2E', 'satin', segments=12),
          cyl([0.09, 0.14, 0.09], [0, 0.57, 0.08], '#C9483B', 'gloss', segments=12),            # soda cup
          cyl([0.012, 0.1, 0.012], [0.015, 0.68, 0.08], '#F2F2F0', 'satin', segments=6),
          lathe([0.16, 0.12, 0.16], [0, 0.56, -0.14], '#C9483B', 'satin',                       # popcorn bucket
                [[0, -0.5], [0.38, -0.5], [0.5, 0.5], [0, 0.5]], segments=12),
          sph([0.17, 0.08, 0.17], [0, 0.62, -0.14], '#F6E7B8', 'matte', segments=8)]
    p += screen_on_posts(-0.92, 0.92, 0.42, 0.88, 1.42)
    for x in (-0.86, 0.86):                                                                        # surround speakers
        p += [box([0.16, 0.86, 0.16], [x, 0.43, 0.32], '#6E7277', 'satin', radius=0.02),
              cyl([0.1, 0.01, 0.1], [x, 0.6, 0.235], '#3A3D41', 'satin', rotate=[90, 0, 0], segments=12),
              cyl([0.06, 0.01, 0.06], [x, 0.76, 0.235], '#3A3D41', 'satin', rotate=[90, 0, 0], segments=12)]
    p += [box([0.4, 0.02, 0.12], [-0.25, 0.465, 0.12], '#2B2C2E', 'satin', radius=0.01, rotate=[0, 20, 0])]  # remote
    return placeholder(p)


E['model.couchPotato.cinemaWall'] = cinema_wall(); FOOT['model.couchPotato.cinemaWall'] = (2, 1)


# ---- gameConsole (1x1, 2 players at x = +-0.25): gaming loveseat + screen and console in front --
def game_console():
    C = '#3F6E9E'
    p = [cushion([0.88, 0.28, 0.56], [0, 0.15, -0.12], C, radius=0.08),
         cushion([0.4, 0.12, 0.5], [-0.21, 0.39, -0.08], '#5A86B5', radius=0.05),
         cushion([0.4, 0.12, 0.5], [0.21, 0.39, -0.08], '#5A86B5', radius=0.05),
         cushion([0.88, 0.5, 0.16], [0, 0.56, -0.33], C, rotate=[-10, 0, 0], radius=0.07),
         cushion([0.08, 0.26, 0.5], [-0.405, 0.43, -0.12], C, radius=0.04),
         cushion([0.08, 0.26, 0.5], [0.405, 0.43, -0.12], C, radius=0.04),
         cushion([0.3, 0.28, 0.1], [0.26, 0.62, -0.24], MUSTARD, rotate=[-10, -20, 0])]
    for x in (-0.2, 0.2):                                                                          # controllers
        p += [box([0.14, 0.03, 0.08], [x, 0.465, 0.06], '#E8E8E6', 'gloss', radius=0.02),
              sph([0.02, 0.012, 0.02], [x + 0.04, 0.483, 0.06], '#C9483B', 'gloss', segments=6)]
    p += screen_on_posts(-0.4, 0.4, 0.42, 0.85, 1.32, MUSTARD)
    p += [box([0.6, 0.03, 0.12], [0, 0.62, 0.39], OAK, 'wood', radius=0.008),                    # shelf between posts
          box([0.3, 0.06, 0.1], [0, 0.665, 0.39], '#E8E8E6', 'gloss', radius=0.012),           # console
          box([0.1, 0.008, 0.002], [0.05, 0.67, 0.339], '#3BA3E0', 'gloss', radius=0.002),     # power light
          box([0.14, 0.18, 0.02], [-0.2, 0.73, 0.43], '#B33A32', 'satin', radius=0.004),       # game box
          box([0.14, 0.18, 0.02], [-0.17, 0.73, 0.41], '#3E8EDE', 'satin', radius=0.004)]
    return placeholder(p)


E['model.couchPotato.gameConsole'] = game_console(); FOOT['model.couchPotato.gameConsole'] = (1, 1)


# ---- recliner (1x1): deep power recliner, footrest out, cup holder arm -------------------------
def recliner():
    p = recliner_seat(0, 0.86, PLUSH, arm=False, foot=True)
    for s in (-1, 1):                                                                              # big rolled arms
        p += [cushion([0.16, 0.36, 0.7], [s * 0.37, 0.4, -0.08], PLUSH, radius=0.07)]
    p += [cyl([0.08, 0.02, 0.08], [0.37, 0.59, 0.1], '#3A3D41', 'satin', segments=12),          # cup holder
          cyl([0.07, 0.12, 0.07], [0.37, 0.64, 0.1], TEAL, 'gloss', segments=12),
          box([0.05, 0.02, 0.14], [-0.37, 0.59, 0.08], '#3A3D41', 'satin', radius=0.01),        # remote
          box([0.02, 0.006, 0.12], [-0.38, 0.6, 0.1], '#5C6168', 'satin', radius=0.003),
          box([0.6, 0.05, 0.6], [0, 0.025, -0.06], '#6E5038', 'wood', radius=0.012)]           # plinth
    p += [box([0.4, 0.025, 0.5], [-0.12, 0.475, -0.04], '#D9C7A6', 'fabric', radius=0.012, rotate=[0, 10, 0])]  # throw
    return placeholder(p)


E['model.couchPotato.recliner'] = recliner(); FOOT['model.couchPotato.recliner'] = (1, 1)


# ---- snackFridge (1x1): a mini-fridge ottoman (Kenney fridge restyled), padded lid, order screen -
def snack_fridge():
    MINT = '#9FD3C7'
    p = [cushion([0.58, 0.08, 0.5], [0, 0.41, -0.02], '#E9E4DA', radius=0.035),                 # padded lid (top 0.45)
         box([0.18, 0.12, 0.012], [0.08, 0.24, 0.235], '#1B2A3A', 'gloss', radius=0.01),        # door screen
         box([0.15, 0.09, 0.002], [0.08, 0.24, 0.242], '#F2A541', 'gloss', radius=0.006),       # takeout menu glow
         box([0.04, 0.03, 0.002], [0.04, 0.26, 0.244], '#C9483B', 'gloss', radius=0.003),
         lathe([0.24, 0.1, 0.24], [0.28, 0.5, -0.16], '#F2EDE2', 'gloss',                     # snack bowl on the lid
               [[0, -0.5], [0.3, -0.5], [0.5, 0.5], [0.45, 0.5], [0, -0.3]], segments=16),
         sph([0.2, 0.06, 0.2], [0.28, 0.54, -0.16], '#E9B54A', 'matte', segments=10),
         box([0.5, 0.02, 0.06], [0, 0.05, 0.22], '#5C6168', 'satin', radius=0.01)]              # kick plate
    fb = [box([0.56, 0.37, 0.46], [0, 0.185, -0.02], MINT, 'gloss', radius=0.03)] + p
    return gltf(LIB + 'kenney/kitchenFridgeSmall.glb', [0.56, 0.37, 0.46], {
        'metalLight': mat('gloss', MINT), 'metalDark': mat('satin', '#7FB5A9'),
        'metal': mat('chrome', CHROME), 'glass': mat('gloss', '#DDEDEA')}, align='centre', offset=[0, 0, -0.02],
        parts=p, placeholder=fb)


E['model.couchPotato.snackFridge'] = snack_fridge(); FOOT['model.couchPotato.snackFridge'] = (1, 1)


# ---- fitnessGame (1x1): TV on a slim stand (Kenney TV restyled), sensor bar, step mat -----------
def fitness_game():
    p = [box([0.8, 0.04, 0.3], [0, 0.56, -0.3], OAK, 'wood', radius=0.01),                       # stand top
         box([0.8, 0.04, 0.3], [0, 0.2, -0.3], OAK, 'wood', radius=0.01)]
    for x in (-0.37, 0.37):
        p.append(box([0.04, 0.58, 0.28], [x, 0.29, -0.3], '#E8E8E6', 'satin', radius=0.01))
    p += [box([0.3, 0.04, 0.05], [0, 1.15, -0.32], '#E8E8E6', 'gloss', radius=0.02),              # sensor bar
          sph([0.03, 0.03, 0.01], [-0.08, 1.15, -0.29], '#C9483B', 'gloss', segments=6),
          box([0.7, 0.012, 0.56], [0, 0.006, 0.17], '#7FC4A4', 'fabric', radius=0.01),         # step mat
          box([0.62, 0.004, 0.48], [0, 0.014, 0.17], '#9FD8BB', 'fabric', radius=0.008)]
    for dx in (-0.15, 0.15):                                                                       # footprints
        p += [box([0.09, 0.004, 0.18], [dx, 0.018, 0.2], '#E9F4EE', 'matte', radius=0.03)]
    p += [cyl([0.07, 0.2, 0.07], [0.3, 0.32, -0.25], '#3E8EDE', 'gloss', segments=12),           # water bottle
          box([0.3, 0.03, 0.2], [-0.2, 0.235, -0.3], '#E9B54A', 'fabric', radius=0.012),       # towel
          cyl([0.14, 0.14, 0.14], [0.36, 0.08, 0.38], '#C9483B', 'satin', rotate=[0, 0, 90], segments=12)]  # kettlebell-ish weight
    # Kenney TV: metalDark = frame + stand, metal = screen
    fb = [box([0.8, 0.5, 0.05], [0, 0.84, -0.33], BACK, 'satin', radius=0.012)] + p
    return gltf(LIB + 'kenney/televisionModern.glb', [0.8, 0.53, 0.16], {
        'metalDark': mat('satin', '#D5D6D4'), 'metal': mat('gloss', '#4FC3A1')}, align='back', offset=[0, 0.58, 0.07],
        parts=p, placeholder=fb)


E['model.couchPotato.fitnessGame'] = fitness_game(); FOOT['model.couchPotato.fitnessGame'] = (1, 1)


# ---- lavaLamp (1x1): a floor pouf to zone out on, side table with a big glowing lava lamp ----
def lava_lamp():
    p = [cushion([0.62, 0.36, 0.6], [0, 0.18, -0.02], '#5A4A7A', radius=0.16),                  # pouf (top ~0.45 with cushion)
         cushion([0.54, 0.1, 0.52], [0, 0.4, -0.02], '#7A68A0', radius=0.05),
         cushion([0.5, 0.36, 0.14], [0, 0.6, -0.3], '#6E5C94', rotate=[-12, 0, 0], radius=0.06)]  # lean-back cushion
    tx, tz = 0.3, -0.32
    p += [cyl([0.26, 0.03, 0.26], [tx, 0.5, tz], OAK, 'wood', segments=20),
          cyl([0.04, 0.48, 0.04], [tx, 0.25, tz], '#E8E8E6', 'satin', segments=10),
          cyl([0.2, 0.02, 0.2], [tx, 0.01, tz], '#E8E8E6', 'satin', segments=16),
          lathe([0.14, 0.14, 0.14], [tx, 0.585, tz], TEAL, 'metal',                            # lamp base
                [[0, -0.5], [0.5, -0.5], [0.3, 0.5], [0, 0.5]], segments=16),
          lathe([0.16, 0.42, 0.16], [tx, 0.86, tz], '#E96A9A', 'glass',                       # glass vessel
                [[0.0, -0.5], [0.3, -0.5], [0.5, -0.1], [0.32, 0.5], [0.0, 0.5]], segments=16),
          lathe([0.11, 0.08, 0.11], [tx, 1.11, tz], TEAL, 'metal', [[0, -0.5], [0.5, -0.5], [0.2, 0.5], [0, 0.5]], segments=12)]
    for dy, d in ((0.7, 0.08), (0.84, 0.06), (0.97, 0.05), (0.77, 0.05)):                          # wax blobs
        p.append(sph([d, d * 1.3, d], [tx + (d - 0.05) * 0.4, dy, tz], '#F2914A', 'gloss', segments=8))
    p += [box([0.3, 0.012, 0.3], [-0.24, 0.006, 0.3], '#E9B54A', 'fabric', radius=0.1)]            # round-ish rug corner
    return placeholder(p)


E['model.couchPotato.lavaLamp'] = lava_lamp(); FOOT['model.couchPotato.lavaLamp'] = (1, 1)


if __name__ == '__main__':
    sys.exit(1 if run('couchPotato', sys.argv[1] if len(sys.argv) > 1 else None, E, FOOT) else 0)
