use serde::Serialize;

use super::protocol::EEG_CHANNEL_COUNT;

pub const EEG_SAMPLE_BLOCK_EVENT: &str = "eeg://sample-block";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EegSampleBlockPayload {
    pub sequence: u64,
    pub sample_rate_hz: u32,
    pub started_at_ms: i64,
    pub channel_ids: Vec<String>,
    pub samples: Vec<Vec<f32>>,
    pub trigger_class: Option<u8>,
}

pub fn default_channel_ids() -> Vec<String> {
    (1..=EEG_CHANNEL_COUNT)
        .map(|index| format!("ch{index:02}"))
        .collect()
}

pub struct RealtimeBlockAggregator {
    sample_rate_hz: u32,
    block_interval_ms: u64,
    sequence: u64,
    stream_started_at_ms: Option<i64>,
    pending_samples: Vec<[f32; EEG_CHANNEL_COUNT]>,
    pending_trigger: Option<u8>,
}

impl RealtimeBlockAggregator {
    pub fn new(sample_rate_hz: u32, block_interval_ms: u64) -> Result<Self, String> {
        if sample_rate_hz == 0 {
            return Err("EEG sample rate must be positive.".to_string());
        }
        if block_interval_ms == 0 {
            return Err("EEG block interval must be positive.".to_string());
        }
        Ok(Self {
            sample_rate_hz,
            block_interval_ms,
            sequence: 0,
            stream_started_at_ms: None,
            pending_samples: Vec::new(),
            pending_trigger: None,
        })
    }

    pub fn push_sample(
        &mut self,
        sample: [f32; EEG_CHANNEL_COUNT],
        trigger: Option<u8>,
        sample_time_ms: i64,
    ) -> Option<EegSampleBlockPayload> {
        if self.stream_started_at_ms.is_none() {
            self.stream_started_at_ms = Some(sample_time_ms);
        }
        if let Some(trigger) = trigger.filter(|value| *value != 0) {
            self.pending_trigger = Some(trigger);
        }

        self.pending_samples.push(sample);

        if self.pending_samples.len() < self.samples_per_block() {
            return None;
        }

        let mut samples = vec![Vec::with_capacity(self.pending_samples.len()); EEG_CHANNEL_COUNT];
        for sample in self.pending_samples.drain(..) {
            for channel_index in 0..EEG_CHANNEL_COUNT {
                samples[channel_index].push(sample[channel_index]);
            }
        }

        let payload = EegSampleBlockPayload {
            sequence: self.sequence,
            sample_rate_hz: self.sample_rate_hz,
            started_at_ms: self.block_started_at_ms(sample_time_ms),
            channel_ids: default_channel_ids(),
            samples,
            trigger_class: self.pending_trigger.take(),
        };
        self.sequence += 1;
        Some(payload)
    }

    fn block_started_at_ms(&self, fallback_time_ms: i64) -> i64 {
        let stream_started_at_ms = self.stream_started_at_ms.unwrap_or(fallback_time_ms);
        let emitted_sample_count = self.sequence * self.samples_per_block() as u64;
        let elapsed_ms =
            (emitted_sample_count as f64 * 1_000.0 / self.sample_rate_hz as f64).round() as i64;
        stream_started_at_ms + elapsed_ms
    }

    fn samples_per_block(&self) -> usize {
        ((self.sample_rate_hz as u64 * self.block_interval_ms) / 1_000).max(1) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(value: f32) -> [f32; EEG_CHANNEL_COUNT] {
        [value; EEG_CHANNEL_COUNT]
    }

    #[test]
    fn default_channel_ids_are_ch01_to_ch32() {
        let ids = default_channel_ids();

        assert_eq!(ids.len(), 32);
        assert_eq!(ids[0], "ch01");
        assert_eq!(ids[15], "ch16");
        assert_eq!(ids[31], "ch32");
    }

    #[test]
    fn emits_block_after_configured_sample_count() {
        let mut aggregator = RealtimeBlockAggregator::new(1000, 50).expect("aggregator");

        for index in 0..49 {
            assert!(aggregator
                .push_sample(sample(index as f32), None, 1_000 + index)
                .is_none());
        }
        let block = aggregator
            .push_sample(sample(49.0), Some(2), 1_049)
            .expect("block emitted");

        assert_eq!(block.sequence, 0);
        assert_eq!(block.sample_rate_hz, 1000);
        assert_eq!(block.started_at_ms, 1_000);
        assert_eq!(block.channel_ids.len(), 32);
        assert_eq!(block.samples.len(), 32);
        assert_eq!(block.samples[0].len(), 50);
        assert_eq!(block.samples[0][0], 0.0);
        assert_eq!(block.samples[0][49], 49.0);
        assert_eq!(block.trigger_class, Some(2));
    }

    #[test]
    fn increments_sequence_and_clears_trigger_after_emit() {
        let mut aggregator = RealtimeBlockAggregator::new(2, 500).expect("aggregator");

        let first = aggregator
            .push_sample(sample(1.0), Some(5), 10)
            .expect("first");
        let second = aggregator
            .push_sample(sample(2.0), None, 510)
            .expect("second");

        assert_eq!(first.sequence, 0);
        assert_eq!(first.trigger_class, Some(5));
        assert_eq!(second.sequence, 1);
        assert_eq!(second.trigger_class, None);
        assert_eq!(second.started_at_ms, 510);
    }

    #[test]
    fn starts_consecutive_blocks_from_sample_rate_when_reads_are_bursty() {
        let mut aggregator = RealtimeBlockAggregator::new(1000, 50).expect("aggregator");

        for index in 0..50 {
            assert_eq!(
                aggregator
                    .push_sample(sample(index as f32), None, 1_000)
                    .map(|block| block.started_at_ms),
                if index == 49 { Some(1_000) } else { None }
            );
        }

        let mut second_started_at = None;
        for index in 0..50 {
            second_started_at = aggregator
                .push_sample(sample(index as f32), None, 1_001)
                .map(|block| block.started_at_ms)
                .or(second_started_at);
        }

        assert_eq!(second_started_at, Some(1_050));
    }
}
