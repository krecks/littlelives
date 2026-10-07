//! World state and the per-tick update.

use std::collections::VecDeque;
use std::f32::consts::FRAC_PI_2;

use crate::clock::{MAX_SPEED, TICKS_PER_STEP};
use crate::content::{Content, MAX_NEEDS, Modifiers, Pose};
use crate::lot::{BondRaw, Lot, LotFile, SimSpawn};
use crate::path::NavGrid;
use crate::rng::Rng;
use crate::social::{self, ActiveMoodlet, EventLog, Prefer, Relationships};
use crate::{Command, Error, MINUTES_PER_TICK, TICKS_PER_SECOND, ai, conversation};

pub const MAX_SIMS: usize = 64;
pub const MAX_QUEUE: usize = 6;
/// Walking speed in tiles per tick (1.5 m per real second at 1×).
const WALK_SPEED: f32 = 1.5 / TICKS_PER_SECOND as f32;
/// Idle time before a Sim picks something on its own.
const AUTONOMY_DELAY_TICKS: u32 = TICKS_PER_SECOND;
const MIN_AUTONOMY_SCORE: f32 = 0.01;
/// Sims further apart than this don't start socials on their own.
const SOCIAL_RANGE: f32 = 45.0;
pub const TICKS_PER_DAY: u64 = (24.0 * 60.0 / MINUTES_PER_TICK) as u64;

#[derive(Debug, Clone)]
pub struct ObjectInstance {
    /// Equal to the object's index in `World::objects`.
    pub id: u32,
    pub def: usize,
    /// Minimum corner of the rotated footprint.
    pub x: i32,
    pub z: i32,
    /// Facing: 0 = +z, 1 = +x, 2 = -z, 3 = -x.
    pub rot: u8,
    /// Sim currently using or walking to this object.
    pub user: Option<u32>,
}

impl ObjectInstance {
    /// Rotated footprint `(x extent, z extent)`.
    pub fn size(&self, content: &Content) -> (i32, i32) {
        let [w, d] = content.objects[self.def].footprint;
        if self.rot.is_multiple_of(2) {
            (w as i32, d as i32)
        } else {
            (d as i32, w as i32)
        }
    }

    pub fn centre(&self, content: &Content) -> [f32; 2] {
        let (w, d) = self.size(content);
        [
            self.x as f32 + w as f32 / 2.0,
            self.z as f32 + d as f32 / 2.0,
        ]
    }

    pub fn yaw(&self) -> f32 {
        (self.rot % 4) as f32 * FRAC_PI_2
    }

    /// Tile a Sim stands on to use the object: centred in front of the footprint.
    pub fn front_tile(&self, content: &Content) -> (i32, i32) {
        let (w, d) = self.size(content);
        match self.rot % 4 {
            0 => (self.x + (w - 1) / 2, self.z + d),
            1 => (self.x + w, self.z + (d - 1) / 2),
            2 => (self.x + (w - 1) / 2, self.z - 1),
            _ => (self.x - 1, self.z + (d - 1) / 2),
        }
    }

    fn tiles(&self, content: &Content) -> impl Iterator<Item = (i32, i32)> + use<> {
        let (w, d) = self.size(content);
        let (x0, z0) = (self.x, self.z);
        (0..d).flat_map(move |dz| (0..w).map(move |dx| (x0 + dx, z0 + dz)))
    }
}

#[derive(Debug, Clone, Copy)]
pub enum TaskKind {
    Use {
        object: u32,
        interaction: usize,
    },
    MoveTo {
        x: f32,
        z: f32,
    },
    /// Start a social interaction with another Sim.
    Social {
        target: u32,
        social: usize,
    },
    /// Head to the town exit for a work shift.
    Work,
    /// Walk to another household's front door and stay a while.
    Visit {
        plot: u32,
    },
    /// Walk back home.
    GoHome,
}

#[derive(Debug, Clone, Copy)]
pub struct Task {
    pub kind: TaskKind,
    /// Issued by the player (as opposed to chosen autonomously).
    pub directed: bool,
}

#[derive(Debug)]
pub enum Phase {
    Routing {
        waypoints: Vec<[f32; 2]>,
        next: usize,
    },
    Using {
        elapsed: f32,
    },
    /// Next to the social target, waiting for them to be free.
    Waiting {
        ticks: u32,
    },
    /// In a conversation; the outcome was decided when it started.
    Conversing {
        elapsed: f32,
        success: bool,
    },
}

#[derive(Debug)]
pub struct Activity {
    pub task: Task,
    pub phase: Phase,
    /// Tags of the interaction or social being performed (for "busy" checks and autonomy).
    pub tags: u32,
}

#[derive(Debug)]
pub struct Sim {
    /// Equal to the Sim's index in `World::sims`.
    pub id: u32,
    pub name: String,
    /// Opaque appearance data for the renderer/UI.
    pub appearance: serde_json::Value,
    pub gender: String,
    /// Genders this Sim is romantically attracted to.
    pub attracted_to: Vec<String>,
    pub traits: Vec<String>,
    pub perks: Vec<String>,
    /// Combined effect of traits and perks.
    pub mods: Modifiers,
    pub pos: [f32; 2],
    pub yaw: f32,
    pub pose: Pose,
    pub needs: [f32; MAX_NEEDS],
    pub moodlets: Vec<ActiveMoodlet>,
    /// Set while another Sim is talking to this one.
    pub engaged_with: Option<u32>,
    pub(crate) gender_ix: Option<usize>,
    pub(crate) attraction: u32,
    pub(crate) queue: VecDeque<Task>,
    pub(crate) current: Option<Activity>,
    pub(crate) idle_ticks: u32,
    pub household: u32,
    pub job: Option<crate::life::Job>,
    /// At work until this tick (not on the map).
    pub away_until: Option<u64>,
    /// Currently a guest on another household's plot.
    pub visiting: Option<crate::life::Visit>,
    /// Set by Work/Visit/GoHome tasks; handled by `life::update`.
    pub(crate) transition: Option<crate::life::Transition>,
}

impl Sim {
    pub fn tile(&self) -> (i32, i32) {
        (self.pos[0].floor() as i32, self.pos[1].floor() as i32)
    }

    pub fn is_moving(&self) -> bool {
        matches!(
            self.current,
            Some(Activity {
                phase: Phase::Routing { .. },
                ..
            })
        )
    }

    pub fn current(&self) -> Option<&Activity> {
        self.current.as_ref()
    }

    pub fn queue(&self) -> impl Iterator<Item = &Task> {
        self.queue.iter()
    }

    /// Needs average plus trait and moodlet effects, 0..1.
    pub fn mood(&self, content: &Content) -> f32 {
        let n = content.needs.len();
        let needs = self.needs[..n].iter().sum::<f32>() / n as f32;
        (needs + self.mods.mood + social::moodlet_mood(&self.moodlets, &content.moodlets))
            .clamp(0.0, 1.0)
    }

    pub fn emotion(&self, content: &Content) -> Option<usize> {
        social::dominant_emotion(&self.moodlets, &content.moodlets)
    }

    pub fn attracted_to(&self, other: &Sim) -> bool {
        match other.gender_ix {
            Some(g) => self.attraction & (1 << g) != 0,
            None => true, // content defines no genders
        }
    }

    /// Whether another Sim can pull this one into a conversation right now.
    pub fn available_for_social(&self, content: &Content) -> bool {
        if self.engaged_with.is_some() || self.pose == Pose::Lie || self.away_until.is_some() {
            return false;
        }
        let Some(act) = &self.current else {
            return true;
        };
        if act.task.directed {
            return false;
        }
        match (act.task.kind, &act.phase) {
            // People on their way somewhere don't stop to chat (it would strand them).
            (TaskKind::Work | TaskKind::Visit { .. } | TaskKind::GoHome, _) => false,
            (TaskKind::Social { .. }, Phase::Conversing { .. }) => false,
            (_, Phase::Routing { .. }) => true,
            _ => act.tags & content.social_rules.busy_tags == 0,
        }
    }

    /// For a Sim leading a conversation: (target, social, success, progress 0..1).
    pub fn conversation(&self, content: &Content) -> Option<(u32, usize, bool, f32)> {
        match &self.current {
            Some(Activity {
                task:
                    Task {
                        kind: TaskKind::Social { target, social },
                        ..
                    },
                phase: Phase::Conversing { elapsed, success },
                ..
            }) => {
                let s = &content.socials[*social];
                let duration = conversation::duration(s, *success);
                Some((*target, *social, *success, (elapsed / duration).min(1.0)))
            }
            _ => None,
        }
    }
}

/// A region of the town: a residential lot or a public place.
#[derive(Debug, Clone)]
pub struct Plot {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub z: i32,
    pub w: i32,
    pub d: i32,
    /// Public plots (parks) can be used by everyone.
    pub public: bool,
    /// Where visitors arrive (in front of the door); defaults to the plot centre.
    pub entry: Option<[f32; 2]>,
}

impl Plot {
    pub fn contains(&self, x: i32, z: i32) -> bool {
        x >= self.x && z >= self.z && x < self.x + self.w && z < self.z + self.d
    }

    pub fn arrival_point(&self) -> [f32; 2] {
        self.entry.unwrap_or([
            self.x as f32 + self.w as f32 / 2.0,
            self.z as f32 + self.d as f32 / 2.0,
        ])
    }
}

#[derive(Debug, Clone)]
pub struct Household {
    pub id: u32,
    pub name: String,
    /// The plot this household lives on.
    pub plot: Option<u32>,
    /// Controlled by the player.
    pub player: bool,
    /// Money earned from jobs.
    pub funds: i64,
}

/// Per-tick snapshot of other Sims, so each Sim can reason about the others
/// without aliasing the mutable Sim list. Reused between ticks.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SimBrief {
    pub pos: [f32; 2],
    pub available: bool,
    pub gender_ix: Option<usize>,
    pub household: u32,
    /// Plot the Sim is standing on.
    pub plot: Option<u32>,
    pub away: bool,
}

pub struct World {
    pub content: Content,
    pub lot: Lot,
    pub objects: Vec<ObjectInstance>,
    /// Plot index per object (`None` when outside every plot).
    pub(crate) object_plot: Vec<Option<u32>>,
    pub sims: Vec<Sim>,
    pub households: Vec<Household>,
    pub plots: Vec<Plot>,
    pub relationships: Relationships,
    pub events: EventLog,
    pub(crate) blocked: Vec<bool>,
    pub tick: u64,
    pub speed: u8,
    /// "Free will": whether idle Sims choose activities on their own.
    pub autonomy: bool,
    pub(crate) rng: Rng,
    pub(crate) structure_version: u32,
    pub(crate) briefs: Vec<SimBrief>,
    /// Where Sims leave town for work.
    pub exits: Vec<[f32; 2]>,
    /// Opaque presentation data from the lot/town file, saved unchanged.
    pub meta: serde_json::Value,
}

/// Read-only context for one Sim's update.
pub(crate) struct Ctx<'a> {
    pub content: &'a Content,
    pub nav: NavGrid<'a>,
    pub rels: &'a Relationships,
    pub briefs: &'a [SimBrief],
    pub households: &'a [Household],
    pub plots: &'a [Plot],
    pub object_plot: &'a [Option<u32>],
    pub exits: &'a [[f32; 2]],
    pub autonomy: bool,
    pub hour: f32,
}

#[derive(Debug, Clone, Copy)]
enum Choice {
    Object(u32, usize),
    Social(u32, usize),
    Visit(u32),
}

impl World {
    pub fn from_json(content_json: &str, lot_json: &str, seed: u32) -> Result<Self, Error> {
        let content = Content::from_json(content_json)?;
        let lot_file: LotFile = serde_json::from_str(lot_json)?;
        Self::new(content, &lot_file, seed)
    }

    pub fn new(content: Content, lot_file: &LotFile, seed: u32) -> Result<Self, Error> {
        let mut world = Self::empty(content, Lot::from_file(lot_file)?, Rng::new(seed));
        world.meta = lot_file.meta.clone();
        world.exits = lot_file.exits.clone();
        world.plots = lot_file
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
        world.households = if lot_file.households.is_empty() {
            vec![Household {
                id: 0,
                name: "Household".into(),
                plot: None,
                player: true,
                funds: starting_funds,
            }]
        } else {
            lot_file
                .households
                .iter()
                .enumerate()
                .map(|(i, h)| Household {
                    id: i as u32,
                    name: h.name.clone(),
                    plot: h.plot,
                    player: h.player,
                    funds: h.funds.unwrap_or(starting_funds),
                })
                .collect()
        };
        if let Some(h) = world
            .households
            .iter()
            .find(|h| h.plot.is_some_and(|p| p as usize >= world.plots.len()))
        {
            return Err(Error::new(format!(
                "household '{}' lives on an unknown plot",
                h.name
            )));
        }
        for p in &lot_file.objects {
            world.place_object(&p.def, p.x, p.z, p.rot)?;
        }
        if lot_file.sims.len() > MAX_SIMS {
            return Err(Error::new(format!("at most {MAX_SIMS} Sims per town")));
        }
        for s in &lot_file.sims {
            world.spawn_sim(s)?;
        }
        world.init_relationships(&lot_file.relationships)?;
        Ok(world)
    }

    pub(crate) fn empty(content: Content, lot: Lot, rng: Rng) -> Self {
        let tiles = lot.width * lot.depth;
        Self {
            content,
            lot,
            objects: Vec::new(),
            object_plot: Vec::new(),
            sims: Vec::new(),
            households: Vec::new(),
            plots: Vec::new(),
            relationships: Relationships::default(),
            events: EventLog::default(),
            blocked: vec![false; tiles],
            tick: 0,
            speed: 1,
            autonomy: true,
            rng,
            structure_version: 1,
            briefs: Vec::new(),
            exits: Vec::new(),
            meta: serde_json::Value::Null,
        }
    }

    /// Bumped whenever walls or objects change, so renderers know to rebuild.
    pub fn structure_version(&self) -> u32 {
        self.structure_version
    }

    pub fn blocked(&self) -> &[bool] {
        &self.blocked
    }

    pub fn plot_at(&self, x: i32, z: i32) -> Option<u32> {
        self.plots.iter().find(|p| p.contains(x, z)).map(|p| p.id)
    }

    pub fn place_object(&mut self, def_id: &str, x: i32, z: i32, rot: u8) -> Result<u32, Error> {
        let def = self
            .content
            .object_index(def_id)
            .ok_or_else(|| Error::new(format!("unknown object '{def_id}'")))?;
        let obj = ObjectInstance {
            id: self.objects.len() as u32,
            def,
            x,
            z,
            rot: rot % 4,
            user: None,
        };
        for (tx, tz) in obj.tiles(&self.content) {
            if !self.lot.in_bounds(tx, tz) || self.blocked[self.lot.tile_index(tx, tz)] {
                return Err(Error::new(format!(
                    "'{def_id}' at {x},{z} overlaps or leaves the lot"
                )));
            }
        }
        let (fx, fz) = obj.front_tile(&self.content);
        if !self.lot.in_bounds(fx, fz) {
            return Err(Error::new(format!(
                "'{def_id}' at {x},{z} faces off the lot"
            )));
        }
        for (tx, tz) in obj.tiles(&self.content) {
            let i = self.lot.tile_index(tx, tz);
            self.blocked[i] = true;
        }
        self.object_plot.push(self.plot_at(x, z));
        self.objects.push(obj);
        self.structure_version += 1;
        Ok(self.objects.len() as u32 - 1)
    }

    /// Adds a Sim with random starting needs. Identity, traits and perks are validated.
    pub fn spawn_sim(&mut self, spawn: &SimSpawn) -> Result<u32, Error> {
        let SimSpawn { name, x, z, .. } = spawn;
        if !self.lot.in_bounds(x.floor() as i32, z.floor() as i32) {
            return Err(Error::new(format!("Sim '{name}' spawns off the lot")));
        }
        if self.sims.len() >= MAX_SIMS {
            return Err(Error::new(format!("at most {MAX_SIMS} Sims per town")));
        }
        if spawn.household as usize >= self.households.len() {
            return Err(Error::new(format!(
                "{name}: unknown household {}",
                spawn.household
            )));
        }
        let content = &self.content;
        let gender = spawn
            .gender
            .clone()
            .or_else(|| content.genders.first().map(|g| g.id.clone()))
            .unwrap_or_default();
        let attracted_to = spawn
            .attracted_to
            .clone()
            .unwrap_or_else(|| content.genders.iter().map(|g| g.id.clone()).collect());
        content
            .validate_identity(&gender, &attracted_to)
            .map_err(|e| Error::new(format!("{name}: {e}")))?;
        let mods = content
            .character_modifiers(&spawn.traits, &spawn.perks)
            .map_err(|e| Error::new(format!("{name}: {e}")))?;
        let gender_ix = content.genders.iter().position(|g| g.id == gender);
        let attraction = content
            .genders
            .iter()
            .enumerate()
            .filter(|(_, g)| attracted_to.contains(&g.id))
            .fold(0u32, |m, (i, _)| m | (1 << i));

        let job = match &spawn.job {
            None => None,
            Some(j) => {
                let career = content
                    .career_index(&j.career)
                    .ok_or_else(|| Error::new(format!("{name}: unknown career '{}'", j.career)))?;
                let level = j.level.min(content.careers[career].levels.len() - 1);
                Some(crate::life::Job {
                    career,
                    level,
                    performance: 0.0,
                    last_shift_day: 0,
                    shift_mood: 0.5,
                })
            }
        };

        let mut needs = [0.0; MAX_NEEDS];
        for n in needs.iter_mut().take(self.content.needs.len()) {
            *n = self.rng.range(0.55, 0.95);
        }
        self.sims.push(Sim {
            id: self.sims.len() as u32,
            name: name.clone(),
            appearance: spawn.appearance.clone(),
            gender,
            attracted_to,
            traits: spawn.traits.clone(),
            perks: spawn.perks.clone(),
            mods,
            pos: [*x, *z],
            yaw: 0.0,
            pose: Pose::Stand,
            needs,
            moodlets: Vec::new(),
            engaged_with: None,
            gender_ix,
            attraction,
            queue: VecDeque::new(),
            current: None,
            idle_ticks: 0,
            household: spawn.household,
            job,
            away_until: None,
            visiting: None,
            transition: None,
        });
        self.relationships.grow(self.sims.len());
        Ok(self.sims.len() as u32 - 1)
    }

    /// Chemistry for every pair, household bonds, then explicit bonds from the lot file.
    pub(crate) fn init_relationships(&mut self, bonds: &[BondRaw]) -> Result<(), Error> {
        let n = self.sims.len();
        let default_bond = self.content.social_rules.default_bond;
        for a in 0..n {
            for b in a + 1..n {
                let (sa, sb) = (&self.sims[a], &self.sims[b]);
                let shared = sa.traits.iter().filter(|t| sb.traits.contains(t)).count() as f32;
                let clashes = sa
                    .traits
                    .iter()
                    .filter_map(|t| self.content.traits.iter().find(|d| &d.id == t))
                    .map(|d| d.conflicts.iter().filter(|c| sb.traits.contains(c)).count())
                    .sum::<usize>() as f32;
                let same_household = sa.household == sb.household;
                let chemistry = self.rng.range(-0.6, 0.6) + shared * 0.15 - clashes * 0.3;
                self.relationships.set_chemistry(a, b, chemistry);
                if same_household && let Some(p) = default_bond {
                    self.relationships.bond(a, b, &p);
                }
            }
        }
        for bond in bonds {
            let preset = self
                .content
                .bond_presets
                .get(&bond.preset)
                .ok_or_else(|| Error::new(format!("unknown bond preset '{}'", bond.preset)))?;
            if bond.a >= n || bond.b >= n || bond.a == bond.b {
                return Err(Error::new(format!(
                    "bond {}-{} refers to unknown Sims",
                    bond.a, bond.b
                )));
            }
            if preset.partners
                && [bond.a, bond.b].iter().any(|&s| {
                    self.relationships
                        .partner_of(s)
                        .is_some_and(|p| p != bond.a && p != bond.b)
                })
            {
                return Err(Error::new("a Sim can only have one partner"));
            }
            self.relationships.bond(bond.a, bond.b, preset);
        }
        Ok(())
    }

    /// Advances one real-time step (1 / TICKS_PER_SECOND s) at the current speed.
    pub fn advance(&mut self) {
        for _ in 0..TICKS_PER_STEP[self.speed as usize] {
            self.tick_once();
        }
    }

    pub fn tick_once(&mut self) {
        self.tick += 1;
        let tick = self.tick;

        self.briefs.clear();
        for s in &self.sims {
            let (x, z) = s.tile();
            let plot = self.plots.iter().find(|p| p.contains(x, z)).map(|p| p.id);
            self.briefs.push(SimBrief {
                pos: s.pos,
                available: s.available_for_social(&self.content),
                gender_ix: s.gender_ix,
                household: s.household,
                plot,
                away: s.away_until.is_some(),
            });
        }
        let hour = crate::clock::hour(tick);
        {
            let World {
                content,
                lot,
                objects,
                sims,
                blocked,
                rng,
                relationships,
                briefs,
                autonomy,
                households,
                plots,
                object_plot,
                exits,
                ..
            } = self;
            let ctx = Ctx {
                content,
                nav: NavGrid { lot, blocked },
                rels: relationships,
                briefs,
                households,
                plots,
                object_plot,
                exits,
                autonomy: *autonomy,
                hour,
            };
            for sim in sims.iter_mut() {
                step_sim(sim, &ctx, objects, rng);
            }
        }
        conversation::update(self);
        crate::life::update(self);

        for s in &mut self.sims {
            s.moodlets.retain(|m| m.expires > tick);
        }
        if tick.is_multiple_of(TICKS_PER_DAY) {
            self.relationships.decay(&self.content.social_rules);
        }
    }

    pub fn apply(&mut self, cmd: Command) -> Result<(), Error> {
        match cmd {
            Command::SetSpeed { speed } => {
                if speed > MAX_SPEED {
                    return Err(Error::new(format!("speed must be 0..={MAX_SPEED}")));
                }
                self.speed = speed;
            }
            Command::SetAutonomy { enabled } => self.autonomy = enabled,
            Command::Use {
                sim,
                object,
                interaction,
            } => {
                let obj = self
                    .objects
                    .get(object as usize)
                    .ok_or_else(|| Error::new(format!("unknown object {object}")))?;
                if interaction >= self.content.objects[obj.def].interactions.len() {
                    return Err(Error::new(format!(
                        "object {object} has no interaction {interaction}"
                    )));
                }
                self.enqueue(
                    sim,
                    TaskKind::Use {
                        object,
                        interaction,
                    },
                )?;
            }
            Command::MoveTo { sim, x, z } => {
                if !self.lot.in_bounds(x.floor() as i32, z.floor() as i32) {
                    return Err(Error::new("move target is off the lot"));
                }
                self.enqueue(sim, TaskKind::MoveTo { x, z })?;
            }
            Command::Social {
                sim,
                target,
                social,
            } => {
                let (a, t) = (self.sim(sim)?, self.sim(target)?);
                let def = self
                    .content
                    .socials
                    .get(social)
                    .ok_or_else(|| Error::new(format!("unknown social {social}")))?;
                if !conversation::social_allowed(&self.content, &self.relationships, a, t, def) {
                    return Err(Error::new(format!(
                        "{} isn't possible right now",
                        def.label
                    )));
                }
                self.enqueue(sim, TaskKind::Social { target, social })?;
            }
            Command::JoinCareer { sim, career } => {
                if career >= self.content.careers.len() {
                    return Err(Error::new(format!("unknown career {career}")));
                }
                let s = self
                    .sims
                    .get_mut(sim as usize)
                    .ok_or_else(|| Error::new(format!("unknown Sim {sim}")))?;
                // Starting today doesn't count: the first shift is tomorrow's.
                let today = crate::clock::day(self.tick);
                s.job = Some(crate::life::Job {
                    career,
                    level: 0,
                    performance: 0.0,
                    last_shift_day: today,
                    shift_mood: 0.5,
                });
            }
            Command::QuitCareer { sim } => {
                self.sims
                    .get_mut(sim as usize)
                    .ok_or_else(|| Error::new(format!("unknown Sim {sim}")))?
                    .job = None;
            }
            Command::Visit { sim, plot } => {
                if plot as usize >= self.plots.len() {
                    return Err(Error::new(format!("unknown plot {plot}")));
                }
                self.enqueue(sim, TaskKind::Visit { plot })?;
            }
            Command::GoHome { sim } => self.enqueue(sim, TaskKind::GoHome)?,
            Command::Cancel { sim, index } => {
                let World {
                    sims,
                    objects,
                    content,
                    ..
                } = self;
                let s = sims
                    .get_mut(sim as usize)
                    .ok_or_else(|| Error::new(format!("unknown Sim {sim}")))?;
                let offset = (s.current.is_some() || s.engaged_with.is_some()) as usize;
                if index < offset {
                    if s.current.is_some() {
                        end_activity(s, content, objects);
                    } else {
                        s.engaged_with = None;
                    }
                } else if index - offset < s.queue.len() {
                    s.queue.remove(index - offset);
                }
            }
        }
        Ok(())
    }

    fn sim(&self, id: u32) -> Result<&Sim, Error> {
        self.sims
            .get(id as usize)
            .ok_or_else(|| Error::new(format!("unknown Sim {id}")))
    }

    fn enqueue(&mut self, sim: u32, kind: TaskKind) -> Result<(), Error> {
        let s = self
            .sims
            .get_mut(sim as usize)
            .ok_or_else(|| Error::new(format!("unknown Sim {sim}")))?;
        if s.queue.len() >= MAX_QUEUE {
            return Err(Error::new("action queue is full"));
        }
        s.queue.push_back(Task {
            kind,
            directed: true,
        });
        Ok(())
    }
}

fn step_sim(sim: &mut Sim, ctx: &Ctx, objects: &mut [ObjectInstance], rng: &mut Rng) {
    let content = ctx.content;
    for (n, def) in content.needs.iter().enumerate() {
        let decay = def.decay_per_minute * sim.mods.need_decay[n] * MINUTES_PER_TICK;
        sim.needs[n] = (sim.needs[n] - decay).max(0.0);
    }

    // At work: off the map until `life::update` brings them back.
    if sim.away_until.is_some() {
        return;
    }

    // Someone is talking to this Sim: stay put unless the player gives an order.
    if sim.engaged_with.is_some() {
        if sim.queue.front().is_some_and(|t| t.directed) {
            sim.engaged_with = None;
        } else {
            return;
        }
    }

    // Player commands interrupt whatever the Sim chose on its own.
    let autonomous_running = sim.current.as_ref().is_some_and(|a| !a.task.directed);
    if autonomous_running && sim.queue.front().is_some_and(|t| t.directed) {
        end_activity(sim, content, objects);
    }

    if sim.current.is_none() {
        if let Some(task) = sim.queue.pop_front() {
            start_task(sim, task, ctx, objects);
        } else {
            sim.idle_ticks += 1;
            if ctx.autonomy && sim.idle_ticks >= AUTONOMY_DELAY_TICKS {
                sim.idle_ticks = 0;
                if let Some(task) = pick_autonomous(sim, ctx, objects, rng) {
                    start_task(sim, task, ctx, objects);
                }
            }
        }
    }

    progress(sim, content, objects);
}

/// What a Sim may use on a plot: everything at home or in public places; as a guest,
/// anything that isn't private (bed, bathroom...); nothing on other people's lots.
#[derive(PartialEq)]
enum Access {
    Full,
    Guest,
    None,
}

fn access(ctx: &Ctx, sim: &Sim, plot: Option<u32>) -> Access {
    let home = ctx.households[sim.household as usize].plot;
    // A guest stays at the host's place until it's time to go home.
    if let Some(visit) = sim.visiting {
        return if plot == Some(visit.plot) {
            Access::Guest
        } else {
            Access::None
        };
    }
    match plot {
        None => Access::Full,
        Some(p) if ctx.plots[p as usize].public || home == Some(p) => Access::Full,
        Some(p) if sim.visiting.is_some_and(|v| v.plot == p) => Access::Guest,
        Some(_) => Access::None,
    }
}

fn pick_autonomous(
    sim: &Sim,
    ctx: &Ctx,
    objects: &[ObjectInstance],
    rng: &mut Rng,
) -> Option<Task> {
    let content = ctx.content;
    let needs = &sim.needs[..content.needs.len()];
    let emotion = sim.emotion(content).map(|e| &content.emotions[e].mods);
    let schedule = content.schedule_at(ctx.hour);
    // Traits, the current emotion and the time of day all bias what feels right.
    let feel = |tags: u32| {
        sim.mods.preference(tags)
            * emotion.map_or(1.0, |m| m.preference(tags))
            * schedule.preference(tags)
    };
    let me = sim.id as usize;
    let here = ctx.briefs[me].plot;
    let mut candidates: Vec<(f32, Choice)> = Vec::new();

    for obj in objects.iter().filter(|o| o.user.is_none()) {
        let allowed = access(ctx, sim, ctx.object_plot[obj.id as usize]);
        if allowed == Access::None {
            continue;
        }
        let (fx, fz) = obj.front_tile(content);
        let distance = (fx as f32 + 0.5 - sim.pos[0]).hypot(fz as f32 + 0.5 - sim.pos[1]);
        for (i, inter) in content.objects[obj.def].interactions.iter().enumerate() {
            if !inter.autonomous
                || (allowed == Access::Guest && inter.tags & content.social_rules.busy_tags != 0)
            {
                continue;
            }
            let s = ai::score(needs, inter, distance) * feel(inter.tags);
            if s > MIN_AUTONOMY_SCORE {
                candidates.push((s, Choice::Object(obj.id, i)));
            }
        }
    }

    for (j, other) in ctx.briefs.iter().enumerate() {
        if j == me || !other.available {
            continue;
        }
        // Chat with people on the same lot (or nearby on the street); crossing town is a visit.
        let distance = (other.pos[0] - sim.pos[0]).hypot(other.pos[1] - sim.pos[1]);
        let same_place = match (here, other.plot) {
            (Some(a), Some(b)) => a == b,
            _ => distance <= SOCIAL_RANGE,
        };
        if !same_place {
            continue;
        }
        let rel = ctx.rels.get(me, j);
        let chemistry = ctx.rels.chemistry(me, j);
        let attracted = other
            .gender_ix
            .is_none_or(|g| sim.attraction & (1 << g) != 0);
        for (k, s) in content.socials.iter().enumerate() {
            if !s.autonomous || !s.requires.allows(rel) {
                continue;
            }
            if s.tags & content.social_rules.romantic_tags != 0 && !attracted {
                continue;
            }
            let score = ai::score_gains(needs, &s.actor_gain, distance)
                * s.autonomy_weight
                * prefer_factor(s.prefer, rel, chemistry)
                * feel(s.tags);
            if score > MIN_AUTONOMY_SCORE {
                candidates.push((score, Choice::Social(j as u32, k)));
            }
        }
    }

    // NPC households visit friends who are home. Player Sims only travel when told to.
    let household = &ctx.households[sim.household as usize];
    let visits = &content.visits;
    if !household.player
        && sim.visiting.is_none()
        && here.is_some()
        && here == household.plot
        && (visits.earliest_hour..visits.latest_hour).contains(&ctx.hour)
    {
        for other in ctx.households.iter().filter(|h| h.id != household.id) {
            let Some(plot) = other.plot else { continue };
            let friendship = ctx
                .briefs
                .iter()
                .enumerate()
                .filter(|(_, b)| b.household == other.id && b.plot == Some(plot) && !b.away)
                .map(|(j, _)| ctx.rels.get(me, j).friendship)
                .fold(f32::NEG_INFINITY, f32::max);
            if friendship < visits.min_friendship {
                continue;
            }
            let door = ctx.plots[plot as usize].arrival_point();
            let distance = (door[0] - sim.pos[0]).hypot(door[1] - sim.pos[1]);
            // Travel is less of a deterrent than for a chat in the same room.
            let score = ai::score_gains(needs, &visits.gains, distance * 0.25)
                * (0.4 + friendship / 100.0)
                * feel(visits.tags);
            if score > MIN_AUTONOMY_SCORE {
                candidates.push((score, Choice::Visit(plot)));
            }
        }
    }

    ai::choose(&mut candidates, rng.next_f32(), 3).map(|choice| Task {
        kind: match choice {
            Choice::Object(object, interaction) => TaskKind::Use {
                object,
                interaction,
            },
            Choice::Social(target, social) => TaskKind::Social { target, social },
            Choice::Visit(plot) => TaskKind::Visit { plot },
        },
        directed: false,
    })
}

/// How much a relationship invites a social of the given kind.
pub(crate) fn prefer_factor(prefer: Prefer, rel: &social::Relationship, chemistry: f32) -> f32 {
    match prefer {
        Prefer::Any => 1.0,
        Prefer::Liked => (0.5 + rel.friendship / 100.0).clamp(0.1, 1.5),
        Prefer::Disliked => (0.4 - rel.friendship / 100.0).clamp(0.0, 1.4),
        Prefer::Romance => (rel.romance / 50.0 + chemistry * 0.4).clamp(0.0, 1.6),
        Prefer::Unloved => {
            if rel.partners && rel.romance < 25.0 {
                (25.0 - rel.romance) / 25.0
            } else {
                0.0
            }
        }
    }
}

fn start_task(sim: &mut Sim, task: Task, ctx: &Ctx, objects: &mut [ObjectInstance]) {
    let content = ctx.content;
    let nav = &ctx.nav;
    let (target, goal, tags) = match task.kind {
        TaskKind::Use {
            object,
            interaction,
        } => {
            let Some(obj) = objects.get(object as usize) else {
                return;
            };
            if obj.user.is_some_and(|u| u != sim.id) {
                return;
            }
            let t = obj.front_tile(content);
            let tags = content.objects[obj.def].interactions[interaction].tags;
            ([t.0 as f32 + 0.5, t.1 as f32 + 0.5], t, tags)
        }
        TaskKind::MoveTo { x, z } => ([x, z], (x.floor() as i32, z.floor() as i32), 0),
        TaskKind::Work => {
            // Nearest way out of town; with no exits, work starts on the spot.
            let exit = ctx.exits.iter().copied().min_by(|a, b| {
                let d = |p: &[f32; 2]| (p[0] - sim.pos[0]).hypot(p[1] - sim.pos[1]);
                d(a).total_cmp(&d(b))
            });
            let Some(exit) = exit else {
                sim.transition = Some(crate::life::Transition::Work);
                return;
            };
            (exit, (exit[0].floor() as i32, exit[1].floor() as i32), 0)
        }
        TaskKind::Visit { plot } => {
            sim.transition = Some(crate::life::Transition::Visit(plot));
            let door = ctx.plots[plot as usize].arrival_point();
            (
                door,
                (door[0].floor() as i32, door[1].floor() as i32),
                content.visits.tags,
            )
        }
        TaskKind::GoHome => {
            let home = ctx.households[sim.household as usize].plot;
            let Some(door) = home.map(|p| ctx.plots[p as usize].arrival_point()) else {
                sim.transition = Some(crate::life::Transition::Home);
                return;
            };
            (door, (door[0].floor() as i32, door[1].floor() as i32), 0)
        }
        TaskKind::Social { target, social } => {
            let Some(other) = ctx.briefs.get(target as usize) else {
                return;
            };
            if target == sim.id {
                return;
            }
            let Some(goal) = conversation::approach_tile(nav, other.pos, sim.pos) else {
                return;
            };
            (
                [goal.0 as f32 + 0.5, goal.1 as f32 + 0.5],
                goal,
                content.socials[social].tags,
            )
        }
    };
    let Some(waypoints) = route(nav, sim.pos, sim.tile(), goal, target) else {
        return;
    };
    if let TaskKind::Use { object, .. } = task.kind {
        objects[object as usize].user = Some(sim.id);
    }
    sim.pose = Pose::Stand;
    sim.current = Some(Activity {
        task,
        phase: Phase::Routing { waypoints, next: 0 },
        tags,
    });
}

/// Smoothed waypoints from `pos` to `target`, or None if unreachable.
pub(crate) fn route(
    nav: &NavGrid,
    pos: [f32; 2],
    start: (i32, i32),
    goal: (i32, i32),
    target: [f32; 2],
) -> Option<Vec<[f32; 2]>> {
    let path = nav.find_path(start, goal)?;
    let mut waypoints = nav.smooth(&path);
    // The first waypoint is the centre of the current tile; skip it when we can head on directly.
    if waypoints.len() > 1 && nav.line_walkable(pos, waypoints[1]) {
        waypoints.remove(0);
    }
    match waypoints.last_mut() {
        Some(last) => *last = target,
        None => waypoints.push(target),
    }
    Some(waypoints)
}

fn progress(sim: &mut Sim, content: &Content, objects: &mut [ObjectInstance]) {
    let Some(act) = sim.current.as_mut() else {
        return;
    };
    let finished = match &mut act.phase {
        Phase::Routing { waypoints, next } => {
            let mut budget = WALK_SPEED * sim.mods.walk_speed;
            while budget > 0.0 && *next < waypoints.len() {
                let wp = waypoints[*next];
                let (dx, dz) = (wp[0] - sim.pos[0], wp[1] - sim.pos[1]);
                let dist = dx.hypot(dz);
                if dist > 1e-4 {
                    sim.yaw = dx.atan2(dz);
                }
                if dist <= budget {
                    sim.pos = wp;
                    budget -= dist;
                    *next += 1;
                } else {
                    sim.pos[0] += dx / dist * budget;
                    sim.pos[1] += dz / dist * budget;
                    budget = 0.0;
                }
            }
            if *next >= waypoints.len() {
                arrive(sim, content, objects);
            }
            false
        }
        Phase::Using { elapsed } => {
            let TaskKind::Use {
                object,
                interaction,
            } = act.task.kind
            else {
                unreachable!("only Use tasks have a Using phase")
            };
            let inter = &content.objects[objects[object as usize].def].interactions[interaction];
            *elapsed += MINUTES_PER_TICK;
            let (mut any_gain, mut satisfied) = (false, true);
            for n in 0..content.needs.len() {
                let g = inter.gain_per_minute[n] * sim.mods.need_gain[n];
                if g > 0.0 {
                    any_gain = true;
                    sim.needs[n] = (sim.needs[n] + g * MINUTES_PER_TICK).min(1.0);
                    satisfied &= sim.needs[n] >= 0.999;
                }
            }
            *elapsed >= inter.minutes || (any_gain && satisfied)
        }
        // Conversations are driven by `conversation::update`, which sees both Sims.
        Phase::Waiting { .. } | Phase::Conversing { .. } => false,
    };
    if finished {
        end_activity(sim, content, objects);
    }
}

fn arrive(sim: &mut Sim, content: &Content, objects: &[ObjectInstance]) {
    let Some(act) = sim.current.as_mut() else {
        return;
    };
    match act.task.kind {
        TaskKind::MoveTo { .. } => sim.current = None,
        TaskKind::Work => {
            sim.current = None;
            sim.transition = Some(crate::life::Transition::Work);
        }
        TaskKind::Visit { .. } => sim.current = None,
        TaskKind::GoHome => {
            sim.current = None;
            sim.transition = Some(crate::life::Transition::Home);
        }
        TaskKind::Social { .. } => act.phase = Phase::Waiting { ticks: 0 },
        TaskKind::Use {
            object,
            interaction,
        } => {
            let obj = &objects[object as usize];
            let inter = &content.objects[obj.def].interactions[interaction];
            let c = obj.centre(content);
            if inter.pose == Pose::Stand {
                sim.yaw = (c[0] - sim.pos[0]).atan2(c[1] - sim.pos[1]);
            } else {
                sim.pos = c;
                sim.yaw = obj.yaw();
            }
            sim.pose = inter.pose;
            act.phase = Phase::Using { elapsed: 0.0 };
        }
    }
}

pub(crate) fn end_activity(sim: &mut Sim, content: &Content, objects: &mut [ObjectInstance]) {
    if let Some(act) = sim.current.take()
        && let TaskKind::Use { object, .. } = act.task.kind
    {
        let obj = &mut objects[object as usize];
        if obj.user == Some(sim.id) {
            obj.user = None;
        }
        if sim.pose != Pose::Stand {
            let (fx, fz) = obj.front_tile(content);
            sim.pos = [fx as f32 + 0.5, fz as f32 + 0.5];
        }
    }
    sim.pose = Pose::Stand;
    sim.idle_ticks = 0;
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTENT: &str = r#"{
        "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.1},
                 {"id":"energy","label":"Energy","decayPerHour":0.05}],
        "objects":[
          {"id":"fridge","name":"Fridge","interactions":[
            {"id":"snack","label":"Snack","minutes":10,"effects":{"hunger":0.4}}]},
          {"id":"bed","name":"Bed","footprint":[2,2],"interactions":[
            {"id":"sleep","label":"Sleep","minutes":480,"pose":"lie","effects":{"energy":1.0}}]}]}"#;

    const LOT: &str = r#"{"width":12,"depth":12,
        "walls":[[6,0,6,10]],
        "objects":[{"def":"fridge","x":1,"z":1,"rot":0},{"def":"bed","x":9,"z":2,"rot":3}],
        "sims":[{"name":"Ada","x":3.5,"z":3.5}]}"#;

    fn world() -> World {
        World::from_json(CONTENT, LOT, 7).unwrap()
    }

    fn run_ticks(w: &mut World, n: u32) {
        for _ in 0..n {
            w.tick_once();
        }
    }

    #[test]
    fn objects_block_tiles_and_overlaps_fail() {
        let mut w = world();
        assert!(w.blocked()[w.lot.tile_index(1, 1)]);
        assert!(w.place_object("fridge", 1, 1, 0).is_err());
    }

    #[test]
    fn hungry_sim_eats_autonomously() {
        let mut w = world();
        w.sims[0].needs[0] = 0.05;
        w.sims[0].needs[1] = 1.0;
        run_ticks(&mut w, TICKS_PER_SECOND * 60);
        assert!(
            w.sims[0].needs[0] > 0.3,
            "hunger was {}",
            w.sims[0].needs[0]
        );
    }

    #[test]
    fn directed_command_walks_around_wall_and_lies_down() {
        let mut w = world();
        w.sims[0].needs[1] = 0.1;
        w.apply(Command::Use {
            sim: 0,
            object: 1,
            interaction: 0,
        })
        .unwrap();
        run_ticks(&mut w, TICKS_PER_SECOND * 30);
        let s = &w.sims[0];
        assert_eq!(s.pose, Pose::Lie);
        assert_eq!(w.objects[1].user, Some(0));
        assert!(s.needs[1] > 0.1);
    }

    #[test]
    fn cancel_releases_object() {
        let mut w = world();
        w.apply(Command::Use {
            sim: 0,
            object: 1,
            interaction: 0,
        })
        .unwrap();
        run_ticks(&mut w, 2);
        assert_eq!(w.objects[1].user, Some(0));
        w.apply(Command::Cancel { sim: 0, index: 0 }).unwrap();
        assert_eq!(w.objects[1].user, None);
        assert_eq!(w.sims[0].pose, Pose::Stand);
    }

    #[test]
    fn speed_controls_tick_rate() {
        let mut w = world();
        w.apply(Command::SetSpeed { speed: 0 }).unwrap();
        w.advance();
        assert_eq!(w.tick, 0);
        w.apply(Command::SetSpeed { speed: 3 }).unwrap();
        w.advance();
        assert_eq!(w.tick, TICKS_PER_STEP[3] as u64);
        assert!(w.apply(Command::SetSpeed { speed: 9 }).is_err());
    }

    #[test]
    fn deterministic_for_same_seed() {
        let (mut a, mut b) = (world(), world());
        run_ticks(&mut a, 2000);
        run_ticks(&mut b, 2000);
        assert_eq!(a.sims[0].pos, b.sims[0].pos);
        assert_eq!(a.sims[0].needs, b.sims[0].needs);
    }

    #[test]
    fn neighbours_do_not_use_other_households_objects() {
        let lot = r#"{"width":20,"depth":10,
            "plots":[{"name":"A","x":0,"z":0,"w":10,"d":10},{"name":"B","x":10,"z":0,"w":10,"d":10}],
            "households":[{"name":"A","plot":0,"player":true},{"name":"B","plot":1}],
            "objects":[{"def":"fridge","x":2,"z":2,"rot":0}],
            "sims":[{"name":"Neighbour","household":1,"x":14.5,"z":4.5}]}"#;
        let mut w = World::from_json(CONTENT, lot, 1).unwrap();
        w.sims[0].needs[0] = 0.0;
        run_ticks(&mut w, TICKS_PER_SECOND * 60);
        assert_eq!(w.objects[0].user, None);
        assert!(w.sims[0].pos[0] > 10.0, "stayed home");
    }
}
