//! Balance targets for Living mode, where the residents earn the money the player builds with:
//! saving up for a room or a piece of furniture should take days to weeks, and a career should
//! take a good part of a life, not two months.
//!
//! The targets are the constants below; the shipped content meets them (pay grades in
//! `careers.json`, promotion speed in `careerRules`, rent and living costs in `economy.rent`).
//! It runs 180 game days, so it's opt-in like the long soak:
//! `cargo test --release --test balance -- --ignored --nocapture` (prints the numbers; with
//! `LOD=1`, the rest of the town besides the player's home runs at lower detail).

mod common;

use sim_core::{MINUTES_PER_TICK, World, clock};

const TICKS_PER_HOUR: u64 = (60.0 / MINUTES_PER_TICK) as u64;
const DAYS: u32 = 60;

/// What a typical room costs: a 4×4 room's walls ($40/m), a door, a window and a floor.
const ROOM: i64 = 16 * 40 + 150 + 120 + 16 * 6;

/// Weekly savings (pay minus rent, bills and spending) of a household with work, median over
/// the run: enough to build something every week or two, not a house a week.
const MEDIAN_WEEKLY_SAVINGS: std::ops::RangeInclusive<i64> = 100..=2 * ROOM;
/// Nobody gets rich in two months.
const MOST_FUNDS_AFTER_RUN: i64 = 30_000;
/// Grades (A–J) a resident climbs in the run, at most; and on average for the employed.
const MOST_GRADES_GAINED: usize = 4;
const AVERAGE_GRADES_GAINED: f64 = 2.0;

struct Run {
    /// Per household: funds at each weekly rent day, after paying.
    weekly_funds: Vec<Vec<i64>>,
    /// Per household: whether someone had a job all week (index: week).
    working: Vec<Vec<bool>>,
    /// Per resident: grades gained (promotions), and whether they ever had a job.
    grades: Vec<usize>,
    employed: Vec<bool>,
    world: World,
}

fn run(seed: u64) -> Run {
    let content = common::content();
    let town = common::town(&content, seed, 2);
    let mut w = World::from_json(&content, &town, seed as u32).unwrap();
    common::lod_from_env(&mut w);
    let households = w.households.len();
    let mut weekly_funds = vec![Vec::new(); households];
    let mut working = vec![Vec::new(); households];
    let mut worked_all_week = vec![true; households];
    let mut grades = vec![0; w.sims.len()];
    let mut employed = vec![false; w.sims.len()];
    let mut last: Vec<Option<(usize, usize)>> = w
        .sims
        .iter()
        .map(|s| s.job.as_ref().map(|j| (j.career, j.level)))
        .collect();
    let end = clock::tick_at(DAYS + 1, 8.0 * 60.0).unwrap();
    while w.tick < end {
        for _ in 0..TICKS_PER_HOUR {
            w.tick_once();
        }
        let day = clock::day(w.tick);
        // Babies are born: nothing to compare for them yet.
        last.resize(w.sims.len(), None);
        grades.resize(w.sims.len(), 0);
        employed.resize(w.sims.len(), false);
        for (i, s) in w.sims.iter().enumerate() {
            let now = s.job.as_ref().map(|j| (j.career, j.level));
            if let (Some((c0, l0)), Some((c1, l1))) = (last[i], now)
                && c0 == c1
                && l1 > l0
            {
                grades[i] += l1 - l0;
            }
            employed[i] |= now.is_some();
            last[i] = now;
        }
        for (h, ok) in worked_all_week.iter_mut().enumerate() {
            *ok &= w
                .sims
                .iter()
                .any(|s| s.household as usize == h && s.job.is_some());
        }
        // Sunday, just after rent and bills.
        if clock::weekday(day) == 6 && (clock::hour(w.tick) - 13.0).abs() < 0.5 {
            for h in 0..households {
                weekly_funds[h].push(w.households[h].funds);
                working[h].push(worked_all_week[h]);
                worked_all_week[h] = true;
            }
        }
    }
    Run {
        weekly_funds,
        working,
        grades,
        employed,
        world: w,
    }
}

#[test]
#[ignore = "long: run with --release -- --ignored"]
fn living_mode_money_and_careers_take_time() {
    let mut savings = Vec::new();
    let mut richest = 0;
    let mut gained = Vec::new();
    let mut most = 0;
    for seed in [7, 11, 19] {
        let r = run(seed);
        for (h, funds) in r.weekly_funds.iter().enumerate() {
            for week in 1..funds.len() {
                if r.working[h][week] {
                    savings.push(funds[week] - funds[week - 1]);
                }
            }
            richest = richest.max(*funds.last().unwrap_or(&0));
        }
        for (i, &g) in r.grades.iter().enumerate() {
            if r.employed[i] {
                gained.push(g);
                most = most.max(g);
            }
        }
        let w = &r.world;
        richest = richest.max(w.households.iter().map(|h| h.funds).max().unwrap_or(0));
        eprintln!(
            "seed {seed}: funds {:?}",
            w.households.iter().map(|h| h.funds).collect::<Vec<_>>()
        );
    }
    savings.sort_unstable();
    let median = savings.get(savings.len() / 2).copied().unwrap_or(0);
    let average = gained.iter().sum::<usize>() as f64 / gained.len().max(1) as f64;
    eprintln!(
        "weekly savings: median {median} (target {MEDIAN_WEEKLY_SAVINGS:?}), lowest {:?}, highest {:?}",
        savings.first(),
        savings.last()
    );
    eprintln!(
        "richest household after {DAYS} days: {richest} (target at most {MOST_FUNDS_AFTER_RUN})"
    );
    eprintln!(
        "grades gained: average {average:.1} (target at most {AVERAGE_GRADES_GAINED}), most {most} (target at most {MOST_GRADES_GAINED})"
    );
    let mut failures = Vec::new();
    if !MEDIAN_WEEKLY_SAVINGS.contains(&median) {
        failures.push(format!(
            "median weekly savings {median} outside {MEDIAN_WEEKLY_SAVINGS:?}"
        ));
    }
    if richest > MOST_FUNDS_AFTER_RUN {
        failures.push(format!("a household saved {richest} in {DAYS} days"));
    }
    if average > AVERAGE_GRADES_GAINED {
        failures.push(format!("residents climbed {average:.1} grades on average"));
    }
    if most > MOST_GRADES_GAINED {
        failures.push(format!("someone climbed {most} grades"));
    }
    assert!(
        failures.is_empty(),
        "Living mode is out of balance:\n- {}",
        failures.join("\n- ")
    );
}
