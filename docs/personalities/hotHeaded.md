# Hot-headed: content pack design note

Pack: `web/public/content/packs/hotHeaded.json` · models: `web/public/assets/packs/hotHeaded/manifest.json`

**What a hot-headed resident wants:** "Quick to anger and slow to forgive." The base trait loves `mean`
socials (2.2×) and dislikes `makeup` (0.5×), and the `angry` emotion pushes `mean` to 3.5×. The pack
gives the anger somewhere harmless to go (physical, loud outlets) and gives the player tools to
cool the resident down. Almost every item ends in a calm feeling that **lowers** `mean`/`violent`
preference and **raises** `makeup` (apologising) for a few hours.

New tags: `sport`, `music` (shared vocabulary); also base `spa`. Trait patch: `tagPreference` sport 1.7, music 1.3, fitness 1.3; `skillGain` strength 1.15.

| Item | Price | Behaviour change |
|---|---|---|
| Heavy punching bag (fitness, 1×1) | $380 | Strength 0.22/h (+Endurance 0.06), sweaty like the weight bench; scales with Strength. Always grants *Blew off steam*. |
| Plate-smash bin (hobbies, 1×1) | $450 | 20 min of loud fun (0.9/h, ~1.3× TV); grants *Blew off steam*. The quick fix after an argument. |
| Thunder drum kit (hobbies, 2×1) | $1,150 | Piano-level fun (0.45/h); trains Creativity 0.2/h (+Dexterity 0.08); scales with Creativity. At Creativity 4+ it grants *Blew off steam*: skilled drummers vent, beginners just make noise. |
| Cool-down meditation cushion (decor, 1×1) | $180 | "Count to ten": 20 min, comfort 0.35 (≈ sofa rate); grants *Cooled down*. "Mindful breathing" trains Perception 0.2/h. |
| Grudge-to-gratitude writing desk (office, 1×1) | $280 | Writing 0.2/h (+Charisma 0.05); scales with Writing. At Writing 3+ grants *Let it go*, which flips "slow to forgive" for 8 h. |
| Glacier cold-plunge tub (bathroom, 1×2, luxury) | $2,600 | 30 min: hygiene 0.45, comfort 0.2, energy 0.1, fun 0.05; grants *Ice-cold calm*, the strongest and longest calm. |

**Feelings** (strong enough to override *argued* −0.08 / *pranked* −0.06 as the dominant emotion)
- *Blew off steam* (relaxed, +0.10, 4 h): mean 0.5×, violent 0.4×, makeup 1.5×, friendly acceptance +0.05.
- *Cooled down* (relaxed, +0.07, 5 h): mean 0.6×, violent 0.5×, makeup 1.8×, comfort gain 1.15×.
- *Let it go* (happy, +0.08, 8 h): makeup 2.5×, mean 0.5×, friendly 1.2×; makeup acceptance +0.1, friendly +0.05.
- *Ice-cold calm* (relaxed, +0.13, 8 h): mean 0.35×, violent 0.3×, makeup 2.0×, friendly acceptance +0.08,
  energy/comfort gain 1.15×, spa 0.5× (damps a relaxed→spa→plunge loop: 30 plunges in 3 days before).

**Balance reasoning.** Training rates match base trainers (0.2–0.22 + 0.04–0.08 secondary) with low need
gains; the trait's pull comes from preference (sport 1.7 × fitness 1.3 on the bag), not bigger numbers.
The plunge costs ~4× a shower (and adds about $39/wk to the bills), washes at a third of a shower's rate but hits four needs and
gives the best buff. Autonomy scores *total* gain, so its gains were cut until it stopped crowding out
other items: with non-hot-headed residents in `check_pack` (3 days) it ran ~2.7 plunges/resident/day, needs
averaged 0.85. Those residents ignored the bag and smash bin, as intended: they target hot-headed/sporty residents.

**Other personalities.** Energetic residents share the `sport` tag and will happily use the bag and smash
bin. Cheerful residents share `music` and may take over the drum kit. Lazy, neat and relaxed-emotion residents
like the plunge (`spa`/`hygiene`). Kind residents (the trait that conflicts with hot-headed) get the calming items'
need gains but don't need the anti-mean buffs. Gloomy or bookish residents may use the cushion and journal
for their Perception and Writing training.
