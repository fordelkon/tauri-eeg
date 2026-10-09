use super::{
    store,
    types::{Event, EventInput, Run},
};
use rusqlite::Connection;

pub fn validate(conn: &Connection, run: &Run, input: &EventInput) -> Result<(), String> {
    let name = input.event.as_str();
    if run.input.mode == "formal" && ["media_pause", "media_resume", "media_change"].contains(&name)
    {
        return Err(
            "Formal experiments use fixed material without pause, resume or replacement.".into(),
        );
    }
    let trial_events = [
        "baseline_rest_start",
        "hint_start",
        "post_rest_start",
        "sam_start",
        "sam_submit",
        "trial_start",
        "trial_end",
    ];
    let condition_events = [
        "music_regulation_start",
        "music_regulation_end",
        "video_regulation_start",
        "video_regulation_end",
        "natural_recovery_start",
        "natural_recovery_end",
        "pre_scale_start",
        "pre_scale_submit",
        "post_scale_start",
        "post_scale_submit",
    ];
    if (run.input.kind == "effect_evaluation" && trial_events.contains(&name))
        || (run.input.kind != "effect_evaluation" && condition_events.contains(&name))
    {
        return Err("Event is not allowed in this experiment kind.".into());
    }
    if (name.ends_with("video_start")
        || name == "music_regulation_start"
        || name == "video_regulation_start")
        && input
            .media_id
            .as_deref()
            .is_none_or(|id| id.trim().is_empty())
    {
        return Err("Media start requires a material ID.".into());
    }
    if run.input.kind == "effect_evaluation" {
        let expected = match name {
            "depression_video_start" => Some(("emotion", "depression")),
            "anxiety_video_start" => Some(("emotion", "anxiety")),
            "fear_video_start" => Some(("emotion", "fear")),
            "music_regulation_start" | "music_regulation_end" => Some(("method", "music")),
            "video_regulation_start" | "video_regulation_end" => Some(("method", "video")),
            _ => None,
        };
        if name == "calm_video_start" {
            return Err("Calm calibration is a separate paradigm.".into());
        }
        if let Some((field, expected)) = expected {
            let actual = if field == "emotion" {
                run.input.emotion.as_deref()
            } else {
                run.input.method.as_deref()
            };
            if actual != Some(expected) {
                return Err("Event conflicts with frozen run parameters.".into());
            }
        }
        if name.starts_with("natural_recovery_")
            && run.input.condition.as_deref() != Some("natural_recovery")
        {
            return Err("Run is not natural recovery.".into());
        }
        if name.contains("regulation_") && run.input.condition.as_deref() != Some("regulation") {
            return Err("Run has no regulation condition.".into());
        }
    }
    let previous: Vec<Event> = store::all(
        conn,
        "SELECT data FROM experiment_events WHERE run_id=?1 ORDER BY sequence",
        Some(&run.run_id),
    )?;
    if run.input.kind == "effect_evaluation" {
        let has = |event: &str| previous.iter().any(|e| e.input.event == event);
        if name.ends_with("video_start")
            && (has("induction_video_end")
                || previous
                    .iter()
                    .any(|e| e.input.event.ends_with("video_start")))
        {
            return Err("Induction was already presented or closed.".into());
        }
        let required = match name {
            "pre_scale_start" => Some("induction_video_end"),
            "music_regulation_start" | "video_regulation_start" | "natural_recovery_start" => {
                Some("pre_scale_submit")
            }
            _ => None,
        };
        if required.is_some_and(|event| !has(event)) {
            return Err("Event arrived before its preceding stage completed.".into());
        }
        if name == "post_scale_start"
            && ![
                "music_regulation_end",
                "video_regulation_end",
                "natural_recovery_end",
            ]
            .iter()
            .any(|event| has(event))
        {
            return Err("Post measurement requires the condition end.".into());
        }
    }
    let required = match name {
        "music_regulation_end" => Some("music_regulation_start"),
        "video_regulation_end" => Some("video_regulation_start"),
        "natural_recovery_end" => Some("natural_recovery_start"),
        "pre_scale_submit" => Some("pre_scale_start"),
        "post_scale_submit" => Some("post_scale_start"),
        "sam_submit" => Some("sam_start"),
        "trial_end" => Some("trial_start"),
        _ => None,
    };
    if let Some(required) = required {
        if !previous.iter().any(|e| {
            e.input.event == required && e.input.phase_instance_id == input.phase_instance_id
        }) {
            return Err("End or submit has no matching phase start.".into());
        }
    }
    if name == "induction_video_end"
        && !previous.iter().any(|e| {
            [
                "depression_video_start",
                "anxiety_video_start",
                "fear_video_start",
                "calm_video_start",
            ]
            .contains(&e.input.event.as_str())
                && e.input.phase_instance_id == input.phase_instance_id
        })
    {
        return Err("Induction end has no matching onset.".into());
    }
    if run.input.kind == "effect_evaluation"
        && name == "run_end"
        && !previous
            .iter()
            .any(|e| e.input.event == "post_scale_submit")
    {
        return Err("Complete post-measurement before finishing the experiment.".into());
    }
    Ok(())
}
