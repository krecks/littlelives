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
| `voice` | spoken lines (see [Voice lines](#voice-lines)): merged at every depth by the web side, so a pack adds or replaces single groups of lines. The simulation drops it. |

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
| `layer` | Where it goes: `floor` (default: furniture, which takes its tiles), `wall` (hangs with its back on a wall or window: pictures, curtains, shelves, wall lamps), `ceiling` (hangs in a room: pendant lamps, fans) or `rug` (lies on the floor). Off the floor layer it takes no floor space: residents walk under and over it, furniture stands in front of, under or on it, and only things on the same layer can't overlap. A wall with something on it can't be removed or get a door. Model things on a wall with their back on the wall face (`z = -0.43` in a 1-deep footprint) at their real height, ceiling things hanging from 2.8 m. Things nobody uses (no interactions) needn't be reachable. |
| `bunk` | Bunk beds (2 `slots`): both sleepers lie in the middle of the bed's width, the second on the upper bunk (heights per object in `render/babylon/characters.ts`, `BUNKS`). |
| `slots` | How many residents use it at once, 1 or 2 (double bed, sofa, hot tub). Default 1. |
| `light` | Lamps: `{"range": 4.5, "intensity": 1, "height": 1.55}` makes it a light at night (reach in metres, relative brightness, bulb height). |
| `freeRotation` | `true` lets the player turn it to any angle in 15° steps (only for looks). Default: 1×1 objects whose category is listed in `objectRules.freeRotation` (base game: `decor`, `garden`, `outdoor`). |
| `decor` | Decor points it gives the room it stands in (see [Rooms](#rooms-wear-and-accidents)). Default: by category, `roomRules.decorByCategory`. |
| `wearPerUse` | Wear added by each completed use; at 1 it breaks. Default: by category, `objectRules.wear` (nothing wears out that nobody uses). |
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
| `dirt` | Mess each use leaves on the tiles around the object (0..1). Default: by tag, `roomRules.dirt` (cooking 0.12, food 0.06, bathroom 0.05, hygiene 0.04). |

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
| `spa` | whirlpool tub (example pack), baths and hot tubs; declared in base.json `tags` |
| `toys` | kids' things (toy box, play mat, doll house…); grown-up life stages like them far less (`tagPreference` 0.15, teens 0.4); declared in furniture.json `tags` |
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
is `talk` during conversations. `sim.objectDef` and `sim.interaction` say what is being used, as
indices into the content's `objects` and that object's `interactions` (-1 = none); resident
voices pick their lines by them.

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

## Voice lines

What residents say out loud lives in `web/public/content/voice/<lang>.json` (English:
`en.json`; its `_comment` describes the layout). A pack adds lines for its own items, or
replaces lines, under a top-level `voice` key with the same layout, per language:

```json
"voice": {
  "en": {
    "object": {
      "chefStove": {
        "lines": ["A proper chef's stove."],
        "interactions": {
          "cook": ["Six burners, all mine!", "Let it sizzle!", "Tonight, I cook like a pro."],
          "practise": { "lines": ["Practice makes perfect.", "Let's try that recipe again."], "tone": "happy" }
        }
      }
    },
    "interaction": { "soak": ["A long soak, at last.", "Pure bliss."] },
    "action": { "cook": ["Smells good already."] }
  }
}
```

| Section | Keyed by | Said when |
|---|---|---|
| `object` | object id: `lines` for any of its interactions, `interactions` per interaction id | a resident starts using it |
| `interaction` | interaction id, on any object | the same, if the object has no lines of its own |
| `action` | animation tag (see [Animations](#animations)) | the same, if neither has lines; also repairs, accidents, knocking, tidying |
| `social` | social id: `start`, `good`, `bad` | starting a conversation; answering, by outcome |
| `emotion` | emotion id | the resident's emotion changes |
| `thought` | planner thought kind (`skipped`, `noPlace`, `kept`, `goal`, `roomLoved`, `roomDisliked`, `broken`, `accident`, `crying`) | a thought bubble appears |

- For something being used, the most specific lines win: object + interaction, then the object's
  `lines`, then the interaction id, then the animation tag.
- A group is a list of lines or `{"lines": [...], "tone": "..."}`; tones are `happy`, `sad`,
  `angry`, `flirty` and `question`. `{name}` is the other resident's first name, `{me}` the
  speaker's. `[word](/phonemes/)` fixes a pronunciation in Misaki's alphabet.
- Packs merge in `include` order, key by key: a later pack's list replaces an earlier one for the
  same key, other keys stay. Prefer adding lines for your own objects to replacing the base game's.
- Write 3–6 lines per key (a resident doesn't repeat their last few), short (most under 40
  characters), and right for children, teens and grown-ups alike. Babies don't speak.
- Check them with `cargo test -p voice --release --test lines` (after `pnpm voice` has fetched
  the dictionary): every line must phonemize from the dictionary, and every key must name content
  that exists.

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
  "maxGoals": 10, "maxSuggestions": 2, "goalFalloff": 0.15, "suggestionDays": 2,
  "discipline": { "lazy": 0.6, "energetic": 1.3 },
  "keptFeeling": "keptPlan", "noPlaceFeeling": "nowhereToDoIt", "goalFeeling": "goalReached"
}
```

`goalFalloff`: goals higher on a resident's list steer more; the goal at place *n* (0 = the top)
steers with strength `1 / (1 + goalFalloff × n)`, and only the highest goal of each kind counts.
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

## Life: ages, family, moving

Content `life` (an object, so a pack can change single keys; see `docs/design/life-cycle.md`):

| Key | Meaning |
|---|---|
| `daysPerYear` | Game days per year of age at the *Normal* lifespan (default 2; *Short* halves it, *Long* doubles it). |
| `startAge` | `[min, max]` ages for residents nothing gives one (default `[25, 50]`). |
| `stages` | Youngest first: `{"id", "label", "from", "story", "feeling", "effects", "adult", "baby", "school", "scale", "head", "stoop", "greyHair"}`. `from` is the age it starts at; `story` the journal's words ("is an elder now"); `feeling` granted on reaching it; `effects` like a trait's (combined with traits and perks; `tagPreference` 0 means never on their own: children don't cook). `adult` (default: unless `baby` or `school`) may work, fall in love, move and have children, and a household needs one; `baby` lives in a crib and is cared for; `school` goes to school. `scale` and `head` size the body and the head (renderer), `stoop` 0..1 bends the upper back, `greyHair` 0..1 greys the hair. |
| `school` | `{"start", "hours", "days", "skills", "grades"}`: school days (weekday numbers, 0 = Monday) for stages with `school`; `skills` (id → weight) practised a little there; `grades` `{"attend", "mood", "missed", "start", "good", "goodFeeling", "poor", "poorFeeling"}`: grade points (0..100) per day at school (plus up to `mood` by how they felt), off for a day missed, a new pupil's grade, and the feeling on leaving school with a grade of at least `good` or below `poor`. Interactions with `"homework": points` are done only by pupils and raise the grade. |
| `pregnancy` | `{"chance", "days", "maxAge"}`: when partners' *conceive* social goes well (a social whose `success` has `"effect": "conceive"`), a baby is on the way with this chance, born `days` later, if they live together, are both grown-ups at most `maxAge`, and there's room. Absent: nobody has babies. |
| `adoption` | `{"cost", "neighbours"}`: what adopting a baby or a child costs; `neighbours` the daily chance a neighbour household of grown-ups with no children (and three times the cost) adopts. Absent: no adoption. |
| `retireAt`, `pension`, `retireFeeling` | Working residents retire at this age; the weekly pension is `pension` × their last weekly pay. |
| `death` | `{"from", "perYear", "growth"}`: from age `from`, a yearly chance of `perYear`, ×e^`growth` per year older. |
| `grief` | `{"feeling", "lightFeeling", "close", "friend"}`: family, partners and friends from `close` get `feeling` when someone dies; friends from `friend` get `lightFeeling`. |
| `moving` | `{"hour", "partners", "romance", "leaveHomeAge", "leaveHome", "leaveTownAge", "leaveTown"}`: daily chances of partners moving in together (romance at least `romance`), grown children moving out, and leaving town when no house is free. Absent: nobody moves on their own. |
| `newcomers` | `{"hour", "days"}`: a vacant house gets a household with a chance of 1 in `days` a day. Absent: nobody new comes. |

**Family** comes from bond presets with a `kin`, the family link of the bond's *second*
resident to the first: `{"parent": {"friendship": 50, "kin": "parent"}}` in a bond `a, b` makes
`b` the parent of `a` (`kin`: `parent`, `child` or `sibling`). Relatives don't flirt.

**Babies and cribs:** an interaction with `"baby": true` is the place a baby lies (only babies
use it); an interaction with `care` (need → gain over the whole interaction) fills the needs of
the baby lying in the same object, and only grown-ups at home do it. The base game's `crib` has
both (lie; feed, change, play); a baby who arrives without a free crib gets the first object
for sale with a `baby` interaction delivered.

**Romance between singles:** `socialRules.singleSpark` is added to the flirting preference of
two single grown-ups who are attracted to each other and have met (romance starts at 0, so
without it singles hardly ever begin; base game 1.0).

**Names** for newcomers and babies come from content `names`: `first`, `byGender` (first names per gender
id) and `last` (household names).

**Story texts** (`events`): `grewOlder` (`{stage}`: the stage's `story`), `retired` (`{job}`),
`died`, `movedInWith` (`{b}`: the partner), `movedOut`, `movedAway`, `expecting` (`{a}` and
`{b}`), `born` (`{b}` and `{and c}`: " and" the second parent, if any), `adopted` (`{b}` adopted
`{a}`), `graduated` (`{grade}`: "an A", "a B"...).

## Ids you can refer to

- **Needs:** `hunger`, `energy`, `bladder`, `hygiene`, `fun`, `comfort`, `social`.
- **Skills:** `intelligence`, `strength`, `endurance`, `charisma`, `creativity`,
  `technology`, `handiness`, `cooking`, `writing`, `perception`, `dexterity`, `business`,
  `gardening`.
- **Emotions:** `happy`, `flirty`, `angry`, `sad`, `embarrassed`, `focused` (likes
  `training`), `inspired` (likes `creative`), `energized` (likes `fitness`), `relaxed`
  (likes `rest`, `lounge`, `spa`). Icons are `icon.emotion.<id>`.
- **Buy categories** (groups in brackets): `kitchen` (`appliances`, `counters`, `dining`),
  `bathroom` (`toilets`, `bathing`, `sinks`, `laundry`), `bedroom` (`beds`, `storage`,
  `dressing`), `kids`, `living` (`seating`, `tables`, `media`, `shelves`, `stairs`), `office`,
  `fitness`, `hobbies` (`music`, `games`, `crafts`), `decor` (`wall`, `ornaments`, `textiles`),
  `lighting` (`ceiling`, `wall`, `floor`, `table`), `outdoor` (`seating`, `cooking`, `play`,
  `lights`, `decor`), `garden` (groups `trees`, `shrubs`, `flowers`, `edibles`,
  `houseplants`), `wellness` (example pack). An object without a `group` shows under its
  category's *All*. Add a category with
  `"buyCategories": [{ "id": "...", "label": "...", "icon": "icon.category.<id>" }]` only if
  none fits (`icon` is optional: the catalog tab's icon, an `icon` asset key; `groups`
  optional: `[{ "id": "...", "label": "..." }]`, chips that objects pick with `group`;
  `"outside": true` on a category or group marks garden things, which wishes for a room don't
  offer: base game `outdoor` and the garden's `trees`, `shrubs`, `flowers`, `edibles`).
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

## Rooms, wear and accidents

How the house shows up in residents' lives (see `docs/design/house-matters.md`).

**Room kinds** (`roomKinds`): a room is of the first kind whose `tags` something in it offers.

```json
{"id": "bathroom", "label": "Bathroom", "icon": "icon.category.bathroom", "tags": ["bathroom"],
 "essentials": [["bathroom"], ["hygiene"]], "size": [3, 6], "exclusive": true}
```

`essentials`: tag groups something in the room must offer for full function; `size`:
`[cramped, comfortable]` in tiles; `exclusive`: can't share a room with another exclusive kind
(a bed in the kitchen).

**Scoring** (`roomRules`, an object, so a pack can change single keys): `weights` of size, light,
decor, cleanliness and function; `windowTiles` and `lampTiles` (tiles one window or lamp lights
fully); `decorPerTile` and `gardenDecorPerTile` (decor points for full decor); `decorByCategory`;
`love` and `dislike` (overall scores that make residents love or dislike a room) with
`loveFeeling` and `dislikeFeeling`; `drift` (how fast the `environment` need follows the room,
per hour) and `away` (its target at work); `preference` (how much the AI prefers nicer rooms);
`dirt` (mess by tag); `clean` (the *Tidy up* action: `label`, `minutes`, `threshold`, `amount`,
`interest`). A need with `"room": true` is the one that follows the room.

**Wear and repairs** (`objectRules.wear`: `perUse`, `byCategory`, `perQuality`;
`objectRules.repair`: `label`, `minutes`, `skill`, `skillGainPerHour`, `chance`,
`chancePerLevel`, `interest`, `cost` as a share of the price for the paid quick fix, `tags`).

**Accidents** (`accidents`): what happens when a need has been empty for `graceMinutes` and the
home has nothing working for it.

```json
{"id": "takeout", "need": "hunger", "story": "ordered takeout", "cost": 25, "cooldownHours": 2,
 "graceMinutes": 60, "rest": {"label": "Eat takeout", "minutes": 20, "pose": "stand", "anim": "eat",
 "gains": {"hunger": 0.7}, "tags": ["food"]}}
```

`effects` change needs at once, `dirt` leaves a mess where it happened, `feeling` is granted,
`cost` is charged, `rest` is something they do right away (asleep on the floor), `story` puts it
in the journal. `anotherRoom` (a room kind id): residents who badly need it and find what fills
it taken, on two different days within a week, wish for another room of that kind (the base
game's `wetSelf`: a second bathroom). `crowdedGraceMinutes` also lets it happen when the home has the essential but it's
taken. At most 8.

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
