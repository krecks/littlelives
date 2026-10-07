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
json.dump(E, open('materials.json', 'w'), indent=2)
