//! Daily life: work shifts, pay and promotions, and households visiting each other.
//!
//! Runs as a world-level phase after Sims and conversations each tick, so it can
//! move Sims between "at home", "travelling" and "away at work", pay households,
//! and record story events.

use serde::{Deserialize, Serialize};

use crate::MINUTES_PER_TICK;
use crate::clock;
use crate::content::{Content, MAX_NEEDS};
use crate::social::{self, EventKind};
use crate::world::{Task, TaskKind, World, end_activity};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub career: usize,
    pub level: usize,
    /// 0..100; a full bar earns a promotion.
    pub performance: f32,
    /// Last day a shift was worked or missed (so each day counts once).
    pub last_shift_day: u32,
    /// Mood when leaving for the current shift.
    pub shift_mood: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Visit {
    pub plot: u32,
    /// Guests head home after this tick (`u64::MAX` for player-controlled visits).
    pub until: u64,
}

/// A change in where a Sim is, raised by tasks and handled by `life::update`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Transition {
    /// Reached the town exit: the shift starts.
    Work,
    /// Set off to visit a plot (guest status starts now, so an interrupted trip still ends at home).
    Visit(u32),
    /// Reached home.
    Home,
}

/// Today's shift for a job as `(leave, start, end)` ticks, if today is a workday.
pub fn shift_today(content: &Content, job: &Job, tick: u64) -> Option<(u64, u64, u64)> {
    let level = &content.careers[job.career].levels[job.level];
    let day = clock::day(tick);
    if level.days & (1 << clock::weekday(day)) == 0 {
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
        if let Some(transition) = w.sims[i].transition.take() {
            apply_transition(w, i, transition);
        }
        if w.sims[i].away_until.is_some() {
            at_work(w, i);
            continue;
        }
        schedule_work(w, i, day);
        end_visit_if_due(w, i, hour);
    }
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
    let Some((leave, start, _)) = shift_today(content, job, tick) else {
        return;
    };
    let late = start + ticks(content.career_rules.late_minutes);
    if tick > late {
        job.last_shift_day = day;
        job.performance = (job.performance - content.career_rules.missed_penalty).max(0.0);
        if let Some(m) = content.career_rules.missed_moodlet {
            social::add_moodlet(&mut sim.moodlets, m, &content.moodlets, tick);
        }
        events.push(tick, EventKind::MissedWork, i, i, None);
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
            let Some(job) = sim.job.as_mut() else { return };
            let Some((_, start, end)) = shift_today(content, job, tick) else {
                return;
            };
            job.last_shift_day = clock::day(tick);
            job.shift_mood = mood;
            // Early arrivals still work until the shift's end; late ones lose that time.
            sim.away_until = Some(end.max(start).max(tick + 1));
            sim.queue.clear();
        }
        Transition::Visit(plot) => {
            let player = w.households[w.sims[i].household as usize].player;
            let until = if player {
                u64::MAX
            } else {
                tick + ticks(w.content.visits.hours * 60.0)
            };
            w.sims[i].visiting = Some(Visit { plot, until });
            // Tell the story if the hosts are home.
            let host = w
                .households
                .iter()
                .find(|h| h.plot == Some(plot))
                .map(|h| h.id);
            if let Some(host) = host
                && let Some(j) = w.sims.iter().position(|s| {
                    s.household == host && w.plot_at(s.tile().0, s.tile().1) == Some(plot)
                })
            {
                w.events.push(tick, EventKind::Visited, i, j, None);
            }
        }
        Transition::Home => w.sims[i].visiting = None,
    }
}

/// Off the map at work: needs change, then come home with pay and maybe a promotion.
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
    let Some(job) = sim.job.as_mut() else {
        sim.away_until = None;
        return;
    };
    let career = &content.careers[job.career];
    let level = &career.levels[job.level];
    let per_tick = MINUTES_PER_TICK / (level.hours * 60.0);
    for n in 0..MAX_NEEDS.min(content.needs.len()) {
        sim.needs[n] = (sim.needs[n] + career.work_effects[n] * per_tick).clamp(0.0, 1.0);
    }
    if sim.away_until.is_some_and(|until| tick < until) {
        return;
    }
    sim.away_until = None;
    households[sim.household as usize].funds += level.pay;
    let rules = &content.career_rules;
    job.performance =
        (job.performance + rules.performance_per_shift + (job.shift_mood - 0.5) * 30.0)
            .clamp(0.0, 100.0);
    if job.performance >= 100.0 && job.level + 1 < career.levels.len() {
        job.level += 1;
        job.performance = 0.0;
        if let Some(m) = rules.promotion_moodlet {
            social::add_moodlet(&mut sim.moodlets, m, &content.moodlets, tick);
        }
        events.push(tick, EventKind::Promoted, i, i, None);
    }
    sim.queue.push_back(Task {
        kind: TaskKind::GoHome,
        directed: false,
    });
}

/// Guests go home when the visit is over, it's late, or they need something.
fn end_visit_if_due(w: &mut World, i: usize, hour: f32) {
    let tick = w.tick;
    let content = &w.content;
    let sim = &mut w.sims[i];
    let Some(visit) = sim.visiting else { return };
    if visit.until == u64::MAX {
        return; // the player decides when to leave
    }
    let tired = sim.needs[..content.needs.len()].iter().any(|&n| n < 0.15);
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
        "moodlets":[{"id":"promoted","label":"Promoted","mood":0.2,"hours":24}],
        "socials":[{"id":"chat","label":"Chat","minutes":10,"tags":["social"],"acceptance":{"base":1.0},"needs":{"social":0.3}}],
        "bondPresets":{"friends":{"friendship":60}},
        "careers":[{"id":"office","label":"Office","workEffects":{"hunger":-0.2},"levels":[
            {"title":"Intern","pay":100,"start":9,"hours":4,"days":[0,1,2,3,4,5,6]},
            {"title":"Clerk","pay":200,"start":9,"hours":4,"days":[0,1,2,3,4,5,6]}]}],
        "careerRules":{"promotionMoodlet":"promoted","performancePerShift":60},
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

    #[test]
    fn careers_can_be_joined_and_quit() {
        let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
        w.apply(Command::QuitCareer { sim: 0 }).unwrap();
        assert!(w.sims[0].job.is_none());
        w.apply(Command::JoinCareer { sim: 1, career: 0 }).unwrap();
        assert_eq!(w.sims[1].job.as_ref().unwrap().level, 0);
        assert!(w.apply(Command::JoinCareer { sim: 1, career: 9 }).is_err());
    }
}
