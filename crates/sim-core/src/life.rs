//! Daily life: work shifts, pay and promotions, rent and bills, interaction costs, and households
//! visiting each other.
//!
//! Runs as a world-level phase after Sims and conversations each tick, so it can
//! move Sims between "at home", "travelling" and "away at work", pay households,
//! and record story events.

use serde::{Deserialize, Serialize};

use crate::MINUTES_PER_TICK;
use crate::clock;
use crate::content::{CareerLevel, Content, MAX_NEEDS, MAX_SKILLS, WorkweekRule};
use crate::social::{self, EventKind};
use crate::world::{GameMode, Task, TaskKind, World, end_activity, practise};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub career: usize,
    pub level: usize,
    /// 0..100; a full bar earns a promotion (once the skills are there too).
    pub performance: f32,
    /// Last day a shift was worked or missed (so each day counts once).
    pub last_shift_day: u32,
    /// Mood when leaving for the current shift.
    pub shift_mood: f32,
    /// How happy the Sim is in this job: a running average of the mood they leave for work in.
    pub satisfaction: f32,
    /// Shifts worked in this job.
    pub shifts: u32,
    /// Recent missed shifts (one worked shift makes up for one missed); too many and they're let go.
    pub missed: u8,
}

impl Job {
    /// A new job; starting today doesn't count, so the first shift is tomorrow's.
    pub fn new(career: usize, level: usize, today: u32) -> Self {
        Self {
            career,
            level,
            performance: 0.0,
            last_shift_day: today,
            shift_mood: 0.5,
            satisfaction: 0.6,
            shifts: 0,
            missed: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Visit {
    pub plot: u32,
    /// Guests head home after this tick.
    pub until: u64,
}

/// A change in where a Sim is (or what it finished), raised by tasks and handled by `life::update`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Transition {
    /// Reached the town exit: the shift starts.
    Work,
    /// Set off to visit a plot (guest status starts now, so an interrupted trip still ends at home).
    /// Visits the player asked for last longer.
    Visit { plot: u32, directed: bool },
    /// Reached home.
    Home,
}

/// Skill levels above (+) or below (-) what a job level asks for; the weakest skill counts.
pub fn skill_fit(level: &CareerLevel, skills: &[f32; MAX_SKILLS]) -> f32 {
    level
        .requires
        .iter()
        .map(|&(s, need)| skills[s].floor() - need)
        .fold(None, |m: Option<f32>, f| Some(m.map_or(f, |m| m.min(f))))
        .unwrap_or(0.0)
}

/// The workweek rule for a fit (probation, standard, flexible...).
pub fn workweek_rule(content: &Content, fit: f32) -> Option<&WorkweekRule> {
    content
        .career_rules
        .workweek
        .iter()
        .rev()
        .find(|r| r.fit <= fit)
}

/// Adds days after the last workday, or drops days from the end of the week (at least one stays).
pub fn adjust_days(days: u8, delta: i8) -> u8 {
    let mut days = days & 0x7f;
    if delta > 0 {
        for _ in 0..delta {
            let last = (0..7).rev().find(|d| days & (1 << d) != 0).unwrap_or(0);
            if let Some(d) = (1..7)
                .map(|k| (last + k) % 7)
                .find(|d| days & (1 << d) == 0)
            {
                days |= 1 << d;
            }
        }
    } else {
        for _ in 0..-delta {
            if days.count_ones() <= 1 {
                break;
            }
            let last = (0..7).rev().find(|d| days & (1 << d) != 0).unwrap_or(0);
            days &= !(1 << last);
        }
    }
    days
}

/// This Sim's workdays for its job: the standard week, shortened or lengthened by skill.
pub fn work_days(content: &Content, job: &Job, skills: &[f32; MAX_SKILLS]) -> u8 {
    let level = &content.careers[job.career].levels[job.level];
    let delta = workweek_rule(content, skill_fit(level, skills)).map_or(0, |r| r.days);
    adjust_days(level.days, delta)
}

/// Pay for one shift. The weekly salary is fixed, so a shorter week pays more per shift.
pub fn shift_pay(content: &Content, job: &Job, skills: &[f32; MAX_SKILLS]) -> i64 {
    let level = &content.careers[job.career].levels[job.level];
    let standard = level.days.count_ones().max(1) as i64;
    let actual = work_days(content, job, skills).count_ones().max(1) as i64;
    (level.pay * standard + actual / 2) / actual
}

/// Whether a Sim with `skills` may take `level` (probation allows a small shortfall).
pub fn can_join(content: &Content, level: &CareerLevel, skills: &[f32; MAX_SKILLS]) -> bool {
    skill_fit(level, skills) >= -content.career_rules.probation_levels
}

/// Today's shift for a job as `(leave, start, end)` ticks, if today is a workday.
pub fn shift_today(
    content: &Content,
    job: &Job,
    skills: &[f32; MAX_SKILLS],
    tick: u64,
) -> Option<(u64, u64, u64)> {
    let level = &content.careers[job.career].levels[job.level];
    let day = clock::day(tick);
    if work_days(content, job, skills) & (1 << clock::weekday(day)) == 0 {
        return None;
    }
    let start = clock::tick_at(day, level.start_hour * 60.0)?;
    let leave = start.saturating_sub(ticks(content.career_rules.commute_minutes));
    Some((leave, start, start + ticks(level.hours * 60.0)))
}

fn ticks(minutes: f32) -> u64 {
    (minutes / MINUTES_PER_TICK) as u64
}

pub(crate) fn update(w: &mut World) {
    let tick = w.tick;
    let day = clock::day(tick);
    let hour = clock::hour(tick);
    for i in 0..w.sims.len() {
        if !w.sims[i].here() {
            continue;
        }
        // Interactions started this tick are paid from the Sim's own household (guests too).
        let spend = std::mem::take(&mut w.sims[i].pending_spend);
        w.households[w.sims[i].household as usize].funds -= spend;
        if let Some(transition) = w.sims[i].transition.take() {
            apply_transition(w, i, transition);
        }
        if w.sims[i].away_until.is_some() {
            at_work(w, i);
        } else {
            schedule_work(w, i, day);
            end_visit_if_due(w, i, hour);
        }
        report_skill_ups(w, i);
    }
    charge_rent(w, day);
    job_market(w, day);
}

/// Once a day: unemployed residents with free will look for work, and residents who have been
/// unhappy at work for a while may quit.
fn job_market(w: &mut World, day: u32) {
    let Some(market) = w.content.career_rules.market.clone() else {
        return;
    };
    if clock::tick_at(day, market.hour * 60.0) != Some(w.tick) || !w.autonomy {
        return;
    }
    let tick = w.tick;
    for i in 0..w.sims.len() {
        let h = w.sims[i].household as usize;
        if !w.households[h].free_will || w.sims[i].away_until.is_some() || !w.sims[i].here() || w.sims[i].retired {
            continue;
        }
        if let Some(job) = &w.sims[i].job {
            let unhappy = job.shifts >= market.min_shifts_before_quit
                && job.satisfaction < market.quit_below;
            if unhappy && w.rng.next_f32() < market.quit_chance {
                let (career, level) = (job.career, job.level);
                let sim = &mut w.sims[i];
                sim.job = None;
                sim.job_search_from = day + market.cooldown_days;
                if let Some(m) = market.quit_feeling {
                    social::add_feeling(&mut sim.feelings, m, &w.content.feelings, tick);
                }
                w.events
                    .push_career(tick, EventKind::QuitJob, i, career, Some(level as i64));
            }
            continue;
        }
        if day < w.sims[i].job_search_from {
            continue;
        }
        // Short on money, or set on finding work (a goal): look harder.
        let funds = w.households[h].funds;
        let weekly = weekly_costs(w, h).map_or(0, |(rent, bills)| rent + bills);
        let (keen, category) = crate::planner::job_search(&w.content, &w.sims[i]);
        let chance = market.daily_chance * keen * if funds < weekly * 2 { 2.0 } else { 1.0 };
        if w.rng.next_f32() >= chance {
            continue;
        }
        let Some((career, level)) = find_job(w, i, category).or_else(|| find_job(w, i, None)) else {
            continue;
        };
        let sim = &mut w.sims[i];
        sim.job = Some(Job::new(career, level, day));
        if let Some(m) = market.hired_feeling {
            social::add_feeling(&mut sim.feelings, m, &w.content.feelings, tick);
        }
        w.events
            .push_career(tick, EventKind::JobFound, i, career, Some(level as i64));
    }
}

/// A job Sim `i` could get (in `category`, if set): for each career the best level they're
/// qualified for (the entry level on probation otherwise), weighed by pay with some chance.
fn find_job(w: &mut World, i: usize, category: Option<usize>) -> Option<(usize, usize)> {
    let World {
        content, sims, rng, ..
    } = w;
    let skills = &sims[i].skills;
    let mut candidates: Vec<(f32, (usize, usize))> = Vec::new();
    for (c, career) in content.careers.iter().enumerate() {
        if category.is_some_and(|cat| career.category != Some(cat)) {
            continue;
        }
        let level = career
            .levels
            .iter()
            .rposition(|l| skill_fit(l, skills) >= 0.0)
            .or_else(|| can_join(content, &career.levels[0], skills).then_some(0));
        let Some(level) = level else { continue };
        let def = &career.levels[level];
        let weekly_pay = (def.pay * def.days.count_ones() as i64).max(1) as f32;
        let score = weekly_pay.sqrt() * rng.range(0.5, 1.5);
        candidates.push((score, (c, level)));
    }
    crate::ai::choose(&mut candidates, rng.next_f32(), 3)
}

/// Leave for work when it's time; count a shift as missed if the Sim never left.
fn schedule_work(w: &mut World, i: usize, day: u32) {
    let World {
        content,
        sims,
        objects,
        events,
        tick,
        ..
    } = w;
    let tick = *tick;
    let sim = &mut sims[i];
    let Some(job) = sim.job.as_mut() else { return };
    if job.last_shift_day == day {
        return;
    }
    let Some((leave, start, _)) = shift_today(content, job, &sim.skills, tick) else {
        return;
    };
    let late = start + ticks(content.career_rules.late_minutes);
    if tick > late {
        job.last_shift_day = day;
        job.performance = (job.performance - content.career_rules.missed_penalty).max(0.0);
        job.missed = job.missed.saturating_add(1);
        if let Some(m) = content.career_rules.missed_feeling {
            social::add_feeling(&mut sim.feelings, m, &content.feelings, tick);
        }
        events.push(tick, EventKind::MissedWork, i, i, None);
        if let Some(market) = &content.career_rules.market
            && job.missed >= market.fire_after_missed
        {
            let (career, level) = (job.career, job.level);
            sim.job = None;
            sim.job_search_from = day + market.cooldown_days;
            if let Some(m) = market.fired_feeling {
                social::add_feeling(&mut sim.feelings, m, &content.feelings, tick);
            }
            events.push_career(tick, EventKind::Fired, i, career, Some(level as i64));
        }
        return;
    }
    if tick < leave {
        return;
    }
    let heading_out = matches!(
        sim.current.as_ref().map(|a| a.task.kind),
        Some(TaskKind::Work)
    ) || matches!(sim.queue.front().map(|t| t.kind), Some(TaskKind::Work));
    if !heading_out {
        // Work comes first: drop what they're doing and go.
        end_activity(sim, content, objects);
        sim.engaged_with = None;
        sim.queue.push_front(Task {
            kind: TaskKind::Work,
            directed: true,
        });
    }
}

fn apply_transition(w: &mut World, i: usize, transition: Transition) {
    let tick = w.tick;
    match transition {
        Transition::Work => {
            let content = &w.content;
            let mood = w.sims[i].mood(content);
            let sim = &mut w.sims[i];
            let skills = sim.skills;
            let Some(job) = sim.job.as_mut() else { return };
            let Some((_, start, end)) = shift_today(content, job, &skills, tick) else {
                return;
            };
            job.last_shift_day = clock::day(tick);
            job.shift_mood = mood;
            // Early arrivals still work until the shift's end; late ones lose that time.
            sim.away_until = Some(end.max(start).max(tick + 1));
            sim.queue.clear();
        }
        Transition::Visit { plot, directed } => {
            let visits = &w.content.visits;
            let hours = if directed {
                visits.directed_hours
            } else {
                visits.hours
            };
            let until = tick + ticks(hours * 60.0);
            w.sims[i].visiting = Some(Visit { plot, until });
            // Tell the story if the hosts are home.
            let host = w
                .households
                .iter()
                .find(|h| h.plot == Some(plot))
                .map(|h| h.id);
            if let Some(host) = host
                && let Some(j) = w.sims.iter().position(|s| {
                    s.here() && s.household == host && w.plot_at(s.tile().0, s.tile().1) == Some(plot)
                })
            {
                w.events.push(tick, EventKind::Visited, i, j, None);
            }
        }
        Transition::Home => w.sims[i].visiting = None,
    }
}

/// Off the map at work: needs change and skills grow, then come home with pay and maybe a promotion.
fn at_work(w: &mut World, i: usize) {
    let tick = w.tick;
    let World {
        content,
        sims,
        households,
        events,
        ..
    } = w;
    let sim = &mut sims[i];
    let Some(job) = sim.job.clone() else {
        sim.away_until = None;
        return;
    };
    let career = &content.careers[job.career];
    let level = &career.levels[job.level];
    let per_tick = MINUTES_PER_TICK / (level.hours * 60.0);
    for n in 0..MAX_NEEDS.min(content.needs.len()) {
        sim.needs[n] = (sim.needs[n] + career.work_effects[n] * per_tick).clamp(0.0, 1.0);
    }
    for &(skill, weight) in &career.skills {
        practise(
            sim,
            content,
            skill,
            content.skill_rules.work_gain_per_hour * weight,
        );
    }
    if sim.away_until.is_some_and(|until| tick < until) {
        return;
    }
    sim.away_until = None;
    households[sim.household as usize].funds += shift_pay(content, &job, &sim.skills);
    let rules = &content.career_rules;
    let fit = skill_fit(level, &sim.skills).clamp(-3.0, 3.0);
    let job = sim.job.as_mut().expect("checked above");
    job.shifts += 1;
    job.missed = job.missed.saturating_sub(1);
    job.satisfaction = job.satisfaction * 0.8 + job.shift_mood * 0.2;
    job.performance = (job.performance
        + rules.performance_per_shift
        + (job.shift_mood - 0.5) * 2.0 * rules.performance_per_mood
        + fit * rules.performance_per_fit)
        .clamp(0.0, 100.0);
    // A promotion needs a full bar and the skills for the next level.
    if job.performance >= 100.0
        && let Some(next) = career.levels.get(job.level + 1)
        && skill_fit(next, &sim.skills) >= 0.0
    {
        job.level += 1;
        job.performance = 0.0;
        if let Some(m) = rules.promotion_feeling {
            social::add_feeling(&mut sim.feelings, m, &content.feelings, tick);
        }
        events.push(tick, EventKind::Promoted, i, i, None);
    }
    sim.queue.push_back(Task {
        kind: TaskKind::GoHome,
        directed: false,
    });
}

/// Story events for new skill levels (the player's household only: across a whole town they
/// would crowd out everything else).
fn report_skill_ups(w: &mut World, i: usize) {
    let sim = &mut w.sims[i];
    let mut ups = std::mem::take(&mut sim.skill_ups);
    if ups == 0 || !w.households[sim.household as usize].player {
        return;
    }
    while ups != 0 {
        let s = ups.trailing_zeros() as usize;
        ups &= ups - 1;
        let level = sim.skills[s].floor() as i64;
        w.events
            .push_detail(w.tick, EventKind::SkillUp, i, Some(level), Some(s));
    }
}

/// What household `h` pays each week: `(rent, bills)`, or `None` if it has no home or
/// nothing is charged (nobody lives there yet, or it's the player's home in a Creative game). Bills grow with the value of
/// everything the household owns and with how many live there.
pub fn weekly_costs(w: &World, h: usize) -> Option<(i64, i64)> {
    let rent = w.content.rent.as_ref()?;
    let household = w.households.get(h)?;
    if household.player && w.mode == GameMode::Creative {
        return None;
    }
    let plot = household.plot?;
    let p = &w.plots[plot as usize];
    let home_value: i64 = w
        .objects
        .iter()
        .zip(&w.object_plot)
        .filter(|(_, on)| **on == Some(plot))
        .map(|(o, _)| o.value)
        .sum();
    let residents = w.sims.iter().filter(|s| s.here() && s.household as usize == h).count();
    if residents == 0 {
        return None;
    }
    Some((rent.amount(p.w * p.d), rent.bills(home_value, residents)))
}

/// Weekly rent and bills; households that can't cover them go into debt and worry about it
/// every day.
fn charge_rent(w: &mut World, day: u32) {
    let Some(rent) = w.content.rent.clone() else {
        return;
    };
    if clock::tick_at(day, rent.hour * 60.0) != Some(w.tick) {
        return;
    }
    let tick = w.tick;
    let due = clock::weekday(day) == rent.weekday;
    for h in 0..w.households.len() {
        let Some(member) = w.sims.iter().position(|s| s.here() && s.household as usize == h) else {
            continue;
        };
        if due {
            // Pensions come in on the same day.
            let pensions: i64 = w.sims.iter().filter(|s| s.here() && s.household as usize == h).map(|s| s.pension).sum();
            w.households[h].funds += pensions;
        }
        if due && let Some((rent, bills)) = weekly_costs(w, h) {
            let amount = rent + bills;
            let household = &mut w.households[h];
            let kind = if household.funds >= amount {
                EventKind::PaidRent
            } else {
                EventKind::RentDebt
            };
            household.funds -= amount;
            // Everyone's debts are news; paying on time only for the player's household.
            if household.player || kind == EventKind::RentDebt {
                w.events.push_detail(tick, kind, member, Some(amount), None);
            }
        }
        if w.households[h].funds < 0
            && let Some(m) = rent.debt_feeling
        {
            let World { sims, content, .. } = &mut *w;
            for s in sims.iter_mut().filter(|s| s.here() && s.household as usize == h) {
                social::add_feeling(&mut s.feelings, m, &content.feelings, tick);
            }
        }
    }
}

/// Guests go home when the visit is over, it's late, or they need something.
fn end_visit_if_due(w: &mut World, i: usize, hour: f32) {
    let tick = w.tick;
    let content = &w.content;
    let sim = &mut w.sims[i];
    let Some(visit) = sim.visiting else { return };
    let tired = content.needs.iter().zip(&sim.needs).any(|(d, &n)| !d.room && n < 0.15);
    let late = !(6.0..22.0).contains(&hour);
    let busy = sim
        .current
        .as_ref()
        .is_some_and(|a| matches!(a.task.kind, TaskKind::GoHome | TaskKind::Work));
    if (tick >= visit.until || tired || late)
        && !busy
        && sim.engaged_with.is_none()
        && !sim.queue.iter().any(|t| matches!(t.kind, TaskKind::GoHome))
    {
        sim.queue.push_back(Task {
            kind: TaskKind::GoHome,
            directed: false,
        });
    }
}

#[cfg(test)]
mod tests {
    use crate::social::EventKind;
    use crate::{Command, TICKS_PER_SECOND, World, clock};

    const CONTENT: &str = r#"{
        "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02},{"id":"social","label":"Social","decayPerHour":0.02}],
        "objects":[{"id":"chair","name":"Chair","interactions":[{"id":"sit","label":"Sit","minutes":30,"effects":{"social":0.01},"tags":["lounge"]}]}],
        "feelings":[{"id":"promoted","label":"Promoted","mood":0.2,"hours":24}],
        "socials":[{"id":"chat","label":"Chat","minutes":10,"tags":["social"],"acceptance":{"base":1.0},"needs":{"social":0.3}}],
        "bondPresets":{"friends":{"friendship":60}},
        "careers":[{"id":"office","label":"Office","workEffects":{"hunger":-0.2},"levels":[
            {"title":"Intern","pay":100,"start":9,"hours":4,"days":[0,1,2,3,4,5,6]},
            {"title":"Clerk","pay":200,"start":9,"hours":4,"days":[0,1,2,3,4,5,6]}]}],
        "careerRules":{"promotionFeeling":"promoted","performancePerShift":60},
        "visits":{"needs":{"social":0.5},"hours":2,"minFriendship":10,"earliestHour":0,"latestHour":24},
        "economy":{"startingFunds":500}}"#;

    /// Two houses on one street with an exit at the west end.
    const TOWN: &str = r#"{"width":40,"depth":14,"exits":[[0.5,7.5]],
        "plots":[{"name":"West","x":0,"z":0,"w":20,"d":6,"entry":[5.5,5.5]},{"name":"East","x":20,"z":0,"w":20,"d":6,"entry":[25.5,5.5]}],
        "households":[{"name":"Player","plot":0,"player":true},{"name":"Npc","plot":1}],
        "objects":[{"def":"chair","x":3,"z":2,"rot":0},{"def":"chair","x":24,"z":2,"rot":0}],
        "sims":[{"name":"Worker","household":0,"job":{"career":"office"},"x":5.5,"z":3.5},
                {"name":"Guest","household":1,"x":25.5,"z":3.5}],
        "relationships":[{"a":0,"b":1,"preset":"friends"}]}"#;

    fn ticks(w: &mut World, n: u64) {
        for _ in 0..n {
            w.tick_once();
        }
    }

    fn until_hour(w: &mut World, day: u32, hour: f32) {
        let target = clock::tick_at(day, hour * 60.0).unwrap();
        while w.tick < target {
            w.tick_once();
        }
    }

    #[test]
    fn workers_leave_get_paid_and_come_home() {
        let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
        assert_eq!(w.households[0].funds, 500);
        until_hour(&mut w, 2, 10.0);
        assert!(w.sims[0].away_until.is_some(), "should be at work at 10:00");
        until_hour(&mut w, 2, 14.5);
        assert!(w.sims[0].away_until.is_none());
        assert_eq!(w.households[0].funds, 700, "paid for day 1 and day 2");
        until_hour(&mut w, 2, 16.0);
        let home = w.plot_at(w.sims[0].tile().0, w.sims[0].tile().1);
        assert_eq!(home, Some(0), "walked back home");
        // 60 performance per shift at neutral mood -> promoted after two shifts.
        assert_eq!(w.sims[0].job.as_ref().unwrap().level, 1);
        assert!(w.events.iter().any(|e| e.kind == EventKind::Promoted));
    }

    #[test]
    fn being_kept_busy_means_a_missed_shift() {
        let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
        w.autonomy = false;
        // Make the exit unreachable by walling the worker in.
        for x in 0..40 {
            w.lot.set_h(x, 6, crate::lot::Edge::Wall);
        }
        until_hour(&mut w, 2, 11.0);
        assert!(w.events.iter().any(|e| e.kind == EventKind::MissedWork));
        assert!(w.sims[0].away_until.is_none());
    }

    #[test]
    fn friends_visit_and_go_home() {
        let mut w = World::from_json(CONTENT, TOWN, 3).unwrap();
        w.sims[0].job = None;
        w.sims[1].needs[1] = 0.1; // lonely guest
        ticks(&mut w, TICKS_PER_SECOND as u64 * 120);
        assert!(
            w.events
                .iter()
                .any(|e| e.kind == EventKind::Visited && e.a == 1),
            "guest never visited"
        );
        // The visit lasts two hours; afterwards they head home.
        ticks(&mut w, (3.0 * 60.0 / crate::MINUTES_PER_TICK) as u64);
        let (x, z) = w.sims[1].tile();
        assert_eq!(w.plot_at(x, z), Some(1), "guest went home");
        assert!(w.sims[1].visiting.is_none());
    }

    #[test]
    fn guests_stay_at_the_hosts_place() {
        let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
        w.sims[0].job = None;
        w.sims[0].needs[0] = 0.2; // hungry: the home chair... and nothing to eat anywhere
        w.apply(Command::Visit { sim: 0, plot: 1 }).unwrap();
        ticks(&mut w, TICKS_PER_SECOND as u64 * 30);
        for _ in 0..60 {
            ticks(&mut w, TICKS_PER_SECOND as u64);
            let (x, z) = w.sims[0].tile();
            assert_eq!(
                w.plot_at(x, z),
                Some(1),
                "guest wandered off the host's lot"
            );
        }
    }

    #[test]
    fn player_can_send_a_sim_to_visit_and_back() {
        let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
        w.sims[0].job = None;
        w.apply(Command::Visit { sim: 0, plot: 1 }).unwrap();
        ticks(&mut w, TICKS_PER_SECOND as u64 * 40);
        assert_eq!(w.sims[0].visiting.map(|v| v.plot), Some(1));
        w.apply(Command::GoHome { sim: 0 }).unwrap();
        ticks(&mut w, TICKS_PER_SECOND as u64 * 40);
        assert!(w.sims[0].visiting.is_none());
    }

    /// The test content with a job market: hired the day they look, let go after two misses.
    fn with_market() -> String {
        CONTENT.replace(
            r#""careerRules":{"promotionFeeling":"promoted","performancePerShift":60}"#,
            r#""careerRules":{"promotionFeeling":"promoted","performancePerShift":60,
                "market":{"hour":9.5,"dailyChance":1.0,"fireAfterMissed":2,"cooldownDays":1,
                          "hiredFeeling":"promoted"}}"#,
        )
    }

    #[test]
    fn the_unemployed_find_work_on_their_own() {
        let mut w = World::from_json(&with_market(), TOWN, 2).unwrap();
        assert!(w.sims[1].job.is_none());
        until_hour(&mut w, 1, 10.0);
        let job = w.sims[1].job.as_ref().expect("found a job at 9:30");
        assert_eq!(job.career, 0);
        assert!(
            w.events
                .iter()
                .any(|e| e.kind == EventKind::JobFound && e.a == 1 && e.career == Some(0))
        );
        // The first shift is tomorrow's.
        until_hour(&mut w, 2, 10.0);
        assert!(w.sims[1].away_until.is_some(), "at work on day 2");
    }

    #[test]
    fn no_free_will_no_job_search() {
        let mut w = World::from_json(&with_market(), TOWN, 2).unwrap();
        w.apply(Command::SetAutonomy {
            enabled: false,
            household: Some(1),
        })
        .unwrap();
        until_hour(&mut w, 3, 12.0);
        assert!(w.sims[1].job.is_none());
    }

    #[test]
    fn missing_shifts_gets_you_let_go() {
        let mut w = World::from_json(&with_market(), TOWN, 1).unwrap();
        // No free will: they don't look for a new job afterwards either.
        w.apply(Command::SetAutonomy {
            enabled: false,
            household: Some(0),
        })
        .unwrap();
        // Wall the worker in so they can never reach the exit.
        for x in 0..40 {
            w.lot.set_h(x, 6, crate::lot::Edge::Wall);
        }
        until_hour(&mut w, 3, 12.0);
        assert!(w.sims[0].job.is_none(), "let go after two missed shifts");
        assert!(w.events.iter().any(|e| e.kind == EventKind::Fired && e.a == 0));
        // Missed on days 1 and 2; looks again from day 3.
        assert_eq!(w.sims[0].job_search_from, 3);
    }

    #[test]
    fn a_visit_the_player_asked_for_ends() {
        let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
        w.sims[0].job = None;
        w.apply(Command::Visit { sim: 0, plot: 1 }).unwrap();
        ticks(&mut w, TICKS_PER_SECOND as u64 * 40);
        assert_eq!(w.sims[0].visiting.map(|v| v.plot), Some(1));
        // Twice as long as a normal (2 h) visit, then home.
        ticks(&mut w, (5.0 * 60.0 / crate::MINUTES_PER_TICK) as u64);
        assert!(w.sims[0].visiting.is_none());
    }

    #[test]
    fn careers_can_be_joined_and_quit() {
        let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
        w.apply(Command::QuitCareer { sim: 0 }).unwrap();
        assert!(w.sims[0].job.is_none());
        w.apply(Command::JoinCareer {
            sim: 1,
            career: 0,
            level: 0,
        })
        .unwrap();
        assert_eq!(w.sims[1].job.as_ref().unwrap().level, 0);
        assert!(
            w.apply(Command::JoinCareer {
                sim: 1,
                career: 9,
                level: 0
            })
            .is_err()
        );
    }
}
