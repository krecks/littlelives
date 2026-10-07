# open-sims-wasm

A life-simulation game that runs in the browser. The game logic is written in Rust and compiled to WebAssembly; rendering runs on the GPU through WebGPU, with a WebGL2 fallback. The interface is Svelte 5 with plain CSS. Desktop only.

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
| `pnpm test:sim` | Run the Rust simulation tests |

**Hosting:** the server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. The dev and preview servers already do. Without these headers the game still runs, but snapshots are copied instead of shared.

## Playing

**New game:** create a neighbourhood (town size, neighbour households) → create your household (gender, who they're attracted to, looks, traits, perks, starting bonds) → choose a vacant house → move in. Everyone in town lives, works, socialises and falls in and out of love on their own; you control your household. Only the lot your selected Sim is on is drawn; the rest of the town keeps simulating in the background.

- **Jobs:** find one in the Sim panel's *Career* tab. Sims leave town for their shift, come home with pay (top bar), and get promoted when their performance bar fills. Mood when leaving for work drives performance.
- **Daily rhythm:** time-of-day schedules make Sims sleep at night, wash and eat in the morning and socialise in the evening.
- **Visits:** neighbours visit friends on their own. Open the town map (**M**) to send your Sim to visit anyone; the view follows them.

| Input | Action |
|---|---|
| Left-click your Sim / avatar, Tab | Select a household member |
| Left-click another Sim | Social menu (chat, flirt, argue, …) with success chances |
| Left-click an object | Interaction menu |
| Left-click the floor | Walk there |
| Left-drag / right-drag / wheel | Rotate / pan / zoom |
| Space, 0–3 | Pause, game speed |
| W | Walls up / down |
| M | Town map (who's home, visiting) |
| Esc | Pause menu (save, load, settings, quit) |
| F3 | Performance overlay |

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
- Every object type is one draw call (thin instances); Sims are thin instances whose matrix buffer is updated once per frame.
- No allocations in the frame loop or the sim tick. The snapshot layout is defined once, in Rust.
- The UI updates at about 10 Hz, never per frame.

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

- `base.json`: needs, genders, traits, perks, objects, **social interactions** (requirements, success chances, outcomes, animation), emotions, moodlets, bond presets, social rules, **careers** (levels, pay, hours, workdays, work effects), **daily schedule** windows, visit rules, starting funds, story-feed texts.
- `houses.json`: house layouts and the park, stamped onto town plots.

Add an object to `content/base.json` (footprint, interactions, need effects, model key), add its model key to the manifest, and place it in a lot file under `content/lots/`. `cargo test` validates the shipped content (`crates/sim-core/tests/shipped_content.rs`).
