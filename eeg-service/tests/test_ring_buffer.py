from __future__ import annotations

import time

import numpy as np
import pytest

from core.ring_buffer import RingBuffer


def test_push_and_latest_window():
    buffer = RingBuffer(channels=3, sfreq=10.0, capacity_seconds=5.0)
    assert buffer.latest(1.0) is None  # nothing pushed yet

    first = np.arange(30, dtype=np.float64).reshape(10, 3)
    buffer.push(first, end_timestamp=1.0)
    window = buffer.latest(1.0)
    assert window is not None
    np.testing.assert_array_equal(window, first)

    second = np.ones((5, 3)) * 99.0
    buffer.push(second, end_timestamp=1.5)
    window = buffer.latest(1.0)
    np.testing.assert_array_equal(window, np.vstack([first[-5:], second]))
    assert buffer.last_timestamp == 1.5
    assert buffer.seconds_available() == pytest.approx(1.5)


def test_ring_wraparound_preserves_order():
    sfreq = 10.0
    buffer = RingBuffer(channels=1, sfreq=sfreq, capacity_seconds=2.0)
    total = np.arange(70, dtype=np.float64).reshape(70, 1)
    # Push in irregular blocks so both the exact-fit and remainder paths run.
    buffer.push(total[:25], end_timestamp=2.5)
    buffer.push(total[25:60], end_timestamp=6.0)
    buffer.push(total[60:], end_timestamp=7.0)

    # Only the last capacity samples survive the wrap.
    window = buffer.latest(2.0)
    np.testing.assert_array_equal(window, total[-20:])

    # A window that starts before the wrap must stitch tail + head correctly.
    skip = 5
    stitched = buffer._slice_from_end(skip, 12)
    np.testing.assert_array_equal(stitched, total[-(skip + 12):-skip])


def test_recent_windows_are_disjoint_and_anchored():
    sfreq = 10.0
    buffer = RingBuffer(channels=1, sfreq=sfreq, capacity_seconds=10.0)
    data = np.arange(100, dtype=np.float64).reshape(100, 1)
    end_ts = 12.0
    buffer.push(data, end_timestamp=end_ts)

    windows = buffer.recent_windows(2.0, count=4, step_seconds=2.0)
    assert len(windows) == 4
    values = [w[0].ravel()[0] for w, _ in windows]
    stamps = [ts for _, ts in windows]
    # Newest first, step back by one window each time.
    assert values == [80, 60, 40, 20]
    assert stamps == [end_ts, 10.0, 8.0, 6.0]

    # Anchoring at an older timestamp walks windows inside that range only:
    # end ts 6.0 -> samples 20..39, end ts 4.0 -> samples 0..19.
    anchored = buffer.recent_windows(
        2.0, count=2, step_seconds=2.0, max_end_timestamp=6.0, min_end_timestamp=4.0
    )
    assert [ts for _, ts in anchored] == [6.0, 4.0]
    assert anchored[0][0].ravel()[0] == 20
    assert anchored[1][0].ravel()[0] == 0


def test_push_rejects_wrong_shape():
    buffer = RingBuffer(channels=2, sfreq=10.0, capacity_seconds=1.0)
    with pytest.raises(ValueError):
        buffer.push(np.zeros((4, 3)), end_timestamp=0.0)


def test_oversized_block_keeps_only_capacity():
    buffer = RingBuffer(channels=1, sfreq=10.0, capacity_seconds=1.0)
    data = np.arange(50, dtype=np.float64).reshape(50, 1)
    buffer.push(data, end_timestamp=5.0)
    np.testing.assert_array_equal(buffer.latest(1.0), data[-10:])
    assert buffer.total_samples == 50
