# Nature Lover: content pack design note

Pack: `web/public/content/packs/natureLover.json` · models: `web/public/assets/packs/natureLover/manifest.json`

**What the nature lover wants:** to be among living things and get their hands in the soil. The
base trait only adds a small mood bonus and a strong `nature` preference (×3), but the base game
has just a potted plant and a flower bed to use it on. This pack gives them a garden to live in:
everyday needs (snacks, showers, naps, lounging) they can meet outdoors, two training hobbies,
and a luxury glasshouse that pays off in better rest.

| Item | Price | What it does to behaviour |
|---|---|---|
| Raised veggie bed (outdoor, 2×1) | $180 | Tend (30 min): fun 0.15, Perception 0.08/h + Dexterity 0.04/h, costs a little hygiene. Pick something fresh (15 min): free hunger 0.3, a bit slower than a fridge snack (1.2/h vs 1.8/h), so nature lovers snack in the garden. |
| Potting bench (hobbies, 2×1) | $420 | **Dexterity training**: pot seedlings, Dexterity 0.22/h + Perception 0.06/h, fun 0.15/h. Tie a bouquet: fun 0.25, scales with Dexterity; Dexterity 4+ grants *Green thumb*. |
| Bird feeder post (outdoor, 1×1) | $140 | Fill the feeder and birdwatch: fun 0.35 in 40 min (≈ TV-level) + Perception 0.1/h, scales with Perception; Perception 3+ grants *Heard the birdsong*. |
| Garden hammock (outdoor, 2×1) | $650 | Swing: comfort 0.7 + fun 0.1 in 45 min (a bit below the sofa's comfort/h, plus fun). Doze: a nap (energy 0.22/h, below the bed nap's 0.25) that grants *Fresh air*. |
| Cedar outdoor shower (outdoor, 1×1) | $580 | Full wash in 25 min (base shower: 20) and *Fresh air*. Tagged `hygiene`+`nature` (not `outdoors`), so the night schedule's outdoor penalty doesn't stop a bedtime shower. Washes off gardening grime. |
| Moss terrarium (decor, 1×1) | $150 | Indoor `garden` chore: fun 0.1 + comfort 0.05 in 15 min, a touch of Perception. Something for apartments or rainy evenings. |
| Fern glasshouse (outdoor, luxury, 2×2, 2 slots) | $3,200 | Unwind (45 min, 2 residents): comfort 0.75, fun 0.3, energy 0.06, grants *In bloom*. Cultivate orchids: **Perception training** 0.22/h + Creativity 0.06/h, scales with Perception; Perception 5+ grants *Green thumb*. |

**Feelings**
- *In bloom* (relaxed, +0.10, 8 h): energy and comfort gain ×1.2, fun decay ×0.85. A glasshouse visit in the evening means better sleep, like the whirlpool's *Relaxed*.
- *Green thumb* (inspired, +0.10, 6 h): Perception learning ×1.25, Dexterity and Creativity ×1.15, `garden` ×1.3. Skilled gardeners stay in the garden and keep improving.
- *Heard the birdsong* (happy, +0.06, 4 h): fun decay ×0.8, social decay ×0.9.
- *Fresh air* (energized, +0.06, 3 h): energy decay ×0.85, walk speed ×1.05.

**New tag (1):** `garden` (shared vocabulary; the foodie herb garden uses it too). Everything else reuses existing tags.
**Trait patch (`natureLover` only):** `tagPreference` garden ×2.0, outdoors ×1.4; skill gain Perception
×1.15, Dexterity ×1.1; starts with Dexterity 1 (Perception 1 is already in the base trait).

**Balance:** need gains stay within about ±30% of the closest base item; the extras are tags and short
feelings, not bigger numbers. Training matches the telescope/easel (0.22/h + 0.06). The hammock nap is
weaker than the bed nap and nothing new is tagged `sleep`, so night sleep still wins. The glasshouse costs
~1.5× the whirlpool (and adds about $48/wk to the bills), in exchange for a multi-need lounge buff. Checker: 3 days on the starter lot, household average needs 0.80.

**Other personalities:** anyone can use these; only nature lovers seek them out. Lazy and relaxed residents like
the hammock and glasshouse, foodies (`garden`) graze the veggie bed, neat residents skip the grubby tending but like the shower.
