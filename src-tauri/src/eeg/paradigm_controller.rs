use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::sync::mpsc;

use chrono::Utc;
use serde_json::json;

use super::paradigm::{
    BeginEegTrialInput, FinalizeEegTrialInput, LabelSource, ParadigmInfo, TrialMarkKind,
    TrialMarkRecord, TrialQuality, TrialRecord, TrialSnapshot, TrialStatus, TriggerObservation,
};
use super::paradigm_rules::compute_acceptance;
use super::storage::RecordingMessage;

const TRIAL_END_TRIGGER_CODE: i32 = 255;

/// Trial state that is still mutable until finalize/interrupt freezes it.
#[derive(Debug)]
struct ActiveTrial {
    trial_index: u32,
    emotion: super::paradigm::ParadigmEmotion,
    trigger_class: u8,
    video_id: String,
    video_path: String,
    eeg_start_sample_index: u64,
    eeg_start_ts: String,
    eeg_end_sample_index: Option<u64>,
    eeg_end_ts: Option<String>,
    marks: Vec<TrialMarkRecord>,
    hardware_triggers: Vec<TriggerObservation>,
    trigger_start_ts: Option<String>,
    trigger_end_ts: Option<String>,
}

impl ActiveTrial {
    fn snapshot(&self) -> TrialSnapshot {
        TrialSnapshot {
            trial_index: self.trial_index,
            emotion: self.emotion,
            trigger_class: self.trigger_class,
            video_id: self.video_id.clone(),
            video_path: self.video_path.clone(),
            eeg_start_sample_index: self.eeg_start_sample_index,
            eeg_start_ts: self.eeg_start_ts.clone(),
            eeg_end_sample_index: self.eeg_end_sample_index,
            eeg_end_ts: self.eeg_end_ts.clone(),
            marks: self.marks.clone(),
            hardware_triggers: self.hardware_triggers.clone(),
            trigger_start_ts: self.trigger_start_ts.clone(),
            trigger_end_ts: self.trigger_end_ts.clone(),
        }
    }
}

/// Owns the paradigm state of one recording session: the active trial, the
/// finished trial records and the channel to the recording writer thread.
pub struct ParadigmController {
    info: ParadigmInfo,
    session_id: String,
    session_dir: String,
    sample_rate_hz: u32,
    channel_count: usize,
    active_trial: Option<ActiveTrial>,
    completed: Vec<TrialRecord>,
    sender: mpsc::Sender<RecordingMessage>,
    sample_count: Arc<AtomicU64>,
    trigger_observations: Arc<Mutex<Vec<TriggerObservation>>>,
}

impl ParadigmController {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        info: ParadigmInfo,
        session_id: String,
        session_dir: String,
        sample_rate_hz: u32,
        channel_count: usize,
        sender: mpsc::Sender<RecordingMessage>,
        sample_count: Arc<AtomicU64>,
        trigger_observations: Arc<Mutex<Vec<TriggerObservation>>>,
    ) -> Self {
        Self {
            info,
            session_id,
            session_dir,
            sample_rate_hz,
            channel_count,
            active_trial: None,
            completed: Vec::new(),
            sender,
            sample_count,
            trigger_observations,
        }
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn active_snapshot(&self) -> Option<TrialSnapshot> {
        self.active_trial.as_ref().map(|trial| trial.snapshot())
    }

    /// Emits the first trial-events.jsonl line right after recording start.
    pub fn emit_session_started(&self) {
        send_event(
            &self.sender,
            json!({
                "type": "session_started",
                "studySession": self.info.study_session,
                "subjectId": self.info.subject_id,
                "sessionRunId": self.info.session_run_id,
                "sessionId": self.session_id,
                "timestamp": Utc::now().to_rfc3339(),
            }),
        );
    }

    pub fn begin(&mut self, input: BeginEegTrialInput) -> Result<TrialSnapshot, String> {
        if let Some(trial) = self.active_trial.as_ref() {
            // Re-beginning the same trial (operator retry or a duplicated IPC
            // from a React StrictMode effect) replays the snapshot; a
            // different trial is a genuine conflict.
            if trial.trial_index == input.trial_index && trial.video_id == input.video_id {
                return Ok(trial.snapshot());
            }
            return Err("Another EEG trial is already active.".to_string());
        }

        let eeg_start_sample_index = self.sample_count.load(Ordering::Relaxed);
        let timestamp = Utc::now().to_rfc3339();
        let trial = ActiveTrial {
            trial_index: input.trial_index,
            emotion: input.emotion,
            trigger_class: input.emotion.trigger_code(),
            video_id: input.video_id.clone(),
            video_path: input.video_path.clone(),
            eeg_start_sample_index,
            eeg_start_ts: timestamp.clone(),
            eeg_end_sample_index: None,
            eeg_end_ts: None,
            marks: Vec::new(),
            hardware_triggers: Vec::new(),
            trigger_start_ts: None,
            trigger_end_ts: None,
        };

        send_event(
            &self.sender,
            json!({
                "type": "trial_started",
                "trialIndex": trial.trial_index,
                "emotion": trial.emotion,
                "triggerClass": trial.trigger_class,
                "videoId": input.video_id,
                "videoPath": input.video_path,
                "eegStartSampleIndex": eeg_start_sample_index,
                "eegStartTs": timestamp,
                "timestamp": timestamp,
            }),
        );

        self.active_trial = Some(trial);
        Ok(self
            .active_trial
            .as_ref()
            .expect("trial just stored")
            .snapshot())
    }

    pub fn mark(&mut self, mark: TrialMarkKind) -> Result<TrialSnapshot, String> {
        let Some(trial) = self.active_trial.as_mut() else {
            return Err("No EEG trial is active.".to_string());
        };

        let sample_index = self.sample_count.load(Ordering::Relaxed);
        let timestamp = Utc::now().to_rfc3339();
        trial.marks.push(TrialMarkRecord {
            mark,
            sample_index,
            timestamp: timestamp.clone(),
        });

        send_event(
            &self.sender,
            json!({
                "type": "mark",
                "trialIndex": trial.trial_index,
                "mark": mark,
                "sampleIndex": sample_index,
                "timestamp": timestamp,
            }),
        );
        Ok(trial.snapshot())
    }

    /// Freezes the EEG end of the active trial and captures the hardware
    /// trigger observations that fall inside its sample range.
    pub fn end(&mut self) -> Result<TrialSnapshot, String> {
        let Some(trial) = self.active_trial.as_mut() else {
            return Err("No EEG trial is active.".to_string());
        };
        if trial.eeg_end_sample_index.is_some() {
            return Ok(trial.snapshot());
        }

        let timestamp = Utc::now().to_rfc3339();
        let eeg_end_sample_index = self.sample_count.load(Ordering::Relaxed);
        let observations = self
            .trigger_observations
            .lock()
            .map(|observations| observations.clone())
            .unwrap_or_default();
        let hardware_triggers: Vec<TriggerObservation> = observations
            .into_iter()
            .filter(|observation| {
                observation.sample_index >= trial.eeg_start_sample_index
                    && observation.sample_index <= eeg_end_sample_index
            })
            .collect();

        let start_position = hardware_triggers
            .iter()
            .position(|observation| observation.code == trial.trigger_class as i32);
        let trigger_start_ts = start_position
            .map(|position| hardware_triggers[position].timestamp.clone());
        let trigger_end_ts = start_position.and_then(|position| {
            hardware_triggers[position + 1..]
                .iter()
                .find(|observation| observation.code == TRIAL_END_TRIGGER_CODE)
                .map(|observation| observation.timestamp.clone())
        });

        for observation in &hardware_triggers {
            send_event(
                &self.sender,
                json!({
                    "type": "hardware_trigger",
                    "trialIndex": trial.trial_index,
                    "code": observation.code,
                    "sampleIndex": observation.sample_index,
                    "timestamp": observation.timestamp,
                }),
            );
        }
        send_event(
            &self.sender,
            json!({
                "type": "trial_ended",
                "trialIndex": trial.trial_index,
                "eegEndSampleIndex": eeg_end_sample_index,
                "eegEndTs": timestamp,
                "triggerStartTs": trigger_start_ts,
                "triggerEndTs": trigger_end_ts,
                "timestamp": timestamp,
            }),
        );

        trial.eeg_end_sample_index = Some(eeg_end_sample_index);
        trial.eeg_end_ts = Some(timestamp);
        trial.hardware_triggers = hardware_triggers;
        trial.trigger_start_ts = trigger_start_ts;
        trial.trigger_end_ts = trigger_end_ts;
        Ok(trial.snapshot())
    }

    /// Applies the self-report / quality labels to the ended trial. Never
    /// extends the frozen EEG range.
    pub fn finalize(&mut self, input: FinalizeEegTrialInput) -> Result<TrialRecord, String> {
        if self.active_trial.is_none() {
            return Err("No EEG trial is active.".to_string());
        }
        if !self
            .active_trial
            .as_ref()
            .is_some_and(|trial| trial.eeg_end_sample_index.is_some())
        {
            return Err("End the EEG trial before submitting the self-report.".to_string());
        }

        let quality_label = input
            .quality
            .map(super::paradigm::FinalizeQualityInput::into_quality)
            .transpose()?;
        if let Some(report) = input.self_report {
            report.validate()?;
        }
        if input.self_report.is_none() && quality_label.is_none() {
            return Err("Provide a self-report or a quality label.".to_string());
        }

        let trial = self.active_trial.take().expect("trial checked above");
        let suggested = input
            .self_report
            .map(|report| compute_acceptance(trial.emotion, report.valence, report.arousal));
        let quality = if !input.artifact_flags.is_empty() {
            Some(TrialQuality::ArtifactRejected)
        } else {
            quality_label.or(suggested)
        };
        let label_source = input.label_source.unwrap_or_else(|| {
            if input.self_report.is_some() && quality != Some(TrialQuality::ArtifactRejected) {
                LabelSource::SelfReportConfirmed
            } else {
                LabelSource::InductionTarget
            }
        });

        let mut record = self.base_record(&trial, TrialStatus::Completed);
        record.self_report_valence = input.self_report.map(|report| report.valence);
        record.self_report_arousal = input.self_report.map(|report| report.arousal);
        record.self_report_dominance = input.self_report.and_then(|report| report.dominance);
        record.self_report_acceptance = suggested;
        record.quality = quality;
        record.label_source = Some(label_source);
        record.artifact_flags = input.artifact_flags;
        record.operator_notes = input.operator_notes;

        send_event(
            &self.sender,
            json!({
                "type": "trial_finalized",
                "trialIndex": trial.trial_index,
                "quality": record.quality,
                "timestamp": Utc::now().to_rfc3339(),
            }),
        );
        send_record(&self.sender, &record);
        self.completed.push(record.clone());
        Ok(record)
    }

    /// Stops the active trial without labels because the session is ending.
    pub fn interrupt(&mut self) -> Option<TrialRecord> {
        let trial = self.active_trial.take()?;
        let record = self.base_record(&trial, TrialStatus::Interrupted);

        send_event(
            &self.sender,
            json!({
                "type": "trial_interrupted",
                "trialIndex": trial.trial_index,
                "timestamp": Utc::now().to_rfc3339(),
            }),
        );
        send_record(&self.sender, &record);
        self.completed.push(record.clone());
        Some(record)
    }

    pub fn take_all(&mut self) -> Vec<TrialRecord> {
        std::mem::take(&mut self.completed)
    }

    fn base_record(&self, trial: &ActiveTrial, status: TrialStatus) -> TrialRecord {
        TrialRecord {
            trial_id: TrialRecord::trial_id_for(&self.info.session_run_id, trial.trial_index),
            session_id: self.session_id.clone(),
            subject_id: self.info.subject_id.clone(),
            session_run_id: self.info.session_run_id.clone(),
            study_session: self.info.study_session,
            trial_index: trial.trial_index,
            status,
            phase: self.info.study_session.as_str().to_string(),
            paradigm_emotion: trial.emotion,
            system_emotion: None,
            trigger_class: trial.trigger_class,
            video_id: trial.video_id.clone(),
            video_path: trial.video_path.clone(),
            trigger_start_ts: trial.trigger_start_ts.clone(),
            trigger_end_ts: trial.trigger_end_ts.clone(),
            eeg_start_ts: trial.eeg_start_ts.clone(),
            eeg_end_ts: trial.eeg_end_ts.clone(),
            eeg_start_sample_index: trial.eeg_start_sample_index,
            eeg_end_sample_index: trial.eeg_end_sample_index,
            sample_rate_hz: self.sample_rate_hz,
            channel_count: self.channel_count,
            recording_path: self.session_dir.clone(),
            self_report_valence: None,
            self_report_arousal: None,
            self_report_dominance: None,
            self_report_acceptance: None,
            quality: None,
            label_source: None,
            artifact_flags: Vec::new(),
            operator_notes: None,
            created_at: Utc::now().to_rfc3339(),
        }
    }
}

fn send_event(sender: &mpsc::Sender<RecordingMessage>, event: serde_json::Value) {
    if let Ok(line) = serde_json::to_string(&event) {
        let _ = sender.send(RecordingMessage::TrialEvent(line));
    }
}

fn send_record(sender: &mpsc::Sender<RecordingMessage>, record: &TrialRecord) {
    if let Ok(line) = serde_json::to_string(record) {
        let _ = sender.send(RecordingMessage::TrialRecord(line));
    }
}

fn lock_runtime(
    state: &super::EegStreamState,
) -> Result<std::sync::MutexGuard<'_, super::EegRuntime>, String> {
    state
        .inner
        .runtime
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())
}

fn require_controller(
    runtime: &mut super::EegRuntime,
) -> Result<&mut ParadigmController, String> {
    if runtime.recording.is_none() {
        return Err("Start an EEG recording before running paradigm trials.".to_string());
    }
    runtime
        .paradigm
        .as_mut()
        .ok_or_else(|| "The active EEG recording is not a paradigm session.".to_string())
}

pub fn begin_eeg_trial(
    state: &super::EegStreamState,
    input: BeginEegTrialInput,
) -> Result<TrialSnapshot, String> {
    let mut runtime = lock_runtime(state)?;
    require_controller(&mut runtime)?.begin(input)
}

pub fn mark_eeg_trial(
    state: &super::EegStreamState,
    input: super::paradigm::MarkEegTrialInput,
) -> Result<TrialSnapshot, String> {
    let mut runtime = lock_runtime(state)?;
    require_controller(&mut runtime)?.mark(input.mark)
}

pub fn end_eeg_trial(state: &super::EegStreamState) -> Result<TrialSnapshot, String> {
    let mut runtime = lock_runtime(state)?;
    require_controller(&mut runtime)?.end()
}

pub fn finalize_eeg_trial(
    state: &super::EegStreamState,
    input: FinalizeEegTrialInput,
) -> Result<TrialRecord, String> {
    let mut runtime = lock_runtime(state)?;
    require_controller(&mut runtime)?.finalize(input)
}

pub fn get_active_paradigm_trial(
    state: &super::EegStreamState,
) -> Result<Option<TrialSnapshot>, String> {
    let runtime = lock_runtime(state)?;
    Ok(runtime
        .paradigm
        .as_ref()
        .and_then(|controller| controller.active_snapshot()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eeg::EegRuntime;

    #[test]
    fn trial_commands_require_a_recording_first() {
        let state = crate::eeg::EegStreamState::default();
        let error = begin_eeg_trial(
            &state,
            BeginEegTrialInput {
                trial_index: 0,
                emotion: super::super::paradigm::ParadigmEmotion::Calm,
                video_id: "calm_a".to_string(),
                video_path: "X:/videos/calm_a.mp4".to_string(),
            },
        )
        .expect_err("no recording");

        assert_eq!(
            error,
            "Start an EEG recording before running paradigm trials."
        );
    }

    #[test]
    fn runtime_default_has_no_paradigm_controller() {
        let runtime = EegRuntime::default();
        assert!(runtime.paradigm.is_none());
        assert!(runtime.recording.is_none());
    }

    #[test]
    fn begin_replays_the_same_trial_but_rejects_a_conflicting_one() {
        let (sender, _receiver) = mpsc::channel();
        let mut controller = ParadigmController::new(
            ParadigmInfo {
                study_session: super::super::paradigm::ParadigmSessionKind::PersonalCalibration,
                subject_id: "subject-1".to_string(),
                session_run_id: "run-1".to_string(),
            },
            "session".to_string(),
            "dir".to_string(),
            1000,
            32,
            sender,
            Arc::new(AtomicU64::new(0)),
            Arc::new(Mutex::new(Vec::new())),
        );

        let make_input = |trial_index: u32, video_id: &str| BeginEegTrialInput {
            trial_index,
            emotion: super::super::paradigm::ParadigmEmotion::Happy,
            video_id: video_id.to_string(),
            video_path: format!("X:/videos/{video_id}.mp4"),
        };

        let first = controller
            .begin(make_input(3, "happy_a"))
            .expect("first begin");
        let replay = controller
            .begin(make_input(3, "happy_a"))
            .expect("idempotent replay");
        assert_eq!(first.trial_index, replay.trial_index);
        assert_eq!(first.eeg_start_sample_index, replay.eeg_start_sample_index);

        let conflict = controller
            .begin(make_input(4, "calm_a"))
            .expect_err("different trial conflicts");
        assert_eq!(conflict, "Another EEG trial is already active.");
    }
}
