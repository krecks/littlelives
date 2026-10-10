# Changelog

All notable changes to Littlelives. Versions follow [semantic versioning](https://semver.org); each release is a git tag `vX.Y.Z`.

## Unreleased (0.20.0)

### Changed
- **Lines said before play at once:** each clip a resident speaks is kept (up to 24 MB, about four minutes of speech), so when they say the same line again it plays straight away, even while the voice is unloaded. The performance overlay (F3) shows how many clips are kept and reused.

### Removed
- **Babble**, the made-up language, is gone: residents speak English or not at all. *Settings → Audio* no longer has a Language choice; a saved Babble setting becomes English.
- While the English voice loads, residents stay quiet (they used to babble), and babies don't speak.
- If speech keeps coming late or slows the game down, resident voices pause for the session, with a message saying why (they used to switch to Babble).

## 0.19.0 — 2026-10-10

**Play it in your browser:** https://krecks.github.io/littlelives/

Performance and scale: a faster start, a lighter HUD and a much bigger town.

### Changed
- **Faster start:** the menu downloads about half as much (12.8 MB instead of 23.7 MB) and the game script is a quarter of the size (1.8 MB instead of 6.6 MB). Textures stay compressed on the graphics card (KTX2), using about a sixth of the memory. Residents' data loads right after the menu appears, and other houses' furniture streams in the background; an item not loaded yet loads as soon as you pick or place it.
- **A lighter HUD:** about 10 times a second the interface now gets only what changed, instead of the whole game view: under 1 KB per update instead of 20–80 KB, and the cost no longer grows with every pair of residents. Neighbours' details (needs, feelings, plans) arrive while their panel is open.
- **A bigger town runs faster:** residents only look at what they may use (their home, public places, the lot they're visiting), and lots nobody is looking at are simulated in less detail: their residents take a turn every game minute and catch up. A town of 34 houses with 64 residents simulates about 5× faster; what happens in it stays the same within noise. Saves are unchanged.
- The performance overlay (F3) shows each thread (main, simulation, voice) and the total.

### Fixed
- Continue could hang at *Warming up…* on WebGPU.
- A short stall on WebGL2 when a saved game was revealed.

## 0.18.0 — 2026-10-10

Generated houses: no two neighbours live in the same house.

### New
- **Every neighbour's house is generated:** cottages, bungalows, town houses, family houses and villas, picked by lot size. Every home has at least a bedroom, a kitchen and a bathroom; bigger ones a living room (sometimes open to the kitchen), more bedrooms and a second bathroom. Rooms, doors, windows and furniture are arranged differently each time, and each house gets a name and a description (*Alder Place: a two-storey town house with two bedrooms, a living room and two bathrooms*).
- **One or two storeys:** two-storey houses have stairs in the living room and the bedrooms and a bathroom upstairs; from the street they stand taller.
- **Make it your own:** `content/housegen.json` sets the house classes (bedrooms, sizes, how often there's a living room, a second bathroom or a second storey), which lot sizes get which, room sizes, the furniture each room gets, how often kitchens are open-plan, windows, garden things and house names.

## 0.17.0 — 2026-10-10

Storeys: houses grow upwards.

### New
- **Upstairs:** build walls, doors, windows and floors on the storey above (up to three storeys); a room upstairs needs a room under it. *Page Up / Page Down*, or the arrows in the top bar, switch the storey in view; the ones above it are hidden, and Build and Buy work on it.
- **Stairs:** *Buy → Living → Staircase* (1 × 4 m). Residents climb it step by step to use what's upstairs; the view follows the resident you're looking at up and down.
- Roofs cover the top of each part of the house (no roof under a room upstairs); the stairwell is open to the floor below.
- Blueprints keep every storey, and moving a room keeps it on its own storey.

### Changed
- Saves are now version 17 (storeys); older saves load as before and get the storeys above.

## 0.16.0 — 2026-10-10

Bigger homes I: lots of different sizes, blueprints, and rooms that move.

### New
- **Lot sizes:** towns mix small (20 × 18 m), medium (26 × 22 m) and large (34 × 26 m) lots. Choosing a home, *Lot size* makes the lot you picked smaller or bigger (the street makes room); the card shows its size and weekly rent, which grows with the lot. A small lot only takes a house that fits on it.
- **Blueprints:** *Build → Blueprints → Save this house* keeps your home (walls, doors, windows, fences, wall coverings, floors, the roof and the furniture) in this browser, with a picture, for any game. *Build here* builds a blueprint on your empty lot all at once, turned to face the street and centred on the lot, paid like building and buying it piece by piece (free in Creative). One undo takes it all back; without the money, nothing is built and you're told what it costs.
- **Move a room:** *Build → Move*: drag a room and let go. Its walls, doors, windows, floor and everything in it come along; walls it shares with another room stay for that room. The preview turns red where it can't go (off the lot, onto another room); furniture that wouldn't fit, or anyone who'd be shut in, stops the move. Free, and undone like any edit.

## 0.15.0 — 2026-10-10

Visitors and sound: neighbours knock, and the world can be heard.

### New
- **Visitors knock:** a visitor walks up to the front door and knocks. The grown-up at home nearest the door stops what they're doing and answers: friends and acquaintances are let in and greeted with a chat; someone the host can't stand, or anyone at an unreasonable hour, is turned away (and feels it for a while). With nobody to answer (everyone out or asleep), the visitor waits a little and goes home. Both land in the journal.
- **Sounds of the world:** a soft outdoor hum, birds by day (a dawn chorus in the early morning) and crickets at night, following the game clock; on the lot you're looking at, a pan sizzles, water runs, the TV murmurs and music plays where residents are doing those things, from where they are on screen; and a knock at the door. *Settings → Audio → Sounds of the world*, with its own volume.

### Changed
- Sound effects, voices and the sounds of the world share one audio output, each with its own volume.
- Saves are now version 16 (the visitors' story); older saves load as before.

## 0.14.0 — 2026-10-10

Voices II: Babble. Residents can speak a made-up language that needs no download.

### New
- **Babble:** *Settings → Audio → Language → Babble*. Residents say their lines in made-up syllables, about as long as the line, each with their own voice; the same word always sounds the same. Nothing to download, and it works on any computer.
- With English chosen, residents babble while the voice is still loading, and babies always do (they cry).
- **Voices by age:** children speak higher, boys' voices drop in their teens, elders speak a little lower and slower.

### Changed
- The English voice is unloaded after five quiet minutes and comes back from the browser's cache on the next line.
- If English speech keeps coming late, or making it slows the game down, residents switch to Babble for the rest of the session, with a message saying why.
- The performance overlay (F3) shows the voice language and how many lines were Babble.

## 0.13.0 — 2026-10-10

Life cycle II: families grow. Couples have babies or adopt, babies grow into children and teens who go to school, and teens grow up into the young adults of 0.12. A town can now run for generations.

### New
- **Babies, children and teens.** The household creator has every age from baby to elder (a household needs a grown-up), and random families sometimes have children. Children and teens don't work, flirt or move out on their own; children don't cook.
- **Bodies for every age:** children are smaller with bigger heads, teens nearly grown, babies tiny, and elders stoop a little. Portraits and the creator show it too.
- **Babies and cribs:** a baby lies in a crib (a new item: crib and changing table) and the grown-ups at home feed, change and play with them on their own, more the more the baby needs it. A baby who needs something cries. A baby who arrives in a home without a crib gets one delivered.
- **School:** on weekdays children and teens go to school from 8:00 to 15:00 and learn a little; the resident panel says *At school*.
- **Having a baby:** partners can *Try for a baby*; if it works, the household is expecting (shown in *Our home*), and three days later the baby is born, looking a bit like both parents, into a family of parents, brothers and sisters.
- **Adoption:** *Our home → Adopt a baby / Adopt a child* ($1,500; free in Creative). Neighbours without children adopt now and then too.
- **School grades and homework:** pupils have a grade (A–F, in the resident panel): days at school raise it, more in a good mood, missed days lower it, and homework at a bookshelf or computer desk raises it more. Finishing school is a moment in the journal with the final grade.
- **Romance between singles:** single grown-ups who are attracted to each other and have met now flirt, fall for each other and ask to be partners; before, couples almost never formed, and so few children were born.
- **Growing up:** a baby gets out of the crib as a child, school ends at 18, and young adults can work, fall in love and move out.

### Changed
- Romance chosen by residents on their own is now only between grown-ups who aren't family (asking them to already was).
- A guest left with nothing to do while the hosts are all at work goes home.
- Adopted children no longer take their look from their adoptive parents, and children and teens never have grey hair.
- Saves remember the story by content id (save version 15), so a change in content can't make old events name the wrong thing; saves from before the crib are corrected.
- Saves are now version 15 (a baby on the way, school grades, the story by content id); older saves load as before.

## 0.12.0 — 2026-10-10

Life cycle I: lives move on. Everyone is an adult here; babies, children and teens come in 0.13.

### New
- **Ages and life stages:** every resident has an age and is a young adult, an adult or an elder. Reaching a new stage is a moment in the journal with a feeling; elders tire sooner, walk a little slower and their hair greys. The household creator has an age for each resident (pick a stage, or type the age), and the resident panel shows it.
- **Lifespan**, chosen with a new game and changeable in *Settings → Gameplay*: *Off* (nobody ages), *Short* (a year every game day), *Normal* (every two days: a whole life in about 130 days) or *Long* (every four). Games saved before this version load with aging off.
- **Retirement:** at 65 a working resident retires, and the household gets a weekly pension of 40% of their last pay on rent day. Retirees can still take a job.
- **Passing away:** from 75 the old may pass away (on average in their mid-eighties). Family, partners and close friends grieve for days, friends miss them, and the journal remembers them, even once someone new lives in their place.
- **Family:** parents, children and siblings. The household creator's bonds offer *Parent*, *Child* and *Sibling* (with a note when the ages don't fit); random households are sometimes a couple with a grown child or two siblings; the People tab says who is whose mother, son or sister; relatives don't flirt.
- **Moving:** partners living apart move in together where a home has a bed for everyone (into your home if there's room, bringing some money), or into a house for sale together. Grown children with a job move out of the family home into a house for sale; with none free, some leave town. *Settings → Gameplay → Moving* keeps your household out of it.
- **Newcomers:** a furnished house nobody lives in gets new neighbours now and then: a single, a couple (sometimes with a grown child) or two siblings, with names, traits, ages and looks of their own. Your home is never given away, even if nobody lives there any more.

### Changed
- Residents no longer start a sleep that hunger or the bathroom would end at once (a starving, exhausted resident tried every minute); they eat or go first.
- Things wear by how much of a full use they got (a nap cut short wears a bed a little); base wear is higher to match, so breakdowns come about as often as before.
- Residents hurry to repair what they badly need (a broken toilet before a broken lamp).
- Oakridge House has a proper bathroom (its wall stopped halfway); a second-bathroom wish now forms only from waiting for the toilet, on two different days in a week.
- Saves are now version 13 (ages, the lifespan, residents who are gone, former residents' names, family links, retirement, the Moving setting). Older saves load as before, with aging off.

## 0.11.0 — 2026-10-10

The house matters: what you build changes how your residents live, and they tell you what they'd like next.

### New
- **Room scores:** every room of the house (and the garden) is scored on size, light (windows by day, lamps by night), decor (plants, lamps, decor, wall and floor coverings), cleanliness and function (what it's for, nothing out of place), each 0–100, and overall. What a room is comes from what stands in it: a toilet makes a bathroom, a stove a kitchen, a bed a bedroom, a sofa or TV a living room, a desk or bookcase a study. A bed in the kitchen makes it two rooms in one.
- **Surroundings**, a new need: it drifts towards the score of the room a resident is in, so a bright, tidy, well-kept house lifts the mood and a dark, dirty or cramped one wears it down. Residents also prefer doing things in nicer rooms.
- **Dirt and tidying up:** cooking, eating, washing and the bathroom leave a mess around them. When a room gets dirty, residents *Tidy up* (neat ones gladly, slobs rarely), and a planned *Chores* block does the cleaning.
- **Wear and repairs:** things wear with use (bathroom things fastest, better quality slower; plants and decor never) and break in the end: a broken thing doesn't work and doesn't count for its room. Residents repair it themselves (training handiness; with little skill it may take two tries), or pay for a quick fix in Buy mode (30% of the price; free in Creative). A broken thing sells for half.
- **When the home lacks an essential:** with no working toilet, a resident who can't hold it any longer has an accident (a puddle and an embarrassing day); with no bed they fall asleep on the floor (and wake with a sore back); with no fridge they order takeout ($25); with no shower they feel grubby. All of it lands in the journal.
- **Opinions and wishes:** residents love or dislike the room they're in (a thought bubble, a feeling, a line), and wish a disliked room better in what it lacks most: more light, something nice, more space, a tidier room, or what a room like it needs. They wish broken things fixed, and a household that keeps finding the bathroom taken wishes for a second one (mostly larger households). Room wishes offer only what belongs in a room (houseplants yes, garden lanterns no). Wishes show in the planner next to the activity wishes, each with what to do about it (*Find in catalog* with just the things that help, *Build*, *Repair*), and go once they come true.
- **Our home** (top bar in Live, or O): every room with its scores as bars, what's off, who wishes what, broken things with Repair, and the house's overall score.
- **Room scores on the floor plan:** in Build mode, the button next to the eyedropper (or O) tints each room from red to green by its score, with a tag naming what would help most.

### Changed
- Saves are now version 12 (dirt, wear, the Surroundings need, home wishes); older saves load clean and unworn, with Surroundings at a neutral level.
- **Oakridge House** has a proper bathroom: its wall stopped halfway, so the toilet and shower stood in the living room.
- Content packs can add room kinds (`roomKinds`), tune how rooms are scored (`roomRules`), set wear and repairs (`objectRules.wear`, `objectRules.repair`), add accidents (`accidents`, with `anotherRoom`), and mark buy categories or groups as garden things (`outside`).

## 0.10.0 — 2026-10-10

Build depth: more control while building.

### New
- **Redo** in Build and Buy mode: the button next to Undo, or Ctrl+Shift+Z / ⌘⇧Z (Ctrl+Y works too). What you undid can be made again until you make another change or time moves on.
- **Free rotation for decor:** plants, flowers, trees, shrubs, lamps and garden ornaments (1×1 things from the decor, garden and outdoor categories) turn in 15° steps with Shift+R, or *Turn 15°* on a placed one; R still turns a quarter. The angle is for looks; residents use them as before. Content packs can set `freeRotation` on an object, or list categories in `objectRules.freeRotation`.
- **Eyedropper** in Build and Buy mode: press E (or the button next to Undo), or hold Alt, and click something to build or buy more of the same: a wall gives its covering and height, a door or window its style, a floor its covering, and an object puts another one in hand in the same style and at the same angle. A tag at the cursor says what a click will pick up.
- **Fences and gates:** two new Build tools. Drag a fence along the grid like a wall, then click a gate into it. Five styles: white picket, ranch rails, modern slats, wrought iron and a low stone wall ($20–60 a metre; a gate adds $80). Fences keep residents in or out like walls, but a fenced garden stays a garden (no floor, no roof). As with walls, nobody can be shut in: leave a gate. Remove closes a gate back into fence.
- **Roof style and colour:** a Roof tool in Build mode: gable, hip, steep gable, low hip or flat, in eight colours. It changes at once, costs nothing and can be undone; the roof shows over every room of the house (also from other lots).
- **Lamps give light:** at night every floor lamp casts a warm pool of light where it stands, and the garden's stone lanterns light the lawn. Rooms without a lamp only get a dim glow, so lighting a room means buying a lamp for it. Every lamp in the house lights (up to 32) on Medium quality and above; on Low, or where the graphics card can't do clustered lighting, the four in the largest rooms do.

### Changed
- **Watch and Live:** Watch is now the normal way to play and sits next to Live in the top bar (Watch · Live · Buy · Build). In Watch mode the camera follows what happens at home from the start; move it yourself and it watches again after a while without input (*Settings → Watching → Back to watching*). Live keeps the camera with you. Click either one, or press L, to switch; L also brings you back from Buy and Build. The separate eye button is gone.
- **Quicker building and buying:** placing, moving, selling and restyling furniture no longer rebuilds the house, its street and its fences, only the furniture (about 13 ms down to 2.5 ms per edit in a software-rendered test); lamps move their light without a rebuild either. Walls, floors, paint, fences, roofs and room furniture still rebuild the house. The simulation also sends the lot (walls, rooms, floors and their meshes) only when it changed, so a furniture edit's update is about a ninth of the size.
- Saves are now version 11 (objects' angles, fences and gates, roofs); older saves load as before.

## 0.9.0 — 2026-10-10

The builder's start: begin with a lot, not a family.

### New
- **Creative or Living**, chosen per game on the first step of a new game. Living: your residents earn the money to build with. Creative: building and buying are free (selling brings nothing back), and your home pays no rent or bills.
- **Start on an empty lot:** on the home step, choose *An empty lot* instead of the house: the house is cleared away and you build your own. In a Living game you get $10,000 to build with on top of the usual $2,500 (a ready-made house is worth about $7,500–12,000). Games on an empty lot start in Build mode.
- **Build first, move a family in later:** *Build first* on the neighbourhood step skips creating a household. The home is named after its address, pays nothing, gets no visitors, and the game starts in Build mode. *Move a family in* (top bar, or the card at the bottom) opens the household creator over the game; the family arrives at the front of the lot, the home takes their name, and the journal notes that they moved in.

### Changed
- Build and buy now belong to the household rather than to whoever is selected, so they work while nobody lives at home.
- Saves are now version 10 (the game mode; a household may have nobody living in it yet). Older saves load as Living games.

## 0.8.0 — 2026-10-10

The planner: steer your residents without giving orders.

### New
- **Planner (P, or the calendar button):** a week calendar for each resident. Pick an activity (sleep, eat, cook, wash up, train a skill, work out, read, create, have fun, relax, garden, chores, socialise, visit friends) and click or drag it onto the week; drag blocks to move them (also to other days), pull the bottom edge to make them longer, set the days in the block's panel. Presets: early bird, night owl, fitness, homebody.
- **Plans are a strong nudge, not orders:** during a block its activity is what the resident wants most, but urgent needs still come first, and whether they stick to it depends on their traits and mood (lazy residents skip more, energetic and neat ones less; nobody likes what their personality dislikes). Residents in a planned block aren't drawn into small talk, and they don't leave for a visit right before one. Sleep blocks move their night: a night owl stays up and sleeps in.
- **How it went:** every block ends as kept ✓, cut short ½, skipped ✕ or "nowhere to do it" ⌂, with a reason (a need came first, not their thing, not in the mood, they were out). The calendar marks this week's blocks, the planner sums up the last seven days, and a thin "today" bar on each household card and in the resident's panel shows the day ahead.
- **Everyone's week:** household blocks every member follows (shown hatched in each resident's week); each resident can skip one, and their own blocks win.
- **Life goals:** get a job (in a field), get promoted, reach a job grade, reach a skill level, have good friends, find love, save money. Goals steer what residents do (practice, job hunting, friendly or romantic chats, spending less), show progress and whether it's moving, and end with a story event and a good feeling. Residents suggest goals of their own from their personality; take them on or not. Neighbours pursue goals too.
- **Wishes:** a planned activity with nowhere to do it at home becomes a wish ("somewhere to train strength"); *Find in catalog* opens Buy mode with just the things that offer it. The wish comes true once it's bought.
- **Thought bubbles:** residents show when they skip a plan, wish for a place, keep a plan or reach a goal.

### Changed
- Residents sleep through the night unless they need the bathroom or are hungry (being lonely or bored no longer wakes them).
- **Money and careers rebalanced** so building with earned money takes saving up: pay grades run from $12/h to $52/h (were $15 to $300), promotions take about three times as long, and the weekly bills now include living costs of $150 per resident (rent is lower). A working household saves roughly $100–2,000 a week.
- Goal ideas you leave unanswered for two days are taken on anyway (dismiss them to say no).
- Content packs can add activities, goals, discipline per trait, and which needs wake sleepers (see `docs/content-packs.md`).
- Saves are now version 9 (plans, goals and household blocks); older saves load as before.

## 0.7.0 — 2026-10-10

The game's new direction: build your home, then watch it live (see "Game direction" in PLAN.md). This release is about watching.

### New
- **Watching:** leave the game alone for 20 seconds and the camera follows what happens at home on its own: conversations, fights, first kisses, someone trying out what you just built, guests arriving. When nothing is going on it looks around the house. Any click, key or scroll takes the camera back at once. The eye button in the top bar starts it right away.
- **Household strip:** everyone at a glance along the bottom: what they're doing, where they are, how they feel, and which need is running low. Guests on your lot show up next to it.
- **Look first:** clicking a resident opens their panel (anyone, guests and neighbours too) instead of giving orders. From the panel you can still step in: click a person to talk to, an object to use, or the floor to walk. *Settings → Watching → Clicking residents* brings back the old way.
- **Follow** a resident (F, or the button in their panel), also when they visit friends. Otherwise the view stays at home. **H** shows the whole house.
- **Journal (J):** the story so far, by day: your home, everyone, or just the big moments. Click an entry to see the people involved.
- **Faster time:** time-lapse (4) and fastest (5). *Skip quiet hours* speeds through the night and work hours when nobody is home or awake, and big moments slow the game down to normal speed for a while.
- **Residents live on their own:** they look for work by themselves (newcomers usually find a job within days), may quit a job they're unhappy in, and are let go after missing too many shifts. Your household visits friends on its own like the neighbours do, and visits you ask for end after a while.
- *Settings → Watching:* when the camera starts watching, how often it moves on, a quiet interface while watching, slowing down for big moments, skipping quiet hours.

### Changed
- Free will is per household now; the *Free will* setting applies to your household (the neighbours always have it).
- Residents don't come home from work with every need at zero any more (there's lunch and a bathroom at work), and sleeping no longer makes them more tired.
- The story feed is calmer: your household's news and the town's big moments, three at a time; clicking one shows it.
- Furniture can't be placed across a wall or facing one, and a wall can't be built through furniture or in front of it.
- The story is saved with the game. Saves are now version 8; older saves load as before.

## 0.6.0 — 2026-10-08

**Play it in your browser:** https://krecks.github.io/littlelives/

Floors, undo, and residents who look like they mean it.

### New
- **Floors** in Build mode: a new Floor tool next to Paint. Click a tile, drag over several, or Shift-click a whole room. Thirteen coverings: oak, honey pine, walnut and whitewashed boards; white, sand, terracotta and slate tiles; oatmeal, sage, blue and rose carpet; and flagstone. "A" gives the room its own floor back.
- **Undo** in Build and Buy mode: the Undo button in the top bar, or Ctrl+Z / ⌘Z. It takes back purchases, sales, moves, upgrades, walls, doors, windows, paint and floors, money included (a sold item comes back where it stood). Up to 30 steps, for as long as time stands still.
- **Loading screens:** the game loads everything first (the town, your latest save) behind a progress bar, so the menu is ready to use and "Continue" starts at once. Starting a game that still has to load shows its progress full-screen.

### Changed
- **Animations:**
  - Getting into bed: residents sit on the edge, lean back and lie down; getting up, they sit up, sit on the foot of the bed and stand.
  - Gardening by task: watering with a can, kneeling to weed and tend, bending to harvest, reaching in to prune, crouching to smell the flowers, looking up into blossoming trees.
  - Hugs with arms around each other; fights where the attacker steps in and the defender guards and gives ground.
  - Reclining on sofas and recliners, leaning back in the bath, leaning forward on the toilet, sitting cross-legged to meditate.
  - Bowing the cello and drumming; bouncing on the trampoline, standing on the vibration plate, climbing the bouldering wall, stretching at the sunrise lamp.
  - Mopping with the steam mop, a microphone for karaoke, livelier laughter and breathing in bed.
- **Remove tool:** clicking a door or window walls it up again (the wall stays); dragging along walls still tears them down.
- Your own lot no longer gets an automatic border of shrubs and flowers along the house (building a room doesn't plant flowers around it): plant your garden from the Garden catalog. Other lots keep theirs.
- Selling, moving or undoing no longer makes the other furniture pop up.
- Content packs: `floorCoverings` (like `wallCoverings`) and the animation tags `water`, `tend`, `harvest`, `prune`, `smell` and `admire` (see `docs/content-packs.md`).
- Saves are now version 7 (floor coverings); older saves load as before.

## 0.5.0 — 2026-10-08

**Play it in your browser:** https://krecks.github.io/littlelives/

Nature and the garden.

### New
- **New trees:** crowns are now soft clumps of dense, painterly leaves on real branches, and turn to face the camera, so they look full from every side instead of showing flat leaf cards edge-on. They cast proper canopy shadows.
  - Eleven species: oak, maple, silver birch, cherry blossom, apple, Japanese maple, magnolia, weeping willow, pine, blue spruce and Italian cypress.
  - Town gardens get maples, magnolias and Japanese maples among their trees, the woods mix in maples and spruces, and the borders along the houses now have hydrangeas, roses, lavender and clipped boxwood.
- **Garden category** in Buy mode, with groups: Trees · Shrubs & hedges · Flowers · Fruit & veg · Houseplants (over 50 plants).
  - **Shrubs and hedges:** boxwood balls, topiary cones, clipped hedges, hydrangeas, roses, azaleas, lavender, ferns, ornamental grass and hostas.
  - **Flowers:** tulips, daffodils, daisies, sunflowers, poppies, marigolds, pansies, lilies, lupins, forget-me-nots, cosmos, a wildflower meadow, potted geraniums and a petunia box, and the raised flower bed, now full of flowers.
  - **Fruit and vegetables:** a vegetable patch, tomatoes, strawberries, a herb planter, pumpkins, an apple tree and a potted lemon tree.
  - **Houseplants:** monstera, fiddle-leaf fig, snake plant, cacti, succulents, a fern on a stand, a parlour palm, orchids and a bonsai.
  - **Garden decor** (Outdoor): bird bath, stone fountain, garden pond, gnome, stone lantern, wheelbarrow planter and boulders.
  - Placed plants each get their own turn and size, so a row of them doesn't look stamped.
- **Gardening skill:**
  - Residents train it when they water, tend, trim and harvest.
  - Good gardeners harvest more and feel *Proud gardener*.
  - Harvests are a free meal (*Homegrown*), and roses, lavender and lilies have a *Sweet scent*.
  - Fresh herbs make anyone a better cook for a few hours, and a skilled hand finds *Zen* in pruning the bonsai.
  - It's the main skill of the Gardening & Horticulture career, and farmers use it too.
  - Nature Lovers start with some Gardening and learn it faster.
- **More to do outside:** relax in the shade of a tree, pick apples, watch the birds, feed the fish, make a wish at the fountain, talk to your house plants.

### Changed
- Trees, flower beds, ponds and other garden things can only be placed outdoors; the price tag says "Goes outdoors" when you point indoors. Pots and planters go anywhere.
- The Town Park and Willow Studio get maples, a cherry, willows, a birch, a spruce, hydrangeas, roses and lavender (new towns).
- Content packs: objects can name a `group` within their category (categories list their `groups`) and set `outdoors`; manifest models can set `vary` (see `docs/content-packs.md`).

## 0.4.0 — 2026-10-08

**Play it in your browser:** https://krecks.github.io/littlelives/

### New
- **Live · Buy · Build:** Build is its own mode (B) next to Buy (V); both pause the game.
- **Buy catalog:**
  - Every item shows a 3D picture of its model, drawn on demand and kept between visits.
  - The detail pane shows the item large; move the pointer across it to turn it around.
  - Category tabs with icons; tiles show what you already own, personality collections and "♥" for items your residents' traits love ("For us" filter).
  - Style chips restyle the pictures; the 14 items that come in several styles are marked, and the detail pane has a style picker (restyling what you own is free).
- **Placing and building feel:** the item in hand glides, turns and floats; placed furniture springs into place with sparkles; upgrades, sales and walls get their own effects; a tag next to the pointer shows what a click does and costs; money floats up when it changes hands. The catalog folds away while something is in hand.
- **Room tool:** drag out a rectangle to build its four walls.
- **Wall looks:** walls can be full or half height and carry a covering on each side (paint colours, wallpaper, siding, brick, wood panelling, stone, tiles).
  - **Paint tool:** cover the side of a wall you point at, drag along walls, or Shift-click a whole room (outdoors: the house's outside).
- **Door and window styles:** painted, oak, half-glazed and French doors; classic, cottage, picture, floor-length, high-light and transom windows. Pick another style and click to replace one.
- **Content packs** can add wall coverings, door and window styles (`wallCoverings`, `doorStyles`, `windowStyles`) and category icons.
- **Sound effects** for buying, building and painting (synthesised; *Settings → Sound effects*).

### Changed
- Tearing down walls, doors and windows is free.
- Saves are version 6 (wall looks, stored by id); older saves load with plain walls.

### Fixed
- Residents kept walking, breathing and blinking in place while the game was paused (pause, Buy and Build mode, menus).
- The pointer couldn't reach the lot right after picking an item (the catalog was in the way).

## 0.3.0 — 2026-10-08

**Play it in your browser:** https://krecks.github.io/littlelives/

### New
- **Littlelives:** the project's new name; characters are *residents*. MIT licence for the code, CC0 for third-party art.
- **New game, two ways:** play one of the households already living in town ("Play" on step 1, then *Meet the …* with their home, members and neighbours), or create your own household as before.
- **3D menus:** a live 3D town behind the main menu; a 3D neighbourhood and home picker with lot tags; the camera flies into the chosen home.
- **Household creator:** the in-game 3D resident on a stage (turn, zoom to the face, live look changes, little reactions) and 3D portraits for every avatar. First names match the gender.
- **Building:**
  - Drag to draw and remove walls (click-then-click still works).
  - **Diagonal walls**, with doors, windows, half-tile floors and roofs over rooms with diagonal sides.
  - Draw a room's walls first and add the door after; only residents and furniture can't be shut in.
- **Selection marker:** a gold sparkle above the selected resident that follows their mood.
- **Characters:** separate garments, strand hair, a face that blinks, glances, shows feelings and talks, a friendly resting face, a relaxed stance, blankets in bed, and animations that match what the resident is doing.
- **World:** leafy trees and hedges in the wind, a dressed street (sidewalks, streetlights, cars, porches, gardens), see-through windows, golden evenings and blue nights.
- **Economy:** weekly bills based on what the household owns, charged with the rent every Sunday at noon; only consumables (takeout, deliveries) cost money per use.
- **Debug reports:** F8 or the performance overlay saves a screenshot, the game state and recent errors (in the project with `pnpm dev`, as a download otherwise); `?debugReport=<name>` reopens one.
- **Versions:** one version for the whole game (`tools/release/version.mjs`), shown in the menu and Credits.
- **Hosting:** every push to `main` is tested, built and published on GitHub Pages.

### Fixed
- "Moving in…" could hang after picking a different house.
- Residents only updated every few seconds on some screens (smooth motion again, also on 120 Hz displays and with coarse browser timers).
- The menu town could cover a game that started very quickly.
- Shrubs on free-standing walls, black faces on square roofs, grass growing through new floors.
- Flat placeholder faces flashing before the 3D portraits appeared.

### Changed
- "Moodlets" are now called *feelings* everywhere; old saves and content packs still load.

## 0.2.0

First public version: the simulation (needs, jobs with grades A–J, skills, relationships, rent), Buy mode with upgrades and styles, personality packs and the Babylon.js renderer.
