# Slob: "Barely notices the dirt. Showers are optional."

Pack: `web/public/content/packs/slob.json` · models: `web/public/assets/packs/slob/manifest.json`

## What a slob wants
Effort-free comfort: food without cooking, fun without leaving the couch, and just enough
hygiene to get by. The base trait already decays hygiene slower (×0.7) and avoids `hygiene`
(×0.6) and `chores` (×0.5). The pack adds two tags the slob loves: `cozy` (low-effort
shortcuts, ×1.8) and `gaming` (×1.7), plus Dexterity learning ×1.1.

## Items
| Item | Price | Behaviour change |
|---|---|---|
| Late-night microwave cart (kitchen) | $280 | `nuke`: hunger 0.55 in 15 min, so slobs skip the fridge meal. `invent` trains Cooking (0.2/h), scales with Cooking and grants *Microwave master* at Cooking 4+ |
| Crumb-proof beanbag (living) | $240 | Cheap `cozy` lounging (comfort 0.55/30 min, a bit under the sofa) and a weak nap (energy 0.2/h, under the bed nap's 0.25; tagged `nap` only, so no cozy bonus for daytime sleep) |
| Snack-stash nightstand (bedroom) | $150 | Snack-sized hunger (0.25) next to the bed |
| Spritz & go station (bathroom) | $260 | Covers the slob's weakness: hygiene 0.35 in 6 min, plus *Fresh enough* (hygiene decay ×0.8 for 3 h). Tagged `hygiene`+`cozy`, so a slob's preference is 0.6×1.8 ≈ 1.08. They spritz instead of skipping hygiene, but a shower still gets them properly clean |
| Pixel-blaster arcade cabinet (hobbies) | $750 | Trains Dexterity 0.22/h (+Perception), scales with Dexterity and grants *New high score!* at Dexterity 5+. A quick round gives TV-level fun |
| Command-couch gaming recliner (living, luxury) | $2,600 | A 90-min marathon gives fun 0.95 + comfort 0.6 (TV + sofa in one seat) and *Couch legend*. The side fridge holds sodas, so slobs stay put |

## Feelings
- *Microwave master* (happy +0.1, 4 h): hunger decay ×0.8, Cooking learning ×1.15.
- *Fresh enough* (happy +0.05, 3 h): hygiene decay ×0.8.
- *New high score!* (focused +0.08, 4 h): Dexterity ×1.3, Perception ×1.15, training preference ×1.2.
- *Couch legend* (relaxed +0.1, 6 h): comfort gain ×1.2, fun gain ×1.15.

## Balance
- Per-minute gains stay within about ±30% of the base items: the nuke (2.2/h) is about 20% faster
  than the fridge snack (1.8/h). The spritz (3.5/h) is capped at 0.35 per use.
- The recliner (fun 0.63/h + comfort 0.4/h) is roughly 1.5× a TV session in value, at 6.5× the TV's price.
- Training items follow the base pattern (0.2–0.22 main skill, 0.05 secondary, little need gain).
- Uses are free; the recliner adds about $39/wk to the bills. On the 3-day check the household kept average needs at 0.76.
- No sleep item; the only nap is weaker than the bed's, so the day/night rhythm is unchanged.

## Other personalities
Neat residents (who conflict with slobs) get no `cozy` bonus and should prefer the shower over the spritz.
Couch potatoes and lazy residents share the love of the beanbag and recliner through `lounge`/`rest`.
Energetic residents may like the arcade's Dexterity training. Other packs can reuse `gaming` and `cozy`
for consoles, blankets or fireplaces.
