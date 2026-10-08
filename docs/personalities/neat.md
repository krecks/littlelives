# Neat: content pack design note

Pack: `web/public/content/packs/neat.json` · models: `web/public/assets/packs/neat/manifest.json`

**What a neat resident wants:** to feel clean (hygiene decays 1.2× faster) and to keep the home in
order (base trait already likes `hygiene` 1.5 and `chores` 1.6). In the base game almost no
autonomous chore exists, so the trait had little to act on. The pack gives it cleaning that is
*fun* for them, a luxury shower that slows the grubby feeling, and skills that grow from
order (Dexterity, Perception, Business).

New tag: `cleaning` (shared vocabulary). Also uses the base `spa` tag.
Trait patch: `tagPreference` cleaning 1.8, spa 1.2; `skillGain` dexterity 1.1, perception 1.1.

| Item | Price | Behaviour change |
|---|---|---|
| Steam mop dock (kitchen, 1×1) | $240 | Neat residents mop for fun/comfort (+0.15/+0.1 per 30 min, a little sweaty). Grants *Spotless home*. |
| Stacked laundry centre (bathroom, 2×1) | $780 | Laundry: small hygiene top-up between showers, scales with Dexterity; at Dexterity 4+ grants *Crisp fresh linens* (better sleep that night). "Precision folding" trains Dexterity 0.22/h (+Handiness 0.05), which no base object trains directly. |
| Rainfall steam shower (bathroom, 1×1, luxury) | $2,400 | Shower-speed hygiene (1.0 in 25 min vs 20) plus comfort 0.25 and a little energy; grants *Squeaky clean* (hygiene decays at 0.7×), which cancels the trait's 1.2× weakness for 6 h. |
| Label-and-sort organizer desk (office, 2×1) | $650 | "Sort and label" is a neat resident's TV: fun 0.53/h (TV 0.7/h, but preferred via chores), teaches Perception, grants *Everything in its place*. "Balance the ledger" trains Business 0.2/h. |
| Robot vacuum and dock (living, 1×1) | $560 | Gadget fun (0.4/h) teaching a little Technology; scales with Technology, and at Technology 3+ also grants *Spotless home*. |
| Tidy entry console (decor, 1×1) | $110 | Cheap 10-minute tidy: comfort 0.1, fun 0.05. Starter-budget way to feed the chore urge. |

**Feelings**
- *Spotless home* (happy, +0.08, 6 h): comfort decays 0.85×; lounge 1.2×, cleaning 0.6× (they just cleaned, so they relax instead of re-mopping in a loop).
- *Crisp fresh linens* (relaxed, +0.07, 10 h): energy gain 1.2×, comfort gain 1.15×. Boosts the next night's sleep; naps get the same ratio, so naps never beat night sleep.
- *Squeaky clean* (energized, +0.1, 6 h): hygiene decay 0.7×, friendly socials +0.05 acceptance.
- *Everything in its place* (focused, +0.06, 4 h): skill gain Perception 1.15×, Intelligence/Business 1.1×.

**Balance reasoning.** Need gains stay at or below the closest base items (mop/tidy ≈ sofa-level
comfort but split with fun; laundry hygiene 0.2/h vs sink 2.25/h, so it never replaces washing).
The luxury shower costs about 3.7× the basic shower (and adds about $36/wk to the bills); it is only ~0.8× as fast for hygiene,
and its value is the extra comfort and the decay buff. Training rates match base trainers
(0.2–0.22/h main + 0.05 secondary). Skill gates (Dexterity 4, Technology 3) make skill matter.
In `check_pack` (3 days, all items) household needs averaged 0.76.

**Other personalities.** Slob residents (who conflict with neat) get nothing from the `cleaning` tag and
use these items only for the raw need gains. Lazy and couch-potato residents may still pick the steam
shower for its `spa` comfort. Bookworm and loner residents may like the quiet organizer desk. Since
residents share a household budget, a neat resident's cleaning gear raises the whole family's weekly bills.
