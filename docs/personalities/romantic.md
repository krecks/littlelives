# Romantic: content pack design note
Pack: `web/public/content/packs/romantic.json` · models: `web/public/assets/packs/romantic/manifest.json`

**What the romantic wants:** love, and the setting for it. The trait already prefers `romantic`
socials (×1.8), is easier to woo (+0.12 acceptance) and starts with Creativity 1. The pack gives
them date-night furniture: places to share with a partner (2-slot items), ways to get ready, and
feelings that make flirting land more often (`tagSuccess`/`tagAcceptance` on `romantic`).

| Item | Price | What it does to behaviour |
|---|---|---|
| Candlelit bistro table (kitchen, 2 slots) | $780 | Dinner: hunger 0.8 + fun 0.15 + comfort 0.05 in 50 min, scales with Cooking; Cooking 4+ grants *Candlelit glow* (flirty +0.10, romance success +0.08, social gain ×1.2, 5 h). A shared dessert as a small treat. |
| Heart-shaped petal tub (bathroom, luxury, 2 slots) | $2,800 | Bath: comfort 0.8, hygiene 0.5, fun 0.15 in 45 min; grants *Petal-soft* (relaxed +0.12, energy gain ×1.2 so sleep is better, comfort ×1.15, +0.08 to being wooed, 8 h). |
| Love-letter bureau (office) | $420 | The training item: love letters = Writing 0.22/h + Charisma 0.06/h. Love poems (fun 0.47/h, scales with Writing); Writing 3+ grants *Lovestruck* (inspired, Writing ×1.2, Charisma ×1.15 learning, prefers `romance` ×1.3, 6 h). |
| Rose-gold vanity (bedroom) | $520 | Primp before a date: hygiene 0.2 in 20 min, a little Charisma, scales with Charisma; grants *Date-ready* (flirty +0.06, romance success +0.06, social gain ×1.15, 3 h). |
| Moonlight gramophone (living) | $360 | Love songs: fun 0.6/h (just under TV) and the base *Butterflies* feeling, so the resident turns flirty and seeks out romance; waltzing trains Dexterity 0.1/h. |
| Rose-arbour swing (outdoor, 2 slots) | $750 | Comfort 0.68/h + fun 0.3/h outdoors (bench is comfort 0.7/h); rose tending is a small `nature`/`chores` task. |

**New tags (2):** `romance` (object side of love; the social tag `romantic` stays on conversations)
and `music` (shared vocabulary). Trait patch on `romantic` only: `tagPreference` romance ×1.8,
music ×1.2, and `skillGain` charisma ×1.1.

## Balance reasoning
- Need rates stay near the base equivalents: dinner hunger 0.96/h (fridge meal 1.28/h) traded for
  fun/comfort and a buff; the tub matches the example whirlpool's comfort (1.07/h) and adds more
  hygiene, so it costs more ($2,800 vs $2,200). No item touches the `sleep`/`nap` tags; the tub only
  boosts energy gain while the buff lasts, so night sleep stays the main way to rest.
- Training stays in the 0.2–0.25 band (letters 0.22/h); the poem and primp teach a little (0.06–0.08).
- Skill matters: dinner needs Cooking 4 for the glow, poems need Writing 3 for Lovestruck, and
  both scale +5%/level. The romance-success buffs are small (+0.06–0.08) so they nudge, not guarantee.
- Uses are free; the tub adds about $42/wk to the bills. An early draft gave the dinner a social
  gain; residents then ate there all day. Without it, in the checker's 3-day starter run with everything
  bought, household needs averaged 0.78.

## How other personalities react
- Everyone eats and bathes: other residents use the table and tub for their needs and get the buffs, so a
  non-romantic partner who shares the tub ends up easier to woo too.
- Relaxed/lazy residents like the tub (`spa`) and swing (`lounge`); nature lovers like the swing and roses;
  creative and bookish residents use the bureau (`creative`, `training`); music lovers like the gramophone.
- The gramophone's Butterflies can make any resident briefly flirty, which can be awkward next to a
  hot-headed or jealous housemate.
