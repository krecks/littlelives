# Lazy: content pack design note

Pack: `web/public/content/packs/lazy.json` · models: `web/public/assets/packs/lazy/manifest.json`

**What the lazy resident wants:** comfort without effort. The trait makes energy fall faster (×1.2), slows
walking (×0.85) and Strength/Endurance learning (×0.8), and likes `rest` (×1.6). The pack gives them
cosy places to lounge and nap, sleep that keeps them going longer, food that arrives without cooking,
a workout that barely tires them, and a way to "automate" the house.

| Item | Price | What it does to behaviour |
|---|---|---|
| Snoozecloud adjustable bed (bedroom, luxury, 2 slots) | $2,600 | Sleep = base bed energy plus comfort 0.6 (bed 0.4); grants *Slept like a cloud* (relaxed +0.1, energy decay ×0.8, comfort gain ×1.15, 8 h), which cancels the trait's ×1.2 drain for the morning. `cozy` lie-in nap. |
| Daydream nap pod (living) | $680 | Cocoon seat (comfort 1.1/h + a little fun) and a 40-min power nap granting *Perfect power nap* (energized: energy decay ×0.85, walk ×1.1, Endurance learning ×1.15, 3 h): a nap nudges the lazy resident toward exercise. |
| Heated quilt table (living, 2 slots) | $640 | Low table with a warm quilt: comfort 1.05/h + fun, and a dozing nap. The `cozy` hangout for two. |
| Doorstep delivery locker (kitchen) | $380 | $10 takeout (hunger 0.8 in 30 min, 1.6/h vs fridge meal 1.28/h) grants *No dishes tonight* (comfort gain ×1.1, 3 h); $5 noodles (hunger 0.55/20 min). Lazy cooking costs money every time. |
| Effortless vibration plate (fitness) | $520 | Endurance 0.2/h + Strength 0.06/h at energy −0.16/h, hygiene −0.1/h (treadmill: 0.25/h at −0.3/−0.3). Softens the lazy resident's fitness weakness. |
| Smart-home command hub (office) | $750 | Training item: Technology 0.22/h + Intelligence 0.05/h, scales with Technology; Technology 4+ grants *House on autopilot* (happy +0.08, comfort decay ×0.85, energy decay ×0.9, prefers `cozy` ×1.2, 8 h). "Ask for a story": fun + a little social. |

**New tags (1):** `cozy` (shared vocabulary, also used by the slob pack). Trait patch (lazy only):
`tagPreference` cozy ×1.8, nap ×1.4; `skillGain` technology ×1.15 (lazy minds find the shortcut).

## Balance reasoning
- Naps stay at or below the base bed nap (0.25 energy/h): pod 0.24, quilt 0.23, lie-in 0.24.
  `cozy` is only on naps and lounging, never on `sleep`, so the 1.8× preference cannot pull a full
  night's sleep into the afternoon. Night sleep stays the only `sleep` source; the luxury bed wins
  through comfort and its buff, not through faster energy.
- Lounging is within ±30% of the sofa (1.2/h): pod 1.1/h, quilt table 1.05/h, each with a little fun.
- Takeout is ~25% faster than cooking but costs $10/$5 per use, well under a day's pay.
- Training stays in the 0.2–0.25 band; the vibration plate trades a slower rate for low energy cost.
- Feelings are everyday treats (mood 0.05–0.1, 3–8 h); the strongest everyday one (autopilot) is
  gated behind Technology 4, so skill matters.
- Checker (`check_pack`): OK; in the 3-day starter-lot run the household kept needs at 0.85 and
  used the bed, quilt table, nap pod and hub daily.

## How other personalities react
- Couch potatoes and slobs share `cozy`/`lounge`/`rest` and will love the quilt table and nap pod.
- Energetic residents ignore the naps but the power-nap buff and vibration plate still suit them.
- Foodies prefer real cooking; everyone else uses the locker when hungry and the fridge is busy.
- Neat and bookworm residents may use the hub for Technology training like any desk.
