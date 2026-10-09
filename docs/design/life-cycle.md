# Life cycle I (0.12)

*Status: in progress on `build-and-watch`. Roadmap: PLAN.md section 8.*

Lives move on: residents age, grow old, retire and pass away; partners move in together, grown
children move out, and newcomers arrive in empty houses. The house has to grow and shrink with
the family, and watching follows a story that changes over weeks. Babies, children and teens are
0.13; here everyone is an adult (young adult, adult or elder).

As in 0.11: everything is data-driven (content `life`), runs in the simulation (deterministic,
saved), and speaks in ids and numbers.

## Residents come and go: stable ids

Today a resident's index in `World::sims` is its id everywhere: the snapshot row, the renderer's
rig, the dense relationship matrix, story events, object slots, social targets. The list only
grows and is capped at `MAX_SIMS` (64).

0.12 keeps index = id and adds two things instead of renumbering:

- **Gone residents.** A resident who dies or leaves town is not removed: the slot is marked
  `gone` (with why and when). A gone resident isn't simulated, drawn, listed or chosen as a
  target; their relationships are cleared, their object slots and tasks released, everyone's
  tasks and conversations with them cancelled. Their snapshot row stays, flagged absent, so rows
  and ids still match.
- **Slot reuse.** A newcomer takes the lowest gone slot (or a new one below the cap). Before a
  slot is reused, story events that name its former occupant are converted: the slot's name is
  kept in `World::former` (a small list of former residents: name and household name) and the
  events point there (`SocialEvent` references become `Ref::Resident(id)` or
  `Ref::Former(index)`). So the journal still says "Ada passed away" years later. Former entries
  nobody's events name any more are dropped.

The renderer rebuilds a rig when the resident in a slot changes (a `generation` counter per slot
in the structure), and the UI lists only residents who aren't gone.

## Ages and life stages

Each resident has an age in days (`born`: the game day of their birth, which may be negative).
Content `life`:

```json
"life": {
  "daysPerYear": 2,
  "stages": [
    {"id": "youngAdult", "label": "Young adult", "from": 18},
    {"id": "adult", "label": "Adult", "from": 30},
    {"id": "elder", "label": "Elder", "from": 60,
     "effects": {"needDecay": {"energy": 1.2}, "walkSpeed": 0.85}}
  ],
  "retireAt": 65, "pension": 0.4,
  "death": {"from": 75, "perYear": 0.04, "growth": 0.12},
  ...
}
```

- **Lifespan** is a per-game option (Settings, and a step of a new game): *Off* (nobody ages),
  *Short* (1 day a year), *Normal* (2 days a year: young adult to elder in about 84 days, a
  whole life about 120), *Long* (4). Saved in the world.
- **Birthdays** pass quietly; a new stage is a story event ("Ada is an elder now") with a
  feeling. Elders get tired sooner and walk slower (content `effects`), and their hair greys
  (presentation only; elder bodies are 0.13).
- The household creator gets an age stage per resident (young adult, adult, elder; a random age
  within it), and generated households get ages that fit (partners within a few years, a grown
  child 20-30 years younger than their parents).

## Family

Relationships gain a kin link (`Kin::Parent` / `Child` / `Sibling`, symmetric pairs; partners
stay the `partners` flag). Family starts friendlier, family members don't flirt, and kin shows in
the relationships panel and the journal ("Ada's son"). The household creator gets family bonds
(parent and child, siblings), and generated households are sometimes families (a couple and a
grown child, two siblings).

## Retirement and death

- **Retirement:** at `retireAt` an employed resident retires (story event, a good feeling) and
  the household gets a weekly pension of `pension` × their last weekly pay.
- **Death:** from `death.from` a resident may pass away of old age: a daily chance of
  `perYear / daysPerYear`, growing by `growth` per year past `from` (about age 85 on average).
  Someone at home goes quietly in their sleep or sitting down; the journal tells it, the household
  and close friends grieve (a strong sad feeling, scaled by how close they were; family most),
  and they're gone. Their belongings stay; the household keeps the money.
- A household with nobody left keeps its home; the player's own home then offers *Move a family
  in*, a neighbour's house becomes vacant.

## Moving

- **Partners move in together:** partners in different households, partners for at least
  `moveIn.days`, both adults, move in together when one home has room (a bed for everyone and
  below `rules.maxHousehold`): the resident from the fuller home moves (with a share of their
  household's money), and the story says so. If neither has room, nothing happens (or they move
  to a vacant house together, below).
- **Grown children move out:** a resident living with a parent, at least `moveOut.age`, with a
  job (or a partner elsewhere), moves to a vacant house in town after a while, with their partner
  if they have one at home. With no vacant house they stay.
- **Newcomers:** a vacant house (a neighbour's home with nobody in it, or one left empty) gets a
  new household after `newcomers.days`: a single, a couple, a couple with a grown child or two
  siblings, sized to its bedrooms, with names from content `names`, traits and perks drawn like
  the household creator's random ones, ages that fit, and an appearance seed
  (`{"seed": n}`, expanded by the web into a look with the creator's own random generator).
  Never the player's home.
- Moving out of town: a resident who would move but finds nowhere (and isn't the player's)
  may leave town (gone, "moved away") so towns don't fill up with grown children.

The player's own household is part of this: their residents age, retire, die, find partners who
move in, and their grown children move out. A setting can switch *Moving* off for the player's
household (residents only leave or arrive with the player's say-so: a confirm toast).

## Interface

- Ages and stages in the resident panel, household strip and the household creator.
- Family in the relationships list ("Mother", "Son", "Sister").
- Story events: became an elder, retired, passed away, moved in together, moved out, moved away,
  new neighbours.
- Settings → Life: lifespan (off, short, normal, long) and the player's household moving on its
  own (on, ask, off).

## Saves

Version 13: `born` per resident, gone residents (`gone: {why, day}`), slot generations, former
residents, kin in relationships, references in events (still plain numbers for residents, with a
`former` marker), the life options. Older saves: everyone gets an age from their household role
(adults 25-50), nobody is gone, aging is *Normal* for new games and *Off* for loaded older games
(the player can switch it on).

## Build order

1. Ages, stages and the life option (sim, content, saves, UI), with tests.
2. Gone residents and slot reuse (sim, saves, snapshot, renderer, UI), with tests: a resident
   removed and replaced keeps the journal right and the renderer correct.
3. Family links (relationships, creator, generated households, UI).
4. Retirement and death (grief, empty households).
5. Moving: partners move in together, grown children move out, moving away.
6. Newcomers in vacant houses (generation in the sim, appearance seeds in the web).
7. Interface pass (panels, journal texts, settings), soak over a whole life (a town over 150
   days), balance, docs.
