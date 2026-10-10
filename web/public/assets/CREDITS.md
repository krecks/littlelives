# Third-party assets

All of the third-party art below is **CC0 1.0 (public domain)**. You don't have to credit it, but we list it so it's easy to trace and replace.
Downloaded 2026-10-07. Textures were resized and re-encoded (JPG). Fabric, wood, foliage, grass, wall, siding, roof, carpet, wallpaper and painted-wood albedo maps were converted to greyscale "detail" maps, so manifest, house and room colours set the hue.

## Textures (`textures/`)

| Folder | Source asset | Authors | URL | Licence |
|---|---|---|---|---|
| `floor_laminate/` | Laminate Floor 02 | Dario Barresi, Charlotte Baglioni | https://polyhaven.com/a/laminate_floor_02 | CC0 |
| `wall_plaster/` | Painted Plaster Wall | Amal Kumar | https://polyhaven.com/a/painted_plaster_wall | CC0 |
| `road_asphalt/` | Asphalt 02 | Rob Tuytel | https://polyhaven.com/a/asphalt_02 | CC0 |
| `path_hexpaving/` | Hexagonal Concrete Paving | Stephan Seeliger | https://polyhaven.com/a/hexagonal_concrete_paving | CC0 |
| `fabric_linen/` | Rough Linen | colormass, Rico Cilliers | https://polyhaven.com/a/rough_linen | CC0 |
| `wood_oak/` | Oak Veneer 01 | Jenelle van Heerden | https://polyhaven.com/a/oak_veneer_01 | CC0 |
| `bark/` | Bark Brown 02 | Rob Tuytel | https://polyhaven.com/a/bark_brown_02 | CC0 |
| `foliage/` | Forest Leaves 03 | Rob Tuytel, Dimitrios Savva | https://polyhaven.com/a/forest_leaves_03 | CC0 |
| `grass/` | Grass 001 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Grass001 | CC0 |
| `siding_wood/` | Wood Siding 009 (greyscale detail, board rows staggered) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=WoodSiding009 | CC0 |
| `brick/` | Red Brick 03 | Rob Tuytel | https://polyhaven.com/a/red_brick_03 | CC0 |
| `roof_shingles/` | Grey Roof Tiles 02 (greyscale detail) | Rob Tuytel | https://polyhaven.com/a/grey_roof_tiles_02 | CC0 |
| `stone_foundation/` | Rustic Stone Wall 02 | Amal Kumar | https://polyhaven.com/a/rustic_stone_wall_02 | CC0 |
| `floor_wood/` | Wood Floor 040 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=WoodFloor040 | CC0 |
| `floor_tile/` | Tiles 141 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Tiles141 | CC0 |
| `carpet/` | Carpet 012 (greyscale detail) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Carpet012 | CC0 |
| `wallpaper/` | Plaster 001 (greyscale detail) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Plaster001 | CC0 |
| `painted_wood/` | Painted Wood 008 A (greyscale detail) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=PaintedWood008A | CC0 |
| `grass_lush/` | Grass 004 (greyscale detail) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Grass004 | CC0 |
| `door_wood/` | Wood 066 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Wood066 | CC0 |

## Environment (`env/`)

| File | Source asset | Authors | URL | Licence |
|---|---|---|---|---|
| `belfast_open_field.env` | Belfast Open Field (1k HDRI, prefiltered to a Babylon `.env`) | Dimitrios Savva, Jarod Guest | https://polyhaven.com/a/belfast_open_field | CC0 |

## Models (`models/`)

Furniture and props come from two CC0 libraries, rebuilt by `tools/art/build_library.py` /
`optimize_model.mjs` (flattened, primitives joined per material, heavy meshes simplified, textures
resized to 512 px WebP, geometry quantised) into single `.glb` files. Kenney models are flat-coloured
and are restyled in the manifest with the game's own finishes (`materials`), and many entries add
primitive parts (`parts`). Downloaded 2026-10-07/08.

| File | Used for | Source asset | Authors | URL | Licence |
|---|---|---|---|---|---|
| `kenney/kitchenFridge.glb`, `kitchenFridgeLarge.glb`, `kitchenFridgeSmall.glb`, `kitchenSink.glb`, `kitchenCabinet.glb`, `kitchenStove.glb`, `kitchenMicrowave.glb`, `toilet.glb`, `shower.glb`, `showerRound.glb`, `washerDryerStacked.glb`, `televisionModern.glb`, `speaker.glb` | `model.fridge` (+`@modern`, `@minimal`), `model.sink` (+`@modern`), `model.toilet`, `model.shower` (+`@modern`, `@minimal`); packs: couchPotato.snackFridge, couchPotato.fitnessGame, energetic.powerBlender, energetic.contrastShower, cheerful.karaokeMachine, kind.neighbourlyOven, neat.laundryCenter, neat.rainShowerTower, slob.microwaveCart | Furniture Kit | Kenney | https://kenney.nl/assets/furniture-kit | CC0 |
| `ph/Sofa_01.glb` | `model.sofa` | Sofa 01 | Kirill Sannikov | https://polyhaven.com/a/Sofa_01 | CC0 |
| `ph/ArmChair_01.glb` | `model.armchair` | Arm Chair 01 | Kirill Sannikov | https://polyhaven.com/a/ArmChair_01 | CC0 |
| `ph/fireside_wing_chairs.glb` | bookworm.firesideLounge (two copies composed with `gltf_compose.py`) | Green Chair 01 | Kirill Sannikov | https://polyhaven.com/a/GreenChair_01 | CC0 |
| `ph/potted_plant_02.glb` | `model.plant` | Potted Plant 02 | Rico Cilliers | https://polyhaven.com/a/potted_plant_02 | CC0 |
| `ph/potted_plant_01.glb` | `model.plant@cozy` | Potted Plant 01 | Rico Cilliers | https://polyhaven.com/a/potted_plant_01 | CC0 |
| `ph/potted_plant_04.glb` | `model.plantSmall` | Potted Plant 04 | James Ray Cock | https://polyhaven.com/a/potted_plant_04 | CC0 |
| `ph/fern_02.glb` | natureLover.glasshouse | Fern 02 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fern_02 | CC0 |
| `ph/wooden_display_shelves_01.glb` | `model.bookshelf@minimal` | Wooden Display Shelves 01 | James Ray Cock | https://polyhaven.com/a/wooden_display_shelves_01 | CC0 |
| `ph/tv_crt_side_table.glb` | `model.tv@cozy` (composed) | Television 01 + Side Table 01 | Gabriel Radić; James Ray Cock | https://polyhaven.com/a/Television_01, https://polyhaven.com/a/side_table_01 | CC0 |
| `ph/workbench_metal_desk.glb` | `model.workbench` (composed) | Metal Office Desk + Metal Toolbox + Drill 01 | Ulan Cabanilla; Mateusz Sadek; Fernando Quinn | https://polyhaven.com/a/metal_office_desk, https://polyhaven.com/a/metal_toolbox, https://polyhaven.com/a/Drill_01 | CC0 |
| `ph/side_table_01.glb` | `model.sideTable` (catalogue side table); lazy.smartHub | Side Table 01 | James Ray Cock | https://polyhaven.com/a/side_table_01 | CC0 |
| `ph/painted_wooden_chair_01.glb` | `model.diningChair` (catalogue dining chair) | Painted Wooden Chair 01 | Kuutti Siitonen | https://polyhaven.com/a/painted_wooden_chair_01 | CC0 |
| `ph/electric_stove.glb` | `model.stove`, catalogue `stoveElectric` | Electric Stove | Kuutti Siitonen | https://polyhaven.com/a/electric_stove | CC0 |
| `ph/modern_ceiling_lamp_01.glb` | `model.ceilingLamp`, catalogue `ceilingPendant` | Modern Ceiling Lamp 01 | James Ray Cock | https://polyhaven.com/a/modern_ceiling_lamp_01 | CC0 |
| `ph/modern_wooden_cabinet.glb` | gloomy.recordCabinet | Modern Wooden Cabinet | Patrik Pangerl | https://polyhaven.com/a/modern_wooden_cabinet | CC0 |
| `ph/Rockingchair_01.glb` | kind.knittingRocker | Rockingchair 01 | Jorge Camacho | https://polyhaven.com/a/Rockingchair_01 | CC0 |
| `ph/tea_set_01.glb` | kind.welcomeTeaTable, bookworm.teaTrolley | Tea Set 01 | James Ray Cock, Rico Cilliers, Jurita Burger | https://polyhaven.com/a/tea_set_01 | CC0 |
| `ph/wine_bottles_01.glb` | outgoing.partyBar | Wine Bottles 01 | Rico Cilliers, Jurita Burger | https://polyhaven.com/a/wine_bottles_01 | CC0 |
| `ph/wooden_crate_01.glb` | hotHeaded.smashBin | Wooden Crate 01 | James Ray Cock | https://polyhaven.com/a/wooden_crate_01 | CC0 |
| `ph/planter_box_01.glb` | foodie.herbGarden | Planter Box 01 | James Ray Cock | https://polyhaven.com/a/planter_box_01 | CC0 |
| `ph/vintage_wooden_drawer_01.glb` | bookworm.bedsideStack | Vintage Wooden Drawer 01 | James Ray Cock | https://polyhaven.com/a/vintage_wooden_drawer_01 | CC0 |
| `kenney/kitchenFridgeBuiltIn.glb`, `kitchenCabinetDrawer.glb`, `kitchenCabinetUpperDouble.glb`, `hoodModern.glb`, `stoolBar.glb`, `stoolBarSquare.glb`, `bookcaseClosedDoors.glb`, `bookcaseOpenLow.glb`, `bookcaseClosedWide.glb`, `chairModernFrameCushion.glb`, `chairCushion.glb`, `chairRounded.glb`, `chairDesk.glb`, `loungeSofa.glb`, `loungeDesignSofa.glb`, `loungeChair.glb`, `tableCoffee.glb`, `tableCoffeeGlass.glb`, `sideTableDrawers.glb`, `cabinetBedDrawerTable.glb`, `bedSingle.glb`, `bedBunk.glb`, `bathroomCabinet.glb`, `bathroomMirror.glb`, `bathroomSink.glb`, `bathtub.glb`, `toiletSquare.glb`, `washer.glb`, `dryer.glb`, `coatRackStanding.glb`, `rugRound.glb`, `rugRectangle.glb`, `ceilingFan.glb`, `lampSquareCeiling.glb`, `lampSquareFloor.glb`; sets composed from kit pieces by `build_library.py` (`SETS`): `microwaveCounter.glb`, `coffeeCounter.glb`, `breakfastCounter.glb` (cabinets, microwave, coffee machine, toaster, blender), `stereoUnit.glb`, `tvRetroUnit.glb` (TV cabinet, radio, speakers, vintage TV), `nightstandLamp.glb`, `tableLamp.glb`, `tableLampSquare.glb` (bedside cabinet, side table, table lamps) | the 0.20 catalogue (`content/furniture.json`, models in `catalog/manifest.json`): fridges, counters, cabinets, appliances, stools, chairs, sofas, coffee tables, bookcases, beds, nightstands, bathroom fittings, laundry, rugs, lamps | Furniture Kit | Kenney | https://kenney.nl/assets/furniture-kit | CC0 |
| `ph/hanging_picture_frame_01.glb` | catalogue `printFramed` | Hanging Picture Frame 01 | James Ray Cock | https://polyhaven.com/a/hanging_picture_frame_01 | CC0 |
| `ph/hanging_picture_frame_02.glb` | catalogue `photoPrint` | Hanging Picture Frame 02 | James Ray Cock | https://polyhaven.com/a/hanging_picture_frame_02 | CC0 |
| `ph/fancy_picture_frame_01.glb` | catalogue `paintingClassic` | Fancy Picture Frame 01 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fancy_picture_frame_01 | CC0 |
| `ph/wall_clock.glb` | catalogue `wallClock` | Wall Clock | PierreB3D | https://polyhaven.com/a/wall_clock | CC0 |
| `ph/vintage_grandfather_clock_01.glb` | catalogue `grandfatherClock` | Vintage Grandfather Clock 01 | Yann Kervran, James Ray Cock | https://polyhaven.com/a/vintage_grandfather_clock_01 | CC0 |
| `ph/ceramic_vase_02.glb` | catalogue `vasePedestal` | Ceramic Vase 02 | James Ray Cock | https://polyhaven.com/a/ceramic_vase_02 | CC0 |
| `ph/ceramic_vase_03.glb` | catalogue `vaseTall` | Ceramic Vase 03 | James Ray Cock | https://polyhaven.com/a/ceramic_vase_03 | CC0 |
| `ph/antique_ceramic_vase_01.glb` | catalogue `urnPorcelain` | Antique Ceramic Vase 01 | James Ray Cock | https://polyhaven.com/a/antique_ceramic_vase_01 | CC0 |
| `ph/marble_bust_01.glb` | catalogue `bustMarble` | Marble Bust 01 | Rico Cilliers | https://polyhaven.com/a/marble_bust_01 | CC0 |
| `ph/concrete_cat_statue.glb` | catalogue `statueCat` | Concrete Cat Statue | Rico Cilliers, Riley Queen | https://polyhaven.com/a/concrete_cat_statue | CC0 |
| `ph/horse_statue_01.glb` | catalogue `statueHorse` | Horse Statue 01 | Rico Cilliers | https://polyhaven.com/a/horse_statue_01 | CC0 |
| `ph/ornate_mirror_01.glb` | catalogue `mirrorWall@cozy` | Ornate Mirror 01 | James Ray Cock | https://polyhaven.com/a/ornate_mirror_01 | CC0 |
| `ph/hanging_industrial_lamp.glb` | catalogue `pendantIndustrial` | Hanging Industrial Lamp | Kuutti Siitonen | https://polyhaven.com/a/hanging_industrial_lamp | CC0 |
| `ph/industrial_wall_lamp.glb` | catalogue `wallLightOutdoor` | Industrial Wall Lamp | Kuutti Siitonen | https://polyhaven.com/a/industrial_wall_lamp | CC0 |
| `ph/industrial_wall_sconce.glb` | catalogue `wallLampArm` | Industrial Wall Sconce | Ulan Cabanilla | https://polyhaven.com/a/industrial_wall_sconce | CC0 |
| `ph/outdoor_table_chair_set_01.glb` | catalogue `patioSet` | Outdoor Table Chair Set 01 | James Ray Cock | https://polyhaven.com/a/outdoor_table_chair_set_01 | CC0 |
| `ph/wooden_picnic_table.glb` | catalogue `picnicTable` | Wooden Picnic Table | Ulan Cabanilla | https://polyhaven.com/a/wooden_picnic_table | CC0 |
| `ph/Ukulele_01.glb` | catalogue `ukulele` | Ukulele 01 | Joseph Burgan | https://polyhaven.com/a/Ukulele_01 | CC0 |
| `ph/boombox.glb` | catalogue `boombox` | Boombox | Thomas Paul Mouilleron | https://polyhaven.com/a/boombox | CC0 |
| `ph/dartboard.glb` | catalogue `dartboard` | Dartboard | Satyaki Mandal | https://polyhaven.com/a/dartboard | CC0 |
| `ph/standing_chalkboard_01.glb` | catalogue `kidsChalkboard` | Standing Chalkboard 01 | ParzivalCG | https://polyhaven.com/a/standing_chalkboard_01 | CC0 |
| `ph/mid_century_lounge_chair.glb` | catalogue `armchairDesign` | Mid Century Lounge Chair | Kuutti Siitonen | https://polyhaven.com/a/mid_century_lounge_chair | CC0 |
| `ph/modern_arm_chair_01.glb` | catalogue `armchairLeather` | Modern Arm Chair 01 | Vibrant Nordic | https://polyhaven.com/a/modern_arm_chair_01 | CC0 |
| `ph/Ottoman_01.glb` | catalogue `pouf` | Ottoman 01 | Caspian Fortune | https://polyhaven.com/a/Ottoman_01 | CC0 |
| `ph/coffee_table_round_01.glb` | catalogue `coffeeTableMarble` | Coffee Table Round 01 | Ulan Cabanilla | https://polyhaven.com/a/coffee_table_round_01 | CC0 |
| `ph/steel_frame_shelves_03.glb` | catalogue `shelvingIndustrial` | Steel Frame Shelves 03 | Ulan Cabanilla | https://polyhaven.com/a/steel_frame_shelves_03 | CC0 |

Every other model (most style variants, gym/hobby objects, pack items and the catalogue's primitive models: kitchen island, dining sets, beds, tubs, showers, kids' toys, desks, instruments, games, fitness gear, wall art, curtains, rugs, chandelier, garden furniture, grills, hot tub, play equipment and garden lights, drawn by `tools/art/catalog.py`) is built from primitive parts in
`manifest.json` / the pack manifests by `tools/art/objects_extra.py`, `furniture.py` and `pack_<trait>.py`
(original, CC0).

## Generated art (original, CC0)

| File | What | How |
|---|---|---|
| `textures/sky/clouds.png` | Cloud band of the sky | `tools/art/clouds.py` (procedural noise) |
| `icons/rotate.svg`, `wall.svg`, `door.svg`, `eraser.svg`, `eyedropper.svg`, `environment.svg`, `fence.svg`, `gate.svg`, `roof.svg`, `upgrade.svg`, `focused.svg`, `inspired.svg`, `energized.svg`, `relaxed.svg` | UI and emotion icons | Hand-written SVG in the style of the existing set |

## Characters (`characters/`)

Sims are built from the free **Standard** editions of three Quaternius packs (all **CC0 1.0**, licence files included in the downloads). Downloaded 2026-10-08 and converted with `tools/characters/build.py` (meshes mirrored into Babylon's space and re-packed; bodies slimmed and stylised with a slightly bigger head and eyes; a face rig of extra head bones with generated eyelids; clothes (tops, trousers, shorts, capris, skirt, sneakers, boots) generated as offset shells of the body with smooth hems plus a baked cloth-fold normal map; hairstyles fitted to both heads with greyscale strand textures re-baked from the source hair textures so the creator's hair colour tints them; animations kept as rotations and retargeted at runtime). The generated parts (face rig, eyelids, clothes, fold maps, strand textures) are original, CC0. Bed blankets are generated at runtime in `render/babylon/characters/blanket.ts` (original, CC0).

| File(s) | Used for | Source asset | Author | URL | Licence |
|---|---|---|---|---|---|
| `male.bin`, `female.bin`, `male_*.jpg`, `female_*.jpg`, `hair*_*.jpg`, `eye_albedo.jpg` | `model.sim` bodies, faces, eyes, brows, eyelids, clothes; `model.hair.*` (Simple Parted, Long, Buns, Buzzed) | Universal Base Characters [Standard] | Quaternius | https://quaternius.itch.io/universal-base-characters | CC0 |
| `anims.bin` (idle, talk, walk, jog, sit, sit-talk, sit down / stand up, interact, pick up, dance, punches, hit, kneel, crouch, fall, push, simple-spell idle as "hands busy") | Character animation | Universal Animation Library [Standard] | Quaternius | https://quaternius.itch.io/universal-animation-library | CC0 |
| `anims.bin` (eat/drink, watering, harvest, plant seed, folded arms, no, yes, lie-to-idle, phone, lantern idle as "holding a book", chest open, rail lean, tree chopping) | Character animation | Universal Animation Library 2 [Standard] | Quaternius | https://quaternius.itch.io/universal-animation-library-2 | CC0 |
| `fabric.jpg` | Clothing weave (normal + detail) | Rough Linen (derived from `textures/fabric_linen/`) | colormass, Rico Cilliers | https://polyhaven.com/a/rough_linen | CC0 |

## Street and gardens (`street/`)

The neighbourhood dressing (`render/babylon/street.ts`: sidewalks, kerbs, streetlights, mailboxes, hydrants, bins, cars, picket fences, flower beds; neighbour porches, chimneys and garages in `house.ts`) is built from primitives in code (original, CC0). The hedge and flower-clump models are primitive placeholders in `street/manifest.json`. Only the sidewalk surface is third-party:

| File | Used for | Source asset | Authors | URL | Licence |
|---|---|---|---|---|---|
| `street/sidewalk/albedo.webp`, `normal.webp`, `arm.webp` | `material.sidewalk` | Concrete Pavement (1k; albedo made a greyscale detail map, resized to 512 px, ARM to 256 px, WebP) | Charlotte Baglioni | https://polyhaven.com/a/concrete_pavement | CC0 |

## Trees, bushes and lawn (`nature/`)

Trees (oak, maple, birch, cherry blossom, apple, Japanese maple, magnolia, weeping willow, pine, blue spruce and Italian cypress, each with a `*_far` LOD), bushes, a clipped hedge, grass tufts and wildflowers are low-poly leaf-card models generated by `tools/art/nature_models.py`, and the garden catalog (`nature/garden_*.glb`: flowers, shrubs, fruit and vegetables, house plants, pots, planters, a pond, a fountain, a gnome and other decor) by `tools/art/garden_models.py` (all original, CC0): procedural trunks, branches, stems, pots and stones plus alpha-cut cards with crown-bent normals. They share two textures. `nature/bark.webp` is the brown bark from `textures/bark/` (Bark Brown 02, Rob Tuytel, Poly Haven, CC0) next to a procedural birch bark. `nature/foliage.webp` is the foliage atlas built by `tools/art/foliage_atlas.py`: its leaf clumps, willow strands, plant leaves, flower heads, fruit, soil and stems are procedural (original, CC0); its conifer fronds, small-leaf sprigs and grass come from the earlier atlas `nature/leaves.webp` (built by `tools/art/nature_atlas.py`, now only an input). That atlas's leaf sprays are composited from these photographed leaves, which were recoloured and arranged into twigs:

| Atlas cell | Source asset | Author | URL | Licence |
|---|---|---|---|---|
| Broadleaf cluster (shade, blossom and apple trees) | Leaf Set 024 (1K) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=LeafSet024 | CC0 |
| Small-leaf sprigs (bushes, hedges) | Leaf Set 002 (1K) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=LeafSet002 | CC0 |
| Birch cluster | Leaf Set 004 (1K) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=LeafSet004 | CC0 |
| Conifer fronds | Leaf Set 019 (1K) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=LeafSet019 | CC0 |

## Resident voices (`../voice/`, fetched by `tools/voice/fetch.mjs`)

Unlike the art above, these are **Apache-2.0** (attribution required). They are downloaded at build time, pinned and checked by SHA-256, and are not stored in git.

| File | Source | Authors | URL | Licence |
|---|---|---|---|---|
| `paradee-8m-edit1.onnx`, `paradee-8m.json` | Paradee-8M v1.0 (int8 ONNX, `onnx/paradee_int8.onnx`), distilled from Kokoro-82M; **modified** (see below) | Sahil Mahendrakar; Kokoro-82M by hexgrad | https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0 | Apache-2.0 |
| `kitten-nano-0.8-edit1.onnx`, `kitten-nano-0.8-voices.f32` | KittenTTS nano 0.8 (fp32 ONNX `kitten_tts_nano_v0_8.onnx` and `voices.npz`, revision `7a1db645`); **modified** (see below) | KittenML (Stellon Labs) | https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32, https://github.com/KittenML/KittenTTS | Apache-2.0 |
| `en-us.lexz` | Misaki US English dictionaries (`us_gold`, `us_silver`), merged and gzipped | hexgrad | https://github.com/hexgrad/misaki | Apache-2.0 |

**Changes to Paradee-8M:** `paradee-8m-edit1.onnx` is the upstream `paradee_int8.onnx` changed by `tools/voice/model.mjs`: an added `pitch` input multiplies the predicted pitch curve, and the two random-number nodes (`RandomNormalLike`, `RandomUniformLike`) are replaced by a deterministic hash of each value's position. The weights are unchanged.

**Changes to KittenTTS nano 0.8:** `kitten-nano-0.8-edit1.onnx` is the upstream `kitten_tts_nano_v0_8.onnx` changed by `tools/voice/model.mjs`: the large float weights of its convolutions, matrix products and LSTMs are stored as int8 with a float scale per output channel (`DequantizeLinear` turns them back into floats, so the arithmetic stays float but the values are rounded); an added `pitch` input multiplies the predicted pitch curve; and its two random-number nodes are replaced by the same deterministic hash. `kitten-nano-0.8-voices.f32` holds the first 128 style rows of its eight voices from `voices.npz`, as raw floats, unchanged. KittenTTS's input (espeak-style phonemes and its symbol table) is rebuilt in `crates/voice/src/kitten.rs` from our phonemizer; its own code and espeak-ng are not used.

The phonemizer in `crates/voice/src/g2p.rs` ports the English rules of Misaki (Apache-2.0); no espeak-ng code is used.

The models run with **ONNX Runtime Web** 1.30.0 (`onnxruntime-web`, its WebAssembly build `ort-wasm-simd-threaded.wasm`, bundled with the game), © Microsoft Corporation, MIT licence: https://github.com/microsoft/onnxruntime.

## Decoders (`../decoders/`, refreshed by `tools/assets/decoders.mjs`)

Production builds ship compressed copies of the assets above (KTX2 textures, meshopt models, made by `tools/assets/optimize.mjs`; the art itself is unchanged). The game decodes them with these files, served from its own folder instead of Babylon's CDN:

| File(s) | What | Source | Authors | Licence |
|---|---|---|---|---|
| `babylon.ktx2Decoder.js`, `ktx2Transcoders/1/uastc_*.wasm` | KTX2 texture decoder and UASTC transcoders | Babylon.js 9.29.0 (cdn.babylonjs.com) | Babylon.js contributors | Apache-2.0 |
| `ktx2Transcoders/1/msc_basis_transcoder.js`, `.wasm` | Basis Universal transcoder | Basis Universal, built by Babylon.js | Binomial LLC | Apache-2.0 |
| `zstddec.wasm` | Zstandard decompression (UASTC KTX2) | zstddec, built by Babylon.js | Don McCurdy; Zstandard by Meta | MIT; BSD-3-Clause |
| `meshopt_decoder.js` | meshopt geometry decoder | meshoptimizer 1.3.0 | Arseny Kapoulkine | MIT |

The build tools that make the compressed copies are not shipped: the Basis Universal encoder (Apache-2.0, through ktx2-encoder, MIT), glTF-Transform (MIT), meshoptimizer (MIT) and sharp (Apache-2.0, with libvips, LGPL-3.0).
