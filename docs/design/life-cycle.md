# Life cycle I (0.12)

*Status: done on `build-and-watch` (0.12). Roadmap: PLAN.md section 8.*

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
- **Slot reuse.** Newcomers (and families the player moves in) take the lowest gone slot, else
  a new one below the cap; loading a save never reuses. Before a slot is reused, story events
  that name its former occupant are converted: the name is kept in `World::former` (name and
  household name) and the events name `social::FORMER | index` instead (the top bit marks a
  former resident). So the journal still says "Ada passed away" years later. Former entries no
  event names any more are dropped. A move that fails restores everything (`World::move_in`).

The renderer rebuilds rigs on every structure change and skips gone residents (a `generation`
counter per slot says someone new is there); the UI's roster leaves them out, while the story
names them from the full list (`game.everyone`) and former residents from `game.former`.

## Ages and life stages

Each resident has an age in years (`Sim::age`), a year-fraction older every midnight at the
game's pace, so changing the lifespan never makes anyone jump in age. Content `life`:

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
  "grief": {"feeling": "grieving", "lightFeeling": "missesSomeone", "close": 60, "friend": 35},
  "newcomers": {"hour": 12, "days": 3},
  "moving": {"hour": 11, "partners": 0.2, "romance": 60, "leaveHomeAge": 23, "leaveHome": 0.1,
             "leaveTownAge": 30, "leaveTown": 0.05}
}
```

- **Lifespan** is a per-game option (Settings, and a step of a new game): *Off* (nobody ages),
  *Short* (1 day a year), *Normal* (2 days a year: 18 to elder in 84 days, a whole life about
  130), *Long* (4). Saved in the world.
- **Birthdays** pass quietly; a new stage is a story event ("Ada is an elder now") with a
  feeling. Elders get tired sooner and walk slower (content `effects`), and their hair greys
  (presentation only; elder bodies are 0.13).
- The household creator gets an age stage per resident (young adult, adult, elder; a random age
  within it), and generated households get ages that fit (partners within a few years, a grown
  child 20-30 years younger than their parents).

## Family

Relationships gain a kin link (`Relationship::kin`: what the other is to this one, `Parent` /
`Child` / `Sibling`, set both ways by bond presets with a `kin`; partners stay the `partners`
flag). Family members don't flirt, and kin shows in the People tab ("Mother", "Son"). The
household creator gets family bonds (parent, child, sibling), and generated households are
sometimes families (a couple with a grown child, two siblings). Grief uses kin.

## Retirement and death

- **Retirement:** at `retireAt` an employed resident retires (story event, a good feeling) and
  the household gets a weekly pension of `pension` × their last weekly pay.
- **Death:** from `death.from` a resident may pass away of old age, checked at midnight: a
  yearly chance of `perYear`, ×e^`growth` per year past `from`, spread over the year's days
  (median about 84). The journal tells it; family, partners and friends with friendship of at
  least `grief.close` get the strong `grief.feeling`, friends from `grief.friend` the lighter one;
  and they're gone. Their belongings stay; the household keeps the money.
- A household with nobody left keeps its home; the player's own home then offers *Move a family
  in*, a neighbour's house becomes vacant.

## Moving

Once a day at `moving.hour` (residents at work move too, and come back to the new home):

- **Partners move in together:** partners in different households whose romance is at least
  `moving.romance` both ways, with a `moving.partners` chance a day, move in together where a home
  has a bed for everyone (broken beds count: someone will fix them) within `rules.maxHousehold`:
  into the player's home first, else the one from the fuller home moves, bringing their share of
  their household's money. If neither has room, into a vacant house together.
- **Grown children move out:** a resident living with a parent, at least `moving.leaveHomeAge`,
  working (or retired), with a `moving.leaveHome` chance a day, moves into a vacant house (with a
  partner living with them) as a household with the family name. With no vacant house, from
  `moving.leaveTownAge` they may leave town (`moving.leaveTown`; never the player's), so towns
  don't fill up with grown children.
- **Newcomers:** at `newcomers.hour` each vacant house (furnished, nobody living there, never the
  player's home) gets a household with a chance of 1 in `newcomers.days`: a single, a couple
  (sometimes with a grown child) or two siblings, sized to its beds, with names from content
  `names`, traits without clashes, perks within the points, fitting ages, and an appearance seed
  (`{"seed": n}`, which the web expands with the creator's own random look).

The player's own household is part of this: their residents age, retire, die, find partners who
move in, and their grown children move out. *Settings → Gameplay → Moving* (per game) keeps the
player's household out of moving; a confirm-each-move option ("ask") is left for later.

## Interface

- Ages and stages in the resident panel and the household creator; retirement and the pension in
  the Career tab; elders' hair greys (`greyHair` on the stage).
- Family in the People tab ("Mother", "Son", "Sister") and in the creator's bonds.
- Story events: became an elder, retired, passed away, moved in together, moved out, left town,
  moved in (newcomers).
- New game and *Settings → Gameplay*: lifespan (off, short, normal, long); *Moving* (on, off).

## Saves

Version 13: ages, gone residents (`gone: {why, day}`), retirement and pension, former residents
(`former`) and the events naming them (`FORMER` references), kin in relationships, the lifespan
and the Moving setting. Slot generations aren't saved (a loaded game starts them over). Older
saves: everyone gets an age from content `life.startAge` (by name), nobody is gone, and aging is
off (the player can switch it on); new games age at *Normal*.

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
