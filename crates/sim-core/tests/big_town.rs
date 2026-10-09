//! A town much bigger than the game ships: 34 houses on two streets with furnished yards
//! (thousands of objects) and as many residents as a town holds, everyone with free will. It
//! must keep going like the small town does, and the long version measures how fast it runs
//! (timing depends on the machine, so it's opt-in and prints its numbers):
//! `cargo test --release -p sim-core --test big_town -- --ignored --nocapture`.

mod common;

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::time::Instant;

use common::Layout;
use sim_core::{MINUTES_PER_TICK, World, clock, world::MAX_SIMS};

const TICKS_PER_HOUR: u64 = (60.0 / MINUTES_PER_TICK) as u64;
const LAYOUT: Layout = Layout { columns: 9, streets: 2, yards: true, max_residents: MAX_SIMS };

fn big_town(seed: u64) -> World {
    let content = common::content();
    let town = common::town_with(&content, seed, 2, LAYOUT);
    World::from_json(&content, &town, seed as u32).expect("the big town loads")
}

/// What happened over a run, to compare runs of the same town (numbers the player would see).
#[derive(Default)]
struct Summary {
    /// Average needs of everyone in town, sampled every game hour.
    needs: f64,
    samples: u32,
    /// Hourly samples of a resident whose needs average below 0.3.
    low: u32,
    /// Every story event of the run by kind (the log itself keeps only the latest).
    story: BTreeMap<String, usize>,
}

fn run(w: &mut World, hours: u64, summary: &mut Summary) -> f64 {
    let n = w.content.needs.len();
    let mut seen = w.events.last_id();
    let started = Instant::now();
    for _ in 0..hours {
        for _ in 0..TICKS_PER_HOUR {
            w.tick_once();
        }
        common::check(w);
        for s in w.sims.iter().filter(|s| s.here()) {
            let avg = s.needs[..n].iter().sum::<f32>() / n as f32;
            summary.needs += avg as f64;
            summary.samples += 1;
            summary.low += (avg < 0.3) as u32;
        }
        for e in w.events.iter().filter(|e| e.id > seen) {
            *summary.story.entry(format!("{:?}", e.kind)).or_default() += 1;
        }
        seen = w.events.last_id();
    }
    started.elapsed().as_secs_f64()
}

fn report(w: &World, summary: &Summary, secs: f64, ticks: u64) {
    let here: Vec<_> = w.sims.iter().filter(|s| s.here()).collect();
    eprintln!(
        "{} houses, {} objects, {} residents: {:.0} ticks/s ({ticks} ticks in {secs:.1} s)",
        w.plots.iter().filter(|p| !p.public).count(),
        w.objects.len(),
        here.len(),
        ticks as f64 / secs
    );
    let skills: f32 = here.iter().map(|s| s.skills.iter().sum::<f32>()).sum::<f32>() / here.len() as f32;
    let jobs: Vec<usize> = here.iter().filter_map(|s| s.job.as_ref().map(|j| j.level)).collect();
    let mut funds: Vec<i64> = w.households.iter().map(|h| h.funds).collect();
    funds.sort_unstable();
    let n = w.sims.len();
    let friends = (0..n)
        .flat_map(|a| (0..n).map(move |b| (a, b)))
        .filter(|&(a, b)| a != b && w.relationships.get(a, b).friendship >= 50.0)
        .count();
    let partners = (0..n).filter(|&a| w.relationships.partner_of(a).is_some()).count() / 2;
    eprintln!(
        "needs {:.3} (low {:.1}%), skills {skills:.2} per resident, {} working at grade {:.2}, funds median {} total {}, {friends} close friendships, {partners} couples",
        summary.needs / summary.samples as f64,
        100.0 * summary.low as f64 / summary.samples as f64,
        jobs.len(),
        jobs.iter().sum::<usize>() as f64 / jobs.len().max(1) as f64,
        funds[funds.len() / 2],
        funds.iter().sum::<i64>(),
    );
    eprintln!("story: {:?}", summary.story);
    // Same hash, same run: for checking that a change keeps the simulation exactly as it was.
    let mut h = std::hash::DefaultHasher::new();
    w.save_json().hash(&mut h);
    eprintln!("save hash {:016x}", h.finish());
}

#[test]
fn a_big_town_keeps_going() {
    let mut w = big_town(3);
    assert!(w.objects.len() >= 1500, "only {} objects", w.objects.len());
    assert!(w.sims.len() >= 60, "only {} residents", w.sims.len());
    let mut summary = Summary::default();
    run(&mut w, 6, &mut summary);
    // People got on with their day.
    assert!(w.sims.iter().any(|s| s.current().is_some()));
    assert!(summary.needs / summary.samples as f64 > 0.4);
}

#[test]
#[ignore = "long: run with --release -- --ignored --nocapture"]
fn big_town_speed() {
    // `BIG_TOWN_DAYS=30` for a longer run (to compare the story, or to profile).
    let days = std::env::var("BIG_TOWN_DAYS").ok().and_then(|d| d.parse().ok()).unwrap_or(7);
    let mut w = big_town(7);
    let mut summary = Summary::default();
    let end = clock::tick_at(days + 1, 8.0 * 60.0).unwrap();
    let secs = run(&mut w, end / TICKS_PER_HOUR, &mut summary);
    report(&w, &summary, secs, w.tick);
}
