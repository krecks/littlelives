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
| `materials.py` | Writes `materials.json`: PBR material + environment entries |
| `models.py` | Writes `models.json`: detailed placeholder models (primitive parts with finishes) |
| `apply_entries.py <manifest> <entries.json>` | Merges generated entries into `manifest.json` in place |
| `gltf_entries.py <manifest>` | Points sofa/armchair/plant at their glTF models (placeholders stay as fallback) |

Typical flow: download → `process.py` → copy into `web/public/assets/textures/` →
`materials.py` / `models.py` → `apply_entries.py web/public/assets/manifest.json materials.json` (and `models.json`).
