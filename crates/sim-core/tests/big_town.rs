//! A town much bigger than the game ships: 34 houses on two streets with furnished yards
//! (thousands of objects) and as many residents as a town holds, everyone with free will. It
//! must keep going like the small town does, and the long versions measure how fast it runs
//! and compare lower detail for unwatched lots (`lod.rs`) with full detail (timing depends on
//! the machine, so they're opt-in and print their numbers):
//! `cargo test --release -p sim-core --test big_town -- --ignored --nocapture`.

mod common;

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::time::Instant;

use common::Layout;
use sim_core::path::NavGrid;
use sim_core::world::{MAX_SIMS, Phase, TaskKind};
use sim_core::{MINUTES_PER_TICK, World, clock};

const TICKS_PER_HOUR: u64 = (60.0 / MINUTES_PER_TICK) as u64;
const LAYOUT: Layout = Layout { columns: 9, streets: 2, yards: true, max_residents: MAX_SIMS };

/// The big town, looked at like the game does: the player's home is in view. With `lod` off,
/// everyone is updated at full detail anyway.
fn big_town(seed: u64, lod: bool) -> World {
    let content = common::content();
    let town = common::town_with(&content, seed, 2, LAYOUT);
    let mut w = World::from_json(&content, &town, seed as u32).expect("the big town loads");
    w.lod = lod;
    let home = w.households.iter().find(|h| h.player).and_then(|h| h.plot).expect("the player has a home");
    common::look_at(&mut w, home);
    w
}

/// What a run looked like to the player: the numbers to compare runs by.
#[derive(Default, Clone)]
struct Outcome {
    /// Average needs of everyone in town (sampled every few ticks), and how often someone's
    /// were below 0.3.
    needs: f64,
    low: f64,
    samples: u32,
    /// At the end: skill levels per resident, how many work and their average grade, the
    /// households' money, close friendships (one way) and couples.
    skills: f64,
    working: f64,
    grade: f64,
    funds_median: f64,
    funds_total: f64,
    friends: f64,
    couples: f64,
    /// Share of the hourly samples by what residents were doing (see `doing`).
    time: BTreeMap<&'static str, f64>,
    /// Every story event of the run by kind (the log itself keeps only the latest).
    story: BTreeMap<String, f64>,
}

impl Outcome {
    fn finish(&mut self, w: &World) {
        let here: Vec<_> = w.sims.iter().filter(|s| s.here()).collect();
        self.needs /= self.samples as f64;
        self.low /= self.samples as f64;
        for share in self.time.values_mut() {
            *share /= self.samples as f64;
        }
        self.skills = here.iter().map(|s| s.skills.iter().sum::<f32>() as f64).sum::<f64>() / here.len() as f64;
        let jobs: Vec<usize> = here.iter().filter_map(|s| s.job.as_ref().map(|j| j.level)).collect();
        self.working = jobs.len() as f64;
        self.grade = jobs.iter().sum::<usize>() as f64 / jobs.len().max(1) as f64;
        let mut funds: Vec<i64> = w.households.iter().map(|h| h.funds).collect();
        funds.sort_unstable();
        self.funds_median = funds[funds.len() / 2] as f64;
        self.funds_total = funds.iter().sum::<i64>() as f64;
        let n = w.sims.len();
        self.friends = (0..n)
            .flat_map(|a| (0..n).map(move |b| (a, b)))
            .filter(|&(a, b)| a != b && w.relationships.get(a, b).friendship >= 50.0)
            .count() as f64;
        self.couples = ((0..n).filter(|&a| w.relationships.partner_of(a).is_some()).count() / 2) as f64;
    }

    /// The mean of several runs.
    fn mean(runs: &[Outcome]) -> Outcome {
        let k = runs.len() as f64;
        let sum = |f: fn(&Outcome) -> f64| runs.iter().map(f).sum::<f64>() / k;
        let (mut story, mut time) = (BTreeMap::new(), BTreeMap::new());
        for r in runs {
            for (kind, n) in &r.story {
                *story.entry(kind.clone()).or_default() += n / k;
            }
            for (what, share) in &r.time {
                *time.entry(*what).or_default() += share / k;
            }
        }
        Outcome {
            needs: sum(|o| o.needs),
            low: sum(|o| o.low),
            samples: 1,
            skills: sum(|o| o.skills),
            working: sum(|o| o.working),
            grade: sum(|o| o.grade),
            funds_median: sum(|o| o.funds_median),
            funds_total: sum(|o| o.funds_total),
            friends: sum(|o| o.friends),
            couples: sum(|o| o.couples),
            time,
            story,
        }
    }

    fn print(&self, label: &str) {
        eprintln!(
            "{label}: needs {:.3} (low {:.1}%), skills {:.2} per resident, {:.1} working at grade {:.2}, funds median {:.0} total {:.0}, {:.1} close friendships, {:.1} couples",
            self.needs,
            100.0 * self.low,
            self.skills,
            self.working,
            self.grade,
            self.funds_median,
            self.funds_total,
            self.friends,
            self.couples,
        );
        let story: Vec<String> = self.story.iter().map(|(k, n)| format!("{k} {n:.1}")).collect();
        eprintln!("{label}: story {}", story.join(", "));
        let time: Vec<String> = self.time.iter().map(|(k, s)| format!("{k} {:.1}%", 100.0 * s)).collect();
        eprintln!("{label}: time {}", time.join(", "));
    }
}

/// Runs `hours` game hours, checking the world every hour; returns the seconds spent ticking.
fn run(w: &mut World, hours: u64, out: &mut Outcome) -> f64 {
    let n = w.content.needs.len();
    let mut seen = w.events.last_id();
    let mut busy = 0.0;
    for _ in 0..hours {
        for t in 0..TICKS_PER_HOUR {
            let started = Instant::now();
            w.tick_once();
            busy += started.elapsed().as_secs_f64();
            // Samples every few ticks, out of step with lower detail's turns and with things
            // that happen on the hour.
            if t % 37 != 5 {
                continue;
            }
            for s in w.sims.iter().filter(|s| s.here()) {
                let avg = s.needs[..n].iter().sum::<f32>() / n as f32;
                out.needs += avg as f64;
                out.low += f64::from(avg < 0.3);
                out.samples += 1;
                *out.time.entry(doing(w, s)).or_default() += 1.0;
            }
        }
        common::check(w);
        for e in w.events.iter().filter(|e| e.id > seen) {
            *out.story.entry(format!("{:?}", e.kind)).or_default() += 1.0;
        }
        seen = w.events.last_id();
    }
    busy
}

/// What a resident is up to, roughly.
fn doing(w: &World, s: &sim_core::world::Sim) -> &'static str {
    if s.away_until.is_some() {
        return "away";
    }
    if s.engaged_with.is_some() || s.conversation(&w.content).is_some() {
        return "talking";
    }
    match s.current().map(|a| (a.task.kind, &a.phase)) {
        None => "idle",
        Some((_, Phase::Routing { .. })) => "walking",
        Some(_) if s.asleep(&w.content) => "asleep",
        Some((TaskKind::Use { .. }, _)) if s.visiting.is_some() => "using as a guest",
        Some((TaskKind::Use { .. }, _)) => "using",
        Some(_) => "other",
    }
}

/// Everyone on `plot` who isn't using something stands where they can (on the right storey).
fn sensible_on(w: &World, plot: u32) {
    let nav = NavGrid { lot: &w.lot, blocked: w.blocked(), stairs: w.stair_map() };
    for s in &w.sims {
        let (x, z) = s.tile();
        if !s.here() || s.away_until.is_some() || w.plot_at(x, z) != Some(plot) {
            continue;
        }
        // (Walkable on the storey they're on: upstairs that's inside a room, or on the stairs.)
        let using = s.current().is_some_and(|a| matches!(a.phase, Phase::Using { .. }));
        if !using {
            assert!(nav.tile_free(x, z), "{} stands somewhere nobody can at {x},{z}", s.name);
        }
    }
}

#[test]
fn a_big_town_keeps_going() {
    let mut w = big_town(3, true);
    assert!(w.objects.len() >= 1500, "only {} objects", w.objects.len());
    assert!(w.sims.len() >= 60, "only {} residents", w.sims.len());
    let mut out = Outcome::default();
    run(&mut w, 6, &mut out);
    // Most of the town is at lower detail; people got on with their day.
    let full = (0..w.sims.len()).filter(|&i| w.full_detail(i)).count();
    assert!(full < w.sims.len() / 2, "{full} of {} at full detail", w.sims.len());
    assert!(w.sims.iter().any(|s| s.current().is_some()));
    assert!(out.needs / out.samples as f64 > 0.4);
    // Looking at another lot: whoever is there catches up at once and stands somewhere
    // sensible.
    for plot in [5, 12, 20, 27] {
        common::look_at(&mut w, plot);
        w.tick_once();
        sensible_on(&w, plot);
        run(&mut w, 1, &mut out);
    }
}

#[test]
#[ignore = "long: run with --release -- --ignored --nocapture"]
fn big_town_speed() {
    // `BIG_TOWN_DAYS=30` for a longer run; `BIG_TOWN_LOD=0` or `1` for only one of them.
    let days = std::env::var("BIG_TOWN_DAYS").ok().and_then(|d| d.parse().ok()).unwrap_or(7);
    let only = std::env::var("BIG_TOWN_LOD").ok();
    for lod in [false, true].into_iter().filter(|&l| only.as_deref().is_none_or(|o| o == if l { "1" } else { "0" })) {
        let mut w = big_town(7, lod);
        let mut out = Outcome::default();
        let end = clock::tick_at(days + 1, 8.0 * 60.0).unwrap();
        let secs = run(&mut w, end / TICKS_PER_HOUR, &mut out);
        let label = if lod { "lower detail" } else { "full detail" };
        eprintln!(
            "{label}: {} houses, {} objects, {} residents: {:.0} ticks/s ({} ticks in {secs:.1} s)",
            w.plots.iter().filter(|p| !p.public).count(),
            w.objects.len(),
            w.sims.iter().filter(|s| s.here()).count(),
            w.tick as f64 / secs,
            w.tick,
        );
        out.finish(&w);
        out.print(label);
        // Same hash, same run: for checking that a change keeps the simulation exactly as it was.
        let mut h = std::hash::DefaultHasher::new();
        w.save_json().hash(&mut h);
        eprintln!("{label}: save hash {:016x}", h.finish());
    }
}

/// Lower detail for unwatched lots keeps what the player sees about the same: the mean over a
/// few towns, with and without it.
#[test]
#[ignore = "long: run with --release -- --ignored --nocapture"]
fn lower_detail_keeps_the_story() {
    let days = std::env::var("BIG_TOWN_DAYS").ok().and_then(|d| d.parse().ok()).unwrap_or(14);
    // `BIG_TOWN_SEEDS=1,2,3` for other towns (more towns, less noise).
    let seeds: Vec<u64> = std::env::var("BIG_TOWN_SEEDS")
        .ok()
        .map(|s| s.split(',').filter_map(|n| n.trim().parse().ok()).collect())
        .unwrap_or(vec![3, 7, 11, 19]);
    let mut means = Vec::new();
    for lod in [false, true] {
        let mut runs = Vec::new();
        let mut secs = 0.0;
        let mut ticks = 0;
        for &seed in &seeds {
            let mut w = big_town(seed, lod);
            let mut out = Outcome::default();
            let end = clock::tick_at(days + 1, 8.0 * 60.0).unwrap();
            secs += run(&mut w, end / TICKS_PER_HOUR, &mut out);
            ticks += w.tick;
            out.finish(&w);
            runs.push(out);
        }
        let label = if lod { "lower detail" } else { "full detail" };
        eprintln!("{label}: {:.0} ticks/s over {} towns of {days} days", ticks as f64 / secs, seeds.len());
        let mean = Outcome::mean(&runs);
        mean.print(label);
        means.push(mean);
    }
    let (full, lower) = (&means[0], &means[1]);
    let near = |a: f64, b: f64, by: f64| (a - b).abs() <= by * a.abs().max(b.abs()).max(1.0);
    assert!((full.needs - lower.needs).abs() < 0.02, "needs {:.3} vs {:.3}", full.needs, lower.needs);
    assert!(near(full.skills, lower.skills, 0.1), "skills {:.2} vs {:.2}", full.skills, lower.skills);
    assert!(near(full.funds_total, lower.funds_total, 0.1), "money {:.0} vs {:.0}", full.funds_total, lower.funds_total);
    assert!(near(full.friends, lower.friends, 0.25), "friendships {:.1} vs {:.1}", full.friends, lower.friends);
    // Days are spent the same way.
    for (what, share) in &full.time {
        let other = lower.time.get(what).copied().unwrap_or(0.0);
        assert!((share - other).abs() < 0.015, "{what}: {:.1}% vs {:.1}%", 100.0 * share, 100.0 * other);
    }
}
