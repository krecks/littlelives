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
//! door and window styles, by content id; absent: plain walls). Older files load. Saves written before feelings
//! were renamed from "moodlets" store them under `moodlets`; a serde alias still reads it.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::content::{Content, Pose};
use crate::life::{Job, Visit};
use crate::lot::{DiagDir, Diagonal, Edge, EdgeLook, EdgeRef, Lot, SimSpawn};
use crate::rng::Rng;
use crate::social::{self, Relationship};
use crate::world::{Household, Plot, Task, TaskKind, World};
use crate::{Error, MINUTES_PER_TICK, clock::MAX_SPEED};

pub const SAVE_VERSION: u32 = 6;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFile {
    pub version: u32,
    pub tick: u64,
    pub speed: u8,
    pub autonomy: bool,
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
    /// Minutes left at work, if away.
    #[serde(default)]
    pub away_minutes: Option<f32>,
    /// Plot being visited, and minutes left (`None` = until the player says otherwise).
    #[serde(default)]
    pub visiting: Option<(u32, Option<f32>)>,
    /// Current activity first, then the queue.
    pub tasks: Vec<TaskSave>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSave {
    pub career: String,
    pub level: usize,
    pub performance: f32,
    pub last_shift_day: u32,
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
                    }),
                    away_minutes: s.away_until.map(minutes_left),
                    visiting: s
                        .visiting
                        .map(|v| (v.plot, (v.until != u64::MAX).then(|| minutes_left(v.until)))),
                    tasks,
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
            tick: self.tick,
            speed: self.speed,
            autonomy: self.autonomy,
            rng: self.rng.state(),
            lot: LotSave {
                width: self.lot.width,
                depth: self.lot.depth,
                h_edges: encode(h),
                v_edges: encode(v),
                diagonals: encode_diagonals(self.lot.diagonals()),
                looks: encode_looks(&self.lot, &self.content),
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
                })
                .collect(),
            relationships,
            meta: self.meta.clone(),
            exits: self.exits.clone(),
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
        let mut world = World::empty(content, lot, Rng::new(save.rng));
        world.tick = save.tick;
        world.speed = save.speed.min(MAX_SPEED);
        world.autonomy = save.autonomy;
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
                Some(Job {
                    career,
                    level,
                    performance: j.performance,
                    last_shift_day: j.last_shift_day,
                    shift_mood: 0.5,
                })
            });
            sim.away_until = s.away_minutes.filter(|_| sim.job.is_some()).map(after);
            sim.visiting = s.visiting.and_then(|(plot, left)| {
                ((plot as usize) < plot_count).then(|| Visit {
                    plot,
                    until: left.map_or(u64::MAX, after),
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
            _ => Err(Error::new("corrupt lot edges in save")),
        })
        .collect()
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
        w.apply(Command::SetAutonomy { enabled: false }).unwrap();
        crate::social::add_feeling(&mut w.sims[0].feelings, 0, &w.content.feelings, w.tick);
        for _ in 0..137 {
            w.tick_once();
        }
        let json = w.save_json();
        let loaded = World::from_save_json(CONTENT, &json).unwrap();

        assert_eq!(loaded.tick, w.tick);
        assert!(!loaded.autonomy);
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
