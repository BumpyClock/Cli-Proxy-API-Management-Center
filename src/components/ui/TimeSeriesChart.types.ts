import type { ReactNode } from 'react';

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
  className?: string;
}
