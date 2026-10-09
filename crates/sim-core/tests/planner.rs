//! The planner with the shipped content, in a whole town: routines nudge residents strongly
//! but needs and traits can win, missing places become wishes, goals steer and complete.

mod common;

use serde_json::json;
use sim_core::planner::{self, Outcome, Reason};
use sim_core::social::EventKind;
use sim_core::{Command, World, clock};

/// A town with one newcomer (resident 0) in the player's house; free will on.
fn town(seed: u64) -> World {
    let content = common::content();
    let file = common::town(&content, seed, 1);
    World::from_json(&content, &file, seed as u32).unwrap()
}

fn until(w: &mut World, day: u32, hour: f32) {
    let target = clock::tick_at(day, hour * 60.0).unwrap();
    while w.tick < target {
        w.tick_once();
    }
}

fn routines(w: &mut World, sim: u32, list: serde_json::Value) {
    let cmd = json!({"type": "setRoutines", "sim": sim, "routines": list}).to_string();
    w.apply(Command::from_json(&cmd).unwrap()).unwrap();
}

/// Keeps resident 0 home and free (no job, no job hunting goal surprises).
fn homebody(w: &mut World) {
    w.sims[0].job = None;
    w.sims[0].job_search_from = u32::MAX;
}

const EVERY_DAY: u8 = 0x7f;

#[test]
fn a_planned_workout_happens_most_days() {
    // Life gets in the way sometimes (visits, a full bladder, a mess to tidy, a bad mood), but
    // most blocks get real time: counted over eight towns, as one town's week can be unlucky
    // (with four, the mean swung from 0.13 to 0.15 with changes elsewhere in town life).
    let (mut real, mut kept, mut total) = (0, 0, 0);
    let mut strength = Vec::new();
    for seed in 1..=8 {
        let mut w = town(seed);
        homebody(&mut w);
        w.buy(0, "weightBench", None, None)
            .expect("room for a weight bench");
        routines(
            &mut w,
            0,
            json!([{"activity": "train", "skill": "strength", "days": EVERY_DAY, "start": 18 * 60, "minutes": 60}]),
        );
        until(&mut w, 6, 20.0);
        let blocks: Vec<_> = w.sims[0].planner.history.iter().filter(|b| b.day >= 2).collect();
        total += blocks.len();
        kept += blocks.iter().filter(|b| b.outcome == Outcome::Kept).count();
        real += blocks.iter().filter(|b| matches!(b.outcome, Outcome::Kept | Outcome::Cut)).count();
        let skipped_without_reason = w.sims[0]
            .planner
            .history
            .iter()
            .any(|b| b.outcome != Outcome::Kept && b.reason.is_none());
        assert!(!skipped_without_reason, "every miss has a reason");
        strength.push(w.sims[0].skills[w.content.skill_index("strength").unwrap()]);
    }
    assert!(kept >= 1 && real * 2 >= total, "{kept} kept, {real} of {total} with real time");
    let mean = strength.iter().sum::<f32>() / strength.len() as f32;
    // (Some weeks hardly train at all: a bench out of the way, a busy week. On average they do.)
    assert!(mean > 0.15, "strength {strength:?}");
}

#[test]
fn nowhere_to_do_it_becomes_a_wish_until_it_is_bought() {
    let mut w = town(4);
    homebody(&mut w);
    let piano = w.content.skill_index("dexterity").unwrap();
    routines(
        &mut w,
        0,
        json!([{"activity": "train", "skill": "dexterity", "days": EVERY_DAY, "start": 10 * 60, "minutes": 60}]),
    );
    // Nothing at home or in the park trains dexterity... unless the park has it.
    until(&mut w, 1, 11.5);
    let last = *w.sims[0].planner.history.back().expect("the block ran");
    if last.outcome != Outcome::NoPlace {
        eprintln!("the park trains dexterity; nothing to test");
        return;
    }
    assert_eq!(last.reason, Some(Reason::NoPlace));
    let train = w
        .content
        .activities
        .iter()
        .position(|a| a.id == "train")
        .unwrap();
    assert!(w.sims[0].planner.wishes.contains(&(train, Some(piano))));
    w.buy(0, "piano", None, None).expect("room for a piano");
    w.tick_once();
    assert!(w.sims[0].planner.wishes.is_empty(), "the wish came true");
}

#[test]
fn urgent_needs_still_come_first() {
    let mut w = town(5);
    homebody(&mut w);
    routines(
        &mut w,
        0,
        json!([{"activity": "fun", "days": EVERY_DAY, "start": 10 * 60, "minutes": 120}]),
    );
    until(&mut w, 1, 10.0);
    let bladder = w
        .content
        .needs
        .iter()
        .position(|n| n.id == "bladder")
        .unwrap();
    w.sims[0].needs[bladder] = 0.03;
    for _ in 0..(20 * 60 * 2) {
        w.tick_once();
        if w.sims[0].needs[bladder] > 0.5 {
            return;
        }
    }
    panic!("never went to the toilet during the fun block");
}

#[test]
fn disciplined_residents_skip_less_than_lazy_ones() {
    let mut w = town(10);
    let read = w.content.activities.iter().find(|a| a.id == "read").unwrap().clone();
    let relax = w.content.activities.iter().find(|a| a.id == "relax").unwrap().clone();
    let mut chance = |traits: &[&str], activity| {
        let s = &mut w.sims[0];
        s.traits = traits.iter().map(|t| t.to_string()).collect();
        s.base_mods = w.content.character_modifiers(&s.traits, &[]).unwrap();
        s.mods = s.base_mods.clone();
        planner::skip_chance(&w.content, &w.sims[0], activity)
    };
    let lazy = chance(&["lazy"], &read);
    let keen = chance(&["energetic", "neat"], &read);
    assert!(lazy > keen * 2.0, "lazy {lazy}, energetic and neat {keen}");
    // Traits that dislike an activity skip it more: an energetic resident and lounging around.
    let energetic_relax = chance(&["energetic"], &relax);
    let energetic_read = chance(&["energetic"], &read);
    assert!(energetic_relax > energetic_read, "{energetic_relax} vs {energetic_read}");
}

#[test]
fn planned_sleep_moves_bedtime() {
    let mut w = town(6);
    homebody(&mut w);
    routines(
        &mut w,
        0,
        json!([{"activity": "sleep", "days": EVERY_DAY, "start": 60, "minutes": 9 * 60}]),
    );
    // Most nights: up at 23:30, still asleep at 07:30 when everyone else gets up (an urgent
    // need can still wake them).
    let (mut up, mut asleep) = (0, 0);
    for day in 1..6 {
        until(&mut w, day, 23.5);
        up += !w.sims[0].asleep(&w.content) as u32;
        until(&mut w, day + 1, 7.5);
        asleep += w.sims[0].asleep(&w.content) as u32;
    }
    assert!(
        up >= 4 && asleep >= 3,
        "up at 23:30 {up}/5, asleep at 07:30 {asleep}/5"
    );
}

#[test]
fn household_routines_apply_to_everyone_who_does_not_skip_them() {
    let content = common::content();
    let file = common::town(&content, 7, 2);
    let mut w = World::from_json(&content, &file, 7).unwrap();
    let cmd = json!({"type": "setHouseholdRoutines", "sim": 0, "routines": [
        {"activity": "relax", "days": EVERY_DAY, "start": 20 * 60, "minutes": 60}]})
    .to_string();
    w.apply(Command::from_json(&cmd).unwrap()).unwrap();
    let id = w.households[0].routines[0].id;
    w.apply(Command::SkipHouseholdRoutine {
        sim: 1,
        routine: id,
        skip: true,
    })
    .unwrap();
    until(&mut w, 1, 20.5);
    assert!(w.sims[0].planner.run.is_some_and(|r| r.household));
    assert!(w.sims[1].planner.run.is_none());
}

#[test]
fn overlapping_blocks_are_refused() {
    let mut w = town(8);
    let cmd = json!({"type": "setRoutines", "sim": 0, "routines": [
        {"activity": "relax", "days": EVERY_DAY, "start": 22 * 60, "minutes": 180},
        {"activity": "read", "days": 1, "start": 0, "minutes": 60}]})
    .to_string();
    // Sunday 22:00 runs into Monday 00:00.
    assert!(w.apply(Command::from_json(&cmd).unwrap()).is_err());
}

#[test]
fn a_job_goal_finds_work_and_completes() {
    let mut w = town(9);
    w.sims[0].job = None;
    let cmd = json!({"type": "addGoal", "sim": 0, "goal": {"def": "getJob"}}).to_string();
    w.apply(Command::from_json(&cmd).unwrap()).unwrap();
    until(&mut w, 3, 12.0);
    assert!(w.sims[0].job.is_some());
    assert!(w.sims[0].planner.goals.is_empty(), "done goals are removed");
    assert!(
        w.events
            .iter()
            .any(|e| e.kind == EventKind::GoalReached && e.a == 0)
    );
}

#[test]
fn residents_suggest_goals_and_neighbours_take_theirs_on() {
    let mut w = town(12);
    until(&mut w, 8, 8.0);
    assert!(
        !w.sims[0].planner.suggestions.is_empty()
            || w.events.iter().any(|e| e.kind == EventKind::GoalSuggested)
    );
    assert!(
        w.sims[1..].iter().any(|s| !s.planner.goals.is_empty()),
        "neighbours have goals of their own"
    );
}

#[test]
fn plans_survive_saving() {
    let mut w = town(13);
    homebody(&mut w);
    routines(
        &mut w,
        0,
        json!([{"activity": "train", "skill": "strength", "days": 0b10101, "start": 18 * 60, "minutes": 90}]),
    );
    let cmd = json!({"type": "addGoal", "sim": 0, "goal": {"def": "skill", "skill": "cooking", "target": 4}}).to_string();
    w.apply(Command::from_json(&cmd).unwrap()).unwrap();
    until(&mut w, 2, 20.0);
    let loaded = World::from_save_json(&common::content(), &w.save_json()).unwrap();
    let (a, b) = (&w.sims[0].planner, &loaded.sims[0].planner);
    assert_eq!(a.routines, b.routines);
    assert_eq!(a.goals.len(), b.goals.len());
    assert_eq!(a.goals[0].skill, b.goals[0].skill);
    assert_eq!(a.history, b.history);
    assert_eq!(a.wishes, b.wishes);
}
