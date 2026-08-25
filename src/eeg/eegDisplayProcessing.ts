type DisplayInput = {
  seriesByChannel: Record<string, Float32Array>;
  x: Float64Array;
  baselineByChannel?: Record<string, number>;
};

type DisplayOptions = {
  clipUv: number;
  targetPointCount: number;
};

type DisplayOutput = DisplayInput;

/**
 * Baseline correction + clipping + min/max bucket decimation for one rendered
 * frame. Runs 30 times a second on the live stream, so every pass is typed and
 * allocation-bounded: one output array per channel plus a tiny index scratch.
 */
export function processEegDisplayData(
  input: DisplayInput,
  options: DisplayOptions,
): DisplayOutput {
  const clipUv = Math.max(1, options.clipUv);
  const channelIds = Object.keys(input.seriesByChannel);

  const correctedSeries: Record<string, Float32Array> = {};
  for (const channelId of channelIds) {
    const values = input.seriesByChannel[channelId];
    // DC offset is removed with the incremental per-channel baseline
    // maintained by the ring buffer; no per-frame sorting.
    const baseline = input.baselineByChannel?.[channelId] ?? 0;
    const corrected = new Float32Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
      corrected[index] = clip(values[index] - baseline, clipUv);
    }
    correctedSeries[channelId] = corrected;
  }

  if (input.x.length <= options.targetPointCount || options.targetPointCount <= 0) {
    return {
      x: input.x,
      seriesByChannel: correctedSeries,
    };
  }

  return downsampleMinMax({
    x: input.x,
    seriesByChannel: correctedSeries,
  }, options.targetPointCount);
}

// NaN (or any non-finite value) renders as 0 so it can never propagate into
// uPlot data and break the canvas layout.
function clip(value: number, limit: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-limit, Math.min(limit, value));
}

function downsampleMinMax(input: DisplayInput, targetPointCount: number): DisplayOutput {
  const channelIds = Object.keys(input.seriesByChannel);
  const length = input.x.length;
  const bucketSize = Math.max(1, Math.ceil(length / Math.max(1, targetPointCount / 2)));

  // Union of the per-channel min/max indexes per bucket, ascending. Buckets
  // are disjoint and visited in order, so per-bucket ordering is enough — the
  // extrema of every channel survive decimation (spikes stay visible).
  const bucketExtrema = new Int32Array(channelIds.length * 2);
  const selectedIndexes: number[] = [];

  for (let start = 0; start < length; start += bucketSize) {
    const end = Math.min(length, start + bucketSize);
    let candidateCount = 0;

    for (const channelId of channelIds) {
      const values = input.seriesByChannel[channelId];
      let minIndex = start;
      let maxIndex = start;
      for (let index = start + 1; index < end; index += 1) {
        if (values[index] < values[minIndex]) {
          minIndex = index;
        }
        if (values[index] > values[maxIndex]) {
          maxIndex = index;
        }
      }
      bucketExtrema[candidateCount] = minIndex;
      candidateCount += 1;
      bucketExtrema[candidateCount] = maxIndex;
      candidateCount += 1;
    }

    insertionSort(bucketExtrema, candidateCount);
    let previous = -1;
    for (let index = 0; index < candidateCount; index += 1) {
      const candidate = bucketExtrema[index];
      if (candidate !== previous) {
        selectedIndexes.push(candidate);
        previous = candidate;
      }
    }
  }

  const count = selectedIndexes.length;
  const x = new Float64Array(count);
  const seriesByChannel: Record<string, Float32Array> = {};
  for (const channelId of channelIds) {
    const values = input.seriesByChannel[channelId];
    const decimated = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      decimated[index] = values[selectedIndexes[index]];
    }
    seriesByChannel[channelId] = decimated;
  }
  for (let index = 0; index < count; index += 1) {
    x[index] = input.x[selectedIndexes[index]];
  }

  return { x, seriesByChannel };
}

// Insertion sort on the ≤2-per-channel extrema indexes: faster than a Set plus
// Array.prototype.sort for these tiny buckets and allocates nothing.
function insertionSort(indexes: Int32Array, count: number) {
  for (let i = 1; i < count; i += 1) {
    const value = indexes[i];
    let j = i - 1;
    while (j >= 0 && indexes[j] > value) {
      indexes[j + 1] = indexes[j];
      j -= 1;
    }
    indexes[j + 1] = value;
  }
}
