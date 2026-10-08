# Changelog

All notable changes to Littlelives. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`.

## 0.3.0 — 2026-10-08

**Play it in your browser:** https://krecks.github.io/littlelives/

### New
- **Littlelives:** the project's new name; characters are *residents*. MIT licence for the code, CC0 for third-party art.
- **New game, two ways:** play one of the households already living in town ("Play" on step 1, then *Meet the …* with their home, members and neighbours), or create your own household as before.
- **3D menus:** a live 3D town behind the main menu; a 3D neighbourhood and home picker with lot tags; the camera flies into the chosen home.
- **Household creator:** the in-game 3D resident on a stage (turn, zoom to the face, live look changes, little reactions) and 3D portraits for every avatar. First names match the gender.
- **Building:**
  - Drag to draw and remove walls (click-then-click still works).
  - **Diagonal walls**, with doors, windows, half-tile floors and roofs over rooms with diagonal sides.
  - Draw a room's walls first and add the door after; only residents and furniture can't be shut in.
- **Selection marker:** a gold sparkle above the selected resident that follows their mood.
- **Characters:** separate garments, strand hair, a face that blinks, glances, shows feelings and talks, a friendly resting face, a relaxed stance, blankets in bed, and animations that match what the resident is doing.
- **World:** leafy trees and hedges in the wind, a dressed street (sidewalks, streetlights, cars, porches, gardens), see-through windows, golden evenings and blue nights.
- **Economy:** weekly bills based on what the household owns, charged with the rent every Sunday at noon; only consumables (takeout, deliveries) cost money per use.
- **Debug reports:** F8 or the performance overlay saves a screenshot, the game state and recent errors (in the project with `pnpm dev`, as a download otherwise); `?debugReport=<name>` reopens one.
- **Versions:** one version for the whole game (`tools/release/version.mjs`), shown in the menu and Credits.
- **Hosting:** every push to `main` is tested, built and published on GitHub Pages.

### Fixed
- "Moving in…" could hang after picking a different house.
- Residents only updated every few seconds on some screens (smooth motion again, also on 120 Hz displays and with coarse browser timers).
- The menu town could cover a game that started very quickly.
- Shrubs on free-standing walls, black faces on square roofs, grass growing through new floors.
- Flat placeholder faces flashing before the 3D portraits appeared.

### Changed
- "Moodlets" are now called *feelings* everywhere; old saves and content packs still load.

## 0.2.0

First public version: the simulation (needs, jobs with grades A–J, skills, relationships, rent), Buy mode with upgrades and styles, personality packs and the Babylon.js renderer.
