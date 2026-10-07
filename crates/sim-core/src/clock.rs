use crate::MINUTES_PER_TICK;

/// Game starts on day 1 at 08:00.
const START_MINUTE: f64 = 8.0 * 60.0;
const MINUTES_PER_DAY: f64 = 24.0 * 60.0;

/// Ticks simulated per real step (one step = 1 / TICKS_PER_SECOND seconds) for each speed.
pub const TICKS_PER_STEP: [u32; 4] = [0, 1, 3, 10];
pub const MAX_SPEED: u8 = 3;

pub fn total_minutes(tick: u64) -> f64 {
    START_MINUTE + tick as f64 * MINUTES_PER_TICK as f64
}

/// Day number, starting at 1.
pub fn day(tick: u64) -> u32 {
    (total_minutes(tick) / MINUTES_PER_DAY) as u32 + 1
}

/// Day of the week, 0 = Monday (day 1 is a Monday).
pub fn weekday(day: u32) -> u32 {
    (day.max(1) - 1) % 7
}

/// Hour within the current day, `[0, 24)`.
pub fn hour(tick: u64) -> f32 {
    minute_of_day(tick) / 60.0
}

/// The tick at which `day` reaches `minute` (None if that is before the game started).
pub fn tick_at(day: u32, minute: f32) -> Option<u64> {
    let total = (day.max(1) - 1) as f64 * MINUTES_PER_DAY + minute as f64 - START_MINUTE;
    (total >= 0.0).then(|| (total / MINUTES_PER_TICK as f64).round() as u64)
}

/// Minute within the current day, `[0, 1440)`.
pub fn minute_of_day(tick: u64) -> f32 {
    (total_minutes(tick) % MINUTES_PER_DAY) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_at_eight_on_day_one() {
        assert_eq!(day(0), 1);
        assert_eq!(minute_of_day(0), 480.0);
    }

    #[test]
    fn weekdays_and_tick_lookup() {
        assert_eq!(weekday(1), 0);
        assert_eq!(weekday(8), 0);
        assert_eq!(weekday(7), 6);
        let t = tick_at(2, 9.0 * 60.0).unwrap();
        assert_eq!(day(t), 2);
        assert!((minute_of_day(t) - 540.0).abs() < 0.01);
        assert_eq!(tick_at(1, 60.0), None, "01:00 on day 1 is before the start");
    }

    #[test]
    fn rolls_over_midnight() {
        let ticks_to_midnight = (16.0 * 60.0 / MINUTES_PER_TICK) as u64;
        assert_eq!(day(ticks_to_midnight), 2);
        assert!(minute_of_day(ticks_to_midnight) < 0.01);
    }
}
