# Kind: content pack design note

Pack: `web/public/content/packs/kind.json` · models: `web/public/assets/packs/kind/manifest.json`

**What a kind resident wants:** to do small good things for others and to make home a warm place
for company. The base trait only touches socials (friendly 1.3, makeup 1.6), so at home a kind resident
acted like anyone else. The pack gives them giving acts (`charity`), a welcoming, soft home (`cozy`),
and feelings that make their friendly socials land better: kindness pays off in relationships.

New tags: `charity` (acts of giving) and `cozy` (shared vocabulary).
Trait patch: `tagPreference` charity 1.8, cozy 1.3; `skillGain` charisma 1.1, cooking 1.05; starting Cooking 1.

| Item | Price | Behaviour change |
|---|---|---|
| Neighbourly baking counter (kitchen, 2×1) | $950 | "Family pie" is a meal (hunger 0.8/50 min, a bit slower than the fridge) that scales with Cooking. "Treats for the neighbours" trains Cooking 0.22/h (+Charisma 0.05); at Cooking 4+ it grants *Baked with love*. |
| Community giving jar (decor, 1×1) | $60, $8/use | 8-minute donation: small fun/social/comfort, grants *Warm heart*. A kind resident's way to spend spare money. |
| Gift-knitting rocker (hobbies, 1×1) | $420 | "Knit a gift" trains Dexterity 0.22/h (+Creativity 0.05), scales with Dexterity; at Dexterity 3+ grants *Made something for someone*. "Rock gently" is an armchair-level sit. |
| Welcome tea table (living, 2×1, 2 slots) | $700 | Two residents share tea: comfort, social and a little energy; scales with Charisma; at Charisma 2+ grants *Warm heart*. |
| Songbird feeding station (outdoor, 1×1) | $140 | Filling the feeder (a chore + charity) grants *Warm heart*; watching birds is cheap outdoor fun that teaches Perception. |
| Hearthside quilted settee (living, 2×1, 2 slots, luxury) | $2,600 | Curl up: comfort 0.8/45 min plus social and fun, grants *Cosy and cared for* (better sleep). Also a quilted nap spot. |

**Feelings**
- *Warm heart* (happy, +0.08, 6 h): social gain 1.15×, friendly success +0.06 / acceptance +0.04; charity preference 0.5× so they don't donate in a loop.
- *Baked with love* (happy, +0.1, 6 h): hunger decays 0.85×, social gain 1.2×, friendly success +0.1; charity 0.6×.
- *Made something for someone* (inspired, +0.07, 5 h): Dexterity/Creativity gain 1.15×, friendly acceptance +0.05.
- *Cosy and cared for* (relaxed, +0.08, 8 h): energy gain 1.2×, comfort gain 1.15×, friendly success +0.04.

**Balance reasoning.** Need gains stay at or just below the base items they resemble: the pie is
0.96 hunger/h vs the fridge meal's 1.28; the settee's comfort is 1.07/h vs the sofa's 1.2, and what makes it
luxury is three needs, a sleep buff and two seats, at ~5× the sofa's price. Tea gives social at about
a third of a chat's rate, so it adds to conversation rather than replacing it. Trainers match base
(0.22 main + 0.05 secondary). Only the giving jar costs money per use ($8); the settee adds about $39/wk to the bills. In
`check_pack`, 3 days with every item: household needs averaged 0.77. The non-kind starter residents never used the giving jar,
which is intended: only the trait's charity preference makes giving attractive.

**Other personalities.** Hot-headed residents (kind's conflict) get no charity bonus and ignore the
jar and feeder. Cozy-loving packs (bookworm, slob, couch potato, gloomy) share the `cozy` tag, so
those traits also like the settee, rocker and tea table. Foodies will like the baking counter for the
food alone. Outgoing residents benefit from the friendly-social feelings, and nature lovers will use the feeder.
