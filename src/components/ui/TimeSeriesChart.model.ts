import type {
  TimeSeriesPoint,
  TimeSeriesSample,
  TimeSeriesSeries,
  TimeTickUnit,
} from './TimeSeriesChart.types';
import { chart } from '@/design-system';

export type { TimeTickUnit } from './TimeSeriesChart.types';

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

export interface MarkerPosition {
  id: string;
  number: number;
  x: number;
  y: number;
}

export interface MarkerLabelGroup {
  ids: string[];
  numbers: number[];
  text: string;
  x: number;
  y: number;
}

/** "1–4" for a run of three or more, otherwise a comma list: "1,3", "1–3,5". */
export function formatSeriesNumbers(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    if (end - start >= 2) parts.push(`${sorted[start]}–${sorted[end]}`);
    else parts.push(...sorted.slice(start, end + 1).map(String));
    start = end + 1;
  }
  return parts.join(',');
}

/**
 * Markers whose labels would overprint within `threshold` pixels share one label.
 * Grouping is transitive, so a chain of near neighbours collapses into one label.
 */
export function groupCoincidentMarkers(
  markers: readonly MarkerPosition[],
  threshold = 12
): MarkerLabelGroup[] {
  const parent = markers.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]];
    return index;
  };
  markers.forEach((a, i) => {
    for (let j = i + 1; j < markers.length; j += 1) {
      const b = markers[j];
      if (Math.abs(a.x - b.x) <= threshold && Math.abs(a.y - b.y) <= threshold) {
        parent[root(j)] = root(i);
      }
    }
  });
  const groups = new Map<number, MarkerPosition[]>();
  markers.forEach((marker, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), marker]);
  });
  return [...groups.values()].map((members) => {
    const ordered = [...members].sort((a, b) => a.number - b.number);
    return {
      ids: ordered.map((member) => member.id),
      numbers: ordered.map((member) => member.number),
      text: formatSeriesNumbers(ordered.map((member) => member.number)),
      x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
      y: Math.min(...members.map((member) => member.y)),
    };
  });
}

export type EdgeAnchor = 'start' | 'middle' | 'end';

/** Labels at a plot edge grow inward instead of spilling into the axis gutter. */
export function edgeAnchor(
  position: number,
  start: number,
  end: number,
  inset: number
): EdgeAnchor {
  if (position - start < inset) return 'start';
  if (end - position < inset) return 'end';
  return 'middle';
}

export interface TraceInput {
  id: string;
  number: number;
  samples: readonly TimeSeriesSample[];
}

export interface TraceGroup {
  ids: string[];
  numbers: number[];
}

/**
 * Series whose plotted samples coincide would overprint into one blended stroke. They share
 * one trace instead; legend, readout, and table keep each series' exact values. Samples
 * coincide within `tolerance` (data units), so seconds apart on a week-long axis still merge,
 * while a gap never matches a value. Members are ordered by series number.
 */
export function groupIdenticalTraces(
  traces: readonly TraceInput[],
  tolerance: { x: number; y: number } = { x: 0, y: 0 }
): TraceGroup[] {
  const coincide = (a: TraceInput, b: TraceInput) =>
    a.samples.length === b.samples.length &&
    a.samples.every((sample, index) => {
      const other = b.samples[index];
      if (Math.abs(sample.timestamp - other.timestamp) > tolerance.x) return false;
      if (sample.value === null || other.value === null) return sample.value === other.value;
      return Math.abs(sample.value - other.value) <= tolerance.y;
    });
  const groups: TraceInput[][] = [];
  traces.forEach((trace) => {
    const group = groups.find((members) => coincide(members[0], trace));
    if (group) group.push(trace);
    else groups.push([trace]);
  });
  return groups.map((members) => {
    const ordered = [...members].sort((a, b) => a.number - b.number);
    return { ids: ordered.map((member) => member.id), numbers: ordered.map((m) => m.number) };
  });
}

/** Series drawn as one shared trace use this neutral stroke; their numbers name them. */
export const SHARED_STROKE = 'var(--text-secondary)';
/** Default dash for projected segments; shared traces and undashed series use it. */
export const PROJECTED_DASH = chart.projectedDash;

export function seriesSamples(
  item: TimeSeriesSeries,
  data: readonly TimeSeriesPoint[]
): readonly TimeSeriesSample[] {
  return (
    item.points ??
    data.map((point) => ({ timestamp: point.timestamp, value: point.values[item.id] ?? null }))
  );
}

export interface SeriesStroke {
  color: string;
  /** Dash of the stroke as drawn; on a forecast plot, the dash of the projected segment. */
  dash: string | undefined;
  /** Drawn as one neutral trace together with other visible series. */
  shared: boolean;
  /** Numbers of every series drawn with this stroke, ascending. */
  numbers: number[];
  visible: boolean;
}

export interface DrawnTrace extends TraceGroup {
  shared: boolean;
  color: string;
  /** The trace's own dash; projected segments fall back to PROJECTED_DASH. */
  dash: string | undefined;
}

export interface StrokeOptions {
  hidden?: ReadonlySet<string>;
  xDomain: readonly [number, number];
  yDomain?: readonly [number, number];
  forecast?: boolean;
}

/**
 * The one decision of what each series looks like on the plot. Visible series whose samples
 * coincide within half a percent of each axis share one neutral trace; every other series
 * keeps its colour and dash. The chart draws `traces`; legends and lists show `strokes`, so a
 * colour key can never name a line that is not drawn. Hidden series report the stroke they
 * would get when shown alone.
 */
export function resolveSeriesStrokes(
  series: readonly TimeSeriesSeries[],
  data: readonly TimeSeriesPoint[],
  { hidden, xDomain, yDomain, forecast = false }: StrokeOptions
): { traces: DrawnTrace[]; strokes: Map<string, SeriesStroke> } {
  const numbered = series.map((item, index) => ({ item, number: item.number ?? index + 1 }));
  const byId = new Map(numbered.map((entry) => [entry.item.id, entry]));
  // Closer than half a percent of each axis, two strokes are visually one line.
  const tolerance = {
    x: (xDomain[1] - xDomain[0]) * 0.005,
    y: yDomain ? (yDomain[1] - yDomain[0]) * 0.005 : 0,
  };
  const groups = groupIdenticalTraces(
    numbered
      .filter(({ item }) => !hidden?.has(item.id))
      .map(({ item, number }) => ({ id: item.id, number, samples: seriesSamples(item, data) })),
    tolerance
  );
  const drawnDash = (own: string | undefined) => (forecast ? (own ?? PROJECTED_DASH) : own);
  const traces = groups.map((group): DrawnTrace => {
    const lead = byId.get(group.ids[0])!.item;
    const shared = group.ids.length > 1;
    return {
      ...group,
      shared,
      color: shared ? SHARED_STROKE : lead.color,
      dash: shared ? undefined : lead.strokeDasharray,
    };
  });
  const strokes = new Map<string, SeriesStroke>();
  traces.forEach((trace) =>
    trace.ids.forEach((id) =>
      strokes.set(id, {
        color: trace.color,
        dash: drawnDash(trace.dash),
        shared: trace.shared,
        numbers: trace.numbers,
        visible: true,
      })
    )
  );
  numbered.forEach(({ item, number }) => {
    if (strokes.has(item.id)) return;
    strokes.set(item.id, {
      color: item.color,
      dash: drawnDash(item.strokeDasharray),
      shared: false,
      numbers: [number],
      visible: false,
    });
  });
  return { traces, strokes };
}

/**
 * Legend selection: with everything visible, a click isolates that series. Afterwards a
 * click toggles one series; hiding the last visible series shows everything again.
 */
export function nextHiddenSeries(
  hidden: ReadonlySet<string>,
  ids: readonly string[],
  clicked: string
): Set<string> {
  // Ids of series that no longer exist (another window, a removed account) never count.
  const known = new Set(ids);
  const next = new Set([...hidden].filter((id) => known.has(id)));
  if (next.size === 0 && ids.length > 1) return new Set(ids.filter((id) => id !== clicked));
  if (next.has(clicked)) next.delete(clicked);
  else next.add(clicked);
  return next.size >= ids.length ? new Set() : next;
}

/** Plot geometry shared by the renderer and the tick layout. */
export const PLOT_MARGIN = chart.margin;
export const Y_AXIS_WIDTH = chart.yAxisWidth;
/** Axis, marker and annotation labels on the plot. */
export const AXIS_FONT_SIZE = chart.axisFontSize;

/** Width of the drawable plot area inside a chart container of `containerWidth` pixels. */
export function plotAreaWidth(containerWidth: number): number {
  return Math.max(0, containerWidth - PLOT_MARGIN.left - PLOT_MARGIN.right - Y_AXIS_WIDTH);
}

/** Pixel x of `timestamp` on a linear time axis spanning `domain` over [left, left + width]. */
export function timeToX(
  timestamp: number,
  domain: readonly [number, number],
  left: number,
  width: number
): number {
  const span = domain[1] - domain[0];
  return span > 0 ? left + ((timestamp - domain[0]) / span) * width : left;
}

/** Multi-day spans are read in days; shorter spans in whole hours. */
export function timeTickUnit(domain: readonly [number, number]): TimeTickUnit {
  return domain[1] - domain[0] > 36 * 3_600_000 ? 'day' : 'hour';
}

/** Uniform strides, densest first. */
const TICK_STRIDES: Record<TimeTickUnit, readonly number[]> = {
  day: [1, 2, 3, 7, 14],
  hour: [1, 2, 3, 6, 12],
};

/** Calendar days and hours in the viewer's zone, or in UTC for zone-less date buckets. */
export type TimeAxisZone = 'local' | 'UTC';

/**
 * Day bands: labels name the day between two midnight rules, centred in the part of the day
 * that is on the plot. Day points: labels sit on the midnight they name, for one value per
 * day. Hour spans always label whole-hour instants.
 */
export type DayTickPlacement = 'bands' | 'points';

export function isDayStart(timestamp: number, zone: TimeAxisZone = 'local'): boolean {
  const date = new Date(timestamp);
  return zone === 'UTC'
    ? date.getUTCHours() === 0 && date.getUTCMinutes() === 0
    : date.getHours() === 0 && date.getMinutes() === 0;
}

/** Midnights in the domain; `inclusive` also keeps domain edges that fall on a midnight. */
export function midnightsIn(
  [start, end]: readonly [number, number],
  zone: TimeAxisZone = 'local',
  inclusive = false
): number[] {
  if (!(end > start)) return [];
  const cursor = new Date(start);
  if (zone === 'UTC') cursor.setUTCHours(0, 0, 0, 0);
  else cursor.setHours(0, 0, 0, 0);
  const out: number[] = [];
  while (cursor.getTime() <= end && out.length < 1_000) {
    const at = cursor.getTime();
    if (inclusive ? at >= start : at > start && at < end) out.push(at);
    if (zone === 'UTC') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Whole hours strictly inside the domain whose clock hour is a multiple of `stride`. */
export function wholeHoursIn(
  [start, end]: readonly [number, number],
  stride = 1,
  zone: TimeAxisZone = 'local'
): number[] {
  if (!(end > start)) return [];
  const cursor = new Date(start);
  if (zone === 'UTC') cursor.setUTCMinutes(60, 0, 0);
  else cursor.setMinutes(60, 0, 0);
  const out: number[] = [];
  for (let at = cursor.getTime(); at < end && out.length < 1_000; at += 3_600_000) {
    const hour = zone === 'UTC' ? new Date(at).getUTCHours() : new Date(at).getHours();
    if (hour % stride === 0) out.push(at);
  }
  return out;
}

/** Approximate rendered width of an axis label: CJK glyphs are about one em wide. */
export function estimateLabelWidth(text: string, fontSize = AXIS_FONT_SIZE): number {
  let width = 0;
  for (const char of text) {
    width += /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(char)
      ? fontSize
      : fontSize * 0.55;
  }
  return width;
}

export interface TimeAxisLayout {
  unit: TimeTickUnit;
  /** Label positions, each centred on its own x. */
  ticks: number[];
  /** Vertical rules: midnights for days, the labelled instants for hours. */
  rules: number[];
}

export interface TimeAxisOptions {
  zone?: TimeAxisZone;
  days?: DayTickPlacement;
  /** Minimum clear space between neighbouring labels. */
  gap?: number;
  /** How far a centred label may extend past the plot's left and right edges. */
  overhang?: { start: number; end: number };
}

/**
 * The x axis of a time chart. Every label is centred on the true x of what it names and labels
 * use one even stride, the densest whose labels clear each other by `gap`. The exact domain
 * edges are not axis labels; the chart states the range once beside the plot.
 */
export function layoutTimeAxis(
  domain: readonly [number, number],
  plotWidth: number,
  labelWidth: (timestamp: number) => number,
  {
    zone = 'local',
    days = 'bands',
    gap = 12,
    overhang = { start: 0, end: 0 },
  }: TimeAxisOptions = {}
): TimeAxisLayout {
  const [start, end] = domain;
  const unit = timeTickUnit(domain);
  const span = end - start;
  if (!(span > 0) || plotWidth <= 0) return { unit, ticks: [], rules: [] };
  const px = (ms: number) => (ms / span) * plotWidth;
  const x = (at: number) => timeToX(at, domain, 0, plotWidth);
  const unitPx = px(unit === 'day' ? 86_400_000 : 3_600_000);
  const fits = (at: number) => {
    const half = labelWidth(at) / 2;
    return x(at) - half >= -overhang.start && x(at) + half <= plotWidth + overhang.end;
  };
  const strideFor = (candidates: readonly number[]) => {
    const widest = Math.max(0, ...candidates.map(labelWidth));
    return TICK_STRIDES[unit].find((step) => step * unitPx >= widest + gap);
  };

  if (unit === 'hour') {
    const stride = strideFor(wholeHoursIn(domain, 1, zone));
    const ticks = stride === undefined ? [] : wholeHoursIn(domain, stride, zone).filter(fits);
    return { unit, ticks, rules: ticks };
  }

  const midnights = midnightsIn(domain, zone, days === 'points');
  const rules = unitPx >= 6 ? midnights.filter((at) => at > start && at < end) : [];
  if (days === 'points') {
    const stride = strideFor(midnights);
    const ticks =
      stride === undefined ? [] : midnights.filter((_, i) => i % stride === 0).filter(fits);
    return { unit, ticks, rules };
  }
  const edges = [start, ...midnights, end];
  const bands = edges.slice(0, -1).map((from, index) => {
    const to = edges[index + 1];
    return { centre: (from + to) / 2, width: px(to - from) };
  });
  const stride = strideFor(bands.map((band) => band.centre));
  if (stride === undefined) return { unit, ticks: [], rules };
  // A partial day at either edge is labelled only when its name fits inside its own band.
  const labelled = bands.filter(
    (band) =>
      fits(band.centre) && (band.width >= unitPx - 1 || band.width >= labelWidth(band.centre))
  );
  const first = bands.indexOf(labelled[0]);
  const ticks: number[] = [];
  let previousRight = -Infinity;
  labelled.forEach((band) => {
    if ((bands.indexOf(band) - first) % stride !== 0) return;
    const half = labelWidth(band.centre) / 2;
    if (x(band.centre) - half < previousRight + gap) return;
    ticks.push(band.centre);
    previousRight = x(band.centre) + half;
  });
  return { unit, ticks, rules };
}

/**
 * Splits one series at the forecast boundary. Samples at or before `from` are measured and
 * samples at or after it are projected; the boundary value is shared so the two strokes meet.
 * No value is invented: a boundary between samples takes the plotted (interpolated) value.
 */
export function splitAtForecast(
  samples: readonly TimeSeriesSample[],
  from: number,
  interpolation: 'linear' | 'stepAfter' = 'linear'
): { measured: TimeSeriesSample[]; projected: TimeSeriesSample[] } {
  const measured = samples.filter((sample) => sample.timestamp <= from);
  const projected = samples.filter((sample) => sample.timestamp >= from);
  const last = measured[measured.length - 1];
  const next = projected[0];
  if (last && next && last.timestamp < from && next.timestamp > from) {
    const value =
      last.value === null || next.value === null
        ? null
        : interpolation === 'stepAfter'
          ? last.value
          : last.value +
            ((next.value - last.value) * (from - last.timestamp)) /
              (next.timestamp - last.timestamp);
    const boundary = { timestamp: from, value };
    measured.push(boundary);
    projected.unshift(boundary);
  }
  return { measured, projected };
}
