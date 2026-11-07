import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
  ZIndexLayer,
  DefaultZIndexes,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  type XAxisTickContentProps,
} from 'recharts';
import type {
  TimeSeriesAnnotation,
  TimeSeriesChartProps,
  TimeSeriesForecast,
  TimeSeriesPoint,
  TimeSeriesSample,
} from './TimeSeriesChart.types';
import {
  AXIS_FONT_SIZE,
  buildInspectionTimes,
  edgeAnchor,
  estimateLabelWidth,
  formatSeriesNumbers,
  groupCoincidentMarkers,
  inspectSeriesValue,
  isDayStart,
  layoutTimeAxis,
  moveInspectionIndex,
  nextHiddenSeries,
  plotAreaWidth,
  pointerInspectionIndex,
  PLOT_MARGIN,
  PROJECTED_DASH,
  resolveSeriesStrokes,
  SHARED_STROKE,
  seriesMarker,
  seriesSamples,
  splitAtForecast,
  timeTickUnit,
  Y_AXIS_WIDTH,
} from './TimeSeriesChart.model';
import { TimeSeriesChartTable } from './TimeSeriesChartTable';
import styles from './TimeSeriesChart.module.scss';
import { chart, fontWeight, media, px, size } from '@/design-system';

export type {
  TimeSeriesAnnotation,
  TimeSeriesChartProps,
  TimeSeriesForecast,
  TimeSeriesPoint,
  TimeSeriesSample,
  TimeSeriesSeries,
  TimeTickUnit,
} from './TimeSeriesChart.types';

const subscribeReducedMotion = (listener: () => void) => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const readReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const NARROW_QUERY = media.chartCompact;
const subscribeNarrow = (listener: () => void) => {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const readNarrow = () => window.matchMedia(NARROW_QUERY).matches;

const HALO = {
  stroke: 'var(--bg-primary)',
  strokeWidth: chart.haloStroke,
  paintOrder: 'stroke',
} as const;

const AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: AXIS_FONT_SIZE };

interface ChartMarker {
  id: string;
  number: number;
  label: string;
  color: string;
  timestamp: number;
  value: number;
}

/**
 * Coincident markers share one direct label ("1–4", or the caller's group wording) so their
 * numbers never overprint. The legend, readout, and data table keep each series' identity.
 */
function MarkerLabels({
  markers,
  formatGroup,
}: {
  markers: readonly ChartMarker[];
  formatGroup?: (numbers: string, count: number) => string;
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const area = usePlotArea();
  if (!xScale || !yScale || !area) return null;
  const inside = (value: number | undefined, start: number, size: number) =>
    value !== undefined &&
    Number.isFinite(value) &&
    value >= start - 1 &&
    value <= start + size + 1;
  const positioned = markers.flatMap((marker) => {
    const x = xScale(marker.timestamp);
    const y = yScale(marker.value);
    return inside(x, area.x, area.width) && inside(y, area.y, area.height)
      ? [{ id: marker.id, number: marker.number, x: x as number, y: y as number }]
      : [];
  });
  const labels = new Map(markers.map((marker) => [marker.id, `${marker.number} ${marker.label}`]));
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g aria-hidden="true">
        {groupCoincidentMarkers(positioned).map((group) => (
          <text
            key={group.ids.join('|')}
            x={group.x}
            y={group.y - 9}
            textAnchor={edgeAnchor(group.x, area.x, area.x + area.width, 12)}
            fill="var(--text-primary)"
            fontSize={AXIS_FONT_SIZE}
            fontWeight={fontWeight['600']}
            {...HALO}
          >
            <title>{group.ids.map((id) => labels.get(id)).join(', ')}</title>
            {group.ids.length > 1 && formatGroup
              ? formatGroup(group.text, group.ids.length)
              : group.text}
          </text>
        ))}
      </g>
    </ZIndexLayer>
  );
}

/**
 * Direct labels: the forecast label along the plot floor, and each reset time above the plot
 * with a caret at its exact x, so a label shifted inward at an edge still points at its instant.
 */
function PlotLabels({
  forecast,
  annotations,
}: {
  forecast?: TimeSeriesForecast;
  annotations: readonly TimeSeriesAnnotation[];
}) {
  const xScale = useXAxisScale();
  const area = usePlotArea();
  if (!xScale || !area) return null;
  const right = area.x + area.width;
  const clamp = (value: number) => Math.max(area.x, Math.min(right, value));
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g aria-hidden="true" fontSize={AXIS_FONT_SIZE} fill="var(--text-secondary)">
        {forecast && (
          <text
            x={clamp(Number(xScale(forecast.from))) + 6}
            y={area.y + area.height - 8}
            fill="var(--text-primary)"
            {...HALO}
          >
            {forecast.label} →
          </text>
        )}
        {annotations.map((annotation) => {
          const x = Number(xScale(annotation.x));
          if (!Number.isFinite(x) || x < area.x - 1 || x > right + 1) return null;
          return (
            <g key={`${annotation.x}-${annotation.label}`}>
              <text
                x={x}
                y={area.y - 10}
                textAnchor={edgeAnchor(x, area.x, right, 60)}
                fill="var(--text-primary)"
                fontWeight={fontWeight['600']}
                {...HALO}
              >
                {annotation.label}
              </text>
              <path
                d={`M${x - 4} ${area.y - 7}H${x + 4}L${x} ${area.y - 1}Z`}
                fill="var(--text-primary)"
              />
            </g>
          );
        })}
      </g>
    </ZIndexLayer>
  );
}

/**
 * The stroke as drawn on the plot, for legends, keys and caller-owned series lists. `marker`
 * leads with the snapshot dot, as the plotted line starts.
 */
export function SeriesSwatch({
  color,
  dash,
  marker = false,
  className,
}: {
  color: string;
  dash?: string;
  marker?: boolean;
  className?: string;
}) {
  const width = marker ? size['30'] : size['24'];
  return (
    <svg
      className={[styles.swatch, className].filter(Boolean).join(' ')}
      width={width}
      height={chart.swatch.height}
      viewBox={`0 0 ${width} ${chart.swatch.height}`}
      aria-hidden="true"
    >
      {marker && <circle cx="4" cy="5" r={chart.swatch.dotRadius} fill={color} />}
      <line
        x1={marker ? 9 : 1}
        y1="5"
        x2={width - 1}
        y2="5"
        stroke={color}
        strokeWidth={chart.swatch.stroke}
        strokeDasharray={dash}
      />
    </svg>
  );
}

export function TimeSeriesChart({
  id,
  data,
  series,
  xDomain,
  yDomain,
  formatX,
  formatY,
  ariaLabel,
  emptyText,
  description,
  dataTable,
  evidenceId,
  height = 252,
  compactHeight,
  forecast,
  annotations = [],
  legendPlacement = 'before',
  hiddenSeries,
  onHiddenSeriesChange,
  formatXTick,
  timeZone = 'local',
  dayTicks = 'bands',
  formatMarkerGroup,
  guide,
  className,
}: TimeSeriesChartProps) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => true);
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  const plotHeight = narrow ? (compactHeight ?? Math.min(height, 200)) : height;
  const [ownHidden, setOwnHidden] = useState<ReadonlySet<string>>(() => new Set());
  const hidden = hiddenSeries ?? ownHidden;
  const setHidden = (next: Set<string>) => {
    if (!hiddenSeries) setOwnHidden(next);
    onHiddenSeriesChange?.(next);
  };
  const [selected, setSelected] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const tickUnit = timeTickUnit(xDomain);
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        timeZone: timeZone === 'UTC' ? 'UTC' : undefined,
      }),
    [i18n.language, timeZone]
  );
  const formatTick = useCallback(
    (timestamp: number) => {
      const unit = tickUnit === 'day' || isDayStart(timestamp, timeZone) ? 'day' : 'hour';
      if (formatXTick) return formatXTick(timestamp, unit);
      return unit === 'day' ? dayFormat.format(timestamp) : formatX(timestamp);
    },
    [dayFormat, formatX, formatXTick, tickUnit, timeZone]
  );
  const axis = useMemo(
    () =>
      layoutTimeAxis(
        xDomain,
        plotAreaWidth(containerWidth),
        (timestamp) => estimateLabelWidth(formatTick(timestamp)),
        {
          zone: timeZone,
          days: dayTicks,
          // Centred labels may reach under the y-axis gutter and into the right margin.
          overhang: { start: 16, end: PLOT_MARGIN.right },
        }
      ),
    [containerWidth, dayTicks, formatTick, timeZone, xDomain]
  );
  const visible = useMemo(() => series.filter((item) => !hidden.has(item.id)), [series, hidden]);
  const hiddenCount = series.length - visible.length;
  const times = useMemo(() => buildInspectionTimes(data, series), [data, series]);
  const independent = series.some((item) => item.points !== undefined);
  const chartData = useMemo(
    () => (independent ? times.map((timestamp) => ({ timestamp })) : [...data]),
    [data, independent, times]
  );
  const plotted = useMemo(
    () =>
      series
        .map((item, index) => ({
          item,
          number: item.number ?? index + 1,
          samples: seriesSamples(item, data),
          points: item.points
            ? [...item.points]
            : independent
              ? [...seriesSamples(item, data)]
              : undefined,
        }))
        .filter(({ item }) => !hidden.has(item.id)),
    [data, independent, series, hidden]
  );
  // Identical visible series share one neutral trace instead of blending their colors.
  const { traces, strokes } = useMemo(() => {
    const resolved = resolveSeriesStrokes(series, data, {
      hidden,
      xDomain,
      yDomain,
      forecast: Boolean(forecast),
    });
    const byId = new Map(plotted.map((entry) => [entry.item.id, entry]));
    return {
      strokes: resolved.strokes,
      traces: resolved.traces.map((trace) => ({ ...trace, lead: byId.get(trace.ids[0])! })),
    };
  }, [data, forecast, hidden, plotted, series, xDomain, yDomain]);
  const markers = useMemo(
    () =>
      plotted.flatMap(({ item, number }): ChartMarker[] => {
        const marker = item.marker === false ? undefined : seriesMarker(data, item);
        return marker && marker.value !== null
          ? [
              {
                id: item.id,
                number,
                label: item.label,
                color: item.color,
                timestamp: marker.timestamp,
                value: marker.value,
              },
            ]
          : [];
      }),
    [data, plotted]
  );
  const timestamp = times[Math.min(selected, Math.max(0, times.length - 1))];
  const readoutId = `${id}-readout`;
  // A projection that starts at the domain start covers the whole plot: nothing to contrast.
  const projectedOnly = forecast !== undefined && forecast.from <= xDomain[0];

  const seriesIds = series.map((item) => item.id);
  const toggleSeries = (seriesId: string) =>
    setHidden(nextHiddenSeries(hidden, seriesIds, seriesId));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || times.length === 0)
      return;
    event.preventDefault();
    setInspecting(true);
    setSelected((previous) => moveInspectionIndex(previous, event.key, times.length));
  };

  const inspectPointer = (state: {
    activeLabel?: string | number;
    activeTooltipIndex?: string | number | null;
  }) => {
    const index = pointerInspectionIndex(times, independent, state);
    if (index !== null) {
      setSelected(index);
      setInspecting(true);
    }
  };

  const tableDisclosure = (
    <details
      className={styles.tableDisclosure}
      onToggle={(event) => setTableOpen(event.currentTarget.open)}
    >
      <summary>{t('redesign.chart.table')}</summary>
      {tableOpen && (
        <div className={styles.tableWrap}>
          {typeof dataTable === 'function'
            ? dataTable()
            : (dataTable ?? (
                <TimeSeriesChartTable
                  data={data}
                  series={visible}
                  ariaLabel={ariaLabel}
                  formatX={formatX}
                  formatY={formatY}
                />
              ))}
        </div>
      )}
    </details>
  );

  const sharedTraces = traces.filter((trace) => trace.shared);
  const guided = guide !== undefined;
  const listed = legendPlacement !== 'none';
  const sharedDash = forecast ? PROJECTED_DASH : undefined;
  const isolateHint = series.length > 1 && listed;

  const legendNote = (sharedTraces.length > 0 || hiddenCount > 0 || (isolateHint && !guided)) && (
    <div className={styles.legendNote}>
      {/* Coincident series stay disclosed: their numbers name the one shared stroke. */}
      {sharedTraces.map((trace) => (
        <span key={trace.ids.join('|')} className={styles.sharedNote}>
          <SeriesSwatch color={SHARED_STROKE} dash={sharedDash} />
          {t('redesign.chart.shared', { numbers: formatSeriesNumbers(trace.numbers) })}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <button type="button" className={styles.showAll} onClick={() => setHidden(new Set())}>
          {t('redesign.chart.show_all')}
        </button>
      ) : (
        isolateHint &&
        !guided && <span className={styles.isolateHint}>{t('redesign.chart.isolate_hint')}</span>
      )}
    </div>
  );

  const legend = listed && (
    <div className={styles.legend} role="group" aria-label={t('redesign.chart.series')}>
      {series.map((item, index) => {
        const value = seriesMarker(data, item)?.value;
        const number = item.number ?? index + 1;
        const shown =
          item.legendValue ??
          (value === null || value === undefined ? t('redesign.chart.unreported') : formatY(value));
        const stroke = strokes.get(item.id);
        return (
          <button
            type="button"
            key={item.id}
            className={styles.series}
            aria-pressed={!hidden.has(item.id)}
            title={`${number} · ${item.label} · ${shown}`}
            onClick={() => toggleSeries(item.id)}
          >
            <SeriesSwatch color={stroke?.color ?? item.color} dash={stroke?.dash} />
            <span className={styles.number} aria-hidden="true">
              {number}
            </span>
            <span className={styles.name}>{item.label}</span>
            <strong>{shown}</strong>
          </button>
        );
      })}
    </div>
  );

  const guideDisclosure = guided && (
    <details className={styles.guide}>
      <summary>{t('redesign.chart.guide')}</summary>
      {forecast && (
        <p className={styles.guideKey}>
          <span>
            <svg
              width={chart.keyDot.size}
              height={chart.keyDot.size}
              viewBox="0 0 10 10"
              aria-hidden="true"
            >
              <circle cx="5" cy="5" r={chart.keyDot.radius} fill="var(--text-secondary)" />
            </svg>
            {t('redesign.chart.key_snapshot')}
          </span>
          <span>
            <SeriesSwatch color="var(--text-secondary)" dash={PROJECTED_DASH} />
            {t('redesign.chart.key_projection')}
          </span>
        </p>
      )}
      {guide}
      <p>{t('redesign.chart.keyboard')}</p>
      {isolateHint && <p>{t('redesign.chart.isolate_hint')}</p>}
    </details>
  );

  return (
    <figure className={[styles.chart, className].filter(Boolean).join(' ')}>
      {description && <figcaption className={styles.description}>{description}</figcaption>}
      {legendPlacement === 'before' && (
        <>
          {legend}
          {legendNote}
        </>
      )}
      {times.length === 0 || series.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <>
          {projectedOnly && (
            <p className={styles.projectionNote}>
              <SeriesSwatch color="var(--text-secondary)" dash={PROJECTED_DASH} />
              {forecast.label}
            </p>
          )}
          <div
            ref={plotRef}
            className={styles.plot}
            role="group"
            tabIndex={0}
            aria-label={`${ariaLabel}. ${t('redesign.chart.keyboard')}`}
            aria-describedby={readoutId}
            aria-details={evidenceId}
            onKeyDown={handleKeyDown}
            onFocus={() => setInspecting(true)}
            onBlur={() => setInspecting(false)}
            onMouseLeave={() => setInspecting(document.activeElement === plotRef.current)}
          >
            <ResponsiveContainer
              width="100%"
              height={plotHeight}
              minWidth={0}
              onResize={(width) => setContainerWidth(width)}
            >
              <LineChart
                data={chartData}
                accessibilityLayer={false}
                tabIndex={-1}
                margin={{ ...PLOT_MARGIN }}
                onMouseMove={inspectPointer}
              >
                <CartesianGrid vertical={false} stroke="var(--border-color)" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={[...xDomain]}
                  allowDataOverflow
                  tickFormatter={formatTick}
                  tick={(props: XAxisTickContentProps) => (
                    <Text
                      {...AXIS_TICK}
                      x={props.x}
                      y={props.y}
                      verticalAnchor={props.verticalAnchor}
                      textAnchor="middle"
                    >
                      {formatTick(Number(props.payload.value))}
                    </Text>
                  )}
                  ticks={axis.ticks}
                  interval={0}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={chart.tickMargin}
                />
                <YAxis
                  dataKey={independent ? 'value' : undefined}
                  domain={yDomain ? [...yDomain] : [0, 'auto']}
                  allowDataOverflow={Boolean(yDomain)}
                  tickFormatter={formatY}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={Y_AXIS_WIDTH}
                  allowDecimals={false}
                />
                <Tooltip
                  content={independent ? () => null : undefined}
                  labelFormatter={(value) => formatX(Number(value))}
                  formatter={(value) => formatY(Number(value))}
                  contentStyle={{
                    background: 'var(--floating-surface)',
                    border: `${px(chart.tooltip.borderWidth)} solid var(--border-primary)`,
                    borderRadius: chart.tooltip.radius,
                    color: 'var(--text-primary)',
                    fontSize: chart.tooltip.fontSize,
                  }}
                />
                {forecast && !projectedOnly && (
                  // A faint flat tint behind the projected part; the boundary rule and the
                  // direct label carry the meaning, the tint only groups the range.
                  <ReferenceArea
                    x1={forecast.from}
                    x2={xDomain[1]}
                    ifOverflow="hidden"
                    fill="var(--text-secondary)"
                    fillOpacity={chart.forecastTintOpacity}
                    stroke="none"
                  />
                )}
                {forecast && !projectedOnly && (
                  <ReferenceLine
                    x={forecast.from}
                    ifOverflow="hidden"
                    stroke="var(--text-secondary)"
                    strokeWidth={chart.boundaryStroke}
                  />
                )}
                {axis.rules.map((rule) => (
                  <ReferenceLine
                    key={`rule-${rule}`}
                    x={rule}
                    className={styles.rule}
                    stroke="var(--border-color)"
                  />
                ))}
                {annotations.map((annotation) => (
                  <ReferenceLine
                    key={`${annotation.x}-${annotation.label}`}
                    x={annotation.x}
                    stroke="var(--text-tertiary)"
                    strokeDasharray={chart.annotationDash}
                  />
                ))}
                {traces.flatMap(({ ids, numbers, lead, shared, color, dash }) => {
                  const line = (
                    key: string,
                    points: readonly (TimeSeriesPoint | TimeSeriesSample)[] | undefined,
                    lineDash: string | undefined
                  ) => (
                    <Line
                      key={key}
                      name={shared ? formatSeriesNumbers(numbers) : lead.item.label}
                      data={points ? [...points] : undefined}
                      dataKey={(row: TimeSeriesPoint | TimeSeriesSample) =>
                        'values' in row ? (row.values[lead.item.id] ?? null) : row.value
                      }
                      type={lead.item.interpolation ?? 'linear'}
                      stroke={color}
                      strokeWidth={shared ? chart.sharedSeriesStroke : chart.seriesStroke}
                      strokeDasharray={lineDash}
                      connectNulls={false}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={!reducedMotion}
                      animationDuration={chart.animationDuration}
                    />
                  );
                  const key = ids.join('|');
                  if (!forecast) return [line(key, lead.points, dash)];
                  // Measured history is solid; projections are always dashed. A series' own dash
                  // pattern still tells projected traces apart without colour.
                  const { measured, projected } = splitAtForecast(
                    lead.samples,
                    forecast.from,
                    lead.item.interpolation
                  );
                  return [
                    measured.length > 1 ? line(`${key}-measured`, measured, undefined) : null,
                    projected.length > 1
                      ? line(`${key}-projected`, projected, dash ?? PROJECTED_DASH)
                      : null,
                  ].filter((element) => element !== null);
                })}
                {markers.map((marker) => (
                  <ReferenceDot
                    key={`${marker.id}-marker`}
                    x={marker.timestamp}
                    y={marker.value}
                    r={chart.markerRadius}
                    fill={strokes.get(marker.id)?.color ?? marker.color}
                    stroke="var(--bg-primary)"
                    strokeWidth={chart.markerStroke}
                  />
                ))}
                <MarkerLabels markers={markers} formatGroup={formatMarkerGroup} />
                <PlotLabels
                  forecast={projectedOnly ? undefined : forecast}
                  annotations={annotations}
                />
                {inspecting && timestamp !== undefined && (
                  <ReferenceLine
                    x={timestamp}
                    stroke="var(--focus-ring)"
                    strokeDasharray={chart.inspectDash}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className={styles.range}>
            {formatX(xDomain[0])} – {formatX(xDomain[1])}
          </p>
          <div id={readoutId} className={styles.readout} aria-live="polite" aria-atomic="true">
            {inspecting && timestamp !== undefined
              ? [
                  formatX(timestamp),
                  ...visible.map((item) => {
                    const value = inspectSeriesValue(data, item, timestamp);
                    return `${item.label}: ${value === null || value === undefined ? t('redesign.chart.unreported') : formatY(value)}`;
                  }),
                ].join(' · ')
              : guided
                ? null
                : t('redesign.chart.keyboard')}
          </div>
          {visible.length === 0 && (
            <p className={styles.empty}>{t('redesign.chart.choose_series')}</p>
          )}
          {legendPlacement === 'after' && legend}
          {legendPlacement !== 'before' && legendNote}
          {guideDisclosure}
          {dataTable !== false && tableDisclosure}
        </>
      )}
    </figure>
  );
}
