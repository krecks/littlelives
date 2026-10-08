# Outgoing: content pack design note

Pack: `web/public/content/packs/outgoing.json` · models: `web/public/assets/packs/outgoing/manifest.json`

**What the outgoing resident wants:** company. The trait makes Social fall ×1.3 faster, likes `social`
×1.4, learns Charisma ×1.2 and starts with Charisma 2. The pack gives them places where the
household gathers (two-slot items, so residents stand or sit side by side and chat), a stage that turns
Charisma into feelings, and a way to soften loneliness when nobody is home.

| Item | Price | What it does to behaviour |
|---|---|---|
| Party photo wall (decor) | $120 | 15-min look at snapshots: fun 0.08 + social 0.06. A cheap pick-me-up for a broke, lonely resident. |
| Video-call corner (office) | $360 | Social 0.3 in 30 min (0.6/h, about 60% of a real chat at 1.05/h) + *Caught up with friends* (Social decay ×0.85, 3 h). Softens the trait's weakness without replacing visits. |
| Karaoke stage (hobbies, 2 slots) | $680 | Training: Charisma 0.22/h + Creativity 0.05/h, fun 0.3/h (like the mirror plus fun). *Belt out a showstopper* scales with Charisma; Charisma 5+ grants *Showstopper* (inspired, Charisma ×1.2, Creativity ×1.15 learning, +0.05 friendly acceptance, 4 h). |
| Home party bar (kitchen, 2 slots) | $1,150 | *Mix drinks*: fun 0.32 + a little hunger/social in 30 min (0.64 fun/h ≈ TV), costs some bladder; scales with Charisma; Charisma 4+ grants *Life of the party* (happy, Social decay ×0.8, +0.08 friendly success, Charisma ×1.15, 5 h). A soda as a snack. |
| Conversation sectional (living, 2x2, 2 slots) | $1,350 | Comfort 0.7/30 min (+17% over the sofa) + fun 0.08: the room's gathering point. |
| Light-up dance floor (hobbies, luxury, 2x2, 2 slots) | $3,400 | *Dance*: fun 0.6 + social 0.12 in 45 min, small Endurance/Dexterity gains, costs energy and hygiene; grants *Party glow* (energized, Social decay ×0.75, fun and social gains ×1.15, 4 h). |

**New tags (2):** `party` and `music`, both from the shared vocabulary. The trait patch only adds
`tagPreference` party ×1.8, music ×1.4 to `outgoing`.

## Balance reasoning
- Fun per hour stays near the TV (0.7/h): bar 0.64, dance floor 0.8, performance 0.7. What you get
  for the price is two slots, a second need, Charisma scaling (+5%/level) and buffs.
- Social from objects is deliberately weaker than talking (best: video call 0.6/h vs chat 1.05/h).
  The buffs slow Social decay instead, so outgoing residents still need people but last longer between chats.
- The strong feelings are Charisma-gated (4 and 5, both within reach for an outgoing resident after a few
  days on the karaoke stage, who start at 2). The trait already learns Charisma faster, so the pack
  rewards practising.
- Uses are free; the dance floor adds about $51/wk to the bills.
- Party items also carry `entertainment`, so the night schedule (entertainment ×0.35, sleep ×4)
  still sends residents to bed. Dancing costs energy and hygiene, so it never stands in for sleep.

## How other personalities react
- Loners (social ×0.6) mostly ignore the party items but still use the sectional for comfort.
- Couch potatoes and lazy residents love the sectional (`rest`, `lounge`); energetic residents like the dance floor.
- Foodies share the `party` tag at their pizza oven; cheerful and romantic residents benefit from the
  happy buffs and friendlier socials around a host who is the life of the party.
