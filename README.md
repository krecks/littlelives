# Idyll Lives

A home-building game with a living simulation that runs in the browser: you build and design your home, and its residents live in it on their own while you watch (see "Game direction" in [PLAN.md](PLAN.md)). The game logic is written in Rust and compiled to WebAssembly; rendering runs on the GPU through WebGPU, with a WebGL2 fallback. The interface is Svelte 5 with plain CSS. Desktop only.

**▶ Play it in your browser: https://krecks.github.io/idyll-lives/** (desktop Chrome, Edge, Brave or Safari; other browsers use the WebGL2 fallback).

See [PLAN.md](PLAN.md) for the research, architecture, milestones and known issues.

## Run it

Requirements: Rust (stable) with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.129, Node 22 and pnpm.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129
cd web
pnpm install
pnpm dev          # builds the WASM module, then starts Vite on http://localhost:5173
```

| Command (in `web/`) | What it does |
|---|---|
| `pnpm dev` | Rebuild WASM + dev server |
| `pnpm build` / `pnpm preview` | Production build / serve it |
| `pnpm check` | Type-check TypeScript and Svelte |
| `pnpm lint` | Lint the web code |
| `pnpm test:sim` | Run the Rust simulation tests |
| `pnpm assets` | Build or update the compressed asset copies (the build does this too) |
| `pnpm decoders` | Refresh `public/decoders` after a Babylon upgrade |

**Hosting:** every push to `main` builds the game and publishes it on GitHub Pages (`.github/workflows/pages.yml`). For the fastest snapshot path a server can send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. The dev and preview servers already do. Without these headers the game still runs, but snapshots are copied instead of shared.

## Playing

**New game:** create a neighbourhood (town size, neighbour households) → either play one of the households who already live there (**Play** on its card or its lot; they keep their home, jobs and friendships) or create your household in the 3D household creator (drag to turn a resident, scroll to zoom to the face; gender, who they're attracted to, skin, hair, clothes, traits, perks, starting bonds) → choose a vacant house → move in. Everyone in town lives, works, socialises and falls in and out of love on their own, your household included; you build their home and watch. Only your lot is drawn (or the lot of a resident you follow); the rest of the town keeps simulating in the background.

- **Watching:** leave the game alone and the camera follows what happens at home (conversations, fights, first kisses, someone using what you just built, guests); any input takes it back. The household strip at the bottom shows everyone at a glance; click a resident to look closer (and step in from their panel), **F** follows them, **H** shows the whole house, **J** opens the journal. Speeds 4 and 5 are time-lapse; quiet hours (everyone asleep or at work) skip ahead.
- **Planner (P):** each resident's week: drop activities on a calendar (train a skill at 18:00 Mon/Wed/Fri, sleep 23–7, cook dinner) and set life goals (get a job, get promoted, find love, save money). Plans are a strong nudge, not orders: urgent needs and personality can win, and each block shows whether it was kept and why not. Household blocks apply to everyone. Activities with nowhere to do them become wishes that open the catalog.

- **Jobs (1000 of them):** residents look for work on their own (and may quit or be let go); you can also pick a job yourself. 25 categories (journalism, detective work, fire & rescue, social media, IT, TV, mechanics, finance, …) × 4 tracks × 10 grades **A–J**. The grade sets pay per hour ($12/h at A up to $52/h at J) and the skill level the job expects. Open the job board from the *Career* tab, filter by category, grade or what your resident can take, and join any position you qualify for — up to two levels short is allowed *on probation*. Promotions need a full performance bar **and** the next grade's skills; a good worker climbs a grade every few weeks.
- **Skills:** Intelligence, Strength, Endurance, Charisma, Creativity, Technology, Handiness, Cooking, Writing, Perception, Dexterity, Business and Gardening (0–10). Work trains the job's skills; at home, residents practise with things you buy (treadmill, weight bench, chess table, computer desk, easel, mirror, workbench, telescope, piano, gourmet cooking, studying, tending the garden, pruning a bonsai). Traits give starting skills and faster learning in some.
- **Workweek:** the standard week is set by the job (mostly Mon–Fri). Skills change it: on probation residents work an extra day, two levels above the requirements a day less (*Flexible*), four levels above two days less (*Expert*). The weekly salary stays the same, so a shorter week pays more per shift.
- **Money:** household funds are in dollars. Rent and bills are charged every Sunday at noon: rent depends on the lot size, and bills grow with the value of everything the household owns and with how many live there (food and household goods, $150 a person). A working household saves a few hundred to a couple of thousand dollars a week: a new room every week or two. Items cost nothing per use; only takeout, deliveries and similar purchases do. A household that can't pay goes into debt and its residents worry about money.
- **Day and night:** Residents are active by day and sleep through the night (couples share a double bed), get up early for an early shift, eat and wash in the morning, socialise in the evening and use the bathroom before bed. Tiredness builds up faster when they stay up late.
- **Buy mode (V):** time stands still while you shop. The catalog shows every item as a 3D picture; point at one and move across its preview to turn it around. Furniture and training equipment cost money, and what you buy decides what your residents can do: point at an item to see the needs it fills (and how fast), the skills it trains, the feelings it can give, whether a skill makes it better (a skilled cook gets more out of the stove), any cost per use and how many residents fit. Filter by category (Kitchen, Bathroom, Bedroom, Kids, Living, Office, Fitness, Hobbies, Decor, Lighting, Outdoor, Garden) and its groups (Kitchen: Appliances · Counters & storage · Dining, …), search, sort by price or show only what you can afford. Pictures, curtains, shelves and wall lamps hang on walls (they turn to face away from the wall you point at), ceiling lamps and fans hang from a room's ceiling and rugs lie on the floor: they take no floor space, so a picture can hang over the sofa and a table can stand on a rug. Things on a wall go with their wall when walls are cut away, and a wall something hangs on can't be torn down until it's moved. Lamps light their room at night. Some furniture comes in several **styles** (Modern, Cozy, Minimal): whole different designs, marked on their cards. Pick the style for new purchases, or restyle what you own for free; styles never change price or quality. Click an owned object to upgrade, move, rotate, restyle or sell it (60% back).
- **Garden:** the *Garden* category (Trees · Shrubs & hedges · Flowers · Fruit & veg · Houseplants) has over 50 plants: oaks, maples, birches, cherry blossom, apple, magnolia, Japanese maple, weeping willow, spruce and cypress; roses, hydrangeas, lavender, hedges and topiary; beds of tulips, daffodils, daisies, sunflowers, poppies, lupins and more; vegetable patches, tomatoes, strawberries, herbs and pumpkins; and house plants from monstera to bonsai. Garden decor (bird bath, fountain, pond, gnome, lantern) is under *Outdoor*. Trees, beds and other garden things go outdoors only. Residents water, tend and trim them, smell the roses, relax in the shade and harvest a free meal; all of it trains **Gardening**, and good gardeners harvest more, feel proud of their beds and get Fresh herbs (better cooking for a while) from the herb planter. Gardening is the main skill of the Gardening & Horticulture career and helps farmers; Nature Lovers start with some and learn it faster.
- **Upgrades:** instead of pricier versions, objects get better by upgrading. Upgrades are bought in Buy mode (click the object → *Upgrade to ★n*) and happen at once; each quality star makes everything the object gives 25% better (a better shower cleans faster, a better treadmill trains faster).
- **Build mode (B: Wall · Room · Paint · Door · Window · Stairs · Remove):** time stands still here too. Press on a corner and drag to draw a wall, with a live preview and its cost; release to build. Walls can be full or half height and come with a covering (paint colours, wallpaper, siding, brick, wood panelling, stone, tiles); the Paint tool re-covers the side of a wall you point at (drag along walls, or Shift-click for a whole room). Doors and windows come in styles (painted, oak, half-glazed and French doors; classic, cottage, picture, floor-length, high-light and transom windows); pick another style and click to replace one. Tearing down is free. Drag at about 45° and the wall runs diagonally, corner to corner across the tiles. Clicking a corner and then another also works. The Room tool draws all four walls of the rectangle you drag out. Put doors and windows into walls (straight or diagonal) with a click, and drag along walls with Remove to tear them down on your own lot. Esc or a right-click while drawing cancels. Windows let light in but not residents. The Stairs tool puts a staircase (1 × 4 m) in hand: it leads up to the storey above (build that first) and is climbed from the front; R turns it, click your stairs to move them and Delete sells them. A diagonal wall costs 1.414 × a straight one per tile (it is √2 m long) and splits its tile into two halves that can belong to different rooms; nobody can stand on that tile and furniture can't go there (a diagonal door tile can be walked through). Draw a room's walls first, then add its door; only a resident or furniture can't be shut in.
- **Visits:** neighbours visit friends on their own. Open the town map (**M**) to send your resident to visit anyone; the view follows them.

| Input | Action |
|---|---|
| Left-click a resident / their card, Tab | Look at them (their panel) |
| Left-click another resident while looking at one of yours | Social menu (chat, flirt, argue, …) with success chances |
| Left-click an object | Interaction menu |
| Left-click the floor | Walk there (while looking at one of yours); otherwise close the panel |
| F · H · J · P | Follow the resident · whole house · journal · planner |
| Left-drag / right-drag / wheel | Rotate / pan / zoom |
| Left-drag on the lot (Walls, Remove) | Draw or tear down walls along the drag (at 45°: diagonal); right-click or Esc cancels. The camera then turns with middle-drag or by dragging off the lot |
| Space, 0–5 | Pause, game speed (4, 5: time-lapse) |
| W | Walls up → cutaway → down |
| M | Town map (who's home, visiting) |
| L / V / B | Live / Buy / Build mode (V or B again goes back to Live) |
| R, Delete | Rotate / sell the object in hand or selected (Buy mode) |
| Esc | Steps back: put down what's in hand, leave Buy or Build mode, close the journal, stop following, close a resident's panel — then the pause menu (save, load, settings, quit) |
| F3 | Performance overlay (with *Save debug report*) |
| F8 | Save a debug report: screenshot, game state and recent errors. With `pnpm dev` it goes to `debug-reports/<time>/` in the project; open `?debugReport=<time>` to load it with the same camera. Other builds download it as a file. |

URL options: `?quality=low|medium|high|ultra`, `?renderer=webgl`, `?snapshot=0`, `?seed=42`, `?lot=starter`, `?pack=packs/my-art/manifest.json`.

## Architecture

```
Main thread                                   Sim worker
┌───────────────────────────────┐            ┌──────────────────────────┐
│ ui/      Svelte HUD (~10 Hz)  │◄─ ui ──────│ sim-wasm → sim-core      │
│ game/    composition + input  │── cmds ───►│ fixed 20 Hz tick         │
│ render/  Renderer (GPU)       │◄─ shared ──│ snapshot (seqlock, SAB)  │
│ assets/  manifest registry    │   memory   │ world geometry on change │
└───────────────────────────────┘            └──────────────────────────┘
```

**Module boundaries.** Each folder can be changed or replaced without touching the others.

| Module | Owns | Must not |
|---|---|---|
| `crates/sim-core` | All game rules: needs, AI, pathfinding, town, social life, saves, geometry generation | Know about browsers, rendering or asset files |
| `crates/sim-wasm` | JS bindings | Contain game logic |
| `web/src/core` | Worker, bridge, protocol, snapshot channel | Render or touch the DOM |
| `web/src/render` | Everything drawn; `types.ts` is the contract | Contain game rules; allocate per frame |
| `web/src/assets` | Key → file/placeholder resolution | Hard-code art anywhere else |
| `web/src/ui` | Svelte components, design tokens (`theme.css`) | Talk to the worker directly (use `services.controls`) |
| `web/src/game` | Wiring and input (the only place that knows every module) | Grow logic that belongs in a module |

**Performance rules**
- The CPU runs the game; the GPU draws it. The main thread uploads one snapshot per tick and replays recorded GPU commands (WebGPU snapshot rendering).
- Every object type is one draw call (thin instances); residents are thin instances whose matrix buffer is updated once per frame.
- No allocations in the frame loop or the sim tick. The snapshot layout is defined once, in Rust.
- The UI gets changes only, at about 10 Hz, never the whole view and never per frame.
- Import Babylon through `web/src/render/babylon/core.ts`, never from the `@babylonjs/core` root (that pulls in the whole engine).

## Replacing art

All art is referenced by **key**, never by path:

- `web/public/content/base.json`: gameplay data. Objects name their model key (`"model": "model.fridge"`); needs name their icon key.
- `web/public/assets/manifest.json`: maps keys to files or placeholders.

To use a real model, add a `url` to the entry (the placeholder stays as the fallback):

```json
"model.fridge": { "type": "model", "url": "models/fridge.glb", "scale": 1, "rotationY": 0, "placeholder": [ … ] }
```

To ship a whole art set without editing the base manifest, create a pack and list it under `"packs"` (or load it with `?pack=`):

```json
// web/public/assets/packs/hd/manifest.json — keys here override the base manifest
{ "version": 1, "entries": { "icon.need.hunger": { "type": "icon", "url": "icons/hunger.png", "mode": "image" } } }
```

Model conventions: 1 unit = 1 metre, origin at the footprint centre on the floor, front facing +Z. Monochrome SVG icons are recoloured by CSS (`mode: "mask"`); use `mode: "image"` for full-colour art.

## Adding gameplay content

Everything gameplay-related is JSON in `web/public/content/`:

- `base.json`: needs, genders, traits, perks, objects, **social interactions** (requirements, success chances, outcomes, animation), emotions, feelings, bond presets, social rules, **careers** (levels, pay, hours, workdays, work effects), **daily schedule** windows, visit rules, starting funds, story-feed texts.
- `houses.json`: house layouts and the park, stamped onto town plots.

Add an object to `content/base.json` (footprint, interactions, need effects, model key), add its model key to the manifest, and place it in a lot file under `content/lots/`. `cargo test` validates the shipped content (`crates/sim-core/tests/shipped_content.rs`).

Pack authors: see [docs/content-packs.md](docs/content-packs.md). The look of the world is described in [docs/design/look.md](docs/design/look.md).

## Versions

The current version is **0.1.0**, the first release. One version number covers the whole game: `web/package.json` (shown in the main menu and Credits) and the Rust workspace in `Cargo.toml`. `node tools/release/version.mjs` prints it and fails if the two differ (the deploy workflow checks this); `node tools/release/version.mjs 0.2.0` sets both. Each release is a git tag `vX.Y.Z` with notes in [CHANGELOG.md](CHANGELOG.md). Saves have their own format version (`SAVE_VERSION` in `crates/sim-core/src/save.rs`), so saves made before 0.1.0 still load.

## Licence

The code is released under the [MIT licence](LICENSE). Third-party art keeps its own licence: everything listed in [`web/public/assets/CREDITS.md`](web/public/assets/CREDITS.md) is CC0.
