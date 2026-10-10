//! Grid pathfinding: 8-directional A* with no corner cutting, then string-pulling.
//!
//! Diagonal walls: a tile crossed by a diagonal wall or window can't be entered at all (it
//! blocks movement between its two halves), so residents walk around it on whole tiles. A
//! diagonal door tile is walked across like a doorway. A diagonal step passes the grid corner
//! shared by four tiles; it is refused when any diagonal ends at that corner (it would cross a
//! diagonal wall or clip its end), but allowed past a diagonal that keeps clear of the corner,
//! so a corridor between two parallel diagonal walls can be walked.
//!
//! Storeys: storey `k` is rows `k * depth .. (k + 1) * depth` of the lot (see
//! `World::storeys`). Above the ground only rooms have a floor to stand on. Stairs are walked
//! up from their foot, step by step, and the top step leads straight to the landing on the
//! storey above.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::lot::{Lot, OUTDOORS};

/// One flight of stairs, one tile wide: entered at `bottom` from `foot`, climbed along `dir`
/// for `len` steps; the top step leads to `landing` on the storey above.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stair {
    pub foot: (i32, i32),
    pub bottom: (i32, i32),
    pub dir: (i32, i32),
    pub len: i32,
    pub landing: (i32, i32),
}

impl Stair {
    pub fn top(&self) -> (i32, i32) {
        (self.bottom.0 + self.dir.0 * (self.len - 1), self.bottom.1 + self.dir.1 * (self.len - 1))
    }

    /// Which step a tile is (0 the bottom one), if it is one.
    pub fn step(&self, x: i32, z: i32) -> Option<i32> {
        (0..self.len).find(|&i| (self.bottom.0 + self.dir.0 * i, self.bottom.1 + self.dir.1 * i) == (x, z))
    }
}

/// The lot's storeys and stairs, for walking.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StairMap {
    /// Rows per storey; 0 when the lot has one storey.
    pub depth: i32,
    pub stairs: Vec<Stair>,
}

/// No storeys, no stairs.
pub static NO_STAIRS: StairMap = StairMap { depth: 0, stairs: Vec::new() };

impl StairMap {
    /// The storey a row is on.
    pub fn storey(&self, z: i32) -> i32 {
        if self.depth > 0 { z.div_euclid(self.depth) } else { 0 }
    }

    /// The same place on the ground storey's rows.
    pub fn ground_z(&self, z: i32) -> i32 {
        if self.depth > 0 { z.rem_euclid(self.depth) } else { z }
    }

    /// The flight a tile is a step of, and which step.
    pub fn step(&self, x: i32, z: i32) -> Option<(&Stair, i32)> {
        self.stairs.iter().find_map(|s| s.step(x, z).map(|i| (s, i)))
    }

    /// Where a stair links to from this tile: the landing from the top step, or back.
    pub fn link(&self, x: i32, z: i32) -> Option<(i32, i32)> {
        self.stairs.iter().find_map(|s| {
            if s.top() == (x, z) {
                Some(s.landing)
            } else if s.landing == (x, z) {
                Some(s.top())
            } else {
                None
            }
        })
    }

    /// How far apart two points are for someone walking (storeys counted as a few metres).
    pub fn distance(&self, a: [f32; 2], b: [f32; 2]) -> f32 {
        if self.depth == 0 {
            return (a[0] - b[0]).hypot(a[1] - b[1]);
        }
        let d = self.depth as f32;
        let (ka, kb) = ((a[1] / d).floor(), (b[1] / d).floor());
        let flat = (a[0] - b[0]).hypot((a[1] - ka * d) - (b[1] - kb * d));
        flat + (ka - kb).abs() * STOREY_WALK
    }
}

/// Going up or down a storey counts as this many metres of walking (for choosing what to do).
pub const STOREY_WALK: f32 = 4.0;

const ORTHO: u32 = 10;
const DIAG: u32 = 14;

/// Read-only view of what is walkable: lot edges plus tiles blocked by objects, storeys and stairs.
pub struct NavGrid<'a> {
    pub lot: &'a Lot,
    pub blocked: &'a [bool],
    pub stairs: &'a StairMap,
}

impl NavGrid<'_> {
    /// Whether a resident can stand on the tile: on the lot, no furniture, no diagonal wall;
    /// above the ground, only in a room (where there's a floor).
    pub fn tile_free(&self, x: i32, z: i32) -> bool {
        self.lot.in_bounds(x, z)
            && !self.blocked[self.lot.tile_index(x, z)]
            && !self.lot.diag_blocks(x, z)
            && (self.stairs.depth == 0 || z < self.stairs.depth || self.lot.room_at(x, z) != OUTDOORS)
    }

    /// Whether a single step from `a` to the neighbouring tile `b` is allowed.
    pub fn can_step(&self, ax: i32, az: i32, bx: i32, bz: i32) -> bool {
        let (dx, dz) = (bx - ax, bz - az);
        if !self.tile_free(bx, bz) {
            return false;
        }
        // Stairs are walked straight up and down, entered at the foot.
        if !self.stairs.stairs.is_empty() {
            let from = self.stairs.step(ax, az);
            let to = self.stairs.step(bx, bz);
            let along = |s: &Stair| (dx, dz) == s.dir || (dx, dz) == (-s.dir.0, -s.dir.1);
            match (from, to) {
                (None, None) => {}
                (Some((a, _)), Some((b, _))) => {
                    if a != b || !along(a) {
                        return false;
                    }
                }
                (Some((s, i)), None) => {
                    if i != 0 || (bx, bz) != s.foot {
                        return false;
                    }
                }
                (None, Some((s, i))) => {
                    if i != 0 || (ax, az) != s.foot {
                        return false;
                    }
                }
            }
        }
        if dx == 0 || dz == 0 {
            return self.lot.edge_walkable(ax, az, bx, bz);
        }
        // Diagonal: the step passes the grid corner shared by the four tiles. No diagonal wall
        // may end there, and both L-shaped routes must be open, so residents never clip corners.
        let (cx, cz) = (ax.max(bx), az.max(bz));
        let clear = |x: i32, z: i32| !self.lot.diag_touches(x, z, cx, cz);
        // The tiles beside the step: no furniture; a diagonal wall across them is fine as long
        // as it keeps clear of the corner (checked above for all four tiles).
        let beside =
            |x: i32, z: i32| self.lot.in_bounds(x, z) && !self.blocked[self.lot.tile_index(x, z)];
        clear(ax, az)
            && clear(bx, bz)
            && clear(ax + dx, az)
            && clear(ax, az + dz)
            && beside(ax + dx, az)
            && beside(ax, az + dz)
            && self.lot.edge_walkable(ax, az, ax + dx, az)
            && self.lot.edge_walkable(ax + dx, az, bx, bz)
            && self.lot.edge_walkable(ax, az, ax, az + dz)
            && self.lot.edge_walkable(ax, az + dz, bx, bz)
    }

    /// A* from `start` to `goal` (tile coordinates). The start tile may be blocked.
    pub fn find_path(&self, start: (i32, i32), goal: (i32, i32)) -> Option<Vec<(i32, i32)>> {
        let lot = self.lot;
        if !lot.in_bounds(start.0, start.1) || !self.tile_free(goal.0, goal.1) {
            return None;
        }
        if start == goal {
            return Some(vec![start]);
        }
        let n = lot.width * lot.depth;
        let mut g = vec![u32::MAX; n];
        let mut came = vec![u32::MAX; n];
        let mut open = BinaryHeap::new();
        let s = lot.tile_index(start.0, start.1);
        let goal_i = lot.tile_index(goal.0, goal.1);
        g[s] = 0;
        let heuristic = |a: (i32, i32), b: (i32, i32)| heuristic(self.flat(a), self.flat(b));
        open.push(Reverse((heuristic(start, goal), s as u32)));

        while let Some(Reverse((f, i))) = open.pop() {
            let i = i as usize;
            if i == goal_i {
                return Some(reconstruct(lot, &came, i));
            }
            let (x, z) = ((i % lot.width) as i32, (i / lot.width) as i32);
            if f > g[i] + heuristic((x, z), goal) {
                continue; // stale heap entry
            }
            let link = self.stairs.link(x, z).filter(|&(lx, lz)| self.tile_free(lx, lz));
            for (dx, dz) in NEIGHBOURS.into_iter().chain(link.map(|(lx, lz)| (lx - x, lz - z))) {
                let (nx, nz) = (x + dx, z + dz);
                let linked = Some((nx, nz)) == link;
                if !linked && ((dx.abs() > 1 || dz.abs() > 1) || !self.can_step(x, z, nx, nz)) {
                    continue;
                }
                let ni = lot.tile_index(nx, nz);
                let cost = g[i] + if dx != 0 && dz != 0 && !linked { DIAG } else { ORTHO };
                if cost < g[ni] {
                    g[ni] = cost;
                    came[ni] = i as u32;
                    open.push(Reverse((cost + heuristic((nx, nz), goal), ni as u32)));
                }
            }
        }
        None
    }

    /// A tile as if on the ground storey (so distances between storeys stay honest).
    fn flat(&self, (x, z): (i32, i32)) -> (i32, i32) {
        (x, self.stairs.ground_z(z))
    }

    /// Tiles a resident can walk to from `(x, z)` in one step: neighbours, and up or down stairs.
    pub fn neighbours(&self, x: i32, z: i32) -> impl Iterator<Item = (i32, i32)> + '_ {
        let link = self.stairs.link(x, z).filter(|&(lx, lz)| self.tile_free(lx, lz));
        NEIGHBOURS
            .into_iter()
            .map(move |(dx, dz)| (x + dx, z + dz))
            .filter(move |&(nx, nz)| self.can_step(x, z, nx, nz))
            .chain(link)
    }

    /// Removes unnecessary waypoints where a straight line is walkable. Returns tile centres.
    pub fn smooth(&self, path: &[(i32, i32)]) -> Vec<[f32; 2]> {
        let centre = |(x, z): (i32, i32)| [x as f32 + 0.5, z as f32 + 0.5];
        let mut out = Vec::with_capacity(path.len());
        let Some(&first) = path.first() else {
            return out;
        };
        let mut anchor = 0;
        out.push(centre(first));
        let mut i = 2;
        while i < path.len() {
            if !self.line_walkable(centre(path[anchor]), centre(path[i])) {
                anchor = i - 1;
                out.push(centre(path[anchor]));
            }
            i += 1;
        }
        if path.len() > 1 {
            out.push(centre(path[path.len() - 1]));
        }
        out
    }

    /// Samples the segment and checks every tile transition it makes.
    pub fn line_walkable(&self, a: [f32; 2], b: [f32; 2]) -> bool {
        let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
        let steps = ((dx.abs().max(dz.abs())) / 0.1).ceil().max(1.0) as i32;
        let (mut tx, mut tz) = (a[0].floor() as i32, a[1].floor() as i32);
        for s in 1..=steps {
            let t = s as f32 / steps as f32;
            let (nx, nz) = (
                (a[0] + dx * t).floor() as i32,
                (a[1] + dz * t).floor() as i32,
            );
            if (nx, nz) != (tx, tz) {
                if (nx - tx).abs() > 1 || (nz - tz).abs() > 1 || !self.can_step(tx, tz, nx, nz) {
                    return false;
                }
                (tx, tz) = (nx, nz);
            }
        }
        true
    }
}

const NEIGHBOURS: [(i32, i32); 8] = [
    (1, 0),
    (-1, 0),
    (0, 1),
    (0, -1),
    (1, 1),
    (1, -1),
    (-1, 1),
    (-1, -1),
];

fn heuristic(a: (i32, i32), b: (i32, i32)) -> u32 {
    let dx = (a.0 - b.0).unsigned_abs();
    let dz = (a.1 - b.1).unsigned_abs();
    ORTHO * dx.max(dz) + (DIAG - ORTHO) * dx.min(dz)
}

fn reconstruct(lot: &Lot, came: &[u32], mut i: usize) -> Vec<(i32, i32)> {
    let mut out = Vec::new();
    loop {
        out.push(((i % lot.width) as i32, (i / lot.width) as i32));
        match came[i] {
            u32::MAX => break,
            prev => i = prev as usize,
        }
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lot::LotFile;

    fn lot_with_wall() -> Lot {
        // Wall along x = 5 from z = 0 to z = 8, door-less: must go around at z >= 8.
        let file: LotFile =
            serde_json::from_str(r#"{"width":10,"depth":10,"walls":[[5,0,5,8]]}"#).unwrap();
        Lot::from_file(&file).unwrap()
    }

    #[test]
    fn routes_around_wall() {
        let lot = lot_with_wall();
        let blocked = vec![false; 100];
        let nav = NavGrid {
            lot: &lot,
            blocked: &blocked,
            stairs: &NO_STAIRS,
        };
        let path = nav.find_path((2, 2), (7, 2)).expect("path exists");
        assert!(
            path.iter().any(|&(_, z)| z >= 8),
            "must go around the wall end"
        );
        for w in path.windows(2) {
            assert!(nav.can_step(w[0].0, w[0].1, w[1].0, w[1].1));
        }
    }

    #[test]
    fn smoothing_keeps_walkability() {
        let lot = lot_with_wall();
        let blocked = vec![false; 100];
        let nav = NavGrid {
            lot: &lot,
            blocked: &blocked,
            stairs: &NO_STAIRS,
        };
        let path = nav.find_path((2, 2), (7, 2)).unwrap();
        let smooth = nav.smooth(&path);
        assert!(smooth.len() < path.len());
        for w in smooth.windows(2) {
            assert!(nav.line_walkable(w[0], w[1]));
        }
    }

    fn nav_of(lot: &Lot) -> Vec<bool> {
        vec![false; lot.width * lot.depth]
    }

    /// Every step of a path is allowed and no tile on it is crossed by a diagonal wall.
    fn assert_walkable(nav: &NavGrid, path: &[(i32, i32)]) {
        for &(x, z) in path {
            assert!(
                !nav.lot.diag_blocks(x, z),
                "path enters diagonal wall tile {x},{z}"
            );
        }
        for w in path.windows(2) {
            assert!(nav.can_step(w[0].0, w[0].1, w[1].0, w[1].1), "{w:?}");
        }
    }

    /// A diagonal wall `/` from (2, 0) to (8, 6) across tiles (2,0)..(7,5), then straight up
    /// x = 8 to z = 10: the lower-right side is closed off except around the far end.
    fn lot_with_diagonal(door: bool) -> Lot {
        let mut diags: Vec<String> = (0..6)
            .map(|k| format!(r#"{{"x":{},"z":{},"dir":"dp"}}"#, 2 + k, k))
            .collect();
        if door {
            diags[3] = r#"{"x":5,"z":3,"dir":"dp","kind":"door"}"#.into();
        }
        let json = format!(
            r#"{{"width":12,"depth":12,"walls":[[8,6,8,11],[2,0,0,0]],"diagonals":[{}]}}"#,
            diags.join(",")
        );
        let file: LotFile = serde_json::from_str(&json).unwrap();
        Lot::from_file(&file).unwrap()
    }

    #[test]
    fn diagonal_wall_tiles_block_and_steps_cannot_cross_it() {
        let lot = lot_with_diagonal(false);
        let blocked = nav_of(&lot);
        let nav = NavGrid {
            lot: &lot,
            blocked: &blocked,
            stairs: &NO_STAIRS,
        };
        assert!(!nav.tile_free(4, 2), "nobody stands on a diagonal wall");
        // Orthogonal steps into the wall tile are refused from both halves.
        assert!(!nav.can_step(4, 1, 4, 2));
        assert!(!nav.can_step(3, 2, 4, 2));
        // Diagonal steps across the joint of two diagonal tiles are refused both ways.
        assert!(
            !nav.can_step(5, 2, 4, 3),
            "crosses the wall at corner (5, 3)"
        );
        assert!(
            !nav.can_step(6, 3, 5, 4),
            "crosses the wall at corner (6, 4)"
        );
        assert!(!nav.can_step(5, 4, 6, 3));
        // Beside the wall (parallel to it) is fine.
        assert!(nav.can_step(5, 2, 6, 3));
        // Past a free end (the wall stops at (8, 6) and the h wall at x = 0..2, z = 0).
        assert!(
            !nav.can_step(7, 6, 8, 5),
            "would clip the wall's end at (8, 6)"
        );
    }

    #[test]
    fn routes_around_a_diagonal_wall() {
        let lot = lot_with_diagonal(false);
        let blocked = nav_of(&lot);
        let nav = NavGrid {
            lot: &lot,
            blocked: &blocked,
            stairs: &NO_STAIRS,
        };
        // From the lower-right side (below the wall) to the upper-left side.
        let path = nav.find_path((6, 1), (2, 4)).expect("path around the end");
        assert_walkable(&nav, &path);
        assert!(
            path.iter().any(|&(x, z)| x >= 8 && z >= 11) || path.iter().any(|&(x, _)| x >= 9),
            "must go around via x > 8: {path:?}"
        );
        let smooth = nav.smooth(&path);
        for w in smooth.windows(2) {
            assert!(nav.line_walkable(w[0], w[1]));
        }
    }

    #[test]
    fn diagonal_door_lets_residents_through() {
        let lot = lot_with_diagonal(true);
        let blocked = nav_of(&lot);
        let nav = NavGrid {
            lot: &lot,
            blocked: &blocked,
            stairs: &NO_STAIRS,
        };
        assert!(nav.tile_free(5, 3), "a doorway can be walked");
        let path = nav.find_path((6, 2), (4, 4)).expect("through the door");
        assert!(path.contains(&(5, 3)), "{path:?}");
        assert!(path.len() <= 5, "short way through the door: {path:?}");
        assert_walkable(&nav, &path);
        // Not along the wall through the door's ends.
        assert!(!nav.can_step(4, 2, 5, 3));
        assert!(!nav.can_step(5, 3, 6, 4));
    }

    #[test]
    fn corridor_between_parallel_diagonals_is_walkable() {
        // Two `/` walls one tile apart: (0,0)..(3,3) and (2,0)..(5,3) (x - z = 0 and 2).
        let diags: Vec<String> = (0..3)
            .flat_map(|k| {
                [
                    format!(r#"{{"x":{k},"z":{k},"dir":"dp"}}"#),
                    format!(r#"{{"x":{},"z":{k},"dir":"dp"}}"#, k + 2),
                ]
            })
            .collect();
        let json = format!(
            r#"{{"width":8,"depth":8,"diagonals":[{}]}}"#,
            diags.join(",")
        );
        let lot = Lot::from_file(&serde_json::from_str::<LotFile>(&json).unwrap()).unwrap();
        let blocked = nav_of(&lot);
        let nav = NavGrid {
            lot: &lot,
            blocked: &blocked,
            stairs: &NO_STAIRS,
        };
        assert!(nav.can_step(1, 0, 2, 1), "along the corridor");
        assert!(nav.can_step(2, 1, 3, 2));
        assert!(!nav.can_step(1, 0, 0, 1), "across the left wall");
    }

    #[test]
    fn no_path_into_closed_box() {
        let file: LotFile = serde_json::from_str(
            r#"{"width":6,"depth":6,"walls":[[2,2,4,2],[2,4,4,4],[2,2,2,4],[4,2,4,4]]}"#,
        )
        .unwrap();
        let lot = Lot::from_file(&file).unwrap();
        let blocked = vec![false; 36];
        let nav = NavGrid {
            lot: &lot,
            blocked: &blocked,
            stairs: &NO_STAIRS,
        };
        assert!(nav.find_path((0, 0), (3, 3)).is_none());
    }
}
