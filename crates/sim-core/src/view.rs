//! Low-frequency JSON views for the UI and for world structure.
//! Never used in the per-frame render path.

use serde::Serialize;

use crate::clock;
use crate::lot::Edge;
use crate::social::SocialEvent;
use crate::world::{Phase, Task, TaskKind, World};
use crate::{MINUTES_PER_TICK, conversation};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UiState<'a> {
    day: u32,
    /// 0 = Monday.
    weekday: u32,
    minute: f32,
    speed: u8,
    autonomy: bool,
    sims: Vec<SimView<'a>>,
    households: Vec<FundsView>,
    relationships: Vec<RelView>,
    /// Most recent social events, oldest first.
    events: Vec<&'a SocialEvent>,
}

#[derive(Serialize)]
struct FundsView {
    id: u32,
    funds: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SimView<'a> {
    id: u32,
    name: &'a str,
    household: u32,
    traits: &'a [String],
    perks: &'a [String],
    needs: &'a [f32],
    mood: f32,
    emotion: Option<&'a str>,
    moodlets: Vec<MoodletView<'a>>,
    actions: Vec<ActionView>,
    /// Plot the Sim is on (None on the street or at work).
    plot: Option<u32>,
    /// Minute of day the Sim returns from work, if away.
    away_until: Option<f32>,
    visiting: Option<u32>,
    job: Option<JobView<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobView<'a> {
    career: &'a str,
    career_label: &'a str,
    title: &'a str,
    level: usize,
    levels: usize,
    performance: f32,
    pay: i64,
    start_hour: f32,
    hours: f32,
    /// Weekday indices, 0 = Monday.
    days: Vec<u8>,
    next_title: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MoodletView<'a> {
    id: &'a str,
    label: &'a str,
    mood: f32,
    minutes_left: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionView {
    label: String,
    object: Option<u32>,
    /// The other Sim, for social actions.
    target: Option<u32>,
    progress: f32,
    directed: bool,
    active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RelView {
    a: u32,
    b: u32,
    friendship: f32,
    romance: f32,
    partners: bool,
    chemistry: f32,
}

pub fn ui_state_json(world: &World) -> String {
    let content = &world.content;
    let n = content.needs.len();
    let host_name = |plot: u32| {
        world
            .households
            .iter()
            .find(|h| h.plot == Some(plot))
            .map_or_else(
                || world.plots[plot as usize].name.clone(),
                |h| format!("the {}s", h.name),
            )
    };
    let action = |task: &Task, phase: Option<&Phase>| {
        let (label, object, target, minutes) = match task.kind {
            TaskKind::Use {
                object,
                interaction,
            } => {
                let inter =
                    &content.objects[world.objects[object as usize].def].interactions[interaction];
                (inter.label.clone(), Some(object), None, inter.minutes)
            }
            TaskKind::MoveTo { .. } => ("Go here".to_owned(), None, None, 1.0),
            TaskKind::Social { target, social } => {
                let s = &content.socials[social];
                let minutes = match phase {
                    Some(Phase::Conversing { success, .. }) => conversation::duration(s, *success),
                    _ => s.minutes,
                };
                (s.label.clone(), None, Some(target), minutes)
            }
            TaskKind::Work => ("Go to work".to_owned(), None, None, 1.0),
            TaskKind::Visit { plot } => (format!("Visit {}", host_name(plot)), None, None, 1.0),
            TaskKind::GoHome => ("Go home".to_owned(), None, None, 1.0),
        };
        let progress = match phase {
            Some(Phase::Using { elapsed }) | Some(Phase::Conversing { elapsed, .. }) => {
                (elapsed / minutes).min(1.0)
            }
            _ => 0.0,
        };
        ActionView {
            label,
            object,
            target,
            progress,
            directed: task.directed,
            active: phase.is_some(),
        }
    };

    let sims = world
        .sims
        .iter()
        .map(|s| {
            let mut actions = Vec::new();
            if let Some(until) = s.away_until {
                let left = until.saturating_sub(world.tick) as f32 * MINUTES_PER_TICK;
                let total = s.job.as_ref().map_or(1.0, |j| {
                    content.careers[j.career].levels[j.level].hours * 60.0
                });
                actions.push(ActionView {
                    label: "At work".to_owned(),
                    object: None,
                    target: None,
                    progress: (1.0 - left / total).clamp(0.0, 1.0),
                    directed: true,
                    active: true,
                });
            }
            // Being talked to shows up as the current action.
            if let Some(a) = s.engaged_with
                && let Some((_, social, _, progress)) = world.sims[a as usize].conversation(content)
            {
                actions.push(ActionView {
                    label: content.socials[social].label.clone(),
                    object: None,
                    target: Some(a),
                    progress,
                    directed: false,
                    active: true,
                });
            }
            actions.extend(s.current().map(|a| action(&a.task, Some(&a.phase))));
            actions.extend(s.queue().map(|t| action(t, None)));
            let moodlets = s
                .moodlets
                .iter()
                .map(|m| {
                    let def = &content.moodlets[m.def];
                    let left = m.expires.saturating_sub(world.tick) as f32 * MINUTES_PER_TICK;
                    MoodletView {
                        id: &def.id,
                        label: &def.label,
                        mood: def.mood,
                        minutes_left: left.min(def.minutes),
                    }
                })
                .collect();
            let job = s.job.as_ref().map(|j| {
                let career = &content.careers[j.career];
                let level = &career.levels[j.level];
                JobView {
                    career: &career.id,
                    career_label: &career.label,
                    title: &level.title,
                    level: j.level,
                    levels: career.levels.len(),
                    performance: j.performance,
                    pay: level.pay,
                    start_hour: level.start_hour,
                    hours: level.hours,
                    days: (0..7).filter(|d| level.days & (1 << d) != 0).collect(),
                    next_title: career.levels.get(j.level + 1).map(|l| l.title.as_str()),
                }
            });
            let (x, z) = s.tile();
            SimView {
                id: s.id,
                name: &s.name,
                household: s.household,
                traits: &s.traits,
                perks: &s.perks,
                needs: &s.needs[..n],
                mood: s.mood(content),
                emotion: s.emotion(content).map(|e| content.emotions[e].id.as_str()),
                moodlets,
                actions,
                plot: if s.away_until.is_some() {
                    None
                } else {
                    world.plot_at(x, z)
                },
                away_until: s.away_until.map(clock::minute_of_day),
                visiting: s.visiting.map(|v| v.plot),
                job,
            }
        })
        .collect();

    let rels = &world.relationships;
    let mut relationships = Vec::new();
    for a in 0..world.sims.len() {
        for b in 0..world.sims.len() {
            let r = rels.get(a, b);
            if a != b && r.met {
                relationships.push(RelView {
                    a: a as u32,
                    b: b as u32,
                    friendship: r.friendship,
                    romance: r.romance,
                    partners: r.partners,
                    chemistry: rels.chemistry(a, b),
                });
            }
        }
    }

    let skip = world.events.iter().count().saturating_sub(20);
    let events: Vec<&SocialEvent> = world.events.iter().skip(skip).collect();
    let day = clock::day(world.tick);

    serde_json::to_string(&UiState {
        day,
        weekday: clock::weekday(day),
        minute: clock::minute_of_day(world.tick),
        speed: world.speed,
        autonomy: world.autonomy,
        sims,
        households: world
            .households
            .iter()
            .map(|h| FundsView {
                id: h.id,
                funds: h.funds,
            })
            .collect(),
        relationships,
        events,
    })
    .expect("UI state serializes")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StructureView<'a> {
    version: u32,
    width: usize,
    depth: usize,
    objects: Vec<ObjectView<'a>>,
    sims: Vec<SimInfo<'a>>,
    households: Vec<HouseholdView<'a>>,
    plots: Vec<PlotView<'a>>,
    exits: &'a [[f32; 2]],
    rooms: &'a [u16],
    meta: &'a serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObjectView<'a> {
    id: u32,
    def: &'a str,
    x: i32,
    z: i32,
    rot: u8,
    w: i32,
    d: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SimInfo<'a> {
    id: u32,
    name: &'a str,
    household: u32,
    gender: &'a str,
    attracted_to: &'a [String],
    appearance: &'a serde_json::Value,
    traits: &'a [String],
    perks: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdView<'a> {
    id: u32,
    name: &'a str,
    plot: Option<u32>,
    player: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlotView<'a> {
    id: u32,
    name: &'a str,
    x: i32,
    z: i32,
    w: i32,
    d: i32,
    public: bool,
    entry: Option<[f32; 2]>,
    /// Bounding box of the walls on this plot `[x0, z0, x1, z1]`, if any (for silhouettes).
    house: Option<[i32; 4]>,
}

/// Bounding box of all wall/door edges inside a plot.
fn house_bounds(world: &World, x0: i32, z0: i32, x1: i32, z1: i32) -> Option<[i32; 4]> {
    let lot = &world.lot;
    let mut b: Option<[i32; 4]> = None;
    let mut add = |ax: i32, az: i32, bx: i32, bz: i32| {
        b = Some(match b {
            None => [ax, az, bx, bz],
            Some([a0, b0, a1, b1]) => [a0.min(ax), b0.min(az), a1.max(bx), b1.max(bz)],
        });
    };
    for z in z0..=z1.min(lot.depth as i32) {
        for x in x0..x1.min(lot.width as i32) {
            if z < lot.depth as i32 + 1 && lot.h_edge(x as usize, z as usize) != Edge::Open {
                add(x, z, x + 1, z);
            }
        }
    }
    for z in z0..z1.min(lot.depth as i32) {
        for x in x0..=x1.min(lot.width as i32) {
            if lot.v_edge(x as usize, z as usize) != Edge::Open {
                add(x, z, x, z + 1);
            }
        }
    }
    b
}

pub fn structure_json(world: &World) -> String {
    let content = &world.content;
    let objects = world
        .objects
        .iter()
        .map(|o| {
            let (w, d) = o.size(content);
            ObjectView {
                id: o.id,
                def: &content.objects[o.def].id,
                x: o.x,
                z: o.z,
                rot: o.rot,
                w,
                d,
            }
        })
        .collect();
    let sims = world
        .sims
        .iter()
        .map(|s| SimInfo {
            id: s.id,
            name: &s.name,
            household: s.household,
            gender: &s.gender,
            attracted_to: &s.attracted_to,
            appearance: &s.appearance,
            traits: &s.traits,
            perks: &s.perks,
        })
        .collect();
    let households = world
        .households
        .iter()
        .map(|h| HouseholdView {
            id: h.id,
            name: &h.name,
            plot: h.plot,
            player: h.player,
        })
        .collect();
    let plots = world
        .plots
        .iter()
        .map(|p| PlotView {
            id: p.id,
            name: &p.name,
            x: p.x,
            z: p.z,
            w: p.w,
            d: p.d,
            public: p.public,
            entry: p.entry,
            house: house_bounds(world, p.x, p.z, p.x + p.w, p.z + p.d),
        })
        .collect();
    serde_json::to_string(&StructureView {
        version: world.structure_version(),
        width: world.lot.width,
        depth: world.lot.depth,
        objects,
        sims,
        households,
        plots,
        exits: &world.exits,
        rooms: world.lot.rooms(),
        meta: &world.meta,
    })
    .expect("structure serializes")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OptionView<'a> {
    index: usize,
    id: &'a str,
    label: &'a str,
    category: &'a str,
    chance: f32,
}

/// What `actor` can do with `target`, for the social menu.
pub fn social_options_json(world: &World, actor: usize, target: usize) -> String {
    let options: Vec<OptionView> = conversation::options(world, actor, target)
        .into_iter()
        .map(|(i, chance)| {
            let s = &world.content.socials[i];
            OptionView {
                index: i,
                id: &s.id,
                label: &s.label,
                category: &s.category,
                chance,
            }
        })
        .collect();
    serde_json::to_string(&options).expect("options serialize")
}
