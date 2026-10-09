//! Social life: relationships, social interactions, feelings and emotions.
//!
//! Everything here is data-driven from the content file. Relationships are
//! directional (A can have a crush on B without B feeling the same), and every
//! social interaction is a short conversation whose success depends on how the
//! *target* feels about the actor, their chemistry, mood and traits.

use std::collections::{HashMap, VecDeque};

use serde::{Deserialize, Serialize};

use crate::content::{MAX_NEEDS, Modifiers, ModifiersRaw, TagMask};
use crate::{Error, MINUTES_PER_TICK};

/// Animation names the renderer understands, in snapshot code order (code = index + 1).
pub const ANIMATIONS: [&str; 7] = ["talk", "laugh", "flirt", "argue", "fight", "hug", "kiss"];

/// Friendship levels used for statuses and milestone events.
pub const LEVEL_ENEMY: i8 = -2;
pub const LEVEL_DISLIKED: i8 = -1;
pub const LEVEL_FRIEND: i8 = 1;
pub const LEVEL_GOOD_FRIEND: i8 = 2;
pub const LEVEL_BEST_FRIEND: i8 = 3;
/// Romance at or above this is a crush.
pub const CRUSH_ROMANCE: f32 = 35.0;

pub fn friend_level(friendship: f32) -> i8 {
    match friendship {
        f if f <= -60.0 => LEVEL_ENEMY,
        f if f <= -25.0 => LEVEL_DISLIKED,
        f if f < 35.0 => 0,
        f if f < 60.0 => LEVEL_FRIEND,
        f if f < 80.0 => LEVEL_GOOD_FRIEND,
        _ => LEVEL_BEST_FRIEND,
    }
}

// ---- Definitions ---------------------------------------------------------------------

#[derive(Debug)]
pub struct EmotionDef {
    pub id: String,
    pub label: String,
    /// Applied on top of trait modifiers while this is the Sim's dominant emotion.
    pub mods: Modifiers,
}

#[derive(Debug)]
pub struct FeelingDef {
    pub id: String,
    pub label: String,
    pub emotion: Option<usize>,
    /// Added to mood while active.
    pub mood: f32,
    pub minutes: f32,
    /// Buff or debuff while active, folded into the Sim's modifiers (`Sim::mods`).
    pub effects: Option<Modifiers>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Prefer {
    /// No relationship bias.
    #[default]
    Any,
    /// More likely toward people the actor likes.
    Liked,
    /// More likely toward people the actor dislikes.
    Disliked,
    /// Driven by romance and chemistry.
    Romance,
    /// Only toward a partner the actor no longer loves.
    Unloved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Effect {
    #[default]
    None,
    BecomePartners,
    BreakUp,
    Fight,
    Kiss,
}

/// Conditions on the actor's view of the target (and their shared status).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Requirements {
    /// `Some(false)`: only between strangers; `Some(true)`: only once they've met.
    pub met: Option<bool>,
    pub min_friendship: f32,
    pub max_friendship: f32,
    pub min_romance: f32,
    pub max_romance: f32,
    pub partners: Option<bool>,
}

impl Default for Requirements {
    fn default() -> Self {
        Self {
            met: Some(true),
            min_friendship: -100.0,
            max_friendship: 100.0,
            min_romance: -100.0,
            max_romance: 100.0,
            partners: None,
        }
    }
}

impl Requirements {
    pub fn allows(&self, rel: &Relationship) -> bool {
        self.met.is_none_or(|m| m == rel.met)
            && self.partners.is_none_or(|p| p == rel.partners)
            && (self.min_friendship..=self.max_friendship).contains(&rel.friendship)
            && (self.min_romance..=self.max_romance).contains(&rel.romance)
    }
}

/// Success chance terms. Relationship values are the target's view of the actor.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Acceptance {
    pub base: f32,
    /// Per friendship point.
    pub friendship: f32,
    /// Per romance point.
    pub romance: f32,
    /// Per unit of chemistry (-1..1).
    pub chemistry: f32,
    /// Per unit of target mood above 0.5.
    pub mood: f32,
    /// Subtracted when the target is partnered with someone else.
    pub taken_penalty: f32,
}

impl Default for Acceptance {
    fn default() -> Self {
        Self {
            base: 0.8,
            friendship: 0.0,
            romance: 0.0,
            chemistry: 0.0,
            mood: 0.0,
            taken_penalty: 0.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Outcome {
    /// Change to the actor's feelings toward the target.
    pub friendship: f32,
    pub romance: f32,
    /// Change to the target's feelings toward the actor.
    pub target_friendship: f32,
    pub target_romance: f32,
    pub feeling: Option<usize>,
    pub target_feeling: Option<usize>,
    /// Immediate need changes (may be negative, e.g. after a fight).
    pub needs: [f32; MAX_NEEDS],
    pub target_needs: [f32; MAX_NEEDS],
    pub effect: Effect,
    /// For fights.
    pub winner_feeling: Option<usize>,
    pub loser_feeling: Option<usize>,
}

#[derive(Debug)]
pub struct SocialDef {
    pub id: String,
    pub label: String,
    pub category: String,
    pub minutes: f32,
    /// How close the two stand while interacting (metres).
    pub distance: f32,
    /// Snapshot animation code (index into `ANIMATIONS` + 1).
    pub anim: u8,
    pub autonomous: bool,
    pub autonomy_weight: f32,
    pub tags: TagMask,
    pub requires: Requirements,
    pub acceptance: Acceptance,
    pub prefer: Prefer,
    /// Need gains over the whole interaction.
    pub actor_gain: [f32; MAX_NEEDS],
    pub target_gain: [f32; MAX_NEEDS],
    pub success: Outcome,
    pub failure: Outcome,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BondPreset {
    pub friendship: f32,
    pub romance: f32,
    pub partners: bool,
}

/// Global social settings.
#[derive(Debug, Clone)]
pub struct SocialRules {
    /// Interactions with these tags can't be interrupted by socials (sleeping, bathroom...).
    pub busy_tags: TagMask,
    pub romantic_tags: TagMask,
    pub default_bond: Option<BondPreset>,
    pub jealousy_range: f32,
    pub jealousy_friendship: f32,
    pub jealousy_romance: f32,
    pub jealousy_feeling: Option<usize>,
    pub heartbreak_feeling: Option<usize>,
    /// Daily drift toward neutral.
    pub friendship_decay: f32,
    pub romance_decay: f32,
}

// ---- Raw JSON --------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct EmotionRaw {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub effects: ModifiersRaw,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeelingRaw {
    id: String,
    label: String,
    #[serde(default)]
    emotion: Option<String>,
    #[serde(default)]
    mood: f32,
    hours: f32,
    #[serde(default)]
    effects: Option<ModifiersRaw>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SocialRaw {
    id: String,
    label: String,
    #[serde(default)]
    category: String,
    minutes: f32,
    #[serde(default = "default_distance")]
    distance: f32,
    #[serde(default)]
    animation: Option<String>,
    #[serde(default = "yes")]
    autonomous: bool,
    #[serde(default = "one")]
    autonomy_weight: f32,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    requires: Requirements,
    #[serde(default)]
    acceptance: Acceptance,
    #[serde(default)]
    prefer: Prefer,
    #[serde(default)]
    needs: HashMap<String, f32>,
    #[serde(default)]
    target_needs: HashMap<String, f32>,
    #[serde(default)]
    success: OutcomeRaw,
    #[serde(default)]
    failure: OutcomeRaw,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct OutcomeRaw {
    friendship: f32,
    romance: f32,
    target_friendship: f32,
    target_romance: f32,
    #[serde(alias = "moodlet")] // key before the moodlet → feeling rename
    feeling: Option<String>,
    #[serde(alias = "targetMoodlet")] // key before the moodlet → feeling rename
    target_feeling: Option<String>,
    needs: HashMap<String, f32>,
    target_needs: HashMap<String, f32>,
    effect: Effect,
    #[serde(alias = "winnerMoodlet")] // key before the moodlet → feeling rename
    winner_feeling: Option<String>,
    #[serde(alias = "loserMoodlet")] // key before the moodlet → feeling rename
    loser_feeling: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct SocialRulesRaw {
    busy_tags: Vec<String>,
    romantic_tags: Vec<String>,
    default_bond: Option<String>,
    jealousy_range: Option<f32>,
    jealousy_friendship: Option<f32>,
    jealousy_romance: Option<f32>,
    #[serde(alias = "jealousyMoodlet")] // key before the moodlet → feeling rename
    jealousy_feeling: Option<String>,
    #[serde(alias = "heartbreakMoodlet")] // key before the moodlet → feeling rename
    heartbreak_feeling: Option<String>,
    friendship_decay: Option<f32>,
    romance_decay: Option<f32>,
}

fn default_distance() -> f32 {
    1.0
}
fn yes() -> bool {
    true
}
fn one() -> f32 {
    1.0
}

/// Lookups shared by the parsers.
pub(crate) struct Indices<'a> {
    pub needs: &'a HashMap<&'a str, usize>,
    pub tags: &'a HashMap<&'a str, usize>,
    pub emotions: &'a HashMap<String, usize>,
    pub feelings: &'a HashMap<String, usize>,
    pub skills: &'a HashMap<&'a str, usize>,
}

fn find(index: &HashMap<String, usize>, key: &str, ctx: &str, kind: &str) -> Result<usize, Error> {
    index
        .get(key)
        .copied()
        .ok_or_else(|| Error::new(format!("{ctx}: unknown {kind} '{key}'")))
}

fn need_array(
    map: &HashMap<String, f32>,
    ix: &Indices,
    ctx: &str,
) -> Result<[f32; MAX_NEEDS], Error> {
    let mut out = [0.0; MAX_NEEDS];
    for (k, v) in map {
        let i = ix
            .needs
            .get(k.as_str())
            .ok_or_else(|| Error::new(format!("{ctx}: unknown need '{k}'")))?;
        out[*i] = *v;
    }
    Ok(out)
}

fn tag_mask(tags: &[String], ix: &Indices, ctx: &str) -> Result<TagMask, Error> {
    let mut mask: TagMask = 0;
    for t in tags {
        let i = ix
            .tags
            .get(t.as_str())
            .ok_or_else(|| Error::new(format!("{ctx}: unknown tag '{t}'")))?;
        mask |= 1 << i;
    }
    Ok(mask)
}

fn opt_feeling(id: &Option<String>, ix: &Indices, ctx: &str) -> Result<Option<usize>, Error> {
    id.as_deref()
        .map(|m| find(ix.feelings, m, ctx, "feeling"))
        .transpose()
}

pub(crate) fn parse_feeling(raw: &FeelingRaw, ix: &Indices) -> Result<FeelingDef, Error> {
    let effects = raw
        .effects
        .as_ref()
        .map(|e| crate::content::build_modifiers(e, ix, &raw.id))
        .transpose()?;
    if effects.as_ref().is_some_and(|e| e.mood != 0.0) {
        return Err(Error::new(format!(
            "{}: use the feeling's own `mood`, not effects.mood",
            raw.id
        )));
    }
    if raw.hours <= 0.0 {
        return Err(Error::new(format!("{}: hours must be > 0", raw.id)));
    }
    Ok(FeelingDef {
        id: raw.id.clone(),
        label: raw.label.clone(),
        emotion: raw
            .emotion
            .as_deref()
            .map(|e| find(ix.emotions, e, &raw.id, "emotion"))
            .transpose()?,
        mood: raw.mood,
        minutes: raw.hours * 60.0,
        effects,
    })
}

pub(crate) fn feeling_id(raw: &FeelingRaw) -> &str {
    &raw.id
}

fn parse_outcome(raw: &OutcomeRaw, ix: &Indices, ctx: &str) -> Result<Outcome, Error> {
    Ok(Outcome {
        friendship: raw.friendship,
        romance: raw.romance,
        target_friendship: raw.target_friendship,
        target_romance: raw.target_romance,
        feeling: opt_feeling(&raw.feeling, ix, ctx)?,
        target_feeling: opt_feeling(&raw.target_feeling, ix, ctx)?,
        needs: need_array(&raw.needs, ix, ctx)?,
        target_needs: need_array(&raw.target_needs, ix, ctx)?,
        effect: raw.effect,
        winner_feeling: opt_feeling(&raw.winner_feeling, ix, ctx)?,
        loser_feeling: opt_feeling(&raw.loser_feeling, ix, ctx)?,
    })
}

pub(crate) fn parse_social(raw: &SocialRaw, ix: &Indices) -> Result<SocialDef, Error> {
    let ctx = raw.id.as_str();
    if raw.minutes <= 0.0 {
        return Err(Error::new(format!("{ctx}: minutes must be > 0")));
    }
    let anim = match raw.animation.as_deref() {
        None => 1,
        Some(a) => ANIMATIONS
            .iter()
            .position(|x| *x == a)
            .map(|i| i as u8 + 1)
            .ok_or_else(|| Error::new(format!("{ctx}: unknown animation '{a}'")))?,
    };
    Ok(SocialDef {
        id: raw.id.clone(),
        label: raw.label.clone(),
        category: raw.category.clone(),
        minutes: raw.minutes,
        distance: raw.distance.clamp(0.4, 2.0),
        anim,
        autonomous: raw.autonomous,
        autonomy_weight: raw.autonomy_weight,
        tags: tag_mask(&raw.tags, ix, ctx)?,
        requires: raw.requires,
        acceptance: raw.acceptance,
        prefer: raw.prefer,
        actor_gain: need_array(&raw.needs, ix, ctx)?,
        target_gain: need_array(&raw.target_needs, ix, ctx)?,
        success: parse_outcome(&raw.success, ix, ctx)?,
        failure: parse_outcome(&raw.failure, ix, ctx)?,
    })
}

pub(crate) fn parse_rules(
    raw: &SocialRulesRaw,
    presets: &HashMap<String, BondPreset>,
    ix: &Indices,
) -> Result<SocialRules, Error> {
    // Busy/romantic tags that no interaction uses are simply ignored.
    let mask = |tags: &[String]| {
        tags.iter()
            .filter_map(|t| ix.tags.get(t.as_str()))
            .fold(0, |m: TagMask, i| m | (1 << i))
    };
    let default_bond = match &raw.default_bond {
        None => None,
        Some(p) => Some(
            *presets
                .get(p)
                .ok_or_else(|| Error::new(format!("socialRules: unknown bond preset '{p}'")))?,
        ),
    };
    Ok(SocialRules {
        busy_tags: mask(&raw.busy_tags),
        romantic_tags: mask(&raw.romantic_tags),
        default_bond,
        jealousy_range: raw.jealousy_range.unwrap_or(8.0),
        jealousy_friendship: raw.jealousy_friendship.unwrap_or(-10.0),
        jealousy_romance: raw.jealousy_romance.unwrap_or(-15.0),
        jealousy_feeling: opt_feeling(&raw.jealousy_feeling, ix, "socialRules")?,
        heartbreak_feeling: opt_feeling(&raw.heartbreak_feeling, ix, "socialRules")?,
        friendship_decay: raw.friendship_decay.unwrap_or(1.5),
        romance_decay: raw.romance_decay.unwrap_or(3.0),
    })
}

impl SocialRules {
    pub fn empty() -> Self {
        Self {
            busy_tags: 0,
            romantic_tags: 0,
            default_bond: None,
            jealousy_range: 8.0,
            jealousy_friendship: -10.0,
            jealousy_romance: -15.0,
            jealousy_feeling: None,
            heartbreak_feeling: None,
            friendship_decay: 1.5,
            romance_decay: 3.0,
        }
    }
}

// ---- Relationships ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Relationship {
    /// -100..100
    pub friendship: f32,
    /// -100..100
    pub romance: f32,
    pub met: bool,
    pub partners: bool,
    pub kissed: bool,
}

/// Directional relationship matrix plus symmetric chemistry. Sized to the Sim count.
#[derive(Debug, Clone, Default)]
pub struct Relationships {
    n: usize,
    rel: Vec<Relationship>,
    chemistry: Vec<f32>,
}

impl Relationships {
    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// Grows to `n` Sims, keeping existing data.
    pub fn grow(&mut self, n: usize) {
        if n <= self.n {
            return;
        }
        let mut rel = vec![Relationship::default(); n * n];
        let mut chemistry = vec![0.0; n * n];
        for a in 0..self.n {
            for b in 0..self.n {
                rel[a * n + b] = self.rel[a * self.n + b];
                chemistry[a * n + b] = self.chemistry[a * self.n + b];
            }
        }
        *self = Self { n, rel, chemistry };
    }

    pub fn get(&self, a: usize, b: usize) -> &Relationship {
        &self.rel[a * self.n + b]
    }

    pub fn get_mut(&mut self, a: usize, b: usize) -> &mut Relationship {
        &mut self.rel[a * self.n + b]
    }

    pub fn chemistry(&self, a: usize, b: usize) -> f32 {
        self.chemistry[a * self.n + b]
    }

    pub fn set_chemistry(&mut self, a: usize, b: usize, value: f32) {
        let v = value.clamp(-1.0, 1.0);
        self.chemistry[a * self.n + b] = v;
        self.chemistry[b * self.n + a] = v;
    }

    /// Applies a preset in both directions and marks the pair as having met.
    pub fn bond(&mut self, a: usize, b: usize, preset: &BondPreset) {
        for (x, y) in [(a, b), (b, a)] {
            let r = self.get_mut(x, y);
            r.met = true;
            r.friendship = preset.friendship;
            r.romance = preset.romance;
            r.partners = preset.partners;
        }
    }

    /// Current partner of `a`, if any.
    pub fn partner_of(&self, a: usize) -> Option<usize> {
        (0..self.n).find(|&b| b != a && self.get(a, b).partners)
    }

    pub fn adjust(&mut self, a: usize, b: usize, friendship: f32, romance: f32) {
        let r = self.get_mut(a, b);
        r.friendship = (r.friendship + friendship).clamp(-100.0, 100.0);
        r.romance = (r.romance + romance).clamp(-100.0, 100.0);
    }

    /// Daily drift toward neutral; partners' romance fades more slowly.
    pub fn decay(&mut self, rules: &SocialRules) {
        for r in &mut self.rel {
            if r.friendship.abs() > 15.0 {
                r.friendship -=
                    r.friendship.signum() * rules.friendship_decay.min(r.friendship.abs() - 15.0);
            }
            let romance_decay = if r.partners {
                rules.romance_decay / 3.0
            } else {
                rules.romance_decay
            };
            if r.romance.abs() > 0.0 {
                r.romance -= r.romance.signum() * romance_decay.min(r.romance.abs());
            }
        }
    }
}

// ---- Feelings ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActiveFeeling {
    pub def: usize,
    pub expires: u64,
}

pub fn minutes_to_ticks(minutes: f32) -> u64 {
    (minutes / MINUTES_PER_TICK).max(1.0) as u64
}

/// Adds a feeling, or refreshes it if already active.
pub fn add_feeling(list: &mut Vec<ActiveFeeling>, def: usize, defs: &[FeelingDef], tick: u64) {
    let expires = tick + minutes_to_ticks(defs[def].minutes);
    match list.iter_mut().find(|m| m.def == def) {
        Some(m) => m.expires = m.expires.max(expires),
        None => list.push(ActiveFeeling { def, expires }),
    }
}

/// The emotion of the strongest active feeling that has one.
pub fn dominant_emotion(list: &[ActiveFeeling], defs: &[FeelingDef]) -> Option<usize> {
    list.iter()
        .filter_map(|m| defs[m.def].emotion.map(|e| (defs[m.def].mood.abs(), e)))
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, e)| e)
}

pub fn feeling_mood(list: &[ActiveFeeling], defs: &[FeelingDef]) -> f32 {
    list.iter().map(|m| defs[m.def].mood).sum()
}

// ---- Events -----------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Met,
    BecameFriends,
    BecameGoodFriends,
    BecameBestFriends,
    BecameEnemies,
    Crush,
    FirstKiss,
    StartedDating,
    BrokeUp,
    ProposalRejected,
    Fight,
    Jealous,
    Promoted,
    MissedWork,
    /// `a` came over to `b`'s home.
    Visited,
    /// `a` reached level `n` in `skill`.
    SkillUp,
    /// `a`'s household paid `n` in rent and bills.
    PaidRent,
    /// `a`'s household couldn't cover the rent and bills (`n`) and is in debt.
    RentDebt,
    /// `a` upgraded something at home to quality `n`.
    Upgraded,
    /// `a` found a job in `career` at level `n`.
    JobFound,
    /// `a` quit their job in `career` at level `n`.
    QuitJob,
    /// `a` was let go from `career` (level `n`) after missing too many shifts.
    Fired,
}

impl EventKind {
    /// How much an event matters to someone watching: 0 everyday, 1 notable, 2 a milestone.
    pub fn importance(self) -> u8 {
        use EventKind::*;
        match self {
            FirstKiss | StartedDating | BrokeUp | BecameBestFriends | Promoted | JobFound
            | Fired => 2,
            BecameFriends | BecameGoodFriends | BecameEnemies | Crush | ProposalRejected
            | Fight | Jealous | QuitJob | RentDebt => 1,
            Met | MissedWork | SkillUp | PaidRent | Upgraded | Visited => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SocialEvent {
    pub id: u64,
    pub tick: u64,
    pub kind: EventKind,
    pub a: u32,
    pub b: u32,
    /// Third party (e.g. who a jealous Sim saw their partner with).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c: Option<u32>,
    /// A number for the story (a level, an amount of money).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<i64>,
    /// Skill index, for skill events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<u32>,
    /// Career index, for job events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub career: Option<u32>,
}

#[derive(Debug, Default)]
pub struct EventLog {
    next_id: u64,
    events: VecDeque<SocialEvent>,
}

/// The story so far: enough for a few weeks of a whole town.
pub const EVENT_LOG_CAPACITY: usize = 300;

impl EventLog {
    pub fn push(&mut self, tick: u64, kind: EventKind, a: usize, b: usize, c: Option<usize>) {
        self.add(SocialEvent {
            id: 0,
            tick,
            kind,
            a: a as u32,
            b: b as u32,
            c: c.map(|c| c as u32),
            n: None,
            skill: None,
            career: None,
        });
    }

    /// A job event about one Sim.
    pub fn push_career(
        &mut self,
        tick: u64,
        kind: EventKind,
        a: usize,
        career: usize,
        n: Option<i64>,
    ) {
        self.add(SocialEvent {
            id: 0,
            tick,
            kind,
            a: a as u32,
            b: a as u32,
            c: None,
            n,
            skill: None,
            career: Some(career as u32),
        });
    }

    /// An event about one Sim, with a number and optionally a skill.
    pub fn push_detail(
        &mut self,
        tick: u64,
        kind: EventKind,
        a: usize,
        n: Option<i64>,
        skill: Option<usize>,
    ) {
        self.add(SocialEvent {
            id: 0,
            tick,
            kind,
            a: a as u32,
            b: a as u32,
            c: None,
            n,
            skill: skill.map(|s| s as u32),
            career: None,
        });
    }

    fn add(&mut self, mut event: SocialEvent) {
        self.next_id += 1;
        event.id = self.next_id;
        if self.events.len() >= EVENT_LOG_CAPACITY {
            // Everyday events go first, so milestones are remembered longer.
            let old = self.events.len() / 2;
            match self.events.iter().take(old).position(|e| e.kind.importance() == 0) {
                Some(i) => {
                    self.events.remove(i);
                }
                None => {
                    self.events.pop_front();
                }
            }
        }
        self.events.push_back(event);
    }

    pub fn iter(&self) -> impl DoubleEndedIterator<Item = &SocialEvent> {
        self.events.iter()
    }

    /// Id of the latest event.
    pub fn last_id(&self) -> u64 {
        self.next_id
    }

    /// Rebuilds a log from a save (oldest first); ids carry on after `next_id`.
    pub fn restore(next_id: u64, events: impl IntoIterator<Item = SocialEvent>) -> Self {
        let mut events: VecDeque<SocialEvent> = events.into_iter().collect();
        while events.len() > EVENT_LOG_CAPACITY {
            events.pop_front();
        }
        let next_id = events.iter().map(|e| e.id).fold(next_id, u64::max);
        Self { next_id, events }
    }
}

/// Milestone events implied by a change in the pair's relationship.
pub fn milestone_events(
    before: (&Relationship, &Relationship),
    after: (&Relationship, &Relationship),
) -> Vec<(EventKind, bool)> {
    let mut out = Vec::new();
    let mutual = |x: &Relationship, y: &Relationship| {
        friend_level(x.friendship).min(friend_level(y.friendship))
    };
    let (m0, m1) = (mutual(before.0, before.1), mutual(after.0, after.1));
    if m1 > m0 && m1 >= LEVEL_FRIEND {
        out.push((
            match m1 {
                LEVEL_FRIEND => EventKind::BecameFriends,
                LEVEL_GOOD_FRIEND => EventKind::BecameGoodFriends,
                _ => EventKind::BecameBestFriends,
            },
            false,
        ));
    }
    let worst = |x: &Relationship, y: &Relationship| {
        friend_level(x.friendship)
            .max(friend_level(y.friendship))
            .min(friend_level(x.friendship).min(friend_level(y.friendship)))
    };
    if worst(after.0, after.1) <= LEVEL_ENEMY && worst(before.0, before.1) > LEVEL_ENEMY {
        out.push((EventKind::BecameEnemies, false));
    }
    // Crushes are one-directional: `true` means the target has the crush.
    for (b, a, reversed) in [(before.0, after.0, false), (before.1, after.1, true)] {
        if !a.partners && b.romance < CRUSH_ROMANCE && a.romance >= CRUSH_ROMANCE {
            out.push((EventKind::Crush, reversed));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels() {
        assert_eq!(friend_level(-70.0), LEVEL_ENEMY);
        assert_eq!(friend_level(0.0), 0);
        assert_eq!(friend_level(40.0), LEVEL_FRIEND);
        assert_eq!(friend_level(90.0), LEVEL_BEST_FRIEND);
    }

    #[test]
    fn matrix_grows_and_keeps_data() {
        let mut r = Relationships::default();
        r.grow(2);
        r.adjust(0, 1, 20.0, 5.0);
        r.set_chemistry(0, 1, 0.4);
        r.grow(3);
        assert_eq!(r.get(0, 1).friendship, 20.0);
        assert_eq!(r.get(1, 0).friendship, 0.0);
        assert_eq!(r.chemistry(1, 0), 0.4);
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn milestones_detect_friendship_and_crush() {
        let before = Relationship {
            friendship: 30.0,
            romance: 30.0,
            met: true,
            ..Default::default()
        };
        let after = Relationship {
            friendship: 40.0,
            romance: 36.0,
            met: true,
            ..Default::default()
        };
        let events = milestone_events((&before, &before), (&after, &after));
        assert!(events.contains(&(EventKind::BecameFriends, false)));
        assert!(events.contains(&(EventKind::Crush, false)));
        assert!(events.contains(&(EventKind::Crush, true)));
    }

    #[test]
    fn decay_drifts_toward_neutral() {
        let mut r = Relationships::default();
        r.grow(2);
        r.adjust(0, 1, 50.0, 10.0);
        r.decay(&SocialRules::empty());
        assert!(r.get(0, 1).friendship < 50.0);
        assert!(r.get(0, 1).romance < 10.0);
    }
}
