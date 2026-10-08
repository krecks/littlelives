//! Build and buy: changing a household's home. Buying, selling, moving, restyling and
//! upgrading objects, and building walls, doors and windows.
//!
//! Every change is checked against the home plot and paid from household funds. Nothing
//! may cut Sims off from what they could reach before (an object's front tile, a room).

use std::collections::VecDeque;

use crate::Error;
use crate::command::{EdgeAxis, EdgeEdit, EdgeKind};
use crate::lot::{Edge, OUTDOORS};
use crate::path::NavGrid;
use crate::social::EventKind;
use crate::world::{ObjectInstance, Task, TaskKind, World, end_activity};

/// Tiles around a plot that still count when checking who can reach what (the path from the street).
const REACH_MARGIN: i32 = 2;

fn edge_kind(kind: EdgeKind) -> Edge {
    match kind {
        EdgeKind::Wall => Edge::Wall,
        EdgeKind::Door => Edge::Door,
        EdgeKind::Window => Edge::Window,
        EdgeKind::Open => Edge::Open,
    }
}

fn task_object(t: &Task) -> Option<u32> {
    match t.kind {
        TaskKind::Use { object, .. } => Some(object),
        _ => None,
    }
}

fn task_object_mut(t: &mut Task) -> Option<&mut u32> {
    match &mut t.kind {
        TaskKind::Use { object, .. } => Some(object),
        _ => None,
    }
}

impl World {
    /// The Sim's household index and home plot.
    pub(crate) fn home_of(&self, sim: u32) -> Result<(usize, u32), Error> {
        let s = self
            .sims
            .get(sim as usize)
            .ok_or_else(|| Error::new(format!("unknown resident {sim}")))?;
        let h = s.household as usize;
        let plot = self.households[h]
            .plot
            .ok_or_else(|| Error::new("this household has no home"))?;
        Ok((h, plot))
    }

    pub(crate) fn check_style(&self, style: u8) -> Result<u8, Error> {
        if (style as usize) < self.content.styles.len().max(1) {
            Ok(style)
        } else {
            Err(Error::new(format!("unknown style {style}")))
        }
    }

    fn home_object(&self, sim: u32, object: u32) -> Result<(usize, u32), Error> {
        let (h, plot) = self.home_of(sim)?;
        if object as usize >= self.objects.len() {
            return Err(Error::new(format!("unknown object {object}")));
        }
        if self.object_plot[object as usize] != Some(plot) {
            return Err(Error::new("that isn't at your home"));
        }
        Ok((h, plot))
    }

    /// Whether every tile of `obj` and the tile in front of it lie on `plot`.
    fn fits_on_plot(&self, obj: &ObjectInstance, plot: u32) -> bool {
        let p = &self.plots[plot as usize];
        let (fx, fz) = obj.front_tile(&self.content);
        p.contains(fx, fz) && obj.tiles(&self.content).all(|(x, z)| p.contains(x, z))
    }

    /// Tiles reachable on foot from the plot's entry (a mask over the whole lot).
    fn reachable(&self, plot: u32) -> Vec<bool> {
        let lot = &self.lot;
        let nav = NavGrid {
            lot,
            blocked: &self.blocked,
        };
        let p = &self.plots[plot as usize];
        let inside = |x: i32, z: i32| {
            x >= p.x - REACH_MARGIN
                && z >= p.z - REACH_MARGIN
                && x < p.x + p.w + REACH_MARGIN
                && z < p.z + p.d + REACH_MARGIN
        };
        let mut seen = vec![false; lot.width * lot.depth];
        let entry = p.arrival_point();
        let start = (entry[0].floor() as i32, entry[1].floor() as i32);
        if !nav.tile_free(start.0, start.1) {
            return seen;
        }
        let mut open = VecDeque::from([start]);
        seen[lot.tile_index(start.0, start.1)] = true;
        while let Some((x, z)) = open.pop_front() {
            for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (nx, nz) = (x + dx, z + dz);
                if inside(nx, nz)
                    && nav.can_step(x, z, nx, nz)
                    && !std::mem::replace(&mut seen[lot.tile_index(nx, nz)], true)
                {
                    open.push_back((nx, nz));
                }
            }
        }
        seen
    }

    /// Front tiles and empty tiles of `plot` that can be reached, as `(tile index)` list.
    fn reach_signature(&self, plot: u32) -> (Vec<bool>, Vec<bool>) {
        let seen = self.reachable(plot);
        let fronts = self
            .objects
            .iter()
            .map(|o| {
                let (fx, fz) = o.front_tile(&self.content);
                self.object_plot[o.id as usize] != Some(plot)
                    || (self.lot.in_bounds(fx, fz) && seen[self.lot.tile_index(fx, fz)])
            })
            .collect();
        (fronts, seen)
    }

    /// Whether every object and Sim that could be reached `before` still can. Empty floor may
    /// be closed off (draw a room's walls first, then add its door).
    fn keeps_reach(&self, plot: u32, before: &(Vec<bool>, Vec<bool>), skip: Option<u32>) -> bool {
        let after = self.reach_signature(plot);
        let p = &self.plots[plot as usize];
        let objects_ok = before
            .0
            .iter()
            .zip(&after.0)
            .enumerate()
            .all(|(i, (b, a))| Some(i as u32) == skip || !*b || *a);
        // No Sim at home gets shut in.
        let sims_ok = self.sims.iter().all(|s| {
            let (x, z) = s.tile();
            let on_plot = x >= p.x && z >= p.z && x < p.x + p.w && z < p.z + p.d;
            let i = self.lot.tile_index(x, z);
            s.away_until.is_some() || !on_plot || !before.1[i] || after.1[i]
        });
        objects_ok && sims_ok
    }

    fn sim_in_the_way(&self, obj: &ObjectInstance) -> bool {
        self.sims
            .iter()
            .any(|s| s.away_until.is_none() && obj.tiles(&self.content).any(|t| t == s.tile()))
    }

    /// Places object `def` on the home plot if it fits there and blocks nothing.
    #[allow(clippy::too_many_arguments)]
    fn place_at_home(
        &mut self,
        plot: u32,
        def: usize,
        x: i32,
        z: i32,
        rot: u8,
        style: u8,
        quality: u8,
        value: i64,
    ) -> Result<u32, Error> {
        let obj = self
            .check_fit(def, x, z, rot)
            .map_err(|_| Error::new("there's no room for that here"))?;
        if !self.fits_on_plot(&obj, plot) {
            return Err(Error::new("that has to go on your own lot"));
        }
        if self.sim_in_the_way(&obj) {
            return Err(Error::new("someone is standing there"));
        }
        let before = self.reach_signature(plot);
        let id = self.place(def, x, z, rot, style, quality, value)?;
        let (fx, fz) = self.objects[id as usize].front_tile(&self.content);
        let front_ok = self.reachable(plot)[self.lot.tile_index(fx, fz)];
        if !front_ok || !self.keeps_reach(plot, &before, Some(id)) {
            self.remove_object(id);
            return Err(Error::new("that would block the way"));
        }
        Ok(id)
    }

    /// A good free spot for `def` on the plot: indoors, back to a wall, away from doors.
    fn find_spot(&self, plot: u32, def: usize) -> Vec<(i32, i32, u8)> {
        let p = &self.plots[plot as usize];
        let lot = &self.lot;
        let near_door = |x: i32, z: i32| {
            let (ux, uz) = (x as usize, z as usize);
            lot.h_edge(ux, uz) == Edge::Door
                || lot.h_edge(ux, uz + 1) == Edge::Door
                || lot.v_edge(ux, uz) == Edge::Door
                || lot.v_edge(ux + 1, uz) == Edge::Door
        };
        let mut spots = Vec::new();
        for z in p.z..p.z + p.d {
            for x in p.x..p.x + p.w {
                for rot in 0..4u8 {
                    let Ok(obj) = self.check_fit(def, x, z, rot) else {
                        continue;
                    };
                    if !self.fits_on_plot(&obj, plot)
                        || obj.tiles(&self.content).any(|(tx, tz)| near_door(tx, tz))
                    {
                        continue;
                    }
                    let (w, d) = obj.size(&self.content);
                    let wall = |e: Edge| e.blocks();
                    let back_to_wall = match rot {
                        0 => (x..x + w).all(|tx| wall(lot.h_edge(tx as usize, z as usize))),
                        2 => (x..x + w).all(|tx| wall(lot.h_edge(tx as usize, (z + d) as usize))),
                        1 => (z..z + d).all(|tz| wall(lot.v_edge(x as usize, tz as usize))),
                        _ => (z..z + d).all(|tz| wall(lot.v_edge((x + w) as usize, tz as usize))),
                    };
                    let indoors = lot.room_at(x, z) != OUTDOORS;
                    let score = indoors as i32 * 10 + back_to_wall as i32 * 5;
                    spots.push((score, x, z, rot));
                }
            }
        }
        spots.sort_by_key(|s| -s.0);
        spots.into_iter().map(|(_, x, z, r)| (x, z, r)).collect()
    }

    /// Buys an object for the Sim's household. Returns the new object's id.
    pub fn buy(
        &mut self,
        sim: u32,
        def_id: &str,
        at: Option<[i32; 3]>,
        style: Option<u8>,
    ) -> Result<u32, Error> {
        let (h, plot) = self.home_of(sim)?;
        let def = self
            .content
            .object_index(def_id)
            .ok_or_else(|| Error::new(format!("unknown object '{def_id}'")))?;
        let d = &self.content.objects[def];
        let price = d
            .price
            .ok_or_else(|| Error::new(format!("{} isn't for sale", d.name)))?;
        if self.households[h].funds < price {
            return Err(Error::new(format!("not enough money for the {}", d.name)));
        }
        let style = self.check_style(style.unwrap_or(self.households[h].style))?;
        let id = match at {
            Some([x, z, rot]) => self.place_at_home(plot, def, x, z, rot as u8, style, 0, price)?,
            None => self
                .find_spot(plot, def)
                .into_iter()
                .find_map(|(x, z, rot)| {
                    self.place_at_home(plot, def, x, z, rot, style, 0, price)
                        .ok()
                })
                .ok_or_else(|| Error::new("there's no free spot for that at home"))?,
        };
        self.households[h].funds -= price;
        Ok(id)
    }

    /// Sells an object at home for part of what was spent on it.
    pub fn sell(&mut self, sim: u32, object: u32) -> Result<(), Error> {
        let (h, _) = self.home_object(sim, object)?;
        let obj = &self.objects[object as usize];
        if self.content.objects[obj.def].price.is_none() {
            return Err(Error::new("that can't be sold"));
        }
        let refund = (obj.value as f32 * self.content.object_rules.resale).round() as i64;
        self.remove_object(object);
        self.households[h].funds += refund;
        Ok(())
    }

    /// Moves or rotates an object at home. Its look, quality and value stay.
    pub fn move_object(
        &mut self,
        sim: u32,
        object: u32,
        x: i32,
        z: i32,
        rot: u8,
    ) -> Result<(), Error> {
        let (_, plot) = self.home_object(sim, object)?;
        let old = self.remove_object(object);
        let moved = self.place_at_home(plot, old.def, x, z, rot, old.style, old.quality, old.value);
        if let Err(e) = moved {
            self.place(
                old.def,
                old.x,
                old.z,
                old.rot,
                old.style,
                old.quality,
                old.value,
            )
            .expect("the old spot is still free");
            return Err(e);
        }
        Ok(())
    }

    pub fn restyle(&mut self, sim: u32, object: u32, style: u8) -> Result<(), Error> {
        self.home_object(sim, object)?;
        self.objects[object as usize].style = self.check_style(style)?;
        self.structure_version += 1;
        Ok(())
    }

    /// Buys the next quality level for an object at home (Buy mode, instant). Returns the new quality.
    pub fn upgrade(&mut self, sim: u32, object: u32) -> Result<u8, Error> {
        let (h, _) = self.home_object(sim, object)?;
        let rules = &self.content.object_rules;
        let obj = &self.objects[object as usize];
        let def = &self.content.objects[obj.def];
        let price = def
            .price
            .ok_or_else(|| Error::new(format!("the {} can't be upgraded", def.name)))?;
        if obj.quality >= rules.max_quality {
            return Err(Error::new(format!(
                "the {} is as good as it gets",
                def.name
            )));
        }
        let cost = rules.upgrade_price(price);
        if self.households[h].funds < cost {
            return Err(Error::new(format!(
                "not enough money to upgrade the {}",
                def.name
            )));
        }
        self.households[h].funds -= cost;
        let obj = &mut self.objects[object as usize];
        obj.quality += 1;
        obj.value += cost;
        let quality = obj.quality;
        self.structure_version += 1;
        self.events.push_detail(
            self.tick,
            EventKind::Upgraded,
            sim as usize,
            Some(quality as i64),
            None,
        );
        Ok(quality)
    }

    /// Changes wall edges on the home plot, paying per changed edge.
    ///
    /// Like in the Sims, doors and windows go into walls: their edge must already have a wall
    /// (plain, or with a door or window to replace), unless the same edit draws the wall
    /// around it (a wall edge next to it on the same line).
    pub fn build(&mut self, sim: u32, edits: &[EdgeEdit]) -> Result<(), Error> {
        let (h, plot) = self.home_of(sim)?;
        let p = self.plots[plot as usize].clone();
        let (lw, ld) = (self.lot.width as i32, self.lot.depth as i32);
        let edge_at = |lot: &crate::lot::Lot, e: &EdgeEdit| match e.axis {
            EdgeAxis::H => lot.h_edge(e.x as usize, e.z as usize),
            EdgeAxis::V => lot.v_edge(e.x as usize, e.z as usize),
        };
        // Tiles on either side of an edge.
        let sides = |e: &EdgeEdit| match e.axis {
            EdgeAxis::H => ((e.x, e.z - 1), (e.x, e.z)),
            EdgeAxis::V => ((e.x - 1, e.z), (e.x, e.z)),
        };
        let object_at = |x: i32, z: i32| {
            self.objects.iter().position(|o| {
                let (w, d) = o.size(&self.content);
                x >= o.x && z >= o.z && x < o.x + w && z < o.z + d
            })
        };
        // A wall drawn by this edit on the same line, right next to `e`.
        let walled_beside = |e: &EdgeEdit| {
            let (dx, dz) = match e.axis {
                EdgeAxis::H => (1, 0),
                EdgeAxis::V => (0, 1),
            };
            edits.iter().any(|o| {
                o.kind == EdgeKind::Wall
                    && o.axis == e.axis
                    && ((o.x == e.x + dx && o.z == e.z + dz)
                        || (o.x == e.x - dx && o.z == e.z - dz))
            })
        };
        let rules = self.content.build;
        let mut cost = 0;
        for e in edits {
            let on_plot = match e.axis {
                EdgeAxis::H => {
                    e.x >= p.x
                        && e.x < p.x + p.w
                        && e.z >= p.z
                        && e.z <= p.z + p.d
                        && e.x < lw
                        && e.z <= ld
                }
                EdgeAxis::V => {
                    e.x >= p.x
                        && e.x <= p.x + p.w
                        && e.z >= p.z
                        && e.z < p.z + p.d
                        && e.x <= lw
                        && e.z < ld
                }
            };
            if !on_plot || e.x < 0 || e.z < 0 {
                return Err(Error::new("you can only build on your own lot"));
            }
            let (a, b) = sides(e);
            if e.kind != EdgeKind::Open
                && object_at(a.0, a.1).is_some_and(|o| object_at(b.0, b.1) == Some(o))
            {
                return Err(Error::new("a wall can't go through furniture"));
            }
            let current = edge_at(&self.lot, e);
            let target = edge_kind(e.kind);
            if matches!(target, Edge::Door | Edge::Window)
                && !current.is_wall()
                && !walled_beside(e)
            {
                let what = if target == Edge::Door {
                    "door"
                } else {
                    "window"
                };
                return Err(Error::new(format!(
                    "a {what} has to go into a wall — build one there first"
                )));
            }
            if current != target {
                cost += match target {
                    Edge::Wall => rules.wall,
                    Edge::Door => rules.door,
                    Edge::Window => rules.window,
                    Edge::Open => rules.remove,
                };
            }
        }
        if self.households[h].funds < cost {
            return Err(Error::new("not enough money to build that"));
        }
        let before = self.reach_signature(plot);
        let saved = self.lot.clone();
        for e in edits {
            let target = edge_kind(e.kind);
            match e.axis {
                EdgeAxis::H => self.lot.set_h(e.x as usize, e.z as usize, target),
                EdgeAxis::V => self.lot.set_v(e.x as usize, e.z as usize, target),
            }
        }
        if !self.keeps_reach(plot, &before, None) {
            self.lot = saved;
            return Err(Error::new(
                "that would shut a resident or an object in — add a door",
            ));
        }
        self.lot.compute_rooms();
        self.households[h].funds -= cost;
        self.structure_version += 1;
        Ok(())
    }

    /// Removes an object. Sims using it stop, and later object ids shift down by one.
    pub(crate) fn remove_object(&mut self, id: u32) -> ObjectInstance {
        let World {
            sims,
            objects,
            content,
            ..
        } = self;
        for sim in sims.iter_mut() {
            if sim
                .current
                .as_ref()
                .is_some_and(|a| task_object(&a.task) == Some(id))
            {
                end_activity(sim, content, objects);
            }
            sim.queue.retain(|t| task_object(t) != Some(id));
            let current = sim.current.as_mut().map(|a| &mut a.task);
            for t in current.into_iter().chain(sim.queue.iter_mut()) {
                if let Some(o) = task_object_mut(t)
                    && *o > id
                {
                    *o -= 1;
                }
            }
        }
        let obj = self.objects.remove(id as usize);
        self.object_plot.remove(id as usize);
        for (i, o) in self.objects.iter_mut().enumerate() {
            o.id = i as u32;
        }
        for (x, z) in obj.tiles(&self.content) {
            let i = self.lot.tile_index(x, z);
            self.blocked[i] = false;
        }
        self.structure_version += 1;
        obj
    }
}
