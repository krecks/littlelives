# Energetic: content pack design note

Pack: `web/public/content/packs/energetic.json` · models: `web/public/assets/packs/energetic/manifest.json`

**What the energetic resident wants:** to move. The trait already walks faster (×1.15), loses energy slower
(×0.8), learns Endurance faster and dislikes `rest` (×0.8). The pack gives them sport to seek out, ways to
pay off the sweat and hunger that sport costs, and one luxury that finally makes resting worth it.

| Item | Price | What it does to behaviour |
|---|---|---|
| Home bouldering wall (fitness, 2×1) | $1,100 | Strength training 0.20/h + Dexterity 0.07/h; energy and hygiene −0.3 per hour like the weight bench, fun 0.2. |
| Interactive spin bike (fitness, 1×2) | $1,250 | Endurance 0.20/h + Strength 0.05/h, fun 0.35/45 min; `skill: endurance`, so fitter riders enjoy it more; Endurance 4+ grants *Endorphin rush* (energized +0.1, fun decay ×0.8, energy decay ×0.9, Strength/Endurance/Dexterity learning ×1.15, 4 h). |
| Rebound trampoline (outdoor, 2×2) | $480 | Fun 0.4/30 min (0.8/h, TV is 0.7/h) at a small energy/hygiene cost, a dash of Endurance/Dexterity: the energetic resident's "TV". |
| Streetball hoop (outdoor, 2 slots) | $340 | Fun 0.4 + social 0.1 in 40 min; two residents shoot together. |
| Power blender station (kitchen) | $320 | Smoothie: hunger 0.35 + energy 0.06 in 15 min (snack-speed food); scales with Cooking; Cooking 3+ grants *Fuelled up* (energized, hunger and energy decay ×0.85, 4 h). |
| Contrast rain shower (bathroom) | $1,050 | Hygiene 0.95 in 15 min (+27%/min vs the shower) + a little energy; grants *Refreshed* (hygiene decay ×0.8, walk ×1.05, 3 h): workouts cost less hygiene. |
| Recovery pod (fitness, luxury, 1×2) | $3,200 | Session (adds about $48/wk to bills): comfort 0.85, energy 0.12, fun 0.1 in 45 min; grants *Fully recovered* (relaxed +0.1, energy gain ×1.2 = deeper sleep, comfort gain ×1.15, Strength/Endurance learning ×1.1, 8 h). |

**New tag (1):** `sport` (shared vocabulary), on every active item and the pod. The trait patch adds
`tagPreference` sport ×1.8 and fitness ×1.2 to `energetic` only. Preferences multiply per tag, so the
pod (`rest` 0.8 × `sport` 1.8 ≈ 1.44) is the one rest spot an energetic resident actively chooses.

## Balance reasoning
- Training stays in the 0.20–0.25/h band with base-like costs (energy/hygiene −0.25..−0.3 per session);
  fun items teach 0.04–0.06/h.
- Food and hygiene speeds stay within ~30% of base (smoothie 1.4 hunger/h vs snack 1.8/h; shower +27%),
  the extra being a small energy sip and a short buff. Uses are free; the pod adds about $48/wk to the bills.
- Energy restoring never beats sleep or a nap: pod 0.16/h, smoothie 0.24/h, shower 0.24/h (nap 0.25/h).
  *Fully recovered* boosts night sleep instead of replacing it; the `sleep` rhythm is untouched.
- Feelings 0.06–0.1 mood, 3–8 h; the strongest training buff is gated behind Endurance 4 and the
  smoothie buff behind Cooking 3, so skill matters.
- Checker (3 days, foodie/lazy + neat/cheerful/bookworm testers): household needs 0.85; the
  lazy tester loved the pod (~4 h/day), the training items went unused by non-energetic residents as intended.

## How other personalities react
- Lazy and couch-potato residents ignore the wall/bike but enjoy the pod's `rest`/`spa`; it is the pack's
  crossover item.
- Neat residents appreciate the fast contrast shower; foodies use the blender as a quick snack.
- Outgoing/cheerful residents gather at the 2-slot hoop (fun + social); loners prefer the trampoline or bike.
