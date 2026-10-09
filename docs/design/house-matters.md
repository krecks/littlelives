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

Nothing happens today when a need reaches 0. With the house mattering:

- **Bladder at 0** with no toilet in time: an accident (a puddle: lots of dirt on the tile,
  hygiene drops, an embarrassed feeling, a story event).
- **Energy at 0**: the resident falls asleep where they are (on the floor; slow rest, a sore
  back after). Without a bed, a sofa nap is the better fallback.
- **Hunger** with no food at home: they go out to eat (away for an hour, costs money).
- **Hygiene**: a sink washes when there is no shower; at 0 they feel grubby (others like
  chatting with them less).

These make a missing bed, toilet or fridge visible within a day, and a crowded bathroom
(the soak test's finding) shows as waiting and the occasional accident.

## Opinions and wishes

Residents form opinions about the rooms they spend time in (checked a few times a day):

- A room scoring above `roomRules.love` → a good thought ("loves the living room"), now and then
  a good feeling.
- A room below `roomRules.dislike` → a bad thought about its worst factor, and a **wish**:
  - light → "a lamp for the bedroom" (*Find in catalog*: things that give light),
  - decor → "something nice for the bedroom" (*Find in catalog*: decor and plants),
  - size → "a bigger bathroom" (opens Build mode),
  - cleanliness → "a cleaner kitchen" (no purchase: someone should tidy up; the planner's
    chores),
  - function → the missing essential ("a shower") or "a room of its own" for a mixed room.
- Waiting a long time for a busy toilet or shower → "a second bathroom".
- A broken object → "the shower fixed" (Repair).

Wishes extend the planner's wishes (they already link to the catalog) and come true when the
room gets better or the thing is bought. Thoughts reuse the bubble system (new kinds: room
loved, room disliked, broken, accident).

## Interface

- **Our home** panel (top bar): every room of the house with its kind, size and the five scores
  as bars, its overall score, who loves or dislikes it, its wishes, what's broken (Repair) and
  how dirty it is. The garden too.
- **Room scores overlay** in Build mode (a toggle): each room's floor tinted from red to green
  by its score, with a tag showing its kind, score and weakest factor.

## Saves

Version 12: per-tile dirt (sparse `[x, z, dirt]`), object `wear`, the environment need (needs
are saved by id, so older saves load with it at a neutral value), new wish kinds. Older saves
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
