//! Long runs of a whole town with free will on and nobody giving orders: the "aquarium". The
//! world must stay consistent hour after hour, residents must keep themselves going, and the
//! story must keep moving.
//!
//! `cargo test --release --test soak -- --ignored` runs the long version.

mod common;

use sim_core::social::EventKind;
use sim_core::world::TaskKind;
use sim_core::{MINUTES_PER_TICK, World, clock, life};

const TICKS_PER_HOUR: u64 = (60.0 / MINUTES_PER_TICK) as u64;

/// Everything that must hold at any moment.
fn check(w: &World) {
    let n = w.sims.len();
    let content_needs = w.content.needs.len();
    for (i, s) in w.sims.iter().enumerate() {
        assert_eq!(s.id as usize, i, "Sim ids are their index");
        assert!(
            s.pos.iter().all(|p| p.is_finite()),
            "{} is nowhere: {:?}",
            s.name,
            s.pos
        );
        let (x, z) = s.tile();
        assert!(w.lot.in_bounds(x, z), "{} left the town", s.name);
        for (k, v) in s.needs[..content_needs].iter().enumerate() {
            assert!((0.0..=1.0).contains(v), "{}'s need {k} is {v}", s.name);
        }
        assert!((s.household as usize) < w.households.len());
        if let Some(t) = s.engaged_with {
            assert!((t as usize) < n && t as usize != i);
        }
        if let Some(act) = s.current() {
            match act.task.kind {
                TaskKind::Use { object, .. } => {
                    let o = &w.objects[object as usize];
                    assert!(
                        o.users().any(|u| u as usize == i),
                        "{} uses object {object} without holding a slot",
                        s.name
                    );
                }
                TaskKind::Social { target, .. } => {
                    assert!((target as usize) < n && target as usize != i)
                }
                TaskKind::Visit { plot } => assert!((plot as usize) < w.plots.len()),
                _ => {}
            }
        }
        if let Some(v) = s.visiting {
            assert!((v.plot as usize) < w.plots.len());
        }
        if let Some(job) = &s.job {
            let career = &w.content.careers[job.career];
            assert!(job.level < career.levels.len());
            assert!((0.0..=100.0).contains(&job.performance));
            assert!((0.0..=1.0).contains(&job.satisfaction));
        }
    }
    // Every object slot holder is someone who is using or heading to that object.
    for o in &w.objects {
        for u in o.users() {
            let s = &w.sims[u as usize];
            let ok = s.current().is_some_and(
                |a| matches!(a.task.kind, TaskKind::Use { object, .. } if object == o.id),
            );
            assert!(
                ok,
                "object {} is held by {} who isn't using it",
                o.id, s.name
            );
        }
    }
    // Partners are mutual and one at a time.
    for a in 0..n {
        if let Some(b) = w.relationships.partner_of(a) {
            assert_eq!(
                w.relationships.partner_of(b),
                Some(a),
                "partners aren't mutual"
            );
        }
    }
    let mut last = 0;
    for e in w.events.iter() {
        assert!(e.id > last, "event ids increase");
        last = e.id;
        assert!((e.a as usize) < n && (e.b as usize) < n);
    }
}

/// Per-resident record of how the run went.
#[derive(Default, Clone)]
struct Stats {
    need_sum: f64,
    samples: u32,
    lowest: f32,
    /// Ticks in a row with nothing to do while awake and not at work.
    idle: u64,
    /// Longest such stretch, in game minutes.
    worst_idle: f32,
}

fn run(days: u32, seed: u64, player_size: usize) -> (World, Vec<Stats>) {
    let content = common::content();
    let town = common::town(&content, seed, player_size);
    let mut w = World::from_json(&content, &town, seed as u32).expect("town loads");
    let mut stats = vec![
        Stats {
            lowest: 1.0,
            ..Default::default()
        };
        w.sims.len()
    ];
    let end = clock::tick_at(days + 1, 8.0 * 60.0).unwrap();
    let started = std::time::Instant::now();
    while w.tick < end {
        for _ in 0..TICKS_PER_HOUR {
            w.tick_once();
            let waking = (9.0..21.0).contains(&clock::hour(w.tick));
            for (i, s) in w.sims.iter().enumerate() {
                let st = &mut stats[i];
                let busy = s.current().is_some() || s.engaged_with.is_some();
                if waking && s.away_until.is_none() && !busy {
                    st.idle += 1;
                    st.worst_idle = st.worst_idle.max(st.idle as f32 * MINUTES_PER_TICK);
                } else {
                    st.idle = 0;
                }
            }
        }
        check(&w);
        let n = w.content.needs.len();
        for (i, s) in w.sims.iter().enumerate() {
            let st = &mut stats[i];
            let avg = s.needs[..n].iter().sum::<f32>() / n as f32;
            st.need_sum += avg as f64;
            st.samples += 1;
            st.lowest = st.lowest.min(avg);
        }
    }
    let secs = started.elapsed().as_secs_f64();
    eprintln!(
        "{} residents, {days} days: {:.0} ticks/s ({secs:.1} s)",
        w.sims.len(),
        w.tick as f64 / secs
    );
    (w, stats)
}

fn report(w: &World, stats: &[Stats]) {
    for (i, s) in w.sims.iter().enumerate() {
        let st = &stats[i];
        let job = s.job.as_ref().map_or("-".to_string(), |j| {
            w.content.careers[j.career].levels[j.level].title.clone()
        });
        eprintln!(
            "{:>4} h{} avg {:.2} low {:.2} idle {:.0} min  {}",
            s.name,
            s.household,
            st.need_sum / st.samples as f64,
            st.lowest,
            st.worst_idle,
            job
        );
    }
    for (h, hh) in w.households.iter().enumerate() {
        let weekly = life::weekly_costs(w, h).map_or(0, |(r, b)| r + b);
        eprintln!("{}: funds {} (weekly costs {weekly})", hh.name, hh.funds);
        // How the home's rooms are doing (cleanliness and overall), worst first.
        let mut rooms: Vec<_> = w.rooms().iter().filter(|r| !r.garden && r.plot == hh.plot).collect();
        rooms.sort_by(|a, b| a.scores.overall.total_cmp(&b.scores.overall));
        let line: Vec<String> = rooms
            .iter()
            .map(|r| {
                let kind = r.kind.map_or("?", |k| w.content.room_kinds[k].id.as_str());
                format!("{kind} {:.2} (clean {:.2})", r.scores.overall, r.scores.clean)
            })
            .collect();
        let broken: Vec<&str> = w
            .objects
            .iter()
            .filter(|o| o.broken() && hh.plot.is_some() && w.plot_at(o.x, o.z) == hh.plot)
            .map(|o| w.content.objects[o.def].id.as_str())
            .collect();
        eprintln!("    rooms: {}; broken now: {broken:?}", line.join(", "));
    }
    let mut kinds: std::collections::BTreeMap<String, usize> = Default::default();
    for e in w.events.iter() {
        *kinds.entry(format!("{:?}", e.kind)).or_default() += 1;
    }
    eprintln!("story: {kinds:?}");
    let mut accidents: std::collections::BTreeMap<&str, usize> = Default::default();
    for e in w.events.iter().filter(|e| e.kind == sim_core::social::EventKind::Accident) {
        *accidents.entry(w.content.accidents[e.n.unwrap_or(0) as usize].id.as_str()).or_default() += 1;
    }
    eprintln!("accidents (last {} story events): {accidents:?}", w.events.iter().count());
}

#[test]
fn a_town_lives_on_its_own_for_two_weeks() {
    let (w, stats) = run(14, 7, 2);
    report(&w, &stats);
    for (i, s) in w.sims.iter().enumerate() {
        let st = &stats[i];
        let avg = st.need_sum / st.samples as f64;
        assert!(avg > 0.4, "{} lived badly: average needs {avg:.2}", s.name);
        assert!(
            st.worst_idle <= 60.0,
            "{} stood around for {:.0} minutes",
            s.name,
            st.worst_idle
        );
    }
    // The newcomers found work on their own.
    let player: Vec<_> = w
        .sims
        .iter()
        .filter(|s| w.households[s.household as usize].player)
        .collect();
    assert!(!player.is_empty());
    assert!(
        player.iter().all(|s| s.job.is_some()),
        "the player's household is still looking for work"
    );
    assert!(w.events.iter().any(|e| e.kind == EventKind::JobFound));
    // Working households don't sink into debt.
    for (h, hh) in w.households.iter().enumerate() {
        let working = w
            .sims
            .iter()
            .any(|s| s.household as usize == h && s.job.is_some());
        if working {
            assert!(hh.funds > 0, "{} went into debt: {}", hh.name, hh.funds);
        }
    }
    // The story keeps moving: something notable happened at the player's home in the second week.
    let week_two = clock::tick_at(8, 0.0).unwrap();
    // (As the journal's "Our home": events naming one of them in any role.)
    let ours = |id: u32| w.households[w.sims[id as usize].household as usize].player;
    let about_us = |e: &&sim_core::social::SocialEvent| [Some(e.a), Some(e.b), e.c].into_iter().flatten().any(ours);
    // Something besides the rent in the second week (a quiet week is skill-ups and visits)...
    assert!(
        w.events.iter().filter(about_us).any(|e| e.tick >= week_two && e.kind != EventKind::PaidRent),
        "nothing happened to the player's household in week two"
    );
    // ...and something notable in the two.
    assert!(
        w.events.iter().filter(about_us).any(|e| e.kind.importance() >= 1),
        "nothing notable happened to the player's household"
    );
}

#[test]
fn same_seed_same_town() {
    let (a, _) = run(2, 3, 2);
    let (b, _) = run(2, 3, 2);
    assert_eq!(a.save_json(), b.save_json());
}

#[test]
fn saving_and_loading_mid_run_keeps_the_town() {
    let content = common::content();
    let town = common::town(&content, 5, 2);
    let mut w = World::from_json(&content, &town, 5).unwrap();
    for _ in 0..(TICKS_PER_HOUR * 30) {
        w.tick_once();
    }
    let json = w.save_json();
    let loaded = World::from_save_json(&content, &json).unwrap();
    check(&loaded);
    assert_eq!(loaded.sims.len(), w.sims.len());
    assert_eq!(
        loaded.events.iter().map(|e| e.id).collect::<Vec<_>>(),
        w.events.iter().map(|e| e.id).collect::<Vec<_>>(),
        "the story survives saving"
    );
    let jobs = |w: &World| w.sims.iter().map(|s| s.job.clone()).collect::<Vec<_>>();
    assert_eq!(jobs(&loaded), jobs(&w));
}

#[test]
#[ignore = "long: run with --release -- --ignored"]
fn a_town_lives_on_its_own_for_two_months() {
    let (w, stats) = run(60, 11, 3);
    report(&w, &stats);
    // Nobody's life collapses (crowded houses do wear people down).
    for (i, s) in w.sims.iter().enumerate() {
        let avg = stats[i].need_sum / stats[i].samples as f64;
        assert!(avg > 0.3, "{} lived badly: average needs {avg:.2}", s.name);
    }
}
