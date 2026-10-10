# Changelog

All notable changes to Idyll Lives. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`.

## Unreleased

### Changed
- **New name: Idyll Lives** (it was Littlelives). The game is now at https://krecks.github.io/idyll-lives/; saves, settings and downloads carry over. The sparkle beside the name on the main menu and the loading card is gone.
- **Licence:** Idyll Lives is free software, released under the GNU General Public License v3.0 (or later). You may use, study, share, and modify it; if you distribute Idyll Lives or a modified version, you must make the source available under the same licence. (It was MIT.)

## 0.1.0 — 2026-10-10

**Play it in your browser:** https://krecks.github.io/idyll-lives/

The first release: a home-building game with a living simulation, in the browser. You build and furnish a home; its residents live in it on their own while you watch. (Earlier development builds were numbered 0.3–0.20; their notes are in the git history.)

### In this release
- **A living town:** create a neighbourhood (town size, neighbour households), then play one of the households who already live there or make your own in the 3D household creator (gender, who they're attracted to, skin, hair, clothes, traits, perks, starting bonds, voice) and move into a vacant house. Neighbour houses are generated, with one or two storeys. Everyone in town lives, works, socialises, visits friends and falls in and out of love on their own; the rest of the town keeps simulating while only your lot is drawn.
- **Watching:** left alone, the camera follows what happens at home (conversations, fights, first kisses, guests, someone using what you just built). The household strip, resident panels, following (F), the whole house (H), the journal (J), the town map (M), and speeds up to time-lapse with quiet hours skipped.
- **Planner (P):** a week per resident: activities on a calendar and life goals. Plans are a strong nudge, not orders, and each block shows whether it was kept and why not.
- **Jobs, skills and money:** 1,000 jobs (25 categories × 4 tracks × 10 grades), probation, promotions and workweeks that shrink with skill; 13 skills trained at work and at home; rent and bills every Sunday, and debt when a household can't pay.
- **Buy mode (V):** about 210 things to buy across Kitchen, Bathroom, Bedroom, Kids, Living, Office, Fitness, Hobbies, Decor, Lighting, Outdoor and Garden, shown as 3D pictures, with styles (Modern, Cozy, Minimal), upgrades (★ quality), things on walls and ceilings, rugs, lamps that light their room at night, and over 50 plants residents tend and harvest.
- **Build mode (B):** walls (straight and diagonal, full or half height, with coverings), rooms, paint, doors and windows in styles, stairs to a second storey, and walls up, cut away or down (W).
- **Resident voices (experimental, off by default):** the resident you're looking at, and conversations you start, are spoken in English by KittenTTS nano running on your computer (about 32 MB, downloaded once): eight real voices, mixed so every resident sounds their own, children higher and smaller, about 2,350 lines per item, interaction, mood and thought. Voices pause for the session if this computer can't keep up.
- **Sound:** birds by species singing in bouts through the day, crickets at night, and the sounds of things in use at home.
- **Saves, settings and tools:** save and load, Settings (graphics quality, audio, controls), a performance overlay (F3) and debug reports (F8). Content packs can add objects, art and voice lines (see `docs/content-packs.md`).
- **Runs on:** desktop Chrome, Edge, Brave or Safari with WebGPU; other browsers use the WebGL2 fallback. The simulation is Rust compiled to WebAssembly in its own worker.
