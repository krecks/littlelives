//! World state and the per-tick update.

use std::collections::VecDeque;
use std::f32::consts::FRAC_PI_2;

use crate::clock::{AUTO_FAST_SPEED, MAX_SPEED, TICKS_PER_STEP};
use crate::content::{Content, MAX_NEEDS, MAX_SKILLS, MAX_SLOTS, Modifiers, Pose, TagMask};
use crate::lot::{BondRaw, Lot, LotFile, SimSpawn};
use crate::path::NavGrid;
use crate::rng::Rng;
use serde::{Deserialize, Serialize};
use crate::social::{self, ActiveFeeling, EventLog, Prefer, Relationships};
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

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectInstance {
    /// Equal to the object's index in `World::objects`.
    pub id: u32,
    pub def: usize,
    /// Minimum corner of the rotated footprint.
    pub x: i32,
    pub z: i32,
    /// Facing: 0 = +z, 1 = +x, 2 = -z, 3 = -x.
    pub rot: u8,
    /// Degrees turned past `rot` (0..90), for objects that turn freely; only for looks.
    pub turn: u8,
    /// Sims using or walking to this object, one per slot.
    pub users: [Option<u32>; MAX_SLOTS],
    /// Upgrade level: higher quality objects satisfy needs and teach skills faster.
    pub quality: u8,
    /// Index into `Content::styles` (visual only).
    pub style: u8,
    /// Money put into this object (price plus upgrades), for resale.
    pub value: i64,
}

impl ObjectInstance {
    pub fn users(&self) -> impl Iterator<Item = u32> + '_ {
        self.users.iter().flatten().copied()
    }

    pub fn in_use(&self) -> bool {
        self.users.iter().any(Option::is_some)
    }

    /// Whether `sim` can use this object (it has a free slot, or `sim` already holds one).
    pub fn can_use(&self, sim: u32, slots: u8) -> bool {
        self.users[..slots as usize]
            .iter()
            .any(|u| u.is_none_or(|u| u == sim))
    }

    pub fn has_free_slot(&self, slots: u8) -> bool {
        self.users[..slots as usize].iter().any(Option::is_none)
    }

    fn slot_of(&self, sim: u32) -> Option<usize> {
        self.users.iter().position(|u| *u == Some(sim))
    }

    /// Takes a slot for `sim` (keeps the one it already has).
    fn reserve(&mut self, sim: u32, slots: u8) -> bool {
        if self.slot_of(sim).is_some() {
            return true;
        }
        match self.users[..slots as usize]
            .iter()
            .position(Option::is_none)
        {
            Some(i) => {
                self.users[i] = Some(sim);
                true
            }
            None => false,
        }
    }

    fn release(&mut self, sim: u32) {
        for u in &mut self.users {
            if *u == Some(sim) {
                *u = None;
            }
        }
    }

    /// Where a Sim sits or lies in `slot`: spread across the object's width.
    pub fn slot_position(&self, content: &Content, slot: usize) -> [f32; 2] {
        let def = &content.objects[self.def];
        let c = self.centre(content);
        let n = def.slots.max(1) as f32;
        let offset = (slot as f32 - (n - 1.0) / 2.0) * def.footprint[0] as f32 / n;
        let yaw = self.yaw();
        // Local +x (the object's right) after rotation.
        [c[0] + yaw.cos() * offset, c[1] - yaw.sin() * offset]
    }
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

    pub(crate) fn tiles(&self, content: &Content) -> impl Iterator<Item = (i32, i32)> + use<> {
        let (w, d) = self.size(content);
        let (x0, z0) = (self.x, self.z);
        (0..d).flat_map(move |dz| (0..w).map(move |dx| (x0 + dx, z0 + dz)))
    }

    /// Pairs of neighbouring tiles that must not have a wall between them: inside the
    /// footprint, and from the footprint to the front tile.
    pub(crate) fn wall_edges(
        &self,
        content: &Content,
    ) -> impl Iterator<Item = ((i32, i32), (i32, i32))> + use<> {
        let (w, d) = self.size(content);
        let (x0, z0) = (self.x, self.z);
        let inside = (0..d).flat_map(move |dz| {
            (0..w).flat_map(move |dx| {
                let t = (x0 + dx, z0 + dz);
                let right = (dx + 1 < w).then_some((t, (t.0 + 1, t.1)));
                let down = (dz + 1 < d).then_some((t, (t.0, t.1 + 1)));
                right.into_iter().chain(down)
            })
        });
        let front = self.front_tile(content);
        let (bx, bz) = match self.rot % 4 {
            0 => (front.0, front.1 - 1),
            1 => (front.0 - 1, front.1),
            2 => (front.0, front.1 + 1),
            _ => (front.0 + 1, front.1),
        };
        inside.chain(std::iter::once(((bx, bz), front)))
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

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone)]
pub struct Activity {
    pub task: Task,
    pub phase: Phase,
    /// Tags of the interaction or social being performed (for "busy" checks and autonomy).
    pub tags: TagMask,
}

#[derive(Debug, Clone)]
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
    pub base_mods: Modifiers,
    /// Effective modifiers: `base_mods` combined with the effects of active feelings.
    pub mods: Modifiers,
    /// Feelings (defs, sorted) whose effects are folded into `mods`.
    pub(crate) buffs: Vec<usize>,
    /// Money the household owes for interactions started this tick (settled by `life::update`).
    pub(crate) pending_spend: i64,
    pub pos: [f32; 2],
    pub yaw: f32,
    pub pose: Pose,
    pub needs: [f32; MAX_NEEDS],
    pub feelings: Vec<ActiveFeeling>,
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
    /// Skill levels, `0..=max_level` (the whole number is the level shown to players).
    pub skills: [f32; MAX_SKILLS],
    /// Skills that reached a new level this tick (bitmask), reported by `life::update`.
    pub(crate) skill_ups: u32,
    /// Grows while practising and fades otherwise, so Sims don't train for hours on end.
    pub(crate) practice_fatigue: f32,
    /// The first day this Sim looks for work again (after quitting or being let go).
    pub job_search_from: u32,
    /// Routines, goals and how planned blocks went (see `planner`).
    pub planner: crate::planner::Planner,
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

    /// In bed for the night (or a nap): using something tagged as sleep.
    pub fn asleep(&self, content: &Content) -> bool {
        self.current.as_ref().is_some_and(|a| {
            a.tags & content.day_rhythm.sleep_tags != 0 && matches!(a.phase, Phase::Using { .. })
        })
    }

    pub fn queue(&self) -> impl Iterator<Item = &Task> {
        self.queue.iter()
    }

    /// Needs average plus trait and feeling effects, 0..1.
    pub fn mood(&self, content: &Content) -> f32 {
        let n = content.needs.len();
        let needs = self.needs[..n].iter().sum::<f32>() / n as f32;
        (needs + self.mods.mood + social::feeling_mood(&self.feelings, &content.feelings))
            .clamp(0.0, 1.0)
    }

    pub fn emotion(&self, content: &Content) -> Option<usize> {
        social::dominant_emotion(&self.feelings, &content.feelings)
    }

    /// Recomputes `mods` when the set of active feelings with effects has changed.
    pub(crate) fn refresh_buffs(&mut self, content: &Content) {
        let defs = &content.feelings;
        let mut active = self
            .feelings
            .iter()
            .filter(|m| defs[m.def].effects.is_some());
        if active.clone().count() == self.buffs.len() && active.all(|m| self.buffs.contains(&m.def))
        {
            return;
        }
        self.buffs.clear();
        self.buffs.extend(
            self.feelings
                .iter()
                .filter(|m| defs[m.def].effects.is_some())
                .map(|m| m.def),
        );
        self.buffs.sort_unstable();
        self.mods = self.base_mods.clone();
        for &m in &self.buffs {
            if let Some(e) = &defs[m].effects {
                self.mods.combine(e);
            }
        }
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
        // Busy with a planned block (unless it's for socialising).
        if let Some(run) = &self.planner.run
            && run.skipped.is_none()
            && !run.no_place
            && !content.activities.get(run.activity).is_some_and(|a| a.social || a.visit)
        {
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

/// How a house's roof looks: a roof style and a roof colour (indices into the content's
/// `roofStyles` and `roofColors`). Presentation only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoofLook {
    pub style: u8,
    pub color: u8,
}

/// A region of the town: a residential lot or a public place.
#[derive(Debug, Clone, PartialEq)]
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
    /// The roof the player chose for the house on this plot (None: the town's own look).
    pub roof: Option<RoofLook>,
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

/// How a game treats money for building: chosen once per game.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameMode {
    /// The residents earn the money: build and buy are paid from household funds.
    #[default]
    Living,
    /// Building is free: build and buy cost nothing (selling brings nothing back), and the
    /// player's home pays no rent or bills.
    Creative,
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
    /// Preferred object style for purchases (index into `Content::styles`).
    pub style: u8,
    /// "Free will": whether this household's residents choose what to do on their own.
    pub free_will: bool,
    /// Routine blocks every member follows (each may skip some; their own blocks win).
    pub routines: Vec<crate::planner::Routine>,
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
    /// Living or Creative (see `GameMode`).
    pub mode: GameMode,
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
    /// Master switch for "free will" in the whole town (each household also has its own,
    /// `Household::free_will`). Off is mainly for tests.
    pub autonomy: bool,
    pub(crate) rng: Rng,
    pub(crate) structure_version: u32,
    pub(crate) briefs: Vec<SimBrief>,
    /// Where Sims leave town for work.
    pub exits: Vec<[f32; 2]>,
    /// Opaque presentation data from the lot/town file, saved unchanged.
    pub meta: serde_json::Value,
    /// Build and buy edits that can be taken back, oldest first (see `World::undo`).
    pub(crate) undo: Vec<crate::home::HomeSnapshot>,
    /// Edits taken back that can be made again, latest last (see `World::redo`).
    pub(crate) redo: Vec<crate::home::HomeSnapshot>,
    /// "Skip quiet hours": run at `AUTO_FAST_SPEED` while the player's household is asleep
    /// or out and nothing notable happened at home in the last hour (see `World::calm`).
    pub auto_fast: bool,
    /// What each household's home (plus public places) offers, for planned activities;
    /// recomputed when the structure changes.
    pub(crate) offers: Vec<crate::planner::HouseOffer>,
    pub(crate) offers_version: u32,
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
    pub day: u32,
    pub minute: f32,
    pub tick: u64,
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
        world.mode = lot_file.mode;
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
                roof: None,
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
                style: 0,
                free_will: true,
                routines: Vec::new(),
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
                    style: 0,
                    free_will: true,
                    routines: Vec::new(),
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
            return Err(Error::new(format!("at most {MAX_SIMS} residents per town")));
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
            mode: GameMode::Living,
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
            undo: Vec::new(),
            redo: Vec::new(),
            auto_fast: false,
            offers: Vec::new(),
            offers_version: 0,
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
        let value = self.content.objects[def].price.unwrap_or(0);
        self.place(def, x, z, rot, 0, 0, value)
    }

    /// Checks that object `def` fits at `x, z, rot`: inside the lot, on free tiles without a
    /// diagonal wall, facing a tile on the lot.
    pub(crate) fn check_fit(
        &self,
        def: usize,
        x: i32,
        z: i32,
        rot: u8,
    ) -> Result<ObjectInstance, Error> {
        let obj = ObjectInstance {
            id: self.objects.len() as u32,
            def,
            x,
            z,
            rot: rot % 4,
            turn: 0,
            users: [None; MAX_SLOTS],
            quality: 0,
            style: 0,
            value: 0,
        };
        let name = &self.content.objects[def].id;
        for (tx, tz) in obj.tiles(&self.content) {
            if !self.lot.in_bounds(tx, tz) || self.blocked[self.lot.tile_index(tx, tz)] {
                return Err(Error::new(format!(
                    "'{name}' at {x},{z} overlaps or leaves the lot"
                )));
            }
            // Furniture never stands on a tile split by a diagonal wall (it would overlap it).
            if self.lot.diag(tx, tz).is_some() {
                return Err(Error::new(format!(
                    "'{name}' at {x},{z} overlaps a diagonal wall"
                )));
            }
        }
        let (fx, fz) = obj.front_tile(&self.content);
        if !self.lot.in_bounds(fx, fz) {
            return Err(Error::new(format!("'{name}' at {x},{z} faces off the lot")));
        }
        // No wall or fence may run through the footprint or between the object and where it's
        // used from.
        if obj.wall_edges(&self.content).any(|(a, b)| {
            self.lot.edge_between(a.0, a.1, b.0, b.1) != crate::lot::Edge::Open
        }) {
            return Err(Error::new(format!("'{name}' at {x},{z} is blocked by a wall")));
        }
        Ok(obj)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn place(
        &mut self,
        def: usize,
        x: i32,
        z: i32,
        rot: u8,
        style: u8,
        quality: u8,
        value: i64,
    ) -> Result<u32, Error> {
        let mut obj = self.check_fit(def, x, z, rot)?;
        obj.style = style;
        obj.quality = quality.min(self.content.object_rules.max_quality);
        obj.value = value;
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
            return Err(Error::new(format!("resident '{name}' spawns off the lot")));
        }
        if self.sims.len() >= MAX_SIMS {
            return Err(Error::new(format!("at most {MAX_SIMS} residents per town")));
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
                Some(crate::life::Job::new(career, level, 0))
            }
        };
        // Traits give a head start; explicit levels win; anyone placed in a job has the skills for it.
        let mut skills = content.starting_skills(&spawn.traits);
        for (id, level) in &spawn.skills {
            let s = content
                .skill_index(id)
                .ok_or_else(|| Error::new(format!("{name}: unknown skill '{id}'")))?;
            skills[s] = *level;
        }
        if let Some(j) = &job {
            for &(s, level) in &content.careers[j.career].levels[j.level].requires {
                skills[s] = skills[s].max(level);
            }
        }
        let max = content.skill_rules.max_level;
        for s in &mut skills {
            *s = s.clamp(0.0, max);
        }

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
            base_mods: mods.clone(),
            mods,
            buffs: Vec::new(),
            pending_spend: 0,
            pos: [*x, *z],
            yaw: 0.0,
            pose: Pose::Stand,
            needs,
            feelings: Vec::new(),
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
            skills,
            skill_ups: 0,
            practice_fatigue: 0.0,
            job_search_from: 0,
            planner: Default::default(),
        });
        self.relationships.grow(self.sims.len());
        Ok(self.sims.len() as u32 - 1)
    }

    /// New residents move into household `household`'s home (see `Command::MoveIn`): all of
    /// them or, if any can't (unknown traits, a bad bond), none.
    pub fn move_in(
        &mut self,
        household: u32,
        name: Option<String>,
        sims: &[SimSpawn],
        bonds: &[BondRaw],
    ) -> Result<(), Error> {
        let (h, _) = self.home_of(household)?;
        if sims.is_empty() {
            return Err(Error::new("nobody to move in"));
        }
        let members = self.sims.iter().filter(|s| s.household as usize == h).count();
        let most = self.content.rules.max_household;
        if members + sims.len() > most {
            return Err(Error::new(format!("at most {most} residents per household")));
        }
        if self.sims.len() + sims.len() > MAX_SIMS {
            return Err(Error::new(format!("at most {MAX_SIMS} residents per town")));
        }
        let first = self.sims.len();
        let (relationships, rng) = (self.relationships.clone(), self.rng.clone());
        let moved = sims
            .iter()
            .try_for_each(|s| {
                let spawn = SimSpawn {
                    household,
                    ..s.clone()
                };
                self.spawn_sim(&spawn).map(|_| ())
            })
            .and_then(|()| {
                if bonds.iter().any(|b| b.a >= sims.len() || b.b >= sims.len()) {
                    return Err(Error::new("a bond refers to someone who isn't moving in"));
                }
                let bonds: Vec<BondRaw> = bonds
                    .iter()
                    .map(|b| BondRaw {
                        a: first + b.a,
                        b: first + b.b,
                        preset: b.preset.clone(),
                    })
                    .collect();
                self.init_relationships_from(first, &bonds)
            });
        if let Err(e) = moved {
            self.sims.truncate(first);
            self.relationships = relationships;
            self.rng = rng;
            return Err(e);
        }
        if let Some(name) = name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
            self.households[h].name = name.to_string();
        }
        self.structure_version += 1;
        self.events
            .push_detail(self.tick, social::EventKind::MovedIn, first, None, None);
        Ok(())
    }

    /// Chemistry for every pair, household bonds, then explicit bonds from the lot file.
    pub(crate) fn init_relationships(&mut self, bonds: &[BondRaw]) -> Result<(), Error> {
        self.init_relationships_from(0, bonds)
    }

    /// Chemistry and household bonds for every pair with a resident from index `first` on (the
    /// ones before already have theirs), then `bonds` (indices into the whole list).
    fn init_relationships_from(&mut self, first: usize, bonds: &[BondRaw]) -> Result<(), Error> {
        let n = self.sims.len();
        let default_bond = self.content.social_rules.default_bond;
        for a in 0..n {
            for b in (a + 1).max(first)..n {
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
                    "bond {}-{} refers to unknown residents",
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
                return Err(Error::new("a resident can only have one partner"));
            }
            self.relationships.bond(bond.a, bond.b, preset);
        }
        Ok(())
    }

    /// Advances one real-time step (1 / TICKS_PER_SECOND s) at the current speed, faster
    /// while it's calm at home and `auto_fast` is on.
    pub fn advance(&mut self) {
        let normal = TICKS_PER_STEP[self.speed as usize];
        let most = if self.auto_fast && normal > 0 {
            normal.max(TICKS_PER_STEP[AUTO_FAST_SPEED as usize])
        } else {
            normal
        };
        for i in 0..most {
            if i >= normal && !self.calm() {
                break;
            }
            self.tick_once();
        }
    }

    /// Whether time may skip ahead: everyone in the player's household is asleep or away at
    /// work, and nothing notable happened to them in the last game hour.
    pub fn calm(&self) -> bool {
        let home = |h: u32| self.households[h as usize].player;
        let mut members = self.sims.iter().filter(|s| home(s.household)).peekable();
        if members.peek().is_none() {
            return false;
        }
        let quiet = members.all(|s| s.away_until.is_some() || s.asleep(&self.content));
        let hour_ago = self.tick.saturating_sub((60.0 / MINUTES_PER_TICK) as u64);
        quiet
            && !self.events.iter().rev().take_while(|e| e.tick >= hour_ago).any(|e| {
                e.kind.importance() >= 1
                    && [Some(e.a), Some(e.b), e.c]
                        .into_iter()
                        .flatten()
                        .any(|s| self.sims.get(s as usize).is_some_and(|s| home(s.household)))
            })
    }

    pub fn tick_once(&mut self) {
        // Time moves on: edits can no longer be taken back.
        self.undo.clear();
        self.redo.clear();
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
                day: crate::clock::day(tick),
                minute: crate::clock::minute_of_day(tick),
                tick,
            };
            for sim in sims.iter_mut() {
                step_sim(sim, &ctx, objects, rng);
            }
        }
        conversation::update(self);
        crate::life::update(self);
        crate::planner::update(self);

        for s in &mut self.sims {
            s.feelings.retain(|m| m.expires > tick);
            if self.content.buff_feelings {
                s.refresh_buffs(&self.content);
            }
        }
        if tick.is_multiple_of(TICKS_PER_DAY) {
            self.relationships.decay(&self.content.social_rules);
        }
    }

    /// Applies a player command. Build and buy edits can be undone (`Command::Undo`) until time
    /// moves on or the player gives the household another kind of order.
    pub fn apply(&mut self, cmd: Command) -> Result<(), Error> {
        match cmd {
            Command::Undo { household } => return self.undo(household),
            Command::Redo { household } => return self.redo(household),
            _ => {}
        }
        let snapshot = cmd.home_edit().and_then(|h| self.home_snapshot(h));
        let keeps_history = matches!(
            cmd,
            Command::SetSpeed { .. }
                | Command::SetAutonomy { .. }
                | Command::SetAutoFast { .. }
                | Command::SetRoutines { .. }
                | Command::SetHouseholdRoutines { .. }
                | Command::SkipHouseholdRoutine { .. }
                | Command::AddGoal { .. }
                | Command::RemoveGoal { .. }
                | Command::AcceptSuggestion { .. }
                | Command::DismissSuggestion { .. }
        );
        self.apply_command(cmd)?;
        match snapshot {
            Some(s) => self.remember(s),
            None if !keeps_history => {
                self.undo.clear();
                self.redo.clear();
            }
            None => {}
        }
        Ok(())
    }

    fn apply_command(&mut self, cmd: Command) -> Result<(), Error> {
        match cmd {
            Command::SetSpeed { speed } => {
                if speed > MAX_SPEED {
                    return Err(Error::new(format!("speed must be 0..={MAX_SPEED}")));
                }
                self.speed = speed;
            }
            Command::SetAutoFast { enabled } => self.auto_fast = enabled,
            Command::SetRoutines { sim, routines } => {
                let routines = crate::planner::routines_from(&self.content, &routines)?;
                let s = self.sim_mut(sim)?;
                s.planner.routines = routines;
                // A changed block starts over (with today's plan).
                s.planner.run = None;
            }
            Command::SetHouseholdRoutines { sim, routines } => {
                let routines = crate::planner::routines_from(&self.content, &routines)?;
                let h = self.sim(sim)?.household as usize;
                self.households[h].routines = routines;
                for s in self.sims.iter_mut().filter(|s| s.household as usize == h) {
                    s.planner.run = None;
                }
            }
            Command::SkipHouseholdRoutine { sim, routine, skip } => {
                let skips = &mut self.sim_mut(sim)?.planner.skip_household;
                skips.retain(|&r| r != routine);
                if skip {
                    skips.push(routine);
                }
            }
            Command::AddGoal { sim, goal } => {
                let day = crate::clock::day(self.tick);
                let goal = crate::planner::goal_from(&self.content, &goal, self.sim(sim)?, day)?;
                let max = self.content.planner.max_goals;
                let s = self.sim_mut(sim)?;
                if s.planner.goals.len() >= max {
                    return Err(Error::new(format!("{} has {max} goals already", s.name)));
                }
                s.planner.goals.push(goal);
            }
            Command::RemoveGoal { sim, index } => {
                let goals = &mut self.sim_mut(sim)?.planner.goals;
                if index < goals.len() {
                    goals.remove(index);
                }
            }
            Command::AcceptSuggestion { sim, index } => {
                let max = self.content.planner.max_goals;
                let day = crate::clock::day(self.tick);
                let s = self.sim_mut(sim)?;
                if index < s.planner.suggestions.len() {
                    if s.planner.goals.len() >= max {
                        return Err(Error::new(format!("{} has {max} goals already", s.name)));
                    }
                    let mut goal = s.planner.suggestions.remove(index);
                    goal.since_day = day;
                    s.planner.goals.push(goal);
                }
            }
            Command::DismissSuggestion { sim, index } => {
                let suggestions = &mut self.sim_mut(sim)?.planner.suggestions;
                if index < suggestions.len() {
                    suggestions.remove(index);
                }
            }
            Command::SetAutonomy { enabled, household } => {
                if let Some(h) = household {
                    self.households
                        .get_mut(h as usize)
                        .ok_or_else(|| Error::new(format!("unknown household {h}")))?
                        .free_will = enabled;
                } else {
                    for h in self.households.iter_mut().filter(|h| h.player) {
                        h.free_will = enabled;
                    }
                }
            }
            Command::Use {
                sim,
                object,
                interaction,
            } => {
                let obj = self
                    .objects
                    .get(object as usize)
                    .ok_or_else(|| Error::new(format!("unknown object {object}")))?;
                let Some(inter) = self.content.objects[obj.def].interactions.get(interaction)
                else {
                    return Err(Error::new(format!(
                        "object {object} has no interaction {interaction}"
                    )));
                };
                let household = self.sim(sim)?.household as usize;
                if !affordable(inter.cost, self.households[household].funds) {
                    return Err(Error::new(format!(
                        "not enough money: {} costs {}",
                        inter.label, inter.cost
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
            Command::JoinCareer { sim, career, level } => {
                let def = self
                    .content
                    .careers
                    .get(career)
                    .ok_or_else(|| Error::new(format!("unknown career {career}")))?;
                let position = def
                    .levels
                    .get(level)
                    .ok_or_else(|| Error::new(format!("{} has no level {level}", def.label)))?;
                let s = self
                    .sims
                    .get_mut(sim as usize)
                    .ok_or_else(|| Error::new(format!("unknown resident {sim}")))?;
                if !crate::life::can_join(&self.content, position, &s.skills) {
                    return Err(Error::new(format!(
                        "{} doesn't have the skills to be a {} yet",
                        s.name, position.title
                    )));
                }
                s.job = Some(crate::life::Job::new(
                    career,
                    level,
                    crate::clock::day(self.tick),
                ));
            }
            Command::QuitCareer { sim } => {
                self.sims
                    .get_mut(sim as usize)
                    .ok_or_else(|| Error::new(format!("unknown resident {sim}")))?
                    .job = None;
            }
            Command::Visit { sim, plot } => {
                if plot as usize >= self.plots.len() {
                    return Err(Error::new(format!("unknown plot {plot}")));
                }
                self.enqueue(sim, TaskKind::Visit { plot })?;
            }
            Command::GoHome { sim } => self.enqueue(sim, TaskKind::GoHome)?,
            Command::Buy {
                household,
                object,
                at,
                style,
                turn,
            } => {
                let def = self.content.object_index(&object);
                let turn = def.map(|d| self.check_turn(d, turn.unwrap_or(0))).transpose()?;
                let id = self.buy(household, &object, at, style)?;
                self.objects[id as usize].turn = turn.unwrap_or(0);
            }
            Command::Sell { household, object } => self.sell(household, object)?,
            Command::MoveObject {
                household,
                object,
                x,
                z,
                rot,
                turn,
            } => {
                let def = self.objects.get(object as usize).map(|o| o.def);
                let turn = match (def, turn) {
                    (Some(d), Some(t)) => Some(self.check_turn(d, t)?),
                    _ => None,
                };
                self.move_object(household, object, x, z, rot)?;
                if let Some(t) = turn {
                    self.objects[object as usize].turn = t;
                }
            }
            Command::Restyle {
                household,
                object,
                style,
            } => self.restyle(household, object, style)?,
            Command::SetStyle { household, style } => {
                let h = self.home_of(household)?.0;
                self.households[h].style = self.check_style(style)?;
            }
            Command::Upgrade { household, object } => {
                self.upgrade(household, object)?;
            }
            Command::Build { household, edits } => self.build(household, &edits)?,
            Command::Paint { household, faces } => self.paint(household, &faces)?,
            Command::PaintFloor { household, tiles } => self.paint_floor(household, &tiles)?,
            Command::Undo { household } => self.undo(household)?,
            Command::Redo { household } => self.redo(household)?,
            Command::SetRoof {
                household,
                style,
                color,
            } => self.set_roof(household, style, color)?,
            Command::MoveIn {
                household,
                name,
                sims,
                bonds,
            } => self.move_in(household, name, &sims, &bonds)?,
            Command::Cancel { sim, index } => {
                let World {
                    sims,
                    objects,
                    content,
                    ..
                } = self;
                let s = sims
                    .get_mut(sim as usize)
                    .ok_or_else(|| Error::new(format!("unknown resident {sim}")))?;
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
            .ok_or_else(|| Error::new(format!("unknown resident {id}")))
    }

    fn sim_mut(&mut self, id: u32) -> Result<&mut Sim, Error> {
        self.sims
            .get_mut(id as usize)
            .ok_or_else(|| Error::new(format!("unknown resident {id}")))
    }

    fn enqueue(&mut self, sim: u32, kind: TaskKind) -> Result<(), Error> {
        let s = self
            .sims
            .get_mut(sim as usize)
            .ok_or_else(|| Error::new(format!("unknown resident {sim}")))?;
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

/// Whether a household with `funds` can pay `cost` (free things are always affordable).
pub fn affordable(cost: i64, funds: i64) -> bool {
    cost <= 0 || funds >= cost
}

/// Hour a Sim gets up today: the usual time, or earlier for an early shift.
fn wake_hour(sim: &Sim, ctx: &Ctx) -> f32 {
    let rhythm = &ctx.content.day_rhythm;
    let leave = sim
        .job
        .as_ref()
        .and_then(|job| crate::life::shift_today(ctx.content, job, &sim.skills, ctx.tick));
    match leave {
        Some((leave, ..)) if leave > ctx.tick => (crate::clock::hour(leave)
            - rhythm.wake_before_work_minutes / 60.0)
            .clamp(0.0, rhythm.wake_hour),
        _ => rhythm.wake_hour,
    }
}

/// Whether it is night for this Sim (time to be in bed): their planned sleep, else the usual
/// day rhythm.
fn is_night(sim: &Sim, ctx: &Ctx) -> bool {
    let routines = &ctx.households[sim.household as usize].routines;
    if let Some(night) = crate::planner::planned_night(ctx.content, sim, routines, ctx.day, ctx.minute) {
        return night;
    }
    let rhythm = &ctx.content.day_rhythm;
    if ctx.hour >= rhythm.bed_hour {
        return true;
    }
    if ctx.hour >= rhythm.wake_hour {
        return false;
    }
    rhythm.is_night(ctx.hour, wake_hour(sim, ctx))
}

/// Target skill levels: what probation and the next promotion need, and skill goals.
fn job_goals(sim: &Sim, content: &Content) -> [f32; MAX_SKILLS] {
    let mut goals = [0.0f32; MAX_SKILLS];
    if let Some(job) = &sim.job {
        let levels = &content.careers[job.career].levels;
        for level in levels[job.level..].iter().take(2) {
            for &(s, l) in &level.requires {
                goals[s] = goals[s].max(l);
            }
        }
    }
    crate::planner::skill_targets(content, sim, &mut goals);
    goals
}

/// How much an idle Sim wants to practise with `inter` (0 when needs come first).
fn training_interest(sim: &Sim, content: &Content, inter: &crate::content::Interaction) -> f32 {
    let rules = &content.skill_rules;
    let lowest = sim.needs[..content.needs.len()]
        .iter()
        .copied()
        .fold(1.0f32, f32::min);
    if lowest < 0.35 {
        return 0.0;
    }
    let goals = job_goals(sim, content);
    let mut best = 0.0f32;
    for (s, &gain) in inter.skill_gain.iter().enumerate() {
        if gain <= 0.0 || sim.skills[s] >= rules.max_level {
            continue;
        }
        let mut want = rules.interest * sim.mods.skill_gain[s];
        if goals[s] > sim.skills[s] {
            want += rules.goal_interest;
        }
        best = best.max(want);
    }
    best * lowest / (1.0 + sim.practice_fatigue)
}

/// Adds practice to a skill and notes a new level.
pub(crate) fn practise(sim: &mut Sim, content: &Content, skill: usize, per_hour: f32) {
    let rules = &content.skill_rules;
    let before = sim.skills[skill];
    let gain = rules.gain(
        per_hour * sim.mods.skill_gain[skill],
        MINUTES_PER_TICK / 60.0,
        before,
    );
    let after = (before + gain).min(rules.max_level);
    sim.skills[skill] = after;
    if after.floor() > before.floor() {
        sim.skill_ups |= 1 << skill;
    }
}

fn step_sim(sim: &mut Sim, ctx: &Ctx, objects: &mut [ObjectInstance], rng: &mut Rng) {
    let content = ctx.content;
    let rhythm = &content.day_rhythm;
    let asleep = sim.asleep(content);
    let night = !asleep && rhythm.sleep_tags != 0 && is_night(sim, ctx);
    let practising = sim.current.as_ref().is_some_and(|a| {
        matches!(a.phase, Phase::Using { .. })
            && matches!(a.task.kind, TaskKind::Use { object, interaction }
                if content.objects[objects[object as usize].def].interactions[interaction].trains_skills())
    });
    let skill_rules = &content.skill_rules;
    sim.practice_fatigue = if practising {
        sim.practice_fatigue + skill_rules.fatigue_per_hour * MINUTES_PER_TICK / 60.0
    } else {
        (sim.practice_fatigue - skill_rules.fatigue_recovery_per_hour * MINUTES_PER_TICK / 60.0)
            .max(0.0)
    };
    for (n, def) in content.needs.iter().enumerate() {
        let rhythm_factor = if sim.away_until.is_some() {
            rhythm.work_decay[n]
        } else if asleep {
            rhythm.asleep_decay[n]
        } else if night {
            rhythm.night_decay[n]
        } else {
            1.0
        };
        let decay =
            def.decay_per_minute * sim.mods.need_decay[n] * rhythm_factor * MINUTES_PER_TICK;
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
            let free_will = ctx.autonomy && ctx.households[sim.household as usize].free_will;
            if free_will && sim.idle_ticks >= AUTONOMY_DELAY_TICKS {
                sim.idle_ticks = 0;
                if let Some(task) = pick_autonomous(sim, ctx, objects, rng) {
                    start_task(sim, task, ctx, objects);
                }
            }
        }
    }

    progress(sim, ctx, objects);
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
    let feel = |tags: TagMask| {
        sim.mods.preference(tags)
            * emotion.map_or(1.0, |m| m.preference(tags))
            * schedule.preference(tags)
    };
    let me = sim.id as usize;
    let here = ctx.briefs[me].plot;
    let mut candidates: Vec<(f32, Choice)> = Vec::new();
    let routines = &ctx.households[sim.household as usize].routines;
    let night = crate::planner::planned_night(content, sim, routines, ctx.day, ctx.minute);

    let object_rules = &content.object_rules;
    let funds = ctx.households[sim.household as usize].funds - sim.pending_spend;
    for obj in objects
        .iter()
        .filter(|o| o.has_free_slot(content.objects[o.def].slots))
    {
        let allowed = access(ctx, sim, ctx.object_plot[obj.id as usize]);
        if allowed == Access::None {
            continue;
        }
        let (fx, fz) = obj.front_tile(content);
        let distance = (fx as f32 + 0.5 - sim.pos[0]).hypot(fz as f32 + 0.5 - sim.pos[1]);
        for (i, inter) in content.objects[obj.def].interactions.iter().enumerate() {
            if !inter.autonomous
                || (allowed == Access::Guest && inter.tags & content.social_rules.busy_tags != 0)
                || !affordable(inter.cost, funds)
            {
                continue;
            }
            // Better objects and more skilled Sims get more out of it, and know it.
            let boost = object_rules.quality_factor(obj.quality)
                * inter.skill_factor(&content.skill_rules, &sim.skills);
            let mut s = ai::score_gains(needs, &inter.total_gain.map(|g| g * boost), distance);
            if inter.trains_skills() && allowed == Access::Full {
                s += training_interest(sim, content, inter) * boost / (1.0 + distance * 0.08);
            }
            // The plan: a block's activity is the favourite (even with full needs); goals.
            let (plan, floor) = crate::planner::object_factor(content, sim, inter, night);
            let s = s.max(floor) * feel(inter.tags) * plan;
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
        // Partner lookups scan everyone: only when a goal asks for it.
        let single = !sim.planner.goals.is_empty() && ctx.rels.partner_of(j).is_none();
        for (k, s) in content.socials.iter().enumerate() {
            if !s.autonomous || !s.requires.allows(rel) {
                continue;
            }
            if s.tags & content.social_rules.romantic_tags != 0 && !attracted {
                continue;
            }
            let romantic = s.tags & content.social_rules.romantic_tags != 0;
            let friendly = matches!(s.prefer, Prefer::Any | Prefer::Liked);
            let score = ai::score_gains(needs, &s.actor_gain, distance)
                * s.autonomy_weight
                * prefer_factor(s.prefer, rel, chemistry)
                * feel(s.tags)
                * crate::planner::social_factor(content, sim, romantic, friendly, rel.friendship, single);
            if score > MIN_AUTONOMY_SCORE {
                candidates.push((score, Choice::Social(j as u32, k)));
            }
        }
    }

    // Residents visit friends who are home.
    let household = &ctx.households[sim.household as usize];
    let visits = &content.visits;
    let plans_soon = || {
        crate::planner::plans_soon(content, sim, routines, ctx.day, ctx.minute, visits.hours * 60.0)
    };
    if sim.visiting.is_none()
        && here.is_some()
        && here == household.plot
        && (visits.earliest_hour..visits.latest_hour).contains(&ctx.hour)
    {
        let soon = plans_soon();
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
                * feel(visits.tags)
                * crate::planner::visit_factor(content, sim, soon);
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
            if !obj.can_use(sim.id, content.objects[obj.def].slots) {
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
            sim.transition = Some(crate::life::Transition::Visit {
                plot,
                directed: task.directed,
            });
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
        let obj = &mut objects[object as usize];
        if !obj.reserve(sim.id, content.objects[obj.def].slots) {
            return;
        }
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

fn progress(sim: &mut Sim, ctx: &Ctx, objects: &mut [ObjectInstance]) {
    let content = ctx.content;
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
                arrive(sim, ctx, objects);
            }
            false
        }
        Phase::Using { elapsed } => {
            *elapsed += MINUTES_PER_TICK;
            let elapsed = *elapsed;
            match act.task.kind {
                TaskKind::Use {
                    object,
                    interaction,
                } => use_object(sim, ctx, &objects[object as usize], interaction, elapsed),
                _ => unreachable!("only Use tasks have a Using phase"),
            }
        }
        // Conversations are driven by `conversation::update`, which sees both Sims.
        Phase::Waiting { .. } | Phase::Conversing { .. } => false,
    };
    if finished {
        end_activity(sim, content, objects);
    }
}

/// One tick of using an object. Returns whether the Sim is done.
fn use_object(
    sim: &mut Sim,
    ctx: &Ctx,
    obj: &ObjectInstance,
    interaction: usize,
    elapsed: f32,
) -> bool {
    let content = ctx.content;
    let inter = &content.objects[obj.def].interactions[interaction];
    // Quality and skill scale what the Sim gets out of it (not what it costs).
    let boost = content.object_rules.quality_factor(obj.quality)
        * inter.skill_factor(&content.skill_rules, &sim.skills);
    let (mut any_gain, mut satisfied, mut urgent, mut wakes) = (false, true, false, false);
    for n in 0..content.needs.len() {
        let g = inter.gain_per_minute[n];
        if g > 0.0 {
            any_gain = true;
            let g = g * sim.mods.need_gain[n] * boost;
            sim.needs[n] = (sim.needs[n] + g * MINUTES_PER_TICK).min(1.0);
            satisfied &= sim.needs[n] >= 0.999;
        } else {
            if g < 0.0 {
                // Costs (a workout makes you hungry and sweaty).
                sim.needs[n] = (sim.needs[n] + g * MINUTES_PER_TICK).max(0.0);
            }
            urgent |= sim.needs[n] < 0.08;
            wakes |= sim.needs[n] < 0.08 && content.day_rhythm.wake_for & (1 << n) != 0;
        }
    }
    for s in 0..content.skills.len() {
        if inter.skill_gain[s] > 0.0 {
            practise(sim, content, s, inter.skill_gain[s] * boost);
        }
    }
    let done = if inter.tags & content.day_rhythm.sleep_tags != 0 && is_night(sim, ctx) {
        // A night's sleep lasts until morning unless a need that wakes people gets urgent.
        wakes
    } else {
        // Workouts and other draining activities stop before they empty a need. Planned
        // activities go on for their time even once the needs they fill are full.
        let planned = crate::planner::planned_now(content, sim, inter);
        let drained = urgent && (inter.total_gain.iter().any(|&g| g < 0.0) || planned);
        elapsed >= inter.minutes || (any_gain && satisfied && !planned) || drained
    };
    if done && let Some(m) = inter.earns_feeling(elapsed, &sim.skills) {
        social::add_feeling(&mut sim.feelings, m, &content.feelings, ctx.tick);
    }
    done
}

fn arrive(sim: &mut Sim, ctx: &Ctx, objects: &mut [ObjectInstance]) {
    let content = ctx.content;
    // Paid on arrival; if the money ran out on the way, never mind.
    if let Some(TaskKind::Use {
        object,
        interaction,
    }) = sim.current.as_ref().map(|a| a.task.kind)
    {
        let cost = content.objects[objects[object as usize].def].interactions[interaction].cost;
        let funds = ctx.households[sim.household as usize].funds - sim.pending_spend;
        if !affordable(cost, funds) {
            end_activity(sim, content, objects);
            return;
        }
        sim.pending_spend += cost.max(0);
    }
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
                sim.pos = obj.slot_position(content, obj.slot_of(sim.id).unwrap_or(0));
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
        obj.release(sim.id);
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
        assert_eq!(w.objects[1].users().next(), Some(0));
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
        assert_eq!(w.objects[1].users().next(), Some(0));
        w.apply(Command::Cancel { sim: 0, index: 0 }).unwrap();
        assert!(!w.objects[1].in_use());
        assert_eq!(w.sims[0].pose, Pose::Stand);
    }

    #[test]
    fn furniture_cannot_straddle_or_face_a_wall() {
        let mut w = world();
        // The wall runs along x = 6 for z 0..10: a 2-wide bed across it doesn't fit.
        let err = w.place_object("bed", 5, 5, 0).unwrap_err();
        assert!(err.to_string().contains("wall"), "{err}");
        // Facing +x (rot 1) from x = 5 means using it from across the wall.
        let err = w.place_object("fridge", 5, 7, 1).unwrap_err();
        assert!(err.to_string().contains("wall"), "{err}");
        // Turned away from the wall it's fine.
        w.place_object("fridge", 5, 7, 3).unwrap();
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
    fn quiet_hours_skip_ahead() {
        let content = CONTENT
            .replace(r#""pose":"lie","#, r#""pose":"lie","tags":["sleep"],"#)
            .replace(r#""needs":["#, r#""dayRhythm":{"sleepTags":["sleep"]},"needs":["#);
        let mut w = World::from_json(&content, LOT, 7).unwrap();
        w.apply(Command::SetSpeed { speed: 1 }).unwrap();
        w.apply(Command::SetAutoFast { enabled: true }).unwrap();
        w.advance();
        assert_eq!(w.tick, 1, "awake: normal speed");
        w.sims[0].needs[1] = 0.0;
        w.apply(Command::Use {
            sim: 0,
            object: 1,
            interaction: 0,
        })
        .unwrap();
        while !w.sims[0].asleep(&w.content) {
            w.tick_once();
        }
        let before = w.tick;
        w.advance();
        let fast = TICKS_PER_STEP[AUTO_FAST_SPEED as usize] as u64;
        assert_eq!(w.tick, before + fast, "asleep: time-lapse");
        w.apply(Command::SetSpeed { speed: 0 }).unwrap();
        w.advance();
        assert_eq!(w.tick, before + fast, "paused stays paused");
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
        assert!(!w.objects[0].in_use());
        assert!(w.sims[0].pos[0] > 10.0, "stayed home");
    }
}
