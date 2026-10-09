# Content packs

A content pack adds objects, feelings (and other content) to the game without touching
`base.json`. Packs are plain JSON, merged into the base content when the game loads; the
simulation (Rust) and the web UI (TypeScript) merge them the same way.

```
cargo run -q -p sim-core --example check_pack -- web/public/content/packs/<name>.json
```

Run the checker after every change (see [Checking a pack](#checking-a-pack)).
`web/public/content/packs/example.json` uses every feature described here.

## File location and loading

- Put the pack in `web/public/content/packs/<name>.json`.
- Add it to the `"include"` list at the end of `web/public/content/base.json`, after
  `careers.json`: `"include": ["careers.json", "packs/example.json", "packs/<name>.json"]`.
- Files are merged in that order: base, careers, then packs.
- Keep ids unique across *all* files. Prefix ids with your pack's theme when in doubt
  (`zenTeaSet`, not `teaSet`), because another pack may want the obvious name.

## Merge rules

Applied file by file (`sim_core::pack::merge_content` in `crates/sim-core/src/pack.rs`,
mirrored by `mergeContent` in `web/src/content/content.ts`):

| Top-level value | Rule |
|---|---|
| array (`objects`, `feelings`, `emotions`, `buyCategories`, `socials`, `skills`, `tags`, `animations`, ...) | appended. An `id` that appears twice in the same merged array is an error naming both files. |
| object (`economy`, `skillRules`, `bondPresets`, ...) | merged shallowly: your keys are added or replace existing keys, other keys stay. |
| anything else | replaced. |
| `traitPatches` | merged *into* existing traits (below). Never copied into the result. |
| `include`, `$comment` | dropped. Use `$comment` for notes. |

A key whose type differs from earlier files (array in base, object in your pack) is an error.
Packs should normally only add `objects`, `feelings`, `tags`, `buyCategories` and
`traitPatches`; don't replace global rules (`economy`, `skillRules`, ...) from a trait pack.

**Older packs:** feelings had a different name in early versions of the game. Packs that
still use the old key names (for the list, the interaction fields and the social and rule
fields) load unchanged: both mergers rename the keys first (`LEGACY_KEYS` in `pack.rs` and
`content.ts`). Use the `feeling` names in new packs.

### `traitPatches`

```json
"traitPatches": {
  "lazy": {
    "effects": { "tagPreference": { "spa": 1.6 }, "needGain": { "comfort": 1.1 }, "mood": 0.02, "walkSpeed": 0.95 },
    "startingSkills": { "cooking": 1 }
  }
}
```

- The trait must exist (else: error).
- `effects.needDecay`, `needGain`, `tagPreference`, `tagAcceptance`, `tagSuccess`,
  `skillGain`, and `startingSkills`: entries are set per key (yours win; the trait's other
  entries stay). A later pack patching the same key wins.
- `effects.mood` is **added** to the trait's mood; `effects.walkSpeed` is **multiplied**.
- Other keys are errors. Patch only your own trait, so packs don't fight.

## Objects

```json
{
  "id": "chefStove",
  "name": "Chef's stove",
  "model": "model.chefStove",
  "icon": "icon.object.chefStove",
  "footprint": [2, 1],
  "price": 1500,
  "category": "kitchen",
  "slots": 1,
  "description": "Six burners and a proper oven.",
  "interactions": [ ... ]
}
```

| Field | Meaning |
|---|---|
| `id` | Unique object id (camelCase). |
| `name` | Shown in the catalog. |
| `model` | Asset key of the 3D model (`model.<id>`). Art is registered separately in the asset manifest; a missing key logs a warning and falls back to a placeholder. |
| `icon` | Optional catalog icon key. Without one (or if the key is missing) the catalog shows a picture of the 3D model. |
| `footprint` | `[width, depth]` in tiles, default `[1, 1]`. The resident uses it from the tile in front of the footprint's centre (local +z), which must be free. |
| `price` | Buy-mode price in dollars. Without a price the object isn't sold (scenery). |
| `category` | Buy-mode category id (see [Buy categories](#buy-categories)). |
| `group` | Optional group within the category, for categories that have `groups` (the garden: `trees`, `shrubs`, `flowers`, `edibles`, `houseplants`). The catalog shows the groups as chips. |
| `outdoors` | `true` for things that can only stand outdoors (trees, flower beds, ponds). Buying or moving one indoors is refused ("Goes outdoors"). Default `false`. |
| `slots` | How many residents use it at once, 1 or 2 (double bed, sofa, hot tub). Default 1. |
| `light` | Lamps: `{"range": 4.5, "intensity": 1, "height": 1.55}` makes it a light at night (reach in metres, relative brightness, bulb height). |
| `freeRotation` | `true` lets the player turn it to any angle in 15° steps (only for looks). Default: 1×1 objects whose category is listed in `objectRules.freeRotation` (base game: `decor`, `garden`, `outdoor`). |
| `description` | Catalog text: say what it's for and what makes it special. |
| `interactions` | What residents can do with it (below). Can be empty for decor. |

### Interactions

```json
{
  "id": "cook",
  "label": "Cook a hearty meal",
  "anim": "cook",
  "minutes": 45,
  "effects": { "hunger": 0.8, "fun": 0.15 },
  "tags": ["food", "cooking"],
  "skills": { "cooking": 0.2 },
  "pose": "stand",
  "autonomous": true,
  "cost": 6,
  "skill": "cooking",
  "feeling": "deliciousMeal",
  "feelingMinSkill": 4
}
```

| Field | Meaning |
|---|---|
| `id`, `label` | Unique within the object; the label is the menu text ("Soak in the tub"). |
| `anim` | What the resident is shown doing while using it: one tag from the content's `animations` list (see [Animations](#animations)), e.g. `eat` for a snack, `cook` for a meal, `wash` at a sink, `type` at a computer. An unknown tag is an error. Optional, but give every interaction one; without it the game guesses from `tags`, `pose` and `effects`. |
| `minutes` | Game minutes for the whole interaction (> 0). Residents stop early when every need it raises is full. |
| `effects` | Need id → total change over the full duration (0..1 scale; negative = a cost, e.g. a workout makes you sweaty). Gains are spread evenly over the minutes. |
| `tags` | Tag ids (see [Tags](#tags)): drive trait/emotion/schedule preferences, "busy" (can't be interrupted by a chat) and what counts as sleep. |
| `skills` | Skill id → levels gained per hour of use (before the per-level slowdown). |
| `pose` | `stand` (default), `sit` or `lie`. |
| `autonomous` | `false` = only when the player asks. Default `true`. |
| `cost` | Dollars charged from the resident's household each time a resident **starts** using it (on arrival). Default 0. Only for real consumables bought from outside (takeout, deliveries, a rented movie, donations); owning and running an item costs money through the weekly bills instead. Residents never choose something their household can't afford, and the player's order fails with "not enough money". Guests pay from their own household. |
| `skill` | Skill id that makes this interaction better: need gains and skill gains are multiplied by `1 + skillRules.effectPerLevel × level` (0.05 per whole level: level 4 = ×1.2, level 8 = ×1.4). Autonomy knows this, so good cooks prefer cooking. |
| `feeling` | Feeling id granted when the interaction finishes after at least half its `minutes` (not when cancelled early). |
| `feelingMinSkill` | Only grant `feeling` if the resident's whole level in `skill` is at least this (needs `skill` and `feeling`). Default 0. |

### How the multipliers stack

Per need, each tick: `gain/min × needGain (traits × perks × active feeling buffs) × quality × skill`

- quality: `1 + objectRules.qualityBonus × stars` = +25% per upgrade star (0–3 stars, bought in Buy mode);
- skill: `1 + 0.05 × level` for interactions with `skill`.
- Negative effects (costs) are not multiplied.

Skill gains: `skills[s] × quality × skill factor × trait skillGain / (1 + level × 0.25)`.
So a 3-star object used by a level-8 resident gives `1.75 × 1.4 = 2.45×` the listed need gains.
Balance the listed numbers for a **0-star object and a level-0 resident**.

## Feelings

```json
{
  "id": "relaxed",
  "label": "Relaxed",
  "emotion": "relaxed",
  "mood": 0.08,
  "hours": 8,
  "effects": { "needGain": { "energy": 1.25, "comfort": 1.2 } }
}
```

| Field | Meaning |
|---|---|
| `id`, `label` | Unique id; label shown in the resident panel. |
| `emotion` | Optional emotion id. The resident's emotion is that of its active feeling with the largest `|mood|`; the emotion biases what the resident wants to do. |
| `mood` | Added to mood while active (range used so far −0.25..+0.2). |
| `hours` | How long it lasts (> 0). Getting it again refreshes the timer. |
| `effects` | Optional buff/debuff while active, same shape as trait effects: `needDecay`, `needGain` (need → multiplier), `tagPreference` (tag → autonomy multiplier), `tagAcceptance` / `tagSuccess` (tag → added success chance of socials), `walkSpeed` (multiplier), `skillGain` (skill → learning multiplier). Do **not** put `mood` here; use the feeling's `mood`. |

Buffs combine with traits and perks multiplicatively (acceptance/success add) and vanish
when the feeling expires. Typical sizes: multipliers 1.1–1.5 (0.7–0.9 for debuffs).

## Tags

Tags in use (64 maximum for the whole game, base plus all packs):

| Tag | Used by |
|---|---|
| `food` | fridge snack/meal/gourmet, coffee at the dining table |
| `cooking` | fridge meal, gourmet |
| `training` | anything practised for skill (gourmet, study, treadmill, weights, chess, computer, easel, mirror, workbench, telescope, piano) |
| `creative` | write (computer), paint (easel), play (piano) |
| `fitness` | treadmill, weight bench |
| `reading` | bookshelf |
| `screen` | TV, computer |
| `entertainment` | TV, read, chess, browse, piano |
| `rest` | sleep, nap, sofa |
| `sleep` | bed sleep (counts as a night's sleep: `dayRhythm.sleepTags`) |
| `nap` | bed nap |
| `lounge` | sofa, armchair, bench, coffee |
| `spa` | whirlpool tub (example pack); declared in base.json `tags` |
| `hygiene` | sink, shower |
| `bathroom` | toilet |
| `chores` | water plant, tend flowers |
| `nature` | plant, flowerbed |
| `outdoors` | bench, flowerbed, telescope |
| `social`, `friendly`, `fun`, `touch`, `romantic`, `breakup`, `mean`, `violent`, `makeup` | socials (conversations) |
| `visit` | built in: visiting another household |

Special meanings: `sleep`, `bathroom`, `hygiene`, `nap` make a resident busy (no chats, guests
can't use them); `romantic` socials need attraction; `sleep` lasts through the night.

**Adding a tag:** reuse an existing tag whenever it fits. Add one only if a trait, emotion,
schedule or buff must tell your objects apart. A tag exists once any interaction uses it;
to refer to a tag before anything uses it (e.g. in a `traitPatches` preference), declare it
in a top-level `"tags": ["myTag"]` array. Unknown tags in effects are errors. With 15 packs
sharing 64 slots (28 in use), **add at most two new tags per pack**.

## Animations

The renderer can't tell eating from cooking by where a resident stands, so each interaction
names an animation tag in `anim`. The tags are declared once, in the top-level
`"animations"` list in `base.json`; that list (in that order) is what the render snapshot
sends as `layout.actions`, and each resident's `sim.action` float is an index into it (-1 =
nothing). The snapshot also sends `sim.object`, the id of the object the resident is using or
walking to (-1 = none); `sim.action` is set only once the resident is actually using it, and
is `talk` during conversations.

| Tag | Use it for |
|---|---|
| `eat` | eating food: fridge snack, takeout, a meal at the table |
| `cook` | preparing food at a counter, stove or oven (fridge meal, gourmet, baking) |
| `drink` | coffee, tea, sodas, smoothies, mocktails |
| `wash` | sink, quick grooming (spritz, vanity) |
| `shower` | standing showers |
| `bath` | tubs, hot tubs, cold plunges |
| `toilet` | toilet |
| `sleep` | a night's sleep in bed |
| `nap` | naps and dozing (bed, sofa, hammock, recliner) |
| `sit` | just sitting (armchair, bench) |
| `relax` | lounging: sofa, recliner, hammock swing, sauna, warming up |
| `type` | keyboards and touch panels: computer desk, programming a device |
| `write` | pen and paper: letters, journals, poems, ledgers |
| `read` | books, magazines, recipes |
| `watch` | TV and movie screens |
| `look` | looking at something: stargazing, birdwatching, gazing out of a window, photos |
| `admire` | looking up at a tree's crown or blossom |
| `smell` | bending down to low flowers, watching fish in a pond |
| `listen` | listening to records or a story |
| `play` | games: chess, puzzles, consoles, arcade |
| `music` | playing an instrument: piano, cello, drums |
| `sing` | karaoke |
| `dance` | dancing |
| `paint` | easel |
| `tinker` | handiwork: workbench, radio repair, knitting |
| `exercise` | general workouts: climbing, cycling, stretching, punching bag |
| `run` | treadmill |
| `lift` | weights |
| `water` | watering plants and flowers, misting, feeding |
| `tend` | kneeling work on beds: weeding, tending vegetables (also patting the gnome) |
| `harvest` | picking: vegetables, fruit, herbs, flowers |
| `prune` | trimming hedges and shrubs, shaping a bonsai, cutting lavender |
| `garden` | other garden work (bird feeder refills, feeding fish); prefer one of the four above |
| `clean` | mopping, laundry, tidying |
| `talk` | conversations (automatic); talking to a mirror |
| `phone` | calls and video calls, radio chats |
| `meditate` | breathing, counting to ten |
| `idle` | standing at an object with nothing better to show (donation jar) |

**Adding an animation:** reuse a tag whenever one is close enough; the characters need a
clip for every tag. If you must add one, append it to a top-level `"animations"` list in
your pack (lists from all files are combined; repeats are fine) and tell the art side.

Without an `anim`, the game picks the first that fits: `reading` tag → `read`; `cooking` →
`cook` (`eat` when seated); `sleep` → `sleep`; `nap` → `nap`; `bathroom` or mostly bladder
→ `toilet`; mostly hunger → `eat`; `social` or mostly social → `talk`; `fitness`/`sport` →
`exercise`; `gaming` → `play`; `music` → `music`; `garden` (or `chores` + `nature`) →
`garden`; `cleaning`/`chores` → `clean`; `spa`/`hygiene` (tag or main need) → `bath`
seated, else `wash` (≤ 10 minutes) or `shower`; `screen` → `type` (seated training) or
`watch`; other `food` → `drink`; `creative` → `write` seated, `paint` standing;
`rest`/`lounge` or lying → `relax`; seated → `sit`; else `idle`. A result missing from
`animations` means no animation (-1).

## Wall and floor coverings, door and window styles

Build mode's looks are top-level arrays, appended like objects, so a pack can add its own:

```json
"wallCoverings": [{ "id": "mypack.tealPaint", "label": "Teal paint", "finish": "plaster", "color": "#5E9C96", "price": 0 }],
"floorCoverings": [{ "id": "mypack.cherry", "label": "Cherry boards", "finish": "wood", "color": "#B9785A", "price": 8 }],
"doorStyles": [{ "id": "mypack.barn", "label": "Barn door", "leaf": "oak", "price": 240 }],
"windowStyles": [{ "id": "mypack.slim", "label": "Slim", "panes": "bar", "sill": 0.6, "head": 2.3, "inset": 0.3, "shutters": false, "price": 110 }]
```

| Field | Meaning |
|---|---|
| `price` | Wall covering: per wall face covered. Floor covering: per floor tile. Door / window: per door or window (replacing one with another style costs the new style's price). |
| `finish` | Wall covering texture: `plaster`, `wallpaper`, `siding`, `brick`, `wood`, `stone` or `tile`; floor covering: `wood`, `tile`, `carpet` or `stone`. `color` tints it (wood is a neutral grain: give it its colour). |
| `leaf`, `color` | Door: `panel` (painted; without `color`, front doors take the house's accent colour), `oak`, `halfGlass` or `glass` (`color` paints the frame). |
| `panes`, `sill`, `head`, `inset`, `shutters` | Window: glazing bars (`cross`, `grid`, `bar`, `transom`, `none`), opening bottom and top (m, walls are 2.8 m), wall left either side of the glazing (m, of the 1 m edge), shutters outside (`true`, `false`, or `"house"`: if the house's style has them). |

Saves store looks by id; a look whose id no longer exists loads as the default (the house's own
look for walls, the room's own floor, the first style for doors and windows). Ids must be unique within each list.

## Text and languages

The game is English only for now; other languages will come (text and voices). Write labels
and templates as plain text in the content (they are the English default and will be
overridden by id from locale files later), keep placeholders named (`{a}`, `{skill}`, `{n}`)
rather than building sentences from parts, and never refer to content by its label, only by id.

## Planner: activities, goals, discipline

The planner (each resident's weekly routines and life goals) is data too, so packs can add to it.

**Activities** are what a routine block is for. A block never names an object, only an
activity, so plans keep working when the house changes. Interactions with any of the
activity's `tags` count; `skill: true` lets a block name a skill instead (interactions that
train it count); `social` and `visit` count conversations and visiting friends; `sleep`
blocks decide when the resident's night is.

```json
"activities": [{ "id": "mypack.yoga", "label": "Yoga", "icon": "icon.ui.skills", "tags": ["yoga", "fitness"] }]
```

While a block runs, choices that fit it are boosted and others damped (urgent needs are
exempt); `planner` sets how strongly. If nothing at home or in a park offers the activity, the
block counts as "nowhere to do it" and the resident wishes for a place (the player can open
the catalog filtered to it).

```json
"planner": {
  "boost": 6, "offBlock": 0.35, "urgentBelow": 0.15, "floor": 0.15, "skipChance": 0.1,
  "keptShare": 0.75, "maxMinutes": 240, "maxSleepMinutes": 720, "reviewHour": 7,
  "maxGoals": 3, "maxSuggestions": 2, "suggestionDays": 2,
  "discipline": { "lazy": 0.6, "energetic": 1.3 },
  "keptFeeling": "keptPlan", "noPlaceFeeling": "nowhereToDoIt", "goalFeeling": "goalReached"
}
```

`suggestionDays`: a goal a resident suggests is taken on by itself if the player neither
accepts nor dismisses it for that many days. `discipline` multiplies how well residents with a trait stick to plans (with their mood);
traits whose `tagPreference` dislikes an activity's tags skip it more. A pack's own top-level
`planner` object replaces keys of the base one (objects merge shallowly), so repeat the whole
`discipline` map if you change it.

**Goals** pick from a fixed set of kinds: `hasJob` (label may use `{category}`), `jobLevel`,
`promoted`, `skill` (`{skill}`, `{n}`), `friends` (`{n}`), `partner`, `funds` (`{n}`).
`weight` plus per-trait `traits` weights decide how often residents suggest them; `feeling`
(optional) is granted on reaching it.

```json
"goals": [{ "id": "mypack.chef", "label": "Reach {skill} level {n}", "icon": "icon.skill.cooking", "kind": "skill", "weight": 0.5, "traits": { "foodie": 2 } }]
```

**Day rhythm:** `dayRhythm.wakeFor` lists the needs that wake a sleeper when they get urgent
(default: all; the base game wakes for `bladder` and `hunger` only), and
`dayRhythm.workDecay` multiplies need decay while at work. **Jobs:**
`careerRules.market` turns on residents finding, quitting and losing jobs on their own.

## Ids you can refer to

- **Needs:** `hunger`, `energy`, `bladder`, `hygiene`, `fun`, `comfort`, `social`.
- **Skills:** `intelligence`, `strength`, `endurance`, `charisma`, `creativity`,
  `technology`, `handiness`, `cooking`, `writing`, `perception`, `dexterity`, `business`,
  `gardening`.
- **Emotions:** `happy`, `flirty`, `angry`, `sad`, `embarrassed`, `focused` (likes
  `training`), `inspired` (likes `creative`), `energized` (likes `fitness`), `relaxed`
  (likes `rest`, `lounge`, `spa`). Icons are `icon.emotion.<id>`.
- **Buy categories:** `kitchen`, `bathroom`, `bedroom`, `living`, `office`, `fitness`,
  `hobbies`, `decor`, `outdoor`, `garden` (groups `trees`, `shrubs`, `flowers`, `edibles`,
  `houseplants`), `wellness` (example pack). Add a category with
  `"buyCategories": [{ "id": "...", "label": "...", "icon": "icon.category.<id>" }]` only if
  none fits (`icon` is optional: the catalog tab's icon, an `icon` asset key; `groups`
  optional: `[{ "id": "...", "label": "..." }]`, chips that objects pick with `group`).
- **Activities** (routine blocks): `sleep`, `eat`, `cook`, `wash`, `train` (names a skill),
  `workout`, `read`, `create`, `fun`, `relax`, `garden`, `chores`, `social`, `visit`.
- **Traits** (for `traitPatches`): `foodie`, `bookworm`, `couchPotato`, `neat`, `slob`,
  `energetic`, `lazy`, `cheerful`, `gloomy`, `natureLover`, `outgoing`, `loner`,
  `romantic`, `hotHeaded`, `kind`.

## Fence styles

`fenceStyles` lists the looks of Build mode's Fence and Gate tools; a fence's (or gate's) style
is an index into this list, saved by `id`.

```json
{"id": "picket", "label": "White picket", "kind": "picket", "color": "#F2F0EA", "height": 1.0, "price": 25}
```

`kind` is how it's drawn: `picket`, `rails`, `slats`, `iron` or `stone`; `price` is per metre
(default `build.fence`), and a gate costs a metre plus `build.gate`.

## Roofs

`roofStyles` and `roofColors` are what Build mode's Roof tool offers (saved by `id`):

```json
{"id": "steepGable", "label": "Steep gable", "shape": "gable", "pitch": 46}
{"id": "navy", "label": "Navy", "color": "#33465E"}
```

`shape` is `gable`, `hip` or `flat`; `pitch` is in degrees (default 34).

## Balance guidance

Money: households start with $2,500 (`economy.startingFunds`), plus $10,000 to build with when
they start on an empty lot in a Living game (`economy.emptyLotFunds`; a ready-made house is worth
about $7,500–12,000); rent is about $200 a week on a house plot; an
entry-level job pays roughly $70–150 a shift (grades run from $12/h to $52/h). Running costs
come as weekly **bills**, paid with the rent: `economy.rent.billsBase` ($25) plus `billsRate`
(1.5%) of what the household's objects are worth (price plus upgrades) plus `perResident`
($150 per resident). A $2,000 luxury item adds about $30 a week. A working household saves
roughly $100–2,000 a week; `crates/sim-core/tests/balance.rs` checks this (and how fast
careers go) for the base game, so run it after changing prices, pay or rent.

**Prices by category** (base game):

| Category | Range | Examples |
|---|---|---|
| decor | $40–150 | plant 40, lamp 120 |
| outdoor | $40–250 | bush 40, flowerbed 60, bench 200 |
| bathroom | $180–650 | sink 180, toilet 300, shower 650 |
| kitchen | $350–600 | dining table 350, fridge 600 |
| bedroom | $180–750 | mirror 180, bed 750 |
| living | $250–500 | bookshelf 250, TV 400, sofa 500 |
| fitness | $480–650 | weight bench 480, treadmill 650 |
| hobbies | $300–1,400 | easel 300, chess 350, telescope 900, piano 1,400 |
| office | ~$1,100 | computer desk 1,100 |

Something clearly better than the basic version (bigger gains, a buff, two slots) costs
2–3× the basic item; luxury items $1,500–3,000. Per-use `cost` ($4–15) only for
consumables bought from outside, such as takeout or deliveries; never for using something the household owns.

**Need gains per hour** (at 0 stars; compare yours with these):

| Object | Per hour |
|---|---|
| fridge snack / meal / gourmet | hunger 1.8 / 1.28 / 0.76 |
| toilet | bladder 7.5 |
| shower / sink | hygiene 3.0 / 2.25 |
| bed sleep / nap | energy 0.125 (+ comfort 0.05) / energy 0.25 |
| sofa / armchair / bench | comfort 1.2 / 1.5 / 0.7 |
| TV / browse / read | fun 0.7 / 0.6 / 0.6 |
| coffee | comfort 0.75, energy 0.24 |
| example: whirlpool soak | comfort 1.07, hygiene 0.33, fun 0.2 |

Keep new items within about ±30% of the closest base item, plus a modest extra (a second
need, a buff feeling, a skill bonus) that justifies the price. A need gain over a whole
interaction above 1.0 is wasted (needs cap at 1).

**Skill gains per hour:** dedicated training items give 0.20–0.25 in their main skill plus
0.04–0.08 in a secondary one; fun items that teach a little give 0.04–0.12; work gives
0.04 × weight. Training interactions should have little or no need gain (study: fun 0.1/h).

**Feelings:** `mood` +0.05..+0.12 for everyday treats, up to +0.2 for big events; `hours`
2–8 for everyday treats. Gate the nice ones behind `feelingMinSkill` so skill matters.

## Checking a pack

```
cargo run -q -p sim-core --example check_pack -- web/public/content/packs/<name>.json
```

It merges base + careers + your pack (other packs are left out), reports JSON and content
errors with the file and id, then for every object in your pack:

- places it on a 14×14 test lot with one resident (plenty of money) and runs each interaction as a
  player order: one line per interaction with minutes used, its animation, money spent,
  change in the needs it affects, skills gained and feelings gained (twice, at skill 0 and
  8, if it has a `skill`);
- then lives three game days on the starter lot with your objects bought into the home,
  printing how long residents used each of them and what they spent, and fails if the household's
  average needs drop to 0.25 or below.

It exits non-zero on any failure. Also run `cargo test -p sim-core`: the shipped-content tests
load base.json with every file in its `include` list.
