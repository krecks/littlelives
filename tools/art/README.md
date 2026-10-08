# Art pipeline

Scripts that produced the current textures, placeholder models and manifest entries.
They are only needed to regenerate or change the art; the results already live in
`web/public/assets/` (see `CREDITS.md` there for sources and licences — all CC0).

Run Python with `-I` (isolated mode); downloads are treated as data only.

| Script | Purpose |
|---|---|
| `ph_tex.py <outdir> <res> <maps> <id>…` | Download Poly Haven texture maps (CC0) |
| `ph_model.py <outdir> <id>…` | Download Poly Haven glTF models (CC0) with their files |
| `process.py <src_root> <dst_root>` | Convert downloaded maps into the game's `albedo/normal/arm` JPGs (needs Pillow) |
| `process_house.py <src_root> <dst_root> [set…]` | House/interior textures (siding, brick, roof, stone, floors, carpet, wallpaper, trim, door, lawn) from Poly Haven + ambientCG 1K-JPG downloads: greyscale detail maps, siding stagger, orientation fixes, ARM packing (needs Pillow + numpy) |
| `materials.py` | Writes `materials.json`: PBR material + environment entries |
| `models.py` | Writes `models.json`: detailed placeholder models (primitive parts with finishes) |
| `objects_extra.py [out.json]` | Writes `objects_extra.json`: placeholders for the newer objects (treadmill, weightBench, chessTable, computerDesk, easel, mirror, workbench, telescope, piano, lamp, diningTable) and `@modern` / `@cozy` / `@minimal` style variants of fridge, sink, bed, toilet, shower, sofa, tv, bookshelf, armchair, plant. Validates fields, colours, footprint bounds (~5 cm margin) and ≤4 finishes; exits non-zero on violations |
| `apply_entries.py <manifest> <entries.json>` | Merges generated entries into `manifest.json` in place |
| `clouds.py <out.png>` | Generates the procedural, tileable cloud layer (`textures/sky/clouds.png`) |
| `gltf_entries.py <manifest>` | (Superseded by `furniture.py`, which now owns those entries.) Pointed sofa/armchair/plant at their first glTF models |
| `gltf_bbox.py <model.gltf> [--fit W D] [--front +z\|-z\|+x\|-x] [--views out.png]` | World-space bounding box (node hierarchy applied) and triangle/material count of a glTF/GLB; with `--fit` prints the manifest `scale`/`rotationY`/`offset` that puts it in a W×D footprint, bottom at y=0, front at +Z (`--views` renders front/side checks, needs Pillow) |
| `gltf_compose.py <outdir> <model.gltf>[@x,y,z[,rotY[,scale]]]…` | Merges several glTF/GLB models into one `model.gltf` (e.g. TV on a side table); with one `.glb` it converts it to `.gltf` + `.bin` |
| `optimize_model.mjs <in> <out.glb> [--tex 512] [--format webp] [--simplify r]` | Node + glTF-Transform (`GT_DIR` = folder with `node_modules/@gltf-transform`): flatten, join primitives per material, weld, optional simplify, WebP textures, quantised geometry (KHR_mesh_quantization; no meshopt/Draco/KTX2 decoders needed, which would have to come from a CDN that cross-origin isolation blocks), one self-contained `.glb` |
| `build_library.py <kenney GLTF dir> <ph dir> [id…]` | Builds the furniture model library: `models/kenney/*.glb` (Kenney Furniture Kit) and `models/ph/*.glb` (Poly Haven, 512 px WebP, heavy meshes simplified) through `optimize_model.mjs` |
| `furniture.py [out.json]` | Entries for the base objects and their `@modern` / `@cozy` / `@minimal` variants: library glTFs restyled with the game finishes (`fit`, `materials`, `parts`, see `render/babylon/models.ts`) and primitive-part models (some reused or recoloured from `objects_extra.py`). Validates footprints; apply with `apply_entries.py` |
| `pack_<trait>.py` | Model entries for one personality pack (`model.<trait>.*`), written with `apply_pack.py` |
| `nature_atlas.py <leafsets_dir> <bark_albedo.jpg> <out_dir>` | Leaf-cluster atlas `leaves.webp` (twig sprays composited from ambientCG LeafSet 024/002/004/019, procedural blossoms, grass, apples, wildflowers; colour bled under the alpha) and `bark.webp` (brown + procedural birch). Needs Pillow, numpy, scipy |
| `nature_models.py <out_dir>` | Low-poly leaf-card trees (oak, birch, blossom, apple, spruce, each with a `*_far` LOD), bushes, hedge, grass tuft and wildflowers as `.glb` files that reference the two WebP textures in the same folder (`EXT_texture_webp`). Material names `nature.bark` / `nature.leaves` / `nature.grass` get wind sway in `render/babylon/nature.ts` |
| `nature_entries.py <manifest>` | Points `model.tree` / `pine` / `bush` / `grassTuft` / `flowers` at the nature glbs and adds the species and `.far` keys |
| `apply_pack.py <trait> <entries.json>` | Merges entries into `web/public/assets/packs/<trait>/manifest.json` in place |

Typical flow: download → `process.py` → copy into `web/public/assets/textures/` →
`materials.py` / `models.py` → `apply_entries.py web/public/assets/manifest.json materials.json` (and `models.json`).

Furniture flow: `ph_model.py` / Kenney kit download → `build_library.py` → `furniture.py` and
`pack_<trait>.py` → `apply_entries.py` / `apply_pack.py`. Model entry extras read by
`render/babylon/models.ts`: `fit` [w, h, d] (exact size, bottom on the floor; `align: back` puts the
back on the footprint edge), `materials` {glTF material name or `*`: {finish, color, roughness,
metallic, hide}}, `parts` (extra primitives), and placeholder shapes `lathe` (`profile`) and `torus`.
