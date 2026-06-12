pub const EEG_CHANNEL_COUNT: usize = 32;
pub const EEG_BYTES_PER_CHANNEL: usize = 3;
pub const EEG_DATA_LEN: usize = EEG_CHANNEL_COUNT * EEG_BYTES_PER_CHANNEL;
pub const EEG_START_BYTES: [u8; 2] = [0xA1, 0x05];
pub const TRIGGER_START_BYTES: [u8; 2] = [0xAA, 0x56];
pub const START_INSTRUCTION: [u8; 3] = [0xBB, 0x66, 0x01];
pub const FRAME_PREFIX_LEN: usize = 7;
pub const TRIGGER_DATA_LEN: usize = 3;
pub const SAMPLE_SCALE_UV: f32 = 0.02483;
pub const MAX_PADDED_PACKET_GAP: u32 = 256;

#[derive(Debug, Clone, PartialEq)]
pub enum ParsedFrame {
    Eeg {
        packet_index: u32,
        samples_uv: [f32; EEG_CHANNEL_COUNT],
    },
    Trigger {
        packet_index: u32,
        value: u8,
    },
}

pub struct ProtocolParser {
    buffer: Vec<u8>,
}

impl ProtocolParser {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push_bytes(&mut self, bytes: &[u8]) -> Vec<ParsedFrame> {
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();

        loop {
            let Some(header_index) = find_next_header(&self.buffer) else {
                keep_possible_partial_header(&mut self.buffer);
                break;
            };

            if header_index > 0 {
                self.buffer.drain(..header_index);
            }

            if self.buffer.len() < FRAME_PREFIX_LEN {
                break;
            }

            let is_eeg = self.buffer.starts_with(&EEG_START_BYTES);
            let frame_len = if is_eeg {
                FRAME_PREFIX_LEN + EEG_DATA_LEN
            } else {
                FRAME_PREFIX_LEN + TRIGGER_DATA_LEN
            };

            if self.buffer.len() < frame_len {
                break;
            }

            let reserved = self.buffer[2];
            let packet_index = u32::from_be_bytes([
                self.buffer[3],
                self.buffer[4],
                self.buffer[5],
                self.buffer[6],
            ]);
            let frame_bytes: Vec<u8> = self.buffer.drain(..frame_len).collect();

            if is_eeg {
                let mut samples_uv = [0.0_f32; EEG_CHANNEL_COUNT];
                let data = &frame_bytes[FRAME_PREFIX_LEN..];
                for (channel_index, chunk) in data.chunks_exact(EEG_BYTES_PER_CHANNEL).enumerate() {
                    samples_uv[channel_index] = decode_24_bit_sample_uv(chunk);
                }
                frames.push(ParsedFrame::Eeg {
                    packet_index,
                    samples_uv,
                });
            } else {
                frames.push(ParsedFrame::Trigger {
                    packet_index,
                    value: reserved,
                });
            }
        }

        frames
    }
}

fn find_next_header(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(2)
        .position(|window| window == EEG_START_BYTES || window == TRIGGER_START_BYTES)
}

fn keep_possible_partial_header(buffer: &mut Vec<u8>) {
    let keep_last = buffer
        .last()
        .copied()
        .filter(|byte| *byte == EEG_START_BYTES[0] || *byte == TRIGGER_START_BYTES[0]);
    buffer.clear();
    if let Some(byte) = keep_last {
        buffer.push(byte);
    }
}

fn decode_24_bit_sample_uv(bytes: &[u8]) -> f32 {
    let converted = [bytes[0] ^ 0x80, bytes[1], bytes[2]];
    let unsigned = u32::from_be_bytes([0, converted[0], converted[1], converted[2]]);
    (unsigned as i32 - 8_388_608) as f32 * SAMPLE_SCALE_UV
}

#[derive(Debug, Clone, PartialEq)]
pub enum PacketContinuity {
    First,
    Sequential,
    Duplicate,
    Missing(u32),
    Reset,
}

#[derive(Debug, Default)]
pub struct PacketLossTracker {
    last_packet_index: Option<u32>,
}

impl PacketLossTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, packet_index: u32) -> PacketContinuity {
        let Some(last) = self.last_packet_index else {
            self.last_packet_index = Some(packet_index);
            return PacketContinuity::First;
        };

        if packet_index == last {
            return PacketContinuity::Duplicate;
        }

        if packet_index == last.wrapping_add(1) {
            self.last_packet_index = Some(packet_index);
            return PacketContinuity::Sequential;
        }

        if packet_index > last {
            let gap = packet_index - last - 1;
            self.last_packet_index = Some(packet_index);
            if gap <= MAX_PADDED_PACKET_GAP {
                PacketContinuity::Missing(gap)
            } else {
                PacketContinuity::Reset
            }
        } else {
            self.last_packet_index = Some(packet_index);
            PacketContinuity::Reset
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eeg_frame(packet_index: u32, raw_by_channel: &[[u8; 3]; EEG_CHANNEL_COUNT]) -> Vec<u8> {
        let mut frame = Vec::with_capacity(FRAME_PREFIX_LEN + EEG_DATA_LEN);
        frame.extend_from_slice(&EEG_START_BYTES);
        frame.push(0);
        frame.extend_from_slice(&packet_index.to_be_bytes());
        for raw in raw_by_channel {
            frame.extend_from_slice(raw);
        }
        frame
    }

    fn trigger_frame(packet_index: u32, value: u8) -> Vec<u8> {
        let mut frame = Vec::with_capacity(FRAME_PREFIX_LEN + TRIGGER_DATA_LEN);
        frame.extend_from_slice(&TRIGGER_START_BYTES);
        frame.push(value);
        frame.extend_from_slice(&packet_index.to_be_bytes());
        frame.extend_from_slice(&[0, 0, 0]);
        frame
    }

    #[test]
    fn parses_eeg_frame_and_decodes_24_bit_samples() {
        let mut raw = [[0x00, 0x00, 0x00]; EEG_CHANNEL_COUNT];
        raw[0] = [0x00, 0x00, 0x00];
        raw[1] = [0x00, 0x00, 0x01];
        raw[2] = [0xFF, 0xFF, 0xFF];

        let mut parser = ProtocolParser::new();
        let frames = parser.push_bytes(&eeg_frame(42, &raw));

        assert_eq!(frames.len(), 1);
        match &frames[0] {
            ParsedFrame::Eeg {
                packet_index,
                samples_uv,
            } => {
                assert_eq!(*packet_index, 42);
                assert!((samples_uv[0] - 0.0).abs() < 0.0001);
                assert!((samples_uv[1] - SAMPLE_SCALE_UV).abs() < 0.0001);
                assert!((samples_uv[2] + SAMPLE_SCALE_UV).abs() < 0.0001);
            }
            other => panic!("expected EEG frame, got {other:?}"),
        }
    }

    #[test]
    fn parses_trigger_frame_value_from_reserved_byte() {
        let mut parser = ProtocolParser::new();
        let frames = parser.push_bytes(&trigger_frame(7, 3));

        assert_eq!(
            frames,
            vec![ParsedFrame::Trigger {
                packet_index: 7,
                value: 3
            }]
        );
    }

    #[test]
    fn skips_junk_before_valid_header() {
        let mut raw = [[0x00, 0x00, 0x00]; EEG_CHANNEL_COUNT];
        raw[0] = [0x00, 0x00, 0x01];
        let mut bytes = vec![0x00, 0x99, 0xA1, 0x00];
        bytes.extend_from_slice(&eeg_frame(2, &raw));

        let mut parser = ProtocolParser::new();
        let frames = parser.push_bytes(&bytes);

        assert_eq!(frames.len(), 1);
        assert!(matches!(
            frames[0],
            ParsedFrame::Eeg {
                packet_index: 2,
                ..
            }
        ));
    }

    #[test]
    fn waits_for_complete_frame_across_chunks() {
        let raw = [[0x00, 0x00, 0x00]; EEG_CHANNEL_COUNT];
        let bytes = eeg_frame(9, &raw);
        let split_at = 12;
        let mut parser = ProtocolParser::new();

        assert!(parser.push_bytes(&bytes[..split_at]).is_empty());
        let frames = parser.push_bytes(&bytes[split_at..]);

        assert_eq!(frames.len(), 1);
        assert!(matches!(
            frames[0],
            ParsedFrame::Eeg {
                packet_index: 9,
                ..
            }
        ));
    }

    #[test]
    fn tracks_first_sequential_duplicate_missing_and_reset_packets() {
        let mut tracker = PacketLossTracker::new();

        assert_eq!(tracker.observe(10), PacketContinuity::First);
        assert_eq!(tracker.observe(11), PacketContinuity::Sequential);
        assert_eq!(tracker.observe(11), PacketContinuity::Duplicate);
        assert_eq!(tracker.observe(14), PacketContinuity::Missing(2));
        assert_eq!(tracker.observe(10_000), PacketContinuity::Reset);
        assert_eq!(tracker.observe(10_001), PacketContinuity::Sequential);
    }
}
