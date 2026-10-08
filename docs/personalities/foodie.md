# Foodie: content pack design note

Pack: `web/public/content/packs/foodie.json` · models: `web/public/assets/packs/foodie/manifest.json`

**What the foodie wants:** to eat well and often, and to get better at cooking. The trait already
makes hunger fall faster (×1.15) and fill faster (×1.2), likes `food`/`cooking` and learns Cooking
faster. The pack gives them quick bites for the constant hunger, ways to train Cooking, and
premium kitchens where skill turns into feelings that keep them full and learning.

| Item | Price | What it does to behaviour |
|---|---|---|
| Windowsill herb garden (decor) | $140 | Short `garden` chore; grants *Fresh herbs* (inspired, Cooking learning ×1.15, prefers `cooking` ×1.3 for 4 h): tending the herbs leads straight to the stove. |
| Deli pantry (kitchen) | $320 | Nibble (hunger 0.35/10 min, fridge snack is 0.3) and cheese board: slightly better snacks that soften the foodie's fast hunger. |
| Espresso bar (kitchen) | $450 | Shot (energy 0.05/10 min, +25% vs dining-table coffee per hour) with *Fresh espresso* (energy decay ×0.85, 3 h); latte art trains Dexterity 0.12/h + Cooking 0.08/h. |
| Cookbook lectern (kitchen) | $280 | The Cooking training item: Study recipes = Cooking 0.22/h + Writing 0.05/h, fun 0.1/h (mirrors bookshelf study). Food magazines = fun like reading. |
| Wood-fired pizza oven (outdoor, 2 slots) | $1,400 | Pizza: hunger 0.85 + fun 0.2 in 50 min, scales with Cooking; Cooking 4+ grants *Perfect crust* (happy, hunger decay ×0.8, social gain ×1.2, 5 h). Also a comfort spot to warm up. |
| Chef's island (kitchen, luxury, 2 slots) | $3,200 | Tasting menu: hunger 0.95, fun 0.3, comfort 0.1 + Cooking 0.24/h over 80 min, scales with Cooking; Cooking 6+ grants *Culinary triumph* (inspired +0.14, Cooking learning ×1.25, Creativity ×1.15, hunger decay ×0.85, 8 h). Two bar stools for a quick bite. |

**New tags (2):** `garden` (herb garden) and `party` (pizza oven), both from the shared vocabulary.
The trait patch only adds `tagPreference` garden ×1.4, party ×1.3 to `foodie`.

## Balance reasoning
- Hunger per minute stays at or near the fridge (meal 1.28/h): pizza 1.02/h, tasting menu
  0.71/h, cheese board 1.32/h. The premium items win on extra needs (fun, comfort), skill
  scaling (+5%/level, so a level-8 cook gets ×1.4) and buffs, not on raw speed.
- Uses are free; the running costs come through the weekly bills (the island alone adds about $48/wk).
  In the checker's 3-day starter-lot run (foodie + bookworm) with every item bought, the island became
  the household's main kitchen (about 4 h a day per resident, meals plus bar bites).
- Training stays in the 0.2–0.25 levels/h band; the tasting menu has no `training` tag, so it reads
  as a meal rather than a study session (it still teaches while eating well).
- Feelings are everyday treats (mood 0.05–0.14, 3–8 h); the strong ones are skill-gated (4 and 6),
  so a novice cook buying the island gets food and fun, a master gets the triumph.
- No item touches sleep; the espresso buff only slows energy decay for 3 h, it does not replace sleep.

## How other personalities react
- Everyone eats: non-foodies use the pantry and island as better snacks and meals, but without the
  1.6–1.8× preference they fall back to the fridge more often.
- Bookworms like the lectern (`reading`, `training`); nature lovers like the herb garden (`nature`);
  outgoing/party residents gather at the pizza oven; lazy residents enjoy the bar stools (`lounge`).
- Neat residents may like the herb garden's `chores` tag; slobs mostly just snack at the pantry.
