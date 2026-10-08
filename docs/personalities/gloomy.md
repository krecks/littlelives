# Gloomy — design note

**Trait:** "A little melancholy; bored more easily." Base effects: mood −0.1, fun decays 1.2×,
socials with fun are accepted less often; starts with Writing 1 and Creativity 1.

## What a gloomy resident wants
Not to be cheered up loudly, but to *feel things beautifully*: sad records, rain on glass, a
journal, a cello, a long candlelit bath. The pack gives them fun sources that fit their mood,
buffs that slow their fast fun decay (`needDecay.fun` 0.85–0.9), and a way to turn sadness into
creative output (Catharsis). Trait patch: prefers `music` 1.8×, `cozy` 1.6×, `creative` 1.3×;
learns Writing and Creativity 10% faster.

## Items
| Item | $ | What it changes |
|---|---|---|
| Midnight record cabinet (living) | 380 | Listen: fun 0.6/h (≈TV). New album costs $5 per use → *Bittersweet* (relaxed, 4 h, fun decays 0.85×). Gloomy residents pick this over the TV. |
| Nocturne cello (hobbies) | 1100 | Practise: Dexterity 0.22/h + Creativity 0.06 (skill-scaled). Lament: fun 0.45/45 min, scales with Dexterity; at Dexterity 4+ grants *Catharsis*. |
| Candlelit writing desk (office) | 650 | Journal: fun + comfort, grants *Unburdened* (happy, prefers friendly socials 1.3×, +0.05 acceptance), nudging a gloomy loner back toward people. Poetry: Writing 0.22/h, skill-scaled; Writing 5+ grants *Catharsis*. Cheaper than the computer desk because it trains one skill. |
| Rainfall lamp (decor) | 160 | Small cozy pick-me-up (comfort + fun 0.2 / 30 min). Cheap first buy. |
| Brooding window seat (living, 2 slots) | 650 | Comfort 1.05/h (≈sofa 1.2) plus a little fun; a doze nap (energy 0.23/h) weaker than the bed's nap so night sleep stays king. |
| Moonstone soaking tub (bathroom, luxury) | 2800 | 3 needs at once (hygiene 0.7, comfort 0.6, fun 0.2 / 50 min), adds about $42/wk to bills, grants *Deep calm* (energy & comfort gain 1.25/1.15×, slower boredom, 8 h) → better sleep. |

## Feelings
- `gloomy.bittersweet` relaxed +0.06, 4 h — fun decay 0.85×, cozy 1.2×.
- `gloomy.catharsis` inspired +0.10, 6 h — Creativity/Writing learning 1.25×, Dexterity 1.15×, fun decay 0.85×.
- `gloomy.unburdened` happy +0.07, 4 h — fun decay 0.9×, friendly socials preferred and accepted more.
- `gloomy.deepCalm` relaxed +0.10, 8 h — energy gain 1.25×, comfort 1.15×, fun decay 0.85×.
Each roughly offsets the trait's −0.1 mood for a few hours, so gloomy residents are rewarded for
seeking out their own kind of comfort rather than becoming cheerful.

## Balance
Gains sit within ±30% of the nearest base item; training uses the base 0.22 + 0.06 pattern with
little need gain. The tub is the whirlpool-class luxury (more hygiene, less comfort, single slot,
higher price). The $5 album is small against a $90–180 shift, and the tub adds about $42/wk to the bills. Checker: 3-day starter
lot keeps household needs at 0.77.

## Other personalities
Bookworms share `cozy` (desk, rain lamp, window seat) and love the writing desk; couch potatoes
like the cozy window seat; lazy/spa-loving residents will fight over the tub; cheerful residents just see a
nice bath. Any future `music` items (outgoing/party packs) will also draw gloomy residents in.
