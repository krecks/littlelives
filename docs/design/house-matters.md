# The house matters (0.11)

*Status: in progress on `build-and-watch`. Roadmap: PLAN.md section 8.*

Building is the main activity, so the house has to show up in how residents live: what a room
is like changes how they feel and what they choose, missing essentials have visible
consequences, and residents say what they'd like next. Watching tells you what to build.

Everything here is data-driven (content), runs in the simulation (deterministic, saved), and
speaks in ids and numbers (the UI formats text from content), like the planner.

## Rooms (`sim-core/src/rooms.rs`)

Rooms are the lot's enclosed areas (`Lot::compute_rooms`). Their ids change whenever walls do,
so nothing is saved per room: room data is recomputed from the lot, the objects and the per-tile
dirt whenever the structure changes (cached like the planner's house offers), and anything that
must last (dirt) is kept per tile.

Per room, on the plot it belongs to:

| Field | From |
|---|---|
| `tiles` | indoor tiles (a split tile counts half) |
| `windows`, `doors` | openings on its boundary |
| `lamps` | objects with `light` inside |
| `kind` | content `roomKinds`: the first kind whose required tags are offered by an object in the room (bathroom: `bathroom`; kitchen: `cooking`; bedroom: `sleep`; living: `lounge` / `entertainment` / `screen`; study: `reading` / `training`), else `empty` |
| `mixed` | objects of two incompatible kinds (a bed in the kitchen, a toilet in the living room) |
| `decor` | content `decor` points of the objects in it (plants, lamps, decor; times quality), plus chosen wall and floor coverings |
| `dirt` | mean of its tiles' dirt |

The garden of each plot is scored as one more "room" (outdoor tiles of the plot): plants, trees
and garden decor, and its size.

**Scores**, each 0..1, and an overall score:

| Factor | Score | Weight |
|---|---|---|
| Size | tiles against the kind's `size: [cramped, comfortable]`: below `cramped` it falls to 0, between the two it rises from 0.5 to 1 | 0.20 |
| Light | daylight from windows (one window per 6 tiles is full) and lamplight (one lamp per 10 tiles is full), averaged | 0.20 |
| Decor | decor points per tile against `decorPerTile` | 0.20 |
| Cleanliness | 1 − dirt | 0.25 |
| Function | 1 with the kind's essentials and nothing out of place; `mixed` 0.6; `empty` 0.4 | 0.15 |

Weights and thresholds live in content (`roomRules`), so the balance can move without code.

## Environment need

An eighth need, `environment` ("Surroundings"), the one free need slot. It doesn't decay on a
timer: it drifts towards the score of where the resident is (`roomRules.drift` per hour), so
time in a nice room lifts mood and time in a dark, dirty or cramped one lowers it (mood is the
mean of the needs). At work it drifts towards a neutral 0.6.

The utility AI prefers doing things in better rooms: a candidate's score is scaled by
`1 + preference × (roomScore − 0.5)`, stronger the lower the resident's environment need. So a
nicer living room gets used more, and a resident with a choice reads in the bright room.

## Dirt and cleaning

Dirt is per tile (0..1, saved sparsely). Using things makes a mess around them: interactions add
dirt to the tiles around their object by tag (`roomRules.dirt`: cooking 0.12, food 0.06,
bathroom 0.05, hygiene 0.04; content can set `dirt` on an interaction). Accidents add a lot.

Cleaning is a resident action, not an object: when a room at home is dirty, "Tidy up" becomes a
candidate on its dirtiest tile (tags `chores`, `cleaning`; the clean animation already exists).
It takes a few minutes, clears the dirt around that tile, and the neat like it while the
slobs rarely bother (trait tag preferences). The planner's *Chores* activity counts as offered
wherever there is dirt to clean, so a planned chores block does the cleaning.

## Wear and repairs

Objects wear with use (`wear` 0..1, saved): each completed use adds the object's `wearPerUse`
(content, default by category; better quality wears slower). At 1 the object breaks: its
interactions stop working until it is repaired, it shows as broken, and residents who wanted it
are annoyed (feeling) and wish it fixed.

Repairs: a resident with the time does it ("Repair", tag `chores`, trains and uses
`handiness`; with low skill it may take two tries), or the player pays for a quick fix in Buy
mode (a share of the price; free in Creative). Selling a broken object brings back less.

## Essentials, fallbacks and accidents

Content `accidents`: when a need has been empty for `graceMinutes` and the home has nothing
working that fills it (no toilet, no bed, no fridge, or it's broken):

- **Bladder at 0**: an accident (a puddle: lots of dirt on the tile, hygiene drops, an
  embarrassed feeling, a story event).
- **Energy at 0**: the resident falls asleep where they are (on the floor for two hours; a sore
  back after).
- **Hunger at 0**: they order takeout (eaten on the spot; costs money).
- **Hygiene at 0**: they feel grubby (others' friendly chats go less well).

With the essential at home but busy (a crowded bathroom), nothing happens unless the content
sets `crowdedGraceMinutes`: the first version fired then too, and residents let needs sit at
0 so often (an AI gap, see PLAN.md) that accidents drowned out the story.

## Opinions and wishes

Once an hour each awake resident at home forms an opinion of the room they're in
(`rooms::opinions`):

- A room scoring at least `roomRules.love` → now and then a good thought ("loves the living
  room") and the `loveFeeling`.
- A room at most `roomRules.dislike` → a bad thought about it, the `dislikeFeeling`, and a
  **home wish** about its weakest factor:
  - light → "More light in the bedroom" (*Find in catalog*: things that give light),
  - decor → "Something nice for the bedroom" (*Find in catalog*: decor; garden things for the
    garden),
  - size → "A bigger bathroom" (opens Build mode),
  - cleanliness → "A tidier kitchen" (nothing to buy: someone should tidy up),
  - function → "Everything a kitchen needs" (*Find in catalog*: its essentials).
- A broken object at home → "The shower fixed" (Repair: the paid quick fix) and a thought.
- Finding the bathroom taken while badly needing it (a need with an accident, below 0.15) on two
  different days within a week → "A second bathroom" (Build). Only room kinds with
  `another: true` ask for this; without the repeat rule nearly every shared home wished for one.

Home wishes (at most four per resident, saved by id) come true and go when the room's factor
reaches 0.6, the thing is fixed, or there are two rooms of the kind (or nobody waited for two
weeks). They show in the planner's Goals panel next to the activity wishes. Thoughts reuse the
bubble system (new kinds: room loved, room disliked, broken, accident) with the room kind's icon,
the object's icon or the need's icon, and residents say a line for each.

## Interface

- **Our home** panel (top bar in Live, `O`): the house's score (rooms weighted by size), then
  every room worst first with its kind, size, overall score and the five factors as bars (the
  weakest marked), windows, lamps and dirt, what's off (two rooms in one, a missing essential,
  nothing that says what it's for), and who wishes what for it. Above them: broken things with
  Repair, and wishes for another room. *See it on the floor plan* opens Build mode with the
  overlay.
- **Room scores overlay** in Build mode (top bar toggle, `O`): each room's floor tinted from red
  to green by its score (`Renderer.setRoomOverlay`, one thin-instance film per tile), with a tag
  over its centre showing its kind, score and what would help most (`game/roomOverlay.ts`).
- Buy mode: a broken object says so, and owned worn things offer the quick fix (Repair).

## Saves

Version 12: per-tile dirt (sparse `[x, z, dirt]`), object `wear`, the environment need (needs
are saved by id, so older saves load with it at a neutral value), home wishes and the last day a
resident found the bathroom taken. Older saves
load clean and unworn.

## Build order

1. Rooms and scores (sim, content, view) with tests.
2. Environment need and room preference in the AI; balance check with the town soak test.
3. Dirt and cleaning.
4. Wear and repairs.
5. Essentials, fallbacks and accidents.
6. Opinions, wishes and thoughts.
7. Our home panel and the overlay.
8. Soak and balance pass, saves, docs.
