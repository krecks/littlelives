//! Rooms and how good they are ("the house matters", see `docs/design/house-matters.md`).
//!
//! A room is an enclosed area of the lot (`Lot::compute_rooms`); each plot's outdoor tiles are
//! scored as its garden. Room ids change whenever walls do, so nothing here is saved: rooms are
//! recomputed from the lot, the objects and the per-tile dirt (`World::refresh_rooms`).

use crate::content::TagMask;
use crate::lot::{Edge, EdgeRef, OUTDOORS};
use crate::world::World;

/// Scores of a room, each 0..1, and the weighted `overall` (content `roomRules.weights`).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct RoomScores {
    pub size: f32,
    pub light: f32,
    pub decor: f32,
    pub clean: f32,
    pub function: f32,
    pub overall: f32,
}

impl RoomScores {
    /// The factors in order (size, light, decor, cleanliness, function).
    pub fn factors(&self) -> [f32; 5] {
        [self.size, self.light, self.decor, self.clean, self.function]
    }

    /// The weakest factor (index into `factors`).
    pub fn weakest(&self) -> usize {
        let f = self.factors();
        (0..f.len()).min_by(|&a, &b| f[a].total_cmp(&f[b])).unwrap_or(0)
    }
}

/// Factor names, in the order of `RoomScores::factors` (ids for the UI and saves).
pub const FACTORS: [&str; 5] = ["size", "light", "decor", "clean", "function"];

#[derive(Debug, Clone, PartialEq)]
pub struct RoomInfo {
    /// Lot room id (`OUTDOORS` for a plot's garden).
    pub id: u16,
    pub plot: Option<u32>,
    pub garden: bool,
    /// Room kind (index into `Content::room_kinds`); None: nothing tells what it's for.
    pub kind: Option<usize>,
    /// Things of two exclusive kinds stand in it (a bed in the kitchen).
    pub mixed: bool,
    /// The first essential of its kind nothing in it offers (index into the kind's `essentials`).
    pub missing: Option<usize>,
    /// Indoor tiles (a tile split by a diagonal wall counts half).
    pub tiles: f32,
    pub windows: u16,
    pub doors: u16,
    pub lamps: u16,
    /// Decor points of what stands in it.
    pub decor: f32,
    /// Share of its floor and wall faces with a chosen covering.
    pub coverings: f32,
    /// Mean dirt of its tiles (0..1).
    pub dirt: f32,
    /// Centre of its tiles (for labels and the camera).
    pub centre: [f32; 2],
    /// Tags offered by what stands in it.
    pub tags: TagMask,
    pub scores: RoomScores,
}

#[derive(Default)]
struct Acc {
    tiles: f32,
    sx: f32,
    sz: f32,
    dirt: f32,
    windows: u16,
    doors: u16,
    lamps: u16,
    decor: f32,
    tags: TagMask,
    floors: f32,
    faces: f32,
    covered_faces: f32,
    first: (i32, i32),
}

/// Every room and garden of the town, with scores.
pub(crate) fn compute(w: &World) -> Vec<RoomInfo> {
    let lot = &w.lot;
    let content = &w.content;
    let rules = &content.room_rules;
    // Rooms by lot id, gardens by plot.
    let halves = lot.half_rooms();
    let max_id = halves.iter().flatten().copied().max().unwrap_or(0) as usize;
    let mut rooms: Vec<Acc> = (0..=max_id).map(|_| Acc::default()).collect();
    let mut gardens: Vec<Acc> = (0..w.plots.len()).map(|_| Acc::default()).collect();
    let dirt_at = |i: usize| w.dirt.get(i).copied().unwrap_or(0.0);
    let add = |acc: &mut Acc, x: i32, z: i32, i: usize, weight: f32| {
        if acc.tiles == 0.0 {
            acc.first = (x, z);
        }
        acc.tiles += weight;
        acc.sx += (x as f32 + 0.5) * weight;
        acc.sz += (z as f32 + 0.5) * weight;
        acc.dirt += dirt_at(i) * weight;
    };
    let parts = |[r0, r1]: [u16; 2]| -> [(u16, f32); 2] {
        if r0 == r1 { [(r0, 1.0), (OUTDOORS, 0.0)] } else { [(r0, 0.5), (r1, 0.5)] }
    };
    for z in 0..lot.depth as i32 {
        for x in 0..lot.width as i32 {
            let i = lot.tile_index(x, z);
            for (r, weight) in parts(halves[i]) {
                if r == OUTDOORS || weight == 0.0 {
                    continue;
                }
                let acc = &mut rooms[r as usize];
                add(acc, x, z, i, weight);
                if lot.floor(x as u16, z as u16) != 0 {
                    acc.floors += weight;
                }
            }
        }
    }
    // Gardens: each plot's outdoor tiles.
    for (pi, p) in w.plots.iter().enumerate() {
        for z in p.z..p.z + p.d {
            for x in p.x..p.x + p.w {
                if !lot.in_bounds(x, z) {
                    continue;
                }
                let i = lot.tile_index(x, z);
                let [r0, r1] = halves[i];
                // A tile split by a diagonal wall: each half counts half.
                let half = |r: u16| if r == OUTDOORS { 0.5 } else { 0.0 };
                let outdoor = if r0 == r1 { 2.0 * half(r0) } else { half(r0) + half(r1) };
                if outdoor > 0.0 {
                    add(&mut gardens[pi], x, z, i, outdoor);
                }
            }
        }
    }

    // Walls, doors and windows on each room's boundary (a window between two rooms lights both).
    let mut boundary = |r: u16, edge: Edge, covered: bool| {
        if r == OUTDOORS {
            return;
        }
        let Some(acc) = rooms.get_mut(r as usize) else { return };
        match edge {
            Edge::Window => acc.windows += 1,
            Edge::Door => acc.doors += 1,
            _ => {}
        }
        if edge.is_wall() {
            acc.faces += 1.0;
            if covered {
                acc.covered_faces += 1.0;
            }
        }
    };
    let (w_, d_) = (lot.width as i32, lot.depth as i32);
    let room = |x: i32, z: i32| if lot.in_bounds(x, z) { lot.room_at(x, z) } else { OUTDOORS };
    for z in 0..=d_ {
        for x in 0..w_ {
            let e = lot.h_edge(x as usize, z as usize);
            if !e.is_wall() {
                continue;
            }
            let look = lot.look(EdgeRef::H(x as u16, z as u16));
            boundary(room(x, z - 1), e, look.sides[0] != 0);
            boundary(room(x, z), e, look.sides[1] != 0);
        }
    }
    for z in 0..d_ {
        for x in 0..=w_ {
            let e = lot.v_edge(x as usize, z as usize);
            if !e.is_wall() {
                continue;
            }
            let look = lot.look(EdgeRef::V(x as u16, z as u16));
            boundary(room(x - 1, z), e, look.sides[0] != 0);
            boundary(room(x, z), e, look.sides[1] != 0);
        }
    }
    for z in 0..d_ {
        for x in 0..w_ {
            let Some(d) = lot.diag(x, z) else { continue };
            let look = lot.look(EdgeRef::Diag(x as u16, z as u16));
            let [h0, h1] = halves[lot.tile_index(x, z)];
            boundary(h0, d.edge, look.sides[0] != 0);
            boundary(h1, d.edge, look.sides[1] != 0);
        }
    }

    // What stands in each room.
    for o in &w.objects {
        let def = &content.objects[o.def];
        let r = room(o.x, o.z);
        let acc = if r == OUTDOORS {
            let Some(plot) = w.plot_at(o.x, o.z) else { continue };
            &mut gardens[plot as usize]
        } else {
            let Some(acc) = rooms.get_mut(r as usize) else { continue };
            acc
        };
        acc.decor += def.decor * content.object_rules.quality_factor(o.quality);
        acc.lamps += u16::from(def.lamp);
        // Broken things don't do what they're for (a broken shower is no shower).
        if !o.broken() {
            acc.tags |= def.tags;
        }
    }

    let weights = rules.weights;
    let total: f32 = weights.iter().sum::<f32>().max(1e-6);
    let overall = |s: &RoomScores| s.factors().iter().zip(weights).map(|(f, w)| f * w).sum::<f32>() / total;
    let mut out: Vec<RoomInfo> = Vec::with_capacity(rooms.len() + gardens.len());
    for (id, a) in rooms.into_iter().enumerate().filter(|(_, a)| a.tiles > 0.0) {
        let id = id as u16;
        let kinds = &content.room_kinds;
        let kind = kinds.iter().position(|k| a.tags & k.tags != 0);
        let exclusive = kinds.iter().filter(|k| k.exclusive && a.tags & k.tags != 0).count();
        let missing = kind.and_then(|k| kinds[k].essentials.iter().position(|&e| a.tags & e == 0));
        let [cramped, comfy] = kind.map_or([4.0, 9.0], |k| kinds[k].size);
        let size = if a.tiles < cramped {
            0.5 * a.tiles / cramped.max(1e-3)
        } else if a.tiles < comfy {
            0.5 + 0.5 * (a.tiles - cramped) / (comfy - cramped).max(1e-3)
        } else {
            1.0
        };
        let day = (f32::from(a.windows) * rules.window_tiles / a.tiles).min(1.0);
        let night = (f32::from(a.lamps) * rules.lamp_tiles / a.tiles).min(1.0);
        let coverings = 0.5 * (a.floors / a.tiles) + 0.5 * (a.covered_faces / a.faces.max(1.0));
        let decor = (a.decor / (a.tiles * rules.decor_per_tile) * 0.8 + coverings * 0.4).min(1.0);
        let dirt = a.dirt / a.tiles;
        let function = match (kind, exclusive > 1, missing) {
            (None, _, _) => 0.4,
            (Some(_), true, _) => 0.6,
            (Some(_), false, Some(_)) => 0.7,
            _ => 1.0,
        };
        let mut scores = RoomScores { size, light: (day + night) / 2.0, decor, clean: 1.0 - dirt, function, overall: 0.0 };
        scores.overall = overall(&scores);
        out.push(RoomInfo {
            id,
            plot: w.plot_at(a.first.0, a.first.1),
            garden: false,
            kind,
            mixed: exclusive > 1,
            missing,
            tiles: a.tiles,
            windows: a.windows,
            doors: a.doors,
            lamps: a.lamps,
            decor: a.decor,
            coverings,
            dirt,
            centre: [a.sx / a.tiles, a.sz / a.tiles],
            tags: a.tags,
            scores,
        });
    }
    for (plot, a) in gardens.into_iter().enumerate().filter(|(_, a)| a.tiles > 0.0) {
        let plot = plot as u32;
        let dirt = a.dirt / a.tiles;
        let decor = (a.decor / (a.tiles * rules.garden_decor_per_tile)).min(1.0);
        let mut scores = RoomScores { size: 1.0, light: 1.0, decor, clean: 1.0 - dirt, function: 1.0, overall: 0.0 };
        scores.overall = overall(&scores);
        out.push(RoomInfo {
            id: OUTDOORS,
            plot: Some(plot),
            garden: true,
            kind: None,
            mixed: false,
            missing: None,
            tiles: a.tiles,
            windows: 0,
            doors: 0,
            lamps: a.lamps,
            decor: a.decor,
            coverings: 0.0,
            dirt,
            centre: [a.sx / a.tiles, a.sz / a.tiles],
            tags: a.tags,
            scores,
        });
    }
    // Deterministic order: by plot, gardens last, then by room id.
    out.sort_by_key(|r| (r.plot.unwrap_or(u32::MAX), r.garden, r.id));
    out
}

/// Thought subject for a room: its kind (garden 0, kind + 1, or 63 for a room nothing marks)
/// times 8 plus a factor (`FACTORS`).
pub fn room_subject(room: &RoomInfo, factor: usize) -> usize {
    let kind = if room.garden { 0 } else { room.kind.map_or(63, |k| k + 1) };
    kind * 8 + factor.min(7)
}

/// What residents make of their home, once an hour: a room they love or dislike (a thought,
/// a feeling, and for a disliked one a wish about its weakest factor), broken things to fix,
/// and a busy essential they had to wait for (another bathroom). Wishes come true once the
/// room is better, the thing is fixed, or there is another room of that kind.
pub(crate) fn opinions(w: &mut World) {
    use crate::planner::{HomeWish, MAX_HOME_WISHES, ThoughtKind, WAIT_FORGET_DAYS, WAIT_REPEAT_DAYS, think};
    let tick = w.tick;
    let today = crate::clock::day(tick);
    for i in 0..w.sims.len() {
        let s = &w.sims[i];
        let Some(home) = w.households[s.household as usize].plot else { continue };
        let (x, z) = s.tile();
        let at_home = s.away_until.is_none() && !s.asleep(&w.content) && w.plot_at(x, z) == Some(home);
        let rooms: Vec<&RoomInfo> = w.rooms.iter().filter(|r| r.plot == Some(home)).collect();
        let broken: Vec<usize> = w
            .objects
            .iter()
            .zip(&w.object_plot)
            .filter(|(o, p)| o.broken() && **p == Some(home))
            .map(|(o, _)| o.def)
            .collect();
        // Wishes that came true.
        let good = |kind: Option<usize>, garden: bool, factor: u8| {
            rooms.iter().any(|r| r.garden == garden && r.kind == kind && r.scores.factors()[factor as usize] >= 0.6)
        };
        let kept: Vec<HomeWish> = w.sims[i]
            .planner
            .home_wishes
            .iter()
            .copied()
            .filter(|wish| match *wish {
                HomeWish::Room { kind, garden, factor } => !good(kind, garden, factor),
                HomeWish::Fix { def } => broken.contains(&def),
                HomeWish::Another { kind } => {
                    rooms.iter().filter(|r| !r.garden && r.kind == Some(kind)).count() < 2
                        && s.planner.waited_day.is_some_and(|d| today <= d + WAIT_FORGET_DAYS)
                }
            })
            .collect();
        let mut wishes = kept;
        let mut waited = w.sims[i].planner.waited_day;
        let mut thought: Option<(ThoughtKind, usize)> = None;
        let mut feeling = None;
        if at_home {
            let rules = &w.content.room_rules;
            let roll = w.rng.next_f32();
            if let Some(room) = w.room_at_tile(x, z) {
                let s = room.scores;
                if s.overall >= rules.love && roll < 0.3 {
                    thought = Some((ThoughtKind::RoomLoved, room_subject(room, 0)));
                    feeling = rules.love_feeling;
                } else if s.overall <= rules.dislike && roll < 0.5 {
                    let factor = s.weakest();
                    thought = Some((ThoughtKind::RoomDisliked, room_subject(room, factor)));
                    feeling = rules.dislike_feeling;
                    let wish = HomeWish::Room { kind: room.kind, garden: room.garden, factor: factor as u8 };
                    if !wishes.contains(&wish) {
                        wishes.push(wish);
                    }
                }
            }
            // Something broke: they'd like it fixed.
            for &def in &broken {
                let wish = HomeWish::Fix { def };
                if !wishes.contains(&wish) {
                    wishes.push(wish);
                    thought = Some((ThoughtKind::Broken, def));
                }
            }
            // Badly needing what's taken (the toilet): another room for it, where content asks.
            let me = i as u32;
            for acc in &w.content.accidents {
                let Some(kind) = acc.another_room else { continue };
                let have = rooms.iter().filter(|r| !r.garden && r.kind == Some(kind)).count();
                if w.sims[i].needs[acc.need] >= 0.15 || have >= 2 {
                    continue;
                }
                let fillers: Vec<&crate::world::ObjectInstance> = w
                    .objects
                    .iter()
                    .zip(&w.object_plot)
                    .filter(|(o, p)| {
                        **p == Some(home)
                            && !o.broken()
                            && w.content.objects[o.def].interactions.iter().any(|it| it.autonomous && it.total_gain[acc.need] > 0.0)
                    })
                    .map(|(o, _)| o)
                    .collect();
                let busy = !fillers.is_empty()
                    && fillers.iter().all(|o| o.users().any(|u| u != me) && !o.has_free_slot(w.content.objects[o.def].slots));
                if busy {
                    // Once is bad luck; again on another day this week, they'd like a second one.
                    let again = waited.is_some_and(|d| d < today && today <= d + WAIT_REPEAT_DAYS);
                    let wish = HomeWish::Another { kind };
                    if again && !wishes.contains(&wish) {
                        wishes.push(wish);
                    }
                    waited = Some(today);
                }
            }
        }
        while wishes.len() > MAX_HOME_WISHES {
            wishes.remove(0);
        }
        let content = &w.content;
        let sim = &mut w.sims[i];
        sim.planner.home_wishes = wishes;
        sim.planner.waited_day = waited;
        if let Some((kind, subject)) = thought
            && sim.planner.thought.is_none()
        {
            think(sim, kind, subject, tick);
        }
        if let Some(f) = feeling {
            crate::social::add_feeling(&mut sim.feelings, f, &content.feelings, tick);
        }
    }
}
