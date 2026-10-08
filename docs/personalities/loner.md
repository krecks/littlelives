# Loner: "Happy with their own company; small talk is a chore"

**What they want.** Loners already lose Social 40% slower, rate `social` interactions 0.6×
and learn Intelligence 10% faster. Without this pack they have few solo things to do besides
TV and books, and Social still slowly drains. The pack gives them one-seat retreats, quiet
hobbies that train a skill, and ways to cover Social and Hunger without small talk.
Pack: `web/public/content/packs/loner.json`.

**Tags.** Two shared-vocabulary tags: `cozy` (pod, radio, puzzles; also used by bookworm and
slob) and `garden` (bonsai; also foodie). Trait patch: `cozy` 1.8, `garden` 1.5, `spa` 1.3,
plus Perception learning ×1.15 (a loner notices things), so loners choose these items
before the sofa or the TV.

| Item | Price | How it changes behaviour |
|---|---|---|
| Hush-shell reading pod | $850 living | *Retreat*: comfort 0.7 + fun 0.2 in 40 min (sofa-level comfort plus a little fun); grants **Recharged** (relaxed; social decays ×0.85, fun ×0.9 for 3 h). *Read in peace*: a bookshelf read with some comfort. |
| Shortwave radio desk | $780 office | *Chat on the airwaves*: social 0.3 + fun 0.2 in 45 min, under half the rate of a face-to-face chat, scales with Technology. At Technology 4+ grants **Kindred signal** (happy; social decays ×0.75, Charisma ×1.2 for 6 h). *Tune the rig*: Technology 0.22/h + Handiness 0.06/h training. |
| Jigsaw puzzle table | $320 hobbies | *Fit a few pieces*: TV-level fun with a little Perception. *New 2,000-piece puzzle* ($6): Perception 0.2/h, scales with Perception; at 3+ grants **In the zone** (focused; Perception ×1.25, Intelligence ×1.15, likes `training` for 4 h). |
| Bonsai potting bench | $420 hobbies | *Shape*: Dexterity 0.21/h + Creativity 0.06/h, scales with Dexterity. *Mist and feed*: a short chore with a little fun. |
| Cedar sauna for one (luxury) | $3,400 bathroom | comfort 0.85 + hygiene 0.3 + fun 0.1 in 40 min, slightly better than the whirlpool but for one resident only. Grants **Deep quiet** (relaxed; energy gain ×1.25, comfort ×1.15, social decays ×0.85 for 8 h): better sleep that night and less loneliness. |
| No-knock delivery hatch | $280 kitchen | *Order a meal* ($9): hunger 0.75 in 30 min (1.5/h vs the fridge meal's 1.28/h) with no cooking and no visitors. *Treat box* ($4): a snack. |

**Balance.**
- Need gains are within about ±20% of the nearest base item (sofa, bookshelf, TV, fridge meal, whirlpool).
- The extras are feelings or one small second need.
- Training matches base study: 0.20–0.22/h main skill + 0.06 secondary, with little fun.
- Buffs are ×0.75–1.25 for 3–8 h. Two are gated by skill: Technology 4 and Perception 3.
- Nothing is tagged `sleep` or `nap`. Deep quiet only helps the following night's sleep.
- The radio gives Social without being a `social` interaction, so the loner's 0.6× dislike of socials still applies to chats.
- Only the delivery hatch and new puzzles cost money per use; the sauna adds about $51/wk to the bills.
- Checker, 3 days on the starter lot: all 6 items were used; household needs averaged 0.83.

**Other personalities.**
- Bookworms and slobs share `cozy` and will use the pod and the puzzles.
- Foodies and nature lovers share `garden` and will use the bonsai bench.
- Lazy, gloomy and relaxed residents are drawn to the sauna through `spa`/`rest`.
- Outgoing residents get little from the radio compared with real chats.
- Focused residents (In the zone) keep training, so puzzles feed into study streaks.
