//! Running social interactions between two Sims.
//!
//! An actor walks up to the target (re-routing if the target moves), waits until
//! the target is free, then both face each other for the interaction's duration.
//! Success is rolled when the conversation starts (so the UI can show the reaction
//! halfway through); relationship changes, feelings and events apply at the end.

use crate::MINUTES_PER_TICK;
use crate::content::{Content, MAX_NEEDS, Pose};
use crate::path::NavGrid;
use crate::rng::Rng;
use crate::social::{self, Effect, EventKind, EventLog, Relationships, SocialDef};
use crate::world::{ObjectInstance, Phase, Sim, TaskKind, World, end_activity, route};

/// How long an actor waits for a busy target before giving up.
const WAIT_LIMIT_TICKS: u32 = (10.0 / MINUTES_PER_TICK) as u32;
/// Re-route when the target is this far from the route's end. Routes end on a tile
/// *next to* the target (up to ~1.6 m from them), so this must exceed that.
const REPATH_DISTANCE: f32 = 2.4;
/// Extra distance at which a conversation can start.
const ENGAGE_SLACK: f32 = 0.8;
/// Rejected interactions end early.
const FAILURE_LENGTH: f32 = 0.4;

pub fn duration(s: &SocialDef, success: bool) -> f32 {
    if success {
        s.minutes
    } else {
        s.minutes * FAILURE_LENGTH
    }
}

/// Whether `actor` can start `s` with `target` (relationship requirements and attraction).
pub fn social_allowed(
    content: &Content,
    rels: &Relationships,
    actor: &Sim,
    target: &Sim,
    s: &SocialDef,
) -> bool {
    let rel = rels.get(actor.id as usize, target.id as usize);
    let romantic = s.tags & content.social_rules.romantic_tags != 0;
    actor.id != target.id
        && s.requires.allows(rel)
        && (!romantic || (actor.attracted_to(target) && rel.kin.is_none()))
}

/// Probability that `target` responds well to `actor` doing `s`.
pub fn acceptance_chance(
    content: &Content,
    rels: &Relationships,
    actor: &Sim,
    target: &Sim,
    s: &SocialDef,
) -> f32 {
    let (a, t) = (actor.id as usize, target.id as usize);
    let romantic = s.tags & content.social_rules.romantic_tags != 0;
    if romantic && !target.attracted_to(actor) {
        return 0.0; // not interested in the actor's gender
    }
    let view = rels.get(t, a);
    let acc = &s.acceptance;
    let mut p = acc.base
        + acc.friendship * view.friendship
        + acc.romance * view.romance
        + acc.chemistry * rels.chemistry(a, t)
        + acc.mood * (target.mood(content) - 0.5)
        + target.mods.acceptance(s.tags)
        + actor.mods.success(s.tags);
    if let Some(e) = target.emotion(content) {
        p += content.emotions[e].mods.acceptance(s.tags);
    }
    if acc.taken_penalty > 0.0 && rels.partner_of(t).is_some_and(|p| p != a) {
        p -= acc.taken_penalty;
    }
    p.clamp(0.0, 1.0)
}

/// Social options `actor` has toward `target`: `(social index, success chance)`.
pub fn options(w: &World, actor: usize, target: usize) -> Vec<(usize, f32)> {
    let (Some(a), Some(t)) = (w.sims.get(actor), w.sims.get(target)) else {
        return Vec::new();
    };
    w.content
        .socials
        .iter()
        .enumerate()
        .filter(|(_, s)| social_allowed(&w.content, &w.relationships, a, t, s))
        .map(|(i, s)| (i, acceptance_chance(&w.content, &w.relationships, a, t, s)))
        .collect()
}

/// A free tile next to `target` (or under it), closest to `from`.
pub(crate) fn approach_tile(nav: &NavGrid, target: [f32; 2], from: [f32; 2]) -> Option<(i32, i32)> {
    let (tx, tz) = (target[0].floor() as i32, target[1].floor() as i32);
    let mut best = None;
    let mut best_d = f32::INFINITY;
    for dz in -1..=1 {
        for dx in -1..=1 {
            let (x, z) = (tx + dx, tz + dz);
            if !nav.tile_free(x, z) {
                continue;
            }
            let d = (x as f32 + 0.5 - from[0]).hypot(z as f32 + 0.5 - from[1]);
            if d < best_d {
                best_d = d;
                best = Some((x, z));
            }
        }
    }
    best
}

#[derive(Clone, Copy)]
enum State {
    Routing { goal: [f32; 2] },
    Waiting(u32),
    Conversing(f32, bool),
}

pub(crate) fn update(w: &mut World) {
    let tick = w.tick;
    let World {
        content,
        lot,
        blocked,
        objects,
        sims,
        relationships,
        events,
        rng,
        ..
    } = w;
    let nav = NavGrid { lot, blocked };
    let n = sims.len();

    // Drop engagements whose actor stopped talking (cancelled, interrupted, finished).
    for i in 0..n {
        if let Some(a) = sims[i].engaged_with
            && sims[a as usize]
                .conversation(content)
                .is_none_or(|(t, ..)| t as usize != i)
        {
            sims[i].engaged_with = None;
        }
    }

    for i in 0..n {
        let Some(act) = sims[i].current.as_ref() else {
            continue;
        };
        let TaskKind::Social { target, social } = act.task.kind else {
            continue;
        };
        let t = target as usize;
        let state = match &act.phase {
            Phase::Routing { waypoints, .. } => State::Routing {
                goal: *waypoints.last().unwrap_or(&sims[i].pos),
            },
            Phase::Waiting { ticks } => State::Waiting(*ticks),
            Phase::Conversing { elapsed, success } => State::Conversing(*elapsed, *success),
            Phase::Using { .. } => continue,
        };
        let s = &content.socials[social];
        let gap = dist(sims[i].pos, sims[t].pos);

        match state {
            State::Routing { goal } => {
                if gap <= s.distance + ENGAGE_SLACK {
                    set_phase(&mut sims[i], Phase::Waiting { ticks: 0 });
                } else if dist(goal, sims[t].pos) > REPATH_DISTANCE {
                    chase(&nav, sims, i, t, content, objects);
                }
            }
            State::Waiting(ticks) => {
                if gap > s.distance + ENGAGE_SLACK + 0.6 {
                    chase(&nav, sims, i, t, content, objects);
                } else if sims[t].available_for_social(content) {
                    engage(
                        content,
                        &nav,
                        relationships,
                        events,
                        rng,
                        objects,
                        sims,
                        i,
                        t,
                        social,
                        tick,
                    );
                } else if ticks >= WAIT_LIMIT_TICKS {
                    end_activity(&mut sims[i], content, objects);
                } else {
                    sims[i].yaw = facing(sims[i].pos, sims[t].pos);
                    set_phase(&mut sims[i], Phase::Waiting { ticks: ticks + 1 });
                }
            }
            State::Conversing(elapsed, success) => {
                if sims[t].engaged_with != Some(i as u32) {
                    end_activity(&mut sims[i], content, objects);
                    continue;
                }
                let elapsed = elapsed + MINUTES_PER_TICK;
                let (actor, other) = pair_mut(sims, i, t);
                gain(actor, &s.actor_gain, s.minutes);
                gain(other, &s.target_gain, s.minutes);
                if elapsed >= duration(s, success) {
                    apply_outcome(
                        content,
                        relationships,
                        events,
                        rng,
                        sims,
                        i,
                        t,
                        social,
                        success,
                        tick,
                    );
                    sims[t].engaged_with = None;
                    end_activity(&mut sims[i], content, objects);
                } else {
                    set_phase(&mut sims[i], Phase::Conversing { elapsed, success });
                }
            }
        }
    }
}

fn set_phase(sim: &mut Sim, phase: Phase) {
    if let Some(act) = sim.current.as_mut() {
        act.phase = phase;
    }
}

/// Re-route toward a target that moved; give up if they're unreachable.
fn chase(
    nav: &NavGrid,
    sims: &mut [Sim],
    i: usize,
    t: usize,
    content: &Content,
    objects: &mut [ObjectInstance],
) {
    let target = sims[t].pos;
    let rerouted = approach_tile(nav, target, sims[i].pos).and_then(|goal| {
        route(
            nav,
            sims[i].pos,
            sims[i].tile(),
            goal,
            [goal.0 as f32 + 0.5, goal.1 as f32 + 0.5],
        )
    });
    match rerouted {
        Some(waypoints) => set_phase(&mut sims[i], Phase::Routing { waypoints, next: 0 }),
        None => end_activity(&mut sims[i], content, objects),
    }
}

#[allow(clippy::too_many_arguments)]
fn engage(
    content: &Content,
    nav: &NavGrid,
    rels: &mut Relationships,
    events: &mut EventLog,
    rng: &mut Rng,
    objects: &mut [ObjectInstance],
    sims: &mut [Sim],
    i: usize,
    t: usize,
    social: usize,
    tick: u64,
) {
    let s = &content.socials[social];
    let success = rng.next_f32() < acceptance_chance(content, rels, &sims[i], &sims[t], s);
    // The target drops whatever (autonomous, interruptible) thing it was doing.
    end_activity(&mut sims[t], content, objects);
    sims[t].engaged_with = Some(i as u32);

    if !rels.get(i, t).met {
        rels.get_mut(i, t).met = true;
        rels.get_mut(t, i).met = true;
        events.push(tick, EventKind::Met, i, t, None);
    }

    // Stand at the interaction's distance, facing each other.
    let (ap, tp) = (sims[i].pos, sims[t].pos);
    let d = dist(ap, tp).max(1e-3);
    let spot = [
        tp[0] + (ap[0] - tp[0]) / d * s.distance,
        tp[1] + (ap[1] - tp[1]) / d * s.distance,
    ];
    if nav.tile_free(spot[0].floor() as i32, spot[1].floor() as i32) && nav.line_walkable(ap, spot)
    {
        sims[i].pos = spot;
    }
    sims[i].yaw = facing(sims[i].pos, tp);
    sims[t].yaw = facing(tp, sims[i].pos);
    set_phase(
        &mut sims[i],
        Phase::Conversing {
            elapsed: 0.0,
            success,
        },
    );
}

#[allow(clippy::too_many_arguments)]
fn apply_outcome(
    content: &Content,
    rels: &mut Relationships,
    events: &mut EventLog,
    rng: &mut Rng,
    sims: &mut [Sim],
    a: usize,
    t: usize,
    social: usize,
    success: bool,
    tick: u64,
) {
    let s = &content.socials[social];
    let o = if success { &s.success } else { &s.failure };
    let defs = &content.feelings;
    let rules = &content.social_rules;
    let before = (*rels.get(a, t), *rels.get(t, a));

    rels.adjust(a, t, o.friendship, o.romance);
    rels.adjust(t, a, o.target_friendship, o.target_romance);
    {
        let (actor, target) = pair_mut(sims, a, t);
        nudge(actor, &o.needs);
        nudge(target, &o.target_needs);
        if let Some(m) = o.feeling {
            social::add_feeling(&mut actor.feelings, m, defs, tick);
        }
        if let Some(m) = o.target_feeling {
            social::add_feeling(&mut target.feelings, m, defs, tick);
        }
    }

    match o.effect {
        Effect::None => {}
        Effect::Kiss => {
            if success && !rels.get(a, t).kissed {
                rels.get_mut(a, t).kissed = true;
                rels.get_mut(t, a).kissed = true;
                events.push(tick, EventKind::FirstKiss, a, t, None);
            }
        }
        Effect::BecomePartners => {
            if success {
                // Starting something new ends any existing relationship, painfully for the ex.
                for x in [a, t] {
                    if let Some(ex) = rels.partner_of(x).filter(|&p| p != a && p != t) {
                        break_up(
                            rels,
                            events,
                            sims,
                            defs,
                            rules.heartbreak_feeling,
                            x,
                            ex,
                            tick,
                        );
                    }
                }
                rels.get_mut(a, t).partners = true;
                rels.get_mut(t, a).partners = true;
                events.push(tick, EventKind::StartedDating, a, t, None);
            } else {
                events.push(tick, EventKind::ProposalRejected, a, t, None);
            }
        }
        Effect::BreakUp => {
            if rels.get(a, t).partners {
                break_up(
                    rels,
                    events,
                    sims,
                    defs,
                    rules.heartbreak_feeling,
                    a,
                    t,
                    tick,
                );
            }
        }
        Effect::Fight => {
            let strength = |sim: &Sim| 0.3 + sim.mood(content) * 0.5 + sim.mods.walk_speed * 0.2;
            let (sa, st) = (strength(&sims[a]), strength(&sims[t]));
            let (winner, loser) = if rng.next_f32() * (sa + st) < sa {
                (a, t)
            } else {
                (t, a)
            };
            if let Some(m) = o.winner_feeling {
                social::add_feeling(&mut sims[winner].feelings, m, defs, tick);
            }
            if let Some(m) = o.loser_feeling {
                social::add_feeling(&mut sims[loser].feelings, m, defs, tick);
            }
            events.push(tick, EventKind::Fight, winner, loser, None);
        }
    }

    for (kind, reversed) in
        social::milestone_events((&before.0, &before.1), (rels.get(a, t), rels.get(t, a)))
    {
        let (x, y) = if reversed { (t, a) } else { (a, t) };
        events.push(tick, kind, x, y, None);
    }

    // Romance in front of a partner causes jealousy.
    if success && s.tags & rules.romantic_tags != 0 {
        for b in 0..sims.len() {
            if b == a || b == t || sims[b].pose == Pose::Lie {
                continue;
            }
            for (x, y) in [(a, t), (t, a)] {
                if rels.get(b, x).partners && dist(sims[b].pos, sims[x].pos) <= rules.jealousy_range
                {
                    rels.adjust(b, x, rules.jealousy_friendship, rules.jealousy_romance);
                    if let Some(m) = rules.jealousy_feeling {
                        social::add_feeling(&mut sims[b].feelings, m, defs, tick);
                    }
                    events.push(tick, EventKind::Jealous, b, x, Some(y));
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn break_up(
    rels: &mut Relationships,
    events: &mut EventLog,
    sims: &mut [Sim],
    defs: &[social::FeelingDef],
    heartbreak: Option<usize>,
    leaver: usize,
    left: usize,
    tick: u64,
) {
    rels.get_mut(leaver, left).partners = false;
    rels.get_mut(left, leaver).partners = false;
    rels.adjust(left, leaver, -20.0, -40.0);
    rels.adjust(leaver, left, -5.0, -20.0);
    if let Some(m) = heartbreak {
        social::add_feeling(&mut sims[left].feelings, m, defs, tick);
    }
    events.push(tick, EventKind::BrokeUp, leaver, left, None);
}

fn gain(sim: &mut Sim, total: &[f32; MAX_NEEDS], minutes: f32) {
    for (n, g) in total.iter().enumerate() {
        if *g != 0.0 {
            sim.needs[n] = (sim.needs[n] + g / minutes * MINUTES_PER_TICK * sim.mods.need_gain[n])
                .clamp(0.0, 1.0);
        }
    }
}

fn nudge(sim: &mut Sim, delta: &[f32; MAX_NEEDS]) {
    for (n, d) in delta.iter().enumerate() {
        sim.needs[n] = (sim.needs[n] + d).clamp(0.0, 1.0);
    }
}

fn pair_mut(sims: &mut [Sim], a: usize, b: usize) -> (&mut Sim, &mut Sim) {
    assert_ne!(a, b);
    if a < b {
        let (l, r) = sims.split_at_mut(b);
        (&mut l[a], &mut r[0])
    } else {
        let (l, r) = sims.split_at_mut(a);
        (&mut r[0], &mut l[b])
    }
}

fn dist(a: [f32; 2], b: [f32; 2]) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

fn facing(from: [f32; 2], to: [f32; 2]) -> f32 {
    (to[0] - from[0]).atan2(to[1] - from[1])
}

#[cfg(test)]
mod tests {
    use crate::social::EventKind;
    use crate::world::{Phase, TICKS_PER_DAY};
    use crate::{Command, TICKS_PER_SECOND, World};

    const CONTENT: &str = r#"{
        "needs":[{"id":"social","label":"Social","decayPerHour":0.1},{"id":"fun","label":"Fun","decayPerHour":0.05}],
        "objects":[],
        "genders":[{"id":"female","label":"Female"},{"id":"male","label":"Male"}],
        "emotions":[{"id":"angry","label":"Angry","effects":{"tagPreference":{"mean":4}}},
                    {"id":"happy","label":"Happy"}],
        "feelings":[{"id":"goodChat","label":"Good chat","emotion":"happy","mood":0.05,"hours":2},
                    {"id":"jealous","label":"Jealous","emotion":"angry","mood":-0.15,"hours":6},
                    {"id":"heartbroken","label":"Heartbroken","mood":-0.25,"hours":24},
                    {"id":"lost","label":"Lost a fight","mood":-0.1,"hours":4}],
        "socials":[
          {"id":"chat","label":"Chat","minutes":10,"tags":["social","friendly"],"prefer":"liked",
           "acceptance":{"base":1.0},"needs":{"social":0.4},"targetNeeds":{"social":0.4},
           "success":{"friendship":6,"targetFriendship":6,"feeling":"goodChat","targetFeeling":"goodChat"}},
          {"id":"flirt","label":"Flirt","minutes":10,"tags":["social","romantic"],"animation":"flirt","prefer":"romance",
           "acceptance":{"base":1.0},"success":{"romance":10,"targetRomance":10}},
          {"id":"askPartner","label":"Ask to be partners","minutes":5,"tags":["social","romantic"],"autonomous":false,
           "requires":{"minRomance":30,"partners":false},"acceptance":{"base":1.0},"success":{"effect":"becomePartners"}},
          {"id":"fight","label":"Fight","minutes":5,"tags":["social","mean"],"animation":"fight","autonomous":false,
           "acceptance":{"base":1.0},"success":{"friendship":-20,"targetFriendship":-20,"effect":"fight","loserFeeling":"lost"}}],
        "bondPresets":{"roommates":{"friendship":20},"partners":{"friendship":50,"romance":70,"partners":true}},
        "socialRules":{"defaultBond":"roommates","romanticTags":["romantic"],"jealousyFeeling":"jealous","heartbreakFeeling":"heartbroken"}}"#;

    fn town(sims: &str, relationships: &str) -> World {
        let lot = format!(
            r#"{{"width":16,"depth":16,"sims":[{sims}],"relationships":[{relationships}]}}"#
        );
        World::from_json(CONTENT, &lot, 5).unwrap()
    }

    fn ticks(w: &mut World, n: u64) {
        for _ in 0..n {
            w.tick_once();
        }
    }

    #[test]
    fn lonely_housemates_chat_and_grow_closer() {
        let mut w = town(
            r#"{"name":"A","gender":"female","x":3.5,"z":3.5},{"name":"B","gender":"male","x":8.5,"z":8.5}"#,
            "",
        );
        w.sims[0].needs[0] = 0.1;
        w.sims[1].needs[0] = 0.1;
        let before = w.relationships.get(0, 1).friendship;
        ticks(&mut w, TICKS_PER_SECOND as u64 * 120);
        assert!(
            w.relationships.get(0, 1).friendship > before,
            "they never talked"
        );
        assert!(w.sims[0].needs[0] > 0.1);
    }

    #[test]
    fn romance_respects_attraction() {
        let w = town(
            r#"{"name":"A","gender":"female","attractedTo":["female"],"x":3.5,"z":3.5},
               {"name":"B","gender":"male","attractedTo":["female"],"x":4.5,"z":3.5}"#,
            "",
        );
        let flirt = w.content.social_index("flirt").unwrap();
        // A isn't attracted to men: no romantic options toward B.
        assert!(!super::options(&w, 0, 1).iter().any(|(i, _)| *i == flirt));
        // B is attracted to women and may flirt, but A isn't interested.
        let chance = super::options(&w, 1, 0)
            .into_iter()
            .find(|(i, _)| *i == flirt)
            .unwrap()
            .1;
        assert_eq!(chance, 0.0);
    }

    #[test]
    fn directed_flirt_runs_as_a_conversation() {
        let mut w = town(
            r#"{"name":"A","gender":"female","x":3.5,"z":3.5},{"name":"B","gender":"male","x":9.5,"z":3.5}"#,
            "",
        );
        w.autonomy = false;
        let flirt = w.content.social_index("flirt").unwrap();
        w.apply(Command::Social {
            sim: 0,
            target: 1,
            social: flirt,
        })
        .unwrap();
        let mut talked = false;
        for _ in 0..TICKS_PER_SECOND * 30 {
            w.tick_once();
            if matches!(
                w.sims[0].current.as_ref().map(|a| &a.phase),
                Some(Phase::Conversing { .. })
            ) {
                talked = true;
                assert_eq!(w.sims[1].engaged_with, Some(0));
            }
        }
        assert!(talked);
        assert_eq!(w.relationships.get(0, 1).romance, 10.0);
        assert_eq!(w.relationships.get(1, 0).romance, 10.0);
        assert_eq!(
            w.sims[1].engaged_with, None,
            "released after the conversation"
        );
    }

    #[test]
    fn new_partner_breaks_old_relationship_and_flirting_makes_jealous() {
        let mut w = town(
            r#"{"name":"A","gender":"female","x":3.5,"z":3.5},{"name":"B","gender":"male","x":4.5,"z":3.5},
               {"name":"C","gender":"male","x":5.5,"z":3.5}"#,
            r#"{"a":0,"b":1,"preset":"partners"}"#,
        );
        w.autonomy = false;
        let flirt = w.content.social_index("flirt").unwrap();
        let ask = w.content.social_index("askPartner").unwrap();
        w.apply(Command::Social {
            sim: 0,
            target: 2,
            social: flirt,
        })
        .unwrap();
        ticks(&mut w, TICKS_PER_SECOND as u64 * 20);
        assert!(
            w.events
                .iter()
                .any(|e| e.kind == EventKind::Jealous && e.a == 1 && e.b == 0)
        );

        w.relationships.get_mut(0, 2).romance = 50.0;
        w.apply(Command::Social {
            sim: 0,
            target: 2,
            social: ask,
        })
        .unwrap();
        ticks(&mut w, TICKS_PER_SECOND as u64 * 20);
        assert!(w.relationships.get(0, 2).partners);
        assert!(!w.relationships.get(0, 1).partners);
        assert!(
            w.events
                .iter()
                .any(|e| e.kind == EventKind::BrokeUp && e.b == 1)
        );
        assert!(
            w.sims[1]
                .feelings
                .iter()
                .any(|m| w.content.feelings[m.def].id == "heartbroken")
        );
    }

    #[test]
    fn fights_have_a_loser_and_hurt_the_relationship() {
        let mut w = town(
            r#"{"name":"A","x":3.5,"z":3.5},{"name":"B","x":5.5,"z":3.5}"#,
            "",
        );
        w.autonomy = false;
        let fight = w.content.social_index("fight").unwrap();
        let before = w.relationships.get(0, 1).friendship;
        w.apply(Command::Social {
            sim: 0,
            target: 1,
            social: fight,
        })
        .unwrap();
        ticks(&mut w, TICKS_PER_SECOND as u64 * 20);
        assert!(w.relationships.get(0, 1).friendship < before);
        let e = w
            .events
            .iter()
            .find(|e| e.kind == EventKind::Fight)
            .expect("fight event");
        assert!(
            w.sims[e.b as usize]
                .feelings
                .iter()
                .any(|m| w.content.feelings[m.def].id == "lost")
        );
    }

    #[test]
    fn relationships_drift_daily_and_feelings_expire() {
        let mut w = town(
            r#"{"name":"A","x":3.5,"z":3.5},{"name":"B","x":12.5,"z":12.5}"#,
            "",
        );
        w.autonomy = false;
        w.relationships.get_mut(0, 1).friendship = 60.0;
        crate::social::add_feeling(&mut w.sims[0].feelings, 0, &w.content.feelings, w.tick);
        ticks(&mut w, TICKS_PER_DAY);
        assert!(w.relationships.get(0, 1).friendship < 60.0);
        assert!(w.sims[0].feelings.is_empty());
    }
}
