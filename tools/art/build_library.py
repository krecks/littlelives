# Builds the game's furniture model library from downloaded CC0 sources:
#   web/public/assets/models/kenney/<name>.glb  (Kenney Furniture Kit, flat colours: restyled in the manifest)
#   web/public/assets/models/kenney/<set>.glb   (a few kit pieces composed into one model: a microwave on a counter)
#   web/public/assets/models/ph/<id>.glb        (Poly Haven 1k glTF, textures resized to 512 px WebP)
# Each file goes through optimize_model.mjs (flatten, join by material, weld, simplify heavy meshes
# to ~TARGET triangles, WebP textures, quantised geometry).
#
# usage: GT_DIR=<gltf-transform install> python3 -I build_library.py <kenney GLTF-format dir> <ph dir> [id...]
#   <ph dir> holds <id>/model.gltf from ph_model.py. With ids, only those are (re)built.
import os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'public', 'assets', 'models'))
OPT = os.path.join(HERE, 'optimize_model.mjs')
COMPOSE = os.path.join(HERE, 'gltf_compose.py')

KENNEY = '''kitchenFridge kitchenFridgeLarge kitchenFridgeSmall kitchenSink toilet toiletSquare shower showerRound
bathtub bathroomSink bathroomSinkSquare bathroomMirror washer dryer washerDryerStacked kitchenStove kitchenStoveElectric
kitchenMicrowave kitchenCoffeeMachine kitchenBlender toaster chairDesk computerScreen computerKeyboard computerMouse
laptop televisionModern televisionVintage speaker speakerSmall radio lampRoundFloor lampSquareFloor lampRoundTable
lampSquareTable books pillow pillowLong rugRound rugRectangle rugRounded trashcan bear coatRackStanding kitchenBar
stoolBar hoodModern kitchenCabinet kitchenCabinetDrawer kitchenCabinetUpper ceilingFan plantSmall1 plantSmall2
plantSmall3 pottedPlant tableCoffeeGlass sideTableDrawers cabinetBedDrawer
kitchenFridgeBuiltIn kitchenCabinetUpperDouble stoolBarSquare bookcaseClosedDoors
bookcaseOpenLow bookcaseClosedWide chairModernFrameCushion chairCushion chairRounded loungeSofa loungeDesignSofa
loungeChair tableCoffee cabinetBedDrawerTable bedSingle bedBunk bathroomCabinet lampSquareCeiling'''.split()

# Kit pieces composed into one model (gltf_compose.py offsets in glTF metres, kit scale), then optimised
# like the rest: name -> [(kit model, 'x,y,z[,rotY]')].
SETS = {
    'microwaveCounter': [('kitchenCabinet', '0,0,0'), ('kitchenMicrowave', '0.07,0.45,-0.21')],
    'coffeeCounter': [('kitchenCabinet', '0,0,0'), ('kitchenCoffeeMachine', '0.12,0.45,-0.19')],
    'breakfastCounter': [('kitchenCabinetDrawer', '0,0,0'), ('toaster', '0.13,0.45,-0.2'), ('kitchenBlender', '0.26,0.45,-0.36')],
    'stereoUnit': [('cabinetTelevision', '0,0,0'), ('radio', '0.24,0.31,-0.17'), ('speakerSmall', '0.03,0.31,-0.2'),
                   ('speakerSmall', '0.62,0.31,-0.2')],
    'tvRetroUnit': [('cabinetTelevision', '0,0,0'), ('televisionVintage', '0.195,0.31,0.0')],
    'nightstandLamp': [('cabinetBedDrawer', '0,0,0'), ('lampRoundTable', '0.063,0.263,-0.037')],
    'tableLamp': [('sideTable', '0,0,0'), ('lampRoundTable', '0.197,0.384,-0.04')],
    'tableLampSquare': [('sideTable', '0,0,0'), ('lampSquareTable', '0.197,0.384,-0.04')],
}

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
    # 0.20 catalog: small things get 256 px textures (they're never big on screen).
    'hanging_picture_frame_01': (256, 2000), 'hanging_picture_frame_02': (512, 3000), 'fancy_picture_frame_01': (512, 2000),
    'wall_clock': (256, 3000), 'vintage_grandfather_clock_01': (512, 6000), 'ceramic_vase_02': (256, 2000),
    'ceramic_vase_03': (256, 2000), 'antique_ceramic_vase_01': (256, 3000), 'marble_bust_01': (512, 5000),
    'concrete_cat_statue': (256, 4000), 'horse_statue_01': (256, 5000), 'ornate_mirror_01': (256, 4000),
    'hanging_industrial_lamp': (256, 4000), 'industrial_wall_lamp': (256, 3000), 'industrial_wall_sconce': (256, 4000),
    'outdoor_table_chair_set_01': (512, 6000), 'wooden_picnic_table': (512, 5000), 'Ukulele_01': (256, 4000),
    'boombox': (256, 4000), 'dartboard': (512, 3000), 'standing_chalkboard_01': (256, 2400),
    'mid_century_lounge_chair': (512, 6000), 'modern_arm_chair_01': (512, 6000), 'Ottoman_01': (256, 3000),
    'coffee_table_round_01': (256, 3000), 'steel_frame_shelves_03': (256, 5000),
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
    for name, parts in SETS.items():
        if only and name not in only: continue
        with tempfile.TemporaryDirectory() as tmp:
            specs = [os.path.join(kdir, part + '.glb') + '@' + at for part, at in parts]
            subprocess.run([sys.executable, '-I', COMPOSE, tmp, *specs], check=True, capture_output=True)
            run(os.path.join(tmp, 'model.gltf'), os.path.join(OUT, 'kenney', name + '.glb'), ['--tex', '256'])
    for pid in sorted(os.listdir(phdir)):
        src = os.path.join(phdir, pid, 'model.gltf')
        if not os.path.exists(src) or (only and pid not in only): continue
        tex, target = PH.get(pid, (512, TARGET))
        n = tris(src)
        extra = ['--tex', str(tex)]
        if n > target: extra += ['--simplify', f'{target / n:.4f}', '--error', '0.004']
        run(src, os.path.join(OUT, 'ph', pid + '.glb'), extra)


if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit('usage: build_library.py <kenney dir> <ph dir> [id...]')
    main(sys.argv[1], sys.argv[2], set(sys.argv[3:]))
