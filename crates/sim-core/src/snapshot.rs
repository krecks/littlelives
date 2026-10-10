//! Compact per-tick state for the renderer, written into a flat `f32` buffer.
//!
//! The layout is defined only here; the web side reads it via `layout_json()`,
//! so the two sides cannot drift apart.

use crate::Content;
use crate::world::{Activity, MAX_SIMS, Phase, Sim, Task, TaskKind, World};
use crate::{TICKS_PER_SECOND, clock};

pub const HEADER_LEN: usize = 8;
/// Floats per Sim (all 21 used).
pub const SIM_STRIDE: usize = 21;
pub const CAPACITY: usize = HEADER_LEN + MAX_SIMS * SIM_STRIDE;

pub mod header {
    /// Tick counter modulo 2^24 (exact in f32); only used to detect change.
    pub const TICK: usize = 0;
    pub const DAY: usize = 1;
    pub const MINUTE: usize = 2;
    pub const SPEED: usize = 3;
    pub const SIM_COUNT: usize = 4;
    pub const STRUCTURE_VERSION: usize = 5;
    /// 1 while time skips ahead because it's quiet at home (`World::calm`), else 0.
    pub const CALM: usize = 6;
    /// Id of the latest milestone event (importance 2) modulo 2^24, 0 if none yet.
    pub const MAJOR_EVENT: usize = 7;
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
    /// Conversation animation code: index into `social::ANIMATIONS` + 1 ("talk", "laugh",
    /// "flirt", ...) while in a conversation, else 0. See `ACTION` for everything else.
    pub const ANIM: usize = 9;
    /// Dominant emotion index + 1, or 0.
    pub const EMOTION: usize = 10;
    /// 1 = started the conversation, 2 = was approached, 0 = not talking.
    pub const ROLE: usize = 11;
    /// 1 while away from the map (at work).
    pub const AWAY: usize = 12;
    /// Id of the object instance the Sim is using or walking to use (index into
    /// `World::objects`, same as the structure's object ids), or -1.
    pub const OBJECT: usize = 13;
    /// What the Sim is doing: index into `Content::animations` (layout `actions`), or -1.
    /// Set while using an object (not while walking to it) and in conversations ("talk").
    pub const ACTION: usize = 14;
    /// Mood 0..1 (needs, traits and feelings), for the resting face.
    pub const MOOD: usize = 15;
    /// What the Sim is thinking about (a thought bubble): 0 nothing, 1 skipping a planned
    /// block, 2 wants somewhere to do one, 3 kept one, 4 reached a goal, 5 loves the room,
    /// 6 dislikes it, 7 something broke, 8 had an accident, 9 a baby crying (`planner::ThoughtKind`).
    pub const THOUGHT: usize = 16;
    /// The thought's subject: activity index (1-3), goal definition (4), room
    /// (`rooms::room_subject`, 5-6), object type (7), accident (8) or need (9).
    pub const THOUGHT_SUBJECT: usize = 17;
    /// How high the Sim stands, in storeys: 0 on the ground, fractions on the stairs (`Z` is on
    /// the lot's rows, which hold every storey; see `storeys.rs`).
    pub const HEIGHT: usize = 18;
    /// Object definition (index into `Content::objects`) of the object in `OBJECT` while the
    /// Sim is using it or walking to use it, else -1 (repairs too). Voices pick lines per item
    /// from it; the instance id alone would need the world structure.
    pub const OBJECT_DEF: usize = 19;
    /// The interaction (index into that definition's `interactions`) with `OBJECT_DEF`, or -1.
    pub const INTERACTION: usize = 20;
}

// Every field fits in a Sim's row.
const _: () = assert!(sim::HEIGHT < SIM_STRIDE && sim::INTERACTION < SIM_STRIDE);

/// What a Sim does for the snapshot; see `sim::OBJECT`, `sim::ACTION`, `sim::OBJECT_DEF` and
/// `sim::INTERACTION`.
struct Doing {
    object: f32,
    action: f32,
    def: f32,
    interaction: f32,
}

impl Doing {
    const NOTHING: Doing = Doing { object: -1.0, action: -1.0, def: -1.0, interaction: -1.0 };

    /// At an object or a spot without an interaction of its own.
    fn plain(object: f32, anim: Option<usize>) -> Doing {
        Doing { object, action: anim.map_or(-1.0, |a| a as f32), ..Doing::NOTHING }
    }
}

fn doing(world: &World, s: &Sim) -> Doing {
    if s.away_until.is_some() {
        return Doing::NOTHING;
    }
    // Repairing: at the object, the tinker animation while at it.
    if let Some(Activity { task: Task { kind: TaskKind::Repair { object }, .. }, phase, .. }) = s.current() {
        let anim = world.content.object_rules.repair.anim.filter(|_| matches!(phase, Phase::Using { .. }));
        return Doing::plain(*object as f32, anim);
    }
    // An accident's while on the spot (asleep on the floor, takeout).
    if let Some(Activity { task: Task { kind: TaskKind::Spot { accident }, .. }, .. }) = s.current() {
        return Doing::plain(-1.0, world.content.accidents[*accident].rest.as_ref().and_then(|r| r.anim));
    }
    // A visitor knocking at the door.
    if let Some(Activity { phase: Phase::Knocking { .. }, .. }) = s.current() {
        return Doing::plain(-1.0, world.content.visits.door.as_ref().and_then(|d| d.knock_anim));
    }
    // Tidying up: no object, the clean animation while at it.
    if let Some(Activity { task: Task { kind: TaskKind::Clean { .. }, .. }, phase, .. }) = s.current() {
        return Doing::plain(-1.0, world.content.room_rules.clean.anim.filter(|_| matches!(phase, Phase::Using { .. })));
    }
    let Some(Activity {
        task:
            Task {
                kind:
                    TaskKind::Use {
                        object,
                        interaction,
                    },
                ..
            },
        phase,
        ..
    }) = s.current()
    else {
        return Doing::NOTHING;
    };
    let Some(obj) = world.objects.get(*object as usize) else {
        return Doing::NOTHING;
    };
    let action = match phase {
        Phase::Using { .. } => world.content.objects[obj.def].interactions[*interaction].anim,
        _ => None,
    };
    Doing {
        object: *object as f32,
        action: action.map_or(-1.0, |a| a as f32),
        def: obj.def as f32,
        interaction: *interaction as f32,
    }
}

/// Writes the snapshot into `out`, which must hold at least `CAPACITY` floats.
pub fn write(world: &World, out: &mut [f32]) {
    out[header::TICK] = (world.tick % (1 << 24)) as f32;
    out[header::DAY] = clock::day(world.tick) as f32;
    out[header::MINUTE] = clock::minute_of_day(world.tick);
    out[header::SPEED] = world.speed as f32;
    out[header::SIM_COUNT] = world.sims.len() as f32;
    out[header::STRUCTURE_VERSION] = world.structure_version() as f32;
    out[header::CALM] = (world.auto_fast && world.speed > 0 && world.calm()) as u8 as f32;
    out[header::MAJOR_EVENT] = world
        .events
        .iter()
        .rev()
        .find(|e| e.kind.importance() >= 2)
        .map_or(0.0, |e| (e.id % (1 << 24)) as f32);
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
        o[sim::AWAY] = (s.away_until.is_some() || !s.here()) as u8 as f32;
        let doing = doing(world, s);
        o[sim::OBJECT] = doing.object;
        o[sim::ACTION] = doing.action;
        o[sim::OBJECT_DEF] = doing.def;
        o[sim::INTERACTION] = doing.interaction;
        o[sim::MOOD] = s.mood(&world.content);
        let thought = s.planner.thought.filter(|_| s.away_until.is_none());
        o[sim::THOUGHT] = thought.map_or(0.0, |t| t.kind as u8 as f32);
        o[sim::THOUGHT_SUBJECT] = thought.map_or(0.0, |t| t.subject as f32);
        o[sim::HEIGHT] = world.sim_height(s);
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
        let talk = world.content.talk_anim.map_or(-1.0, |a| a as f32);
        for (me, other, role) in [(i, t as usize, 1.0), (t as usize, i, 2.0)] {
            let o = &mut out[HEADER_LEN + me * SIM_STRIDE..HEADER_LEN + (me + 1) * SIM_STRIDE];
            o[sim::SOCIAL] = social as f32 + 1.0;
            o[sim::OUTCOME] = outcome;
            o[sim::PARTNER] = other as f32;
            o[sim::ANIM] = anim;
            o[sim::ROLE] = role;
            o[sim::ACTION] = talk;
        }
    }
}

/// The layout for the web side. `actions` (the content's animation tags) names the values
/// of `sim.action`.
pub fn layout_json(content: &Content) -> String {
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
            "calm": header::CALM, "majorEvent": header::MAJOR_EVENT,
        },
        "sim": {
            "id": sim::ID, "x": sim::X, "z": sim::Z, "yaw": sim::YAW,
            "pose": sim::POSE, "moving": sim::MOVING, "social": sim::SOCIAL,
            "outcome": sim::OUTCOME, "partner": sim::PARTNER, "anim": sim::ANIM, "emotion": sim::EMOTION,
            "role": sim::ROLE, "away": sim::AWAY, "object": sim::OBJECT, "action": sim::ACTION,
            "mood": sim::MOOD, "thought": sim::THOUGHT, "thoughtSubject": sim::THOUGHT_SUBJECT, "height": sim::HEIGHT,
            "objectDef": sim::OBJECT_DEF, "interaction": sim::INTERACTION,
        },
        "actions": content.animations,
    })
    .to_string()
}
