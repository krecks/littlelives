# Cheerful: music, parties and sunshine

Pack: `web/public/content/packs/cheerful.json` · models: `web/public/assets/packs/cheerful/manifest.json`

**What they want.** Cheerful residents already get a flat mood bonus. This pack gives that good mood
something to do: they gravitate to `party` (×1.8) and `music` (×1.6) items, learn Charisma 10%
faster, and most of their items leave a feeling that keeps them happy and social between activities.

| Item | Price | What it changes |
|---|---|---|
| Sunburst jukebox (living) | $850 | Dancing: fun 0.5/45 min (about the same rate as TV) at a small energy and hygiene cost, a little Dexterity and Endurance. Leaves them *Upbeat* (fun decays 15% slower, more drawn to party and music items). Two residents can dance at once. |
| Spotlight karaoke machine (hobbies) | $700 | The training item: Charisma 0.22/h + Creativity 0.05/h. Scales with **Charisma**: better singers get more fun out of it. From Charisma 5 a song makes them a *Showstopper* (Charisma learned ×1.2, friendly socials +8% success, slower social decay), so practice snowballs into better conversations. |
| Fizz & sunshine mocktail cart (kitchen) | $420 | A light fruity drink: hunger 0.12, energy 0.05, fun 0.15 in 15 min. Scales with **Cooking**, and from Cooking 3 it gives *Upbeat*. A pick-me-up between proper meals, not a replacement for them. |
| Rainbow hammock (outdoor) | $360 | Swinging: comfort 0.45 + fun 0.15 in 30 min, a little less comfort than the sofa (0.6) but with some fun. Dozing: a `nap` (energy 0.2/h) that is weaker than a bed nap (0.25/h), so night sleep stays the main way to restore energy. |
| Sunrise stretch lamp (bedroom) | $240 | 20 minutes of gentle stretches with a small gain in energy and comfort. Gives *Bright morning* (energized: energy decays 10% slower, fun gains ×1.1 for 4 h). A cheap way to start the day well. |
| Confetti party booth (living, luxury) | $2,600 | Adds about $39/wk to bills. A two-seat video party lasting 90 min: fun 0.6, social 0.45, comfort 0.2. This is the only item that refills Social without another resident present, which helps when a cheerful resident lives alone. Gives *Party glow* (+0.12 mood for 6 h: social and fun decay 20% slower, friendly socials are accepted 6% more often). |

**Feelings:** Upbeat (happy +0.06, 3 h), Showstopper (happy +0.10, 6 h, gated by Charisma 5),
Party glow (happy +0.12, 6 h), Bright morning (energized +0.06, 4 h).
**New tags:** `party`, `music` (both from the shared vocabulary; the foodie pack also uses `party`).

## Balance reasoning
- Rates per hour are kept within ±30% of the closest base item: jukebox vs TV (0.67 vs 0.7 fun/h), hammock vs
  sofa/armchair, karaoke vs the piano and easel (0.22 skill/h, fun 0.3/h). The extra value of each item is a feeling,
  not bigger raw numbers.
- The party booth is the luxury item: it fills three needs, and the high price (and about $39/wk on the bills) pays
  for that. I made the parties longer (90 min, so fewer are started) and the mocktail lighter (less hunger). In the
  checker's 3-day run the household's average needs stay at 0.82.
- Night sleep is not affected: the only `nap` is weaker than a bed nap, and nothing in the pack uses the `sleep` tag.

## How other personalities might react
- **Outgoing / kind** like the same things through `party` and friendly socials. The booth is a natural shared purchase.
- **Gloomy / loner** have no reason to pick these items, but the hammock and the stretch lamp are neutral comfort and
  energy items anyone can use.
- **Energetic** residents like the jukebox (energy cost, a little Endurance), and **foodie** residents share the `party` tag through
  the mocktail cart.
- **Couch potatoes** will use the hammock and booth for comfort and entertainment.
