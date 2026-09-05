"""Fixed-capacity ring buffer for streaming EEG blocks.

The buffer is not internally synchronized: the service serializes every
access through one lock (uvicorn runs a single worker), so extra locking
here would only hide the actual concurrency contract.
"""
from __future__ import annotations

import numpy as np


class RingBuffer:
    """Stores the most recent ``capacity_seconds`` of n x channels samples."""

    def __init__(self, channels: int, sfreq: float, capacity_seconds: float) -> None:
        if channels < 1:
            raise ValueError("channels must be >= 1")
        if sfreq <= 0:
            raise ValueError("sfreq must be positive")
        if capacity_seconds <= 0:
            raise ValueError("capacity_seconds must be positive")

        self.channels = int(channels)
        self.sfreq = float(sfreq)
        self.capacity = max(1, int(round(capacity_seconds * self.sfreq)))
        # Kept as float64: scipy filters and Welch expect double precision.
        self._data = np.zeros((self.capacity, self.channels), dtype=np.float64)
        self._write_pos = 0          # next slot to overwrite
        self._total_samples = 0      # samples ever pushed
        self._last_timestamp = 0.0   # timestamp of the newest sample

    @property
    def total_samples(self) -> int:
        return self._total_samples

    @property
    def last_timestamp(self) -> float:
        return self._last_timestamp

    def seconds_available(self) -> float:
        return min(self._total_samples, self.capacity) / self.sfreq

    def clear(self) -> None:
        self._write_pos = 0
        self._total_samples = 0
        self._last_timestamp = 0.0

    def push(self, block: np.ndarray, end_timestamp: float) -> None:
        """Append a (n, channels) block; ``end_timestamp`` stamps the newest sample.

        Samples are assumed uniformly spaced at 1/sfreq, which holds for LSL
        EEG outlets and for the simulator; gaps would distort window slicing.
        """
        block = np.asarray(block, dtype=np.float64)
        if block.ndim != 2 or block.shape[1] != self.channels:
            raise ValueError(f"block must be (n, {self.channels}), got {block.shape}")
        if len(block) == 0:
            return

        n = len(block)
        self._last_timestamp = float(end_timestamp)
        self._total_samples += n
        if n >= self.capacity:
            self._data[:] = block[-self.capacity:]
            self._write_pos = 0
            return

        first = self._write_pos
        remainder = first + n - self.capacity
        if remainder <= 0:
            self._data[first:first + n] = block
            self._write_pos = first + n
        else:
            self._data[first:] = block[:n - remainder]
            self._data[:remainder] = block[n - remainder:]
            self._write_pos = remainder

    def latest(self, seconds: float) -> np.ndarray | None:
        """Most recent ``seconds`` of data, or None when not yet available."""
        n = int(round(seconds * self.sfreq))
        if n <= 0 or n > min(self._total_samples, self.capacity):
            return None
        return self._slice_from_end(0, n)

    def _slice_from_end(self, skip: int, n: int) -> np.ndarray:
        """Copy ``n`` samples ending ``skip`` samples before the newest one.

        Virtual indices count every sample ever pushed; the oldest sample
        still held lives at virtual index ``total - min(total, capacity)``.
        """
        v_end = self._total_samples - 1 - skip
        v_start = v_end - n + 1
        start_phys = v_start % self.capacity
        if start_phys + n <= self.capacity:
            return self._data[start_phys:start_phys + n].copy()
        tail_len = self.capacity - start_phys
        return np.concatenate(
            [self._data[start_phys:], self._data[:n - tail_len]], axis=0
        )

    def recent_windows(
        self,
        window_seconds: float,
        count: int,
        step_seconds: float,
        *,
        min_end_timestamp: float = 0.0,
        max_end_timestamp: float | None = None,
    ) -> list[tuple[np.ndarray, float]]:
        """Up to ``count`` windows stepped back in time, newest first.

        Scanning starts at ``max_end_timestamp`` (default: the newest
        sample) and stops once window ends fall below
        ``min_end_timestamp``, which lets callers slice windows inside one
        labeled segment when calibrating from the stream.
        """
        n = int(round(window_seconds * self.sfreq))
        step = max(1, int(round(step_seconds * self.sfreq)))
        available = min(self._total_samples, self.capacity)
        anchor = self._last_timestamp if max_end_timestamp is None else min(
            max_end_timestamp, self._last_timestamp
        )
        first_skip = max(0, int(round((self._last_timestamp - anchor) * self.sfreq)))
        windows: list[tuple[np.ndarray, float]] = []
        for k in range(count):
            skip = first_skip + k * step
            if skip + n > available:
                break
            end_ts = self._last_timestamp - skip / self.sfreq
            if end_ts < min_end_timestamp:
                break
            windows.append((self._slice_from_end(skip, n), end_ts))
        return windows
