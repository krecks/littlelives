# Littlelives: Technical Plan

*Status: v0.6.0 (2026-10-08). Direction changed on 2026-10-09: see "Game direction" below.*

A home-building game with a living simulation that runs entirely in the browser: Rust/WASM simulation core, a GPU renderer, a Svelte 5 + CSS interface, and saves stored in the browser.

## Game direction: build your home, then watch it live

**Building and designing your home is the main activity. The residents live in it on their own, and you watch them, like an aquarium or an ant farm.** You build everything; the simulation does the rest.

- **Watching is the default.** Left alone, Live mode directs its own camera: it glides to conversations, fights, first kisses, someone trying out the thing you just built, guests arriving, and otherwise slowly orbits the house or looks into a room. Any input hands the camera back.
- **You steer, you don't command.** Each resident has a **planner**: a weekly calendar of routines ("train 1 h at 18:00 Mon/Wed/Fri", "sleep 23–7", "cook dinner") and life goals ("get a job", "get promoted", "find love"). Routines are a strong nudge, not an order: urgent needs and traits can win, and mood and discipline decide how well residents stick to them. Residents also suggest goals of their own. Direct control (click an object, talk to someone) stays available from the Inspect panel.
- **The house matters.** Room size, light, decor, cleanliness and what a room is for change how residents feel and what they choose. A missing bed or toilet has visible consequences. Residents form opinions about rooms and wish for things, and wishes and planner gaps link straight to the catalog. Watching tells you what to build next.
- **Lives move on.** Residents find and lose jobs on their own, age, fall in love, move in together, have children, grow old, move out or pass away; newcomers arrive in empty houses. The house has to grow with the family.
- **One home, a living town.** You build one home; the rest of the neighbourhood keeps simulating and neighbours visit.
- **Creative or Living.** Each game is either Creative (building is free) or Living (the residents earn the money). Build and Buy mode pause time.
- **Start from an empty lot** or a ready-made house, with a family you design, a random one, or none yet ("build first, they move in later").

**Ground rules (from the project owner):**
- **Performance is the top priority.** The CPU runs the game logic; the GPU does everything visual.
- **Desktop only.** No mobile or tablet targets.
- **Modular and easy to maintain.** The project will be heavily adapted; every concern lives in its own module behind a small interface.
- **Art will be replaced.** Code and content refer to assets only by key; files are swapped through the asset manifest or override packs.
- **Art style:** modern, minimalist and stylised.

## Status

| Area | State |
|---|---|
| Sim core (Rust) | Needs, utility AI with smart objects, A* pathfinding, lot/rooms, mesh generation, clock. **Town** of plots and households with object ownership. **Social life**: directional relationships (friendship, romance, chemistry), 16 data-driven social interactions with success chances, feelings and emotions that steer behaviour, jealousy, partners and break-ups, fights, story events. **Gender and attraction**. **Daily life**: data-driven careers with shifts, pay, performance and promotions; time-of-day schedules; household funds; neighbours visiting each other (guests stay on the host's lot and use only non-private objects). **Careers and skills**: 1000 positions (25 categories × 4 tracks × grades A–J) expanded from `careers.json`; 12 skills trained at work and with home objects; skill fit decides hiring (probation), the workweek length and promotions. **Money**: dollars, weekly rent by lot size plus bills by household value, per-use costs only for consumables, debt. **Day/night rhythm**: sleep through the night, early risers for early shifts, slower need decay asleep, practice fatigue. **Build/buy** (`home.rs`): buy (auto or exact placement), move, sell, restyle (visual only), upgrade quality (instant Buy-mode purchase), walls (straight and diagonal), doors and windows with reachability checks; multi-slot objects (double beds). Save format v5 (diagonal walls; loads v1–v4). |
| WASM bridge | Sim in a Web Worker at 20 Hz; seqlock snapshot over SharedArrayBuffer (with conversation, emotion and animation fields); requests for saves and social options. |
| Renderer | **Only the viewed lot is drawn** (its walls/floors are generated per region; other houses appear as silhouettes; residents elsewhere or at work are hidden); the view follows the selected resident. Babylon.js 9.29 on WebGPU (WebGL2 fallback), thin instances everywhere, snapshot rendering, time-of-day lighting with a gradient sky dome and distance fog, procedural landscape (terrain hills, clustered forests, lawn detail), roads, swappable hair models, procedural conversation body language. Town plus landscape: about 105 draw calls at 60 fps. |
| UI | Main menu, settings, credits, load/save with thumbnails, pause menu. **Menus over a live 3D town** (`render/babylon/overview.ts`, `game/menuScene.ts`): the shared renderer draws a whole-neighbourhood overview (every lot as a dressed shell, street, gardens, park; golden hour on the title screen) behind every menu screen; the neighbourhood and home steps use it as a clickable map (lot glow, tags pinned to lots, camera glides), and Move in flies the camera into the lot. New game: **neighbourhood creator → household creator (gender, attraction, skin, hair, clothes, traits, perks, bonds) → home picker**. The household creator shows the in-game 3D resident (`render/preview`: a small second engine, only alive while the stage is shown or portraits are drawn) with drag-to-turn, zoom to the face and little reactions; avatars everywhere are 3D head-and-shoulders portraits, drawn in batches and cached by look. HUD: resident panel (Now / People / Feelings), social menu with chances, story feed, speech bubbles. |
| Not yet | See the roadmap in section 8. Also: renderer bake-off (M0), roofs and stairs in build mode, skinned characters, knocking/greeting visitors, lamps that give light, audio. (Cutaway walls and floor coverings are done.) Background simulation runs at full fidelity (cheap at town scale); a lower-detail mode for far-away lots would only matter for much larger towns. |

### Startup performance
- The renderer (engine, compiled shaders and pipelines, cached object meshes, landscape) is owned by a long-lived **game host** and reused across sessions; sessions only swap world contents.
- Sessions are **prepared in the background**, paused and without input: the latest save while the main menu is open, and the chosen house on the home screen. Their world builds hidden behind the menus' town overview (camera layer masks, `render/babylon/layers.ts`) and is drawn invisibly for a few frames so its shaders and pipelines are ready. Starting is then a reveal: a fade for a saved game, a camera flight into the lot for a new one. The overview and a new game of the same town share one landscape.
- Measured (production build, headless Chrome, M-series Mac): Continue 286 ms with 110 + 165 ms main-thread stalls → **48 ms, no long tasks**; Move in 397 ms → **98 ms, no long tasks**. The remaining cost of a cold start is WebGPU shader/pipeline compilation, which now happens while the player is still in a menu.

### Languages
The game is **English only for now; other languages will follow, for text and for the resident voices.** Until then, new work keeps translation possible:
- **The simulation speaks in ids and numbers, never sentences.** Story events carry kinds, residents, numbers, skill/career/goal indices; planner outcomes carry reason codes; goal text is formatted in the UI from the content's template (`goalText`). Remaining exceptions to clean up: command errors are English strings shown as toasts (they should become codes with parameters), and the journal's event templates and content labels are English text inside the content files.
- **Text comes from content by id.** Labels (needs, skills, activities, goals, objects, feelings, story templates in `events`) stay in content; translations will be locale files that override them by id (e.g. `content/locales/<lang>.json`), loaded like content packs. Templates use named placeholders (`{a}`, `{skill}`, `{n}`), not word order.
- **Interface strings** are still written in the Svelte components; they move to a string table when the first second language starts. Numbers, money and times go through formatting helpers (`ui/format.ts`) so they can switch to `Intl` per locale.
- **Voices** are recorded or synthesised per language (see `docs/design/voices.md`); spoken lines are keyed, not looked up by English text.

### Balance targets (Living mode)
`crates/sim-core/tests/balance.rs` states what Living mode should feel like: a working household saves about a room's worth or less per week (median $100 to two rooms, about $2,000), nobody holds more than $30k after 60 days, residents climb at most 4 grades (2 on average) in 60 days (`cargo test --release --test balance -- --ignored --nocapture`, 180 game days).
- Before the rebalance: median weekly savings $8,025, richest household $190k, 6.3 grades on average, up to 9.
- After: median $1,099, richest $28.8k, 1.7–1.8 grades on average, at most 3 (also on other town seeds). Pay grades $12–52/h (were $15–300/h); promotions about a third as fast (`performancePerShift` 2.5, `performancePerFit` 1, new `performancePerMood` 4, was a fixed 15); rent base $60 + $0.25 per tile; new living costs of $150 per resident in the weekly bills.
- Slower careers left the player's household with little news in a quiet week; goal ideas nobody answers are now taken on after two days (`planner.suggestionDays`), so an idle household still has something to work toward.

### Findings from the town soak test (0.7)
`crates/sim-core/tests/soak.rs` runs a 9-house town with free will on and no orders (14 days in every test run, 60 days with `--release -- --ignored`), checking world invariants every game hour. About 600k ticks/s for 26 residents natively, so even the fastest speed (1200 ticks/s) is far from the CPU budget.
- **Careers climb too fast and pay too much:** in 60 days residents reach the top grades and households hold $100–200k. Living mode (0.9) needs a pay and promotion rebalance, or building is never limited by money.
- **Crowded houses wear people down:** households of four with one bathroom have the lowest needs (residents wait for the toilet with bladder near zero). That's the house mattering; 0.11 should make it visible (thoughts, wishes) rather than hide it.
- **The story is thin on romance and conflict** over weeks (few first kisses, almost no fights); everyone ends up friends. Planner goals ("find love") and life events should give it more arcs.
- Planner (0.8): residents were woken by any urgent need, so a lonely resident spent nights walking between bed and nowhere. Only `dayRhythm.wakeFor` needs (bladder, hunger) end a night's sleep now. Practice that fits a planned block runs its full time; otherwise activities still end once the needs they fill are full (running practice to the end for everyone wore needs down across the town).
- Stable resident ids were moved from 0.7 to 0.12: nobody is removed before then, so the saved story log can keep naming residents by index and is converted when 0.12 loads it. Thought bubbles moved to 0.8 (thoughts come with the planner).

### Known issues and findings from the first build
- **Babylon SSAO2 on WebGPU fails to bind its sampler on about 1 in 4 startups** (`randomSampler not found`, then `createBindGroup` errors and a frozen frame). It still fails when the pipeline is created late, so ambient occlusion is off by default; `?quality=ultra` turns it back on for testing upstream fixes.
- **Standard-mode snapshot rendering bakes light uniforms and the clear colour into the recording.** The renderer re-records whenever lighting changes, throttled to every 5 game minutes. Moving residents (thin-instance buffers) and helper meshes update without re-recording.
- **Bundle size:** importing Babylon from the package root produces a 6 MB (1.3 MB gzip) chunk. Switching to deep imports is a planned clean-up.
- **Diagonal walls (limits):** movement stays on whole tiles, so the tile a diagonal wall crosses is closed to walking and furniture (its two half-triangles are dead space; a diagonal door tile is walked through). Residents do walk the corridor between two parallel diagonals. Roofs: a convex indoor outline with diagonal sides gets an exact hip roof over that outline; other shapes (e.g. an L with a diagonal corner) get the usual rectangles over their tiles, with split tiles covered whole (a deeper eave over the outdoor half). Neighbours' houses with diagonals are drawn as their bounding box. Landscape trees aren't removed when a room is built over them (straight walls too).

---

## 1. Research summary: which renderer?

The renderer is the decision that matters most for performance, so I compared the options against **what a life-sim actually draws**:

- **Hundreds to thousands of unique furniture/wall pieces.** Many separate meshes, each with its own material.
- **Many small lights.** Lamps, TVs and fireplaces mean dozens of point lights per lot.
- **Sun shadows plus post-processing**, for the "stunning" look.
- **5–30 skinned characters**, each with blended animations.
- Mostly static scenes. The house changes only in build mode.

### Benchmark data (three.js r186, PlayCanvas 2.22, Babylon.js 9.26; Chrome/Firefox/Safari, M1 Pro)

| Workload (relevant to us) | PlayCanvas | three.js | Babylon.js |
|---|---|---|---|
| 5k separate animated meshes (CPU) | **12 ms** | 29 ms | 24 ms |
| 100 materials (CPU) | **13 ms** | 30 ms | 41 ms |
| 32 forward point lights (GPU) | **1.3 ms** | 53 ms | n/a |
| Sun + spot shadows + bloom/ACES (CPU) | **21 ms** | 52 ms | 78 ms |
| 50 complex skinned characters | **6.5 ms** | 18–22 ms | 18–22 ms |
| 50k instanced meshes | tie (1–2 ms) | tie | tie |
| Bundle / first frame | ~0.6–1 MB | **~170–300 KB, ~100 ms** | ~1.8 MB |

Sources: [webgpu-webgl-benchmarks](https://github.com/mvaligursky/webgpu-webgl-benchmarks), [web-engines-compare](https://github.com/mvaligursky/web-engines-compare) (per-draw CPU cost: PlayCanvas 0.75 µs vs three.js 0.89 µs vs Babylon 2.35 µs on macOS WebGL2).

**Caveat:** both benchmark repos are maintained by Martin Valigursky, the second-largest contributor to the PlayCanvas engine. The methodology is open and reproducible, but we **re-measure on our own scene** before committing (see Milestone 0).

### Other findings

- **three.js WebGPURenderer has a known slowdown on scenes with many separate meshes.** It does a lot of per-object bind-group and buffer work, about 2× the CPU of its own WebGLRenderer, and no fix has landed ([forum thread](https://discourse.threejs.org/t/webgpurenderer-2x-slower-cpu-and-5-10x-slower-first-frame-than-webglrenderer-on-many-mesh-scenes-r183-same-on-both-backends/91904)). A house full of furniture is exactly that kind of scene.
- **WebGPU is not automatically faster.** Without instancing, the WebGL2 backends beat their own WebGPU backends in the benchmarks. Instancing and batching cut CPU cost 10–100× and **matter more than which engine we pick**.
- **Babylon.js** has *snapshot rendering* (it records a frame's GPU commands and replays them), which is great for static scenes, and clustered lighting since 9.0. But it was the slowest in Safari and has the heaviest bundle.
- **Custom Rust renderer (wgpu)** gives one language and maximum control. However, every WebGPU call from WASM still goes through JS glue code, so there is no free speedup. It also means building shadows, post-processing, skinning, a material system and a WebGL2 fallback ourselves. That is many months of work before the game looks good. Rejected for now.
- **Bevy (full Rust engine on the web)** means large WASM bundles, slow iteration, and in-engine UI that is weaker than Svelte/CSS. Rejected.
- **Browser support:** WebGPU ships in Chrome/Edge, Safari 26 (macOS and iOS), and Firefox on Windows and Apple-Silicon Macs. Firefox on Linux and Android is still missing, so **a WebGL2 fallback is required**.
- **Rust WASM threads still need nightly Rust** (`+atomics`, `-Zbuild-std`) plus cross-origin isolation. We avoid this. The simulation is cheap enough for a single thread, and we get parallelism from **Web Workers** instead.

### Decision

**PlayCanvas engine (npm `playcanvas`), used code-first with no cloud editor.** *(Superseded, see the update below: the M1 skeleton is built on Babylon.js because of its WebGPU snapshot rendering.)* It leads on every workload a life-sim stresses: many meshes, many materials, many lights, shadows plus post-processing, and skinned characters. It falls back to WebGL2 automatically.

**Update:** because everything visual should run on the GPU (section 2), **Babylon.js with snapshot rendering is now a third contender.** Its replay of recorded GPU commands fits our mostly static house, while PlayCanvas is still mainly a WebGL2 engine. Milestone 0 decides between the three.

The renderer stays behind a thin `Renderer` interface fed by plain data from the simulation. That keeps the engine choice reversible: if the Milestone 0 bake-off disagrees, swapping to three.js costs days, not months.

---

## 2. Architecture

```
┌──────────────────────── Main thread ────────────────────────┐
│  Svelte 5 UI (HUD, needs, build/buy catalog)  ◄─ 10 Hz store │
│  Input → commands                                            │
│  PlayCanvas renderer (60–120 fps, interpolates sim state)    │
└───────▲─────────────────────────────┬────────────────────────┘
        │ SharedArrayBuffer            │ SharedArrayBuffer
        │ (triple-buffered snapshots)  │ (command ring buffer)
┌───────┴─────────────────────────────▼────────────────────────┐
│  Sim Worker: Rust → WASM                                     │
│  fixed 20 Hz tick · needs · utility AI · pathfinding ·       │
│  lot/room graph · build-mode geometry generation · saving    │
└──────────────────────────────────────────────────────────────┘
        │ asset loads / saves
   Asset Worker (glTF + KTX2 decode)          OPFS / IndexedDB
```

**Core rule: the CPU runs the game, the GPU draws it.**

| CPU (Rust/WASM, sim worker) | GPU (WebGPU, WebGL2 fallback) |
|---|---|
| Game clock, needs, mood, AI decisions | Visibility culling (compute shader) |
| Pathfinding, interactions, relationships | Character skinning and animation blending |
| Lot/room logic, build-mode rules, picking | Shadows, lighting (clustered), ambient light |
| Saving and loading | Ambient occlusion, bloom, tonemapping, tilt-shift, colour grading |
| Writes **one compact snapshot per tick**; nothing else | Particles, cutaway walls, selection outlines, placement ghosts |
| | Time-of-day sky, weather, foliage sway (shaders) |

The main thread's only rendering job is to upload the snapshot and **replay pre-recorded draw commands**. It does no per-object work.

**Key principles**

1. **Sim and render are fully separate.** The sim runs at a fixed 20 Hz in a Worker, and the renderer interpolates between the last two snapshots. A slow frame never slows the sim, and a sim spike never drops a frame.
2. **No per-object JS↔WASM calls.** The sim writes a compact binary snapshot (positions, rotations, animation IDs, state flags) into a SharedArrayBuffer. The renderer reads it with typed arrays, with no copies, no serialization and no garbage-collection churn. Commands flow back through a lock-free ring buffer.
3. **The UI is not in the hot path.** Svelte receives a reduced view-model at about 10 Hz. Needs bars animate with CSS transitions, so the UI never forces per-frame DOM work.
4. **No garbage in the frame loop.** All per-frame JS buffers are pre-allocated. The Rust side allocates nothing in steady state.
5. **Cross-origin isolation** (`COOP: same-origin`, `COEP: require-corp`) is needed for SharedArrayBuffer. Fine for self-hosting, and Vite dev and Cloudflare/Netlify all support it. Fallback when unavailable: `postMessage` with transferable buffers.

**Later option:** if main-thread jank appears, move rendering to its own worker via `OffscreenCanvas`. The interface makes this a contained change.

---

## 3. Simulation core (Rust)

Pure Rust crate `sim-core` with **no browser dependencies**. It is tested and benchmarked natively with `cargo test` / `cargo bench`; a thin `sim-wasm` crate holds the bindings.

| System | Design |
|---|---|
| **Data model** | Data-oriented: structure-of-arrays storage with generational IDs. No ECS framework, to keep the WASM small and the code fast. |
| **Time** | Fixed 20 Hz tick; game clock with pause / 1× / 2× / 3× (3× = more ticks per real second, capped). Deterministic, seeded RNG. |
| **Needs and mood** | Hunger, energy, bladder, hygiene, fun, social, comfort, environment. Each decays along a curve; mood = weighted sum + feelings (temporary modifiers). |
| **AI ("smart objects")** | Objects *advertise* interactions with need deltas. Each resident scores them with need-weighted utility curves, distance cost and personality modifiers, then picks from the top-N with weighted randomness. Player commands go to a queue and override autonomy. This is the proven smart-object model of classic life sims. |
| **Interactions** | Small state machines: route to slot → animate → apply effects → exit. Multi-resident interactions (talking, sharing a sofa) reserve object slots. |
| **Pathfinding** | Tile grid (1 m tiles, 4 sub-positions); walls block tile edges; doors are portals. A* with Jump Point Search, a cached room-level graph for long routes, string-pulling for smooth paths. Slot reservation plus simple local avoidance between residents. |
| **Lot / build** | Multi-level tile grid; walls on edges, plus diagonal walls corner to corner across a tile (one per tile; rooms are found per half tile, so the two halves can be inside and outside); rooms found by flood fill (used by the AI, room lighting and cutaway). **Rust generates wall/floor meshes** into WASM memory; the renderer uploads them directly. |
| **Picking** | Ray against the tile grid and object bounding boxes, done in Rust. No GPU readback. |
| **Saving** | `postcard` binary format, versioned schema, written to OPFS (fallback IndexedDB). Autosave runs in the worker, so the frame never stalls. |

Performance budget: a sim tick under **1 ms for 8 residents** and under **3 ms for 50 residents** (neighbourhood scale later). WASM SIMD (`+simd128`) on; `wasm-opt -O3`; `lto = "fat"`, `opt-level = 3`, `panic = "abort"`.

---

## 4. Rendering and look

**Art direction: "warm miniature diorama".** Stylised low-to-mid-poly models, soft PBR materials, pastel palette, a toy-like scale feel. It ages well, scales across GPUs, and is achievable without a AAA art team.

**Quality features**

- Physically based materials with image-based lighting; a sky gradient and ambient light that **change with time of day** (golden hour, blue hour, warm lamp-lit nights).
- Sun: 2-cascade soft shadows; shadow updates throttled while nothing moves.
- Interior lamps: clustered lighting so dozens of lights stay cheap; shadow casting only on a budget of about 4 nearby lights.
- Ambient occlusion (SSAO), bloom, ACES/neutral tonemapping, subtle **tilt-shift depth of field** (the dollhouse look), vignette, a colour-grade lookup table per time of day.
- Selection outline, soft placement ghosts in build mode, glowing interaction targets.
- **Cutaway walls** (walls up / cutaway / down), done in the shader so it costs no CPU.

**GPU-first rendering (WebGPU path)**

- **Render bundles:** the draw commands for the house are recorded once and replayed every frame, so the CPU cost is close to zero. They are re-recorded only when build mode changes the house. (Babylon calls this "snapshot rendering".)
- **GPU culling:** a compute shader tests object bounds against the camera and writes `drawIndirect` arguments. The CPU never loops over objects.
- **GPU animation:** skinning in the vertex shader. Background/neighbourhood residents use baked vertex-animation textures, so hundreds cost almost nothing.
- **GPU particles:** compute-driven steam, fire, sparkles and mood effects.
- **All per-object data lives in GPU storage buffers** (transforms, material IDs, highlight state). Each tick, the snapshot from the sim is uploaded in **one** buffer write.
- **Limit:** multi-draw-indirect (one call for *everything*) is still experimental in Chrome (~0.25% of devices), so each draw is still one cheap call. Merged meshes, instancing and shared materials keep the count low (about 100–300).
- **WebGL2 fallback** (no compute shaders): CPU culling plus instancing, otherwise the same scene. Slower, but within budget.

**How we stay fast**

- Static walls and floors are merged into **one mesh per room chunk**, rebuilt only on build-mode edits.
- Furniture is **instanced by model** (every identical chair is one draw call).
- Texture atlases plus a small set of shared materials, which keeps material switches low.
- Characters: GPU skinning, 2–3 LODs, animation sampling skipped for off-screen residents.
- Frustum culling plus per-level culling (upper floors hidden in cutaway).
- Adaptive resolution: render scale drops before frame rate does.

**Targets:** 60 fps at 1080p on integrated GPUs (Apple M1, Intel Iris Xe) with about 300 draw calls or fewer per frame and main-thread CPU at 6 ms or less; 120 fps on discrete GPUs.

---

## 5. UI (Svelte 5 + CSS)

- Svelte 5 runes; plain CSS with design tokens (colour, radius, blur, motion) and **no UI framework**.
- Visual language: frosted glass panels (`backdrop-filter`), soft shadows, rounded geometry, one accent colour per mode (Live / Build / Buy), spring-based micro-animations, variable fonts.
- Panels: resident portrait plus mood ring, needs (circular gauges), interaction pie menu (radial, at the cursor), action queue, clock and speed control, build/buy catalog with 3D thumbnails rendered once and cached.
- Accessibility: keyboard shortcuts, reduced-motion support, scalable UI.
- Performance rules: no per-frame reactive updates; the catalog uses virtual scrolling; thumbnails are lazy-loaded.

---

## 6. Assets (replaceable by design)

- **Everything is referenced by key.** Content and code ask for `model.fridge`, `icon.need.hunger`, `material.wall` or `look.coral`, never for a file path.
- **`web/public/assets/manifest.json`** maps keys to files (`url`) or to placeholder primitives. Entry types: `model`, `material`, `icon`, `image`, `sprite`, `look`.
- **Override packs:** manifests listed in `packs` (or passed as `?pack=…`) override keys, so a new art set is a folder plus one line, with no code changes.
- **Graceful fallback:** a missing model becomes a neutral box and a missing icon a neutral glyph, so broken art never breaks the game.
- Format for real art: **glTF 2.0**, optimised with `gltf-transform` (meshopt, KTX2, dedupe, quantise). The loader bakes transforms so thin instancing keeps working.
- Starting library: CC0 packs (Quaternius, Kenney, Poly Haven); a **modular character system** (body + head + hair + outfits on one skeleton) for the household creator.

---

## 7. Repository layout (as built)

```
littlelives/
├─ crates/
│  ├─ sim-core/        # pure Rust simulation, no browser deps, native tests
│  └─ sim-wasm/        # thin wasm-bindgen layer
├─ web/
│  ├─ public/content/  # gameplay data: needs, objects, lots (JSON)
│  ├─ public/assets/   # asset manifest, icons, (later) models/textures/packs
│  └─ src/
│     ├─ core/         # sim worker, bridge, protocol, shared-memory snapshot
│     ├─ render/       # Renderer interface + babylon/ implementation
│     ├─ assets/       # manifest schema + registry
│     ├─ content/      # gameplay content loader (for UI labels)
│     ├─ game/         # composition root + pointer input
│     └─ ui/           # Svelte components, design tokens, UI state
└─ PLAN.md, README.md
```

The snapshot memory layout is **defined once in Rust** (`sim-core/src/snapshot.rs`) and read by TypeScript at startup, so the two sides can't drift apart.

---

## 8. Milestones

Done: M1 skeleton, living residents, look pass (lighting, shadows, tilt-shift, cutaway walls), Build and Buy (walls, diagonals, rooms, paint, floors, doors, windows, undo), household and town, persistence, household creator, careers and skills (v0.2–v0.6).

**Roadmap for "build your home, then watch it live"** (one release each; each bumps the save version and migrates older saves):

| Release | Theme | Done when |
|---|---|---|
| 0.7 | **Watch mode** + autonomy foundations | Stable resident ids; free will per household; the player's household visits on its own; residents find, quit and lose jobs on their own; saved story log with home and town scope; faster speeds and auto-fast at night; wall-straddle fix; town soak tests. Director camera, household strip, Inspect panel, Journal, thought bubbles, camera dock, "Watching" settings. |
| 0.8 | **Planner** | Per-resident weekly routines (strong nudge) and household templates; life goals with progress; goals suggested by residents; thoughts and wishes; calendar UI with drag/resize, today's timeline, outcomes with reasons, catalog links. |
| 0.9 | **Builder's start** | Creative/Living per game; empty lot; household optional ("move a family in" later); build and buy addressed to the household. |
| 0.10 | Build depth I | Incremental world updates; redo; eyedropper; roof style and colour; lamps that give light; fences and gates; free rotation for decor. |
| 0.11 | **The house matters** | Room scores (size, light, decor, cleanliness, function); environment need; dirt, wear and repairs; essentials with fallbacks and accidents; room opinions and wishes; room-score overlay and "Our home" panel. |
| 0.12 | Life cycle I | Aging, elders, death or retirement, partners moving in, grown children moving out, newcomers, family relations. |
| 0.13 | Life cycle II | Pregnancy and adoption, babies, children, teens, school; child and elder bodies. |
| later | Bigger homes | Lot sizes, blueprints, moving a room, then multiple storeys and stairs (1.0+). |
| in progress | **Resident voices** | The selected resident, and conversations the player starts, are spoken aloud by a model that runs in the browser: **Paradee-8M** for English (9 MB, downloaded on request), run by our own Rust/WASM engine (`crates/voice`) with a phonemizer that avoids GPL espeak-ng; optionally Kokoro-82M for more voices; and **Babble**, a made-up language with no download. A benchmark in Settings picks the model's mode (CPU or GPU) per machine. Presentation only, no sim changes. Stage 1 is in: Paradee through `tract` in a worker, English lines, Settings → Audio with a speed test. Plan: [docs/design/voices.md](docs/design/voices.md). |
| later | Smarter thoughts (research) | An optional small language model in the browser (Chrome's built-in Gemini Nano, or a ~0.6–0.8B Qwen model through Transformers.js) writes thoughts and dialogue for actions the utility AI already chose, feeding Resident voices. The utility AI keeps deciding; a model may at most re-rank its top-3 shortlist, entering the sim as a recorded command so saves and replays stay deterministic. Jev/OpenJev-style decision models were assessed (2026-10-09): no browser builds, 200–800 MB and slow next to utility scoring, so not used. |

Every release ships with native sim tests (including the town soak), `pnpm check`, and the frame-time budget checked.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Art and animation volume (the real bottleneck) | CC0 base packs, one consistent stylised art direction, modular characters. |
| Safari quirks (large shaders rejected, 60 fps cap) | Test Safari from M0 onward; keep shader permutations small. |
| No Firefox WebGPU on Linux | WebGL2 fallback is built in and tested (`?renderer=webgl`); budgets are measured on WebGL2 too. |
| Cross-origin isolation blocks third-party embeds | Self-host all assets; `postMessage` fallback path. |
| Benchmark bias toward PlayCanvas | M0 bake-off on our own scene decides. |
| Scope creep (life sims are huge) | Strict releases (section 8). Building and watching come first; direct control stays as it is. |
| Trademark ✅ | Done: the project is called Littlelives (see "Naming" below). Use only original or licensed art. |

---

## 10. Decisions made

1. **Devices:** desktop only.
2. **Art direction:** modern, minimalist and stylised; all art is replaceable through the manifest.
3. **Name:** Littlelives (`littlelives` in slugs).
4. **Licence:** MIT for the code; third-party art keeps its own licence (CC0, see `web/public/assets/CREDITS.md`).

### Naming

The project was first called `open-sims-wasm`. Before going open source it was renamed to
**Littlelives** to stay clear of Electronic Arts' trademarks:

- Display text says *Littlelives*; slugs (package name, file names) use `littlelives`.
- Characters are called **residents** in everything a player or pack author reads.
- The temporary mood modifiers are called **feelings**. Content packs and saves written with the
  old key names still load (serde aliases in sim-core, `LEGACY_KEYS` in both content mergers).
- Kept on purpose: the repository folder, the crate names `sim-core` / `sim-wasm` ("sim" for
  simulation), code identifiers such as `sim` and `SimView`, and the browser storage keys
  (`open-sims-wasm` IndexedDB database, `open-sims-wasm.settings`) so existing saves and
  settings survive.
- Credits and the README keep a short nominative disclaimer naming EA's trademark.
