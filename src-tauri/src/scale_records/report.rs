use super::{EffectHistoryEntry, DEQ_ITEMS};
use chrono::Utc;

/// Quotes a CSV field when it contains a separator, quote, or line break;
/// embedded quotes are doubled per RFC 4180.
pub(crate) fn csv_field(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

pub(crate) const CSV_BOM: &str = "\u{FEFF}";

pub fn build_batch_effect_report_csv(entries: &[EffectHistoryEntry]) -> String {
    let mut header = "subject_id,emotion,condition,duration_minutes,regulation_skipped,run_id,baseline_created_at,post_created_at,exported_at,scale_id".to_string();
    for (dimension, _) in DEQ_ITEMS {
        header.push_str(&format!(
            ",{dimension}_induction_change,{dimension}_condition_change"
        ));
    }
    let exported_at = Utc::now().to_rfc3339();
    let mut lines = vec![header];
    for entry in entries {
        let mut fields = vec![
            csv_field(&entry.subject_id),
            csv_field(entry.emotion.as_deref().unwrap_or_default()),
            csv_field(entry.condition.as_deref().unwrap_or_default()),
            entry
                .duration_minutes
                .map(|v| v.to_string())
                .unwrap_or_default(),
            entry.regulation_skipped.to_string(),
            csv_field(&entry.experiment_run_id),
            csv_field(&entry.baseline_created_at),
            csv_field(&entry.post_created_at),
            csv_field(&exported_at),
            csv_field(&entry.scale_id),
        ];
        for change in &entry.emotion_changes {
            fields.push(change.induction_change.to_string());
            fields.push(change.condition_change.to_string());
        }
        lines.push(fields.join(","));
    }
    format!("{CSV_BOM}{}", lines.join("\r\n"))
}
