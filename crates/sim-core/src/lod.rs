//! Lower detail for lots nobody watches.
//!
//! Only one lot is drawn at a time, but the whole town lives on. Residents on a watched lot
//! (the one being looked at, the player's home, wherever someone of the player's household
//! is) or near the view, and the player's household wherever they are, are updated every
//! tick. Everyone else takes a turn every `LOD_TICKS` ticks and catches up on the time since
//! in one go (`Sim::steps`): needs, skills, walking and whatever they're doing move on by that
//! much at once, so what the player sees of them (needs, skills, careers, money,
//! relationships, the story) stays about the same. Something they start or reach partway
//! through a turn only gets the rest of it, and something that ends partway through counts
//! half a turn towards what's next, so turns don't add or lose time. Turns are staggered, so
//! the work spreads over the ticks. Everything else (conversations, goals, the town's daily
//! events) runs every tick.
//!
//! Residents always walk real routes and stand where they would at full detail, so a lot that
//! becomes watched is already in a sensible state; they just catch up on the ticks they owe.
//!
//! `World::lod` turns it off; without a view (`World::set_view`) everything counts as watched,
//! so headless runs and tests are at full detail unless they ask for a view.

use crate::world::World;

/// Ticks between turns for residents nobody watches (a game minute).
pub const LOD_TICKS: u64 = 20;
/// Residents this close to the view (in tiles) are at full detail too: the renderer draws them
/// a little past the lot's edge, and nobody should see them take turns or catch up.
const VIEW_MARGIN: f32 = 5.0;

impl World {
    /// The part of the town being looked at, a tile rectangle `[x0, z0, x1, z1)` (None: all of
    /// it). Lots it touches are watched.
    pub fn set_view(&mut self, region: Option<[i32; 4]>) {
        self.view = region;
    }

    /// Whether resident `i` is updated every tick (as of this tick): always, unless lower
    /// detail is on, there's a view, and they're neither of the player's household, nor on a
    /// watched lot, nor near the view.
    pub fn full_detail(&self, i: usize) -> bool {
        let Some(s) = self.sims.get(i) else { return false };
        let Some([x0, z0, x1, z1]) = self.view.filter(|_| self.lod) else { return true };
        let watched = |p: u32| self.watched.get(p as usize).copied().unwrap_or(false);
        let m = VIEW_MARGIN;
        // (Upstairs is the same ground: the view is on the ground storey's rows.)
        let [x, z] = s.pos;
        let z = self.ground_z(z.floor() as i32) as f32 + z.fract();
        self.households.get(s.household as usize).is_some_and(|h| h.player)
            || self.briefs.get(i).and_then(|b| b.plot).is_some_and(watched)
            || (x >= x0 as f32 - m && z >= z0 as f32 - m && x <= x1 as f32 + m && z <= z1 as f32 + m)
    }
}

/// Before residents step (with this tick's briefs): which lots are watched, and how many ticks
/// each resident catches up on now.
pub(crate) fn plan(w: &mut World) {
    if let Some([x0, z0, x1, z1]) = w.view.filter(|_| w.lod) {
        w.watched.clear();
        w.watched.extend(w.plots.iter().map(|p| p.x < x1 && p.x + p.w > x0 && p.z < z1 && p.z + p.d > z0));
        let player = |h: u32| w.households.get(h as usize).is_some_and(|h| h.player);
        let homes = w.households.iter().filter(|h| h.player).filter_map(|h| h.plot);
        let with_them = w.briefs.iter().filter(|b| b.here && player(b.household)).filter_map(|b| b.plot);
        for p in homes.chain(with_them) {
            w.watched[p as usize] = true;
        }
    }
    let tick = w.tick;
    for i in 0..w.sims.len() {
        let full = w.full_detail(i);
        let s = &mut w.sims[i];
        // Off to work or school (or told to do something): no waiting for their turn.
        let called = s.queue.front().is_some_and(|t| t.directed);
        if full || called || (tick + i as u64).is_multiple_of(LOD_TICKS) {
            s.steps = s.owed + 1;
            s.owed = 0;
        } else {
            s.steps = 0;
            s.owed += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTENT: &str = r#"{
        "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.1},{"id":"energy","label":"Energy","decayPerHour":0.05}],
        "objects":[{"id":"fridge","name":"Fridge","interactions":[{"id":"snack","label":"Snack","minutes":10,"effects":{"hunger":0.4}}]}]}"#;

    /// Two houses side by side; the player lives in the west one.
    const TOWN: &str = r#"{"width":40,"depth":10,
        "plots":[{"name":"West","x":0,"z":0,"w":20,"d":10},{"name":"East","x":20,"z":0,"w":20,"d":10}],
        "households":[{"name":"Player","plot":0,"player":true},{"name":"Npc","plot":1}],
        "objects":[{"def":"fridge","x":2,"z":2,"rot":0},{"def":"fridge","x":22,"z":2,"rot":0}],
        "sims":[{"name":"Ada","household":0,"x":5.5,"z":5.5},{"name":"Ben","household":1,"x":35.5,"z":5.5}]}"#;

    fn town(lod: bool) -> World {
        let mut w = World::from_json(CONTENT, TOWN, 3).unwrap();
        w.lod = lod;
        w.set_view(Some([0, 0, 20, 10]));
        w
    }

    #[test]
    fn unwatched_lots_take_turns_and_catch_up() {
        let (mut full, mut lower) = (town(false), town(true));
        for w in [&mut full, &mut lower] {
            w.autonomy = false;
            for _ in 0..LOD_TICKS * 30 + 7 {
                w.tick_once();
            }
        }
        assert!(lower.full_detail(0), "the player's household is always at full detail");
        assert!(!lower.full_detail(1), "the neighbour's lot isn't watched");
        assert!(full.full_detail(1));
        // Needs run down the same, at most a turn behind.
        let behind = lower.sims[1].owed as f32 * crate::MINUTES_PER_TICK / 60.0 * 0.1;
        assert!((full.sims[1].needs[0] - (lower.sims[1].needs[0] - behind)).abs() < 1e-4);
        assert_eq!(full.sims[0].needs, lower.sims[0].needs);
    }

    #[test]
    fn a_lot_comes_into_view() {
        let mut w = town(true);
        w.tick_once();
        assert!(!w.full_detail(1));
        w.set_view(Some([20, 0, 40, 10]));
        w.tick_once();
        assert!(w.full_detail(1) && w.sims[1].owed == 0, "caught up at once");
        // Just past the edge of the view counts too (residents there are drawn).
        w.set_view(Some([0, 0, 20, 10]));
        w.sims[1].pos = [22.5, 5.5];
        w.tick_once();
        assert!(w.full_detail(1));
        // Without a view everyone is at full detail.
        w.set_view(None);
        w.tick_once();
        assert!(w.full_detail(1));
    }
}
