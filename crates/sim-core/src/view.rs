//! Low-frequency JSON views for the UI and for world structure.
//! Never used in the per-frame render path.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::hash::{DefaultHasher, Hasher};

use serde::Serialize;

use crate::clock;
use crate::content::Content;
use crate::life;
use crate::lot::Edge;
use crate::social::SocialEvent;
use crate::planner::{Goal, GoalKind, Outcome, Reason, Routine};
use crate::world::{Phase, Sim, Task, TaskKind, World};
use crate::{MINUTES_PER_TICK, conversation};

/// A room of the player's home (see `rooms.rs`). `scores`: size, light, decor, cleanliness,
/// function, overall (0..1).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomView {
    /// Lot room id (0 for the garden); changes when walls do.
    id: u16,
    garden: bool,
    /// Room kind (index into `roomKinds`).
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<usize>,
    mixed: bool,
    /// The kind's essential nothing offers (index into its `essentials`).
    #[serde(skip_serializing_if = "Option::is_none")]
    missing: Option<usize>,
    tiles: f32,
    windows: u16,
    doors: u16,
    lamps: u16,
    dirt: f32,
    centre: [f32; 2],
    scores: [f32; 6],
}

/// A story event plus how much it matters (0 everyday, 1 notable, 2 a milestone).
#[derive(Serialize)]
struct EventView<'a> {
    #[serde(flatten)]
    event: &'a SocialEvent,
    importance: u8,
}

impl<'a> From<&'a SocialEvent> for EventView<'a> {
    fn from(event: &'a SocialEvent) -> Self {
        Self {
            event,
            importance: event.kind.importance(),
        }
    }
}

/// Events in the UI state (the whole log is fetched with `events_json`).
const UI_EVENTS: usize = 30;

/// The whole story log, oldest first (JSON array).
pub fn events_json(world: &World) -> String {
    let events: Vec<EventView> = world.events.iter().map(EventView::from).collect();
    serde_json::to_string(&events).expect("events serialize")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FundsView<'a> {
    id: u32,
    funds: i64,
    /// Weekly rent for this household's home, if rent is charged.
    rent: Option<i64>,
    /// Weekly bills, which grow with what the household owns.
    bills: Option<i64>,
    style: u8,
    /// Build and buy edits that can be undone, and undone edits that can be made again.
    undo: usize,
    redo: usize,
    /// The household's routine template (the player's household only).
    #[serde(skip_serializing_if = "Option::is_none")]
    routines: Option<Vec<RoutineView<'a>>>,
    /// A baby on the way: the parents and the day it's due.
    #[serde(skip_serializing_if = "Option::is_none")]
    expecting: Option<crate::world::Expecting>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutineView<'a> {
    id: u16,
    activity: &'a str,
    skill: Option<&'a str>,
    /// Weekdays, bit 0 = Monday.
    days: u8,
    start: u16,
    minutes: u16,
}

fn routine_view<'a>(content: &'a Content, r: &Routine) -> RoutineView<'a> {
    RoutineView {
        id: r.id,
        activity: &content.activities[r.activity].id,
        skill: r.skill.map(|s| content.skills[s].id.as_str()),
        days: r.days,
        start: r.start,
        minutes: r.minutes,
    }
}

/// Why a block wasn't kept: `trait` (with the trait id), `need` (with the need id), `mood`,
/// `away`, `noPlace`.
#[derive(Serialize)]
struct ReasonView<'a> {
    code: &'static str,
    #[serde(rename = "trait", skip_serializing_if = "Option::is_none")]
    trait_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    need: Option<&'a str>,
}

fn reason_view(content: &Content, r: Reason) -> ReasonView<'_> {
    let (code, trait_id, need) = match r {
        Reason::Trait(t) => ("trait", Some(content.traits[t].id.as_str()), None),
        Reason::Need(n) => ("need", None, Some(content.needs[n].id.as_str())),
        Reason::Mood => ("mood", None, None),
        Reason::Away => ("away", None, None),
        Reason::NoPlace => ("noPlace", None, None),
    };
    ReasonView { code, trait_id, need }
}

/// A block that's running or over: `status` is `active`, `kept`, `cut`, `skipped` or `noPlace`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlockView<'a> {
    routine: u16,
    household: bool,
    activity: &'a str,
    skill: Option<&'a str>,
    day: u32,
    start: u16,
    minutes: u16,
    status: &'static str,
    reason: Option<ReasonView<'a>>,
    /// Minutes spent on it.
    done: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoalView<'a> {
    def: &'a str,
    kind: GoalKind,
    icon: &'a str,
    progress: f32,
    /// Change over the last days (positive: getting there).
    trend: f32,
    skill: Option<&'a str>,
    category: Option<&'a str>,
    target: f32,
    since_day: u32,
}

fn goal_view<'a>(content: &'a Content, g: &Goal) -> GoalView<'a> {
    let def = &content.goals[g.def];
    GoalView {
        def: &def.id,
        kind: def.kind,
        icon: &def.icon,
        progress: round_to(g.progress, PERCENT),
        // Rounded away from zero: it passes ±0.01 (where the UI's arrow turns) just when the
        // trend itself does.
        trend: away_from_zero(g.progress - g.history[2], PERCENT),
        skill: g.skill.map(|s| content.skills[s].id.as_str()),
        category: g.category.map(|c| content.career_categories[c].id.as_str()),
        target: g.target,
        since_day: g.since_day,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanView<'a> {
    routines: Vec<RoutineView<'a>>,
    /// Household template blocks this resident doesn't follow.
    skip_household: &'a [u16],
    current: Option<BlockView<'a>>,
    /// Blocks of the last week, oldest first.
    history: Vec<BlockView<'a>>,
    goals: Vec<GoalView<'a>>,
    suggestions: Vec<GoalView<'a>>,
    /// Activities they'd like a place for (`skill` for training).
    wishes: Vec<(&'a str, Option<&'a str>)>,
    /// What they'd like for the home (as saved: `room` + `factor`, `fix` or `another`).
    home_wishes: Vec<crate::save::HomeWishSave>,
    /// How well they stick to plans now (1 = average).
    adherence: f32,
}

fn plan_view<'a>(world: &'a World, s: &'a Sim) -> PlanView<'a> {
    let content = &world.content;
    let p = &s.planner;
    let today = clock::day(world.tick);
    let block = |routine, household, activity: usize, skill: Option<usize>, day, start, minutes, status, reason: Option<Reason>, done| BlockView {
        routine,
        household,
        activity: &content.activities[activity].id,
        skill: skill.map(|k| content.skills[k].id.as_str()),
        day,
        start,
        minutes,
        status,
        reason: reason.map(|r| reason_view(content, r)),
        // Ten-minute steps: it grows every tick while the block runs, and nothing shows it.
        done: round_to(done, 0.1),
    };
    PlanView {
        routines: p.routines.iter().map(|r| routine_view(content, r)).collect(),
        skip_household: &p.skip_household,
        current: p.run.as_ref().map(|r| {
            let status = if r.no_place {
                "noPlace"
            } else if r.skipped.is_some() {
                "skipped"
            } else {
                "active"
            };
            let reason = if r.no_place { Some(Reason::NoPlace) } else { r.skipped };
            block(r.routine, r.household, r.activity, r.skill, r.day, r.start, r.minutes, status, reason, r.done)
        }),
        history: p
            .history
            .iter()
            .filter(|b| b.day + 7 >= today)
            .map(|b| {
                let status = match b.outcome {
                    Outcome::Kept => "kept",
                    Outcome::Cut => "cut",
                    Outcome::Skipped => "skipped",
                    Outcome::NoPlace => "noPlace",
                };
                block(b.routine, b.household, b.activity, b.skill, b.day, b.start, b.minutes, status, b.reason, b.done)
            })
            .collect(),
        goals: p.goals.iter().map(|g| goal_view(content, g)).collect(),
        suggestions: p.suggestions.iter().map(|g| goal_view(content, g)).collect(),
        wishes: p
            .wishes
            .iter()
            .map(|&(a, k)| (content.activities[a].id.as_str(), k.map(|k| content.skills[k].id.as_str())))
            .collect(),
        home_wishes: p.home_wishes.iter().map(|w| crate::save::home_wish_save(content, w)).collect(),
        // It follows the mood; the UI words it at 0.65, 0.9 and 1.15 (rounding down keeps those).
        adherence: floor_to(crate::planner::adherence(content, s), 20.0),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobView<'a> {
    /// Index into the career catalog.
    index: usize,
    career: &'a str,
    career_label: &'a str,
    category: Option<&'a str>,
    title: &'a str,
    level: usize,
    levels: usize,
    grade: Option<&'a str>,
    grade_label: Option<&'a str>,
    performance: f32,
    /// Pay per shift on this Sim's schedule.
    pay: i64,
    pay_per_hour: f32,
    weekly_pay: i64,
    start_hour: f32,
    hours: f32,
    /// This Sim's workdays (0 = Monday), after skill adjustments.
    days: Vec<u8>,
    standard_days: Vec<u8>,
    /// Probation / standard / flexible...
    workweek: Option<&'a str>,
    /// Skill levels above (+) or below (-) the requirements.
    fit: f32,
    requires: Vec<Requirement<'a>>,
    next: Option<NextLevel<'a>>,
    next_title: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NextLevel<'a> {
    title: &'a str,
    grade: Option<&'a str>,
    pay_per_hour: f32,
    requires: Vec<Requirement<'a>>,
}

#[derive(Serialize)]
struct Requirement<'a> {
    skill: &'a str,
    level: f32,
    have: f32,
}

fn weekdays(mask: u8) -> Vec<u8> {
    (0..7).filter(|d| mask & (1 << d) != 0).collect()
}

fn requirements<'a>(
    content: &'a Content,
    req: &[(usize, f32)],
    skills: &[f32],
) -> Vec<Requirement<'a>> {
    req.iter()
        .map(|&(s, level)| Requirement {
            skill: &content.skills[s].id,
            level,
            have: skills[s].floor(),
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FeelingView<'a> {
    id: &'a str,
    label: &'a str,
    mood: f32,
    minutes_left: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionView {
    label: String,
    object: Option<u32>,
    /// The other Sim, for social actions.
    target: Option<u32>,
    progress: f32,
    directed: bool,
    active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RelView {
    a: u32,
    b: u32,
    friendship: f32,
    romance: f32,
    partners: bool,
    chemistry: f32,
    /// What b is to a in the family.
    #[serde(skip_serializing_if = "crate::social::Kin::is_none")]
    kin: crate::social::Kin,
}

// ---- UI updates ------------------------------------------------------------------------------

/// Needs, mood, progress and scores go in 1 % steps (a bar's resolution).
const PERCENT: f64 = 100.0;

/// `v` rounded to steps of `1 / per_unit`: values that drift every tick are rounded to what the
/// UI shows, so they only count as changed (and are sent again) when the change is visible.
fn round_to(v: f32, per_unit: f64) -> f32 {
    ((f64::from(v) * per_unit).round() / per_unit) as f32
}

/// `round_to`, rounding down (skill levels: the whole number is the level).
fn floor_to(v: f32, per_unit: f64) -> f32 {
    ((f64::from(v) * per_unit).floor() / per_unit) as f32
}

/// `round_to`, rounding away from zero (a trend then passes a threshold just when it does).
fn away_from_zero(v: f32, per_unit: f64) -> f32 {
    let steps = (f64::from(v) * per_unit).abs().ceil();
    (steps.copysign(f64::from(v)) / per_unit) as f32
}

/// A fingerprint of what was sent, never 0 (0: nothing sent yet).
fn fingerprint(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    h.write(bytes);
    h.finish() | 1
}

/// A JSON object written field by field into a buffer.
struct Obj<'a> {
    out: &'a mut Vec<u8>,
    fields: usize,
}

impl<'a> Obj<'a> {
    fn open(out: &'a mut Vec<u8>) -> Self {
        out.push(b'{');
        Obj { out, fields: 0 }
    }

    fn key(&mut self, key: &str) {
        if self.fields > 0 {
            self.out.push(b',');
        }
        self.fields += 1;
        self.out.push(b'"');
        self.out.extend_from_slice(key.as_bytes());
        self.out.extend_from_slice(b"\":");
    }

    fn field<T: Serialize + ?Sized>(&mut self, key: &str, value: &T) {
        self.key(key);
        serde_json::to_writer(&mut *self.out, value).expect("UI view serializes");
    }

    /// Writes the field only if its JSON differs from what `sent` remembers (and remembers it).
    fn changed<T: Serialize + ?Sized>(&mut self, key: &str, value: &T, sent: &mut u64) {
        let (mark, fields) = (self.out.len(), self.fields);
        self.key(key);
        let start = self.out.len();
        serde_json::to_writer(&mut *self.out, value).expect("UI view serializes");
        let print = fingerprint(&self.out[start..]);
        if print == *sent {
            self.out.truncate(mark);
            self.fields = fields;
        } else {
            *sent = print;
        }
    }

    /// `changed` for a field the UI leaves out when absent: becoming absent is sent as `null`.
    fn changed_opt<T: Serialize>(&mut self, key: &str, value: Option<&T>, sent: &mut u64) {
        match value {
            Some(v) => self.changed(key, v, sent),
            None if *sent != 0 => {
                self.field(key, &());
                *sent = 0;
            }
            None => {}
        }
    }

    /// Writes `list` as an array (empty lists only when `always`).
    fn list(&mut self, key: &str, list: &List, always: bool) {
        if always || list.len > 0 {
            self.key(key);
            self.out.push(b'[');
            self.out.extend_from_slice(&list.out);
            self.out.push(b']');
        }
    }

    /// Closes the object; returns how many fields it has.
    fn close(self) -> usize {
        self.out.push(b'}');
        self.fields
    }
}

/// The items of a JSON array, written one by one.
#[derive(Default)]
struct List {
    out: Vec<u8>,
    len: usize,
}

impl List {
    fn next(&mut self) -> &mut Vec<u8> {
        if self.len > 0 {
            self.out.push(b',');
        }
        self.len += 1;
        &mut self.out
    }

    fn push<T: Serialize + ?Sized>(&mut self, item: &T) {
        let out = self.next();
        serde_json::to_writer(out, item).expect("UI view serializes");
    }

    /// Adds the item only if its JSON differs from what `sent` remembers (and remembers it).
    fn push_changed<T: Serialize>(&mut self, item: &T, sent: &mut u64) {
        let (mark, len) = (self.out.len(), self.len);
        let out = self.next();
        let start = out.len();
        serde_json::to_writer(&mut *out, item).expect("UI view serializes");
        let print = fingerprint(&out[start..]);
        if print == *sent {
            self.out.truncate(mark);
            self.len = len;
        } else {
            *sent = print;
        }
    }
}

/// What the UI was last sent, so that each UI update (~10 Hz) carries only what changed:
/// residents, households, relationship pairs and rooms are keyed by id and sent again when
/// their JSON changes, story events by id. Values that drift every tick are rounded to what the
/// UI shows (`round_to`), so changed means visibly changed. The first update, and the next
/// one after `resync`, sends everything.
///
/// Every resident is listed, but only the player's household and the resident being inspected
/// come with their details (needs, feelings, actions, skills, plan) and relationships: nobody
/// else's are shown, and these are what change all the time.
pub struct UiSync {
    /// The next update sends everything.
    full: bool,
    inspected: Option<u32>,
    /// Per resident slot: what they were sent (None: not listed).
    sims: Vec<Option<SimSent>>,
    households: Vec<u64>,
    /// Relationship pairs and rooms sent, with the update that last found them.
    relationships: HashMap<(u32, u32), (u64, u32)>,
    rooms: HashMap<u16, (u64, u32)>,
    updates: u32,
    /// The newest story event sent.
    last_event: Option<u64>,
}

/// Fingerprints of a resident's fields as last sent (0: not sent; the UI has its default).
#[derive(Default)]
struct SimSent {
    detailed: bool,
    detail: u64,
    name: u64,
    household: u64,
    traits: u64,
    perks: u64,
    age: u64,
    stage: u64,
    pension: u64,
    plot: u64,
    away_until: u64,
    visiting: u64,
    job: u64,
    /// Reset when the details stop (the UI drops them).
    details: DetailsSent,
}

#[derive(Default)]
struct DetailsSent {
    grade: u64,
    needs: u64,
    mood: u64,
    emotion: u64,
    feelings: u64,
    actions: u64,
    skills: u64,
    plan: u64,
    plan_parts: PlanSent,
}

/// The plan is sent part by part: the week's history is long, and the rest changes all day.
#[derive(Default)]
struct PlanSent {
    routines: u64,
    skip_household: u64,
    current: u64,
    history: u64,
    goals: u64,
    suggestions: u64,
    wishes: u64,
    home_wishes: u64,
    adherence: u64,
}

impl Default for UiSync {
    fn default() -> Self {
        Self::new()
    }
}

impl UiSync {
    pub fn new() -> Self {
        Self {
            full: true,
            inspected: None,
            sims: Vec::new(),
            households: Vec::new(),
            relationships: HashMap::new(),
            rooms: HashMap::new(),
            updates: 0,
            last_event: None,
        }
    }

    /// The next update sends everything (the UI starts over, or lost track).
    pub fn resync(&mut self) {
        self.full = true;
    }

    /// The resident whose panel is open: their details and relationships are sent too.
    pub fn inspect(&mut self, sim: Option<u32>) {
        self.inspected = sim;
    }

    /// The next UI update (JSON; `UiUpdate` in `protocol.ts`): what changed since the last one,
    /// or everything.
    pub fn update_json(&mut self, world: &World) -> String {
        let full = std::mem::take(&mut self.full);
        if full {
            *self = Self {
                full: false,
                inspected: self.inspected,
                updates: self.updates,
                ..Self::new()
            };
        }
        self.updates = self.updates.wrapping_add(1);
        let content = &world.content;
        let detailed: Vec<bool> = world
            .sims
            .iter()
            .map(|s| s.here() && (world.households[s.household as usize].player || self.inspected == Some(s.id)))
            .collect();

        let (mut sims, mut gone) = (List::default(), List::default());
        if self.sims.len() < world.sims.len() {
            self.sims.resize_with(world.sims.len(), || None);
        }
        for (i, s) in world.sims.iter().enumerate() {
            if !s.here() {
                if self.sims[i].take().is_some() {
                    gone.push(&s.id);
                }
                continue;
            }
            let sent = self.sims[i].get_or_insert_with(SimSent::default);
            let mark = (sims.out.len(), sims.len);
            let mut o = Obj::open(sims.next());
            o.field("id", &s.id);
            sim_patch(world, s, detailed[i], sent, &mut o);
            if o.close() == 1 {
                sims.out.truncate(mark.0);
                sims.len = mark.1;
            }
        }

        let mut households = List::default();
        self.households.resize(world.households.len(), 0);
        for (i, h) in world.households.iter().enumerate() {
            let costs = life::weekly_costs(world, i);
            let view = FundsView {
                id: h.id,
                funds: h.funds,
                rent: costs.map(|c| c.0),
                bills: costs.map(|c| c.1),
                style: h.style,
                undo: world.undo_steps(i),
                redo: world.redo_steps(i),
                routines: h.player.then(|| h.routines.iter().map(|r| routine_view(content, r)).collect()),
                expecting: h.expecting,
            };
            households.push_changed(&view, &mut self.households[i]);
        }

        // Pairs with a resident whose details are sent, both ways (nobody else's are shown).
        let (mut relationships, mut rels_gone) = (List::default(), List::default());
        let rels = &world.relationships;
        let updates = self.updates;
        let mut visit = |a: usize, b: usize| {
            let r = rels.get(a, b);
            if !r.met {
                return;
            }
            let chemistry = rels.chemistry(a, b);
            let mut h = DefaultHasher::new();
            for bits in [r.friendship.to_bits(), r.romance.to_bits(), chemistry.to_bits(), u32::from(r.partners), r.kin as u32] {
                h.write_u32(bits);
            }
            let print = h.finish() | 1;
            match self.relationships.entry((a as u32, b as u32)) {
                Entry::Occupied(mut e) => {
                    let (sent, seen) = e.get_mut();
                    *seen = updates;
                    if *sent == print {
                        return;
                    }
                    *sent = print;
                }
                Entry::Vacant(e) => {
                    e.insert((print, updates));
                }
            }
            relationships.push(&RelView {
                a: a as u32,
                b: b as u32,
                friendship: r.friendship,
                romance: r.romance,
                partners: r.partners,
                chemistry,
                kin: r.kin,
            });
        };
        for a in (0..world.sims.len()).filter(|&a| detailed[a]) {
            for b in (0..world.sims.len()).filter(|&b| b != a) {
                visit(a, b);
                if !detailed[b] {
                    visit(b, a);
                }
            }
        }
        self.relationships.retain(|&(a, b), &mut (_, seen)| {
            let kept = seen == updates;
            if !kept {
                rels_gone.push(&[a, b]);
            }
            kept
        });

        let newest = self.last_event;
        let mut events = List::default();
        let fresh: Vec<&SocialEvent> = if full {
            let skip = world.events.iter().count().saturating_sub(UI_EVENTS);
            world.events.iter().skip(skip).collect()
        } else {
            let mut fresh: Vec<_> = world.events.iter().rev().take_while(|e| newest.is_none_or(|n| e.id > n)).collect();
            fresh.reverse();
            fresh
        };
        for e in fresh {
            events.push(&EventView::from(e));
        }
        self.last_event = world.events.iter().next_back().map(|e| e.id).or(newest);

        let (mut rooms, mut rooms_gone) = (List::default(), List::default());
        let home = world.households.iter().find(|h| h.player).and_then(|h| h.plot);
        for r in world.rooms().iter().filter(|r| home.is_some() && r.plot == home) {
            let s = r.scores;
            let view = RoomView {
                id: r.id,
                garden: r.garden,
                kind: r.kind,
                mixed: r.mixed,
                missing: r.missing,
                tiles: r.tiles,
                windows: r.windows,
                doors: r.doors,
                lamps: r.lamps,
                dirt: round_to(r.dirt, PERCENT),
                centre: r.centre,
                scores: [s.size, s.light, s.decor, s.clean, s.function, s.overall].map(|v| round_to(v, PERCENT)),
            };
            let (sent, seen) = self.rooms.entry(r.id).or_insert((0, updates));
            *seen = updates;
            rooms.push_changed(&view, sent);
        }
        self.rooms.retain(|&id, &mut (_, seen)| {
            let kept = seen == updates;
            if !kept {
                rooms_gone.push(&id);
            }
            kept
        });

        let day = clock::day(world.tick);
        let mut out = Vec::with_capacity(256 + sims.out.len() + relationships.out.len() + events.out.len());
        let mut o = Obj::open(&mut out);
        o.field("full", &full);
        o.field("day", &day);
        o.field("weekday", &clock::weekday(day));
        o.field("minute", &clock::minute_of_day(world.tick));
        o.field("speed", &world.speed);
        o.field("autonomy", &world.autonomy);
        o.field("lifespan", &world.lifespan);
        o.field("playerMoves", &world.player_moves);
        o.list("sims", &sims, full);
        o.list("simsGone", &gone, false);
        o.list("households", &households, full);
        o.list("relationships", &relationships, full);
        o.list("relationshipsGone", &rels_gone, false);
        o.list("events", &events, full);
        o.list("rooms", &rooms, full);
        o.list("roomsGone", &rooms_gone, false);
        o.close();
        String::from_utf8(out).expect("JSON is UTF-8")
    }
}

/// Everything the UI is sent at the start (a fresh `UiSync`'s first update).
pub fn ui_state_json(world: &World) -> String {
    UiSync::new().update_json(world)
}

/// Writes the fields of resident `s` that changed (`SimView` in `protocol.ts`); with `detail`
/// false only the summary (who, where, which job), the details being the UI's defaults.
fn sim_patch(world: &World, s: &Sim, detail: bool, sent: &mut SimSent, o: &mut Obj) {
    let content = &world.content;
    if sent.detailed && !detail {
        sent.details = DetailsSent::default();
    }
    sent.detailed = detail;
    o.changed("detail", &detail, &mut sent.detail);
    o.changed("name", &s.name, &mut sent.name);
    o.changed("household", &s.household, &mut sent.household);
    o.changed("traits", &s.traits, &mut sent.traits);
    o.changed("perks", &s.perks, &mut sent.perks);
    // Age in whole years, and the life stage (content `life.stages` id).
    o.changed("age", &(s.age.floor() as u32), &mut sent.age);
    let stage = content.life.stages.get(content.life.stage(s.age)).map(|st| st.id.as_str());
    o.changed("stage", &stage, &mut sent.stage);
    // Retired, with this weekly pension.
    o.changed_opt("pension", s.retired.then_some(&s.pension), &mut sent.pension);
    // Plot the Sim is on (None on the street or at work); minute of day they're back from work.
    let (x, z) = s.tile();
    let plot = if s.away_until.is_some() { None } else { world.plot_at(x, z) };
    o.changed("plot", &plot, &mut sent.plot);
    o.changed("awayUntil", &s.away_until.map(clock::minute_of_day), &mut sent.away_until);
    o.changed("visiting", &s.visiting.map(|v| v.plot), &mut sent.visiting);
    o.changed("job", &job_view(content, s), &mut sent.job);
    if !detail {
        return;
    }

    let d = &mut sent.details;
    // A pupil's school grade (0..100).
    let grade = content
        .life
        .stage_at(s.age)
        .filter(|st| st.school && content.life.school.is_some())
        .map(|_| round_to(s.grade, 10.0));
    o.changed_opt("grade", grade.as_ref(), &mut d.grade);
    let needs: Vec<f32> = s.needs[..content.needs.len()].iter().map(|&v| round_to(v, PERCENT)).collect();
    o.changed("needs", &needs, &mut d.needs);
    o.changed("mood", &round_to(s.mood(content), PERCENT), &mut d.mood);
    o.changed("emotion", &s.emotion(content).map(|e| content.emotions[e].id.as_str()), &mut d.emotion);
    o.changed("feelings", &feelings(world, s), &mut d.feelings);
    o.changed("actions", &actions(world, s), &mut d.actions);
    // Skill levels in content order (rounded down: the whole number is the level).
    let skills: Vec<f32> = s.skills[..content.skills.len()].iter().map(|&v| floor_to(v, PERCENT)).collect();
    o.changed("skills", &skills, &mut d.skills);

    // Routines, goals and wishes (the player's household only), part by part.
    if !world.households[s.household as usize].player {
        o.changed_opt::<()>("plan", None, &mut d.plan);
        d.plan_parts = PlanSent::default();
        return;
    }
    d.plan = 1;
    let plan = plan_view(world, s);
    let p = &mut d.plan_parts;
    let (mark, fields) = (o.out.len(), o.fields);
    o.key("plan");
    let mut parts = Obj::open(&mut *o.out);
    parts.changed("routines", &plan.routines, &mut p.routines);
    parts.changed("skipHousehold", &plan.skip_household, &mut p.skip_household);
    parts.changed("current", &plan.current, &mut p.current);
    parts.changed("history", &plan.history, &mut p.history);
    parts.changed("goals", &plan.goals, &mut p.goals);
    parts.changed("suggestions", &plan.suggestions, &mut p.suggestions);
    parts.changed("wishes", &plan.wishes, &mut p.wishes);
    parts.changed("homeWishes", &plan.home_wishes, &mut p.home_wishes);
    parts.changed("adherence", &plan.adherence, &mut p.adherence);
    if parts.close() == 0 {
        o.out.truncate(mark);
        o.fields = fields;
    }
}

/// "Visit the Smiths", or the plot's name when nobody lives there.
fn host_name(world: &World, plot: u32) -> String {
    world
        .households
        .iter()
        .find(|h| h.plot == Some(plot))
        .map_or_else(|| world.plots[plot as usize].name.clone(), |h| format!("the {}s", h.name))
}

fn task_view(world: &World, task: &Task, phase: Option<&Phase>) -> ActionView {
    let content = &world.content;
    let (label, object, target, minutes) = match task.kind {
        TaskKind::Use { object, interaction } => {
            let inter = &content.objects[world.objects[object as usize].def].interactions[interaction];
            (inter.label.clone(), Some(object), None, inter.minutes)
        }
        TaskKind::MoveTo { .. } => ("Go here".to_owned(), None, None, 1.0),
        TaskKind::Social { target, social } => {
            let s = &content.socials[social];
            let minutes = match phase {
                Some(Phase::Conversing { success, .. }) => conversation::duration(s, *success),
                _ => s.minutes,
            };
            (s.label.clone(), None, Some(target), minutes)
        }
        TaskKind::Work => ("Go to work".to_owned(), None, None, 1.0),
        TaskKind::Visit { plot } => (format!("Visit {}", host_name(world, plot)), None, None, 1.0),
        TaskKind::GoHome => ("Go home".to_owned(), None, None, 1.0),
        TaskKind::Answer { guest } => ("Answer the door".to_owned(), None, Some(guest), 1.0),
        TaskKind::Clean { .. } => {
            let rules = &content.room_rules.clean;
            (rules.label.clone(), None, None, rules.minutes)
        }
        TaskKind::Spot { accident } => {
            let rest = content.accidents[accident].rest.as_ref();
            (rest.map_or_else(String::new, |r| r.label.clone()), None, None, rest.map_or(1.0, |r| r.minutes))
        }
        TaskKind::Repair { object } => {
            let rules = &content.object_rules.repair;
            let name = &content.objects[world.objects[object as usize].def].name;
            (format!("{} the {}", rules.label, name.to_lowercase()), Some(object), None, rules.minutes)
        }
    };
    let progress = match phase {
        Some(Phase::Using { elapsed }) | Some(Phase::Conversing { elapsed, .. }) => (elapsed / minutes).min(1.0),
        _ => 0.0,
    };
    ActionView {
        label,
        object,
        target,
        progress: round_to(progress, PERCENT),
        directed: task.directed,
        active: phase.is_some(),
    }
}

/// What a resident is doing and has queued; work or school, and being talked to, come first.
fn actions(world: &World, s: &Sim) -> Vec<ActionView> {
    let content = &world.content;
    let mut actions = Vec::new();
    if let Some(until) = s.away_until {
        let left = until.saturating_sub(world.tick) as f32 * MINUTES_PER_TICK;
        let school = content.life.school.as_ref().filter(|_| s.job.is_none());
        let total = s.job.as_ref().map_or(school.map_or(1.0, |sc| sc.hours * 60.0), |j| {
            content.careers[j.career].levels[j.level].hours * 60.0
        });
        actions.push(ActionView {
            label: if school.is_some() { "At school" } else { "At work" }.to_owned(),
            object: None,
            target: None,
            progress: round_to((1.0 - left / total).clamp(0.0, 1.0), PERCENT),
            directed: true,
            active: true,
        });
    }
    // Being talked to shows up as the current action.
    if let Some(a) = s.engaged_with
        && let Some((_, social, _, progress)) = world.sims[a as usize].conversation(content)
    {
        actions.push(ActionView {
            label: content.socials[social].label.clone(),
            object: None,
            target: Some(a),
            progress: round_to(progress, PERCENT),
            directed: false,
            active: true,
        });
    }
    actions.extend(s.current().map(|a| task_view(world, &a.task, Some(&a.phase))));
    actions.extend(s.queue().map(|t| task_view(world, t, None)));
    actions
}

fn feelings<'a>(world: &'a World, s: &Sim) -> Vec<FeelingView<'a>> {
    s.feelings
        .iter()
        .map(|m| {
            let def = &world.content.feelings[m.def];
            let left = m.expires.saturating_sub(world.tick) as f32 * MINUTES_PER_TICK;
            FeelingView {
                id: &def.id,
                label: &def.label,
                mood: def.mood,
                // Whole minutes: the panel shows minutes, or hours.
                minutes_left: round_to(left.min(def.minutes), 1.0),
            }
        })
        .collect()
}

fn job_view<'a>(content: &'a Content, s: &Sim) -> Option<JobView<'a>> {
    let j = s.job.as_ref()?;
    let career = &content.careers[j.career];
    let level = &career.levels[j.level];
    let grade = level.grade.map(|g| &content.grades[g]);
    let fit = life::skill_fit(level, &s.skills);
    let next = career.levels.get(j.level + 1);
    Some(JobView {
        index: j.career,
        career: &career.id,
        career_label: &career.label,
        category: career.category.map(|c| content.career_categories[c].id.as_str()),
        title: &level.title,
        level: j.level,
        levels: career.levels.len(),
        grade: grade.map(|g| g.id.as_str()),
        grade_label: grade.map(|g| g.label.as_str()),
        performance: j.performance,
        pay: life::shift_pay(content, j, &s.skills),
        pay_per_hour: level.pay as f32 / level.hours,
        weekly_pay: level.pay * level.days.count_ones() as i64,
        start_hour: level.start_hour,
        hours: level.hours,
        days: weekdays(life::work_days(content, j, &s.skills)),
        standard_days: weekdays(level.days),
        workweek: life::workweek_rule(content, fit).map(|r| r.label.as_str()),
        fit,
        requires: requirements(content, &level.requires, &s.skills),
        next: next.map(|n| NextLevel {
            title: &n.title,
            grade: n.grade.map(|g| content.grades[g].id.as_str()),
            pay_per_hour: n.pay as f32 / n.hours,
            requires: requirements(content, &n.requires, &s.skills),
        }),
        next_title: next.map(|l| l.title.as_str()),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StructureView<'a> {
    version: u32,
    /// `World::lot_version`: the lot parts below are left out when the caller already has them.
    lot_version: u32,
    /// `living` or `creative`.
    mode: crate::world::GameMode,
    width: usize,
    depth: usize,
    /// Storeys the lot holds, and rows per storey: storey `k` is rows `k * storeyDepth ..` of
    /// `depth` (see `storeys.rs`).
    storeys: u8,
    storey_depth: i32,
    objects: Vec<ObjectView<'a>>,
    sims: Vec<SimInfo<'a>>,
    /// Names of former residents (story events name them with `social::FORMER`).
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    former: &'a [crate::world::Former],
    households: Vec<HouseholdView<'a>>,
    plots: Vec<PlotView<'a>>,
    exits: &'a [[f32; 2]],
    #[serde(skip_serializing_if = "Option::is_none")]
    rooms: Option<&'a [u16]>,
    /// Every edge with a wall on it (plain walls, and walls with a door or window).
    #[serde(skip_serializing_if = "Option::is_none")]
    walls: Option<Vec<EdgeView>>,
    /// Doors and windows (also listed in `walls`).
    #[serde(skip_serializing_if = "Option::is_none")]
    openings: Option<Vec<OpeningView>>,
    /// Diagonal walls (with or without a door or window), one per tile at most.
    #[serde(skip_serializing_if = "Option::is_none")]
    diagonals: Option<Vec<DiagonalView>>,
    /// Fences and gates (not walls: they make no rooms).
    #[serde(skip_serializing_if = "Option::is_none")]
    fences: Option<Vec<FenceView>>,
    /// Floor coverings: `[x, z, covering]` per tile that has one (a floor covering + 1).
    #[serde(skip_serializing_if = "Option::is_none")]
    floors: Option<Vec<[u16; 3]>>,
    meta: &'a serde_json::Value,
}

/// A diagonal wall across tile `(x, z)`: `dp` (`/`) from `(x, z)` to `(x + 1, z + 1)`, `dn`
/// (`\`) from `(x, z + 1)` to `(x + 1, z)`. `rooms` are the rooms of the tile's two halves:
/// half 0 touches the tile's `-z` side, half 1 its `+z` side.
#[derive(Serialize)]
struct DiagonalView {
    x: usize,
    z: usize,
    axis: &'static str,
    kind: &'static str,
    rooms: [u16; 2],
    #[serde(flatten)]
    look: LookView,
}

/// A wall's look, when it isn't the default: face coverings (0 = automatic, else wall covering
/// + 1; face 0 towards `-z` / `-x` / half 0), `form` 1 for a half wall, door or window `style`.
#[derive(Serialize, Default)]
struct LookView {
    #[serde(skip_serializing_if = "Option::is_none")]
    faces: Option<[u8; 2]>,
    #[serde(skip_serializing_if = "is_zero")]
    form: u8,
    #[serde(skip_serializing_if = "is_zero")]
    style: u8,
}

fn is_zero(n: &u8) -> bool {
    *n == 0
}

impl LookView {
    fn of(lot: &crate::lot::Lot, at: crate::lot::EdgeRef) -> Self {
        let l = lot.look(at);
        Self {
            faces: (l.sides != [0, 0]).then_some(l.sides),
            form: l.form,
            style: l.style,
        }
    }
}

fn diagonals(lot: &crate::lot::Lot) -> Vec<DiagonalView> {
    let mut out = Vec::new();
    for (i, d) in lot.diagonals().iter().enumerate() {
        let Some(d) = d else { continue };
        out.push(DiagonalView {
            x: i % lot.width,
            z: i / lot.width,
            axis: match d.dir {
                crate::lot::DiagDir::Dp => "dp",
                crate::lot::DiagDir::Dn => "dn",
            },
            kind: match d.edge {
                Edge::Door => "door",
                Edge::Window => "window",
                _ => "wall",
            },
            rooms: lot.half_rooms()[i],
            look: LookView::of(
                lot,
                crate::lot::EdgeRef::Diag((i % lot.width) as u16, (i / lot.width) as u16),
            ),
        });
    }
    out
}

/// A wall edge: `h` runs from `(x, z)` to `(x + 1, z)`, `v` from `(x, z)` to `(x, z + 1)`.
#[derive(Serialize)]
struct EdgeView {
    axis: &'static str,
    x: usize,
    z: usize,
    /// Coverings and form (the style is on the opening).
    #[serde(skip_serializing_if = "Option::is_none")]
    faces: Option<[u8; 2]>,
    #[serde(skip_serializing_if = "is_zero")]
    form: u8,
}

#[derive(Serialize)]
struct OpeningView {
    axis: &'static str,
    x: usize,
    z: usize,
    kind: &'static str,
    #[serde(skip_serializing_if = "is_zero")]
    style: u8,
}

/// A fence or gate on edge `axis` `(x, z)` (as walls), in a fence style.
#[derive(Serialize)]
struct FenceView {
    axis: &'static str,
    x: usize,
    z: usize,
    kind: &'static str,
    #[serde(skip_serializing_if = "is_zero")]
    style: u8,
}

/// Wall edges, openings (doors, windows) and fences of the whole lot, in grid order.
fn wall_edges(lot: &crate::lot::Lot) -> (Vec<EdgeView>, Vec<OpeningView>, Vec<FenceView>) {
    let mut walls = Vec::new();
    let mut openings = Vec::new();
    let mut fences = Vec::new();
    let mut add = |axis: &'static str, x: usize, z: usize, e: Edge| {
        let at = if axis == "h" {
            crate::lot::EdgeRef::H(x as u16, z as u16)
        } else {
            crate::lot::EdgeRef::V(x as u16, z as u16)
        };
        if e.is_fence() {
            let kind = if e == Edge::Gate { "gate" } else { "fence" };
            let style = lot.look(at).style;
            fences.push(FenceView { axis, x, z, kind, style });
            return;
        }
        if !e.is_wall() {
            return;
        }
        let look = LookView::of(lot, at);
        walls.push(EdgeView {
            axis,
            x,
            z,
            faces: look.faces,
            form: look.form,
        });
        let kind = match e {
            Edge::Door => "door",
            Edge::Window => "window",
            _ => return,
        };
        openings.push(OpeningView {
            axis,
            x,
            z,
            kind,
            style: look.style,
        });
    };
    for z in 0..=lot.depth {
        for x in 0..lot.width {
            add("h", x, z, lot.h_edge(x, z));
        }
    }
    for z in 0..lot.depth {
        for x in 0..=lot.width {
            add("v", x, z, lot.v_edge(x, z));
        }
    }
    (walls, openings, fences)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObjectView<'a> {
    id: u32,
    def: &'a str,
    x: i32,
    z: i32,
    rot: u8,
    /// Degrees past `rot` (objects that turn freely).
    turn: u8,
    /// Wear 0..1 (broken at 1).
    wear: f32,
    w: i32,
    d: i32,
    quality: u8,
    style: u8,
    /// What selling it returns (None if it can't be sold).
    sell_value: Option<i64>,
    /// What the quick fix costs (worn things; as of the last structure change, so exact for
    /// broken ones).
    #[serde(skip_serializing_if = "Option::is_none")]
    repair_cost: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SimInfo<'a> {
    id: u32,
    name: &'a str,
    household: u32,
    gender: &'a str,
    attracted_to: &'a [String],
    appearance: &'a serde_json::Value,
    traits: &'a [String],
    perks: &'a [String],
    /// Died or moved away (kept so ids and snapshot rows match; not listed or drawn).
    #[serde(skip_serializing_if = "Option::is_none")]
    gone: Option<crate::world::Gone>,
    /// Bumped when someone new takes the slot.
    #[serde(skip_serializing_if = "is_zero_u32")]
    generation: u32,
    /// Life stage (content `life.stages` id), for how they look.
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<&'a str>,
}

fn is_zero_u32(n: &u32) -> bool {
    *n == 0
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdView<'a> {
    id: u32,
    name: &'a str,
    plot: Option<u32>,
    player: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlotView<'a> {
    id: u32,
    name: &'a str,
    x: i32,
    z: i32,
    w: i32,
    d: i32,
    public: bool,
    entry: Option<[f32; 2]>,
    /// Bounding box of the walls on this plot `[x0, z0, x1, z1]`, if any (for silhouettes).
    house: Option<[i32; 4]>,
    /// The roof the player chose: `[style, colour]` (indices into `roofStyles`, `roofColors`).
    #[serde(skip_serializing_if = "Option::is_none")]
    roof: Option<[u8; 2]>,
    /// Storeys with walls on this plot (for silhouettes).
    storeys: u8,
}

/// Bounding box of all wall/door edges (and diagonal walls) inside a plot.
fn house_bounds(world: &World, x0: i32, z0: i32, x1: i32, z1: i32) -> Option<[i32; 4]> {
    let lot = &world.lot;
    let mut b: Option<[i32; 4]> = None;
    let mut add = |ax: i32, az: i32, bx: i32, bz: i32| {
        b = Some(match b {
            None => [ax, az, bx, bz],
            Some([a0, b0, a1, b1]) => [a0.min(ax), b0.min(az), a1.max(bx), b1.max(bz)],
        });
    };
    for z in z0..=z1.min(lot.depth as i32) {
        for x in x0..x1.min(lot.width as i32) {
            if z < lot.depth as i32 + 1 && lot.h_edge(x as usize, z as usize).is_wall() {
                add(x, z, x + 1, z);
            }
        }
    }
    for z in z0..z1.min(lot.depth as i32) {
        for x in x0..=x1.min(lot.width as i32) {
            if lot.v_edge(x as usize, z as usize).is_wall() {
                add(x, z, x, z + 1);
            }
            if x < x1 && lot.diag(x, z).is_some() {
                add(x, z, x + 1, z + 1);
            }
        }
    }
    b
}

pub fn structure_json(world: &World) -> String {
    structure_json_with(world, true)
}

/// The world structure; without `lot`, leaves out the lot itself (rooms, walls, openings,
/// diagonals, fences, floors) for a caller that has it at this `lotVersion` already.
pub fn structure_json_with(world: &World, lot: bool) -> String {
    let content = &world.content;
    let objects = world
        .objects
        .iter()
        .map(|o| {
            let (w, d) = o.size(content);
            ObjectView {
                id: o.id,
                def: &content.objects[o.def].id,
                x: o.x,
                z: o.z,
                rot: o.rot,
                turn: o.turn,
                wear: o.wear,
                w,
                d,
                quality: o.quality,
                style: o.style,
                sell_value: content.objects[o.def].price.map(|_| {
                    let broken = if o.broken() { 0.5 } else { 1.0 };
                    (o.value as f32 * content.object_rules.resale * broken).round() as i64
                }),
                repair_cost: (o.wear > 0.0).then(|| crate::home::repair_cost(content, o)),
            }
        })
        .collect();
    let sims = world
        .sims
        .iter()
        .map(|s| SimInfo {
            id: s.id,
            name: &s.name,
            household: s.household,
            gender: &s.gender,
            attracted_to: &s.attracted_to,
            appearance: &s.appearance,
            traits: &s.traits,
            perks: &s.perks,
            gone: s.gone,
            generation: world.generations.get(s.id as usize).copied().unwrap_or(0),
            stage: content.life.stages.get(content.life.stage(s.age)).map(|st| st.id.as_str()),
        })
        .collect();
    let households = world
        .households
        .iter()
        .map(|h| HouseholdView {
            id: h.id,
            name: &h.name,
            plot: h.plot,
            player: h.player,
        })
        .collect();
    let plots = world
        .plots
        .iter()
        .map(|p| PlotView {
            id: p.id,
            name: &p.name,
            x: p.x,
            z: p.z,
            w: p.w,
            d: p.d,
            public: p.public,
            entry: p.entry,
            house: house_bounds(world, p.x, p.z, p.x + p.w, p.z + p.d),
            roof: p.roof.map(|r| [r.style, r.color]),
            storeys: 1 + (1..world.storeys as i32)
                .filter(|k| {
                    let up = k * world.storey_depth();
                    house_bounds(world, p.x, p.z + up, p.x + p.w, p.z + p.d + up).is_some()
                })
                .count() as u8,
        })
        .collect();
    let (walls, openings, fences) = if lot {
        let (w, o, f) = wall_edges(&world.lot);
        (Some(w), Some(o), Some(f))
    } else {
        (None, None, None)
    };
    let diagonals = lot.then(|| diagonals(&world.lot));
    serde_json::to_string(&StructureView {
        version: world.structure_version(),
        lot_version: world.lot_version(),
        mode: world.mode,
        width: world.lot.width,
        depth: world.lot.depth,
        storeys: world.storeys,
        storey_depth: world.storey_depth(),
        objects,
        sims,
        former: &world.former,
        households,
        plots,
        exits: &world.exits,
        rooms: lot.then(|| world.lot.rooms()),
        walls,
        openings,
        fences,
        diagonals,
        floors: lot.then(|| {
            world
                .lot
                .floors()
                .map(|(x, z, c)| [x, z, u16::from(c)])
                .collect()
        }),
        meta: &world.meta,
    })
    .expect("structure serializes")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OptionView<'a> {
    index: usize,
    id: &'a str,
    label: &'a str,
    category: &'a str,
    chance: f32,
}

/// What `actor` can do with `target`, for the social menu.
pub fn social_options_json(world: &World, actor: usize, target: usize) -> String {
    let options: Vec<OptionView> = conversation::options(world, actor, target)
        .into_iter()
        .map(|(i, chance)| {
            let s = &world.content.socials[i];
            OptionView {
                index: i,
                id: &s.id,
                label: &s.label,
                category: &s.category,
                chance,
            }
        })
        .collect();
    serde_json::to_string(&options).expect("options serialize")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogView<'a> {
    grades: Vec<GradeView<'a>>,
    categories: Vec<&'a str>,
    careers: Vec<CareerView<'a>>,
    workweek: Vec<WorkweekView<'a>>,
    probation_levels: f32,
    max_skill: f32,
    object_rules: ObjectRulesView,
    build: BuildView,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GradeView<'a> {
    id: &'a str,
    label: &'a str,
    pay_per_hour: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CareerView<'a> {
    id: &'a str,
    label: &'a str,
    /// Category id.
    category: Option<&'a str>,
    /// Skill ids practised at work.
    skills: Vec<&'a str>,
    levels: Vec<LevelView<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelView<'a> {
    title: &'a str,
    grade: Option<&'a str>,
    pay: i64,
    start: f32,
    hours: f32,
    days: Vec<u8>,
    /// `[skill id, level]`.
    requires: Vec<(&'a str, f32)>,
}

#[derive(Serialize)]
struct WorkweekView<'a> {
    fit: f32,
    days: i8,
    label: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObjectRulesView {
    max_quality: u8,
    quality_bonus: f32,
    upgrade_cost: f32,
    resale: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildView {
    wall: i64,
    door: i64,
    window: i64,
    remove: i64,
    /// A diagonal wall across one tile (`wall × 1.414`, rounded).
    diagonal_wall: i64,
    /// A metre of fence and a gate, without fence styles (styles carry their own prices).
    fence: i64,
    gate: i64,
}

/// Every career with all its levels, expanded from the content (sent to the UI once).
pub fn catalog_json(content: &Content) -> String {
    let careers = content
        .careers
        .iter()
        .map(|c| CareerView {
            id: &c.id,
            label: &c.label,
            category: c.category.map(|i| content.career_categories[i].id.as_str()),
            skills: c
                .skills
                .iter()
                .map(|&(s, _)| content.skills[s].id.as_str())
                .collect(),
            levels: c
                .levels
                .iter()
                .map(|l| LevelView {
                    title: &l.title,
                    grade: l.grade.map(|g| content.grades[g].id.as_str()),
                    pay: l.pay,
                    start: l.start_hour,
                    hours: l.hours,
                    days: weekdays(l.days),
                    requires: l
                        .requires
                        .iter()
                        .map(|&(s, v)| (content.skills[s].id.as_str(), v))
                        .collect(),
                })
                .collect(),
        })
        .collect();
    let rules = &content.object_rules;
    serde_json::to_string(&CatalogView {
        grades: content
            .grades
            .iter()
            .map(|g| GradeView {
                id: &g.id,
                label: &g.label,
                pay_per_hour: g.pay_per_hour,
            })
            .collect(),
        categories: content
            .career_categories
            .iter()
            .map(|c| c.id.as_str())
            .collect(),
        careers,
        workweek: content
            .career_rules
            .workweek
            .iter()
            .map(|w| WorkweekView {
                fit: w.fit,
                days: w.days,
                label: &w.label,
            })
            .collect(),
        probation_levels: content.career_rules.probation_levels,
        max_skill: content.skill_rules.max_level,
        object_rules: ObjectRulesView {
            max_quality: rules.max_quality,
            quality_bonus: rules.quality_bonus,
            upgrade_cost: rules.upgrade_cost,
            resale: rules.resale,
        },
        build: BuildView {
            wall: content.build.wall,
            door: content.build.door,
            window: content.build.window,
            remove: content.build.remove,
            diagonal_wall: content.build.diagonal_wall(),
            fence: content.build.fence,
            gate: content.build.gate,
        },
    })
    .expect("catalog serializes")
}
