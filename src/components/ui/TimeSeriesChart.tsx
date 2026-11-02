import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  TimeSeriesChartProps,
  TimeSeriesPoint,
  TimeSeriesSample,
} from './TimeSeriesChart.types';
import {
  buildInspectionTimes,
  inspectSeriesValue,
  moveInspectionIndex,
  pointerInspectionIndex,
  seriesMarker,
} from './TimeSeriesChart.model';
import { TimeSeriesChartTable } from './TimeSeriesChartTable';
import styles from './TimeSeriesChart.module.scss';

export type {
  TimeSeriesChartProps,
  TimeSeriesPoint,
  TimeSeriesSample,
  TimeSeriesSeries,
} from './TimeSeriesChart.types';

const subscribeReducedMotion = (listener: () => void) => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const readReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  className,
}: TimeSeriesChartProps) {
  const { t } = useTranslation();
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => true);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => series.filter((item) => !hidden.has(item.id)), [series, hidden]);
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
          points: item.points
            ? [...item.points]
            : independent
              ? data.map((point) => ({
                  timestamp: point.timestamp,
                  value: point.values[item.id] ?? null,
                }))
              : undefined,
        }))
        .filter(({ item }) => !hidden.has(item.id)),
    [data, independent, series, hidden]
  );
  const timestamp = times[Math.min(selected, Math.max(0, times.length - 1))];
  const readoutId = `${id}-readout`;

  const toggleSeries = (seriesId: string) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(seriesId)) next.delete(seriesId);
      else next.add(seriesId);
      return next;
    });
  };

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

  return (
    <figure className={[styles.chart, className].filter(Boolean).join(' ')}>
      {description && <figcaption className={styles.description}>{description}</figcaption>}
      <div className={styles.legend} role="group" aria-label={t('redesign.chart.series')}>
        {series.map((item, index) => {
          const value = seriesMarker(data, item)?.value;
          return (
            <button
              type="button"
              key={item.id}
              className={styles.series}
              aria-pressed={!hidden.has(item.id)}
              onClick={() => toggleSeries(item.id)}
            >
              <span
                className={styles.number}
                style={{ borderColor: item.color }}
                aria-hidden="true"
              >
                {item.number ?? index + 1}
              </span>
              <span className={styles.name}>{item.label}</span>
              <strong>
                {item.legendValue ??
                  (value === null || value === undefined
                    ? t('redesign.chart.unreported')
                    : formatY(value))}
              </strong>
            </button>
          );
        })}
      </div>

      {times.length === 0 || series.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <>
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
            <ResponsiveContainer width="100%" height={height} minWidth={0}>
              <LineChart
                data={chartData}
                accessibilityLayer={false}
                tabIndex={-1}
                margin={{ top: 24, right: 20, bottom: 8, left: 4 }}
                onMouseMove={inspectPointer}
              >
                <CartesianGrid vertical={false} stroke="var(--border-color)" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={[...xDomain]}
                  allowDataOverflow
                  tickFormatter={formatX}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={36}
                />
                <YAxis
                  dataKey={independent ? 'value' : undefined}
                  domain={yDomain ? [...yDomain] : [0, 'auto']}
                  allowDataOverflow={Boolean(yDomain)}
                  tickFormatter={formatY}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={54}
                  allowDecimals={false}
                />
                <Tooltip
                  content={independent ? () => null : undefined}
                  labelFormatter={(value) => formatX(Number(value))}
                  formatter={(value) => formatY(Number(value))}
                  contentStyle={{
                    background: 'var(--floating-surface)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    fontSize: 12,
                  }}
                />
                {plotted.flatMap(({ item, number, points }) => {
                  const marker = seriesMarker(data, item);
                  const value = marker?.value;
                  return [
                    <Line
                      key={item.id}
                      name={item.label}
                      data={points}
                      dataKey={(row: TimeSeriesPoint | TimeSeriesSample) =>
                        'values' in row ? (row.values[item.id] ?? null) : row.value
                      }
                      type={item.interpolation ?? 'linear'}
                      stroke={item.color}
                      strokeWidth={2.25}
                      strokeDasharray={item.strokeDasharray}
                      connectNulls={false}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={!reducedMotion}
                      animationDuration={180}
                    />,
                    item.marker !== false && marker && value !== null && value !== undefined ? (
                      <ReferenceDot
                        key={`${item.id}-marker`}
                        x={marker.timestamp}
                        y={value}
                        r={4}
                        fill={item.color}
                        stroke="var(--bg-primary)"
                        label={{
                          value: number,
                          position: 'top',
                          fill: 'var(--text-primary)',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      />
                    ) : null,
                  ];
                })}
                {inspecting && timestamp !== undefined && (
                  <ReferenceLine x={timestamp} stroke="var(--focus-ring)" strokeDasharray="3 4" />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div id={readoutId} className={styles.readout} aria-live="polite" aria-atomic="true">
            {inspecting && timestamp !== undefined
              ? [
                  formatX(timestamp),
                  ...visible.map((item) => {
                    const value = inspectSeriesValue(data, item, timestamp);
                    return `${item.label}: ${value === null || value === undefined ? t('redesign.chart.unreported') : formatY(value)}`;
                  }),
                ].join(' · ')
              : t('redesign.chart.keyboard')}
          </div>
          {visible.length === 0 && (
            <p className={styles.empty}>{t('redesign.chart.choose_series')}</p>
          )}
          {dataTable !== false && (
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
          )}
        </>
      )}
    </figure>
  );
}
