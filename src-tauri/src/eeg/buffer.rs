use std::sync::OnceLock;

use super::protocol::EEG_CHANNEL_COUNT;

/// Low-frequency device lifecycle event (connect / disconnect / stream stop).
pub const EEG_STATUS_EVENT: &str = "eeg://status";

/// Binary sample-block wire format (little-endian):
/// - 0..4   u32 sequence
/// - 4..8   u32 sample rate (Hz)
/// - 8..16  u64 stream start time (ms since UNIX epoch)
/// - 16..18 u16 channel count
/// - 18..20 u16 sample count
/// - 20     u8 trigger present (0/1)
/// - 21     u8 trigger value
/// - 22..24 zero padding
/// - 24..   f32 x channel count x sample count, channel-major ([ch0 s0..sN][ch1 s0..sN]...)
pub const EEG_BLOCK_HEADER_BYTES: usize = 24;
const MAX_BLOCK_SAMPLES: usize = u16::MAX as usize;

pub fn default_channel_ids() -> Vec<String> {
    (1..=EEG_CHANNEL_COUNT)
        .map(|index| format!("ch{index:02}"))
        .collect()
}

/// Channel ids are immutable for the process lifetime; build them once.
pub fn shared_channel_ids() -> &'static [String] {
    static CHANNEL_IDS: OnceLock<Vec<String>> = OnceLock::new();
    CHANNEL_IDS.get_or_init(default_channel_ids)
}

fn encode_block(
    sequence: u64,
    sample_rate_hz: u32,
    started_at_ms: i64,
    samples: &[[f32; EEG_CHANNEL_COUNT]],
    trigger: Option<u8>,
) -> Vec<u8> {
    let channel_count = EEG_CHANNEL_COUNT.min(u16::MAX as usize) as u16;
    let sample_count = samples.len().min(MAX_BLOCK_SAMPLES) as u16;
    let mut bytes = Vec::with_capacity(EEG_BLOCK_HEADER_BYTES + 4 * channel_count as usize * sample_count as usize);
    bytes.extend_from_slice(&(sequence as u32).to_le_bytes());
    bytes.extend_from_slice(&sample_rate_hz.to_le_bytes());
    bytes.extend_from_slice(&(started_at_ms as u64).to_le_bytes());
    bytes.extend_from_slice(&channel_count.to_le_bytes());
    bytes.extend_from_slice(&sample_count.to_le_bytes());
    bytes.push(u8::from(trigger.is_some()));
    bytes.push(trigger.unwrap_or(0));
    bytes.extend_from_slice(&[0, 0]);
    for channel_index in 0..channel_count as usize {
        for sample in samples {
            bytes.extend_from_slice(&sample[channel_index].to_le_bytes());
        }
    }
    bytes
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
    ) -> Option<Vec<u8>> {
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

        let block = encode_block(
            self.sequence,
            self.sample_rate_hz,
            self.block_started_at_ms(sample_time_ms),
            &self.pending_samples,
            self.pending_trigger.take(),
        );
        self.pending_samples.clear();
        self.sequence += 1;
        Some(block)
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

    fn decode_header(block: &[u8]) -> (u32, u32, i64, u16, u16, Option<u8>) {
        assert!(block.len() >= EEG_BLOCK_HEADER_BYTES);
        (
            u32::from_le_bytes(block[0..4].try_into().expect("sequence")),
            u32::from_le_bytes(block[4..8].try_into().expect("rate")),
            u64::from_le_bytes(block[8..16].try_into().expect("start")) as i64,
            u16::from_le_bytes(block[16..18].try_into().expect("channels")),
            u16::from_le_bytes(block[18..20].try_into().expect("samples")),
            if block[20] == 0 {
                None
            } else {
                Some(block[21])
            },
        )
    }

    fn decode_sample(block: &[u8], channel: usize, index: usize, sample_count: usize) -> f32 {
        let offset = EEG_BLOCK_HEADER_BYTES + (channel * sample_count + index) * 4;
        f32::from_le_bytes(block[offset..offset + 4].try_into().expect("f32"))
    }

    #[test]
    fn default_channel_ids_are_ch01_to_ch32() {
        let ids = default_channel_ids();

        assert_eq!(ids.len(), 32);
        assert_eq!(ids[0], "ch01");
        assert_eq!(ids[15], "ch16");
        assert_eq!(ids[31], "ch32");
        assert_eq!(shared_channel_ids().len(), 32);
    }

    #[test]
    fn emits_binary_block_after_configured_sample_count() {
        let mut aggregator = RealtimeBlockAggregator::new(1000, 50).expect("aggregator");

        for index in 0..49 {
            assert!(aggregator
                .push_sample(sample(index as f32), None, 1_000 + index)
                .is_none());
        }
        let block = aggregator
            .push_sample(sample(49.0), Some(2), 1_049)
            .expect("block emitted");

        assert_eq!(
            block.len(),
            EEG_BLOCK_HEADER_BYTES + 32 * 50 * std::mem::size_of::<f32>()
        );
        assert_eq!(
            decode_header(&block),
            (0, 1000, 1_000, 32, 50, Some(2))
        );
        assert_eq!(decode_sample(&block, 0, 0, 50), 0.0);
        assert_eq!(decode_sample(&block, 5, 0, 50), 0.0);
        assert_eq!(decode_sample(&block, 0, 49, 50), 49.0);
        assert_eq!(decode_sample(&block, 31, 49, 50), 49.0);
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

        assert_eq!(decode_header(&first), (0, 2, 10, 32, 1, Some(5)));
        assert_eq!(decode_header(&second), (1, 2, 510, 32, 1, None));
    }

    #[test]
    fn starts_consecutive_blocks_from_sample_rate_when_reads_are_bursty() {
        let mut aggregator = RealtimeBlockAggregator::new(1000, 50).expect("aggregator");

        for index in 0..50 {
            assert_eq!(
                aggregator
                    .push_sample(sample(index as f32), None, 1_000)
                    .map(|block| decode_header(&block).2),
                if index == 49 { Some(1_000) } else { None }
            );
        }

        let mut second_started_at = None;
        for index in 0..50 {
            second_started_at = aggregator
                .push_sample(sample(index as f32), None, 1_001)
                .map(|block| decode_header(&block).2)
                .or(second_started_at);
        }

        assert_eq!(second_started_at, Some(1_050));
    }
}
