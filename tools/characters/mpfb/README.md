# Resident bodies (MakeHuman / MPFB)

The residents' bodies, faces, face morphs, hair, skins and clothes come from MakeHuman, all CC0. Building them takes two steps:

1. `make_bodies.py` runs inside Blender with MPFB and writes `male.gltf` / `female.gltf`. Each file holds the body, eyes, eyebrows, eyelashes, teeth, tongue, 8 of MakeHuman's hairstyles and 15 of its clothes items (`CLOTHES`) on MPFB's `game_engine` rig. The ARKit face units and the Meta visemes are morph targets on every part. MPFB would cut the skin under clothes out of the body; instead the build keeps the whole body and records each item's delete group as a bit in the body's `_HIDE` attribute.
   Each also carries MakeHuman's low-detail body (proxy `female1605` / `male1591`, about 1,600 vertices), which the game draws on residents far from the camera and uses for all character shadows.
   It also writes the same bodies at the other life stages (`<body>.<stage>.gltf`: baby, child, teen, adult and elder) from MakeHuman's age macro, with the hair and clothes refitted. The young adult is the base. Adults get MakeHuman's middle-aged skin, elders its old skin.
2. `../build_mpfb.py` turns those files into the game's character set. Each life stage becomes `<body>.<stage>.bin`, holding position deltas and normals for every part plus its own skeleton in `rig.json`. Each hairstyle goes into a file of its own (`<body>.hair.<style>.bin`), loaded the first time someone wears it; its face morphs stay in the main file. The clothes (`GARMENTS`, helpers in `../clothes.py`) are MakeHuman's suits split into tops and bottoms, plus shoes. Each garment's skin cut (the runtime discards skin under it) is fitted to the skin its delete group hides, and its textures go into one atlas (`cloth_albedo.jpg`, `cloth_normal.jpg`): greyscale detail that the resident's colours tint, except shoes, which keep their colours. The body's skin is split into chunks by the garments that hide them; residents far from the camera wear simplified copies of the clothes (`lod.*` parts) over the low-detail body. The scalp (the head above a hairline) takes the hair colour under any hairstyle, and the skins' painted stubble is cleaned off it. The game loads a stage when a resident of that age appears. The Quaternius hair is refitted to its skull.

Pinned versions (generated 2026-10-10):

| Tool / asset | Version | Where |
|---|---|---|
| Blender | 5.2.2 LTS | https://download.blender.org/release/Blender5.2/ |
| MPFB (MakeHuman for Blender) | 2.0.17 | Blender extensions platform (`mpfb`) |
| MakeHuman system assets | `makehuman_system_assets_cc0.zip` | https://static.makehumancommunity.org/assets/assetpacks.html |
| Faceunits 01 (ARKit), Visemes 02 (Meta) | `faceunits01.zip`, `visemes02.zip` | same page, "Functional asset packs" |

MPFB's code is GPL. It is only used as a tool here; nothing of it ships. Every asset used is marked CC0 in its pack's metadata (`packs/*.json`). The face units and visemes are by Mika Suominen.

## Build

```sh
# The three packs (zips, as downloaded) in one folder; missing ones are installed into MPFB's user data.
blender -b -P tools/characters/mpfb/make_bodies.py -- <packs dir> <mpfb out> [--preview]

# The hairstyles and clips still come from the Quaternius set built by build.py (v2, e.g. the
# committed set before MakeHuman: `git archive 262cd5b web/public/assets/characters | tar -x -C <dir>`).
python3 -B -I tools/characters/build_mpfb.py <mpfb out> <legacy characters dir> web/public/assets/characters
```

`--preview` renders the bodies and a few expressions to `<mpfb out>/preview/`.

## The look

The look is set in `make_bodies.py` (`MACROS`, `STAGES`, `STYLE`, `STYLE_BODY`). It uses real human proportions: MakeHuman's averages for proportions, height, weight and muscle, which come from anthropometric data and give a head about 1/7.5 of the body height. There is no stylisation. Women and men differ as in real people, within ordinary human variation (`STYLE_BODY`): the shoulder-to-hip ratio (about 1.06 and 1.29 as built), the waist, arms and neck, and the jaw, chin, nose, lips and brows. `STYLE` only smooths the nipples so they don't show through tops.

Eye colour is a tint applied at runtime. The build stores each eye vertex's position relative to the iris centre in its fields, and the shader recolours the iris with the resident's `eyes` colour.

The expressions live in the game, not in this build: `MOODS` in `web/src/render/babylon/characters/face.ts` holds ARKit recipes adapted from TalkingHead (MIT), which are made for these same MakeHuman face units.
