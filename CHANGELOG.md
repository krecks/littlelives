# Changelog

All notable changes to Littlelives. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`.

## Unreleased (0.7.0)

The game's new direction: build your home, then watch it live (see "Game direction" in PLAN.md). This release is about watching.

### New
- **Watching:** leave the game alone for 20 seconds and the camera follows what happens at home on its own: conversations, fights, first kisses, someone trying out what you just built, guests arriving. When nothing is going on it looks around the house. Any click, key or scroll takes the camera back at once. The eye button in the top bar starts it right away.
- **Household strip:** everyone at a glance along the bottom: what they're doing, where they are, how they feel, and which need is running low. Guests on your lot show up next to it.
- **Look first:** clicking a resident opens their panel (anyone, guests and neighbours too) instead of giving orders. From the panel you can still step in: click a person to talk to, an object to use, or the floor to walk. *Settings → Watching → Clicking residents* brings back the old way.
- **Follow** a resident (F, or the button in their panel), also when they visit friends. Otherwise the view stays at home. **H** shows the whole house.
- **Journal (J):** the story so far, by day: your home, everyone, or just the big moments. Click an entry to see the people involved.
- **Faster time:** time-lapse (4) and fastest (5). *Skip quiet hours* speeds through the night and work hours when nobody is home or awake, and big moments slow the game down to normal speed for a while.
- **Residents live on their own:** they look for work by themselves (newcomers usually find a job within days), may quit a job they're unhappy in, and are let go after missing too many shifts. Your household visits friends on its own like the neighbours do, and visits you ask for end after a while.
- *Settings → Watching:* when the camera starts watching, how often it moves on, a quiet interface while watching, slowing down for big moments, skipping quiet hours.

### Changed
- Free will is per household now; the *Free will* setting applies to your household (the neighbours always have it).
- Residents don't come home from work with every need at zero any more (there's lunch and a bathroom at work), and sleeping no longer makes them more tired.
- The story feed is calmer: your household's news and the town's big moments, three at a time; clicking one shows it.
- Furniture can't be placed across a wall or facing one, and a wall can't be built through furniture or in front of it.
- The story is saved with the game. Saves are now version 8; older saves load as before.

## 0.6.0 — 2026-10-08

**Play it in your browser:** https://krecks.github.io/littlelives/

Floors, undo, and residents who look like they mean it.

### New
- **Floors** in Build mode: a new Floor tool next to Paint. Click a tile, drag over several, or Shift-click a whole room. Thirteen coverings: oak, honey pine, walnut and whitewashed boards; white, sand, terracotta and slate tiles; oatmeal, sage, blue and rose carpet; and flagstone. "A" gives the room its own floor back.
- **Undo** in Build and Buy mode: the Undo button in the top bar, or Ctrl+Z / ⌘Z. It takes back purchases, sales, moves, upgrades, walls, doors, windows, paint and floors, money included (a sold item comes back where it stood). Up to 30 steps, for as long as time stands still.
- **Loading screens:** the game loads everything first (the town, your latest save) behind a progress bar, so the menu is ready to use and "Continue" starts at once. Starting a game that still has to load shows its progress full-screen.

### Changed
- **Animations:**
  - Getting into bed: residents sit on the edge, lean back and lie down; getting up, they sit up, sit on the foot of the bed and stand.
  - Gardening by task: watering with a can, kneeling to weed and tend, bending to harvest, reaching in to prune, crouching to smell the flowers, looking up into blossoming trees.
  - Hugs with arms around each other; fights where the attacker steps in and the defender guards and gives ground.
  - Reclining on sofas and recliners, leaning back in the bath, leaning forward on the toilet, sitting cross-legged to meditate.
  - Bowing the cello and drumming; bouncing on the trampoline, standing on the vibration plate, climbing the bouldering wall, stretching at the sunrise lamp.
  - Mopping with the steam mop, a microphone for karaoke, livelier laughter and breathing in bed.
- **Remove tool:** clicking a door or window walls it up again (the wall stays); dragging along walls still tears them down.
- Your own lot no longer gets an automatic border of shrubs and flowers along the house (building a room doesn't plant flowers around it): plant your garden from the Garden catalog. Other lots keep theirs.
- Selling, moving or undoing no longer makes the other furniture pop up.
- Content packs: `floorCoverings` (like `wallCoverings`) and the animation tags `water`, `tend`, `harvest`, `prune`, `smell` and `admire` (see `docs/content-packs.md`).
- Saves are now version 7 (floor coverings); older saves load as before.

## 0.5.0 — 2026-10-08

**Play it in your browser:** https://krecks.github.io/littlelives/

Nature and the garden.

### New
- **New trees:** crowns are now soft clumps of dense, painterly leaves on real branches, and turn to face the camera, so they look full from every side instead of showing flat leaf cards edge-on. They cast proper canopy shadows.
  - Eleven species: oak, maple, silver birch, cherry blossom, apple, Japanese maple, magnolia, weeping willow, pine, blue spruce and Italian cypress.
  - Town gardens get maples, magnolias and Japanese maples among their trees, the woods mix in maples and spruces, and the borders along the houses now have hydrangeas, roses, lavender and clipped boxwood.
- **Garden category** in Buy mode, with groups: Trees · Shrubs & hedges · Flowers · Fruit & veg · Houseplants (over 50 plants).
  - **Shrubs and hedges:** boxwood balls, topiary cones, clipped hedges, hydrangeas, roses, azaleas, lavender, ferns, ornamental grass and hostas.
  - **Flowers:** tulips, daffodils, daisies, sunflowers, poppies, marigolds, pansies, lilies, lupins, forget-me-nots, cosmos, a wildflower meadow, potted geraniums and a petunia box, and the raised flower bed, now full of flowers.
  - **Fruit and vegetables:** a vegetable patch, tomatoes, strawberries, a herb planter, pumpkins, an apple tree and a potted lemon tree.
  - **Houseplants:** monstera, fiddle-leaf fig, snake plant, cacti, succulents, a fern on a stand, a parlour palm, orchids and a bonsai.
  - **Garden decor** (Outdoor): bird bath, stone fountain, garden pond, gnome, stone lantern, wheelbarrow planter and boulders.
  - Placed plants each get their own turn and size, so a row of them doesn't look stamped.
- **Gardening skill:**
  - Residents train it when they water, tend, trim and harvest.
  - Good gardeners harvest more and feel *Proud gardener*.
  - Harvests are a free meal (*Homegrown*), and roses, lavender and lilies have a *Sweet scent*.
  - Fresh herbs make anyone a better cook for a few hours, and a skilled hand finds *Zen* in pruning the bonsai.
  - It's the main skill of the Gardening & Horticulture career, and farmers use it too.
  - Nature Lovers start with some Gardening and learn it faster.
- **More to do outside:** relax in the shade of a tree, pick apples, watch the birds, feed the fish, make a wish at the fountain, talk to your house plants.

### Changed
- Trees, flower beds, ponds and other garden things can only be placed outdoors; the price tag says "Goes outdoors" when you point indoors. Pots and planters go anywhere.
- The Town Park and Willow Studio get maples, a cherry, willows, a birch, a spruce, hydrangeas, roses and lavender (new towns).
- Content packs: objects can name a `group` within their category (categories list their `groups`) and set `outdoors`; manifest models can set `vary` (see `docs/content-packs.md`).

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
