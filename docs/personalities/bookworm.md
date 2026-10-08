# Bookworm: "Happiest with a good book"

**What they want.** Bookworms already rate `reading` 2.2× and learn Intelligence and Writing
25% faster. Left alone they read at the plain bookshelf until comfort, hunger and social
slip. This pack gives them better places to read, deeper study, and items that look after
those needs *while* they read. Pack: `web/public/content/packs/bookworm.json`.

**Tags.** Two new shared-vocabulary tags: `cozy` (comfortable reading spots, tea, letters)
and `study` (deep research, drafting). The trait patch adds `cozy` 1.6 and `study` 1.8 next
to the existing `reading` 2.2, so bookworms pick these items before the TV or the sofa.

| Item | Price | How it changes behaviour |
|---|---|---|
| Window-seat reading nook | $850 living | Reading that also restores comfort (fun 0.55 + comfort 0.5 per hour), so long reading sessions no longer leave them stiff. |
| Rare-books library wall | $1,250 office | *Research*: Intelligence 0.24/h, scales with Intelligence; at level 4+ grants **Eureka!** (focused; learns Intelligence ×1.3 and Writing ×1.15 for 4 h; prefers `study`), which keeps them studying. *Browse*: a slightly better read. |
| Writer's bureau | $700 office | *Draft*: Writing 0.23/h, scales with Writing; at level 5+ grants **Words are flowing** (inspired; Writing ×1.3, Creativity ×1.2). *Write a letter*: a small social top-up (0.18) for a resident who would rather write than call. |
| Book-club tea trolley | $240 kitchen | A 20-minute coffee-sized comfort and energy break with a nibble. It grants **Tea and pages** (happy; comfort decays 15% slower, reading ×1.2 for 3 h). Cooking skill makes better tea. |
| Fireside reading lounge (luxury) | $2,800 living, 2 seats | Reading by the fire: comfort 0.8 + fun 0.6 per hour, about 1.33× the nook. *Read aloud* adds social. Both grant **Fireside glow** (relaxed; energy gain ×1.2, comfort ×1.15 for 6 h), so an evening by the fire means a better night's sleep. |
| Bedside book stack | $90 bedroom | A cheap "one more chapter" (20 min) near the bed, so even a starter home has a bookworm spot. |

**Balance.**
- Need gains stay close to the base items: read 0.6 fun/h, armchair 1.5 comfort/h, coffee 0.75 comfort/h.
- Training items match base study (0.22–0.25/h main skill + 0.06 secondary), with token fun.
- The skill-gated buffs are only ×1.15–1.3 for 4 h.
- The fireside has no per-use cost. Its price is the up-front $2,800, and it adds about $42/wk to the bills.
- The tea is free to brew; the trolley adds about $4/wk to the bills.
- Nothing is tagged `sleep` or `nap`. Fireside glow only improves the night's sleep.
- Checker (3 days, Ada foodie/lazy + Bo neat/cheerful/bookworm): household needs average 0.83.

**Other personalities.**
- Lazy and couch-potato residents will like the fireside and nook through `lounge`, and relaxed residents through Fireside glow.
- Foodies will use the tea trolley through `food`.
- Loners may use letters instead of chatting.
- Focused and inspired residents (training/creative) are drawn to the library wall and bureau, and the Eureka and Words-are-flowing feelings feed those emotions back into more study.
