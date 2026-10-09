//! Platform-independent simulation core.
//!
//! Rules for this crate:
//! - No rendering, browser, or asset-file knowledge. Visual data (models, icons,
//!   colours) is passed through as opaque strings at most.
//! - Deterministic: the same content, lot and seed always produce the same run.
//! - No allocation in the steady-state tick path where avoidable.

pub mod ai;
pub mod clock;
pub mod command;
pub mod content;
pub mod conversation;
pub mod error;
pub mod home;
pub mod life;
pub mod lot;
pub mod mesh;
pub mod pack;
pub mod path;
pub mod planner;
pub mod rng;
pub mod save;
pub mod snapshot;
pub mod social;
pub mod view;
pub mod world;

pub use command::Command;
pub use content::Content;
pub use error::Error;
pub use pack::merge_content;
pub use world::World;

/// Fixed simulation rate in ticks per real second (at 1× speed).
pub const TICKS_PER_SECOND: u32 = 20;
/// One game minute passes per real second at 1× speed.
pub const MINUTES_PER_TICK: f32 = 1.0 / TICKS_PER_SECOND as f32;
