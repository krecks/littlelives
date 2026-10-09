# Life cycle II (0.13)

*Status: done on `build-and-watch` (0.13). Roadmap: PLAN.md section 8. Builds on 0.12
([life-cycle.md](life-cycle.md)).*

Families grow: couples have babies or adopt, babies grow into children and teens who go to
school, and teens grow up into the young adults of 0.12 who work, fall in love and move out. A
town can now run for generations. The house has to have a crib, a child's bed, a desk.

Same principles: data-driven (content `life`), simulated and saved, ids and numbers.

## Stages

Content `life.stages` gains the young stages, and every stage says what it allows:

```json
{"id": "baby",  "label": "Baby",  "from": 0,  "baby": true, "scale": 0.36, "head": 1.6},
{"id": "child", "label": "Child", "from": 2,  "school": true, "scale": 0.62, "head": 1.3,
 "effects": {"tagPreference": {"cooking": 0, "work": 0}}},
{"id": "teen",  "label": "Teen",  "from": 13, "school": true, "scale": 0.9, "head": 1.06},
{"id": "youngAdult", "label": "Young adult", "from": 18, "adult": true}, ...
```

- `adult`: may work, fall in love (romantic socials need both to be adults), move in together
  or out, have or adopt children, retire. A household needs an adult to move in anywhere.
- `baby`: doesn't walk or choose anything; lives in a crib and is cared for (below).
- `school`: goes to school on school days (below).
- `scale` and `head`: how big they are, and how big their head is for it (renderer only).
- `effects` as before; children don't cook (`tagPreference` 0 means never on their own).

At *Normal* (2 days a year) a baby is a baby for 4 days, a child for 22, a teen for 10.

## Bodies

The renderer scales the whole rig by the stage's `scale` (on top of the resident's height) and
the head and face by `head`, around the head joint, in the skinning step (`pose.ts`), so a
child is a smaller adult with a bigger head; animations, sitting and lying already scale.
Elders stoop a little (an additive bend of the upper spine). Portraits and the creator's stage
use the same code, so they show it too. Real child and elder models can replace this later
through the asset manifest.

## Babies and cribs

A **crib** (content object; two tiles: the crib and a changing table) has a place for the baby
(an interaction with `"baby": true`, lying) and room for someone to tend it. A baby with nothing
to do is put straight into a free crib at home and never chooses anything. Content interactions
with `care` gains (`"care": {"hunger": 0.8}`) are used by a grown-up at home standing at it and
fill the needs of the baby lying there: feed, change, play. The care is collected during the
tick and applied after it (`Sim::care_out`), as mess and news are. The AI scores care by how
much the baby needs it (from the residents' briefs), family half as much again, so parents look
after their baby without orders. A baby whose needs run low cries (a thought bubble with the
need's icon). Babies have no accidents.

A baby born, adopted, moving in or starting a game in a home with no free crib gets one
delivered to a free spot; with no room for one, they have to wait for the player to make room.

When a baby becomes a child they get out of the crib.

## School

On school days (content `life.school`: `start`, `hours`, `days`, `skills`) children and teens
leave for school like a shift (away, through the town exit) and come back in the afternoon,
having practised content `school.skills` a little. A child too tired or hungry still goes. The
resident panel says "At school". No pay, no career, no grades yet.

## Having children

- **Pregnancy:** partners who are both adults (and at most `pregnancy.maxAge`) can *Try for a
  baby* (a romantic social whose success has the `conceive` effect). The conversation only marks
  it; after the step the life cycle checks living together, ages, room and nothing on the way,
  and with `pregnancy.chance` the household is expecting (`Household::expecting`: the parents and
  the due day, `pregnancy.days` later), so any couple can have a baby. The AI only tries where a
  baby could come of it. The story says they're expecting, then that the baby is born (at
  midnight on the due day).
- Only with room: below `rules.maxHousehold`, and the town below its cap.
- **The baby:** a name from content `names` by gender, the household's name, random traits, a
  look mixed from the parents' (an appearance seed with the parents' slots: the web takes skin
  from one parent and hair from the other), family links to both parents and any siblings.
- **Adoption:** the player can adopt a baby or a child (a button in *Our home*), for
  `adoption.cost` (free in Creative), when there's an adult and room; the parents are a couple
  in the household if there is one. (Neighbours don't adopt yet.)

## Growing up

Reaching *child*: out of the crib, starts school. *Teen*: school goes on. *Young adult*: school
ends; they can work, fall in love and move out (0.12). Each is a journal moment.

## Interface

- The creator: ages from baby to elder; a household needs an adult; children and teens get
  family bonds to the adults.
- Resident panel: "At school"; babies show their needs and who's caring for them.
- *Our home*: who's expecting, *Adopt a baby / child*.
- Bubbles: a crying baby.

## Saves

Version 14: households expecting (parents, due day). Everything else is already saved (ages,
babies in cribs are `Use` tasks, families are kin).

## Build order

1. Young stages: stage flags (adult, baby, school), gates (romance, jobs, moving, retirement),
   creator and generated households with children, test town families with children.
2. Bodies: stage scale and head size in the renderer, elder stoop, portraits.
3. Babies and cribs: crib content, babies in cribs, care interactions and their AI, crying.
4. School.
5. Pregnancy, birth and adoption, mixed looks.
6. Growing up (out of the crib, school ends), journal texts.
7. Interface pass, soak over generations, balance, docs.
