type DisplayInput = {
  seriesByChannel: Record<string, number[]>;
  x: number[];
  baselineByChannel?: Record<string, number>;
};

type DisplayOptions = {
  clipUv: number;
  targetPointCount: number;
};

type DisplayOutput = DisplayInput;

export function processEegDisplayData(
  input: DisplayInput,
  options: DisplayOptions,
): DisplayOutput {
  const clipUv = Math.max(1, options.clipUv);
  const correctedSeries = Object.fromEntries(
    Object.entries(input.seriesByChannel).map(([channelId, values]) => {
      // DC offset is removed with the incremental per-channel baseline
      // maintained by the ring buffer; no per-frame sorting.
      const baseline = input.baselineByChannel?.[channelId] ?? 0;

      return [
        channelId,
        values.map((value) => clip(value - baseline, clipUv)),
      ];
    }),
  );

  if (input.x.length <= options.targetPointCount || options.targetPointCount <= 0) {
    return {
      x: [...input.x],
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
  const bucketSize = Math.max(1, Math.ceil(input.x.length / Math.max(1, targetPointCount / 2)));
  const selectedIndexes: number[] = [];

  for (let start = 0; start < input.x.length; start += bucketSize) {
    const end = Math.min(input.x.length, start + bucketSize);
    const bucketIndexes = Array.from({ length: end - start }, (_, index) => start + index);
    const importantIndexes = new Set<number>();

    Object.values(input.seriesByChannel).forEach((values) => {
      let minIndex = bucketIndexes[0];
      let maxIndex = bucketIndexes[0];

      bucketIndexes.forEach((index) => {
        if (values[index] < values[minIndex]) {
          minIndex = index;
        }
        if (values[index] > values[maxIndex]) {
          maxIndex = index;
        }
      });

      importantIndexes.add(minIndex);
      importantIndexes.add(maxIndex);
    });

    selectedIndexes.push(...[...importantIndexes].sort((left, right) => left - right));
  }

  const uniqueIndexes = [...new Set(selectedIndexes)].sort((left, right) => left - right);

  return {
    x: uniqueIndexes.map((index) => input.x[index]),
    seriesByChannel: Object.fromEntries(
      Object.entries(input.seriesByChannel).map(([channelId, values]) => [
        channelId,
        uniqueIndexes.map((index) => values[index]),
      ]),
    ),
  };
}
