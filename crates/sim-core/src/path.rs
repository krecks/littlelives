//! Grid pathfinding: 8-directional A* with no corner cutting, then string-pulling.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::lot::Lot;

const ORTHO: u32 = 10;
const DIAG: u32 = 14;

/// Read-only view of what is walkable: lot edges plus tiles blocked by objects.
pub struct NavGrid<'a> {
    pub lot: &'a Lot,
    pub blocked: &'a [bool],
}

impl NavGrid<'_> {
    pub fn tile_free(&self, x: i32, z: i32) -> bool {
        self.lot.in_bounds(x, z) && !self.blocked[self.lot.tile_index(x, z)]
    }

    /// Whether a single step from `a` to the neighbouring tile `b` is allowed.
    pub fn can_step(&self, ax: i32, az: i32, bx: i32, bz: i32) -> bool {
        let (dx, dz) = (bx - ax, bz - az);
        if !self.tile_free(bx, bz) {
            return false;
        }
        if dx == 0 || dz == 0 {
            return self.lot.edge_walkable(ax, az, bx, bz);
        }
        // Diagonal: both L-shaped routes must be open, so Sims never clip corners.
        self.tile_free(ax + dx, az)
            && self.tile_free(ax, az + dz)
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
            for (dx, dz) in NEIGHBOURS {
                let (nx, nz) = (x + dx, z + dz);
                if !self.can_step(x, z, nx, nz) {
                    continue;
                }
                let ni = lot.tile_index(nx, nz);
                let cost = g[i] + if dx != 0 && dz != 0 { DIAG } else { ORTHO };
                if cost < g[ni] {
                    g[ni] = cost;
                    came[ni] = i as u32;
                    open.push(Reverse((cost + heuristic((nx, nz), goal), ni as u32)));
                }
            }
        }
        None
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
        };
        let path = nav.find_path((2, 2), (7, 2)).unwrap();
        let smooth = nav.smooth(&path);
        assert!(smooth.len() < path.len());
        for w in smooth.windows(2) {
            assert!(nav.line_walkable(w[0], w[1]));
        }
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
        };
        assert!(nav.find_path((0, 0), (3, 3)).is_none());
    }
}
