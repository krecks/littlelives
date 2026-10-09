//! Life cycle: residents age once a day and move through life stages (content `life`; see
//! `docs/design/life-cycle.md`).

use serde::{Deserialize, Serialize};

use crate::clock;
use crate::social::{self, EventKind, Kin};
use crate::world::{GoneWhy, Household, World};

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
    if let Some(rules) = w.content.life.moving
        && clock::tick_at(clock::day(w.tick), rules.hour * 60.0) == Some(w.tick)
        && w.autonomy
    {
        moving(w, &rules);
    }
    if let Some(rules) = w.content.life.newcomers
        && clock::tick_at(clock::day(w.tick), rules.hour * 60.0) == Some(w.tick)
        && w.autonomy
    {
        newcomers(w, &rules);
    }
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

// ---- Moving --------------------------------------------------------------------------------

/// Residents of household `h` who are here.
fn members(w: &World, h: usize) -> Vec<usize> {
    (0..w.sims.len()).filter(|&i| w.sims[i].here() && w.sims[i].household as usize == h).collect()
}

/// Beds (sleeping places) in the home on `plot`, broken ones too (whoever lives there fixes
/// them; a house whose only bed broke while empty would otherwise never be lived in again).
fn beds(w: &World, plot: u32) -> usize {
    let sleep = w.content.day_rhythm.sleep_tags;
    w.objects
        .iter()
        .zip(&w.object_plot)
        .filter(|(_, p)| **p == Some(plot))
        .filter(|(o, _)| w.content.objects[o.def].interactions.iter().any(|it| it.tags & sleep != 0))
        .map(|(o, _)| usize::from(w.content.objects[o.def].slots))
        .sum()
}

/// Whether household `h`'s home has a bed and room for `more` residents.
fn has_room(w: &World, h: usize, more: usize) -> bool {
    let Some(plot) = w.households[h].plot else { return false };
    let n = members(w, h).len() + more;
    n <= w.content.rules.max_household && beds(w, plot) >= n
}

/// Whether a resident's household lets them move on their own (the player can say no). Being
/// at work or out doesn't matter: they come back to the new home.
fn may_move(w: &World, i: usize) -> bool {
    let s = &w.sims[i];
    s.here() && s.adult(&w.content) && (w.player_moves || !w.households[s.household as usize].player)
}

/// A house nobody lives in (not a park, not the player's home), with beds for `n`.
fn vacant_plot(w: &World, n: usize) -> Option<u32> {
    w.plots
        .iter()
        .filter(|p| !p.public)
        .filter(|p| {
            !w.households.iter().enumerate().any(|(h, hh)| hh.plot == Some(p.id) && (hh.player || !members(w, h).is_empty()))
        })
        .find(|p| beds(w, p.id) >= n)
        .map(|p| p.id)
}

/// A household for the house on `plot`: the empty one already there, else a new one.
fn household_for(w: &mut World, plot: u32, name: &str, style: u8) -> usize {
    if let Some(h) = w.households.iter().position(|hh| hh.plot == Some(plot)) {
        let hh = &mut w.households[h];
        hh.name = name.to_string();
        hh.funds = 0;
        hh.routines.clear();
        return h;
    }
    let id = w.households.len() as u32;
    w.households.push(Household {
        id,
        name: name.to_string(),
        plot: Some(plot),
        player: false,
        funds: 0,
        style,
        free_will: true,
        routines: Vec::new(),
    });
    id as usize
}

/// Moves resident `i` into household `to`, with their share of their old household's money.
fn move_to(w: &mut World, i: usize, to: usize) {
    let from = w.sims[i].household as usize;
    if from == to {
        return;
    }
    let share = w.households[from].funds.max(0) / members(w, from).len().max(1) as i64;
    w.households[from].funds -= share;
    w.households[to].funds += share;
    let id = i as u32;
    for o in &mut w.objects {
        o.release(id);
    }
    let arrive = w.households[to].plot.map(|p| w.plots[p as usize].arrival_point());
    let sim = &mut w.sims[i];
    sim.household = to as u32;
    sim.clear_activity();
    sim.planner.run = None;
    // At work they come back to the new home; otherwise they're there now.
    if let Some(pos) = arrive.filter(|_| sim.away_until.is_none()) {
        sim.pos = pos;
    }
    w.structure_version += 1;
}

/// Partners move in together; grown children move out (or away).
fn moving(w: &mut World, rules: &crate::content::MovingRules) {
    let tick = w.tick;
    let n = w.sims.len();
    // Partners in different homes.
    for a in 0..n {
        for b in a + 1..n {
            let (ra, rb) = (*w.relationships.get(a, b), *w.relationships.get(b, a));
            if !ra.partners || !may_move(w, a) || !may_move(w, b) || w.sims[a].household == w.sims[b].household {
                continue;
            }
            if ra.romance.min(rb.romance) < rules.romance || w.rng.next_f32() >= rules.partners {
                continue;
            }
            let (ha, hb) = (w.sims[a].household as usize, w.sims[b].household as usize);
            let into_b = has_room(w, hb, 1);
            let into_a = has_room(w, ha, 1);
            // The player's home first, else the one from the fuller home moves.
            let mover = match (into_a, into_b) {
                (true, true) if w.households[ha].player => Some(b),
                (true, true) if w.households[hb].player => Some(a),
                (true, true) => Some(if members(w, ha).len() >= members(w, hb).len() { a } else { b }),
                (true, false) => Some(b),
                (false, true) => Some(a),
                (false, false) => None,
            };
            if let Some(m) = mover {
                let partner = if m == a { b } else { a };
                let to = w.sims[partner].household as usize;
                move_to(w, m, to);
                w.events.push(tick, EventKind::MovedInWith, m, partner, None);
            } else if let Some(plot) = vacant_plot(w, 2) {
                let name = w.households[ha].name.clone();
                let style = w.households[ha].style;
                let h = household_for(w, plot, &name, style);
                move_to(w, a, h);
                move_to(w, b, h);
                w.events.push(tick, EventKind::MovedInWith, a, b, None);
            }
        }
    }
    // Grown children living with a parent.
    for i in 0..n {
        let (age, h, working) = {
            let s = &w.sims[i];
            (s.age, s.household as usize, s.job.is_some() || s.retired)
        };
        if !may_move(w, i) || age < rules.leave_home_age || !working {
            continue;
        }
        let with_parent = (0..n).any(|j| w.sims[j].here() && w.sims[j].household as usize == h && w.relationships.kin(i, j) == Kin::Parent);
        if !with_parent || w.rng.next_f32() >= rules.leave_home {
            continue;
        }
        let partner = (0..n).find(|&j| w.sims[j].here() && w.sims[j].household as usize == h && w.relationships.get(i, j).partners);
        let going = 1 + usize::from(partner.is_some());
        if let Some(plot) = vacant_plot(w, going) {
            let name = w.households[h].name.clone();
            let style = w.households[h].style;
            let new = household_for(w, plot, &name, style);
            move_to(w, i, new);
            if let Some(p) = partner {
                move_to(w, p, new);
            }
            w.events.push_detail(tick, EventKind::MovedOut, i, None, None);
        } else if age >= rules.leave_town_age && !w.households[h].player && w.rng.next_f32() < rules.leave_town {
            w.events.push_detail(tick, EventKind::MovedAway, i, None, None);
            w.depart(i, GoneWhy::MovedAway);
            if let Some(p) = partner {
                w.events.push_detail(tick, EventKind::MovedAway, p, None, None);
                w.depart(p, GoneWhy::MovedAway);
            }
        }
    }
}

// ---- Newcomers -----------------------------------------------------------------------------

/// Vacant houses (furnished, nobody living there, not the player's) get a new household now
/// and then.
fn newcomers(w: &mut World, rules: &crate::content::NewcomerRules) {
    for p in 0..w.plots.len() as u32 {
        if w.plots[p as usize].public
            || beds(w, p) == 0
            || w.households.iter().enumerate().any(|(h, hh)| hh.plot == Some(p) && (hh.player || !members(w, h).is_empty()))
        {
            continue;
        }
        if w.rng.next_f32() < 1.0 / rules.days {
            arrive(w, p);
        }
    }
}

fn pick<'a, T>(rng: &mut crate::rng::Rng, list: &'a [T]) -> Option<&'a T> {
    (!list.is_empty()).then(|| &list[(rng.next_u32() as usize) % list.len()])
}

/// A new household moves into the house on `plot`: a single, a couple (sometimes with a grown
/// child) or two siblings, sized to its beds, with names, traits, perks and ages from content
/// and an appearance seed (`{"seed": n}`, expanded into a look by the web).
pub fn arrive(w: &mut World, plot: u32) -> bool {
    let content = &w.content;
    let most = beds(w, plot).min(content.rules.max_household).max(1);
    let here = w.sims.iter().filter(|s| s.here()).count();
    if here >= crate::world::MAX_SIMS || content.genders.is_empty() {
        return false;
    }
    let size = (1 + (w.rng.next_u32() as usize) % most).min(crate::world::MAX_SIMS - here);
    let couple = size >= 2 && w.rng.next_f32() < 0.6;
    let adult = content.life.stages.first().map_or(18.0, |s| s.from);
    let [lo, hi] = content.life.start_age;
    let mut spawns = Vec::new();
    let mut bonds = Vec::new();
    let mut taken: Vec<String> = Vec::new();
    let surname = pick(&mut w.rng, &content.names.last).cloned().unwrap_or_else(|| "Newcomer".into());
    let at = w.plots[plot as usize].arrival_point();
    for k in 0..size {
        let content = &w.content;
        let gender = pick(&mut w.rng, &content.genders).map(|g| g.id.clone()).unwrap_or_default();
        let firsts = content.names.by_gender.get(&gender).filter(|l| !l.is_empty()).unwrap_or(&content.names.first);
        let free: Vec<&String> = firsts.iter().filter(|n| !taken.contains(n)).collect();
        let name = pick(&mut w.rng, &free).map(|n| (*n).clone()).unwrap_or_else(|| format!("Newcomer {}", k + 1));
        taken.push(name.clone());
        // Partners close in age; a grown child twenty to thirty years younger.
        let age = match k {
            0 => lo + w.rng.next_f32() * (hi - lo),
            1 if couple => spawns_age(&spawns, 0) + w.rng.range(-4.0, 4.0),
            2 if couple => (spawns_age(&spawns, 0).min(spawns_age(&spawns, 1)) - w.rng.range(20.0, 30.0)).max(adult),
            _ => spawns_age(&spawns, 0) + w.rng.range(-6.0, 6.0),
        }
        .max(adult)
        .floor();
        let attracted: Vec<String> = if couple && k < 2 {
            // The couple are attracted to each other (the second is picked to fit below).
            content.genders.iter().map(|g| g.id.clone()).collect()
        } else {
            content.genders.iter().filter(|g| g.id != gender || w.rng.next_f32() < 0.15).map(|g| g.id.clone()).collect()
        };
        let (traits, perks) = random_character(w);
        let seed = w.rng.next_u32();
        spawns.push(serde_json::json!({
            "name": name, "gender": gender, "attractedTo": attracted, "traits": traits, "perks": perks,
            "age": age, "appearance": {"seed": seed}, "x": at[0], "z": at[1],
        }));
    }
    if couple {
        bonds.push((0, 1, "partners"));
        if size >= 3 {
            bonds.push((2, 0, "parent"));
            bonds.push((2, 1, "parent"));
        }
    } else if size >= 2 && w.rng.next_f32() < 0.4 {
        bonds.push((0, 1, "siblings"));
    }
    let style = (w.rng.next_u32() as usize % w.content.styles.len().max(1)) as u8;
    let h = household_for(w, plot, &surname, style);
    w.households[h].funds = w.content.starting_funds;
    w.households[h].free_will = true;
    let mut ids = Vec::new();
    for (k, spawn) in spawns.into_iter().enumerate() {
        let mut spawn: crate::lot::SimSpawn = match serde_json::from_value(spawn) {
            Ok(s) => s,
            Err(_) => return false,
        };
        spawn.household = h as u32;
        spawn.x += (k as f32 - 1.0) * 0.6;
        match w.spawn_at(&spawn, true) {
            Ok(id) => ids.push(id as usize),
            Err(_) => return false,
        }
    }
    let bonds: Vec<crate::lot::BondRaw> = bonds
        .into_iter()
        .filter(|(_, _, preset)| w.content.bond_presets.contains_key(*preset))
        .map(|(a, b, preset)| crate::lot::BondRaw { a: ids[a], b: ids[b], preset: preset.into() })
        .collect();
    if w.init_relationships_for(&ids, &bonds).is_err() {
        return false;
    }
    w.structure_version += 1;
    w.events.push_detail(w.tick, EventKind::MovedIn, ids[0], None, None);
    true
}

fn spawns_age(spawns: &[serde_json::Value], k: usize) -> f32 {
    spawns.get(k).and_then(|s| s["age"].as_f64()).unwrap_or(30.0) as f32
}

/// Traits (no two that clash) and perks within the points, at random.
fn random_character(w: &mut World) -> (Vec<String>, Vec<String>) {
    let rules = w.content.rules;
    let span = rules.max_traits.saturating_sub(rules.min_traits) + 1;
    let target = rules.min_traits + (w.rng.next_u32() as usize) % span;
    let mut order: Vec<usize> = (0..w.content.traits.len()).collect();
    for i in (1..order.len()).rev() {
        order.swap(i, (w.rng.next_u32() as usize) % (i + 1));
    }
    let mut traits: Vec<String> = Vec::new();
    for t in order {
        if traits.len() >= target {
            break;
        }
        let def = &w.content.traits[t];
        let clash = traits.iter().any(|x| def.conflicts.contains(x))
            || w.content.traits.iter().any(|d| traits.contains(&d.id) && d.conflicts.contains(&def.id));
        if !clash {
            traits.push(def.id.clone());
        }
    }
    let mut perks = Vec::new();
    let mut points = 0;
    for p in 0..w.content.perks.len() {
        let def = &w.content.perks[p];
        if points + def.cost <= rules.perk_points && w.rng.next_f32() < 0.4 {
            points += def.cost;
            perks.push(def.id.clone());
        }
    }
    (traits, perks)
}
