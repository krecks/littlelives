//! Save games: a versioned, content-independent snapshot of the world.
//!
//! Objects, traits, perks, needs, interactions, feelings and careers are stored by id
//! (not index), so saves survive content changes; anything that no longer exists is
//! dropped on load. In-progress activities restart from the beginning on load.
//!
//! Version history: 1 = single household; 2 = town (households, plots), relationships,
//! feelings, gender and attraction; 3 = jobs, funds, visits, exits; 4 = skills, object
//! quality/style/value, household style; 5 = diagonal walls (`lot.diagonals`, absent in
//! older files, which load without any); 6 = wall looks (`lot.looks`: coverings, half walls,
//! door and window styles, by content id; absent: plain walls); 7 = floor coverings
//! (`lot.floors`, by content id; absent: automatic floors); 8 = free will per household,
//! the story log (`events`), job satisfaction and missed shifts, visits always end (absent:
//! one town-wide free-will switch, no story, a fresh start in every job); 9 = planners
//! (routines, goals, how blocks went, wishes) and household routine templates (absent: none);
//! 10 = the game mode (`mode`: Living or Creative; absent: Living), and the player's household
//! may have nobody living in it yet; 11 = objects turned freely (`turn`, absent: 0), fences
//! and gates (edges `4` and `5`, their fence style in `looks`), roofs (`plots[].roof`: roof
//! style and colour ids); 12 = per-tile dirt (`dirt`), the surroundings need, tidying up,
//! object wear and repairs; 13 = ages (`sims[].age`; absent: from content `life.startAge`)
//! and the lifespan (`lifespan`; absent: off, so older games don't start aging by surprise),
//! residents who are gone (`sims[].gone`) and former residents the story names (`former`).
//! Older files load. Saves written before feelings
//! were renamed from "moodlets" store them under `moodlets`; a serde alias still reads it.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::content::{Content, Pose};
use crate::life::{Job, Visit};
use crate::lot::{DiagDir, Diagonal, Edge, EdgeLook, EdgeRef, Lot, SimSpawn};
use crate::rng::Rng;
use crate::social::{self, Relationship};
use crate::planner::{BlockResult, Goal, HomeWish, Outcome, Planner, Reason, Routine};
use crate::world::{GameMode, Household, Plot, Task, TaskKind, World};
use crate::{Error, MINUTES_PER_TICK, clock::MAX_SPEED};

pub const SAVE_VERSION: u32 = 13;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFile {
    pub version: u32,
    /// Living or Creative (absent before v10: Living).
    #[serde(default)]
    pub mode: GameMode,
    /// Dirty tiles: `[x, z, dirt × 255]` (absent before v12: clean).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dirt: Vec<[u16; 3]>,
    pub tick: u64,
    pub speed: u8,
    pub autonomy: bool,
    /// How fast residents age (absent before v13: off).
    #[serde(default)]
    pub lifespan: Option<crate::lifecycle::Lifespan>,
    pub rng: u32,
    pub lot: LotSave,
    pub objects: Vec<ObjectSave>,
    pub sims: Vec<SimSave>,
    #[serde(default)]
    pub households: Vec<HouseholdSave>,
    #[serde(default)]
    pub plots: Vec<PlotSave>,
    #[serde(default)]
    pub relationships: Vec<RelationshipSave>,
    #[serde(default)]
    pub meta: serde_json::Value,
    #[serde(default)]
    pub exits: Vec<[f32; 2]>,
    /// The story so far, oldest first (absent before v8). Events name residents by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<serde_json::Value>,
    #[serde(default)]
    pub next_event_id: u64,
    /// People whose slot someone new took (events name them with `social::FORMER`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub former: Vec<crate::world::Former>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LotSave {
    pub width: usize,
    pub depth: usize,
    /// One character per edge: `0` open, `1` wall, `2` door, `3` window.
    pub h_edges: String,
    pub v_edges: String,
    /// One character per tile (row-major): `0` none; `/` diagonals `1` wall, `2` door,
    /// `3` window; `\` diagonals `4` wall, `5` door, `6` window. Empty when the lot has no
    /// diagonal walls (and in saves from before they existed).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub diagonals: String,
    /// Walls that don't look plain (absent in older saves).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub looks: Vec<LookSave>,
    /// Tiles with a floor covering (absent in older saves).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub floors: Vec<FloorSave>,
}

/// A tile's floor covering, by content id (unknown ids load as the automatic floor).
#[derive(Debug, Serialize, Deserialize)]
pub struct FloorSave {
    pub x: u16,
    pub z: u16,
    pub covering: String,
}

/// A wall's look, by content id so it survives content changes (unknown ids load as the
/// default look). `at`: `h`, `v` or `d` (the diagonal across tile `x, z`).
#[derive(Debug, Serialize, Deserialize)]
pub struct LookSave {
    pub at: String,
    pub x: u16,
    pub z: u16,
    /// Wall covering id of each face; empty for the automatic look.
    #[serde(default)]
    pub faces: [String; 2],
    #[serde(default, skip_serializing_if = "is_zero")]
    pub form: u8,
    /// Door or window style id (empty for none).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub style: String,
}

fn is_zero(n: &u8) -> bool {
    *n == 0
}

fn is_unworn(w: &f32) -> bool {
    *w <= 0.0
}

fn is_zero_u32(n: &u32) -> bool {
    *n == 0
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ObjectSave {
    pub def: String,
    pub x: i32,
    pub z: i32,
    pub rot: u8,
    #[serde(default)]
    pub quality: u8,
    #[serde(default)]
    pub style: u8,
    /// Money put into it; defaults to the price.
    #[serde(default)]
    pub value: Option<i64>,
    /// Degrees past the facing (objects that turn freely; absent before v11: 0).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub turn: u8,
    /// Wear, 0..1 (broken at 1; absent before v12: new).
    #[serde(default, skip_serializing_if = "is_unworn")]
    pub wear: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimSave {
    pub name: String,
    pub appearance: serde_json::Value,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default)]
    pub attracted_to: Option<Vec<String>>,
    #[serde(default)]
    pub household: u32,
    pub traits: Vec<String>,
    pub perks: Vec<String>,
    /// Age in years (absent before v13).
    #[serde(default)]
    pub age: Option<f32>,
    /// Died or moved away (the slot stays so ids don't change).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gone: Option<crate::world::Gone>,
    pub pos: [f32; 2],
    pub yaw: f32,
    /// Sorted so identical worlds produce identical save files.
    pub needs: BTreeMap<String, f32>,
    #[serde(default)]
    #[serde(alias = "moodlets")] // key before the moodlet → feeling rename
    pub feelings: Vec<FeelingSave>,
    /// Skill levels by id (sorted). Missing in old saves: traits decide.
    #[serde(default)]
    pub skills: BTreeMap<String, f32>,
    #[serde(default)]
    pub job: Option<JobSave>,
    /// First day to look for work again (after quitting or being let go).
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub job_search_from: u32,
    /// Minutes left at work, if away.
    #[serde(default)]
    pub away_minutes: Option<f32>,
    /// Plot being visited, and minutes left (`None` in saves before v8: the player's visits
    /// had no end).
    #[serde(default)]
    pub visiting: Option<(u32, Option<f32>)>,
    /// Current activity first, then the queue.
    pub tasks: Vec<TaskSave>,
    /// Routines and goals (absent before v9). A block in progress starts over on load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub planner: Option<PlannerSave>,
}

/// A resident's planner, by content id.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlannerSave {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub routines: Vec<RoutineSave>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub skip_household: Vec<u16>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub goals: Vec<GoalSave>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub suggestions: Vec<GoalSave>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<BlockResultSave>,
    /// `(activity, skill)` ids.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub wishes: Vec<(String, Option<String>)>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub home_wishes: Vec<HomeWishSave>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waited_day: Option<u32>,
    pub reviewed: u32,
}

/// A wish about the home: a better room (`room`: room kind id, "garden", or absent for a room
/// nothing marks; `factor`: "size", "light", ...), a fix (`fix`: object id) or another room of
/// a kind (`another`: room kind id).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct HomeWishSave {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub factor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub another: Option<String>,
}

pub(crate) fn home_wish_save(content: &Content, w: &HomeWish) -> HomeWishSave {
    let kind = |k: usize| content.room_kinds[k].id.clone();
    match *w {
        HomeWish::Room { kind: k, garden, factor } => HomeWishSave {
            room: if garden { Some("garden".into()) } else { k.map(kind) },
            factor: Some(crate::rooms::FACTORS[factor as usize].into()),
            ..Default::default()
        },
        HomeWish::Fix { def } => HomeWishSave { fix: Some(content.objects[def].id.clone()), ..Default::default() },
        HomeWish::Another { kind: k } => HomeWishSave { another: Some(kind(k)), ..Default::default() },
    }
}

fn home_wish_load(content: &Content, w: &HomeWishSave) -> Option<HomeWish> {
    let kind = |id: &str| content.room_kinds.iter().position(|k| k.id == id);
    if let Some(f) = &w.fix {
        return Some(HomeWish::Fix { def: content.object_index(f)? });
    }
    if let Some(a) = &w.another {
        return Some(HomeWish::Another { kind: kind(a)? });
    }
    let factor = crate::rooms::FACTORS.iter().position(|f| Some(*f) == w.factor.as_deref())? as u8;
    let garden = w.room.as_deref() == Some("garden");
    let k = match w.room.as_deref() {
        Some(id) if !garden => Some(kind(id)?),
        _ => None,
    };
    Some(HomeWish::Room { kind: k, garden, factor })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoutineSave {
    pub id: u16,
    pub activity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    pub days: u8,
    pub start: u16,
    pub minutes: u16,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalSave {
    pub def: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub target: f32,
    pub since_day: u32,
    pub start: f32,
    pub progress: f32,
    pub history: [f32; 3],
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlockResultSave {
    pub routine: u16,
    pub household: bool,
    pub activity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    pub day: u32,
    pub start: u16,
    pub minutes: u16,
    /// `kept`, `cut`, `skipped`, `noPlace`.
    pub outcome: String,
    /// `trait:<id>`, `need:<id>`, `mood`, `away`, `noPlace`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub done: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSave {
    pub career: String,
    pub level: usize,
    pub performance: f32,
    pub last_shift_day: u32,
    #[serde(default)]
    pub satisfaction: Option<f32>,
    #[serde(default)]
    pub shifts: u32,
    #[serde(default)]
    pub missed: u8,
    /// Mood when leaving for the current shift (absent before v8).
    #[serde(default)]
    pub shift_mood: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeelingSave {
    pub id: String,
    pub minutes_left: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TaskSave {
    Use {
        object: u32,
        interaction: String,
        directed: bool,
    },
    MoveTo {
        x: f32,
        z: f32,
        directed: bool,
    },
    Social {
        target: u32,
        social: String,
        directed: bool,
    },
    Work,
    Visit {
        plot: u32,
        directed: bool,
    },
    GoHome {
        directed: bool,
    },
    Clean {
        x: i32,
        z: i32,
        directed: bool,
    },
    Repair {
        object: u32,
        directed: bool,
    },
    Spot {
        accident: String,
    },
    /// Old saves only (upgrades are instant now); dropped on load.
    Upgrade {
        #[allow(dead_code)]
        object: u32,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HouseholdSave {
    pub name: String,
    pub plot: Option<u32>,
    pub player: bool,
    #[serde(default)]
    pub funds: Option<i64>,
    #[serde(default)]
    pub style: u8,
    /// Absent before v8, when free will was one switch for the whole town (`autonomy`).
    #[serde(default, rename = "freeWill", skip_serializing_if = "Option::is_none")]
    pub free_will: Option<bool>,
    /// Routine template for every member (absent before v9).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routines: Vec<RoutineSave>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlotSave {
    pub name: String,
    pub x: i32,
    pub z: i32,
    pub w: i32,
    pub d: i32,
    pub public: bool,
    #[serde(default)]
    pub entry: Option<[f32; 2]>,
    /// The roof the player chose: roof style and colour ids (absent before v11: the town's look).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roof: Option<[String; 2]>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RelationshipSave {
    pub a: u32,
    pub b: u32,
    #[serde(flatten)]
    pub rel: Relationship,
    pub chemistry: f32,
}

impl World {
    pub fn to_save(&self) -> SaveFile {
        let content = &self.content;
        let (h, v) = self.lot.edges();
        let minutes_left = |until: u64| until.saturating_sub(self.tick) as f32 * MINUTES_PER_TICK;
        let objects = self
            .objects
            .iter()
            .map(|o| ObjectSave {
                def: content.objects[o.def].id.clone(),
                x: o.x,
                z: o.z,
                rot: o.rot,
                quality: o.quality,
                style: o.style,
                value: Some(o.value),
                turn: o.turn,
                wear: o.wear,
            })
            .collect();
        let sims = self
            .sims
            .iter()
            .map(|s| {
                let mut pos = s.pos;
                // A Sim on a bed or chair stands back up in front of it.
                if let (Pose::Sit | Pose::Lie, Some(act)) = (s.pose, s.current())
                    && let TaskKind::Use { object, .. } = act.task.kind
                {
                    let (fx, fz) = self.objects[object as usize].front_tile(content);
                    pos = [fx as f32 + 0.5, fz as f32 + 0.5];
                }
                let tasks = s
                    .current()
                    .map(|a| &a.task)
                    .into_iter()
                    .chain(s.queue())
                    .map(|t| self.task_save(t))
                    .collect();
                let feelings = s
                    .feelings
                    .iter()
                    .map(|m| FeelingSave {
                        id: content.feelings[m.def].id.clone(),
                        minutes_left: minutes_left(m.expires),
                    })
                    .collect();
                SimSave {
                    name: s.name.clone(),
                    appearance: s.appearance.clone(),
                    gender: Some(s.gender.clone()),
                    attracted_to: Some(s.attracted_to.clone()),
                    household: s.household,
                    traits: s.traits.clone(),
                    perks: s.perks.clone(),
                    age: Some(s.age),
                    gone: s.gone,
                    pos,
                    yaw: s.yaw,
                    needs: content
                        .needs
                        .iter()
                        .enumerate()
                        .map(|(i, n)| (n.id.clone(), s.needs[i]))
                        .collect(),
                    feelings,
                    skills: content
                        .skills
                        .iter()
                        .enumerate()
                        .map(|(i, k)| (k.id.clone(), s.skills[i]))
                        .collect(),
                    job: s.job.as_ref().map(|j| JobSave {
                        career: content.careers[j.career].id.clone(),
                        level: j.level,
                        performance: j.performance,
                        last_shift_day: j.last_shift_day,
                        satisfaction: Some(j.satisfaction),
                        shifts: j.shifts,
                        missed: j.missed,
                        shift_mood: Some(j.shift_mood),
                    }),
                    job_search_from: s.job_search_from,
                    away_minutes: s.away_until.map(minutes_left),
                    visiting: s
                        .visiting
                        .map(|v| (v.plot, Some(minutes_left(v.until)))),
                    tasks,
                    planner: planner_save(content, &s.planner),
                }
            })
            .collect();
        let n = self.sims.len();
        let mut relationships = Vec::new();
        for a in 0..n {
            for b in 0..n {
                let rel = *self.relationships.get(a, b);
                let chemistry = self.relationships.chemistry(a, b);
                if a != b && (rel != Relationship::default() || chemistry != 0.0) {
                    relationships.push(RelationshipSave {
                        a: a as u32,
                        b: b as u32,
                        rel,
                        chemistry,
                    });
                }
            }
        }
        SaveFile {
            version: SAVE_VERSION,
            mode: self.mode,
            dirt: self
                .dirt
                .iter()
                .enumerate()
                .filter(|(_, d)| **d >= 1.0 / 255.0)
                .map(|(i, d)| [(i % self.lot.width) as u16, (i / self.lot.width) as u16, (d * 255.0).round() as u16])
                .collect(),
            tick: self.tick,
            speed: self.speed,
            autonomy: self.autonomy,
            lifespan: Some(self.lifespan),
            rng: self.rng.state(),
            lot: LotSave {
                width: self.lot.width,
                depth: self.lot.depth,
                h_edges: encode(h),
                v_edges: encode(v),
                diagonals: encode_diagonals(self.lot.diagonals()),
                looks: encode_looks(&self.lot, &self.content),
                floors: encode_floors(&self.lot, &self.content),
            },
            objects,
            sims,
            households: self
                .households
                .iter()
                .map(|h| HouseholdSave {
                    name: h.name.clone(),
                    plot: h.plot,
                    player: h.player,
                    funds: Some(h.funds),
                    style: h.style,
                    free_will: Some(h.free_will),
                    routines: h.routines.iter().map(|r| routine_save(content, r)).collect(),
                })
                .collect(),
            plots: self
                .plots
                .iter()
                .map(|p| PlotSave {
                    name: p.name.clone(),
                    x: p.x,
                    z: p.z,
                    w: p.w,
                    d: p.d,
                    public: p.public,
                    entry: p.entry,
                    roof: p.roof.map(|r| {
                        let b = &content.build;
                        let id = |list: &[crate::content::BuildStyle], i: u8| {
                            list.get(i as usize).map_or(String::new(), |s| s.id.clone())
                        };
                        [id(&b.roofs, r.style), id(&b.roof_colors, r.color)]
                    }),
                })
                .collect(),
            relationships,
            meta: self.meta.clone(),
            exits: self.exits.clone(),
            events: self
                .events
                .iter()
                .map(|e| serde_json::to_value(e).expect("event serializes"))
                .collect(),
            next_event_id: self.events.last_id(),
            former: self.former.clone(),
        }
    }

    pub fn save_json(&self) -> String {
        serde_json::to_string(&self.to_save()).expect("save serializes")
    }

    pub fn from_save_json(content_json: &str, save_json: &str) -> Result<Self, Error> {
        let content = Content::from_json(content_json)?;
        let save: SaveFile = serde_json::from_str(save_json)?;
        Self::from_save(content, &save)
    }

    pub fn from_save(content: Content, save: &SaveFile) -> Result<Self, Error> {
        if save.version == 0 || save.version > SAVE_VERSION {
            return Err(Error::new(format!(
                "unsupported save version {}",
                save.version
            )));
        }
        let mut lot = Lot::from_edges(
            save.lot.width,
            save.lot.depth,
            decode(&save.lot.h_edges)?,
            decode(&save.lot.v_edges)?,
            decode_diagonals(&save.lot.diagonals)?,
        )?;
        decode_looks(&mut lot, &content, &save.lot.looks);
        decode_floors(&mut lot, &content, &save.lot.floors);
        let mut world = World::empty(content, lot, Rng::new(save.rng));
        world.mode = save.mode;
        world.tick = save.tick;
        world.speed = save.speed.min(MAX_SPEED);
        // Before v8 the one free-will switch was the player's setting; now each household has one.
        let legacy_free_will = save.version < 8;
        world.autonomy = save.autonomy || legacy_free_will;
        world.lifespan = save.lifespan.unwrap_or(crate::lifecycle::Lifespan::Off);
        world.meta = save.meta.clone();
        world.exits = save.exits.clone();
        world.plots = save
            .plots
            .iter()
            .enumerate()
            .map(|(i, p)| Plot {
                id: i as u32,
                name: p.name.clone(),
                x: p.x,
                z: p.z,
                w: p.w,
                d: p.d,
                public: p.public,
                entry: p.entry,
                roof: p.roof.as_ref().and_then(|[style, color]| {
                    let b = &world.content.build;
                    let index = |list: &[crate::content::BuildStyle], id: &str| {
                        list.iter().position(|s| s.id == id).map(|i| i as u8)
                    };
                    // A style or colour the content no longer has falls back to the first.
                    let style = index(&b.roofs, style).unwrap_or(0);
                    let color = index(&b.roof_colors, color).unwrap_or(0);
                    (!b.roofs.is_empty()).then_some(crate::world::RoofLook { style, color })
                }),
            })
            .collect();
        let starting_funds = world.content.starting_funds;
        world.households = if save.households.is_empty() {
            vec![Household {
                id: 0,
                name: "Household".into(),
                plot: None,
                player: true,
                funds: starting_funds,
                style: 0,
                free_will: save.autonomy,
                routines: Vec::new(),
            }]
        } else {
            save.households
                .iter()
                .enumerate()
                .map(|(i, h)| Household {
                    id: i as u32,
                    name: h.name.clone(),
                    plot: h.plot,
                    player: h.player,
                    funds: h.funds.unwrap_or(starting_funds),
                    style: h.style,
                    free_will: h
                        .free_will
                        .unwrap_or(!h.player || save.autonomy || !legacy_free_will),
                    routines: h
                        .routines
                        .iter()
                        .filter_map(|r| routine_load(&world.content, r))
                        .collect(),
                })
                .collect()
        };

        // Keep object ids stable: a removed object type would shift ids, so tasks are remapped.
        let mut object_ids = HashMap::new();
        for (i, o) in save.objects.iter().enumerate() {
            let placed = match world.content.object_index(&o.def) {
                Some(def) => {
                    let value = o
                        .value
                        .unwrap_or(world.content.objects[def].price.unwrap_or(0));
                    let style = world.check_style(o.style).unwrap_or(0);
                    world.place(def, o.x, o.z, o.rot, style, o.quality, value)
                }
                None => world.place_object(&o.def, o.x, o.z, o.rot),
            };
            match placed {
                Ok(id) => {
                    let obj = &world.objects[id as usize];
                    let turn = world.check_turn(obj.def, o.turn).unwrap_or(0);
                    world.objects[id as usize].turn = turn;
                    world.objects[id as usize].wear = o.wear.clamp(0.0, 1.0);
                    object_ids.insert(i as u32, id);
                }
                Err(_) if world.content.object_index(&o.def).is_none() => {} // content no longer has it
                Err(e) => return Err(e),
            }
        }
        for s in &save.sims {
            let spawn = SimSpawn {
                name: s.name.clone(),
                gender: s.gender.clone(),
                attracted_to: s.attracted_to.clone(),
                household: s.household,
                job: None,
                appearance: s.appearance.clone(),
                traits: s.traits.clone(),
                perks: s.perks.clone(),
                age: s.age,
                skills: Default::default(),
                x: s.pos[0],
                z: s.pos[1],
            };
            world.spawn_sim(&spawn)?;
        }
        let n = world.sims.len();
        let plot_count = world.plots.len();
        let tick = world.tick;
        let after = |minutes: f32| tick + social::minutes_to_ticks(minutes);
        for (id, s) in save.sims.iter().enumerate() {
            let content = &world.content;
            let sim = &mut world.sims[id];
            sim.yaw = s.yaw;
            sim.gone = s.gone;
            for (i, need) in content.needs.iter().enumerate() {
                sim.needs[i] = s
                    .needs
                    .get(&need.id)
                    .copied()
                    .unwrap_or(0.75)
                    .clamp(0.0, 1.0);
            }
            for m in &s.feelings {
                if let Some(def) = content.feeling_index(&m.id) {
                    let expires = after(m.minutes_left.min(content.feelings[def].minutes));
                    sim.feelings.push(social::ActiveFeeling { def, expires });
                }
            }
            for (i, skill) in content.skills.iter().enumerate() {
                if let Some(&v) = s.skills.get(&skill.id) {
                    sim.skills[i] = v.clamp(0.0, content.skill_rules.max_level);
                }
            }
            sim.job = s.job.as_ref().and_then(|j| {
                let career = content.career_index(&j.career)?;
                let level = j.level.min(content.careers[career].levels.len() - 1);
                let mut job = Job::new(career, level, j.last_shift_day);
                job.performance = j.performance;
                job.satisfaction = j.satisfaction.unwrap_or(job.satisfaction);
                job.shifts = j.shifts;
                job.missed = j.missed;
                job.shift_mood = j.shift_mood.unwrap_or(job.shift_mood);
                Some(job)
            });
            sim.job_search_from = s.job_search_from;
            if let Some(p) = &s.planner {
                sim.planner = planner_load(content, p);
            }
            sim.away_until = s.away_minutes.filter(|_| sim.job.is_some()).map(after);
            sim.visiting = s.visiting.and_then(|(plot, left)| {
                ((plot as usize) < plot_count).then(|| Visit {
                    plot,
                    // Visits without an end (player visits before v8) last as long as a
                    // player visit does now.
                    until: after(left.unwrap_or(content.visits.directed_hours * 60.0)),
                })
            });
            for t in &s.tasks {
                let task = match t {
                    TaskSave::Use {
                        object,
                        interaction,
                        directed,
                    } => {
                        let Some(&object) = object_ids.get(object) else {
                            continue;
                        };
                        let def = &content.objects[world.objects[object as usize].def];
                        let Some(interaction) =
                            def.interactions.iter().position(|i| &i.id == interaction)
                        else {
                            continue;
                        };
                        Task {
                            kind: TaskKind::Use {
                                object,
                                interaction,
                            },
                            directed: *directed,
                        }
                    }
                    TaskSave::MoveTo { x, z, directed } => Task {
                        kind: TaskKind::MoveTo { x: *x, z: *z },
                        directed: *directed,
                    },
                    TaskSave::Social {
                        target,
                        social,
                        directed,
                    } => {
                        let Some(social) = content.social_index(social) else {
                            continue;
                        };
                        if *target as usize >= n || *target as usize == id {
                            continue;
                        }
                        Task {
                            kind: TaskKind::Social {
                                target: *target,
                                social,
                            },
                            directed: *directed,
                        }
                    }
                    TaskSave::Work => Task {
                        kind: TaskKind::Work,
                        directed: true,
                    },
                    TaskSave::Visit { plot, directed } => {
                        if *plot as usize >= plot_count {
                            continue;
                        }
                        Task {
                            kind: TaskKind::Visit { plot: *plot },
                            directed: *directed,
                        }
                    }
                    TaskSave::GoHome { directed } => Task {
                        kind: TaskKind::GoHome,
                        directed: *directed,
                    },
                    TaskSave::Clean { x, z, directed } => Task {
                        kind: TaskKind::Clean { x: *x, z: *z },
                        directed: *directed,
                    },
                    // (An accident's while on the spot doesn't outlast a reload.)
                    TaskSave::Spot { .. } => continue,
                    TaskSave::Repair { object, directed } => {
                        let Some(&object) = object_ids.get(object) else {
                            continue;
                        };
                        Task {
                            kind: TaskKind::Repair { object },
                            directed: *directed,
                        }
                    }
                    // Upgrades used to be a Sim task; they are instant purchases now.
                    TaskSave::Upgrade { .. } => continue,
                };
                sim.queue.push_back(task);
            }
        }

        if save.version < 2 || save.relationships.is_empty() {
            // Older saves have no relationships: start the household as housemates.
            world.init_relationships(&[])?;
        } else {
            for r in &save.relationships {
                let (a, b) = (r.a as usize, r.b as usize);
                if a < n && b < n && a != b {
                    *world.relationships.get_mut(a, b) = r.rel;
                    world.relationships.set_chemistry(a, b, r.chemistry);
                }
            }
        }
        // Buffs from saved feelings apply straight away.
        for sim in &mut world.sims {
            sim.refresh_buffs(&world.content);
        }
        // Spawning consumed random numbers; restore the saved stream.
        world.rng = Rng::new(save.rng);
        // The story: events about residents who no longer exist (or of kinds this version
        // doesn't know) are dropped.
        let events = save.events.iter().filter_map(|v| {
            let e: social::SocialEvent = serde_json::from_value(v.clone()).ok()?;
            let formers = save.former.len();
            let known = |s: u32| if s & social::FORMER != 0 { ((s & !social::FORMER) as usize) < formers } else { (s as usize) < n };
            (known(e.a) && known(e.b) && e.c.is_none_or(known)).then_some(e)
        });
        world.events = social::EventLog::restore(save.next_event_id, events);
        world.former = save.former.clone();
        world.dirt = vec![0.0; world.lot.width * world.lot.depth];
        for &[x, z, d] in &save.dirt {
            if world.lot.in_bounds(x as i32, z as i32) {
                let i = world.lot.tile_index(x as i32, z as i32);
                world.dirt[i] = (f32::from(d) / 255.0).min(1.0);
            }
        }
        world.refresh_rooms();
        Ok(world)
    }

    fn task_save(&self, t: &Task) -> TaskSave {
        let content = &self.content;
        match t.kind {
            TaskKind::Use {
                object,
                interaction,
            } => TaskSave::Use {
                object,
                interaction: content.objects[self.objects[object as usize].def].interactions
                    [interaction]
                    .id
                    .clone(),
                directed: t.directed,
            },
            TaskKind::MoveTo { x, z } => TaskSave::MoveTo {
                x,
                z,
                directed: t.directed,
            },
            TaskKind::Social { target, social } => TaskSave::Social {
                target,
                social: content.socials[social].id.clone(),
                directed: t.directed,
            },
            TaskKind::Work => TaskSave::Work,
            TaskKind::Visit { plot } => TaskSave::Visit {
                plot,
                directed: t.directed,
            },
            TaskKind::GoHome => TaskSave::GoHome {
                directed: t.directed,
            },
            TaskKind::Clean { x, z } => TaskSave::Clean {
                x,
                z,
                directed: t.directed,
            },
            TaskKind::Repair { object } => TaskSave::Repair {
                object,
                directed: t.directed,
            },
            TaskKind::Spot { accident } => TaskSave::Spot {
                accident: content.accidents[accident].id.clone(),
            },
        }
    }
}

fn encode(edges: &[Edge]) -> String {
    edges
        .iter()
        .map(|e| match e {
            Edge::Open => '0',
            Edge::Wall => '1',
            Edge::Door => '2',
            Edge::Window => '3',
            Edge::Fence => '4',
            Edge::Gate => '5',
        })
        .collect()
}

/// The kind of wall standing at `at` (open where there's none).
fn edge_at(lot: &Lot, at: EdgeRef) -> Edge {
    match at {
        EdgeRef::H(x, z) => lot.h_edge(x as usize, z as usize),
        EdgeRef::V(x, z) => lot.v_edge(x as usize, z as usize),
        EdgeRef::Diag(x, z) => lot.diag(x as i32, z as i32).map_or(Edge::Open, |d| d.edge),
    }
}

fn encode_looks(lot: &Lot, content: &Content) -> Vec<LookSave> {
    let b = &content.build;
    let covering = |c: u8| {
        c.checked_sub(1)
            .and_then(|i| b.coverings.get(i as usize))
            .map_or(String::new(), |s| s.id.clone())
    };
    lot.looks()
        .filter_map(|(at, look)| {
            let edge = edge_at(lot, at);
            if edge == Edge::Open {
                return None;
            }
            let styles = match edge {
                Edge::Door => &b.doors,
                Edge::Window => &b.windows,
                Edge::Fence | Edge::Gate => &b.fences,
                _ => &Vec::new(),
            };
            let (tag, x, z) = match at {
                EdgeRef::H(x, z) => ("h", x, z),
                EdgeRef::V(x, z) => ("v", x, z),
                EdgeRef::Diag(x, z) => ("d", x, z),
            };
            Some(LookSave {
                at: tag.into(),
                x,
                z,
                faces: look.sides.map(covering),
                form: look.form,
                style: styles
                    .get(look.style as usize)
                    .map_or(String::new(), |s| s.id.clone()),
            })
        })
        .collect()
}

/// Puts saved looks back on the walls they belong to; unknown ids, and looks of walls that
/// aren't there, are dropped.
fn decode_looks(lot: &mut Lot, content: &Content, looks: &[LookSave]) {
    let b = &content.build;
    let index =
        |list: &[crate::content::BuildStyle], id: &str| list.iter().position(|s| s.id == id);
    for l in looks {
        let at = match l.at.as_str() {
            "h" if (l.x as usize) < lot.width && (l.z as usize) <= lot.depth => {
                EdgeRef::H(l.x, l.z)
            }
            "v" if (l.x as usize) <= lot.width && (l.z as usize) < lot.depth => {
                EdgeRef::V(l.x, l.z)
            }
            "d" if lot.in_bounds(l.x as i32, l.z as i32) => EdgeRef::Diag(l.x, l.z),
            _ => continue,
        };
        let edge = edge_at(lot, at);
        if edge == Edge::Open {
            continue;
        }
        let styles: &[crate::content::BuildStyle] = match edge {
            Edge::Door => &b.doors,
            Edge::Window => &b.windows,
            Edge::Fence | Edge::Gate => &b.fences,
            _ => &[],
        };
        let side = |id: &str| index(&b.coverings, id).map_or(0, |i| i as u8 + 1);
        lot.set_look(
            at,
            EdgeLook {
                sides: [side(&l.faces[0]), side(&l.faces[1])],
                form: if edge == Edge::Wall {
                    l.form.min(crate::lot::FORM_HALF)
                } else {
                    0
                },
                style: index(styles, &l.style).map_or(0, |i| i as u8),
            },
        );
    }
}

fn encode_floors(lot: &Lot, content: &Content) -> Vec<FloorSave> {
    let floors = &content.build.floors;
    lot.floors()
        .filter_map(|(x, z, c)| {
            let id = &floors.get(c.checked_sub(1)? as usize)?.id;
            Some(FloorSave {
                x,
                z,
                covering: id.clone(),
            })
        })
        .collect()
}

/// Puts saved floor coverings back; unknown ids, and tiles off the lot, are dropped.
fn decode_floors(lot: &mut Lot, content: &Content, floors: &[FloorSave]) {
    let list = &content.build.floors;
    for f in floors {
        if !lot.in_bounds(i32::from(f.x), i32::from(f.z)) {
            continue;
        }
        if let Some(i) = list.iter().position(|s| s.id == f.covering) {
            lot.set_floor(f.x, f.z, i as u8 + 1);
        }
    }
}

fn encode_diagonals(diags: &[Option<Diagonal>]) -> String {
    if diags.iter().all(Option::is_none) {
        return String::new();
    }
    diags
        .iter()
        .map(|d| {
            let Some(d) = d else { return '0' };
            let base = match d.dir {
                DiagDir::Dp => 0,
                DiagDir::Dn => 3,
            };
            let kind = match d.edge {
                Edge::Door => 2,
                Edge::Window => 3,
                _ => 1,
            };
            char::from(b'0' + base + kind)
        })
        .collect()
}

fn decode_diagonals(s: &str) -> Result<Vec<Option<Diagonal>>, Error> {
    s.chars()
        .map(|c| {
            let n = c
                .to_digit(10)
                .filter(|&n| n <= 6)
                .ok_or_else(|| Error::new("corrupt diagonal walls in save"))?;
            if n == 0 {
                return Ok(None);
            }
            let dir = if n <= 3 { DiagDir::Dp } else { DiagDir::Dn };
            let edge = match (n - 1) % 3 {
                0 => Edge::Wall,
                1 => Edge::Door,
                _ => Edge::Window,
            };
            Ok(Some(Diagonal { dir, edge }))
        })
        .collect()
}

fn decode(s: &str) -> Result<Vec<Edge>, Error> {
    s.chars()
        .map(|c| match c {
            '0' => Ok(Edge::Open),
            '1' => Ok(Edge::Wall),
            '2' => Ok(Edge::Door),
            '3' => Ok(Edge::Window),
            '4' => Ok(Edge::Fence),
            '5' => Ok(Edge::Gate),
            _ => Err(Error::new("corrupt lot edges in save")),
        })
        .collect()
}

// ---- Planner ------------------------------------------------------------------------------

fn skill_id(content: &Content, skill: Option<usize>) -> Option<String> {
    skill.map(|s| content.skills[s].id.clone())
}

fn routine_save(content: &Content, r: &Routine) -> RoutineSave {
    RoutineSave {
        id: r.id,
        activity: content.activities[r.activity].id.clone(),
        skill: skill_id(content, r.skill),
        days: r.days,
        start: r.start,
        minutes: r.minutes,
    }
}

/// A saved routine, if its activity (and skill) still exist.
fn routine_load(content: &Content, r: &RoutineSave) -> Option<Routine> {
    let activity = content.activities.iter().position(|a| a.id == r.activity)?;
    Some(Routine {
        id: r.id,
        activity,
        skill: r.skill.as_deref().and_then(|s| content.skill_index(s)),
        days: r.days & 0x7f,
        start: r.start.min(1439),
        minutes: r.minutes,
    })
}

fn goal_save(content: &Content, g: &Goal) -> GoalSave {
    GoalSave {
        def: content.goals[g.def].id.clone(),
        skill: skill_id(content, g.skill),
        category: g.category.map(|c| content.career_categories[c].id.clone()),
        target: g.target,
        since_day: g.since_day,
        start: g.start,
        progress: g.progress,
        history: g.history,
    }
}

fn goal_load(content: &Content, g: &GoalSave) -> Option<Goal> {
    Some(Goal {
        def: content.goals.iter().position(|d| d.id == g.def)?,
        skill: match &g.skill {
            Some(s) => Some(content.skill_index(s)?),
            None => None,
        },
        category: g
            .category
            .as_deref()
            .and_then(|c| content.career_categories.iter().position(|d| d.id == c)),
        target: g.target,
        since_day: g.since_day,
        start: g.start,
        progress: g.progress,
        history: g.history,
    })
}

fn reason_save(content: &Content, r: Reason) -> String {
    match r {
        Reason::Trait(t) => format!("trait:{}", content.traits[t].id),
        Reason::Need(n) => format!("need:{}", content.needs[n].id),
        Reason::Mood => "mood".into(),
        Reason::Away => "away".into(),
        Reason::NoPlace => "noPlace".into(),
    }
}

fn reason_load(content: &Content, r: &str) -> Option<Reason> {
    Some(match r.split_once(':') {
        Some(("trait", id)) => Reason::Trait(content.traits.iter().position(|t| t.id == id)?),
        Some(("need", id)) => Reason::Need(content.needs.iter().position(|n| n.id == id)?),
        _ => match r {
            "away" => Reason::Away,
            "noPlace" => Reason::NoPlace,
            _ => Reason::Mood,
        },
    })
}

fn planner_save(content: &Content, p: &Planner) -> Option<PlannerSave> {
    let save = PlannerSave {
        routines: p.routines.iter().map(|r| routine_save(content, r)).collect(),
        skip_household: p.skip_household.clone(),
        goals: p.goals.iter().map(|g| goal_save(content, g)).collect(),
        suggestions: p.suggestions.iter().map(|g| goal_save(content, g)).collect(),
        history: p
            .history
            .iter()
            .map(|b| BlockResultSave {
                routine: b.routine,
                household: b.household,
                activity: content.activities[b.activity].id.clone(),
                skill: skill_id(content, b.skill),
                day: b.day,
                start: b.start,
                minutes: b.minutes,
                outcome: match b.outcome {
                    Outcome::Kept => "kept",
                    Outcome::Cut => "cut",
                    Outcome::Skipped => "skipped",
                    Outcome::NoPlace => "noPlace",
                }
                .into(),
                reason: b.reason.map(|r| reason_save(content, r)),
                done: b.done,
            })
            .collect(),
        wishes: p
            .wishes
            .iter()
            .map(|&(a, s)| (content.activities[a].id.clone(), skill_id(content, s)))
            .collect(),
        home_wishes: p.home_wishes.iter().map(|w| home_wish_save(content, w)).collect(),
        waited_day: p.waited_day,
        reviewed: p.reviewed,
    };
    let empty = save.routines.is_empty()
        && save.skip_household.is_empty()
        && save.goals.is_empty()
        && save.suggestions.is_empty()
        && save.history.is_empty()
        && save.wishes.is_empty()
        && save.home_wishes.is_empty()
        && save.waited_day.is_none();
    (!empty || save.reviewed != 0).then_some(save)
}

fn planner_load(content: &Content, p: &PlannerSave) -> Planner {
    let activity = |id: &str| content.activities.iter().position(|a| a.id == id);
    Planner {
        routines: p.routines.iter().filter_map(|r| routine_load(content, r)).collect(),
        skip_household: p.skip_household.clone(),
        goals: p.goals.iter().filter_map(|g| goal_load(content, g)).collect(),
        suggestions: p.suggestions.iter().filter_map(|g| goal_load(content, g)).collect(),
        run: None,
        history: p
            .history
            .iter()
            .filter_map(|b| {
                Some(BlockResult {
                    routine: b.routine,
                    household: b.household,
                    activity: activity(&b.activity)?,
                    skill: b.skill.as_deref().and_then(|s| content.skill_index(s)),
                    day: b.day,
                    start: b.start,
                    minutes: b.minutes,
                    outcome: match b.outcome.as_str() {
                        "kept" => Outcome::Kept,
                        "cut" => Outcome::Cut,
                        "noPlace" => Outcome::NoPlace,
                        _ => Outcome::Skipped,
                    },
                    reason: b.reason.as_deref().and_then(|r| reason_load(content, r)),
                    done: b.done,
                })
            })
            .collect(),
        wishes: p
            .wishes
            .iter()
            .filter_map(|(a, s)| Some((activity(a)?, s.as_deref().and_then(|s| content.skill_index(s)))))
            .collect(),
        home_wishes: p.home_wishes.iter().filter_map(|w| home_wish_load(content, w)).collect(),
        waited_day: p.waited_day,
        thought: None,
        reviewed: p.reviewed,
    }
}

#[cfg(test)]
mod tests {
    use crate::{Command, World};

    const CONTENT: &str = r#"{
        "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.1},{"id":"energy","label":"Energy","decayPerHour":0.05}],
        "objects":[
          {"id":"fridge","name":"Fridge","interactions":[{"id":"snack","label":"Snack","minutes":10,"effects":{"hunger":0.4}}]},
          {"id":"bed","name":"Bed","footprint":[2,2],"interactions":[{"id":"sleep","label":"Sleep","minutes":480,"pose":"lie","effects":{"energy":1.0}}]}],
        "genders":[{"id":"female","label":"Female"},{"id":"male","label":"Male"}],
        "feelings":[{"id":"happy","label":"Happy","mood":0.1,"hours":3}],
        "bondPresets":{"friends":{"friendship":60}},
        "traits":[{"id":"lazy","label":"Lazy","effects":{"walkSpeed":0.8}}]}"#;

    const LOT: &str = r##"{"width":12,"depth":12,"walls":[[6,0,6,10]],"doors":[{"x":6,"z":4,"axis":"z"}],
        "objects":[{"def":"fridge","x":1,"z":1,"rot":0},{"def":"bed","x":9,"z":2,"rot":3}],
        "households":[{"name":"Park","player":true},{"name":"Next door"}],
        "sims":[{"name":"Ada","gender":"female","attractedTo":["male"],"appearance":{"body":"#fff"},"traits":["lazy"],"x":3.5,"z":3.5},
                {"name":"Bo","gender":"male","household":1,"x":4.5,"z":6.5}],
        "relationships":[{"a":0,"b":1,"preset":"friends"}]}"##;

    #[test]
    fn round_trip_preserves_state() {
        let mut w = World::from_json(CONTENT, LOT, 3).unwrap();
        w.apply(Command::Use {
            sim: 1,
            object: 0,
            interaction: 0,
        })
        .unwrap();
        w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
        crate::social::add_feeling(&mut w.sims[0].feelings, 0, &w.content.feelings, w.tick);
        for _ in 0..137 {
            w.tick_once();
        }
        let json = w.save_json();
        let loaded = World::from_save_json(CONTENT, &json).unwrap();

        assert_eq!(loaded.tick, w.tick);
        assert!(loaded.autonomy, "the town-wide switch stays on");
        assert!(!loaded.households[0].free_will, "the player's household has free will off");
        assert!(loaded.households[1].free_will);
        assert_eq!(loaded.objects.len(), 2);
        assert_eq!(loaded.households.len(), 2);
        assert_eq!(loaded.sims[1].household, 1);
        assert_eq!(loaded.lot.rooms(), w.lot.rooms());
        assert_eq!(loaded.sims[0].traits, ["lazy"]);
        assert_eq!(loaded.sims[0].gender, "female");
        assert_eq!(loaded.sims[0].attracted_to, ["male"]);
        assert_eq!(loaded.sims[0].appearance["body"], "#fff");
        assert!((loaded.sims[0].mods.walk_speed - 0.8).abs() < 1e-6);
        assert_eq!(loaded.sims[0].feelings.len(), 1);
        assert_eq!(loaded.relationships.get(0, 1), w.relationships.get(0, 1));
        assert_eq!(
            loaded.relationships.chemistry(0, 1),
            w.relationships.chemistry(0, 1)
        );
        for (a, b) in loaded.sims.iter().zip(&w.sims) {
            assert_eq!(a.needs, b.needs);
        }
        assert_eq!(loaded.sims[0].pos, w.sims[0].pos);
        assert_eq!(
            loaded.sims[1].queue().count() + loaded.sims[1].current().is_some() as usize,
            1
        );
        // Saving the loaded world again is stable.
        assert_eq!(
            World::from_save_json(CONTENT, &loaded.save_json())
                .unwrap()
                .save_json(),
            loaded.save_json()
        );
    }

    #[test]
    fn lying_sim_is_saved_standing_in_front_of_the_bed() {
        let mut w = World::from_json(CONTENT, LOT, 3).unwrap();
        w.autonomy = false;
        w.sims[0].needs[1] = 0.1;
        w.apply(Command::Use {
            sim: 0,
            object: 1,
            interaction: 0,
        })
        .unwrap();
        for _ in 0..20 * 40 {
            w.tick_once();
        }
        assert_eq!(w.sims[0].pose, crate::content::Pose::Lie);
        let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
        let (x, z) = loaded.sims[0].tile();
        assert!(
            !loaded.blocked()[loaded.lot.tile_index(x, z)],
            "must not spawn inside the bed"
        );
    }

    #[test]
    fn drops_objects_missing_from_content() {
        let w = World::from_json(CONTENT, LOT, 3).unwrap();
        let json = w
            .save_json()
            .replace(r#""def":"fridge""#, r#""def":"jukebox""#);
        let loaded = World::from_save_json(CONTENT, &json).unwrap();
        assert_eq!(loaded.objects.len(), 1);
    }

    #[test]
    fn old_upgrade_tasks_are_dropped_on_load() {
        let w = World::from_json(CONTENT, LOT, 3).unwrap();
        let json = w.save_json().replacen(
            r#""tasks":[]"#,
            r#""tasks":[{"type":"upgrade","object":1},{"type":"moveTo","x":2.5,"z":2.5,"directed":true}]"#,
            1,
        );
        let loaded = World::from_save_json(CONTENT, &json).unwrap();
        assert_eq!(loaded.sims[0].queue().count(), 1, "only the move is kept");
    }

    #[test]
    fn saves_with_moodlets_still_load() {
        // Saves written before the moodlet → feeling rename store `moodlets` per Sim.
        let mut w = World::from_json(CONTENT, LOT, 3).unwrap();
        crate::social::add_feeling(&mut w.sims[0].feelings, 0, &w.content.feelings, w.tick);
        let mut saved: serde_json::Value = serde_json::from_str(&w.save_json()).unwrap();
        let sim = saved["sims"][0].as_object_mut().unwrap();
        let feelings = sim.remove("feelings").expect("new saves write `feelings`");
        assert_eq!(feelings[0]["id"], "happy");
        sim.insert("moodlets".into(), feelings);
        let loaded = World::from_save_json(CONTENT, &saved.to_string()).unwrap();
        assert_eq!(loaded.sims[0].feelings.len(), 1);
        assert_eq!(
            loaded.content.feelings[loaded.sims[0].feelings[0].def].id,
            "happy"
        );
    }

    #[test]
    fn version_one_saves_still_load() {
        let v1 = r#"{"version":1,"tick":10,"speed":1,"autonomy":true,"rng":5,
            "lot":{"width":4,"depth":4,"hEdges":"00000000000000000000","vEdges":"00000000000000000000"},
            "objects":[],"sims":[{"name":"Old","appearance":null,"traits":[],"perks":[],"pos":[1.5,1.5],"yaw":0,
              "needs":{"hunger":0.5},"tasks":[]}]}"#;
        let w = World::from_save_json(CONTENT, v1).unwrap();
        assert_eq!(w.sims[0].gender, "female", "defaults to the first gender");
        assert_eq!(w.sims[0].attracted_to.len(), 2);
    }

    #[test]
    fn diagonal_walls_survive_saving() {
        let lot = LOT.replacen(
            r#""doors":"#,
            r#""diagonals":[{"x":2,"z":8,"dir":"dp"},{"x":3,"z":9,"dir":"dp","kind":"window"},
                {"x":4,"z":8,"dir":"dn","kind":"door"}],"doors":"#,
            1,
        );
        let w = World::from_json(CONTENT, &lot, 3).unwrap();
        let json = w.save_json();
        let saved: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(saved["version"], super::SAVE_VERSION);
        let diags = saved["lot"]["diagonals"].as_str().unwrap();
        assert_eq!(diags.len(), 12 * 12);
        let loaded = World::from_save_json(CONTENT, &json).unwrap();
        use crate::lot::{DiagDir, Diagonal, Edge};
        assert_eq!(
            loaded.lot.diag(3, 9),
            Some(Diagonal {
                dir: DiagDir::Dp,
                edge: Edge::Window
            })
        );
        assert_eq!(
            loaded.lot.diag(4, 8),
            Some(Diagonal {
                dir: DiagDir::Dn,
                edge: Edge::Door
            })
        );
        assert_eq!(loaded.lot.half_rooms(), w.lot.half_rooms());
        assert_eq!(loaded.save_json(), json);
    }

    #[test]
    fn saves_without_diagonals_still_load() {
        // A version 4 save (before diagonal walls): no `diagonals` in the lot.
        let w = World::from_json(CONTENT, LOT, 3).unwrap();
        let mut saved: serde_json::Value = serde_json::from_str(&w.save_json()).unwrap();
        assert!(
            saved["lot"].get("diagonals").is_none(),
            "lots without diagonals don't write them"
        );
        saved["version"] = 4.into();
        let loaded = World::from_save_json(CONTENT, &saved.to_string()).unwrap();
        assert!(loaded.lot.diagonals().iter().all(Option::is_none));
        assert_eq!(loaded.lot.rooms(), w.lot.rooms());
        // A corrupt or wrongly sized diagonal string is an error, not a silent change.
        saved["lot"]["diagonals"] = "01".into();
        assert!(World::from_save_json(CONTENT, &saved.to_string()).is_err());
    }

    #[test]
    fn windows_survive_saving() {
        let lot = LOT.replacen(
            r#""doors":"#,
            r#""windows":[{"x":6,"z":8,"axis":"z"}],"doors":"#,
            1,
        );
        let w = World::from_json(CONTENT, &lot, 3).unwrap();
        assert_eq!(w.lot.v_edge(6, 8), crate::lot::Edge::Window);
        let json = w.save_json();
        let saved: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(saved["lot"]["vEdges"].as_str().unwrap().contains('3'));
        let loaded = World::from_save_json(CONTENT, &json).unwrap();
        assert_eq!(loaded.lot.v_edge(6, 8), crate::lot::Edge::Window);
        assert_eq!(loaded.lot.v_edge(6, 4), crate::lot::Edge::Door);
        assert_eq!(loaded.save_json(), json);
    }
}
