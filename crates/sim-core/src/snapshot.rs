//! Compact per-tick state for the renderer, written into a flat `f32` buffer.
//!
//! The layout is defined only here; the web side reads it via `layout_json()`,
//! so the two sides cannot drift apart.

use crate::world::{MAX_SIMS, World};
use crate::{TICKS_PER_SECOND, clock};

pub const HEADER_LEN: usize = 8;
pub const SIM_STRIDE: usize = 16;
pub const CAPACITY: usize = HEADER_LEN + MAX_SIMS * SIM_STRIDE;

pub mod header {
    /// Tick counter modulo 2^24 (exact in f32); only used to detect change.
    pub const TICK: usize = 0;
    pub const DAY: usize = 1;
    pub const MINUTE: usize = 2;
    pub const SPEED: usize = 3;
    pub const SIM_COUNT: usize = 4;
    pub const STRUCTURE_VERSION: usize = 5;
}

pub mod sim {
    pub const ID: usize = 0;
    pub const X: usize = 1;
    pub const Z: usize = 2;
    pub const YAW: usize = 3;
    /// 0 = stand, 1 = sit, 2 = lie.
    pub const POSE: usize = 4;
    /// 1 while walking.
    pub const MOVING: usize = 5;
    /// Social interaction index + 1 while in a conversation (as actor or target), else 0.
    pub const SOCIAL: usize = 6;
    /// 0 = undecided/hidden, 1 = went well, 2 = went badly (revealed halfway through).
    pub const OUTCOME: usize = 7;
    /// Conversation partner's id, or -1.
    pub const PARTNER: usize = 8;
    /// Animation code (see `social::ANIMATIONS`), 0 = none.
    pub const ANIM: usize = 9;
    /// Dominant emotion index + 1, or 0.
    pub const EMOTION: usize = 10;
    /// 1 = started the conversation, 2 = was approached, 0 = not talking.
    pub const ROLE: usize = 11;
    /// 1 while away from the map (at work).
    pub const AWAY: usize = 12;
}

/// Writes the snapshot into `out`, which must hold at least `CAPACITY` floats.
pub fn write(world: &World, out: &mut [f32]) {
    out[header::TICK] = (world.tick % (1 << 24)) as f32;
    out[header::DAY] = clock::day(world.tick) as f32;
    out[header::MINUTE] = clock::minute_of_day(world.tick);
    out[header::SPEED] = world.speed as f32;
    out[header::SIM_COUNT] = world.sims.len() as f32;
    out[header::STRUCTURE_VERSION] = world.structure_version() as f32;
    for (i, s) in world.sims.iter().enumerate() {
        let o = &mut out[HEADER_LEN + i * SIM_STRIDE..HEADER_LEN + (i + 1) * SIM_STRIDE];
        o[sim::ID] = s.id as f32;
        o[sim::X] = s.pos[0];
        o[sim::Z] = s.pos[1];
        o[sim::YAW] = s.yaw;
        o[sim::POSE] = s.pose.code();
        o[sim::MOVING] = s.is_moving() as u8 as f32;
        o[sim::SOCIAL] = 0.0;
        o[sim::OUTCOME] = 0.0;
        o[sim::PARTNER] = -1.0;
        o[sim::ANIM] = 0.0;
        o[sim::EMOTION] = s.emotion(&world.content).map_or(0.0, |e| e as f32 + 1.0);
        o[sim::ROLE] = 0.0;
        o[sim::AWAY] = s.away_until.is_some() as u8 as f32;
    }
    // Conversations: write the shared state into both participants' rows.
    for (i, s) in world.sims.iter().enumerate() {
        let Some((t, social, success, progress)) = s.conversation(&world.content) else {
            continue;
        };
        let outcome = if progress < 0.5 {
            0.0
        } else if success {
            1.0
        } else {
            2.0
        };
        let anim = world.content.socials[social].anim as f32;
        for (me, other, role) in [(i, t as usize, 1.0), (t as usize, i, 2.0)] {
            let o = &mut out[HEADER_LEN + me * SIM_STRIDE..HEADER_LEN + (me + 1) * SIM_STRIDE];
            o[sim::SOCIAL] = social as f32 + 1.0;
            o[sim::OUTCOME] = outcome;
            o[sim::PARTNER] = other as f32;
            o[sim::ANIM] = anim;
            o[sim::ROLE] = role;
        }
    }
}

pub fn layout_json() -> String {
    serde_json::json!({
        "capacity": CAPACITY,
        "headerLen": HEADER_LEN,
        "simStride": SIM_STRIDE,
        "maxSims": MAX_SIMS,
        "ticksPerSecond": TICKS_PER_SECOND,
        "header": {
            "tick": header::TICK, "day": header::DAY, "minute": header::MINUTE,
            "speed": header::SPEED, "simCount": header::SIM_COUNT,
            "structureVersion": header::STRUCTURE_VERSION,
        },
        "sim": {
            "id": sim::ID, "x": sim::X, "z": sim::Z, "yaw": sim::YAW,
            "pose": sim::POSE, "moving": sim::MOVING, "social": sim::SOCIAL,
            "outcome": sim::OUTCOME, "partner": sim::PARTNER, "anim": sim::ANIM, "emotion": sim::EMOTION,
            "role": sim::ROLE, "away": sim::AWAY,
        },
    })
    .to_string()
}
