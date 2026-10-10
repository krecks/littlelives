//! Bigger homes: blueprints and moving rooms.
//!
//! A **blueprint** is a house taken from a home lot (walls, doors, windows, fences and their
//! looks, floors, the roof and the furniture) that can be built again on an empty lot. It names
//! content by id, so it survives content changes (anything gone is left out), and it is stored
//! with the street side in front (`z = 0`): a house from one side of the street is turned round
//! when it is built on the other. On a lot of another width it is centred across it. Building it
//! is one edit (one undo step), paid like building and buying it piece by piece.
//!
//! Every storey is in it (`storey` on each part, 0 the ground), and it's built on the same
//! storeys again.
//!
//! **Moving a room** takes its walls, doors, windows, floors and everything standing in it a
//! number of tiles across the lot; walls it shares with another room stay for that room.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::Error;
use crate::command::{EdgeAxis, EdgeEdit, EdgeKind, FacePaint, FloorPaint};
use crate::lot::{DiagDir, Diagonal, Edge, EdgeLook, EdgeRef, OUTDOORS};
use crate::world::{Plot, World};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Blueprint {
    /// Size of the lot it was taken from.
    pub w: i32,
    pub d: i32,
    #[serde(default)]
    pub edges: Vec<BlueprintEdge>,
    #[serde(default)]
    pub floors: Vec<BlueprintFloor>,
    #[serde(default)]
    pub roof: Option<BlueprintRoof>,
    #[serde(default)]
    pub objects: Vec<BlueprintObject>,
}

/// A wall, door, window, fence or gate, on an edge as in [`EdgeEdit`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintEdge {
    /// The storey it's on (0: the ground).
    #[serde(default, skip_serializing_if = "ground")]
    pub storey: u8,
    pub axis: EdgeAxis,
    pub x: i32,
    pub z: i32,
    pub kind: EdgeKind,
    /// Half wall (1) or full height (0).
    #[serde(default)]
    pub form: u8,
    /// Door, window or fence style id.
    #[serde(default)]
    pub style: Option<String>,
    /// Wall covering id of each face (face 0 towards `-z`, `-x` or the tile's half 0).
    #[serde(default)]
    pub sides: [Option<String>; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintFloor {
    /// The storey it's on (0: the ground).
    #[serde(default, skip_serializing_if = "ground")]
    pub storey: u8,
    pub x: i32,
    pub z: i32,
    pub covering: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintRoof {
    pub style: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintObject {
    /// The storey it's on (0: the ground).
    #[serde(default, skip_serializing_if = "ground")]
    pub storey: u8,
    pub def: String,
    pub x: i32,
    pub z: i32,
    pub rot: u8,
    #[serde(default)]
    pub turn: u8,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub quality: u8,
}

/// A lot seen from its street: coordinates on the lot with the street side at `z = 0` (lots on
/// the far side of the street are turned round). Turning round is its own inverse, so the same
/// mapping takes the lot's coordinates to the town's.
#[derive(Clone, Copy)]
struct Frame {
    x: i32,
    z: i32,
    w: i32,
    d: i32,
    flip: bool,
}

impl Frame {
    fn of(p: &Plot) -> Self {
        // The street is on the side the visitors' arrival point is nearest to.
        let entry = p.arrival_point();
        Self { x: p.x, z: p.z, w: p.w, d: p.d, flip: entry[1] > p.z as f32 + p.d as f32 / 2.0 }
    }

    /// Town tile ↔ lot tile.
    fn tile(&self, x: i32, z: i32) -> (i32, i32) {
        if self.flip { (self.w - 1 - (x - self.x), self.d - 1 - (z - self.z)) } else { (x - self.x, z - self.z) }
    }

    fn tile_back(&self, x: i32, z: i32) -> (i32, i32) {
        if self.flip { (self.x + self.w - 1 - x, self.z + self.d - 1 - z) } else { (self.x + x, self.z + z) }
    }

    /// An edge (`h`: tile column `x`, grid line `z`; `v`: grid line `x`, tile row `z`; diagonals:
    /// the tile) in the other frame.
    fn edge(&self, axis: EdgeAxis, x: i32, z: i32, back: bool) -> (i32, i32) {
        let (ox, oz) = if back { (self.x, self.z) } else { (-self.x, -self.z) };
        let (x, z) = if back { (x, z) } else { (x + ox, z + oz) };
        let (lx, lz) = if !self.flip {
            (x, z)
        } else {
            match axis {
                EdgeAxis::H => (self.w - 1 - x, self.d - z),
                EdgeAxis::V => (self.w - x, self.d - 1 - z),
                EdgeAxis::Dp | EdgeAxis::Dn => (self.w - 1 - x, self.d - 1 - z),
            }
        };
        if back { (lx + ox, lz + oz) } else { (lx, lz) }
    }

    /// An object's corner and facing in the other frame (`w`, `d`: its turned footprint).
    fn object(&self, x: i32, z: i32, w: i32, d: i32, rot: u8, back: bool) -> (i32, i32, u8) {
        let (lx, lz) = if back { (x, z) } else { (x - self.x, z - self.z) };
        let (lx, lz, rot) = if self.flip { (self.w - lx - w, self.d - lz - d, (rot + 2) % 4) } else { (lx, lz, rot) };
        if back { (lx + self.x, lz + self.z, rot) } else { (lx, lz, rot) }
    }
}

fn axis_of(e: EdgeRef, lot: &crate::lot::Lot) -> Option<(EdgeAxis, i32, i32, Edge)> {
    match e {
        EdgeRef::H(x, z) => Some((EdgeAxis::H, x as i32, z as i32, lot.h_edge(x as usize, z as usize))),
        EdgeRef::V(x, z) => Some((EdgeAxis::V, x as i32, z as i32, lot.v_edge(x as usize, z as usize))),
        EdgeRef::Diag(x, z) => {
            let d = lot.diag(x as i32, z as i32)?;
            let axis = if d.dir == DiagDir::Dp { EdgeAxis::Dp } else { EdgeAxis::Dn };
            Some((axis, x as i32, z as i32, d.edge))
        }
    }
}

fn edge_ref(axis: EdgeAxis, x: i32, z: i32) -> EdgeRef {
    match axis {
        EdgeAxis::H => EdgeRef::H(x as u16, z as u16),
        EdgeAxis::V => EdgeRef::V(x as u16, z as u16),
        EdgeAxis::Dp | EdgeAxis::Dn => EdgeRef::Diag(x as u16, z as u16),
    }
}

fn ground(storey: &u8) -> bool {
    *storey == 0
}

fn kind_of(e: Edge) -> Option<EdgeKind> {
    match e {
        Edge::Open => None,
        Edge::Wall => Some(EdgeKind::Wall),
        Edge::Door => Some(EdgeKind::Door),
        Edge::Window => Some(EdgeKind::Window),
        Edge::Fence => Some(EdgeKind::Fence),
        Edge::Gate => Some(EdgeKind::Gate),
    }
}

impl World {
    /// Every edge of the lot with something on it, as `(where, axis, x, z, what)`: grid edges on
    /// or inside the plot's outline, and diagonals across its tiles.
    fn plot_edges(&self, p: &Plot) -> Vec<(EdgeRef, EdgeAxis, i32, i32, Edge)> {
        let mut out = Vec::new();
        for k in 0..self.storeys as i32 {
            let z0 = p.z + k * self.storey_depth();
            for z in z0..=z0 + p.d {
                for x in p.x..p.x + p.w {
                    if let Some((a, x, z, e)) = axis_of(EdgeRef::H(x as u16, z as u16), &self.lot).filter(|t| t.3 != Edge::Open) {
                        out.push((EdgeRef::H(x as u16, z as u16), a, x, z, e));
                    }
                }
            }
            for z in z0..z0 + p.d {
                for x in p.x..=p.x + p.w {
                    if let Some((a, x, z, e)) = axis_of(EdgeRef::V(x as u16, z as u16), &self.lot).filter(|t| t.3 != Edge::Open) {
                        out.push((EdgeRef::V(x as u16, z as u16), a, x, z, e));
                    }
                }
            }
            for z in z0..z0 + p.d {
                for x in p.x..p.x + p.w {
                    if let Some((a, x, z, e)) = axis_of(EdgeRef::Diag(x as u16, z as u16), &self.lot) {
                        out.push((EdgeRef::Diag(x as u16, z as u16), a, x, z, e));
                    }
                }
            }
        }
        out
    }

    /// Where on its storey a row is: the storey, and the row as if on the ground.
    fn on_storey(&self, z: i32) -> (u8, i32) {
        (self.storey_of(z) as u8, self.ground_z(z))
    }

    /// The household's home as a blueprint. Things that can't be bought aren't in it.
    pub fn blueprint(&self, household: u32) -> Result<Blueprint, Error> {
        let (_, plot) = self.home_of(household)?;
        let p = &self.plots[plot as usize];
        let f = Frame::of(p);
        let b = &self.content.build;
        let covering = |c: u8| (c > 0).then(|| b.coverings.get(c as usize - 1).map(|s| s.id.clone())).flatten();
        let mut bp = Blueprint { w: p.w, d: p.d, ..Default::default() };
        for (r, axis, x, z, edge) in self.plot_edges(p) {
            let Some(kind) = kind_of(edge) else { continue };
            let look = self.lot.look(r);
            let styles = match edge {
                Edge::Door => &b.doors,
                Edge::Window => &b.windows,
                Edge::Fence | Edge::Gate => &b.fences,
                _ => &b.coverings,
            };
            let style = matches!(edge, Edge::Door | Edge::Window | Edge::Fence | Edge::Gate)
                .then(|| styles.get(look.style as usize).map(|s| s.id.clone()))
                .flatten();
            let mut sides = [covering(look.sides[0]), covering(look.sides[1])];
            // Turned round, each face looks the other way.
            if f.flip {
                sides.swap(0, 1);
            }
            // An `h` edge on a storey's first row line still belongs to that storey.
            let (storey, gz) = self.on_storey(if axis == EdgeAxis::H { z - 1 } else { z });
            let gz = if axis == EdgeAxis::H { gz + 1 } else { gz };
            let (lx, lz) = f.edge(axis, x, gz, false);
            bp.edges.push(BlueprintEdge { storey, axis, x: lx, z: lz, kind, form: look.form, style, sides });
        }
        for (x, z, c) in self.lot.floors() {
            let (x, z) = (x as i32, z as i32);
            let (storey, gz) = self.on_storey(z);
            if !p.contains(x, gz) {
                continue;
            }
            if let Some(id) = b.floors.get(c as usize - 1).map(|s| s.id.clone()) {
                let (lx, lz) = f.tile(x, gz);
                bp.floors.push(BlueprintFloor { storey, x: lx, z: lz, covering: id });
            }
        }
        bp.roof = p.roof.and_then(|r| {
            Some(BlueprintRoof { style: b.roofs.get(r.style as usize)?.id.clone(), color: b.roof_colors.get(r.color as usize)?.id.clone() })
        });
        for (o, on) in self.objects.iter().zip(&self.object_plot) {
            let def = &self.content.objects[o.def];
            if *on != Some(plot) || def.price.is_none() {
                continue;
            }
            let (w, d) = o.size(&self.content);
            let (storey, gz) = self.on_storey(o.z);
            let (x, z, rot) = f.object(o.x, gz, w, d, o.rot, false);
            bp.objects.push(BlueprintObject {
                storey,
                def: def.id.clone(),
                x,
                z,
                rot,
                turn: o.turn,
                style: self.content.styles.get(o.style as usize).map(|s| s.id.clone()),
                quality: o.quality,
            });
        }
        Ok(bp)
    }

    /// [`World::blueprint`] as JSON.
    pub fn blueprint_json(&self, household: u32) -> Result<String, Error> {
        Ok(serde_json::to_string(&self.blueprint(household)?).expect("blueprints serialize"))
    }

    /// Builds a blueprint on the household's home lot, which must have no walls on it. Paid like
    /// building and buying it all (free in Creative); refused as a whole if the money isn't
    /// there. Furniture that doesn't fit (something already stands there) is left out.
    pub fn build_blueprint(&mut self, household: u32, bp: &Blueprint) -> Result<(), Error> {
        let (h, plot) = self.home_of(household)?;
        let p = self.plots[plot as usize].clone();
        if self.plot_edges(&p).iter().any(|(.., e)| e.is_wall()) {
            return Err(Error::new("a blueprint goes on an empty lot: take the house down first"));
        }
        let before = self.home_snapshot(household).expect("the household has a home");
        // Price it by building it with all the money in the world, then settle the bill.
        let funds = self.households[h].funds;
        const PURSE: i64 = i64::MAX / 4;
        self.households[h].funds = PURSE;
        let laid = self.lay_blueprint(household, &p, bp);
        let cost = PURSE - self.households[h].funds;
        if let Err(e) = laid {
            self.restore(before);
            self.refresh_rooms();
            return Err(e);
        }
        if cost > funds {
            self.restore(before);
            self.refresh_rooms();
            return Err(Error::new(format!("not enough money: building it costs ${cost}")));
        }
        self.households[h].funds = funds - cost;
        self.refresh_rooms();
        Ok(())
    }

    fn lay_blueprint(&mut self, household: u32, p: &Plot, bp: &Blueprint) -> Result<(), Error> {
        let f = Frame::of(p);
        // Centred across a lot of another width; the front stays at the street.
        let ox = (p.w - bp.w).div_euclid(2);
        let b = self.content.build.clone();
        let index = |list: &[crate::content::BuildStyle], id: &Option<String>| id.as_ref().and_then(|id| list.iter().position(|s| &s.id == id));
        let mut edits = Vec::new();
        let mut faces = Vec::new();
        let (storeys, depth) = (self.storeys, self.storey_depth());
        let lift = move |storey: u8| -> Result<i32, Error> {
            if storey >= storeys {
                return Err(Error::new("this game's houses can't be that tall"));
            }
            Ok(storey as i32 * depth)
        };
        for e in &bp.edges {
            let (x, z) = f.edge(e.axis, e.x + ox, e.z, true);
            let inside = match e.axis {
                EdgeAxis::H => x >= p.x && x < p.x + p.w && z >= p.z && z <= p.z + p.d,
                EdgeAxis::V => x >= p.x && x <= p.x + p.w && z >= p.z && z < p.z + p.d,
                EdgeAxis::Dp | EdgeAxis::Dn => p.contains(x, z),
            };
            if !inside {
                return Err(Error::new("that blueprint doesn't fit on this lot"));
            }
            let z = z + lift(e.storey)?;
            let style = match e.kind {
                EdgeKind::Door => index(&b.doors, &e.style),
                EdgeKind::Window => index(&b.windows, &e.style),
                EdgeKind::Fence | EdgeKind::Gate => index(&b.fences, &e.style),
                _ => None,
            };
            edits.push(EdgeEdit {
                axis: e.axis,
                x,
                z,
                kind: e.kind,
                cover: None,
                form: (e.kind == EdgeKind::Wall && e.form != 0).then_some(e.form),
                style: style.map(|s| s as u8),
            });
            let mut sides = e.sides.clone();
            if f.flip {
                sides.swap(0, 1);
            }
            for (side, cover) in sides.iter().enumerate() {
                if let Some(c) = index(&b.coverings, cover) {
                    faces.push(FacePaint { axis: e.axis, x, z, side: side as u8, covering: c as u8 + 1 });
                }
            }
        }
        // Everything at once (a door goes in with the wall around it); if the rules want walls
        // first, walls and fences, then what goes into them.
        if self.build(household, &edits).is_err() {
            let (openings, walls): (Vec<EdgeEdit>, Vec<EdgeEdit>) =
                edits.iter().partition(|e| matches!(e.kind, EdgeKind::Door | EdgeKind::Window | EdgeKind::Gate));
            let base = |e: &EdgeEdit| EdgeEdit { kind: if e.kind == EdgeKind::Gate { EdgeKind::Fence } else { EdgeKind::Wall }, style: if e.kind == EdgeKind::Gate { e.style } else { None }, ..*e };
            let mut first = walls;
            first.extend(openings.iter().map(base));
            self.build(household, &first)?;
            self.build(household, &openings)?;
        }
        self.refresh_rooms();
        if !faces.is_empty() {
            self.paint(household, &faces)?;
        }
        let tiles: Vec<FloorPaint> = bp
            .floors
            .iter()
            .filter_map(|t| {
                let c = b.floors.iter().position(|s| s.id == t.covering)?;
                let (x, z) = f.tile_back(t.x + ox, t.z);
                let up = lift(t.storey).ok()?;
                p.contains(x, z).then_some(FloorPaint { x, z: z + up, covering: c as u8 + 1 })
            })
            .collect();
        if !tiles.is_empty() {
            self.paint_floor(household, &tiles)?;
        }
        if let Some(r) = &bp.roof
            && let (Some(style), Some(color)) = (b.roofs.iter().position(|s| s.id == r.style), b.roof_colors.iter().position(|s| s.id == r.color))
        {
            self.set_roof(household, style as u8, color as u8)?;
        }
        for o in &bp.objects {
            let Some(def) = self.content.object_index(&o.def) else { continue };
            let [fw, fd] = self.content.objects[def].footprint;
            let (w, d) = if o.rot % 2 == 0 { (fw as i32, fd as i32) } else { (fd as i32, fw as i32) };
            let (x, z, rot) = f.object(o.x + ox, o.z, w, d, o.rot, true);
            let Ok(up) = lift(o.storey) else { continue };
            let z = z + up;
            let style = o.style.as_ref().and_then(|s| self.content.styles.iter().position(|x| &x.id == s)).map(|s| s as u8);
            let Ok(id) = self.buy(household, &o.def, Some([x, z, rot as i32]), style) else { continue };
            if self.content.objects[def].turns && o.turn < 90 {
                self.objects[id as usize].turn = o.turn;
            }
            for _ in 0..o.quality {
                if self.upgrade(household, id).is_err() {
                    break;
                }
            }
        }
        Ok(())
    }

    /// Moves the room around tile `(x, z)` of the household's home by `(dx, dz)` tiles: its
    /// walls (those it shares with another room stay for that room too), doors, windows, floors
    /// and everything standing in it. The new place must be open ground on the lot. Free.
    pub fn move_room(&mut self, household: u32, x: i32, z: i32, dx: i32, dz: i32) -> Result<(), Error> {
        let (_, plot) = self.home_of(household)?;
        let p = self.plots[plot as usize].clone();
        // On the room's own storey.
        let up = self.storey_of(z) * self.storey_depth();
        let on_plot = |tx: i32, tz: i32| tz >= p.z + up && tz < p.z + p.d + up && p.contains(tx, tz - up);
        if !on_plot(x, z) {
            return Err(Error::new("that isn't on your lot"));
        }
        let room = self.lot.room_at(x, z);
        if room == OUTDOORS {
            return Err(Error::new("that isn't a room"));
        }
        if (dx, dz) == (0, 0) {
            return Ok(());
        }
        // The room's tiles (a tile split by a diagonal belongs to it if either half does).
        let mut tiles = BTreeSet::new();
        for tz in p.z + up..p.z + p.d + up {
            for tx in p.x..p.x + p.w {
                let [a, b] = self.lot.half_rooms()[self.lot.tile_index(tx, tz)];
                if a == room || b == room {
                    tiles.insert((tx, tz));
                }
            }
        }
        let ours = |t: (i32, i32)| tiles.contains(&t);
        let indoors_other = |w: &World, t: (i32, i32)| w.lot.in_bounds(t.0, t.1) && !ours(t) && w.lot.room_at(t.0, t.1) != OUTDOORS;
        // Its edges: where it is now, whether that place is vacated (no other room needs it).
        let mut moving: Vec<(EdgeRef, EdgeAxis, i32, i32, Edge, EdgeLook, bool)> = Vec::new();
        for (r, axis, ex, ez, edge) in self.plot_edges(&p) {
            if edge.is_fence() {
                continue;
            }
            let sides: [(i32, i32); 2] = match axis {
                EdgeAxis::H => [(ex, ez - 1), (ex, ez)],
                EdgeAxis::V => [(ex - 1, ez), (ex, ez)],
                EdgeAxis::Dp | EdgeAxis::Dn => [(ex, ez), (ex, ez)],
            };
            if !sides.iter().any(|&t| ours(t)) {
                continue;
            }
            let shared = match axis {
                EdgeAxis::Dp | EdgeAxis::Dn => {
                    let [a, b] = self.lot.half_rooms()[self.lot.tile_index(ex, ez)];
                    (a != room && a != OUTDOORS) || (b != room && b != OUTDOORS)
                }
                _ => sides.iter().any(|&t| indoors_other(self, t)),
            };
            moving.push((r, axis, ex, ez, edge, self.lot.look(r), !shared));
        }
        // The new place: on the lot, open ground (or the room's own place), nothing else standing there.
        let target: BTreeSet<(i32, i32)> = tiles.iter().map(|&(tx, tz)| (tx + dx, tz + dz)).collect();
        for &(tx, tz) in &target {
            if !on_plot(tx, tz) {
                return Err(Error::new("the room has to stay on your lot"));
            }
            if !ours((tx, tz)) && (self.lot.room_at(tx, tz) != OUTDOORS || self.lot.diag(tx, tz).is_some()) {
                return Err(Error::new("there's another room in the way"));
            }
        }
        let carried: Vec<u32> = self
            .objects
            .iter()
            .filter(|o| self.object_plot[o.id as usize] == Some(plot) && o.tiles(&self.content).all(|t| ours(t)))
            .map(|o| o.id)
            .collect();
        let in_the_way = self.objects.iter().any(|o| !carried.contains(&o.id) && o.tiles(&self.content).any(|t| target.contains(&t)));
        if in_the_way {
            return Err(Error::new("something is standing where the room would go"));
        }
        let vacated: BTreeSet<EdgeRef> = moving.iter().filter(|m| m.6).map(|m| m.0).collect();
        let moved_ref = |axis: EdgeAxis, ex: i32, ez: i32| edge_ref(axis, ex + dx, ez + dz);
        for m in &moving {
            let to = moved_ref(m.1, m.2, m.3);
            let free = match to {
                EdgeRef::Diag(tx, tz) => self.lot.diag(tx as i32, tz as i32).is_none() || vacated.contains(&to),
                _ => axis_of(to, &self.lot).is_none_or(|t| t.3 == Edge::Open || t.3.is_wall()) || vacated.contains(&to),
            };
            if !free {
                return Err(Error::new("a fence is in the way"));
            }
        }
        let unreachable = |w: &World| {
            let seen = w.reachable(plot);
            let objects = w
                .objects
                .iter()
                .filter(|o| w.object_plot[o.id as usize] == Some(plot))
                .filter(|o| {
                    let (fx, fz) = o.front_tile(&w.content);
                    !w.lot.in_bounds(fx, fz) || !seen[w.lot.tile_index(fx, fz)]
                })
                .count();
            let sims = w
                .sims
                .iter()
                .filter(|s| s.here() && s.away_until.is_none() && p.contains(s.tile().0, w.ground_z(s.tile().1)) && !seen[w.lot.tile_index(s.tile().0, s.tile().1)])
                .count();
            objects + sims
        };
        let shut_in = unreachable(self);
        let before = self.home_snapshot(household).expect("the household has a home");
        let result = (|| {
            // Lift the furniture out (ids shift down as each goes; take the highest first).
            let mut lifted = Vec::new();
            for &id in carried.iter().rev() {
                lifted.push(self.remove_object(id));
            }
            // Clear the old place, then build the room at the new one.
            for m in moving.iter().filter(|m| m.6) {
                self.set_edge(m.0, Edge::Open, None);
                self.lot.set_look(m.0, EdgeLook::default());
            }
            for m in &moving {
                let to = moved_ref(m.1, m.2, m.3);
                let dir = match m.1 {
                    EdgeAxis::Dp => Some(DiagDir::Dp),
                    EdgeAxis::Dn => Some(DiagDir::Dn),
                    _ => None,
                };
                // Where another room's wall already stands, it stays as it is.
                let standing = axis_of(to, &self.lot).is_some_and(|t| t.3 != Edge::Open);
                if standing {
                    continue;
                }
                self.set_edge(to, m.4, dir);
                self.lot.set_look(to, m.5);
            }
            let floors: BTreeMap<(i32, i32), u8> = tiles.iter().map(|&(tx, tz)| ((tx, tz), self.lot.floor(tx as u16, tz as u16))).collect();
            for &(tx, tz) in floors.keys() {
                self.lot.set_floor(tx as u16, tz as u16, 0);
            }
            for (&(tx, tz), &c) in &floors {
                self.lot.set_floor((tx + dx) as u16, (tz + dz) as u16, c);
            }
            self.lot.compute_rooms();
            self.structure_version += 1;
            self.refresh_rooms();
            for o in lifted.iter().rev() {
                let name = self.content.objects[o.def].name.to_lowercase();
                let id = self
                    .place_at_home(plot, o.def, o.x + dx, o.z + dz, o.rot, o.style, o.quality, o.value)
                    .map_err(|_| Error::new(format!("there's no room for the {name} there")))?;
                let placed = &mut self.objects[id as usize];
                placed.turn = o.turn;
                placed.wear = o.wear;
            }
            if unreachable(self) > shut_in {
                return Err(Error::new("that would shut someone or something in"));
            }
            self.storeys_stand(plot)
        })();
        if let Err(e) = result {
            self.restore(before);
            self.refresh_rooms();
            return Err(e);
        }
        Ok(())
    }

    /// Sets what stands on an edge (a diagonal needs its direction to stand).
    fn set_edge(&mut self, r: EdgeRef, e: Edge, dir: Option<DiagDir>) {
        match r {
            EdgeRef::H(x, z) => self.lot.set_h(x as usize, z as usize, e),
            EdgeRef::V(x, z) => self.lot.set_v(x as usize, z as usize, e),
            EdgeRef::Diag(x, z) => {
                let d = match (e, dir.or_else(|| self.lot.diag(x as i32, z as i32).map(|d| d.dir))) {
                    (Edge::Open, _) | (_, None) => None,
                    (edge, Some(dir)) => Some(Diagonal { dir, edge }),
                };
                self.lot.set_diag(x as usize, z as usize, d);
            }
        }
    }
}
