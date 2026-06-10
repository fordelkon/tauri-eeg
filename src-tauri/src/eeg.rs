use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

pub const EEG_SAMPLE_BLOCK_EVENT: &str = "eeg://sample-block";
pub const DEFAULT_SAMPLE_RATE_HZ: u32 = 500;
pub const DEFAULT_BLOCK_INTERVAL_MS: u64 = 50;

const DEFAULT_CHANNEL_IDS: [&str; 16] = [
    "fp1", "fp2", "f3", "f4", "c3", "c4", "p3", "p4", "o1", "o2", "f7", "f8", "t7", "t8", "p7",
    "p8",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStreamInfo {
    pub sample_rate_hz: u32,
    pub block_interval_ms: u64,
    pub channel_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegSampleBlockPayload {
    pub sequence: u64,
    pub sample_rate_hz: u32,
    pub started_at_ms: i64,
    pub channel_ids: Vec<String>,
    pub samples: Vec<Vec<f32>>,
    pub trigger_class: Option<u8>,
}

#[derive(Default)]
pub struct EegStreamState {
    worker: Mutex<Option<EegStreamWorker>>,
}

struct EegStreamWorker {
    stop_requested: Arc<AtomicBool>,
}

pub fn default_stream_info() -> EegStreamInfo {
    EegStreamInfo {
        sample_rate_hz: DEFAULT_SAMPLE_RATE_HZ,
        block_interval_ms: DEFAULT_BLOCK_INTERVAL_MS,
        channel_ids: DEFAULT_CHANNEL_IDS
            .iter()
            .map(|id| id.to_string())
            .collect(),
    }
}

pub fn create_simulated_eeg_block(
    sequence: u64,
    started_at_ms: i64,
    sample_rate_hz: u32,
    block_interval_ms: u64,
) -> Result<EegSampleBlockPayload, String> {
    if sample_rate_hz == 0 {
        return Err("EEG sample rate must be positive.".to_string());
    }
    if block_interval_ms == 0 {
        return Err("EEG block interval must be positive.".to_string());
    }

    let sample_count = ((sample_rate_hz as u64 * block_interval_ms) / 1_000).max(1) as usize;
    let mut samples = Vec::with_capacity(DEFAULT_CHANNEL_IDS.len());

    for channel_index in 0..DEFAULT_CHANNEL_IDS.len() {
        let mut channel_samples = Vec::with_capacity(sample_count);
        let alpha_hz = 8.0 + (channel_index % 5) as f32;
        let theta_hz = 4.0 + (channel_index % 3) as f32 * 0.5;
        let noise_phase = channel_index as f32 * 0.91 + sequence as f32 * 0.13;

        for sample_index in 0..sample_count {
            let absolute_index = sequence as f32 * sample_count as f32 + sample_index as f32;
            let t = absolute_index / sample_rate_hz as f32;
            let alpha = (2.0 * std::f32::consts::PI * alpha_hz * t).sin() * 28.0;
            let theta =
                (2.0 * std::f32::consts::PI * theta_hz * t + channel_index as f32).sin() * 12.0;
            let slow_drift =
                (2.0 * std::f32::consts::PI * 0.2 * t + channel_index as f32 * 0.2).sin() * 18.0;
            let line_noise = (2.0 * std::f32::consts::PI * 50.0 * t + noise_phase).sin() * 2.5;

            channel_samples.push(alpha + theta + slow_drift + line_noise);
        }

        samples.push(channel_samples);
    }

    Ok(EegSampleBlockPayload {
        sequence,
        sample_rate_hz,
        started_at_ms,
        channel_ids: DEFAULT_CHANNEL_IDS
            .iter()
            .map(|id| id.to_string())
            .collect(),
        samples,
        trigger_class: simulated_trigger_class(sequence),
    })
}

fn simulated_trigger_class(sequence: u64) -> Option<u8> {
    if sequence % 20 != 0 {
        return None;
    }

    if sequence == 0 {
        return Some(255);
    }

    Some((((sequence / 20) - 1) % 2 + 1) as u8)
}

pub fn start_stream(app: AppHandle, state: &EegStreamState) -> Result<EegStreamInfo, String> {
    let info = default_stream_info();
    let mut worker = state
        .worker
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;

    if worker.is_some() {
        return Ok(info);
    }

    let stop_requested = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop_requested);
    let thread_info = info.clone();

    thread::spawn(move || {
        let mut sequence = 0;

        while !stop_for_thread.load(Ordering::Relaxed) {
            let started_at_ms = current_time_ms();

            if let Ok(block) = create_simulated_eeg_block(
                sequence,
                started_at_ms,
                thread_info.sample_rate_hz,
                thread_info.block_interval_ms,
            ) {
                let _ = app.emit(EEG_SAMPLE_BLOCK_EVENT, block);
            }

            sequence += 1;
            thread::sleep(Duration::from_millis(thread_info.block_interval_ms));
        }
    });

    *worker = Some(EegStreamWorker { stop_requested });
    Ok(info)
}

pub fn stop_stream(state: &EegStreamState) -> Result<(), String> {
    let mut worker = state
        .worker
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;

    if let Some(worker) = worker.take() {
        worker.stop_requested.store(true, Ordering::Relaxed);
    }

    Ok(())
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_expected_sample_block_shape() {
        let block = create_simulated_eeg_block(7, 1_000, 500, 50).expect("create block");

        assert_eq!(block.sequence, 7);
        assert_eq!(block.sample_rate_hz, 500);
        assert_eq!(block.started_at_ms, 1_000);
        assert_eq!(block.channel_ids.len(), 16);
        assert_eq!(block.samples.len(), 16);
        assert_eq!(block.samples[0].len(), 25);
    }

    #[test]
    fn emits_start_trigger_then_sparse_two_class_triggers() {
        assert_eq!(
            create_simulated_eeg_block(0, 1_000, 500, 50)
                .expect("start trigger")
                .trigger_class,
            Some(255)
        );
        assert_eq!(
            create_simulated_eeg_block(19, 1_950, 500, 50)
                .expect("no trigger")
                .trigger_class,
            None
        );
        assert_eq!(
            create_simulated_eeg_block(20, 2_000, 500, 50)
                .expect("class one trigger")
                .trigger_class,
            Some(1)
        );
        assert_eq!(
            create_simulated_eeg_block(40, 3_000, 500, 50)
                .expect("class two trigger")
                .trigger_class,
            Some(2)
        );
    }

    #[test]
    fn creates_deterministic_samples_for_same_inputs() {
        let first = create_simulated_eeg_block(3, 2_000, 500, 50).expect("first block");
        let second = create_simulated_eeg_block(3, 2_000, 500, 50).expect("second block");

        assert_eq!(first.samples[0], second.samples[0]);
        assert_eq!(first.samples[5], second.samples[5]);
    }

    #[test]
    fn rejects_invalid_stream_settings() {
        assert_eq!(
            create_simulated_eeg_block(0, 0, 0, 50).unwrap_err(),
            "EEG sample rate must be positive."
        );
        assert_eq!(
            create_simulated_eeg_block(0, 0, 500, 0).unwrap_err(),
            "EEG block interval must be positive."
        );
    }
}
