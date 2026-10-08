# Couch Potato: "Drawn to the TV and the sofa. Not in a hurry."

Pack: `web/public/content/packs/couchPotato.json` · models: `web/public/assets/packs/couchPotato/manifest.json`

## What they want
Screens, soft seats and snacks within reach. The base trait already has `screen` ×1.8, `lounge` ×1.4,
walk speed ×0.9 and faster comfort decay. Their weak spots are long walks (to the kitchen), never
exercising, and fun that goes nowhere. The pack gives them more to enjoy and a few gentle nudges.

## Items
| Item | $ | Category | Behaviour change |
|---|---|---|---|
| Grand cinema wall | 2900 | living | Luxury, seats 2. Movie marathon (90 min, $6 per use): fun 0.95 + comfort 0.4 + social 0.1, about 1.4× a TV per hour. Grants *Movie night afterglow*. A free "Channel surf" gives 1.2× TV fun. |
| Pixel Arcade console | 520 | hobbies | Seats 2. "Play" gets more fun with **Dexterity** (+5%/level); from Dexterity 4 it grants *New high score*. "Practise speedruns" trains Dexterity 0.22/h and Perception 0.06/h. |
| Cloud Nine power recliner | 780 | living | Comfort 1.27/h (between the sofa and the armchair). Grants *Snug as a bug*. "Doze off" gives energy 0.2/h, weaker than a bed nap (0.25/h). |
| Sofa-side snack fridge | 260 | kitchen | Snack (the fridge's snack plus a little fun). Takeout $12 (hunger 0.8 in 40 min): no cooking, but it costs money. |
| Living-room workout game | 450 | fitness | Endurance 0.2/h. More fun and less sweat than the treadmill, but it trains a bit slower. Tagged `gaming`, so couch potatoes actually choose it. Grants *Actually got moving* (walk ×1.12, slower comfort decay), which cancels the trait's slow walk for 4 h. |
| Lava glow lamp | 90 | decor | Cheap way to zone out: fun 0.45/h and comfort 0.3/h in 20-minute bites. |

## Feelings
- *Movie night afterglow* (relaxed, +0.10, 6 h): comfort gain ×1.2, energy gain ×1.1, fun decay ×0.85. Evening films lead to good sleep.
- *New high score* (happy, +0.08, 4 h; needs Dexterity 4): Dexterity learning ×1.25, Technology ×1.15, prefers `gaming` ×1.3.
- *Actually got moving* (energized, +0.06, 4 h): walk speed ×1.12, comfort decay ×0.85, prefers `fitness` ×1.2.
- *Snug as a bug* (relaxed, +0.05, 3 h): comfort decay ×0.8.

## Tags and trait patch
New shared tags: `gaming` (console, workout game) and `cozy` (cinema marathon, recliner, snack, lava lamp).
Patch: `gaming` ×1.6, `cozy` ×1.5, Dexterity learning ×1.1, starting Dexterity 1 (Technology 1 stays).
Preferences multiply, so the console's "Play" (screen + gaming) is about 2.9× more attractive to them. That is intended: their favourite hobby also builds a skill.

## Balance
The listed numbers are for 0 stars and skill 0. Takeout is the only per-use cost that adds up ($12 per meal, and only when they choose it); the movie marathon rents a film for $6. Everything else is free to use, and the cinema wall adds about $44/wk to the bills. In the checker's 3-day run household needs averaged 0.83.
Nothing tagged `sleep` was added, and the recliner doze is weaker than a bed nap, so the day/night rhythm is unchanged.

## Other personalities
Lazy residents will like the recliner and lava lamp (lounge/cozy). Outgoing residents will like the two-seat cinema and console (a little social).
Energetic residents will prefer the real treadmill. The workout game exists for people who would otherwise never exercise.
Foodies will ignore the takeout because the fridge and stove are cheaper and teach Cooking.
