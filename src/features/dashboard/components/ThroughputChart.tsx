import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { TimeSeriesChart, type TimeSeriesSeries } from '@/components/ui/TimeSeriesChart';
import { formatPercent } from '@/utils/format';
import type { TrafficWindow } from '../types';
import { formatClock, formatClockRange } from '../logic/time';
import { axisMax } from '../utils';
import styles from './ThroughputChart.module.scss';
import { chart } from '@/design-system';

const trafficSummary = (t: TFunction, traffic: TrafficWindow): string =>
  t('dashboard.traffic_chart_summary', {
    total: traffic.total,
    success: traffic.success,
    failed: traffic.failed,
    minutes: traffic.windowMinutes,
  });

/** The per-bucket table behind the plot, also offered when every bucket is zero. */
export function ThroughputTable({ traffic }: { traffic: TrafficWindow }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const formatCount = (value: number) => value.toLocaleString(locale);
  return (
    <table>
      <caption className={styles.srOnly}>{trafficSummary(t, traffic)}</caption>
      <thead>
        <tr>
          <th scope="col">{t('dashboard.traffic_table_window')}</th>
          <th scope="col">{t('stats.success')}</th>
          <th scope="col">{t('stats.failure')}</th>
          <th scope="col">{t('dashboard.success_rate')}</th>
        </tr>
      </thead>
      <tbody>
        {traffic.buckets.map((bucket) => {
          const total = bucket.success + bucket.failed;
          return (
            <tr key={bucket.startMs}>
              <th scope="row">
                {formatClockRange(bucket.startMs, bucket.endMs, locale)}
                {bucket.partial ? ` · ${t('dashboard.traffic_partial')}` : ''}
              </th>
              <td>{formatCount(bucket.success)}</td>
              <td>{formatCount(bucket.failed)}</td>
              <td>{total > 0 ? formatPercent((bucket.success / total) * 100) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface EmptyRequestFlowProps {
  /** A window whose buckets all reported zero requests. */
  traffic: TrafficWindow;
  /** Time zone of the clock times, e.g. "GMT-8". */
  zoneLabel: string;
  /** Freshness of the sources behind the window. */
  stamp: ReactNode;
  /** Partial-source note, when a primary source is missing. */
  note?: ReactNode;
}

/**
 * Request flow for an all-zero window: one row with the title, the bucket fact, the exact
 * window and zone and its freshness, plus the zero buckets on demand. The page status
 * already says there were no requests, so this row does not repeat it.
 */
export function EmptyRequestFlow({ traffic, zoneLabel, stamp, note }: EmptyRequestFlowProps) {
  const { t, i18n } = useTranslation();
  const { buckets } = traffic;
  const startMs = buckets[0]?.startMs ?? traffic.startMs ?? 0;
  const endMs = buckets[buckets.length - 1]?.endMs ?? traffic.endMs ?? 0;
  return (
    <>
      <div className={styles.compactRow}>
        <h2 id="dashboard-request-flow-title" className={styles.compactTitle}>
          {t('redesign.dashboard.request_flow')}
        </h2>
        <p className={styles.emptyRow}>
          <span>{t('dashboard.traffic_all_zero')}</span>
          <span className={styles.emptyRange}>
            {formatClockRange(startMs, endMs, i18n.language)} {zoneLabel}
          </span>
        </p>
        {stamp}
      </div>
      {note}
      <details className={styles.tableDisclosure}>
        <summary>{t('redesign.chart.table')}</summary>
        <div className={styles.tableWrap}>
          <ThroughputTable traffic={traffic} />
        </div>
      </details>
    </>
  );
}

/** The request plot. An all-zero window is `EmptyRequestFlow`'s job, not this chart's. */
export function ThroughputChart({ traffic }: { traffic: TrafficWindow }) {
  const { t, i18n } = useTranslation();
  const { buckets } = traffic;
  const locale = i18n.language;
  if (buckets.length === 0) {
    return <p className={styles.emptyRow}>{t('dashboard.traffic_unavailable')}</p>;
  }

  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const formatCount = (value: number) => value.toLocaleString(locale);
  const series: TimeSeriesSeries[] = [
    {
      id: 'success',
      label: t('stats.success'),
      color: 'var(--chart-1)',
      legendValue: formatCount(traffic.success),
    },
    {
      id: 'failed',
      label: t('stats.failure'),
      color: 'var(--chart-4)',
      strokeDasharray: '4 4',
      legendValue: formatCount(traffic.failed),
    },
  ];
  const summary = trafficSummary(t, traffic);

  return (
    <TimeSeriesChart
      id="dashboard-requests"
      data={buckets.map((bucket) => ({
        timestamp: bucket.startMs,
        values: { success: bucket.success, failed: bucket.failed },
      }))}
      series={series}
      xDomain={[first.startMs, last.endMs]}
      yDomain={[0, axisMax(traffic.peakTotal, 4)]}
      formatX={(timestamp) => formatClock(timestamp, locale)}
      formatY={formatCount}
      ariaLabel={summary}
      emptyText={t('status_bar.no_requests')}
      height={chart.height.throughput}
      dataTable={<ThroughputTable traffic={traffic} />}
    />
  );
}
