# Changelog

All notable changes to Littlelives. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`.

## 0.4.0 — 2026-10-08

**Play it in your browser:** https://krecks.github.io/littlelives/

### New
- **Live · Buy · Build:** Build is its own mode (B) next to Buy (V); both pause the game.
- **Buy catalog:**
  - Every item shows a 3D picture of its model, drawn on demand and kept between visits.
  - The detail pane shows the item large; move the pointer across it to turn it around.
  - Category tabs with icons; tiles show what you already own, personality collections and "♥" for items your residents' traits love ("For us" filter).
  - Style chips restyle the pictures; the 14 items that come in several styles are marked, and the detail pane has a style picker (restyling what you own is free).
- **Placing and building feel:** the item in hand glides, turns and floats; placed furniture springs into place with sparkles; upgrades, sales and walls get their own effects; a tag next to the pointer shows what a click does and costs; money floats up when it changes hands. The catalog folds away while something is in hand.
- **Room tool:** drag out a rectangle to build its four walls.
- **Wall looks:** walls can be full or half height and carry a covering on each side (paint colours, wallpaper, siding, brick, wood panelling, stone, tiles).
  - **Paint tool:** cover the side of a wall you point at, drag along walls, or Shift-click a whole room (outdoors: the house's outside).
- **Door and window styles:** painted, oak, half-glazed and French doors; classic, cottage, picture, floor-length, high-light and transom windows. Pick another style and click to replace one.
- **Content packs** can add wall coverings, door and window styles (`wallCoverings`, `doorStyles`, `windowStyles`) and category icons.
- **Sound effects** for buying, building and painting (synthesised; *Settings → Sound effects*).

### Changed
- Tearing down walls, doors and windows is free.
- Saves are version 6 (wall looks, stored by id); older saves load with plain walls.

### Fixed
- Residents kept walking, breathing and blinking in place while the game was paused (pause, Buy and Build mode, menus).
- The pointer couldn't reach the lot right after picking an item (the catalog was in the way).

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
