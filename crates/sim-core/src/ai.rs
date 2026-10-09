//! Utility AI: objects advertise need gains; Sims score them against their current needs.

use crate::content::{Interaction, MAX_NEEDS};

/// How strongly a need at `value` (0 = empty, 1 = full) pulls a Sim. Low needs dominate.
pub fn need_weight(value: f32) -> f32 {
    let deficit = (1.0 - value).clamp(0.0, 1.0);
    deficit * deficit * 3.0 + deficit * 0.5
}

/// Attractiveness of an interaction for a Sim with `needs`, `distance` metres away.
pub fn score(needs: &[f32], interaction: &Interaction, distance: f32) -> f32 {
    score_gains(needs, &interaction.total_gain, distance)
}

/// Attractiveness of total need gains `gains`, `distance` metres away.
pub fn score_gains(needs: &[f32], gains: &[f32; MAX_NEEDS], distance: f32) -> f32 {
    let mut s = 0.0;
    for (i, &value) in needs.iter().enumerate() {
        let gain = gains[i].min(1.0 - value).max(0.0);
        s += gain * need_weight(value);
    }
    s / (1.0 + distance * 0.08)
}

/// Picks among the best candidates with weighted randomness, so Sims are not robotic.
/// `candidates` are `(score, payload)`; returns the chosen payload.
pub fn choose<T: Copy>(candidates: &mut [(f32, T)], roll: f32, top_n: usize) -> Option<T> {
    candidates.sort_unstable_by(|a, b| b.0.total_cmp(&a.0));
    let top = &candidates[..candidates.len().min(top_n)];
    let total: f32 = top.iter().map(|c| c.0).sum();
    if total <= 0.0 {
        return None;
    }
    let mut pick = roll * total;
    for c in top {
        if pick < c.0 {
            return Some(c.1);
        }
        pick -= c.0;
    }
    top.last().map(|c| c.1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::Pose;

    fn interaction(need: usize, gain: f32) -> Interaction {
        let mut total_gain = [0.0; MAX_NEEDS];
        total_gain[need] = gain;
        Interaction {
            id: "x".into(),
            label: "x".into(),
            minutes: 10.0,
            total_gain,
            gain_per_minute: total_gain.map(|g| g / 10.0),
            pose: Pose::Stand,
            autonomous: true,
            tags: 0,
            skill_gain: [0.0; crate::content::MAX_SKILLS],
            cost: 0,
            skill: None,
            feeling: None,
            feeling_min_skill: 0.0,
            anim: None,
            dirt: 0.0,
            baby: false,
            care: [0.0; MAX_NEEDS],
        }
    }

    #[test]
    fn low_need_beats_high_need() {
        let needs = [0.1, 0.9];
        assert!(
            score(&needs, &interaction(0, 0.5), 5.0) > score(&needs, &interaction(1, 0.5), 5.0)
        );
    }

    #[test]
    fn closer_is_better() {
        let needs = [0.3];
        assert!(
            score(&needs, &interaction(0, 0.5), 1.0) > score(&needs, &interaction(0, 0.5), 20.0)
        );
    }

    #[test]
    fn choose_respects_top_n() {
        let mut c = [(0.1, 'a'), (5.0, 'b'), (0.2, 'c')];
        assert_eq!(choose(&mut c, 0.99, 1), Some('b'));
    }
}
