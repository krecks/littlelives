import json
T = 'textures/'
def surf(color, tex, uv, **kw):
    e = {'type': 'material', 'color': color, 'texture': f'{T}{tex}/albedo.jpg', 'normal': 'normal.jpg', 'arm': 'arm.jpg', 'uvScale': uv}
    e.update(kw); return e
E = {
  'environment.sky': {'type': 'image', 'url': 'env/belfast_open_field.env'},
  'material.wall': surf('#F4F0E8', 'wall_plaster', 0.5, normalStrength=0.7),
  'material.floor': surf('#FFFFFF', 'floor_laminate', 0.55),
  'material.ground': dict(surf('#FFFFFF', 'grass', 0.3, normalStrength=0.8, projection='xz'), sideColor='#C9B391'),
  'material.road': surf('#FFFFFF', 'road_asphalt', 0.2, projection='xz'),
  'material.path': surf('#FFFFFF', 'path_hexpaving', 0.7, projection='xz'),
  'material.finish.matte': {'type': 'material', 'color': '#FFFFFF', 'roughness': 0.75},
  'material.finish.satin': {'type': 'material', 'color': '#FFFFFF', 'roughness': 0.42},
  'material.finish.gloss': {'type': 'material', 'color': '#FFFFFF', 'roughness': 0.12},
  'material.finish.metal': {'type': 'material', 'color': '#FFFFFF', 'roughness': 0.32, 'metallic': 1},
  'material.finish.chrome': {'type': 'material', 'color': '#FFFFFF', 'roughness': 0.1, 'metallic': 1},
  'material.finish.fabric': surf('#FFFFFF', 'fabric_linen', 2.5, roughness=1, metallic=0),
  'material.finish.wood': surf('#FFFFFF', 'wood_oak', 1.2, roughness=0.8, metallic=0),
  'material.finish.bark': surf('#FFFFFF', 'bark', 1.0, metallic=0),
  'material.finish.foliage': surf('#FFFFFF', 'foliage', 0.8, roughness=0.9, metallic=0),
  'material.finish.glass': {'type': 'material', 'color': '#DCE6E8', 'roughness': 0.05, 'alpha': 0.28},
  'material.finish.skin': {'type': 'material', 'color': '#FFFFFF', 'roughness': 0.55},
}
# House exterior/interior surfaces (process_house.py). uvScale = 1 / real-world tile size in metres.
# Greyscale detail maps (colour #FFFFFF) are tinted by the game per house/room.
# roughness multiplies the arm map's roughness (1 = as authored).
HOUSE = {
  'material.wall.siding':   surf('#FFFFFF', 'siding_wood', 0.4, roughness=1, normalStrength=1),        # 2.5 m tile, 16 boards (~0.156 m exposure); grey
  'material.wall.brick':    surf('#FFFFFF', 'brick', 1.0, roughness=1, normalStrength=1),              # 1.0 m tile, 13 courses
  'material.roof':          surf('#FFFFFF', 'roof_shingles', 0.667, roughness=1, normalStrength=1),    # 1.5 m tile, 11 rows of slates; grey
  'material.wall.stone':    surf('#FFFFFF', 'stone_foundation', 0.667, roughness=1, normalStrength=1), # 1.5 m tile
  'material.floor.wood':    surf('#FFFFFF', 'floor_wood', 0.53, roughness=1, normalStrength=0.8),           # 1.9 m tile
  'material.floor.tile':    surf('#FFFFFF', 'floor_tile', 0.5, roughness=0.7, normalStrength=1),                 # 2.0 m tile, 6x6 tiles of 33 cm
  'material.floor.carpet':  surf('#FFFFFF', 'carpet', 1.0, roughness=1, normalStrength=0.8),                # ~1 m tile (est.); grey
  'material.wall.interior': surf('#FFFFFF', 'wallpaper', 0.5, roughness=1, normalStrength=0.5),             # ~2 m tile (est.); grey
  'material.trim':          surf('#FFFFFF', 'painted_wood', 1.0, roughness=1, normalStrength=0.6),          # ~1 m tile (est.); near-white
  'material.door':          surf('#FFFFFF', 'door_wood', 1.0, roughness=1, normalStrength=0.6),             # ~1 m tile (est.); grain along v
}
E.update(HOUSE)
# Lawn: greyscale, blotch-flattened Grass004 (1.4 m) shown at 2 m for the 10-60 m camera; vertex colours tint it.
E['material.ground'] = dict(surf('#FFFFFF', 'grass_lush', 0.5, normalStrength=0.8, projection='xz'), sideColor='#C9B391')
# Character and house finishes without textures (glossy hair, window glass).
E['material.finish.hair'] = {'type': 'material', 'color': '#FFFFFF', 'roughness': 0.34}
E['material.finish.skin'] = {'type': 'material', 'color': '#FFFFFF', 'roughness': 0.48}
E['material.window'] = {'type': 'material', 'color': '#22303E', 'roughness': 0.05, 'metallic': 0.1}
E['material.window.inner'] = {'type': 'material', 'color': '#D8E8F4', 'roughness': 0.25}
json.dump(E, open('materials.json', 'w'), indent=2)
