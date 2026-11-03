import type { TimeSeriesPoint, TimeSeriesSample, TimeSeriesSeries } from './TimeSeriesChart.types';

/** Only timestamps are shared. Independent series never acquire a dense values matrix. */
export function buildInspectionTimes(
  data: readonly TimeSeriesPoint[],
  series: readonly TimeSeriesSeries[]
): number[] {
  if (series.every((item) => item.points === undefined)) {
    return data.map((point) => point.timestamp);
  }
  return [
    ...new Set([
      ...data.map((point) => point.timestamp),
      ...series.flatMap((item) => item.points?.map((point) => point.timestamp) ?? []),
    ]),
  ].sort((a, b) => a - b);
}

export function seriesMarker(
  data: readonly TimeSeriesPoint[],
  series: TimeSeriesSeries
): TimeSeriesSample | undefined {
  const points = series.points ?? data;
  const point = points[series.marker === 'first' ? 0 : points.length - 1];
  if (!point) return undefined;
  return {
    timestamp: point.timestamp,
    value: 'values' in point ? (point.values[series.id] ?? null) : point.value,
  };
}

/** Matches the plotted interpolation, including null gaps and the last sample at a reset. */
export function inspectSeriesValue(
  data: readonly TimeSeriesPoint[],
  series: TimeSeriesSeries,
  timestamp: number
): number | null {
  const points = series.points ?? data;
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].timestamp <= timestamp) low = middle + 1;
    else high = middle;
  }
  const before = points[low - 1];
  if (!before) return null;
  const value = 'values' in before ? (before.values[series.id] ?? null) : before.value;
  if (before.timestamp === timestamp) return value;
  const after = points[low];
  if (!after) return null;
  if (series.interpolation === 'stepAfter') return value;
  const nextValue = 'values' in after ? (after.values[series.id] ?? null) : after.value;
  if (value === null || nextValue === null) return null;
  return (
    value +
    ((nextValue - value) * (timestamp - before.timestamp)) / (after.timestamp - before.timestamp)
  );
}

/** Recharts indexes sparse tooltip ticks by concatenated series, not the inspection timeline. */
export function pointerInspectionIndex(
  times: readonly number[],
  independent: boolean,
  state: {
    activeLabel?: string | number;
    activeTooltipIndex?: string | number | null;
  }
): number | null {
  if (independent ? state.activeLabel == null : state.activeTooltipIndex == null) return null;
  const index = independent
    ? times.indexOf(Number(state.activeLabel))
    : Number(state.activeTooltipIndex);
  return Number.isInteger(index) && index >= 0 && index < times.length ? index : null;
}

export function moveInspectionIndex(current: number, key: string, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return Math.max(0, count - 1);
  return Math.max(0, Math.min(count - 1, current + (key === 'ArrowRight' ? 1 : -1)));
}
