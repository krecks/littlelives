//! Gameplay content (needs, objects, traits, perks, social life), loaded from JSON.
//!
//! Content files may carry visual fields (`model`, `icon`, ...). The simulation
//! ignores them; they are resolved by the asset registry on the web side.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use crate::Error;
use crate::social::{
    self, BondPreset, EmotionDef, EmotionRaw, Indices, MoodletDef, MoodletRaw, SocialDef,
    SocialRaw, SocialRules, SocialRulesRaw,
};

/// Upper bound on the number of needs, so per-Sim needs fit in a fixed array.
pub const MAX_NEEDS: usize = 8;
/// Upper bound on distinct interaction tags (stored as a bitmask).
pub const MAX_TAGS: usize = 32;
/// Built-in tag for visiting another household.
pub const VISIT_TAG: &str = "visit";

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
    /// Bitmask of indices into `Content::tags`.
    pub tags: u32,
}

#[derive(Debug)]
pub struct ObjectDef {
    pub id: String,
    pub name: String,
    /// Footprint in tiles, `[width (x), depth (z)]`, before rotation. Local +z is the front.
    pub footprint: [u8; 2],
    pub interactions: Vec<Interaction>,
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
        self.walk_speed *= other.walk_speed;
        self.mood += other.mood;
    }

    /// Combined preference for an interaction with the given tag mask.
    pub fn preference(&self, tags: u32) -> f32 {
        each_tag(tags).map(|i| self.tag_preference[i]).product()
    }

    pub fn acceptance(&self, tags: u32) -> f32 {
        each_tag(tags).map(|i| self.tag_acceptance[i]).sum()
    }

    pub fn success(&self, tags: u32) -> f32 {
        each_tag(tags).map(|i| self.tag_success[i]).sum()
    }
}

fn each_tag(mask: u32) -> impl Iterator<Item = usize> {
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
    /// Paid at the end of each shift.
    pub pay: i64,
    pub start_hour: f32,
    pub hours: f32,
    /// Bitmask of weekdays (bit 0 = Monday).
    pub days: u8,
}

#[derive(Debug)]
pub struct CareerDef {
    pub id: String,
    pub label: String,
    pub levels: Vec<CareerLevel>,
    /// Need changes over a whole shift (on top of normal decay).
    pub work_effects: [f32; MAX_NEEDS],
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
    pub promotion_moodlet: Option<usize>,
    pub missed_moodlet: Option<usize>,
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
    pub min_friendship: f32,
    pub earliest_hour: f32,
    pub latest_hour: f32,
    /// Tag mask used for schedule/trait preferences of visiting.
    pub tags: u32,
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
    pub moodlets: Vec<MoodletDef>,
    pub socials: Vec<SocialDef>,
    pub bond_presets: HashMap<String, BondPreset>,
    pub social_rules: SocialRules,
    pub careers: Vec<CareerDef>,
    pub career_rules: CareerRules,
    pub schedule: Vec<ScheduleWindow>,
    pub visits: VisitRules,
    pub starting_funds: i64,
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
    moodlets: Vec<MoodletRaw>,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CareerRaw {
    id: String,
    label: String,
    levels: Vec<CareerLevelRaw>,
    #[serde(default)]
    work_effects: HashMap<String, f32>,
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
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CareerRulesRaw {
    commute_minutes: Option<f32>,
    late_minutes: Option<f32>,
    missed_penalty: Option<f32>,
    performance_per_shift: Option<f32>,
    promotion_moodlet: Option<String>,
    missed_moodlet: Option<String>,
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
    min_friendship: Option<f32>,
    earliest_hour: Option<f32>,
    latest_hour: Option<f32>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct EconomyRaw {
    starting_funds: Option<i64>,
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
}

#[derive(Deserialize)]
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
}

#[derive(Deserialize)]
struct TraitRaw {
    id: String,
    label: String,
    #[serde(default)]
    conflicts: Vec<String>,
    #[serde(default)]
    effects: ModifiersRaw,
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

fn build_modifiers(raw: &ModifiersRaw, ix: &Indices, ctx: &str) -> Result<Modifiers, Error> {
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
    m.walk_speed = raw.walk_speed.unwrap_or(1.0);
    m.mood = raw.mood;
    Ok(m)
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
        // Built-in tag for visiting other households (schedules and traits can refer to it).
        intern(&mut tags, VISIT_TAG)?;
        let tag_index: HashMap<&str, usize> = tags
            .iter()
            .enumerate()
            .map(|(i, t)| (t.as_str(), i))
            .collect();

        let emotion_index: HashMap<String, usize> = raw
            .emotions
            .iter()
            .enumerate()
            .map(|(i, e)| (e.id.clone(), i))
            .collect();
        let moodlet_index: HashMap<String, usize> = raw
            .moodlets
            .iter()
            .enumerate()
            .map(|(i, m)| (social::moodlet_id(m).to_owned(), i))
            .collect();
        let ix = Indices {
            needs: &need_index,
            tags: &tag_index,
            emotions: &emotion_index,
            moodlets: &moodlet_index,
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
                let mut mask = 0u32;
                for t in &it.tags {
                    mask |= 1 << tag_index[t.as_str()];
                }
                interactions.push(Interaction {
                    id: it.id.clone(),
                    label: it.label.clone(),
                    minutes: it.minutes,
                    total_gain,
                    gain_per_minute: total_gain.map(|g| g / it.minutes),
                    pose: it.pose,
                    autonomous: it.autonomous,
                    tags: mask,
                });
            }
            if object_index.insert(obj.id.clone(), objects.len()).is_some() {
                return Err(Error::new(format!("duplicate object id '{}'", obj.id)));
            }
            objects.push(ObjectDef {
                id: obj.id.clone(),
                name: obj.name.clone(),
                footprint: obj.footprint,
                interactions,
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
        let moodlets = raw
            .moodlets
            .iter()
            .map(|m| social::parse_moodlet(m, &ix))
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
        let moodlet = |id: &Option<String>, ctx: &str| -> Result<Option<usize>, Error> {
            id.as_deref()
                .map(|m| {
                    moodlet_index
                        .get(m)
                        .copied()
                        .ok_or_else(|| Error::new(format!("{ctx}: unknown moodlet '{m}'")))
                })
                .transpose()
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
                    if !(0.0..24.0).contains(&l.start)
                        || l.hours <= 0.0
                        || l.hours > 16.0
                        || l.days.iter().any(|d| *d > 6)
                    {
                        return Err(Error::new(format!(
                            "career '{}': invalid shift for '{}'",
                            c.id, l.title
                        )));
                    }
                    Ok(CareerLevel {
                        title: l.title.clone(),
                        pay: l.pay,
                        start_hour: l.start,
                        hours: l.hours,
                        days: l.days.iter().fold(0u8, |m, d| m | (1 << d)),
                    })
                })
                .collect::<Result<Vec<_>, Error>>()?;
            careers.push(CareerDef {
                id: c.id.clone(),
                label: c.label.clone(),
                levels,
                work_effects: need_array(&c.work_effects, &c.id)?,
            });
        }
        let cr = &raw.career_rules;
        let career_rules = CareerRules {
            commute_minutes: cr.commute_minutes.unwrap_or(30.0),
            late_minutes: cr.late_minutes.unwrap_or(60.0),
            missed_penalty: cr.missed_penalty.unwrap_or(20.0),
            performance_per_shift: cr.performance_per_shift.unwrap_or(12.0),
            promotion_moodlet: moodlet(&cr.promotion_moodlet, "careerRules")?,
            missed_moodlet: moodlet(&cr.missed_moodlet, "careerRules")?,
        };
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

        Ok(Self {
            needs,
            objects,
            traits,
            perks,
            genders,
            tags,
            rules: raw.rules,
            emotions,
            moodlets,
            socials,
            bond_presets: raw.bond_presets,
            social_rules,
            careers,
            career_rules,
            schedule,
            visits,
            starting_funds: raw.economy.starting_funds.unwrap_or(1500),
            object_index,
        })
    }

    pub fn object_index(&self, id: &str) -> Option<usize> {
        self.object_index.get(id).copied()
    }

    pub fn moodlet_index(&self, id: &str) -> Option<usize> {
        self.moodlets.iter().position(|m| m.id == id)
    }

    pub fn career_index(&self, id: &str) -> Option<usize> {
        self.careers.iter().position(|c| c.id == id)
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
        "moodlets":[{"id":"goodChat","label":"Good chat","emotion":"happy","mood":0.05,"hours":2}],
        "socials":[{"id":"chat","label":"Chat","minutes":15,"tags":["social","friendly"],
          "needs":{"social":0.3},"success":{"friendship":3,"targetFriendship":3,"moodlet":"goodChat"}}],
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
        assert_eq!(c.socials[0].success.moodlet, Some(0));
        assert_eq!(c.moodlets[0].emotion, Some(0));
        assert_eq!(c.social_rules.busy_tags, 1, "unknown busy tags are ignored");
        assert_eq!(c.social_rules.default_bond.unwrap().friendship, 25.0);
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
        let bad_moodlet = CONTENT.replace(r#""moodlet":"goodChat""#, r#""moodlet":"nope""#);
        assert!(
            Content::from_json(&bad_moodlet)
                .unwrap_err()
                .0
                .contains("unknown moodlet")
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
