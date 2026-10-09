//! Gameplay content (needs, skills, objects, traits, perks, social life, careers), loaded from JSON.
//!
//! Content files may carry visual fields (`model`, `icon`, ...). The simulation
//! ignores them; they are resolved by the asset registry on the web side.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use crate::Error;
use crate::social::{
    self, BondPreset, EmotionDef, EmotionRaw, FeelingDef, FeelingRaw, Indices, SocialDef,
    SocialRaw, SocialRules, SocialRulesRaw,
};

/// Upper bound on the number of needs, so per-Sim needs fit in a fixed array.
pub const MAX_NEEDS: usize = 8;
/// Upper bound on distinct interaction tags (stored as a bitmask).
pub const MAX_TAGS: usize = 64;
/// Bitmask of indices into `Content::tags`.
pub type TagMask = u64;
/// Upper bound on the number of skills, so per-Sim skills fit in a fixed array.
pub const MAX_SKILLS: usize = 16;
/// Most Sims that can use one object at once (two in a double bed or on a sofa).
pub const MAX_SLOTS: usize = 2;
/// Built-in tag for visiting another household.
pub const VISIT_TAG: &str = "visit";
/// Animation shown during conversations (when content declares it).
pub const TALK_ANIM: &str = "talk";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Pose {
    #[default]
    Stand,
    Sit,
    Lie,
}

impl Pose {
    /// Stable numeric code used in the render snapshot.
    pub fn code(self) -> f32 {
        match self {
            Pose::Stand => 0.0,
            Pose::Sit => 1.0,
            Pose::Lie => 2.0,
        }
    }
}

#[derive(Debug)]
pub struct NeedDef {
    pub id: String,
    pub label: String,
    pub decay_per_minute: f32,
}

#[derive(Debug)]
pub struct Interaction {
    pub id: String,
    pub label: String,
    pub minutes: f32,
    /// Total gain per need over the full duration.
    pub total_gain: [f32; MAX_NEEDS],
    pub gain_per_minute: [f32; MAX_NEEDS],
    pub pose: Pose,
    /// Whether Sims may choose this on their own.
    pub autonomous: bool,
    pub tags: TagMask,
    /// Skill levels gained per hour of use (before the per-level slowdown).
    pub skill_gain: [f32; MAX_SKILLS],
    /// Dollars charged from the Sim's household when the Sim starts using the object.
    pub cost: i64,
    /// Skill that makes this interaction better: need and skill gains scale with its level.
    pub skill: Option<usize>,
    /// Feeling granted on finishing (after at least half the duration)...
    pub feeling: Option<usize>,
    /// ...if the Sim's level in `skill` is at least this.
    pub feeling_min_skill: f32,
    /// What the Sim is shown doing (index into `Content::animations`): the interaction's
    /// `anim`, else one derived from its tags, pose and needs (see `default_anim`).
    pub anim: Option<usize>,
}

impl Interaction {
    pub fn trains_skills(&self) -> bool {
        self.skill_gain.iter().any(|&g| g > 0.0)
    }

    /// Multiplier on gains for a Sim with `skills` (1 without a `skill`).
    pub fn skill_factor(&self, rules: &SkillRules, skills: &[f32; MAX_SKILLS]) -> f32 {
        self.skill.map_or(1.0, |s| rules.effect_factor(skills[s]))
    }

    /// Whether finishing after `elapsed` minutes earns the feeling.
    pub fn earns_feeling(&self, elapsed: f32, skills: &[f32; MAX_SKILLS]) -> Option<usize> {
        let skilled = self
            .skill
            .is_none_or(|s| skills[s].floor() >= self.feeling_min_skill);
        self.feeling
            .filter(|_| skilled && elapsed >= self.minutes * 0.5)
    }
}

#[derive(Debug)]
pub struct ObjectDef {
    pub id: String,
    pub name: String,
    /// Footprint in tiles, `[width (x), depth (z)]`, before rotation. Local +z is the front.
    pub footprint: [u8; 2],
    pub interactions: Vec<Interaction>,
    /// Purchase price; objects without one can't be bought.
    pub price: Option<i64>,
    /// How many Sims can use it at once (1..=MAX_SLOTS).
    pub slots: u8,
    /// Can only be placed outdoors (trees, flower beds, ponds).
    pub outdoors: bool,
}

/// Multipliers and offsets a trait, perk or emotion applies to a Sim.
#[derive(Debug, Clone, PartialEq)]
pub struct Modifiers {
    pub need_decay: [f32; MAX_NEEDS],
    pub need_gain: [f32; MAX_NEEDS],
    /// Autonomy preference per tag: >1 seeks out, <1 avoids.
    pub tag_preference: [f32; MAX_TAGS],
    /// Added to the success chance of socials with this tag when this Sim is the *target*.
    pub tag_acceptance: [f32; MAX_TAGS],
    /// Added to the success chance of socials with this tag when this Sim is the *actor*.
    pub tag_success: [f32; MAX_TAGS],
    pub walk_speed: f32,
    /// Added to mood (0..1 scale).
    pub mood: f32,
    /// Learning speed per skill.
    pub skill_gain: [f32; MAX_SKILLS],
}

impl Default for Modifiers {
    fn default() -> Self {
        Self {
            need_decay: [1.0; MAX_NEEDS],
            need_gain: [1.0; MAX_NEEDS],
            tag_preference: [1.0; MAX_TAGS],
            tag_acceptance: [0.0; MAX_TAGS],
            tag_success: [0.0; MAX_TAGS],
            walk_speed: 1.0,
            mood: 0.0,
            skill_gain: [1.0; MAX_SKILLS],
        }
    }
}

impl Modifiers {
    pub fn combine(&mut self, other: &Modifiers) {
        for i in 0..MAX_NEEDS {
            self.need_decay[i] *= other.need_decay[i];
            self.need_gain[i] *= other.need_gain[i];
        }
        for i in 0..MAX_TAGS {
            self.tag_preference[i] *= other.tag_preference[i];
            self.tag_acceptance[i] += other.tag_acceptance[i];
            self.tag_success[i] += other.tag_success[i];
        }
        for i in 0..MAX_SKILLS {
            self.skill_gain[i] *= other.skill_gain[i];
        }
        self.walk_speed *= other.walk_speed;
        self.mood += other.mood;
    }

    /// Combined preference for an interaction with the given tag mask.
    pub fn preference(&self, tags: TagMask) -> f32 {
        each_tag(tags).map(|i| self.tag_preference[i]).product()
    }

    pub fn acceptance(&self, tags: TagMask) -> f32 {
        each_tag(tags).map(|i| self.tag_acceptance[i]).sum()
    }

    pub fn success(&self, tags: TagMask) -> f32 {
        each_tag(tags).map(|i| self.tag_success[i]).sum()
    }
}

fn each_tag(mask: TagMask) -> impl Iterator<Item = usize> {
    let mut bits = mask;
    std::iter::from_fn(move || {
        if bits == 0 {
            return None;
        }
        let i = bits.trailing_zeros() as usize;
        bits &= bits - 1;
        Some(i)
    })
}

#[derive(Debug)]
pub struct TraitDef {
    pub id: String,
    pub label: String,
    pub conflicts: Vec<String>,
    pub mods: Modifiers,
    /// Skill levels a new Sim with this trait starts with.
    pub starting_skills: [f32; MAX_SKILLS],
}

#[derive(Debug)]
pub struct PerkDef {
    pub id: String,
    pub label: String,
    pub cost: u32,
    pub mods: Modifiers,
}

#[derive(Debug, Clone)]
pub struct CareerLevel {
    pub title: String,
    /// Index into `Content::grades`, for levels generated from career categories.
    pub grade: Option<usize>,
    /// Paid per shift on the standard schedule (`days`). Weekly pay stays the same when
    /// a Sim's skills shorten or lengthen their week; see `life::shift_pay`.
    pub pay: i64,
    pub start_hour: f32,
    pub hours: f32,
    /// Standard workdays as a bitmask (bit 0 = Monday).
    pub days: u8,
    /// Minimum skill levels `(skill, level)`, strongest first. Level 0 entries are kept so
    /// over-qualification can be measured even at entry level.
    pub requires: Vec<(usize, f32)>,
}

#[derive(Debug)]
pub struct CareerDef {
    pub id: String,
    pub label: String,
    /// Index into `Content::career_categories`.
    pub category: Option<usize>,
    pub levels: Vec<CareerLevel>,
    /// Need changes over a whole shift (on top of normal decay).
    pub work_effects: [f32; MAX_NEEDS],
    /// Skills practised at work `(skill, weight)`.
    pub skills: Vec<(usize, f32)>,
}

/// A pay grade (A, B, C...): pay per hour and the skill level its jobs expect.
#[derive(Debug, Clone)]
pub struct GradeDef {
    pub id: String,
    pub label: String,
    pub pay_per_hour: f32,
    /// Required level of a track's main skill; other skills scale by their weight.
    pub skill_level: f32,
}

#[derive(Debug)]
pub struct CategoryDef {
    pub id: String,
    pub label: String,
}

/// How many days a Sim works, by how well their skills fit the job. The rule with the
/// highest `fit` at or below the Sim's fit applies.
#[derive(Debug, Clone)]
pub struct WorkweekRule {
    /// Skill levels above (+) or below (-) the job's requirements.
    pub fit: f32,
    /// Days added to (+) or removed from (-) the standard week.
    pub days: i8,
    pub label: String,
}

/// Global work rules.
#[derive(Debug, Clone)]
pub struct CareerRules {
    pub commute_minutes: f32,
    /// How late a Sim may leave before the shift counts as missed.
    pub late_minutes: f32,
    pub missed_penalty: f32,
    /// Performance gained per shift at neutral mood; mood shifts it up or down.
    pub performance_per_shift: f32,
    /// Extra performance per shift for each skill level above the requirements (or less below).
    pub performance_per_fit: f32,
    /// How far below a job's requirements a Sim may still be hired (on probation).
    pub probation_levels: f32,
    /// Sorted by `fit`.
    pub workweek: Vec<WorkweekRule>,
    pub promotion_feeling: Option<usize>,
    pub missed_feeling: Option<usize>,
    /// Residents finding, quitting and losing jobs on their own (none without it).
    pub market: Option<JobMarket>,
}

/// How residents with free will find, quit and lose jobs.
#[derive(Debug, Clone)]
pub struct JobMarket {
    /// Hour of the day the job search happens.
    pub hour: f32,
    /// Chance per day that an unemployed resident finds a job (doubled when money is short).
    pub daily_chance: f32,
    /// Job satisfaction (0..1, the mood they leave for work in) below which they may quit.
    pub quit_below: f32,
    pub quit_chance: f32,
    pub min_shifts_before_quit: u32,
    /// Missed shifts in a row (worked shifts make up for them) before being let go.
    pub fire_after_missed: u8,
    /// Days before someone who quit or was let go looks again.
    pub cooldown_days: u32,
    pub hired_feeling: Option<usize>,
    pub quit_feeling: Option<usize>,
    pub fired_feeling: Option<usize>,
}

#[derive(Debug)]
pub struct SkillDef {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct SkillRules {
    pub max_level: f32,
    /// Levels per hour at work for a skill with weight 1.
    pub work_gain_per_hour: f32,
    /// Learning slows with level: gain / (1 + level * slowdown).
    pub slowdown: f32,
    /// How much idle Sims want to practise a skill at all (autonomy).
    pub interest: f32,
    /// Extra pull towards a skill their job needs for probation or the next promotion.
    pub goal_interest: f32,
    /// Interactions with a `skill` give this much more per level of it (0.05 = +5%).
    pub effect_per_level: f32,
    /// Practice gets boring: fatigue gained per hour of practice...
    pub fatigue_per_hour: f32,
    /// ...and lost per hour of doing something else. Interest is divided by `1 + fatigue`.
    pub fatigue_recovery_per_hour: f32,
}

impl SkillRules {
    /// Gain for `hours` of practice at `level`.
    pub fn gain(&self, per_hour: f32, hours: f32, level: f32) -> f32 {
        per_hour * hours / (1.0 + level * self.slowdown)
    }

    /// Multiplier on an interaction's gains for a Sim at `level` (whole levels count).
    pub fn effect_factor(&self, level: f32) -> f32 {
        1.0 + self.effect_per_level * level.floor()
    }
}

/// Day and night: when Sims go to bed and get up, and how sleep changes their needs.
#[derive(Debug, Clone)]
pub struct DayRhythm {
    pub wake_hour: f32,
    pub bed_hour: f32,
    /// Interactions with any of these tags count as sleep.
    pub sleep_tags: TagMask,
    /// Need decay multipliers while awake at night (tiredness builds up).
    pub night_decay: [f32; MAX_NEEDS],
    /// Need decay multipliers while asleep.
    pub asleep_decay: [f32; MAX_NEEDS],
    /// Need decay multipliers while at work (there's lunch and a bathroom there; the job's
    /// `workEffects` come on top).
    pub work_decay: [f32; MAX_NEEDS],
    /// Sims with an early shift get up this long before they leave.
    pub wake_before_work_minutes: f32,
}

impl DayRhythm {
    /// Night for a Sim who gets up at `wake`.
    pub fn is_night(&self, hour: f32, wake: f32) -> bool {
        !(wake..self.bed_hour).contains(&hour)
    }
}

/// Weekly rent, charged from household funds.
#[derive(Debug, Clone)]
pub struct RentRules {
    /// 0 = Monday.
    pub weekday: u32,
    pub hour: f32,
    pub base: i64,
    /// Added per tile of the household's plot.
    pub per_tile: f32,
    /// Weekly bills (power, water, upkeep) charged with the rent: a flat part…
    pub bills_base: i64,
    /// …plus this share of what the household's objects are worth (price plus upgrades).
    pub bills_rate: f32,
    /// Given to every member each day the household is in debt.
    pub debt_feeling: Option<usize>,
}

impl RentRules {
    pub fn amount(&self, plot_tiles: i32) -> i64 {
        self.base + (self.per_tile * plot_tiles.max(0) as f32).round() as i64
    }

    pub fn bills(&self, home_value: i64) -> i64 {
        self.bills_base + (self.bills_rate * home_value.max(0) as f32).round() as i64
    }
}

/// A time-of-day window that biases autonomy (sleep at night, socialise in the evening).
#[derive(Debug)]
pub struct ScheduleWindow {
    /// Hours; `from > to` wraps past midnight.
    pub from: f32,
    pub to: f32,
    pub mods: Modifiers,
}

impl ScheduleWindow {
    pub fn contains(&self, hour: f32) -> bool {
        if self.from <= self.to {
            (self.from..self.to).contains(&hour)
        } else {
            hour >= self.from || hour < self.to
        }
    }
}

/// How NPC households visit each other.
#[derive(Debug, Clone)]
pub struct VisitRules {
    /// Expected need gains from a visit (for autonomy scoring).
    pub gains: [f32; MAX_NEEDS],
    pub hours: f32,
    /// How long a visit the player asked for lasts.
    pub directed_hours: f32,
    pub min_friendship: f32,
    pub earliest_hour: f32,
    pub latest_hour: f32,
    /// Tag mask used for schedule/trait preferences of visiting.
    pub tags: TagMask,
}

#[derive(Debug)]
pub struct GenderDef {
    pub id: String,
    pub label: String,
}

/// Limits for character creation.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CharacterRules {
    pub min_traits: usize,
    pub max_traits: usize,
    pub perk_points: u32,
    pub max_household: usize,
}

impl Default for CharacterRules {
    fn default() -> Self {
        Self {
            min_traits: 0,
            max_traits: 3,
            perk_points: 5,
            max_household: 4,
        }
    }
}

/// Buying, upgrading and selling objects.
#[derive(Debug, Clone)]
pub struct ObjectRules {
    pub max_quality: u8,
    /// Need and skill gains grow by this fraction per quality level.
    pub quality_bonus: f32,
    /// One quality level (bought instantly in Buy mode) costs this fraction of the price.
    pub upgrade_cost: f32,
    /// Share of the price and paid upgrades returned when selling.
    pub resale: f32,
}

impl ObjectRules {
    /// Multiplier on need and skill gains for an object of `quality`.
    pub fn quality_factor(&self, quality: u8) -> f32 {
        1.0 + self.quality_bonus * quality as f32
    }

    /// Parts cost to raise an object with `price` to the next quality level.
    pub fn upgrade_price(&self, price: i64) -> i64 {
        (price as f32 * self.upgrade_cost).round() as i64
    }
}

/// Prices for build mode, and the looks walls, doors and windows come in.
#[derive(Debug, Clone)]
pub struct BuildRules {
    pub wall: i64,
    pub door: i64,
    pub window: i64,
    /// Removing a wall, door or window.
    pub remove: i64,
    /// Wall coverings (`wallCoverings`): paint, wallpaper, brick... A wall face's covering is an
    /// index into this list + 1; 0 is the automatic look (siding outside, wallpaper inside).
    pub coverings: Vec<BuildStyle>,
    /// Door styles (`doorStyles`); a door's style is an index into this list (0 when empty).
    pub doors: Vec<BuildStyle>,
    /// Window styles (`windowStyles`), like doors.
    pub windows: Vec<BuildStyle>,
    /// Floor coverings (`floorCoverings`): wood, tile, carpet... A tile's covering is an index
    /// into this list + 1; 0 is the automatic look (by what the room is used for).
    pub floors: Vec<BuildStyle>,
}

/// A look for walls, doors or windows. The simulation only needs its id (saves) and price; the
/// renderer reads the rest of the content entry (finish, colour, glazing...).
#[derive(Debug, Clone)]
pub struct BuildStyle {
    pub id: String,
    pub price: i64,
}

impl BuildRules {
    /// A diagonal wall spans a tile corner to corner (√2 m): `wall × 1.414`, rounded.
    pub fn diagonal_wall(&self) -> i64 {
        (self.wall as f64 * 1.414).round() as i64
    }

    /// Price of a door in `style` (the plain door price without styles).
    pub fn door_price(&self, style: u8) -> i64 {
        self.doors
            .get(style as usize)
            .map_or(self.door, |s| s.price)
    }

    /// Price of a window in `style`.
    pub fn window_price(&self, style: u8) -> i64 {
        self.windows
            .get(style as usize)
            .map_or(self.window, |s| s.price)
    }

    /// Price of covering one wall face (0, the automatic look, is free).
    pub fn covering_price(&self, covering: u8) -> i64 {
        covering
            .checked_sub(1)
            .and_then(|i| self.coverings.get(i as usize))
            .map_or(0, |c| c.price)
    }

    /// Price of covering one floor tile (0, the automatic look, is free).
    pub fn floor_price(&self, covering: u8) -> i64 {
        covering
            .checked_sub(1)
            .and_then(|i| self.floors.get(i as usize))
            .map_or(0, |c| c.price)
    }
}

/// A look the player can pick for objects. Purely visual: price and effects never change.
#[derive(Debug)]
pub struct StyleDef {
    pub id: String,
    pub label: String,
}

#[derive(Debug)]
pub struct Content {
    pub needs: Vec<NeedDef>,
    pub objects: Vec<ObjectDef>,
    pub traits: Vec<TraitDef>,
    pub perks: Vec<PerkDef>,
    pub genders: Vec<GenderDef>,
    pub tags: Vec<String>,
    pub rules: CharacterRules,
    pub emotions: Vec<EmotionDef>,
    pub feelings: Vec<FeelingDef>,
    pub socials: Vec<SocialDef>,
    pub bond_presets: HashMap<String, BondPreset>,
    pub social_rules: SocialRules,
    pub careers: Vec<CareerDef>,
    pub career_rules: CareerRules,
    pub schedule: Vec<ScheduleWindow>,
    pub visits: VisitRules,
    pub starting_funds: i64,
    pub skills: Vec<SkillDef>,
    pub skill_rules: SkillRules,
    pub grades: Vec<GradeDef>,
    pub career_categories: Vec<CategoryDef>,
    pub day_rhythm: DayRhythm,
    pub rent: Option<RentRules>,
    pub object_rules: ObjectRules,
    pub build: BuildRules,
    pub styles: Vec<StyleDef>,
    /// Animation tags (`"animations"`): what a Sim can be shown doing. Interactions refer
    /// to them by `anim`; the render snapshot sends indices into this list.
    pub animations: Vec<String>,
    /// Index of the `talk` animation (conversations), if content defines it.
    pub talk_anim: Option<usize>,
    /// Whether any feeling has `effects` (Sims then fold them into their modifiers).
    pub buff_feelings: bool,
    object_index: HashMap<String, usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContentFile {
    needs: Vec<NeedRaw>,
    objects: Vec<ObjectRaw>,
    #[serde(default)]
    traits: Vec<TraitRaw>,
    #[serde(default)]
    perks: Vec<PerkRaw>,
    #[serde(default)]
    genders: Vec<GenderRaw>,
    #[serde(default)]
    rules: CharacterRules,
    #[serde(default)]
    emotions: Vec<EmotionRaw>,
    #[serde(default)]
    #[serde(alias = "moodlets")] // key before the moodlet → feeling rename
    feelings: Vec<FeelingRaw>,
    #[serde(default)]
    socials: Vec<SocialRaw>,
    #[serde(default)]
    bond_presets: HashMap<String, BondPreset>,
    #[serde(default)]
    social_rules: SocialRulesRaw,
    #[serde(default)]
    careers: Vec<CareerRaw>,
    #[serde(default)]
    career_rules: CareerRulesRaw,
    #[serde(default)]
    schedule: Vec<ScheduleRaw>,
    #[serde(default)]
    visits: VisitRaw,
    #[serde(default)]
    economy: EconomyRaw,
    #[serde(default)]
    skills: Vec<SkillRaw>,
    #[serde(default)]
    skill_rules: SkillRulesRaw,
    #[serde(default)]
    grades: Vec<GradeRaw>,
    #[serde(default)]
    career_categories: Vec<CategoryRaw>,
    #[serde(default)]
    day_rhythm: DayRhythmRaw,
    #[serde(default)]
    object_rules: ObjectRulesRaw,
    #[serde(default)]
    build: BuildRaw,
    #[serde(default)]
    wall_coverings: Vec<BuildStyleRaw>,
    #[serde(default)]
    door_styles: Vec<BuildStyleRaw>,
    #[serde(default)]
    window_styles: Vec<BuildStyleRaw>,
    #[serde(default)]
    floor_coverings: Vec<BuildStyleRaw>,
    #[serde(default)]
    styles: Vec<StyleRaw>,
    /// Extra tags that no interaction or social uses (yet), so traits and emotions can refer to them.
    #[serde(default)]
    tags: Vec<String>,
    /// Animation tags interactions may use as `anim`.
    #[serde(default)]
    animations: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CareerRaw {
    id: String,
    label: String,
    levels: Vec<CareerLevelRaw>,
    #[serde(default)]
    work_effects: HashMap<String, f32>,
    /// Skills practised at work, with weights.
    #[serde(default)]
    skills: HashMap<String, f32>,
}

#[derive(Deserialize)]
struct SkillRaw {
    id: String,
    label: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SkillRulesRaw {
    max_level: Option<f32>,
    work_gain_per_hour: Option<f32>,
    slowdown: Option<f32>,
    interest: Option<f32>,
    goal_interest: Option<f32>,
    effect_per_level: Option<f32>,
    fatigue_per_hour: Option<f32>,
    fatigue_recovery_per_hour: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GradeRaw {
    id: String,
    label: String,
    pay_per_hour: f32,
    skill_level: f32,
}

#[derive(Deserialize, Clone, Copy)]
struct ShiftRaw {
    start: f32,
    hours: f32,
    days: Days,
}

/// Weekday indices (0 = Monday), stored inline so shifts stay `Copy`.
#[derive(Clone, Copy)]
struct Days(u8, bool);

impl<'de> Deserialize<'de> for Days {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let list = Vec::<u8>::deserialize(d)?;
        let valid = list.iter().all(|&x| x <= 6);
        Ok(Days(
            list.iter()
                .filter(|&&x| x <= 6)
                .fold(0, |m, x| m | (1 << x)),
            valid,
        ))
    }
}

/// A career category; each track in it becomes one career, one level per grade.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryRaw {
    id: String,
    label: String,
    #[serde(default = "one")]
    pay_factor: f32,
    shift: ShiftRaw,
    #[serde(default)]
    work_effects: HashMap<String, f32>,
    tracks: Vec<TrackRaw>,
}

#[derive(Deserialize)]
struct TrackRaw {
    id: String,
    label: String,
    skills: HashMap<String, f32>,
    #[serde(default)]
    shift: Option<ShiftRaw>,
    titles: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct DayRhythmRaw {
    wake_hour: Option<f32>,
    bed_hour: Option<f32>,
    sleep_tags: Vec<String>,
    night_decay: HashMap<String, f32>,
    asleep_decay: HashMap<String, f32>,
    work_decay: HashMap<String, f32>,
    wake_before_work_minutes: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RentRaw {
    #[serde(default = "sunday")]
    weekday: u32,
    #[serde(default = "noon")]
    hour: f32,
    base: i64,
    #[serde(default)]
    per_tile: f32,
    #[serde(default)]
    bills_base: i64,
    #[serde(default)]
    bills_rate: f32,
    #[serde(default)]
    #[serde(alias = "debtMoodlet")] // key before the moodlet → feeling rename
    debt_feeling: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ObjectRulesRaw {
    max_quality: Option<u8>,
    quality_bonus: Option<f32>,
    upgrade_cost: Option<f32>,
    resale: Option<f32>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct BuildRaw {
    wall: Option<i64>,
    door: Option<i64>,
    window: Option<i64>,
    remove: Option<i64>,
}

#[derive(Deserialize)]
struct BuildStyleRaw {
    id: String,
    #[serde(default)]
    price: i64,
}

#[derive(Deserialize)]
struct StyleRaw {
    id: String,
    label: String,
}

fn one() -> f32 {
    1.0
}

fn sunday() -> u32 {
    6
}

fn noon() -> f32 {
    12.0
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CareerLevelRaw {
    title: String,
    pay: i64,
    start: f32,
    hours: f32,
    /// Weekday indices, 0 = Monday.
    days: Vec<u8>,
    #[serde(default)]
    requires: HashMap<String, f32>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CareerRulesRaw {
    commute_minutes: Option<f32>,
    late_minutes: Option<f32>,
    missed_penalty: Option<f32>,
    performance_per_shift: Option<f32>,
    performance_per_fit: Option<f32>,
    probation_levels: Option<f32>,
    workweek: Vec<WorkweekRaw>,
    #[serde(alias = "promotionMoodlet")] // key before the moodlet → feeling rename
    promotion_feeling: Option<String>,
    #[serde(alias = "missedMoodlet")] // key before the moodlet → feeling rename
    missed_feeling: Option<String>,
    market: Option<JobMarketRaw>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct JobMarketRaw {
    hour: Option<f32>,
    daily_chance: Option<f32>,
    quit_below: Option<f32>,
    quit_chance: Option<f32>,
    min_shifts_before_quit: Option<u32>,
    fire_after_missed: Option<u8>,
    cooldown_days: Option<u32>,
    hired_feeling: Option<String>,
    quit_feeling: Option<String>,
    fired_feeling: Option<String>,
}

#[derive(Deserialize)]
struct WorkweekRaw {
    fit: f32,
    days: i8,
    label: String,
}

#[derive(Deserialize)]
struct ScheduleRaw {
    from: f32,
    to: f32,
    #[serde(default)]
    effects: ModifiersRaw,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VisitRaw {
    needs: HashMap<String, f32>,
    hours: Option<f32>,
    directed_hours: Option<f32>,
    min_friendship: Option<f32>,
    earliest_hour: Option<f32>,
    latest_hour: Option<f32>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct EconomyRaw {
    starting_funds: Option<i64>,
    rent: Option<RentRaw>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeedRaw {
    id: String,
    label: String,
    decay_per_hour: f32,
}

#[derive(Deserialize)]
struct ObjectRaw {
    id: String,
    name: String,
    #[serde(default = "one_by_one")]
    footprint: [u8; 2],
    #[serde(default)]
    interactions: Vec<InteractionRaw>,
    #[serde(default)]
    price: Option<i64>,
    #[serde(default = "one_slot")]
    slots: u8,
    #[serde(default)]
    outdoors: bool,
}

fn one_slot() -> u8 {
    1
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InteractionRaw {
    id: String,
    label: String,
    minutes: f32,
    #[serde(default)]
    effects: HashMap<String, f32>,
    #[serde(default)]
    pose: Pose,
    #[serde(default = "yes")]
    autonomous: bool,
    #[serde(default)]
    tags: Vec<String>,
    /// Skill levels gained per hour.
    #[serde(default)]
    skills: HashMap<String, f32>,
    #[serde(default)]
    cost: i64,
    #[serde(default)]
    skill: Option<String>,
    #[serde(default)]
    #[serde(alias = "moodlet")] // key before the moodlet → feeling rename
    feeling: Option<String>,
    #[serde(default)]
    #[serde(alias = "moodletMinSkill")] // key before the moodlet → feeling rename
    feeling_min_skill: f32,
    /// Animation tag (one of the content's `animations`).
    #[serde(default)]
    anim: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct ModifiersRaw {
    need_decay: HashMap<String, f32>,
    need_gain: HashMap<String, f32>,
    tag_preference: HashMap<String, f32>,
    tag_acceptance: HashMap<String, f32>,
    tag_success: HashMap<String, f32>,
    walk_speed: Option<f32>,
    mood: f32,
    skill_gain: HashMap<String, f32>,
}

#[derive(Deserialize)]
struct TraitRaw {
    id: String,
    label: String,
    #[serde(default)]
    conflicts: Vec<String>,
    #[serde(default)]
    effects: ModifiersRaw,
    #[serde(default)]
    starting_skills: HashMap<String, f32>,
}

#[derive(Deserialize)]
struct PerkRaw {
    id: String,
    label: String,
    cost: u32,
    #[serde(default)]
    effects: ModifiersRaw,
}

#[derive(Deserialize)]
struct GenderRaw {
    id: String,
    label: String,
}

fn one_by_one() -> [u8; 2] {
    [1, 1]
}

fn yes() -> bool {
    true
}

fn intern(tags: &mut Vec<String>, tag: &str) -> Result<(), Error> {
    if !tags.iter().any(|t| t == tag) {
        if tags.len() == MAX_TAGS {
            return Err(Error::new(format!("more than {MAX_TAGS} tags")));
        }
        tags.push(tag.to_owned());
    }
    Ok(())
}

pub(crate) fn build_modifiers(
    raw: &ModifiersRaw,
    ix: &Indices,
    ctx: &str,
) -> Result<Modifiers, Error> {
    let tag = |t: &str| lookup(ix.tags, t, ctx, "tag");
    let mut m = Modifiers::default();
    for (need, v) in &raw.need_decay {
        m.need_decay[lookup(ix.needs, need, ctx, "need")?] = *v;
    }
    for (need, v) in &raw.need_gain {
        m.need_gain[lookup(ix.needs, need, ctx, "need")?] = *v;
    }
    for (t, v) in &raw.tag_preference {
        m.tag_preference[tag(t)?] = *v;
    }
    for (t, v) in &raw.tag_acceptance {
        m.tag_acceptance[tag(t)?] = *v;
    }
    for (t, v) in &raw.tag_success {
        m.tag_success[tag(t)?] = *v;
    }
    for (skill, v) in &raw.skill_gain {
        m.skill_gain[lookup(ix.skills, skill, ctx, "skill")?] = *v;
    }
    m.walk_speed = raw.walk_speed.unwrap_or(1.0);
    m.mood = raw.mood;
    Ok(m)
}

/// Animation tag for an interaction without an `anim`, from its tags, pose and needs.
/// The caller drops tags that content doesn't declare in `animations`.
fn default_anim(it: &InteractionRaw) -> &'static str {
    let has = |t: &str| it.tags.iter().any(|x| x == t);
    // The need it raises most (ties: first in id order, so the result is deterministic).
    let main_need = it
        .effects
        .iter()
        .filter(|(_, g)| **g > 0.0)
        .max_by(|a, b| a.1.total_cmp(b.1).then(b.0.cmp(a.0)))
        .map(|(n, _)| n.as_str());
    let seated = it.pose != Pose::Stand;
    if has("reading") {
        "read"
    } else if has("cooking") {
        // Cooking at a table is eating what was cooked.
        if seated { "eat" } else { "cook" }
    } else if has("sleep") {
        "sleep"
    } else if has("nap") {
        "nap"
    } else if has("bathroom") || main_need == Some("bladder") {
        "toilet"
    } else if main_need == Some("hunger") {
        "eat"
    } else if has("social") || main_need == Some("social") {
        "talk"
    } else if has("fitness") || has("sport") {
        "exercise"
    } else if has("gaming") {
        "play"
    } else if has("music") {
        "music"
    } else if has("garden") || (has("chores") && has("nature")) {
        "garden"
    } else if has("cleaning") || has("chores") {
        "clean"
    } else if has("spa") || has("hygiene") || main_need == Some("hygiene") {
        match (seated, it.minutes <= 10.0) {
            (true, _) => "bath",
            (false, true) => "wash",
            (false, false) => "shower",
        }
    } else if has("screen") {
        if seated && has("training") {
            "type"
        } else {
            "watch"
        }
    } else if has("food") {
        "drink"
    } else if has("creative") {
        if seated { "write" } else { "paint" }
    } else if has("rest") || has("lounge") || it.pose == Pose::Lie {
        "relax"
    } else if seated {
        "sit"
    } else {
        "idle"
    }
}

impl Content {
    pub fn from_json(json: &str) -> Result<Self, Error> {
        let raw: ContentFile = serde_json::from_str(json)?;
        if raw.needs.is_empty() || raw.needs.len() > MAX_NEEDS {
            return Err(Error::new(format!(
                "content must define 1..={MAX_NEEDS} needs"
            )));
        }

        let needs: Vec<NeedDef> = raw
            .needs
            .iter()
            .map(|n| NeedDef {
                id: n.id.clone(),
                label: n.label.clone(),
                decay_per_minute: n.decay_per_hour / 60.0,
            })
            .collect();
        let need_index: HashMap<&str, usize> = needs
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect();

        // Tags come from object interactions and socials; everything else refers to them.
        let mut tags: Vec<String> = Vec::new();
        for obj in &raw.objects {
            for it in &obj.interactions {
                for t in &it.tags {
                    intern(&mut tags, t)?;
                }
            }
        }
        for s in &raw.socials {
            for t in &s.tags {
                intern(&mut tags, t)?;
            }
        }
        for t in &raw.tags {
            intern(&mut tags, t)?;
        }
        // Built-in tag for visiting other households (schedules and traits can refer to it).
        intern(&mut tags, VISIT_TAG)?;
        let tag_index: HashMap<&str, usize> = tags
            .iter()
            .enumerate()
            .map(|(i, t)| (t.as_str(), i))
            .collect();

        // Animation tags: declared once (packs may append); repeats are merged.
        let mut animations: Vec<String> = Vec::new();
        for a in &raw.animations {
            if a.is_empty() {
                return Err(Error::new("animations: empty animation tag"));
            }
            if !animations.contains(a) {
                animations.push(a.clone());
            }
        }
        let anim_index = |a: &str| animations.iter().position(|x| x == a);

        let emotion_index: HashMap<String, usize> = raw
            .emotions
            .iter()
            .enumerate()
            .map(|(i, e)| (e.id.clone(), i))
            .collect();
        let feeling_index: HashMap<String, usize> = raw
            .feelings
            .iter()
            .enumerate()
            .map(|(i, m)| (social::feeling_id(m).to_owned(), i))
            .collect();
        if raw.skills.len() > MAX_SKILLS {
            return Err(Error::new(format!("at most {MAX_SKILLS} skills")));
        }
        let skills: Vec<SkillDef> = raw
            .skills
            .iter()
            .map(|s| SkillDef {
                id: s.id.clone(),
                label: s.label.clone(),
            })
            .collect();
        let skill_index: HashMap<&str, usize> = skills
            .iter()
            .enumerate()
            .map(|(i, s)| (s.id.as_str(), i))
            .collect();
        if skill_index.len() != skills.len() {
            return Err(Error::new("duplicate skill id"));
        }
        let skill_array =
            |map: &HashMap<String, f32>, ctx: &str| -> Result<[f32; MAX_SKILLS], Error> {
                let mut out = [0.0; MAX_SKILLS];
                for (k, v) in map {
                    out[lookup(&skill_index, k, ctx, "skill")?] = *v;
                }
                Ok(out)
            };
        // Skill weights, strongest first (ties by skill order) so output is deterministic.
        let skill_list =
            |map: &HashMap<String, f32>, ctx: &str| -> Result<Vec<(usize, f32)>, Error> {
                let mut out = map
                    .iter()
                    .map(|(k, v)| Ok((lookup(&skill_index, k, ctx, "skill")?, *v)))
                    .collect::<Result<Vec<_>, Error>>()?;
                out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
                Ok(out)
            };

        let ix = Indices {
            needs: &need_index,
            tags: &tag_index,
            emotions: &emotion_index,
            feelings: &feeling_index,
            skills: &skill_index,
        };

        let mut objects = Vec::with_capacity(raw.objects.len());
        let mut object_index = HashMap::new();
        for obj in &raw.objects {
            if obj.footprint[0] == 0 || obj.footprint[1] == 0 {
                return Err(Error::new(format!(
                    "object '{}' has an empty footprint",
                    obj.id
                )));
            }
            let mut interactions = Vec::with_capacity(obj.interactions.len());
            for it in &obj.interactions {
                let ctx = format!("{}.{}", obj.id, it.id);
                if it.minutes <= 0.0 {
                    return Err(Error::new(format!("{ctx}: minutes must be > 0")));
                }
                let mut total_gain = [0.0; MAX_NEEDS];
                for (need, gain) in &it.effects {
                    total_gain[lookup(&need_index, need, &ctx, "need")?] = *gain;
                }
                let mut mask: TagMask = 0;
                for t in &it.tags {
                    mask |= 1 << tag_index[t.as_str()];
                }
                if it.cost < 0 {
                    return Err(Error::new(format!("{ctx}: negative cost")));
                }
                let skill = it
                    .skill
                    .as_deref()
                    .map(|s| lookup(&skill_index, s, &ctx, "skill"))
                    .transpose()?;
                let feeling = it
                    .feeling
                    .as_deref()
                    .map(|m| {
                        feeling_index
                            .get(m)
                            .copied()
                            .ok_or_else(|| Error::new(format!("{ctx}: unknown feeling '{m}'")))
                    })
                    .transpose()?;
                if it.feeling_min_skill > 0.0 && (skill.is_none() || feeling.is_none()) {
                    return Err(Error::new(format!(
                        "{ctx}: feelingMinSkill needs a skill and a feeling"
                    )));
                }
                let anim = match it.anim.as_deref() {
                    Some(a) => Some(anim_index(a).ok_or_else(|| {
                        Error::new(format!(
                            "{ctx}: unknown anim '{a}' (declare it in \"animations\")"
                        ))
                    })?),
                    None => anim_index(default_anim(it)),
                };
                interactions.push(Interaction {
                    id: it.id.clone(),
                    label: it.label.clone(),
                    minutes: it.minutes,
                    total_gain,
                    gain_per_minute: total_gain.map(|g| g / it.minutes),
                    pose: it.pose,
                    autonomous: it.autonomous,
                    tags: mask,
                    skill_gain: skill_array(&it.skills, &ctx)?,
                    cost: it.cost,
                    skill,
                    feeling,
                    feeling_min_skill: it.feeling_min_skill,
                    anim,
                });
            }
            if object_index.insert(obj.id.clone(), objects.len()).is_some() {
                return Err(Error::new(format!("duplicate object id '{}'", obj.id)));
            }
            if obj.slots == 0 || obj.slots as usize > MAX_SLOTS {
                return Err(Error::new(format!(
                    "object '{}': slots must be 1..={MAX_SLOTS}",
                    obj.id
                )));
            }
            if obj.price.is_some_and(|p| p < 0) {
                return Err(Error::new(format!("object '{}': negative price", obj.id)));
            }
            objects.push(ObjectDef {
                id: obj.id.clone(),
                name: obj.name.clone(),
                footprint: obj.footprint,
                interactions,
                price: obj.price,
                slots: obj.slots,
                outdoors: obj.outdoors,
            });
        }

        let emotions = raw
            .emotions
            .iter()
            .map(|e| {
                Ok(EmotionDef {
                    id: e.id.clone(),
                    label: e.label.clone(),
                    mods: build_modifiers(&e.effects, &ix, &e.id)?,
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        let feelings = raw
            .feelings
            .iter()
            .map(|m| social::parse_feeling(m, &ix))
            .collect::<Result<Vec<_>, _>>()?;
        let socials = raw
            .socials
            .iter()
            .map(|s| social::parse_social(s, &ix))
            .collect::<Result<Vec<_>, _>>()?;
        if socials
            .iter()
            .map(|s| s.id.as_str())
            .collect::<HashSet<_>>()
            .len()
            != socials.len()
        {
            return Err(Error::new("duplicate social id"));
        }
        let social_rules = social::parse_rules(&raw.social_rules, &raw.bond_presets, &ix)?;

        let need_array =
            |map: &HashMap<String, f32>, ctx: &str| -> Result<[f32; MAX_NEEDS], Error> {
                let mut out = [0.0; MAX_NEEDS];
                for (k, v) in map {
                    out[lookup(&need_index, k, ctx, "need")?] = *v;
                }
                Ok(out)
            };
        let feeling = |id: &Option<String>, ctx: &str| -> Result<Option<usize>, Error> {
            id.as_deref()
                .map(|m| {
                    feeling_index
                        .get(m)
                        .copied()
                        .ok_or_else(|| Error::new(format!("{ctx}: unknown feeling '{m}'")))
                })
                .transpose()
        };
        let valid_shift = |start: f32, hours: f32, days_ok: bool| {
            (0.0..24.0).contains(&start) && hours > 0.0 && hours <= 16.0 && days_ok
        };
        let mut careers = Vec::with_capacity(raw.careers.len());
        for c in &raw.careers {
            if c.levels.is_empty() {
                return Err(Error::new(format!("career '{}' has no levels", c.id)));
            }
            let levels = c
                .levels
                .iter()
                .map(|l| {
                    if !valid_shift(l.start, l.hours, l.days.iter().all(|d| *d <= 6)) {
                        return Err(Error::new(format!(
                            "career '{}': invalid shift for '{}'",
                            c.id, l.title
                        )));
                    }
                    Ok(CareerLevel {
                        title: l.title.clone(),
                        grade: None,
                        pay: l.pay,
                        start_hour: l.start,
                        hours: l.hours,
                        days: l.days.iter().fold(0u8, |m, d| m | (1 << d)),
                        requires: skill_list(&l.requires, &c.id)?,
                    })
                })
                .collect::<Result<Vec<_>, Error>>()?;
            careers.push(CareerDef {
                id: c.id.clone(),
                label: c.label.clone(),
                category: None,
                levels,
                work_effects: need_array(&c.work_effects, &c.id)?,
                skills: skill_list(&c.skills, &c.id)?,
            });
        }

        // Career categories: every track becomes a career with one level per grade.
        let grades: Vec<GradeDef> = raw
            .grades
            .iter()
            .map(|g| GradeDef {
                id: g.id.clone(),
                label: g.label.clone(),
                pay_per_hour: g.pay_per_hour,
                skill_level: g.skill_level,
            })
            .collect();
        let mut career_categories = Vec::with_capacity(raw.career_categories.len());
        for (ci, cat) in raw.career_categories.iter().enumerate() {
            let work_effects = need_array(&cat.work_effects, &cat.id)?;
            for track in &cat.tracks {
                if track.titles.is_empty() || track.titles.len() > grades.len() {
                    return Err(Error::new(format!(
                        "track '{}' needs 1..={} titles (one per grade)",
                        track.id,
                        grades.len()
                    )));
                }
                let shift = track.shift.unwrap_or(cat.shift);
                if !valid_shift(shift.start, shift.hours, shift.days.1) || shift.days.0 == 0 {
                    return Err(Error::new(format!("track '{}': invalid shift", track.id)));
                }
                let skills = skill_list(&track.skills, &track.id)?;
                let levels = track
                    .titles
                    .iter()
                    .zip(&grades)
                    .enumerate()
                    .map(|(gi, (title, grade))| CareerLevel {
                        title: title.clone(),
                        grade: Some(gi),
                        pay: (grade.pay_per_hour * cat.pay_factor * shift.hours).round() as i64,
                        start_hour: shift.start,
                        hours: shift.hours,
                        days: shift.days.0,
                        requires: skills
                            .iter()
                            .map(|&(s, w)| (s, (grade.skill_level * w).round()))
                            .collect(),
                    })
                    .collect();
                careers.push(CareerDef {
                    id: track.id.clone(),
                    label: track.label.clone(),
                    category: Some(ci),
                    levels,
                    work_effects,
                    skills,
                });
            }
            career_categories.push(CategoryDef {
                id: cat.id.clone(),
                label: cat.label.clone(),
            });
        }
        if careers
            .iter()
            .map(|c| c.id.as_str())
            .collect::<HashSet<_>>()
            .len()
            != careers.len()
        {
            return Err(Error::new("duplicate career id"));
        }
        let cr = &raw.career_rules;
        let mut workweek: Vec<WorkweekRule> = cr
            .workweek
            .iter()
            .map(|w| WorkweekRule {
                fit: w.fit,
                days: w.days,
                label: w.label.clone(),
            })
            .collect();
        workweek.sort_by(|a, b| a.fit.total_cmp(&b.fit));
        let career_rules = CareerRules {
            commute_minutes: cr.commute_minutes.unwrap_or(30.0),
            late_minutes: cr.late_minutes.unwrap_or(60.0),
            missed_penalty: cr.missed_penalty.unwrap_or(20.0),
            performance_per_shift: cr.performance_per_shift.unwrap_or(12.0),
            performance_per_fit: cr.performance_per_fit.unwrap_or(0.0),
            probation_levels: cr.probation_levels.unwrap_or(0.0),
            workweek,
            promotion_feeling: feeling(&cr.promotion_feeling, "careerRules")?,
            missed_feeling: feeling(&cr.missed_feeling, "careerRules")?,
            market: match &cr.market {
                None => None,
                Some(m) => Some(JobMarket {
                    hour: m.hour.unwrap_or(9.5),
                    daily_chance: m.daily_chance.unwrap_or(0.35).clamp(0.0, 1.0),
                    quit_below: m.quit_below.unwrap_or(0.3),
                    quit_chance: m.quit_chance.unwrap_or(0.15).clamp(0.0, 1.0),
                    min_shifts_before_quit: m.min_shifts_before_quit.unwrap_or(10),
                    fire_after_missed: m.fire_after_missed.unwrap_or(3).max(1),
                    cooldown_days: m.cooldown_days.unwrap_or(2),
                    hired_feeling: feeling(&m.hired_feeling, "careerRules.market")?,
                    quit_feeling: feeling(&m.quit_feeling, "careerRules.market")?,
                    fired_feeling: feeling(&m.fired_feeling, "careerRules.market")?,
                }),
            },
        };

        let sr = &raw.skill_rules;
        let skill_rules = SkillRules {
            max_level: sr.max_level.unwrap_or(10.0),
            work_gain_per_hour: sr.work_gain_per_hour.unwrap_or(0.05),
            slowdown: sr.slowdown.unwrap_or(0.25),
            interest: sr.interest.unwrap_or(0.05),
            goal_interest: sr.goal_interest.unwrap_or(0.25),
            effect_per_level: sr.effect_per_level.unwrap_or(0.05),
            fatigue_per_hour: sr.fatigue_per_hour.unwrap_or(0.0),
            fatigue_recovery_per_hour: sr.fatigue_recovery_per_hour.unwrap_or(0.0),
        };
        let dr = &raw.day_rhythm;
        let tag_mask = |tags: &[String]| {
            tags.iter()
                .filter_map(|t| tag_index.get(t.as_str()))
                .fold(0, |m: TagMask, i| m | (1 << i))
        };
        let multipliers =
            |map: &HashMap<String, f32>, ctx: &str| -> Result<[f32; MAX_NEEDS], Error> {
                let mut out = [1.0; MAX_NEEDS];
                for (k, v) in map {
                    out[lookup(&need_index, k, ctx, "need")?] = *v;
                }
                Ok(out)
            };
        let day_rhythm = DayRhythm {
            wake_hour: dr.wake_hour.unwrap_or(7.0),
            bed_hour: dr.bed_hour.unwrap_or(22.5),
            sleep_tags: tag_mask(&dr.sleep_tags),
            night_decay: multipliers(&dr.night_decay, "dayRhythm")?,
            asleep_decay: multipliers(&dr.asleep_decay, "dayRhythm")?,
            work_decay: multipliers(&dr.work_decay, "dayRhythm")?,
            wake_before_work_minutes: dr.wake_before_work_minutes.unwrap_or(75.0),
        };
        let rent = raw
            .economy
            .rent
            .as_ref()
            .map(|r| {
                Ok::<_, Error>(RentRules {
                    weekday: r.weekday.min(6),
                    hour: r.hour,
                    base: r.base,
                    per_tile: r.per_tile,
                    bills_base: r.bills_base,
                    bills_rate: r.bills_rate.max(0.0),
                    debt_feeling: feeling(&r.debt_feeling, "economy.rent")?,
                })
            })
            .transpose()?;
        let or = &raw.object_rules;
        let object_rules = ObjectRules {
            max_quality: or.max_quality.unwrap_or(3),
            quality_bonus: or.quality_bonus.unwrap_or(0.25),
            upgrade_cost: or.upgrade_cost.unwrap_or(0.3),
            resale: or.resale.unwrap_or(0.5),
        };
        let build = BuildRules {
            wall: raw.build.wall.unwrap_or(40),
            door: raw.build.door.unwrap_or(150),
            window: raw.build.window.unwrap_or(120),
            remove: raw.build.remove.unwrap_or(10),
            coverings: build_styles(&raw.wall_coverings, "wall covering")?,
            doors: build_styles(&raw.door_styles, "door style")?,
            windows: build_styles(&raw.window_styles, "window style")?,
            floors: build_styles(&raw.floor_coverings, "floor covering")?,
        };
        let styles = raw
            .styles
            .iter()
            .map(|s| StyleDef {
                id: s.id.clone(),
                label: s.label.clone(),
            })
            .collect();
        let schedule = raw
            .schedule
            .iter()
            .map(|w| {
                Ok(ScheduleWindow {
                    from: w.from,
                    to: w.to,
                    mods: build_modifiers(&w.effects, &ix, "schedule")?,
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        let v = &raw.visits;
        let visits = VisitRules {
            gains: need_array(&v.needs, "visits")?,
            hours: v.hours.unwrap_or(3.0),
            directed_hours: v
                .directed_hours
                .unwrap_or(v.hours.unwrap_or(3.0) * 2.0),
            min_friendship: v.min_friendship.unwrap_or(15.0),
            earliest_hour: v.earliest_hour.unwrap_or(9.0),
            latest_hour: v.latest_hour.unwrap_or(21.0),
            tags: 1 << tag_index[VISIT_TAG],
        };

        let mut traits = Vec::with_capacity(raw.traits.len());
        for t in &raw.traits {
            traits.push(TraitDef {
                id: t.id.clone(),
                label: t.label.clone(),
                conflicts: t.conflicts.clone(),
                mods: build_modifiers(&t.effects, &ix, &t.id)?,
                starting_skills: skill_array(&t.starting_skills, &t.id)?,
            });
        }
        let trait_ids: HashSet<&str> = traits.iter().map(|t| t.id.as_str()).collect();
        if trait_ids.len() != traits.len() {
            return Err(Error::new("duplicate trait id"));
        }
        for t in &traits {
            if let Some(c) = t.conflicts.iter().find(|c| !trait_ids.contains(c.as_str())) {
                return Err(Error::new(format!(
                    "trait '{}' conflicts with unknown trait '{c}'",
                    t.id
                )));
            }
        }

        let mut perks = Vec::with_capacity(raw.perks.len());
        for p in &raw.perks {
            perks.push(PerkDef {
                id: p.id.clone(),
                label: p.label.clone(),
                cost: p.cost,
                mods: build_modifiers(&p.effects, &ix, &p.id)?,
            });
        }
        if perks
            .iter()
            .map(|p| p.id.as_str())
            .collect::<HashSet<_>>()
            .len()
            != perks.len()
        {
            return Err(Error::new("duplicate perk id"));
        }

        let genders: Vec<GenderDef> = raw
            .genders
            .iter()
            .map(|g| GenderDef {
                id: g.id.clone(),
                label: g.label.clone(),
            })
            .collect();

        let buff_feelings = feelings.iter().any(|m| m.effects.is_some());
        let talk_anim = anim_index(TALK_ANIM);
        Ok(Self {
            needs,
            objects,
            traits,
            perks,
            genders,
            tags,
            rules: raw.rules,
            emotions,
            feelings,
            socials,
            bond_presets: raw.bond_presets,
            social_rules,
            careers,
            career_rules,
            schedule,
            visits,
            starting_funds: raw.economy.starting_funds.unwrap_or(1500),
            skills,
            skill_rules,
            grades,
            career_categories,
            day_rhythm,
            rent,
            object_rules,
            build,
            styles,
            animations,
            talk_anim,
            buff_feelings,
            object_index,
        })
    }

    pub fn object_index(&self, id: &str) -> Option<usize> {
        self.object_index.get(id).copied()
    }

    pub fn feeling_index(&self, id: &str) -> Option<usize> {
        self.feelings.iter().position(|m| m.id == id)
    }

    pub fn career_index(&self, id: &str) -> Option<usize> {
        self.careers.iter().position(|c| c.id == id)
    }

    pub fn skill_index(&self, id: &str) -> Option<usize> {
        self.skills.iter().position(|s| s.id == id)
    }

    /// Starting skill levels for a Sim with these traits (highest trait value per skill).
    pub fn starting_skills(&self, traits: &[String]) -> [f32; MAX_SKILLS] {
        let mut out = [0.0f32; MAX_SKILLS];
        for t in traits
            .iter()
            .filter_map(|id| self.traits.iter().find(|d| &d.id == id))
        {
            for (o, s) in out.iter_mut().zip(t.starting_skills) {
                *o = o.max(s);
            }
        }
        out
    }

    /// Combined autonomy modifiers of every schedule window active at `hour`.
    pub fn schedule_at(&self, hour: f32) -> Modifiers {
        let mut mods = Modifiers::default();
        for w in self.schedule.iter().filter(|w| w.contains(hour)) {
            mods.combine(&w.mods);
        }
        mods
    }

    pub fn social_index(&self, id: &str) -> Option<usize> {
        self.socials.iter().position(|s| s.id == id)
    }

    /// Validates gender and attraction ids. With no genders defined, any value is accepted.
    pub fn validate_identity(&self, gender: &str, attracted_to: &[String]) -> Result<(), Error> {
        if self.genders.is_empty() {
            return Ok(());
        }
        let known = |g: &str| self.genders.iter().any(|d| d.id == g);
        if !known(gender) {
            return Err(Error::new(format!("unknown gender '{gender}'")));
        }
        if let Some(g) = attracted_to.iter().find(|g| !known(g)) {
            return Err(Error::new(format!("unknown gender '{g}' in attraction")));
        }
        Ok(())
    }

    /// Validates a character's traits and perks against the rules and returns their combined effect.
    pub fn character_modifiers(
        &self,
        traits: &[String],
        perks: &[String],
    ) -> Result<Modifiers, Error> {
        let rules = self.rules;
        if traits.len() < rules.min_traits || traits.len() > rules.max_traits {
            return Err(Error::new(format!(
                "pick {}..={} traits (got {})",
                rules.min_traits,
                rules.max_traits,
                traits.len()
            )));
        }
        let mut mods = Modifiers::default();
        for (i, id) in traits.iter().enumerate() {
            if traits[..i].contains(id) {
                return Err(Error::new(format!("trait '{id}' picked twice")));
            }
            let def = self
                .traits
                .iter()
                .find(|t| &t.id == id)
                .ok_or_else(|| Error::new(format!("unknown trait '{id}'")))?;
            if let Some(c) = def.conflicts.iter().find(|c| traits.contains(c)) {
                return Err(Error::new(format!("traits '{id}' and '{c}' conflict")));
            }
            mods.combine(&def.mods);
        }
        let mut spent = 0;
        for (i, id) in perks.iter().enumerate() {
            if perks[..i].contains(id) {
                return Err(Error::new(format!("perk '{id}' picked twice")));
            }
            let def = self
                .perks
                .iter()
                .find(|p| &p.id == id)
                .ok_or_else(|| Error::new(format!("unknown perk '{id}'")))?;
            spent += def.cost;
            mods.combine(&def.mods);
        }
        if spent > rules.perk_points {
            return Err(Error::new(format!(
                "perks cost {spent} points, budget is {}",
                rules.perk_points
            )));
        }
        Ok(mods)
    }
}

fn lookup(index: &HashMap<&str, usize>, key: &str, ctx: &str, kind: &str) -> Result<usize, Error> {
    index
        .get(key)
        .copied()
        .ok_or_else(|| Error::new(format!("{ctx}: unknown {kind} '{key}'")))
}

/// Build looks from content: ids must be unique, prices not negative, and (stored as a byte) at
/// most 250 of each.
fn build_styles(raw: &[BuildStyleRaw], what: &str) -> Result<Vec<BuildStyle>, Error> {
    if raw.len() > 250 {
        return Err(Error::new(format!("too many {what}s (at most 250)")));
    }
    let mut out: Vec<BuildStyle> = Vec::with_capacity(raw.len());
    for r in raw {
        if out.iter().any(|s| s.id == r.id) {
            return Err(Error::new(format!("duplicate {what} '{}'", r.id)));
        }
        if r.price < 0 {
            return Err(Error::new(format!(
                "{what} '{}' has a negative price",
                r.id
            )));
        }
        out.push(BuildStyle {
            id: r.id.clone(),
            price: r.price,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTENT: &str = r#"{
        "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.06,"icon":"x"},
                 {"id":"fun","label":"Fun","decayPerHour":0.06},
                 {"id":"social","label":"Social","decayPerHour":0.06}],
        "objects":[{"id":"fridge","name":"Fridge","model":"model.fridge",
          "interactions":[{"id":"snack","label":"Snack","minutes":10,"effects":{"hunger":0.3},"tags":["food"]}]},
          {"id":"tv","name":"TV","interactions":[{"id":"watch","label":"Watch","minutes":30,"effects":{"fun":0.5},"tags":["screen","fun"]}]}],
        "genders":[{"id":"female","label":"Female"},{"id":"male","label":"Male"}],
        "emotions":[{"id":"happy","label":"Happy","effects":{"tagPreference":{"friendly":1.5}}}],
        "feelings":[{"id":"goodChat","label":"Good chat","emotion":"happy","mood":0.05,"hours":2}],
        "socials":[{"id":"chat","label":"Chat","minutes":15,"tags":["social","friendly"],
          "needs":{"social":0.3},"success":{"friendship":3,"targetFriendship":3,"feeling":"goodChat"}}],
        "bondPresets":{"roommates":{"friendship":25}},
        "socialRules":{"defaultBond":"roommates","busyTags":["food","nonexistent"]},
        "traits":[
          {"id":"foodie","label":"Foodie","effects":{"tagPreference":{"food":2},"needDecay":{"hunger":1.2}}},
          {"id":"neat","label":"Neat","conflicts":["slob"]},
          {"id":"slob","label":"Slob","conflicts":["neat"]},
          {"id":"lazy","label":"Lazy","effects":{"walkSpeed":0.8,"tagAcceptance":{"friendly":0.1}}}],
        "perks":[{"id":"iron","label":"Iron stomach","cost":3,"effects":{"needDecay":{"hunger":0.5}}},
                 {"id":"fast","label":"Fast","cost":3,"effects":{"walkSpeed":1.5}}],
        "rules":{"minTraits":1,"maxTraits":2,"perkPoints":5}}"#;

    #[test]
    fn parses_and_ignores_visual_fields() {
        let c = Content::from_json(CONTENT).unwrap();
        assert_eq!(c.objects[0].interactions[0].total_gain[0], 0.3);
        assert!((c.objects[0].interactions[0].gain_per_minute[0] - 0.03).abs() < 1e-6);
        assert_eq!(c.object_index("fridge"), Some(0));
        assert_eq!(
            c.tags,
            ["food", "screen", "fun", "social", "friendly", "visit"]
        );
        assert_eq!(c.objects[1].interactions[0].tags, 0b110);
        assert_eq!(c.socials[0].success.feeling, Some(0));
        assert_eq!(c.feelings[0].emotion, Some(0));
        assert_eq!(c.social_rules.busy_tags, 1, "unknown busy tags are ignored");
        assert_eq!(c.social_rules.default_bond.unwrap().friendship, 25.0);
    }

    #[test]
    fn content_with_moodlet_keys_still_loads() {
        // Every key as written before the moodlet → feeling rename (serde aliases).
        let old = r#"{
            "needs":[{"id":"fun","label":"Fun","decayPerHour":0.06}],
            "skills":[{"id":"cooking","label":"Cooking"}],
            "objects":[{"id":"tv","name":"TV","interactions":[{"id":"watch","label":"Watch",
              "minutes":30,"effects":{"fun":0.5},"skill":"cooking","moodlet":"b","moodletMinSkill":2}]}],
            "moodlets":[{"id":"a","label":"A","mood":0.1,"hours":2},{"id":"b","label":"B","hours":1}],
            "socials":[{"id":"chat","label":"Chat","minutes":15,
              "success":{"moodlet":"a","targetMoodlet":"b","winnerMoodlet":"a","loserMoodlet":"b"}}],
            "socialRules":{"jealousyMoodlet":"a","heartbreakMoodlet":"b"},
            "careerRules":{"promotionMoodlet":"a","missedMoodlet":"b"},
            "economy":{"rent":{"base":100,"debtMoodlet":"b"}}}"#;
        let c = Content::from_json(old).unwrap();
        assert_eq!(c.feelings.len(), 2);
        let watch = &c.objects[0].interactions[0];
        assert_eq!((watch.feeling, watch.feeling_min_skill), (Some(1), 2.0));
        let s = &c.socials[0].success;
        assert_eq!(
            (
                s.feeling,
                s.target_feeling,
                s.winner_feeling,
                s.loser_feeling
            ),
            (Some(0), Some(1), Some(0), Some(1))
        );
        assert_eq!(c.social_rules.jealousy_feeling, Some(0));
        assert_eq!(c.social_rules.heartbreak_feeling, Some(1));
        assert_eq!(c.career_rules.promotion_feeling, Some(0));
        assert_eq!(c.career_rules.missed_feeling, Some(1));
        assert_eq!(c.rent.as_ref().unwrap().debt_feeling, Some(1));
    }

    #[test]
    fn rejects_unknown_references() {
        let bad_need = CONTENT.replace(r#""effects":{"hunger":0.3}"#, r#""effects":{"sleep":0.3}"#);
        assert!(
            Content::from_json(&bad_need)
                .unwrap_err()
                .0
                .contains("unknown need")
        );
        let bad_tag = CONTENT.replace(
            r#""tagPreference":{"food":2}"#,
            r#""tagPreference":{"cooking":2}"#,
        );
        assert!(
            Content::from_json(&bad_tag)
                .unwrap_err()
                .0
                .contains("unknown tag")
        );
        let bad_feeling = CONTENT.replace(r#""feeling":"goodChat""#, r#""feeling":"nope""#);
        assert!(
            Content::from_json(&bad_feeling)
                .unwrap_err()
                .0
                .contains("unknown feeling")
        );
    }

    #[test]
    fn combines_trait_and_perk_modifiers() {
        let c = Content::from_json(CONTENT).unwrap();
        let m = c
            .character_modifiers(&["foodie".into(), "lazy".into()], &["iron".into()])
            .unwrap();
        assert!((m.need_decay[0] - 0.6).abs() < 1e-6);
        assert!((m.walk_speed - 0.8).abs() < 1e-6);
        assert_eq!(m.preference(c.objects[0].interactions[0].tags), 2.0);
        assert_eq!(m.preference(c.objects[1].interactions[0].tags), 1.0);
        assert!((m.acceptance(c.socials[0].tags) - 0.1).abs() < 1e-6);
    }

    #[test]
    fn enforces_character_rules() {
        let c = Content::from_json(CONTENT).unwrap();
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(
            c.character_modifiers(&s(&[]), &s(&[])).is_err(),
            "min traits"
        );
        assert!(
            c.character_modifiers(&s(&["neat", "slob"]), &s(&[]))
                .is_err(),
            "conflict"
        );
        assert!(
            c.character_modifiers(&s(&["neat", "lazy", "foodie"]), &s(&[]))
                .is_err(),
            "max traits"
        );
        assert!(
            c.character_modifiers(&s(&["neat"]), &s(&["iron", "fast"]))
                .is_err(),
            "budget"
        );
        assert!(c.character_modifiers(&s(&["neat"]), &s(&["iron"])).is_ok());
    }

    #[test]
    fn validates_gender_and_attraction() {
        let c = Content::from_json(CONTENT).unwrap();
        assert!(c.validate_identity("female", &["male".into()]).is_ok());
        assert!(c.validate_identity("robot", &[]).is_err());
        assert!(c.validate_identity("male", &["robot".into()]).is_err());
    }
}
