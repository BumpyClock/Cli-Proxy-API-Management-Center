import type { ReactNode } from 'react';

export type TimeTickUnit = 'day' | 'hour';

export interface TimeSeriesPoint {
  timestamp: number;
  values: Record<string, number | null>;
}

/** Independent samples, ordered by timestamp. Null is an unreported value, never zero. */
export interface TimeSeriesSample {
  timestamp: number;
  value: number | null;
}

export interface TimeSeriesSeries {
  id: string;
  label: string;
  color: string;
  number?: number;
  interpolation?: 'linear' | 'stepAfter';
  strokeDasharray?: string;
  marker?: 'first' | 'last' | false;
  legendValue?: string;
  /** Overrides the shared dense data for this series without expanding other series' timestamps. */
  points?: readonly TimeSeriesSample[];
}

/**
 * Everything after `from` is a projection, not a measurement: series segments inside it are
 * dashed. A partial projection gets a faint tint, a boundary rule and `label` at the
 * boundary. When `from` is at or before the domain start the whole plot is projected, so
 * there is nothing to contrast: no tint, and `label` names the plot above it instead.
 */
export interface TimeSeriesForecast {
  from: number;
  label: string;
}

/** A labelled vertical marker drawn directly on the plot, e.g. a reset time. */
export interface TimeSeriesAnnotation {
  x: number;
  label: string;
}

export interface TimeSeriesChartProps {
  id: string;
  data: readonly TimeSeriesPoint[];
  series: readonly TimeSeriesSeries[];
  xDomain: readonly [number, number];
  yDomain?: readonly [number, number];
  formatX: (timestamp: number) => string;
  formatY: (value: number) => string;
  ariaLabel: string;
  emptyText: string;
  description?: string;
  /** Mounted only while expanded. A factory also defers caller-side element construction. */
  dataTable?: ReactNode | (() => ReactNode);
  /** Existing accessible evidence. Pair with dataTable={false} to omit duplicate disclosure. */
  evidenceId?: string;
  height?: number;
  /** Plot height on narrow screens (<=600px). Defaults to min(height, 200). */
  compactHeight?: number;
  forecast?: TimeSeriesForecast;
  annotations?: readonly TimeSeriesAnnotation[];
  /**
   * 'after' moves the series legend below the plot, for callers that lead with a summary.
   * 'none' omits the legend for callers whose own list names every series (see
   * resolveSeriesStrokes); the shared-trace note and "Show all series" stay by the plot.
   */
  legendPlacement?: 'before' | 'after' | 'none';
  /** Controlled hidden series. Without it the chart keeps its own selection state. */
  hiddenSeries?: ReadonlySet<string>;
  onHiddenSeriesChange?: (hidden: Set<string>) => void;
  /**
   * Short x-axis label. `unit` is 'day' when the label names a day (a day band, a daily point
   * or the midnight on an hourly axis) and 'hour' for a clock time. Defaults to month and day
   * for days and to `formatX` for hours. The exact domain range is printed under the plot
   * with `formatX`.
   */
  formatXTick?: (timestamp: number, unit: TimeTickUnit) => string;
  /** Calendar zone of the axis. 'UTC' suits zone-less date buckets. Defaults to local. */
  timeZone?: 'local' | 'UTC';
  /**
   * Multi-day axes: 'bands' (default) labels each day between midnight rules, for continuous
   * time; 'points' labels each midnight, for one value per day.
   */
  dayTicks?: 'bands' | 'points';
  /**
   * Text of one direct label shared by several coincident markers. Defaults to their numbers
   * ("1–4"); callers can add what the numbers count, e.g. "1–4 · 4 accounts".
   */
  formatMarkerGroup?: (numbers: string, count: number) => string;
  /**
   * Reading guidance. When present, the chart collects it with its own keyboard and series
   * hints in one "How to read this chart" disclosure instead of printing them above the data.
   */
  guide?: ReactNode;
  className?: string;
}
