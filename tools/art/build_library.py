# Builds the game's furniture model library from downloaded CC0 sources:
#   web/public/assets/models/kenney/<name>.glb  (Kenney Furniture Kit, flat colours: restyled in the manifest)
#   web/public/assets/models/ph/<id>.glb        (Poly Haven 1k glTF, textures resized to 512 px WebP)
# Each file goes through optimize_model.mjs (flatten, join by material, weld, simplify heavy meshes
# to ~TARGET triangles, WebP textures, quantised geometry).
#
# usage: GT_DIR=<gltf-transform install> python3 -I build_library.py <kenney GLTF-format dir> <ph dir> [id...]
#   <ph dir> holds <id>/model.gltf from ph_model.py. With ids, only those are (re)built.
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'public', 'assets', 'models'))
OPT = os.path.join(HERE, 'optimize_model.mjs')

KENNEY = '''kitchenFridge kitchenFridgeLarge kitchenFridgeSmall kitchenSink toilet toiletSquare shower showerRound
bathtub bathroomSink bathroomSinkSquare bathroomMirror washer dryer washerDryerStacked kitchenStove kitchenStoveElectric
kitchenMicrowave kitchenCoffeeMachine kitchenBlender toaster chairDesk computerScreen computerKeyboard computerMouse
laptop televisionModern televisionVintage speaker speakerSmall radio lampRoundFloor lampSquareFloor lampRoundTable
lampSquareTable books pillow pillowLong rugRound rugRectangle rugRounded trashcan bear coatRackStanding kitchenBar
stoolBar hoodModern kitchenCabinet kitchenCabinetDrawer kitchenCabinetUpper ceilingFan plantSmall1 plantSmall2
plantSmall3 pottedPlant tableCoffeeGlass sideTableDrawers cabinetBedDrawer'''.split()

# Poly Haven id -> (max texture size, triangle target). Defaults: 512 px, 12k triangles.
PH = {
    'potted_plant_01': (512, 9000), 'potted_plant_02': (512, 9000), 'potted_plant_04': (512, 6000),
    'book_encyclopedia_set_01': (512, 6000), 'chess_set': (512, 9000), 'tea_set_01': (512, 6000),
    'vintage_radio_transceiver': (512, 9000), 'brass_candleholders': (512, 6000), 'wine_bottles_01': (512, 6000),
    'fern_02': (512, 6000), 'anthurium_botany_01': (512, 6000), 'shrub_sorrel_01': (512, 4000),
    'CoffeeCart_01': (512, 9000), 'vintage_cabinet_01': (512, 9000), 'drawer_cabinet': (512, 9000),
    'modern_wooden_cabinet': (512, 9000), 'gaming_console': (512, 6000), 'filmstrip_projector_8mm': (512, 6000),
    'desk_lamp_arm_01': (512, 6000), 'Lantern_01': (512, 6000), 'spinning_wheel_01': (512, 9000),
    'modular_street_seating': (512, 9000), 'chinese_tea_table': (512, 3000),
}
TARGET = 12000


def tris(path):
    import json, struct
    raw = open(path, 'rb').read()
    if raw[:4] == b'glTF':
        ln = struct.unpack_from('<I', raw, 12)[0]
        doc = json.loads(raw[20:20 + ln])
    else:
        doc = json.loads(raw)
    acc = doc['accessors']
    n = 0
    for me in doc.get('meshes', []):
        for p in me['primitives']:
            n += (acc[p['indices']]['count'] if 'indices' in p else acc[p['attributes']['POSITION']]['count']) // 3
    return n


def run(src, dst, extra):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    r = subprocess.run(['node', OPT, src, dst, *extra], capture_output=True, text=True)
    line = [l for l in r.stdout.splitlines() if 'KB' in l]
    print(line[-1] if line else r.stdout + r.stderr)


def main(kdir, phdir, only):
    for name in KENNEY:
        if only and name not in only: continue
        run(os.path.join(kdir, name + '.glb'), os.path.join(OUT, 'kenney', name + '.glb'), ['--tex', '256'])
    for pid in sorted(os.listdir(phdir)):
        src = os.path.join(phdir, pid, 'model.gltf')
        if not os.path.exists(src) or (only and pid not in only): continue
        tex, target = PH.get(pid, (512, TARGET))
        n = tris(src)
        extra = ['--tex', str(tex)]
        if n > target: extra += ['--simplify', f'{target / n:.4f}', '--error', '0.004']
        run(src, os.path.join(OUT, 'ph', pid + '.glb'), extra)


if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__ if False else 'usage: build_library.py <kenney dir> <ph dir> [id...]')
    main(sys.argv[1], sys.argv[2], set(sys.argv[3:]))
