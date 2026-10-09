//! Life cycle: residents age once a day and move through life stages (content `life`; see
//! `docs/design/life-cycle.md`).

use serde::{Deserialize, Serialize};

use crate::clock;
use crate::social::{self, EventKind, Kin};
use crate::world::{GoneWhy, World};

/// How fast residents age (a per-game option): `Off` nobody does; the others scale content
/// `life.daysPerYear` (the *Normal* speed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Lifespan {
    Off,
    Short,
    #[default]
    Normal,
    Long,
}

impl Lifespan {
    /// Game days per year of age (`None`: nobody ages).
    pub fn days_per_year(self, normal: f32) -> Option<f32> {
        match self {
            Lifespan::Off => None,
            Lifespan::Short => Some(normal * 0.5),
            Lifespan::Normal => Some(normal),
            Lifespan::Long => Some(normal * 2.0),
        }
    }
}

/// A starting age for a resident nothing gave one: within content `life.startAge`, from a hash
/// of their name and slot (not the world's random numbers, so adding ages changed no run).
pub fn default_age(rules: &crate::content::LifeRules, name: &str, slot: usize) -> f32 {
    let mut h: u32 = 2_166_136_261 ^ slot as u32;
    for b in name.bytes() {
        h = (h ^ b as u32).wrapping_mul(16_777_619);
    }
    let [lo, hi] = rules.start_age;
    (lo + (h % 1000) as f32 / 1000.0 * (hi - lo)).floor()
}

/// Once a day at midnight: everyone a year-fraction older; a new life stage is a story event
/// and a feeling, and changes what the stage does to them.
pub(crate) fn update(w: &mut World) {
    let Some(days_per_year) = w.lifespan.days_per_year(w.content.life.days_per_year) else { return };
    let day = clock::day(w.tick);
    if clock::tick_at(day, 0.0) != Some(w.tick) {
        return;
    }
    for i in 0..w.sims.len() {
        if !w.sims[i].here() {
            continue;
        }
        let rules = &w.content.life;
        let sim = &mut w.sims[i];
        let before = rules.stage(sim.age);
        sim.age += 1.0 / days_per_year;
        let stage = rules.stage(sim.age);
        if stage == before || rules.stages.is_empty() {
            continue;
        }
        if let Some(f) = rules.stages[stage].feeling {
            social::add_feeling(&mut sim.feelings, f, &w.content.feelings, w.tick);
        }
        w.refresh_base_mods(i);
        w.structure_version += 1;
        w.events.push_detail(w.tick, EventKind::GrewOlder, i, Some(stage as i64), None);
    }
    for i in 0..w.sims.len() {
        if w.sims[i].here() {
            retire_if_due(w, i);
        }
    }
    for i in 0..w.sims.len() {
        let Some(death) = w.content.life.death else { break };
        if !w.sims[i].here() || w.sims[i].age < death.from {
            continue;
        }
        // A day's share of the year's chance.
        let chance = 1.0 - (1.0 - death.yearly_chance(w.sims[i].age)).powf(1.0 / days_per_year);
        if w.rng.next_f32() < chance {
            pass_away(w, i);
        }
    }
}

/// At the retirement age a working resident retires: a weekly pension for the household.
fn retire_if_due(w: &mut World, i: usize) {
    let rules = &w.content.life;
    let Some(at) = rules.retire_at else { return };
    let sim = &w.sims[i];
    if sim.retired || sim.age < at {
        return;
    }
    let Some(job) = sim.job.as_ref() else { return };
    let level = &w.content.careers[job.career].levels[job.level];
    let weekly = level.pay * i64::from(level.days.count_ones());
    let (career, grade) = (job.career, job.level);
    let feeling = rules.retire_feeling;
    let pension = (weekly as f32 * rules.pension).round() as i64;
    let sim = &mut w.sims[i];
    sim.retired = true;
    sim.pension = pension;
    sim.job = None;
    if let Some(f) = feeling {
        social::add_feeling(&mut sim.feelings, f, &w.content.feelings, w.tick);
    }
    w.events.push_career(w.tick, EventKind::Retired, i, career, Some(grade as i64));
}

/// Old age: the story tells it, family, partners and friends grieve, and they're gone.
pub fn pass_away(w: &mut World, i: usize) {
    let grief = w.content.life.grief;
    for j in 0..w.sims.len() {
        if j == i || !w.sims[j].here() {
            continue;
        }
        let r = *w.relationships.get(j, i);
        let feeling = if r.kin != Kin::None || r.partners || r.friendship >= grief.close {
            grief.feeling
        } else if r.friendship >= grief.friend {
            grief.light_feeling
        } else {
            None
        };
        if let Some(f) = feeling {
            social::add_feeling(&mut w.sims[j].feelings, f, &w.content.feelings, w.tick);
        }
    }
    w.events.push_detail(w.tick, EventKind::Died, i, None, None);
    w.depart(i, GoneWhy::Died);
}
