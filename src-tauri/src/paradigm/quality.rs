use super::domain::{ParadigmEmotion, TrialQuality, PARADIGM_EMOTIONS};
/// Suggested trial quality from the self-report scores. Mirrors the frontend
/// acceptance map; the decision order matters (own region, own boundary, other
/// region, hard rejects, then uncertain).
pub fn compute_acceptance(emotion: ParadigmEmotion, valence: u8, arousal: u8) -> TrialQuality {
    let (v, a) = (valence as i32, arousal as i32);

    if in_class_region(emotion, v, a) {
        return TrialQuality::Accepted;
    }

    if near_class_boundary(emotion, v, a) {
        return TrialQuality::Uncertain;
    }

    let in_other_region = PARADIGM_EMOTIONS
        .iter()
        .any(|other| *other != emotion && in_class_region(*other, v, a));
    if in_other_region {
        return TrialQuality::Rejected;
    }

    if hard_reject(emotion, v, a) {
        return TrialQuality::Rejected;
    }

    TrialQuality::Uncertain
}

fn in_class_region(emotion: ParadigmEmotion, v: i32, a: i32) -> bool {
    match emotion {
        ParadigmEmotion::Depression => v <= 4 && a <= 5,
        ParadigmEmotion::Anxiety => v <= 4 && a >= 6,
        ParadigmEmotion::Calm => v >= 5 && a <= 4,
        // Provisional fear region (negative valence + high arousal, more
        // extreme than anxiety to keep the classes separable; 研究组可调的临
        // 时口径): v <= 3 && a >= 7.
        ParadigmEmotion::Fear => v <= 3 && a >= 7,
    }
}

fn near_class_boundary(emotion: ParadigmEmotion, v: i32, a: i32) -> bool {
    match emotion {
        ParadigmEmotion::Depression => (v <= 4 && a == 6) || (v == 5 && a <= 5),
        ParadigmEmotion::Anxiety => (v <= 4 && a == 5) || (v == 5 && a >= 6),
        ParadigmEmotion::Calm => (v == 4 && a <= 4) || (v >= 5 && a == 5),
        // Provisional fear boundary (研究组可调的临时口径).
        ParadigmEmotion::Fear => (v <= 3 && a == 6) || (v == 4 && a >= 7),
    }
}

fn hard_reject(emotion: ParadigmEmotion, v: i32, a: i32) -> bool {
    match emotion {
        ParadigmEmotion::Depression => v >= 7,
        ParadigmEmotion::Anxiety => false,
        ParadigmEmotion::Calm => a >= 6 || v <= 3,
        // Provisional fear hard reject (研究组可调的临时口径): clearly
        // positive valence is incompatible with a fear induction.
        ParadigmEmotion::Fear => v >= 7,
    }
}



